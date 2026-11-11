'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('../../../backend/node_modules/pg');
const express = require('../../../backend/node_modules/express');
const migrations = require('../../../backend/src/security/centralMigrationManifest');
const schema = require('../../../backend/src/security/centralSchemaManifest');
const security = require('../../../backend/src/security/authoritySecurityManifest');

(async () => {
  const url = new URL(process.env.PLATFORM_BILLING_ADMIN_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '5608');
  const pool = new Pool({ connectionString: url.toString() });
  try {
    await pool.query("CREATE ROLE c4g_f12_admin NOLOGIN NOINHERIT; ALTER ROLE c4g_f12_admin SUPERUSER; CREATE ROLE c4g_central_owner NOLOGIN; CREATE ROLE c4g_central_runtime NOLOGIN");
    const version = '027_platform_billing';
    const up = fs.readFileSync(path.resolve(__dirname, `../../../backend/database/central/migrations/${version}.up.sql`), 'utf8');
    const runner = require('../../../backend/scripts/runCentralMigrations');
    const installer = await pool.connect();
    try {
      await installer.query('SET SESSION AUTHORIZATION c4g_f12_admin');
      await installer.query("CREATE TABLE public.c4g_database_identity(product_code text NOT NULL,database_role text NOT NULL); INSERT INTO public.c4g_database_identity VALUES('C4G','CENTRAL')");
      const installerPool = { connect: async () => ({
        query: (...args) => installer.query(...args), release() {}
      }) };
      const applied = await runner.applyCentralMigrationsWithManifest(installerPool, migrations.manifest, migrations.migrationSql);
      assert.equal(applied.at(-1), version);
      assert.deepEqual(await runner.applyCentralMigrationsWithManifest(installerPool, migrations.manifest, migrations.migrationSql), []);
      await installer.query('RESET SESSION AUTHORIZATION');
    } finally {
      try { await installer.query('RESET SESSION AUTHORIZATION'); } catch { /* preserve the original failure */ }
      installer.release();
      await pool.query('ALTER ROLE c4g_f12_admin NOSUPERUSER NOCREATEROLE NOCREATEDB NOLOGIN');
    }
    const owner = (await pool.query("SELECT rolcanlogin,rolsuper FROM pg_roles WHERE rolname='c4g_f12_admin'")).rows[0];
    assert.deepEqual(owner, { rolcanlogin: false, rolsuper: false });
    const observedSchema = schema.schemaFingerprint(await schema.centralSchemaSnapshot(pool));
    const observedSecurity = security.digest(await security.authoritySecuritySnapshot(pool));
    if (process.env.PLATFORM_BILLING_CAPTURE === '1') {
      process.stdout.write(`${JSON.stringify({ version, schemaFingerprint: observedSchema,
        authoritySecurityFingerprint: observedSecurity,
        upChecksum: migrations.migrationChecksumPolicy(up).checksum })}\n`);
      return;
    }
    const preflight = await require('../../../backend/src/security/centralMigrationPreflight').preflightCentral(pool);
    assert.equal(preflight.currentVersion, version);
    assert.equal(preflight.fingerprint, migrations.manifest.at(-1).schemaFingerprint);
    assert.equal(observedSecurity, migrations.manifest.at(-1).authoritySecurityFingerprint);

    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'billing_%' ORDER BY tablename")).rows.map(row => row.tablename);
    assert.deepEqual(tables, [
      'billing_account', 'billing_account_version', 'billing_activity', 'billing_command_receipt',
      'billing_cycle', 'billing_cycle_revision', 'billing_fiscal_document',
      'billing_fiscal_document_revision', 'billing_payment_record'
    ]);
    for (const table of tables) {
      assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM public.${table}`)).rows[0].count, 0);
      assert.equal((await pool.query('SELECT has_table_privilege(\'c4g_central_runtime\',$1,\'SELECT\') AS allowed', [`public.${table}`])).rows[0].allowed, true);
      assert.equal((await pool.query('SELECT has_table_privilege(\'c4g_central_runtime\',$1,\'INSERT\') AS allowed', [`public.${table}`])).rows[0].allowed, false);
      assert.equal((await pool.query('SELECT has_table_privilege(\'c4g_authority_runtime\',$1,\'SELECT\') AS allowed', [`public.${table}`])).rows[0].allowed, false);
    }
    const triggerCount = (await pool.query("SELECT count(*)::integer AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname LIKE 'billing_%' AND t.tgname IN ('authority_first_lock','authority_write_guard','authority_effect_commit_guard')")).rows[0].count;
    assert.equal(triggerCount, 27);
    const executor = (await pool.query("SELECT pg_get_functiondef('authority_api.execute(text,text[],text)'::regprocedure) AS definition")).rows[0].definition;
    assert.match(executor, /execute_platform_billing\(query_code,\s*parameters\)/);

    const organizationId = randomUUID();
    const rollbackOrganizationId = randomUUID();
    const actorId = randomUUID();
    const sessionId = randomUUID();
    await pool.query('ALTER TABLE public.global_user DISABLE TRIGGER USER');
    await pool.query('ALTER TABLE public.organization DISABLE TRIGGER USER');
    await pool.query('ALTER TABLE public.platform_admin_assignment DISABLE TRIGGER USER');
    await pool.query('ALTER TABLE public.application_session DISABLE TRIGGER USER');
    try {
      await pool.query("INSERT INTO public.global_user(id,display_name,primary_email,status) VALUES($1,'Billing Gate','billing-gate@example.invalid','ACTIVE')", [actorId]);
      await pool.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,'Billing Gate','Billing Gate','billing-gate','COMPANY','ACTIVE','EUR','OPTIONAL')", [organizationId]);
      await pool.query("INSERT INTO public.organization(id,legal_name,display_name,slug,type_code,status,reporting_currency,mfa_policy_code) VALUES($1,'Billing Rollback Gate','Billing Rollback Gate','billing-rollback-gate','COMPANY','ACTIVE','EUR','OPTIONAL')", [rollbackOrganizationId]);
      await pool.query("INSERT INTO public.platform_admin_assignment(id,global_user_id,role_code,status) VALUES($1,$2,'C4G_ADMIN','ACTIVE')", [randomUUID(), actorId]);
      await pool.query("INSERT INTO public.application_session(sid,global_user_id,status,revocation_version,created_at,last_seen_at,expires_at) VALUES($1,$2,'ACTIVE',1,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour')", [sessionId, actorId]);
    } finally {
      await pool.query('ALTER TABLE public.application_session ENABLE TRIGGER USER');
      await pool.query('ALTER TABLE public.platform_admin_assignment ENABLE TRIGGER USER');
      await pool.query('ALTER TABLE public.organization ENABLE TRIGGER USER');
      await pool.query('ALTER TABLE public.global_user ENABLE TRIGGER USER');
    }
    const runtimePassword = randomUUID().replaceAll('-', '');
    await pool.query(`ALTER ROLE c4g_authority_runtime PASSWORD '${runtimePassword}'`);
    const runtimeUrl = new URL(url.toString());
    runtimeUrl.username = 'c4g_authority_runtime';
    runtimeUrl.password = runtimePassword;
    const authorityPool = new Pool({ connectionString: runtimeUrl.toString() });
    try {
      const coordinator = require('../../../backend/src/security/authorityCoordinator').createAuthorityCoordinator({
        pool: authorityPool,
        permitSecret: randomUUID().replaceAll('-', '')
      });
      const billingSql = require('../../../backend/src/platformBilling/sql');
      const { command } = require('../../../backend/src/platformBilling/contracts');
      const { createPlatformBillingRepository } = require('../../../backend/src/platformBilling/repository');
      const repository = createPlatformBillingRepository();
      const scopes = organization => ['POLICY', `ORG:${organization}`, `SUBJECT:${actorId}`];
      const accountInput = { idempotencyKey: randomUUID(), expectedRevision: 0, legalName: 'Billing Gate, Lda.',
        taxCountry: 'PT', taxIdentifier: '501234567', addressLine1: 'Rua do Gate, 1', addressLine2: null,
        postalCode: '1000-100', locality: 'Lisboa', region: null, billingEmail: 'billing@example.invalid',
        contactName: null, externalSource: null, externalCustomerRef: null, paymentTermsDays: 30, notes: null };
      const accountCommand = command('accountWrite', accountInput);
      const account = await coordinator.write(scopes(organizationId), client => repository.accountWrite(client,
        { organizationId, actorId, command: accountCommand }));
      assert.deepEqual(await coordinator.write(scopes(organizationId), client => repository.accountWrite(client,
        { organizationId, actorId, command: accountCommand })), account);
      await assert.rejects(() => coordinator.write(scopes(organizationId), client => repository.accountWrite(client,
        { organizationId, actorId, command: command('accountWrite', { ...accountInput, legalName: 'Conflito, Lda.' }) })),
      error => error.code === 'IDEMPOTENCY_CONFLICT');
      const accountUpdate = command('accountWrite', { ...accountInput, idempotencyKey: randomUUID(), expectedRevision: 1,
        billingEmail: 'billing-v2@example.invalid' });
      const updatedAccount = await coordinator.write(scopes(organizationId), client => repository.accountWrite(client,
        { organizationId, actorId, command: accountUpdate }));
      assert.equal(updatedAccount.revision, 2);
      await assert.rejects(() => coordinator.write(scopes(organizationId), client => repository.accountWrite(client,
        { organizationId, actorId, command: command('accountWrite', { ...accountUpdate, idempotencyKey: randomUUID(), expectedRevision: 1 }) })),
      error => error.code === 'STALE_REVISION');

      const cycleInput = { organizationId, accountVersionId: account.accountVersionId, periodStart: '2026-01-01',
        periodEnd: '2026-12-31', serviceDescription: 'Subscrição anual', currency: 'EUR', amount: '1200',
        plannedIssueDate: '2026-01-05', dueDate: '2026-02-04', contractReference: 'GATE-2026', notes: null,
        idempotencyKey: accountInput.idempotencyKey };
      const cycle = await coordinator.write(scopes(organizationId), client => repository.cycleCreate(client,
        { actorId, command: command('cycleCreate', cycleInput) }));
      const { organizationId: ignoredOrganization, ...editableCycle } = cycleInput;
      const edited = await coordinator.write(scopes(organizationId), client => repository.cycleEdit(client,
        { organizationId, cycleId: cycle.cycleId, actorId, command: command('cycleEdit', {
          ...editableCycle, idempotencyKey: randomUUID(), expectedRevision: 1, amount: '1300'
        }) }));
      assert.equal(edited.revision, 2);
      const transitioned = await coordinator.write(scopes(organizationId), client => repository.cycleTransition(client,
        { organizationId, cycleId: cycle.cycleId, actorId, command: command('cycleTransition', {
          toState: 'READY_TO_ISSUE', reason: 'Validado pela C4G', expectedRevision: 2, idempotencyKey: randomUUID()
        }) }));
      assert.equal(transitioned.state, 'READY_TO_ISSUE');

      const documentInput = { sourceCode: 'TOCONLINE', issuerReference: 'C4G-PT', documentType: 'INVOICE',
        documentNumber: 'FT GATE/2026/1', externalDocumentId: 'gate-document-1', issueDate: '2026-01-05',
        dueDate: '2026-02-04', currency: 'EUR', subtotal: '1000', taxTotal: '300', total: '1300',
        correctsDocumentId: null, expectedCycleRevision: 3, idempotencyKey: randomUUID() };
      const document = await coordinator.write(scopes(organizationId), client => repository.documentRecord(client,
        { organizationId, cycleId: cycle.cycleId, actorId, command: command('documentRecord', documentInput) }));
      assert.equal(document.cycleState, 'ISSUED');
      assert.deepEqual(await coordinator.write(scopes(organizationId), client => repository.documentRecord(client,
        { organizationId, cycleId: cycle.cycleId, actorId, command: command('documentRecord', documentInput) })), document);

      const paymentInput = { amount: '400', currency: 'EUR', paidOn: '2026-01-20',
        methodCode: 'BANK_TRANSFER', externalReference: 'GATE-TRX-1', note: null, idempotencyKey: randomUUID() };
      const payment = await coordinator.write(scopes(organizationId), client => repository.paymentRecord(client,
        { organizationId, documentId: document.documentId, actorId, command: command('paymentRecord', paymentInput) }));
      assert.deepEqual({ paid: payment.paidAmount, balance: payment.balanceAmount, state: payment.paymentState },
        { paid: '400', balance: '900', state: 'PARTIALLY_PAID' });
      assert.deepEqual(await coordinator.write(scopes(organizationId), client => repository.paymentRecord(client,
        { organizationId, documentId: document.documentId, actorId, command: command('paymentRecord', paymentInput) })), payment);

      const reversed = await coordinator.write(scopes(organizationId), client => repository.paymentReverse(client,
        { organizationId, paymentId: payment.paymentId, actorId, command: command('paymentReverse', {
          amount: '400', reversedOn: '2026-01-21', reason: 'Transferência devolvida', idempotencyKey: randomUUID()
        }) }));
      assert.equal(reversed.paymentState, 'REVERSED');
      await assert.rejects(() => coordinator.write(scopes(organizationId), client => repository.paymentReverse(client,
        { organizationId, paymentId: payment.paymentId, actorId, command: command('paymentReverse', {
          amount: '1', reversedOn: '2026-01-22', reason: 'Estorno excedente', idempotencyKey: randomUUID()
        }) })), error => error.code === '23514');

      const competing = amount => command('paymentRecord', { amount, currency: 'EUR', paidOn: '2026-01-22',
        methodCode: 'BANK_TRANSFER', externalReference: randomUUID(), note: null, idempotencyKey: randomUUID() });
      const race = await Promise.allSettled([
        coordinator.write(scopes(organizationId), client => repository.paymentRecord(client,
          { organizationId, documentId: document.documentId, actorId, command: competing('800') })),
        coordinator.write(scopes(organizationId), client => repository.paymentRecord(client,
          { organizationId, documentId: document.documentId, actorId, command: competing('800') }))
      ]);
      assert.equal(race.filter(item => item.status === 'fulfilled').length, 1);
      assert.equal(race.filter(item => item.status === 'rejected').length, 1);
      const settled = await coordinator.write(scopes(organizationId), client => repository.paymentRecord(client,
        { organizationId, documentId: document.documentId, actorId, command: competing('500') }));
      assert.deepEqual({ paid: settled.paidAmount, balance: settled.balanceAmount, state: settled.paymentState },
        { paid: '1300', balance: '0', state: 'PAID' });

      const correctionCycle = await coordinator.write(scopes(organizationId), client => repository.cycleCreate(client,
        { actorId, command: command('cycleCreate', { ...cycleInput, periodStart: '2027-01-01', periodEnd: '2027-12-31',
          amount: '100', dueDate: '2027-02-04', plannedIssueDate: '2027-01-05', contractReference: 'GATE-2027',
          idempotencyKey: randomUUID() }) }));
      await coordinator.write(scopes(organizationId), client => repository.cycleTransition(client,
        { organizationId, cycleId: correctionCycle.cycleId, actorId, command: command('cycleTransition', {
          toState: 'READY_TO_ISSUE', reason: null, expectedRevision: 1, idempotencyKey: randomUUID()
        }) }));
      await assert.rejects(() => coordinator.write(scopes(organizationId), client => repository.documentRecord(client,
        { organizationId, cycleId: correctionCycle.cycleId, actorId, command: command('documentRecord', {
          ...documentInput, externalDocumentId: 'duplicate-number', issueDate: '2027-01-05', dueDate: '2027-02-04',
          subtotal: '80', taxTotal: '20', total: '100', expectedCycleRevision: 2, idempotencyKey: randomUUID()
        }) })), error => error.code === '23505');
      const correctionInvoice = await coordinator.write(scopes(organizationId), client => repository.documentRecord(client,
        { organizationId, cycleId: correctionCycle.cycleId, actorId, command: command('documentRecord', {
          ...documentInput, documentNumber: 'FT GATE/2027/1', externalDocumentId: 'gate-document-2',
          issueDate: '2027-01-05', dueDate: '2027-02-04', subtotal: '80', taxTotal: '20', total: '100',
          expectedCycleRevision: 2, idempotencyKey: randomUUID()
        }) }));
      const credit = await coordinator.write(scopes(organizationId), client => repository.documentRecord(client,
        { organizationId, cycleId: correctionCycle.cycleId, actorId, command: command('documentRecord', {
          ...documentInput, documentType: 'CREDIT_NOTE', documentNumber: 'NC GATE/2027/1',
          externalDocumentId: 'gate-credit-1', issueDate: '2027-01-10', dueDate: '2027-01-10',
          subtotal: '80', taxTotal: '20', total: '100', correctsDocumentId: correctionInvoice.documentId,
          expectedCycleRevision: 3, idempotencyKey: randomUUID()
        }) }));
      assert.equal(credit.cycleState, 'CREDITED');
      const cancelledCredit = await coordinator.write(scopes(organizationId), client => repository.documentTransition(client,
        { organizationId, documentId: credit.documentId, actorId, command: command('documentTransition', {
          toState: 'CANCELLED', reason: 'Nota de crédito anulada no sistema fiscal', expectedRevision: 1,
          idempotencyKey: randomUUID()
        }) }));
      assert.equal(cancelledCredit.cycleState, 'ISSUED');

      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM public.billing_account WHERE organization_id=$1', [organizationId])).rows[0].count, 1);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM public.billing_account_version WHERE organization_id=$1', [organizationId])).rows[0].count, 2);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM public.billing_cycle_revision WHERE organization_id=$1', [organizationId])).rows[0].count, 9);
      assert.equal((await pool.query('SELECT state FROM public.billing_cycle_revision WHERE billing_cycle_id=$1 ORDER BY revision DESC LIMIT 1', [cycle.cycleId])).rows[0].state, 'ISSUED');
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM public.billing_fiscal_document WHERE organization_id=$1', [organizationId])).rows[0].count, 3);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM public.billing_payment_record WHERE organization_id=$1', [organizationId])).rows[0].count, 4);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM public.billing_activity WHERE organization_id=$1', [organizationId])).rows[0].count, 15);
      assert.equal((await pool.query('SELECT count(*)::integer AS count FROM public.billing_command_receipt WHERE organization_id=$1', [organizationId])).rows[0].count, 15);
      assert.equal((await pool.query("SELECT count(*)::integer AS count FROM audit.event WHERE event_code LIKE 'PLATFORM_BILLING_%'", [])).rows[0].count, 15);

      const billingService = require('../../../backend/src/platformBilling/service').createPlatformBillingService({
        coordinator, centralPool: pool, today: () => '2028-01-01'
      });
      const request = { sessionID: sessionId, authContext: { sessionId }, user: { id: actorId } };
      const summary = await billingService.summary({}, request);
      assert.deepEqual(summary.currencies, [{ currency: 'EUR', billedAmount: '1400', receivedAmount: '1300',
        outstandingAmount: '100', overdueAmount: '100', documentCount: 2, organizationsWithBalance: 1 }]);
      const listed = await billingService.cycles({ organizationId, currency: 'EUR', page: '1' }, request);
      assert.equal(listed.total, 2);
      assert.deepEqual(listed.items.map(item => item.cycleId), [correctionCycle.cycleId, cycle.cycleId]);
      assert.equal((await billingService.cycles({ paymentStatus: 'PAID' }, request)).items[0].cycleId, cycle.cycleId);
      assert.equal((await billingService.cycles({ overdue: 'true' }, request)).items[0].cycleId, correctionCycle.cycleId);
      const detail = await billingService.cycleDetail(cycle.cycleId, {}, request);
      assert.equal(detail.balanceAmount, '0');
      assert.equal(detail.paymentState, 'PAID');
      assert.equal(detail.documents.length, 1);
      assert.equal(detail.payments.length, 4);
      assert.equal(detail.timeline.length, 8);
      const auditBeforeRejections = (await pool.query(
        "SELECT count(*)::integer AS count FROM audit.event WHERE event_code LIKE 'PLATFORM_BILLING_%'"
      )).rows[0].count;
      await assert.rejects(() => billingService.cycleTransition(cycle.cycleId, {
        toState: 'CANCELLED', reason: 'Invalid transition probe', expectedRevision: detail.cycleRevision,
        idempotencyKey: randomUUID()
      }, request), error => error.code === 'CYCLE_TRANSITION_NOT_ALLOWED');
      await assert.rejects(() => billingService.cycleTransition(cycle.cycleId, {
        toState: 'CANCELLED', reason: 'Stale transition probe', expectedRevision: 1,
        idempotencyKey: randomUUID()
      }, request), error => error.code === 'STALE_REVISION');
      await assert.rejects(() => billingService.paymentRecord(document.documentId, {
        amount: '1', currency: 'EUR', paidOn: '2026-01-23', methodCode: 'BANK_TRANSFER',
        externalReference: 'GATE-EXCESS-PAYMENT', note: null, idempotencyKey: randomUUID()
      }, request), error => error.code === '23514' && error.message.includes('BILLING_PAYMENT_EXCEEDS_BALANCE'));
      const rejectionEvents = (await pool.query(`SELECT event_data->>'decision' AS decision,
        event_data->>'outcome' AS outcome,event_data->'payload'->>'detailCode' AS detail_code
        FROM audit.event WHERE event_data->'payload'->>'detailCode' IN
         ('CYCLE_TRANSITION_NOT_ALLOWED','STALE_REVISION','BILLING_PAYMENT_EXCEEDS_BALANCE')
        ORDER BY accepted_at DESC,event_id DESC LIMIT 3`)).rows;
      assert.equal((await pool.query(
        "SELECT count(*)::integer AS count FROM audit.event WHERE event_code LIKE 'PLATFORM_BILLING_%'"
      )).rows[0].count, auditBeforeRejections + 3);
      assert.deepEqual(new Set(rejectionEvents.map(event => event.detail_code)),
        new Set(['CYCLE_TRANSITION_NOT_ALLOWED', 'STALE_REVISION', 'BILLING_PAYMENT_EXCEEDS_BALANCE']));
      assert.equal(rejectionEvents.every(event => event.decision === 'ACCEPT'
        && ['REFUSED', 'CONFLICT'].includes(event.outcome)), true);
      const accountDetail = await billingService.accountDetail(organizationId, {}, request);
      assert.equal(accountDetail.account.revision, 2);
      assert.equal(accountDetail.account.version.billingEmail, 'billing-v2@example.invalid');
      assert.equal((await billingService.accountDetail(rollbackOrganizationId, {}, request)).account, null);

      const debit = await coordinator.write(scopes(organizationId), client => repository.documentRecord(client,
        { organizationId, cycleId: correctionCycle.cycleId, actorId, command: command('documentRecord', {
          ...documentInput, documentType: 'DEBIT_NOTE', documentNumber: 'ND GATE/2027/1',
          externalDocumentId: 'gate-debit-1', issueDate: '2027-01-12', dueDate: '2027-01-12',
          subtotal: '40', taxTotal: '10', total: '50', correctsDocumentId: correctionInvoice.documentId,
          expectedCycleRevision: cancelledCredit.cycleRevision, idempotencyKey: randomUUID()
        }) }));
      await coordinator.write(scopes(organizationId), client => repository.paymentRecord(client,
        { organizationId, documentId: correctionInvoice.documentId, actorId, command: command('paymentRecord', {
          amount: '150', currency: 'EUR', paidOn: '2027-01-13', methodCode: 'BANK_TRANSFER',
          externalReference: 'GATE-DEBIT-PAYMENT', note: null, idempotencyKey: randomUUID()
        }) }));
      await assert.rejects(() => coordinator.write(scopes(organizationId), client => client.query(
        billingSql.transitionDocument, [debit.documentId, organizationId, 'CANCELLED', actorId, 1]
      )), error => error.code === '23514' && error.message.includes('BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE'));
      await assert.rejects(() => coordinator.write(scopes(organizationId), client => repository.documentTransition(client,
        { organizationId, documentId: debit.documentId, actorId, command: command('documentTransition', {
          toState: 'CANCELLED', reason: 'Debit note cancelled externally', expectedRevision: 1,
          idempotencyKey: randomUUID()
        }) })), error => error.code === 'BILLING_DEBIT_CANCELLATION_EXCEEDS_BALANCE');
      assert.equal((await pool.query('SELECT state FROM public.billing_fiscal_document WHERE id=$1',
        [debit.documentId])).rows[0].state, 'ISSUED');

      await pool.query('ALTER TABLE public.billing_cycle DISABLE TRIGGER USER');
      try {
        for (let index = 0; index < 26; index += 1) {
          await pool.query(`INSERT INTO public.billing_cycle(id,organization_id,account_version_id,period_start,period_end,
            service_description,currency,amount,due_date,contract_reference,created_by,updated_by)
            VALUES($1,$2,$3,'2029-01-01','2029-01-31','Paginação','EUR',1,'2029-02-15',$4,$5,$5)`,
          [randomUUID(), organizationId, account.accountVersionId, `PAGE-GATE-${String(index).padStart(2, '0')}`, actorId]);
        }
      } finally {
        await pool.query('ALTER TABLE public.billing_cycle ENABLE TRIGGER USER');
      }
      const pageOne = await billingService.cycles({ q: 'PAGE-GATE', page: '1' }, request);
      const pageTwo = await billingService.cycles({ q: 'PAGE-GATE', page: '2' }, request);
      const repeatedPageOne = await billingService.cycles({ q: 'PAGE-GATE', page: '1' }, request);
      assert.deepEqual({ total: pageOne.total, first: pageOne.items.length, second: pageTwo.items.length },
        { total: 26, first: 25, second: 1 });
      assert.deepEqual(repeatedPageOne.items.map(item => item.cycleId), pageOne.items.map(item => item.cycleId));
      assert.equal(new Set([...pageOne.items, ...pageTwo.items].map(item => item.cycleId)).size, 26);

      const billingRouter = require('../../../backend/src/platformBilling/http').createPlatformBillingRouter({
        express, service: billingService, authenticate(httpRequest, response, next) {
          httpRequest.sessionID = sessionId;
          httpRequest.authContext = { sessionId };
          httpRequest.user = { id: httpRequest.headers['x-forged-actor'] || actorId };
          next();
        }
      });
      const httpApp = express();
      httpApp.use('/api/admin/billing', express.json({ limit: '64kb' }), billingRouter);
      const httpServer = httpApp.listen(0, '127.0.0.1');
      await new Promise(resolve => httpServer.once('listening', resolve));
      try {
        const httpRoot = `http://127.0.0.1:${httpServer.address().port}/api/admin/billing`;
        const httpSummary = await fetch(`${httpRoot}/summary?currency=EUR`);
        assert.equal(httpSummary.status, 200);
        assert.equal((await httpSummary.json()).currencies[0].outstandingAmount, '0');
        const createdResponse = await fetch(`${httpRoot}/cycles`, { method: 'POST', headers: {
          'content-type': 'application/json'
        }, body: JSON.stringify({
          organizationId, accountVersionId: account.accountVersionId, periodStart: '2031-01-01',
          periodEnd: '2031-01-31', serviceDescription: 'Ciclo HTTP', currency: 'EUR', amount: '50',
          plannedIssueDate: '2031-01-05', dueDate: '2031-02-05', contractReference: 'HTTP-GATE-2031',
          notes: null, idempotencyKey: randomUUID()
        }) });
        assert.equal(createdResponse.status, 201);
        const httpCycle = await createdResponse.json();
        const editedResponse = await fetch(`${httpRoot}/cycles/${httpCycle.cycleId}`, { method: 'PUT', headers: {
          'content-type': 'application/json'
        }, body: JSON.stringify({
          expectedRevision: 1, accountVersionId: account.accountVersionId, periodStart: '2031-01-01',
          periodEnd: '2031-01-31', serviceDescription: 'Ciclo HTTP editado', currency: 'EUR', amount: '55',
          plannedIssueDate: '2031-01-05', dueDate: '2031-02-05', contractReference: 'HTTP-GATE-2031',
          notes: null, idempotencyKey: randomUUID()
        }) });
        assert.equal(editedResponse.status, 200);
        assert.equal((await editedResponse.json()).revision, 2);
        const httpDetail = await fetch(`${httpRoot}/cycles/${httpCycle.cycleId}`);
        assert.equal(httpDetail.status, 200);
        assert.equal((await httpDetail.json()).cycleAmount, '55');
        assert.equal((await fetch(`${httpRoot}/cycles?unexpected=true`, { method: 'POST', headers: {
          'content-type': 'application/json'
        }, body: '{}' })).status, 400);
        assert.equal((await fetch(`${httpRoot}/summary`, { headers: { 'x-forged-actor': randomUUID() } })).status, 403);
        assert.equal((await fetch(`${httpRoot}/unknown`)).status, 405);
      } finally {
        await new Promise(resolve => httpServer.close(resolve));
      }

      const runtimeRead = await pool.connect();
      try {
        await runtimeRead.query('BEGIN READ ONLY');
        await runtimeRead.query('SET LOCAL ROLE c4g_central_runtime');
        assert.equal((await runtimeRead.query(billingSql.summary,
          [null, null, null, '2028-01-01'])).rows[0].outstanding_amount, '0.000000');
        await runtimeRead.query('ROLLBACK');
      } finally {
        runtimeRead.release();
      }

      const failingRepository = createPlatformBillingRepository({ audit: async () => { throw Object.assign(new Error('F7 unavailable'), { code: 'AUDIT_FAILURE' }); } });
      await assert.rejects(() => coordinator.write(scopes(rollbackOrganizationId), client => failingRepository.accountWrite(client,
        { organizationId: rollbackOrganizationId, actorId, command: command('accountWrite', { ...accountInput, idempotencyKey: randomUUID() }) })),
      error => error.code === 'AUDIT_FAILURE');
      for (const table of ['billing_account', 'billing_account_version', 'billing_activity', 'billing_command_receipt']) {
        assert.equal((await pool.query(`SELECT count(*)::integer AS count FROM public.${table} WHERE organization_id=$1`, [rollbackOrganizationId])).rows[0].count, 0);
      }
      await assert.rejects(
        () => coordinator.write([`ORG:${randomUUID()}`], client => client.query(billingSql.insertAccount, [randomUUID(), organizationId])),
        error => error?.message?.includes('AUTHORITY_COORDINATOR_REQUIRED')
      );
    } finally {
      await authorityPool.end();
    }

    const result = {
      version,
      irreversible: true,
      acceptsHistoricalCrlfChecksum: false,
      schemaFingerprint: observedSchema,
      authoritySecurityFingerprint: observedSecurity,
      upChecksum: migrations.migrationChecksumPolicy(up).checksum,
      tables: tables.length,
      authorityTriggers: triggerCount,
      emptyBeforeFixture: true,
      coordinatedWrite: true,
      repositoryAccountAndCycle: true,
      repositoryDocumentsPaymentsAndReversals: true,
      externalCreditAndCancellation: true,
      idempotencyAndCas: true,
      paymentRaceAndExactBalance: true,
      duplicateDocumentAndExcessReversalDenied: true,
      debitCancellationOverpaymentDenied: true,
      readOnlySummaryListDetailAndAccount: true,
      centralRuntimeReadProjection: true,
      stableReadPagination: true,
      administrativeHttp: true,
      rejectedCommandsAudited: true,
      atomicTimelineAuditReceipt: true,
      wrongOrganizationScopeDenied: true
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
})().catch(error => {
  console.error(error.code || error.name, error.message);
  process.exitCode = 1;
});
