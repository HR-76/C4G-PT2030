'use strict';

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { createConnection } = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../../../frontend/test-harness/node_modules/playwright');

function samplePdf() {
  const content = 'BT /F1 16 Tf 36 72 Td (C4G - Documento de teste) Tj ET\n';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return String(offset).padStart(10, '0') + ' 00000 n \n';
  });
  return Buffer.from(pdf + `xref\n0 6\n0000000000 65535 f \n${offsets.join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${pdf.length}\n%%EOF\n`);
}

async function verifiedPdf() {
  const bytes = samplePdf();
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  const report = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: 3310 });
    let output = '';
    socket.setTimeout(10000, () => socket.destroy(new Error('ClamAV scan timed out')));
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(Buffer.concat([Buffer.from('zINSTREAM\0'), length, bytes, Buffer.alloc(4)])));
    socket.on('data', chunk => {
      output += chunk;
      if (output.includes('\0')) {
        socket.destroy();
        resolve(output.replace(/\0$/, ''));
      }
    });
    socket.on('end', () => resolve(output.trim()));
    socket.on('error', reject);
  });
  assert.equal(report, 'stream: OK');
  return { size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') };
}

async function run({ base, uiOrigin, tenant, actor, http, failures }) {
  const { org, pool } = tenant;
  const sharedGrants = ['application.read', 'opportunity.read', 'document.read', 'notification.read'];
  const requester = await actor(org, [...sharedGrants, 'application.create', 'application.edit', 'document.version.list'],
    { profileCode: 'ORG_ADMIN', displayName: 'Gestor de teste' });
  const reviewer = await actor(org, [...sharedGrants, 'application.review.decide'],
    { profileCode: 'CONTRIBUTOR', displayName: 'Técnico de teste' });
  const root = '/api/applications';
  const ok = async (promise, status = 200) => {
    const result = await promise;
    assert.equal(result.status, status, JSON.stringify({ result, failures: failures.slice(-2) }));
    return result.data;
  };

  const title = 'Candidatura de teste — revisão atribuída';
  const { applicationId } = await ok(http(requester, root, 'POST', {
    opportunityId: tenant.seed.opportunityId, evaluationId: null, title,
    responsibleMembershipId: requester.membershipId, deadline: '2027-12-31', idempotencyKey: randomUUID()
  }), 201);
  const appApi = root + '/' + applicationId;
  const { revision } = await ok(http(requester, appApi + '/work'));
  await ok(http(requester, appApi + '/work/participants', 'POST', {
    membershipId: reviewer.membershipId, expectedRevision: revision, idempotencyKey: randomUUID()
  }));

  const { size, hash } = await verifiedPdf();
  const documentId = randomUUID();
  const versionId = randomUUID();
  const filename = 'revisao-de-teste.pdf';
  await pool.query(`INSERT INTO document_storage.document
    (document_id,organization_id,resource_type,resource_id,created_by_actor_id,correlation_id)
    VALUES($1,$2,'APPLICATION',$3,$4,$5)`, [documentId, org, applicationId, requester.id, randomUUID()]);
  await pool.query(`INSERT INTO document_storage.document_version
    (version_id,document_id,organization_id,version_number,object_id,storage_class,expected_size,expected_file_class,
     expected_sha256,observed_size,declared_mime,detected_mime,display_filename,sha256,state,scan_state,idempotency_key,correlation_id,created_by_actor_id)
    VALUES($1,$2,$3,1,$4,'DOCUMENTS',$5,'PDF',$6,$5,'application/pdf','application/pdf',$7,$6,'AVAILABLE','CLEAN',$8,$9,$10)`,
  [versionId, documentId, org, randomUUID(), size, hash, filename, randomUUID(), randomUUID(), requester.id]);
  console.log('ASSIGNED_REVIEW_PDF_CLAMAV_CLEAN');

  const frontend = path.resolve(__dirname, '../../../frontend');
  const { createServer } = await import(pathToFileURL(path.join(frontend, 'node_modules/vite/dist/node/index.js')).href);
  const vite = await createServer({
    root: frontend, configFile: path.join(frontend, 'vite.config.js'), logLevel: 'error',
    server: { host: 'localhost', port: Number(new URL(uiOrigin).port), strictPort: true, proxy: { '/api': { target: base, changeOrigin: true } } }
  });
  let browser;
  try {
    await vite.listen();
    browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const open = async user => {
      const context = await browser.newContext();
      const value = decodeURIComponent(user.cookie.slice(user.cookie.indexOf('=') + 1));
      await context.addCookies([{ name: 'c4g_session_dev', value, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
      const page = await context.newPage();
      page.setDefaultTimeout(25000);
      return page;
    };
    const act = async (page, method, pathname, trigger) => {
      const [response] = await Promise.all([
        page.waitForResponse(response => response.request().method() === method && new URL(response.url()).pathname === pathname),
        trigger()
      ]);
      const body = await response.json();
      assert(response.ok(), JSON.stringify({ pathname, status: response.status(), body, failures: failures.slice(-2) }));
      return body;
    };

    const manager = await open(requester);
    await manager.goto(uiOrigin + '/candidaturas/' + applicationId);
    await manager.getByRole('tab', { name: 'Documentos' }).click();
    await manager.getByLabel('Versão disponível').selectOption(versionId);
    await act(manager, 'POST', appApi + '/documents/links', () => manager.getByRole('button', { name: 'Associar versão' }).click());
    const eligible = await act(manager, 'GET', appApi + '/documents/reviewers',
      () => manager.getByRole('button', { name: 'Consultar revisores elegíveis' }).click());
    assert(eligible.items.some(item => item.membershipId === reviewer.membershipId), 'The test technician must be eligible');
    await manager.getByRole('combobox', { name: /^Revisor/ }).selectOption(reviewer.membershipId);
    const request = await act(manager, 'POST', appApi + '/documents/reviews',
      () => manager.getByRole('button', { name: 'Solicitar revisão do conjunto atual' }).click());
    assert.equal(request.reviewerMembershipId, reviewer.membershipId);
    assert.equal(request.documents[0].versionId, versionId);

    const technician = await open(reviewer);
    const dashboard = uiOrigin + '/dashboard';
    const pending = technician.getByRole('region', { name: 'Revisões atribuídas a mim' });
    const reviewLink = pending.getByRole('link', { name: new RegExp(title) });
    const before = await act(technician, 'GET', root + '/assigned-reviews', () => technician.goto(dashboard));
    assert.deepEqual(before.items.map(item => item.requestId), [request.requestId]);
    await reviewLink.waitFor();
    console.log('ASSIGNED_REVIEW_VISIBLE_IN_TECHNICIAN_DASHBOARD');

    await reviewLink.click();
    const review = technician.locator('#revisao-' + request.requestId);
    const comment = 'Aprovação do documento sintético no ensaio local.';
    await review.getByLabel('Comentário').fill(comment);
    const decision = await act(technician, 'POST', appApi + '/documents/reviews/decide',
      () => review.getByRole('button', { name: 'Registar decisão' }).click());
    assert.equal(decision.decision, 'APPROVED');
    await review.getByText(comment, { exact: true }).waitFor();
    const saved = await pool.query(`SELECT decision, decided_by_subject_id FROM opportunity_catalog.application_review_decision
      WHERE organization_id=$1 AND application_id=$2 AND request_id=$3`, [org, applicationId, request.requestId]);
    assert.deepEqual(saved.rows, [{ decision: 'APPROVED', decided_by_subject_id: reviewer.id }]);

    const after = await act(technician, 'GET', root + '/assigned-reviews', () => technician.goto(dashboard));
    assert.deepEqual(after.items, []);
    await pending.getByText('Sem revisões pendentes atribuídas a si.').waitFor();
    assert.equal(await reviewLink.count(), 0);
    console.log('ASSIGNED_REVIEW_DECISION_PERSISTED_AND_REMOVED_FROM_DASHBOARD');
  } finally {
    await browser?.close();
    await vite.close();
  }
}

module.exports = { run };
