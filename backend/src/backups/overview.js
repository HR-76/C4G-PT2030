'use strict';
// Read-only state of the R2 backups for Administração C4G. Contract: context/features/platform-backups-page.md.
// Returns database names, dates, sizes and file names only: never credentials, the bucket, the prefix or full keys.
const backups = require('./r2Backups');

const iso = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); };

function summarise(objects, { prefix, now, maxAgeHours }) {
  const copies = new Map();
  for (const object of objects) {
    const parsed = backups.parseKey(prefix, object?.key);
    if (!parsed) continue;
    const id = `${parsed.database}/${parsed.stamp}`;
    if (!copies.has(id)) copies.set(id, { database: parsed.database, stamp: parsed.stamp });
    copies.get(id)[parsed.kind] = object;
  }
  const items = [...copies.values()].filter(copy => copy.dump)
    .sort((a, b) => b.stamp.localeCompare(a.stamp) || a.database.localeCompare(b.database))
    .map(copy => ({
      database: copy.database, at: backups.stampDate(copy.stamp).toISOString(),
      sizeBytes: Number.isSafeInteger(copy.dump.size) ? copy.dump.size : null, file: `${copy.stamp}.dump.enc`,
      // The manifest is uploaded only after the copy's own upload was checked, so its presence marks a complete copy.
      state: !copy.manifest ? 'INCOMPLETE' : copy.verification ? 'RESTORE_TESTED' : 'AVAILABLE',
      restoreTestedAt: copy.manifest && copy.verification ? iso(copy.verification.modifiedAt) : null
    }));
  const databases = [...new Set(items.map(item => item.database))].sort().map(database => {
    const latest = items.find(item => item.database === database && item.state !== 'INCOMPLETE');
    if (!latest) return { database, ok: false, lastAt: null, ageHours: null };
    const ageHours = Math.floor((now - new Date(latest.at)) / 3600000);
    return { database, ok: ageHours <= maxAgeHours, lastAt: latest.at, ageHours };
  });
  const covered = databases.length > 0 && databases.every(item => item.lastAt);
  const tested = items.map(item => item.restoreTestedAt).filter(Boolean).sort();
  return {
    status: !databases.length ? 'EMPTY' : databases.every(item => item.ok) ? 'OK' : 'STALE',
    // The moment from which every database had a complete copy.
    lastGoodAt: covered ? databases.map(item => item.lastAt).sort()[0] : null,
    lastRestoreTestAt: tested.at(-1) || null,
    maxAgeHours, retention: { daily: 14, weekly: 8 }, checkedAt: now.toISOString(), databases, items
  };
}

function createBackupOverview({ store, now = () => new Date(), maxAgeHours = 36, cacheMs = 60000 }) {
  if (!store || typeof store.objects !== 'function') throw new TypeError('Backup store required.');
  let cached = null, pending = null;
  return Object.freeze({
    async read() {
      const moment = now();
      if (cached && moment - cached.at < cacheMs) return cached.value;
      pending ||= store.objects().then(objects => {
        cached = { at: moment, value: summarise(objects, { prefix: store.prefix, now: moment, maxAgeHours }) };
        return cached.value;
      }).finally(() => { pending = null; });
      return pending;
    }
  });
}

// Opt-in: PLATFORM_BACKUPS_RUNTIME=r2 reads the backups folder with the R2 values the API already has.
function configuredBackupOverview({ env = {}, provided = null }) {
  const mode = env.PLATFORM_BACKUPS_RUNTIME || 'disabled';
  if (!['disabled', 'r2'].includes(mode)) throw new TypeError('Platform backups runtime must be disabled or r2.');
  if (provided) return provided;
  if (mode !== 'r2') return null;
  return createBackupOverview({ store: backups.createBackupStore(backups.loadBackupConfiguration(env), { timeoutMs: 8000 }) });
}

module.exports = Object.freeze({ summarise, createBackupOverview, configuredBackupOverview });
