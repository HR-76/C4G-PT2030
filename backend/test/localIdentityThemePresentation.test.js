'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const footer = fs.readFileSync(path.join(root, 'dev/keycloak/themes/c4g/login/footer.ftl'), 'utf8');
const css = fs.readFileSync(path.join(root, 'dev/keycloak/themes/c4g/login/resources/css/c4g.css'), 'utf8');
const theme = fs.readFileSync(path.join(root, 'dev/keycloak/themes/c4g/login/theme.properties'), 'utf8');

test('login recovery guidance and accessible messages use European Portuguese', () => {
  assert.match(footer, /Esqueci-me da palavra-passe/);
  assert.match(footer, /Não partilhe a sua palavra-passe/);
  const messages = fs.readFileSync(path.join(root, 'dev/keycloak/themes/c4g/login/messages/messages_pt.properties'), 'utf8');
  for (const entry of ['loginAccountTitle=Entre na sua conta', 'username=Nome de utilizador',
    'password=Palavra-passe', 'doLogIn=Entrar', 'showPassword=Mostrar palavra-passe',
    'hidePassword=Ocultar palavra-passe', 'invalidUserMessage=Nome de utilizador ou palavra-passe inválidos.']) {
    assert.ok(messages.split(/\r?\n/).includes(entry), entry);
  }
});

test('login orbit uses the approved funding journey without invented metrics', () => {
  for (const text of ['Catálogo central', 'Matching explicável', 'Candidaturas', 'Equipa e prazos']) {
    assert.match(footer, new RegExp(text));
  }
  assert.match(footer, /class="c4g-funding-orbit" aria-hidden="true"/);
  assert.doesNotMatch(footer, /<ul class="c4g-login-capabilities"/);
  assert.doesNotMatch(footer, /400\+|24\/7|motores IA|AI CORE/i);
  assert.doesNotMatch(footer, /<script/i);
});

test('login orbit is CSS-only, responsive and honours reduced motion', () => {
  assert.match(css, /@keyframes c4g-orbit-spin/);
  assert.match(css, /\.c4g-login-story-content \{[^}]*max-width: none;/s);
  assert.match(css, /--orbit-size: clamp\(320px, 30vw, 420px\)/);
  assert.match(css, /max-width: 560px; margin: 0 auto;/);
  assert.match(theme, /styles=css\/login\.css css\/c4g\.css\?v=\d{8}\.\d+/);
  assert.match(css, /overflow-x: hidden; overflow-x: clip;/);
  assert.match(css, /width: 100vw; margin: 56px calc\(50% - 50vw\) 0;/);
  assert.match(css, /--orbit-size: min\(82vw, 330px\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.c4g-orbit-ring, \.c4g-orbit-core \{ animation: none; \}/);
  assert.doesNotMatch(css, /url\([^)]*https?:/i);
});
