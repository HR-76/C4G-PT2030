const crypto = require('node:crypto');

function fault(code) { return Object.assign(new Error(code), { code }); }
function key(config) {
  return crypto.hkdfSync('sha256', config.sessionSecret, '', 'c4g-idp-account-token-v1', 32);
}
function binding(identity) { return Buffer.from(JSON.stringify([identity.issuer, identity.subject])); }
function sealAccountToken(config, identity, token, expiresAt) {
  if (typeof token !== 'string' || !token || token.length > 16384 || !Number.isFinite(expiresAt)) return null;
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(config), iv);
  cipher.setAAD(binding(identity));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ token, expiresAt }), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
function openAccountToken(config, identity, sealed, now) {
  try {
    if (typeof sealed !== 'string' || sealed.length > 24000) throw Error();
    const bytes = Buffer.from(sealed, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(config), bytes.subarray(0, 12));
    decipher.setAAD(binding(identity)); decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    if (typeof value.token !== 'string' || !Number.isFinite(value.expiresAt) || value.expiresAt <= now) throw Error();
    return value.token;
  } catch { throw fault('ACCOUNT_REAUTH_REQUIRED'); }
}
async function readEmailPreference(config, auth, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const token = openAccountToken(config, auth.identity, auth.accountToken, now);
  const url = new URL(config.issuer.href.replace(/\/$/, '') + '/account/credentials');
  url.searchParams.set('type', 'email-authenticator');
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5000);
  let reader;
  try {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      redirect: 'manual', signal: abort.signal });
    if (response.status === 401) throw fault('ACCOUNT_REAUTH_REQUIRED');
    if (response.status !== 200 || !/^application\/json\b/i.test(response.headers.get('content-type') || '')) throw Error();
    reader = response.body.getReader(); const chunks = []; let size = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > 65536) throw Error(); chunks.push(Buffer.from(part.value));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const entries = Array.isArray(data) ? data.filter(item => item.type === 'email-authenticator') : [];
    if (entries.length !== 1 || !Array.isArray(entries[0].userCredentialMetadatas)) throw Error();
    const credentials = entries[0].userCredentialMetadatas;
    if (credentials.length > 1 || (credentials.length === 1 && !credentials[0].credential?.id)) throw Error();
    return { available: true, enabled: credentials.length === 1 };
  } catch (error) {
    if (error.code === 'ACCOUNT_REAUTH_REQUIRED') throw error;
    throw fault('ACCOUNT_PROVIDER_UNAVAILABLE');
  } finally { clearTimeout(timer); abort.abort(); if (reader) await reader.cancel().catch(() => {}); }
}
module.exports = { sealAccountToken, openAccountToken, readEmailPreference };
