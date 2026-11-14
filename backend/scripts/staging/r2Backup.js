'use strict';
// Staging backups in R2 (see context/features/staging-backups.md). Runs inside the API image with the R2 values file:
//   put    <file> --database <db> --stamp <YYYYMMDDTHHMMSSZ> [--kind dump|manifest]
//   latest --database <db> --out <file> [--manifest-out <file>]
//   list   --database <db>
//   status --database <db> [--database <db> ...] [--max-age-hours 36]     (exit 1 when a copy is missing or stale)
//   prune  --database <db> [--database <db> ...] [--daily 14] [--weekly 8] [--apply]   (simulation unless --apply)
// Prints only JSON with key names, sizes and ages: never credentials, the encryption key or connection strings.
const fs = require('node:fs');
const backups = require('../../src/backups/r2Backups');

function parseArguments(args, { values = [], repeat = [], flags = [] }) {
  const result = { positional: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (flags.includes(argument)) { result[argument] = true; continue; }
    if (values.includes(argument) || repeat.includes(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw Object.assign(new Error('BACKUP_ARGUMENT_INVALID'), { code: 'BACKUP_ARGUMENT_INVALID' });
      index += 1;
      if (repeat.includes(argument)) (result[argument] ||= []).push(value); else result[argument] = value;
      continue;
    }
    if (argument.startsWith('--')) throw Object.assign(new Error('BACKUP_ARGUMENT_INVALID'), { code: 'BACKUP_ARGUMENT_INVALID' });
    result.positional.push(argument);
  }
  return result;
}

const number = (value, fallback) => value === undefined ? fallback : Number(value);

async function run(argv, env = process.env, { store = null, now = new Date() } = {}) {
  const [command, ...rest] = argv;
  const active = store || backups.createBackupStore(backups.loadBackupConfiguration(env));
  if (command === 'put') {
    const args = parseArguments(rest, { values: ['--database', '--stamp', '--kind'] });
    if (args.positional.length !== 1) throw Object.assign(new Error('BACKUP_ARGUMENT_INVALID'), { code: 'BACKUP_ARGUMENT_INVALID' });
    const key = backups.objectKey(active.prefix, args['--database'] || '', args['--stamp'] || '', args['--kind'] || 'dump');
    return { exitCode: 0, result: await active.put({ key, body: fs.readFileSync(args.positional[0]) }) };
  }
  if (command === 'latest') {
    const args = parseArguments(rest, { values: ['--database', '--out', '--manifest-out'] });
    const latest = await active.latest(args['--database'] || '');
    if (!latest || !args['--out']) return { exitCode: 1, result: { found: false } };
    fs.writeFileSync(args['--out'], await active.get(latest.dumpKey), { mode: 0o600 });
    if (args['--manifest-out']) fs.writeFileSync(args['--manifest-out'], await active.get(latest.manifestKey), { mode: 0o600 });
    return { exitCode: 0, result: { found: true, stamp: latest.stamp, dumpKey: latest.dumpKey } };
  }
  if (command === 'list') {
    const args = parseArguments(rest, { values: ['--database'] });
    const keys = await active.list(args['--database'] || '');
    return { exitCode: 0, result: { objects: keys.length, keys } };
  }
  if (command === 'status') {
    const args = parseArguments(rest, { values: ['--max-age-hours'], repeat: ['--database'] });
    const report = await backups.statusReport(active, args['--database'] || [], { now, maxAgeHours: number(args['--max-age-hours'], 36) });
    return { exitCode: report.length && report.every(item => item.ok) ? 0 : 1, result: report };
  }
  if (command === 'prune') {
    const args = parseArguments(rest, { values: ['--daily', '--weekly'], repeat: ['--database'], flags: ['--apply'] });
    const outcome = await backups.prune(active, args['--database'] || [], { now, apply: args['--apply'] === true, daily: number(args['--daily']), weekly: number(args['--weekly']) });
    return { exitCode: 0, result: { applied: outcome.applied, kept: outcome.keep, deleted: outcome.delete.length, ...(outcome.applied ? {} : { wouldDelete: outcome.delete }) } };
  }
  throw Object.assign(new Error('BACKUP_COMMAND_UNKNOWN'), { code: 'BACKUP_COMMAND_UNKNOWN' });
}

if (require.main === module) {
  run(process.argv.slice(2)).then(({ exitCode, result }) => { console.log(JSON.stringify(result)); process.exitCode = exitCode; })
    .catch(error => { console.error(`R2_BACKUP_FAILED ${error.code || 'UNKNOWN'}`); process.exitCode = 1; });
}

module.exports = { run, parseArguments };
