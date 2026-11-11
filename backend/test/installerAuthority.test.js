'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { withInstallerAuthority, nativePool, DEMOTE_SQL, ELEVATE_SQL } = require('../scripts/localPlatform/installerAuthority');

// c4g_f12_admin is the pinned owner of the installers' migrations and is made SUPERUSER only for the
// duration of an installer run. The helper must always leave it demoted, repair a crashed run, and
// refuse concurrent installers.
function fakePool({ lockFree = true, role = {}, demoteFails = false, stillElevatedAfterDemote = false } = {}) {
  const state = { superuser: role.superuser ?? false, statements: [], released: [] };
  const roleRow = () => ({
    exists: role.exists ?? true, can_login: role.canLogin ?? false, superuser: state.superuser, members: role.members ?? 0
  });
  function client() {
    return {
      async query(sql) {
        const text = sql.replace(/\s+/g, ' ').trim();
        state.statements.push(text);
        if (/pg_try_advisory_lock/.test(text)) return { rows: [{ ok: lockFree }] };
        if (/FROM pg_roles/.test(text)) return { rows: [roleRow()] };
        if (text === ELEVATE_SQL) state.superuser = true;
        if (text === DEMOTE_SQL) {
          if (demoteFails) throw new Error('connection lost');
          state.superuser = stillElevatedAfterDemote;
        }
        return { rows: [] };
      },
      release(error) { state.released.push(error ? 'destroyed' : 'returned'); }
    };
  }
  return { state, pool: { connect: async () => client(), query: async sql => client().query(sql) } };
}
const count = (state, sql) => state.statements.filter(s => s === sql).length;

test('elevates for the work and always demotes afterwards, verifying the result', async () => {
  const { pool, state } = fakePool();
  const result = await withInstallerAuthority(pool, { signals: new EventEmitter() }, async ({ native }) => {
    assert.equal(state.superuser, true);
    assert.equal(typeof native.connect, 'function');
    return 'done';
  });
  assert.equal(result, 'done');
  assert.equal(state.superuser, false);
  assert.equal(count(state, ELEVATE_SQL), 1);
  assert.equal(count(state, DEMOTE_SQL), 1);
  assert.match(state.statements[0], /pg_try_advisory_lock/);
  assert.equal(state.statements.at(-1).includes('pg_advisory_unlock') || state.released.length > 0, true);
});

test('a failing run is demoted and the original error is rethrown', async () => {
  const { pool, state } = fakePool();
  await assert.rejects(() => withInstallerAuthority(pool, { signals: new EventEmitter() }, async () => { throw new Error('migration failed'); }), /migration failed/);
  assert.equal(state.superuser, false);
});

test('demote() inside the work ends the window early and is not repeated at exit', async () => {
  const { pool, state } = fakePool();
  await withInstallerAuthority(pool, { signals: new EventEmitter() }, async ({ demote }) => {
    await demote();
    assert.equal(state.superuser, false);
    await demote();
  });
  assert.equal(count(state, DEMOTE_SQL), 1);
});

test('a failed demotion reports the role as still elevated and keeps the original error as cause', async () => {
  const { pool } = fakePool({ demoteFails: true });
  await assert.rejects(
    () => withInstallerAuthority(pool, { signals: new EventEmitter() }, async () => { throw new Error('migration failed'); }),
    error => error.code === 'INSTALLER_ROLE_STILL_ELEVATED' && /migration failed/.test(error.cause?.message ?? '')
  );
});

test('a demotion that does not take effect is refused even without a work error', async () => {
  const { pool } = fakePool({ stillElevatedAfterDemote: true });
  await assert.rejects(() => withInstallerAuthority(pool, { signals: new EventEmitter() }, async () => {}),
    { code: 'INSTALLER_ROLE_STILL_ELEVATED' });
});

test('a role left SUPERUSER by a crashed run is repaired before the next elevation', async () => {
  const { pool, state } = fakePool({ role: { superuser: true } });
  const repaired = [];
  await withInstallerAuthority(pool, { signals: new EventEmitter(), onRepair: () => repaired.push(true) }, async () => {});
  assert.equal(repaired.length, 1);
  const demoteAt = state.statements.indexOf(DEMOTE_SQL);
  assert.ok(demoteAt >= 0 && demoteAt < state.statements.indexOf(ELEVATE_SQL));
  assert.equal(state.superuser, false);
});

test('a concurrent installer is refused without touching the role', async () => {
  const { pool, state } = fakePool({ lockFree: false, role: { superuser: true } });
  await assert.rejects(() => withInstallerAuthority(pool, { signals: new EventEmitter() }, async () => {}), { code: 'INSTALLER_ALREADY_RUNNING' });
  assert.equal(count(state, ELEVATE_SQL) + count(state, DEMOTE_SQL), 0);
});

test('a role that can log in, has members or is missing is refused before any ALTER', async () => {
  for (const [role, code] of [[{ canLogin: true }, 'INSTALLER_ROLE_UNSAFE'], [{ members: 1 }, 'INSTALLER_ROLE_UNSAFE'], [{ exists: false }, 'INSTALLER_ROLE_MISSING']]) {
    const { pool, state } = fakePool({ role });
    await assert.rejects(() => withInstallerAuthority(pool, { signals: new EventEmitter() }, async () => {}), { code });
    assert.equal(count(state, ELEVATE_SQL), 0);
  }
});

test('SIGINT demotes the role before exiting, and handlers are removed afterwards', async () => {
  const signals = new EventEmitter();
  const { pool, state } = fakePool();
  const exits = [];
  let release;
  const running = withInstallerAuthority(pool, { signals, exit: code => exits.push(code) }, () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.superuser, true);
  assert.equal(signals.listenerCount('SIGINT'), 1);
  signals.emit('SIGINT');
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.superuser, false);
  assert.deepEqual(exits, [130]);
  release();
  await running;
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('handlers are removed after a normal run', async () => {
  const signals = new EventEmitter();
  const { pool } = fakePool();
  await withInstallerAuthority(pool, { signals }, async () => {});
  assert.equal(signals.listenerCount('SIGINT') + signals.listenerCount('SIGTERM'), 0);
});

test('nativePool authorizes each connection as the installer role and destroys it on failure', async () => {
  const log = [];
  const good = { async query(sql) { log.push(sql); return { rows: [] }; }, release(error) { log.push(error ? 'destroyed' : 'returned'); } };
  const native = nativePool({ connect: async () => good });
  const client = await native.connect();
  assert.deepEqual(log, ['SET SESSION AUTHORIZATION c4g_f12_admin']);
  client.release();
  assert.equal(log.at(-1), 'destroyed', 'an authorized session is never returned to the pool');

  const released = [];
  const bad = { async query() { throw new Error('no permission'); }, release(error) { released.push(error); } };
  await assert.rejects(() => nativePool({ connect: async () => bad }).connect(), /no permission/);
  assert.equal(released.length, 1);
  assert.ok(released[0] instanceof Error, 'the failed client is destroyed, not leaked');
});
