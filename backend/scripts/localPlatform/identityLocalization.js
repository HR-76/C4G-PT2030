'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { folder } = require('./config');

// Keycloak's native `pt` bundle is European Portuguese; `pt-BR` is separate.
const localizationSettings = Object.freeze({
  internationalizationEnabled: true, supportedLocales: Object.freeze(['pt']), defaultLocale: 'pt'
});
const localeFields = Object.keys(localizationSettings);

function stableWithoutLocale(value) {
  const copy = { ...value };
  for (const field of localeFields) delete copy[field];
  const normalize = item => Array.isArray(item) ? item.map(normalize)
    : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, normalize(item[key])])) : item;
  return createHash('sha256').update(JSON.stringify(normalize(copy))).digest('hex');
}

// Explicit local presentation operation. Never used by API startup or account provisioning.
async function applyLocalization({ admin, state, backup = () => {} }) {
  const { realm, issuer, origin } = state.identity || {};
  if (!/^c4g-native-[a-z0-9-]+$/.test(realm || '')
    || issuer !== `https://localhost:8443/realms/${realm}` || origin !== 'http://localhost:3000') {
    throw Error('LOCAL_IDENTITY_TARGET_INVALID');
  }
  const current = await admin(realm);
  if (current.attributes?.['c4g.local.installation'] !== state.installationId) throw Error('LOCAL_REALM_ALREADY_OWNED');
  if (current.loginTheme !== 'c4g') throw Error('LOCAL_IDENTITY_THEME_REQUIRED');
  // Never serialize the full realm: it can contain SMTP credentials.
  await backup({ realm, installationId: state.installationId,
    internationalizationEnabled: current.internationalizationEnabled === true,
    supportedLocales: current.supportedLocales || [], defaultLocale: current.defaultLocale || '' });
  const matches = value => value.internationalizationEnabled === true && value.defaultLocale === 'pt'
    && Array.isArray(value.supportedLocales) && value.supportedLocales.length === 1 && value.supportedLocales[0] === 'pt';
  const changed = !matches(current);
  if (changed) await admin(realm, 'PUT', localizationSettings);
  const after = await admin(realm);
  if (!matches(after) || stableWithoutLocale(current) !== stableWithoutLocale(after)) {
    throw Error('LOCAL_IDENTITY_LOCALIZATION_VERIFICATION_FAILED');
  }
  return { changed, ...localizationSettings };
}

async function main() {
  const state = JSON.parse(fs.readFileSync(path.join(folder, 'runtime.json'), 'utf8'));
  const admin = await require('./optionalIdentity').identityAdmin(require('./identity').identityConfig());
  const result = await applyLocalization({ admin, state, backup: value => {
    const file = path.join(folder, 'identity-localization-backup.json');
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  } });
  console.log(JSON.stringify(result));
}

module.exports = { applyLocalization, localizationSettings };

if (require.main === module) main().catch(error => {
  console.error(/^[A-Z0-9_]+$/.test(error.message || '') ? error.message : 'LOCAL_IDENTITY_LOCALIZATION_FAILED');
  process.exitCode = 1;
});
