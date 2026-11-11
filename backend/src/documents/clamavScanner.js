'use strict';
const net = require('node:net');
const { createHash } = require('node:crypto');
const { UUID } = require('./objectIdentity');
const { LIMITS, FILE_CLASSES } = require('./constants');
const MAX_SIZE = Math.max(...Object.values(FILE_CLASSES).map(value => value.maxBytes));
const failure = (code='MALWARE_SCANNER_UNAVAILABLE') => Object.assign(new Error(code),{code});
const cancelled = () => failure('WORKER_DRAINING');

// A provider may ignore cancellation. Stop awaiting it, but still observe its
// eventual rejection and dispose a stream returned after the caller has left.
function abortable(operation, signal, onLate = () => {}) {
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; signal?.removeEventListener?.('abort', onAbort); callback(value);
    };
    const onAbort = () => finish(reject, cancelled());
    signal?.addEventListener?.('abort', onAbort, { once: true });
    Promise.resolve().then(() => {
      if (signal?.aborted) throw cancelled();
      return operation();
    }).then(value => {
      if (settled) { onLate(value); return; }
      finish(resolve, value);
    }, error => finish(reject, error));
  });
}

function disposeSource(source, waitMs = 0) {
  if (!source || typeof source.destroy !== 'function' || source.closed) return Promise.resolve();
  return new Promise(resolve => {
    let timer;
    const done = () => { clearTimeout(timer); source.removeListener?.('close', done); resolve(); };
    // A late source has no async iterator to consume a destroy error.
    source.once?.('error', () => {});
    if (waitMs > 0 && typeof source.once === 'function') {
      source.once('close', done); timer = setTimeout(done, waitMs);
    }
    try { source.destroy(); } catch { done(); return; }
    if (!timer || source.closed) done();
  });
}

// ClamD TCP has no authentication or TLS. Only a loopback daemon/tunnel is
// accepted here; remote service selection remains an infrastructure concern.
function createClamavScanner({ organizationId, authority, storage, host = '127.0.0.1', port = 3310, timeoutMs = 60000 } = {}) {
  const central = authority === 'CENTRAL' && organizationId == null;
  if ((!central && !UUID.test(organizationId || '')) || (authority === 'CENTRAL' && !central) || !storage || typeof storage.head !== 'function' || typeof storage.readRange !== 'function'
    || !['127.0.0.1', '::1'].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535
    || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new TypeError('MALWARE_SCANNER_CONFIGURATION_INVALID');
  function exchange(command, stream = null, signal = null) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(cancelled()); return; }
      const socket = net.createConnection({ host, port });
      let settled = false, submitted = false, reply = Buffer.alloc(0);
      const timer = setTimeout(() => finish(failure()), timeoutMs);
      const onAbort = () => finish(cancelled());
      signal?.addEventListener?.('abort',onAbort,{once:true});
      function finish(error, value) {
        if (settled) return;
        settled = true; clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort);socket.destroy();
        if (error) reject(error); else resolve(value);
      }
      function write(bytes) {
        return new Promise((done, fail) => {
          if (settled || signal?.aborted) { fail(signal?.aborted ? cancelled() : failure()); return; }
          socket.write(bytes, error => error ? fail(failure()) : done());
        });
      }
      socket.on('error', () => finish(failure()));
      socket.on('end', () => { if (!settled) finish(failure()); });
      socket.on('close', () => { if (!settled) finish(failure()); });
      socket.on('data', bytes => {
        if (settled) return;
        if (reply.length + bytes.length > 1024) { finish(failure()); return; }
        reply = Buffer.concat([reply, bytes]);
        const end = reply.indexOf(0);
        if (end !== -1) {
          if (!submitted || end !== reply.length - 1) finish(failure());
          else finish(null, reply.subarray(0, end).toString('utf8'));
        }
      });
      socket.once('connect', async () => {
        if (settled || signal?.aborted) return;
        try {
          submitted = !stream;
          await write(Buffer.from(`z${command}\0`));
          if (stream) {
            await stream(async chunk => {
              // Each frame is bounded independently of the provider's chunks.
              for (let offset = 0; offset < chunk.length; offset += 65536) {
                const frame = chunk.subarray(offset, offset + 65536);
                const length = Buffer.alloc(4); length.writeUInt32BE(frame.length);
                await write(length); await write(frame);
              }
            });
            submitted = true; await write(Buffer.alloc(4));
          }
        } catch(error) { finish(signal?.aborted?cancelled():error?.code?error:failure()); }
      });
    });
  }
  return Object.freeze({
    async scan({ objectId, organizationId: requested, authority: requestedAuthority, expectedSize, expectedSha256, signal = null }) {
      if ((central ? requestedAuthority !== 'CENTRAL' || requested != null : requested !== organizationId) || !UUID.test(objectId || '') || !Number.isSafeInteger(expectedSize) || expectedSize < 1
        || expectedSize > MAX_SIZE || !/^[a-f0-9]{64}$/.test(expectedSha256 || '')) return Object.freeze({ status: 'ERROR' });
      try {
        if(signal?.aborted)throw cancelled();
        const record = await abortable(() => storage.head({ objectId, storageClass: 'QUARANTINE', signal }), signal);
        if (signal?.aborted) throw cancelled();
        if (!record || !Number.isSafeInteger(record.size) || record.size < 1 || record.size > MAX_SIZE
          || record.size !== expectedSize || record.sha256 !== expectedSha256 || !record.etag) return Object.freeze({ status: 'ERROR' });
        let activeSource = null, stopped = false;
        const deadline = Date.now() + timeoutMs;
        const result = await exchange('INSTREAM', async write => {
          const hash = createHash('sha256'); let size = 0;
          for (let start = 0; start < record.size; start += LIMITS.maxRangeBytes) {
            if(signal?.aborted)throw cancelled();
            const source = await abortable(() => storage.readRange({ objectId, storageClass: 'QUARANTINE', start,
              end: Math.min(record.size - 1, start + LIMITS.maxRangeBytes - 1), etag: record.etag, signal }), signal, disposeSource);
            if (stopped || signal?.aborted) { await disposeSource(source); throw signal?.aborted ? cancelled() : failure(); }
            activeSource=source;for await (const raw of source) {
              if(signal?.aborted)throw cancelled();
              const chunk = Buffer.from(raw); size += chunk.length;
              if (size > record.size) throw failure();
              hash.update(chunk); await write(chunk);
            }activeSource=null;
          }
          if (size !== record.size || hash.digest('hex') !== record.sha256) throw failure();
        },signal).finally(async () => {
          stopped = true;
          // Cooperative streams close before settlement. Uncooperative destroy
          // implementations cannot hold the caller beyond the scanner deadline.
          await disposeSource(activeSource, Math.max(0, deadline - Date.now()));
        });
        if (signal?.aborted) throw cancelled();
        return Object.freeze({ status: result === 'stream: OK' ? 'CLEAN' : /^stream: [^\r\n]+ FOUND$/.test(result) ? 'INFECTED' : 'ERROR' });
      } catch(error) { if(signal?.aborted||error?.code==='WORKER_DRAINING')throw cancelled();return Object.freeze({ status: 'ERROR' }); }
    },
    async health() {
      try { return Object.freeze({ ready: await exchange('PING') === 'PONG', adapter: 'clamav-instream-v1' }); }
      catch { return Object.freeze({ ready: false, adapter: 'clamav-instream-v1' }); }
    }
  });
}
module.exports = { createClamavScanner };
