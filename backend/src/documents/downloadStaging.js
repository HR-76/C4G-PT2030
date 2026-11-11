'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { LIMITS } = require('./constants');
const MAX_FILE = 100 * 1024 * 1024;
const fail = () => Object.assign(new Error('DOCUMENT_NOT_AVAILABLE'), { code: 'DOCUMENT_NOT_AVAILABLE' });
function createDownloadStaging({ directory = path.join(os.tmpdir(), 'c4g-verified-download-v1'), maxFile = MAX_FILE,
  maxConcurrent = 4, maxBytes = 400 * 1024 * 1024, freeBytes = () => { const s = fs.statfsSync(directory); return s.bavail * s.bsize; } } = {}) {
  let initialized = false, active = 0, reserved = 0;
  const nonce = crypto.randomUUID(), lock = path.join(directory, 'owner.json');
  function initialize() {
    if (initialized) return;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw fail();
    if (process.platform === 'win32') {
      // Windows ignores POSIX mode bits: use a protected DACL for this dedicated directory.
      const script = '$ErrorActionPreference="Stop"; $p=$env:C4G_PRIVATE_DOWNLOAD_DIR; $d=Get-Item -LiteralPath $p; $a=$d.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access); $a.SetAccessRuleProtection($true,$false); foreach($old in @($a.Access)){$a.RemoveAccessRuleSpecific($old)}; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $r=New-Object System.Security.AccessControl.FileSystemAccessRule($u,"FullControl","ContainerInherit,ObjectInherit","None","Allow"); $a.SetAccessRule($r); $d.SetAccessControl($a)';
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { env: { ...process.env, C4G_PRIVATE_DOWNLOAD_DIR: directory }, windowsHide: true, stdio: 'pipe', timeout: 10000 });
    } else fs.chmodSync(directory, 0o700);
    const startup = path.join(directory, 'startup.lock');
    fs.mkdirSync(startup); // Exclusive initialization/recovery; an interrupted recovery fails closed.
    try {
    try {
      const previous = JSON.parse(fs.readFileSync(lock, 'utf8'));
      if (previous.kind !== 'C4G_VERIFIED_DOWNLOAD_V1' || !Number.isSafeInteger(previous.pid) || previous.pid < 1) throw fail();
      let alive = true; try { process.kill(previous.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; else throw fail(); }
      if (alive) throw fail();
      // Only our exact regular-file namespace is recoverable; never follow symlinks.
      for (const name of fs.readdirSync(directory)) if (/^[a-f0-9-]{36}\.part$/.test(name)) {
        const file = path.join(directory, name), stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.isSymbolicLink()) throw fail();
        fs.unlinkSync(file);
      }
      fs.unlinkSync(lock);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const fd = fs.openSync(lock, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify({ kind: 'C4G_VERIFIED_DOWNLOAD_V1', pid: process.pid, nonce })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    initialized = true;
    } finally { fs.rmdirSync(startup); }
  }
  return Object.freeze({
    initialize,
    async prepare({ storage, objectId, storageClass, size, sha256, signal }) {
      initialize(); signal?.throwIfAborted();
      if (!Number.isSafeInteger(size) || size < 1 || size > maxFile || !/^[a-f0-9]{64}$/i.test(sha256 || '')
        || active >= maxConcurrent || reserved + size > maxBytes || freeBytes() < size + 16 * 1024 * 1024) throw fail();
      active++; reserved += size;
      const file = path.join(directory, `${crypto.randomUUID()}.part`);
      let released = false, source;
      const dispose = async () => { if (released) return; await fs.promises.rm(file, { force: true }); released = true; active--; reserved -= size; };
      const cancel = () => source?.destroy(signal.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const head = await storage.head({ objectId, storageClass, signal });
        if (!head || head.size !== size || !head.etag) throw fail();
        const digest = crypto.createHash('sha256'); let observed = 0;
        async function* chunks() {
          for (let start = 0; start < size; start += LIMITS.maxRangeBytes) {
            signal?.throwIfAborted();
            const end = Math.min(size - 1, start + LIMITS.maxRangeBytes - 1); let rangeBytes = 0;
            source = await storage.readRange({ objectId, storageClass, start, end, etag: head.etag, signal });
            try { for await (const chunk of source) {
              signal?.throwIfAborted(); rangeBytes += chunk.length; observed += chunk.length;
              if (rangeBytes > end - start + 1 || observed > size) throw fail();
              digest.update(chunk); yield chunk;
            } } finally { source?.destroy(); source = null; }
            if (rangeBytes !== end - start + 1) throw fail();
          }
        }
        await pipeline(Readable.from(chunks()), fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal });
        if (observed !== size || digest.digest('hex') !== sha256.toLowerCase()) throw fail();
        return Object.freeze({ size, dispose, open: () => { signal?.throwIfAborted(); return fs.createReadStream(file); } });
      } catch (e) { await dispose(); throw e; }
      finally { signal?.removeEventListener('abort', cancel); }
    },
    snapshot: () => ({ active, reserved }),
    close() {
      if (active) throw fail();
      if (initialized && JSON.parse(fs.readFileSync(lock, 'utf8')).nonce === nonce) fs.unlinkSync(lock);
      initialized = false;
    }
  });
}
const defaultDownloadStaging = createDownloadStaging();
module.exports = { createDownloadStaging, defaultDownloadStaging };
