'use strict';
// Isolated gate for Central package 051_email_templates. It creates its own
// PostgreSQL 18 cluster under .tmp on a free loopback port, applies the Central
// migrations to it and stops it. It never connects to an existing database.
//
//   node test/integration/email-templates/gate.cjs
//   EMAIL_GATE_MEMBER_VARIANT=1  also applies the member_email_delivery patch first
//   EMAIL_GATE_CALIBRATE=1       applies the SQL directly and prints the fingerprints to pin
const fs = require('node:fs'), path = require('node:path'), net = require('node:net');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../../..');
const bin = process.env.EMAIL_GATE_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const base = path.join(root, '.tmp', 'email-templates-pg-' + Date.now());
const run = (name, args) => execFileSync(path.join(bin, name + '.exe'), args, { windowsHide: true, stdio: 'ignore', timeout: 120000 });

function freePort() {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

(async () => {
  fs.mkdirSync(base, { recursive: true });
  const port = await freePort();
  const data = path.join(base, 'data');
  let started = false;
  try {
    run('initdb', ['-D', data, '-U', 'c4g_f12_admin', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
    run('pg_ctl', ['-D', data, '-l', path.join(base, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    started = true;
    const { Pool } = require('../../../backend/node_modules/pg');
    const pool = new Pool({ host: '127.0.0.1', port, user: 'c4g_f12_admin', database: 'postgres' });
    try {
      await require('./probe.cjs').run({ pool, base, port });
    } finally {
      await pool.end();
    }
    console.log(JSON.stringify({ pass: true, evidence: base }));
  } finally {
    if (started && fs.existsSync(path.join(data, 'postmaster.pid'))) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  }
})().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
});
