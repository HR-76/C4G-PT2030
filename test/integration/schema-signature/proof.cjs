'use strict';
// Proof for context/decisions/2026-11-20-schema-admission-catalog-signature.md, criterion 6.
//
// Creates ONE disposable database and TWO disposable roles on the PostgreSQL
// server given by SIGNATURE_PROOF_ADMIN_URL (a superuser connection), proves
// that every class of change the schema verifications cover moves the catalog
// signature and that ordinary activity does not, measures the signature's
// cost, and drops what it created. It never touches an existing database or role.
//
//   SIGNATURE_PROOF_ADMIN_URL=postgresql://postgres:...@localhost:5432/postgres node test/integration/schema-signature/proof.cjs
const crypto = require('node:crypto');
const path = require('node:path');
const backend = path.resolve(__dirname, '../../../backend');
const { Client } = require(path.join(backend, 'node_modules/pg'));
const { signatureSql, CENTRAL_DATA } = require(path.join(backend, 'src/security/schemaAdmissionSignature'));

const adminUrl = process.env.SIGNATURE_PROOF_ADMIN_URL;
if (!adminUrl) { process.stderr.write('SIGNATURE_PROOF_ADMIN_URL is required.\n'); process.exit(2); }
const suffix = crypto.randomBytes(5).toString('hex');
const database = `c4g_signature_proof_${suffix}`, reader = `c4g_sigproof_reader_${suffix}`, other = `c4g_sigproof_other_${suffix}`;
const readerPassword = crypto.randomBytes(18).toString('hex');
const urlFor = (name, user, password) => { const url = new URL(adminUrl); url.pathname = `/${name}`; if (user) { url.username = user; url.password = password; } return url.toString(); };

// Each entry must change the signature. Run as the database owner (superuser).
const MUST_CHANGE = [
  ['create table', 'CREATE TABLE app.extra(id int)'],
  ['add column', 'ALTER TABLE app.item ADD COLUMN note text'],
  ['column type', 'ALTER TABLE app.item ALTER COLUMN note TYPE varchar(40)'],
  ['column default', "ALTER TABLE app.item ALTER COLUMN note SET DEFAULT 'x'"],
  ['not null', 'ALTER TABLE app.item ALTER COLUMN label SET NOT NULL'],
  ['check constraint', 'ALTER TABLE app.item ADD CONSTRAINT item_label_check CHECK (label <> \'\')'],
  ['drop constraint', 'ALTER TABLE app.item DROP CONSTRAINT item_label_check'],
  ['foreign key', 'ALTER TABLE app.extra ADD CONSTRAINT extra_item FOREIGN KEY (id) REFERENCES app.item(id)'],
  ['create index', 'CREATE INDEX item_label ON app.item(label)'],
  ['drop index', 'DROP INDEX app.item_label'],
  ['create trigger', 'CREATE TRIGGER item_guard BEFORE UPDATE ON app.item FOR EACH ROW EXECUTE FUNCTION app.guard()'],
  ['disable trigger', 'ALTER TABLE app.item DISABLE TRIGGER item_guard'],
  ['drop trigger', 'DROP TRIGGER item_guard ON app.item'],
  ['enable RLS', 'ALTER TABLE app.item ENABLE ROW LEVEL SECURITY'],
  ['force RLS', 'ALTER TABLE app.item FORCE ROW LEVEL SECURITY'],
  ['create policy', 'CREATE POLICY item_all ON app.item USING (true)'],
  ['alter policy', 'ALTER POLICY item_all ON app.item USING (id > 0)'],
  ['drop policy', 'DROP POLICY item_all ON app.item'],
  ['disable RLS', 'ALTER TABLE app.item DISABLE ROW LEVEL SECURITY'],
  ['replace function body', "CREATE OR REPLACE FUNCTION app.guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"],
  ['function security definer', 'ALTER FUNCTION app.guard() SECURITY DEFINER'],
  ['function search_path', 'ALTER FUNCTION app.guard() SET search_path = pg_catalog'],
  ['function owner', `ALTER FUNCTION app.guard() OWNER TO ${other}`],
  ['table owner', `ALTER TABLE app.item OWNER TO ${other}`],
  ['schema owner', `ALTER SCHEMA app OWNER TO ${other}`],
  ['grant table', `GRANT SELECT ON app.item TO ${reader}`],
  ['revoke table', `REVOKE SELECT ON app.item FROM ${reader}`],
  ['grant column', `GRANT UPDATE (label) ON app.item TO ${reader}`],
  ['revoke column', `REVOKE UPDATE (label) ON app.item FROM ${reader}`],
  ['grant schema', `GRANT USAGE ON SCHEMA app TO ${reader}`],
  ['revoke schema', `REVOKE USAGE ON SCHEMA app FROM ${reader}`],
  ['grant function', `GRANT EXECUTE ON FUNCTION app.guard() TO ${reader}`],
  ['revoke function from public', 'REVOKE EXECUTE ON FUNCTION app.guard() FROM PUBLIC'],
  ['grant database', `GRANT CREATE ON DATABASE ${database} TO ${reader}`],
  ['default privileges', `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO ${reader}`],
  ['role membership', `GRANT ${other} TO ${reader}`],
  ['revoke membership', `REVOKE ${other} FROM ${reader}`],
  ['role attribute', `ALTER ROLE ${other} CREATEROLE`],
  ['role bypass RLS', `ALTER ROLE ${other} BYPASSRLS`],
  ['role setting', `ALTER ROLE ${other} IN DATABASE ${database} SET search_path = pg_catalog, app`],
  ['create sequence', 'CREATE SEQUENCE app.counter'],
  ['create view', 'CREATE VIEW app.item_view AS SELECT id FROM app.item'],
  ['create type', "CREATE TYPE app.state AS ENUM ('A','B')"],
  ['add enum value', "ALTER TYPE app.state ADD VALUE 'C'"],
  ['create extension', 'CREATE EXTENSION IF NOT EXISTS pgcrypto'],
  ['drop extension', 'DROP EXTENSION pgcrypto'],
  ['create schema', 'CREATE SCHEMA second'],
  ['rename table', 'ALTER TABLE app.extra RENAME TO extra_renamed'],
  ['drop table', 'DROP TABLE app.extra_renamed'],
  ['ledger row added', "INSERT INTO public.c4g_schema_migration(version, checksum_sha256, irreversible) VALUES ('002', repeat('b',64), false)"],
  ['ledger row changed', "UPDATE public.c4g_schema_migration SET checksum_sha256 = repeat('c',64) WHERE version = '002'"],
  ['ledger row removed', "DELETE FROM public.c4g_schema_migration WHERE version = '002'"],
  ['marker changed', "UPDATE public.c4g_database_identity SET database_role = 'TENANT'"]
];
// None of these may change the signature.
const MUST_NOT_CHANGE = [
  ['read', 'SELECT count(*) FROM app.item'],
  ['insert business rows', "INSERT INTO app.item(label) SELECT 'row ' || n FROM generate_series(1, 500) n"],
  ['update business rows', "UPDATE app.item SET label = label || '!'"],
  ['delete business rows', 'DELETE FROM app.item WHERE id % 2 = 0'],
  ['sequence use', "SELECT nextval('app.counter')"],
  ['analyze', 'ANALYZE app.item'],
  ['vacuum', 'VACUUM app.item'],
  ['vacuum analyze database', 'VACUUM ANALYZE']
];

async function main() {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const report = { database, changed: [], returnedToEarlierState: [], unchanged: [], failures: [] };
  let owner, login;
  try {
    report.server = (await admin.query("SELECT current_setting('server_version') AS v")).rows[0].v;
    await admin.query(`CREATE ROLE ${reader} LOGIN PASSWORD '${readerPassword}' NOSUPERUSER NOINHERIT`);
    await admin.query(`CREATE ROLE ${other} NOLOGIN`);
    await admin.query(`CREATE DATABASE ${database}`);
    owner = new Client({ connectionString: urlFor(database) });
    await owner.connect();
    await owner.query(`CREATE SCHEMA app;
      CREATE TABLE app.item(id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, label text);
      CREATE FUNCTION app.guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      CREATE TABLE public.c4g_schema_migration(version text PRIMARY KEY, checksum_sha256 text, irreversible boolean);
      CREATE TABLE public.c4g_database_identity(product_code text, database_role text);
      INSERT INTO public.c4g_schema_migration VALUES ('001', repeat('a',64), false);
      INSERT INTO public.c4g_database_identity VALUES ('C4G','CENTRAL');
      GRANT SELECT ON public.c4g_schema_migration, public.c4g_database_identity TO ${reader};`);
    // The signature is read by an ordinary, non-superuser login, as the runtime does.
    login = new Client({ connectionString: urlFor(database, reader, readerPassword) });
    await login.connect();
    const sql = signatureSql(CENTRAL_DATA);
    const read = async () => (await login.query(sql)).rows[0].signature;

    const seen = new Set([await read()]);
    for (const [name, statement] of MUST_CHANGE) {
      const before = await read();
      await owner.query(statement);
      const after = await read();
      if (after === before) report.failures.push(`NOT DETECTED: ${name}`);
      else report.changed.push(name);
      // Removing what was just created puts the catalog back in an earlier, identical state: the signature
      // is then the one of that state. It is a change (after !== before) and is listed for information.
      if (after !== before && seen.has(after)) report.returnedToEarlierState.push(name);
      seen.add(after);
    }
    for (const [name, statement] of MUST_NOT_CHANGE) {
      const before = await read();
      await owner.query(statement);
      if (await read() !== before) report.failures.push(`FALSE CHANGE: ${name}`);
      else report.unchanged.push(name);
    }
    // An uncommitted change is invisible; it is detected once committed.
    const before = await read();
    await owner.query('BEGIN'); await owner.query('ALTER TABLE app.item ADD COLUMN pending int');
    if (await read() !== before) report.failures.push('FALSE CHANGE: uncommitted DDL');
    await owner.query('COMMIT');
    if (await read() === before) report.failures.push('NOT DETECTED: committed DDL after open transaction'); else report.changed.push('commit of pending DDL');
    await owner.query('BEGIN'); await owner.query('ALTER TABLE app.item ADD COLUMN aborted int'); await owner.query('ROLLBACK');

    const timings = [];
    for (let i = 0; i < 30; i++) { const start = process.hrtime.bigint(); await read(); timings.push(Number(process.hrtime.bigint() - start) / 1e6); }
    timings.sort((a, b) => a - b);
    report.signatureMs = { median: +timings[15].toFixed(2), p90: +timings[26].toFixed(2), max: +timings[29].toFixed(2) };
    report.catalogRows = Number((await owner.query('SELECT (SELECT count(*) FROM pg_attribute)+(SELECT count(*) FROM pg_proc)+(SELECT count(*) FROM pg_class)+(SELECT count(*) FROM pg_type) AS n')).rows[0].n);
  } finally {
    await login?.end().catch(() => {});
    await owner?.end().catch(() => {});
    const cleanup = [];
    for (const statement of [`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`, `DROP ROLE IF EXISTS ${reader}`, `DROP ROLE IF EXISTS ${other}`]) {
      try { await admin.query(statement); } catch (error) { cleanup.push(`${statement}: ${error.message}`); }
    }
    report.cleanup = cleanup.length ? cleanup : 'complete';
    await admin.end().catch(() => {});
  }
  report.result = report.failures.length === 0 && report.cleanup === 'complete' ? 'PASS' : 'FAIL';
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.result === 'PASS' ? 0 : 1;
}
main().catch(error => { process.stderr.write(`SIGNATURE_PROOF_FAILED: ${error.message}\n`); process.exitCode = 1; });
