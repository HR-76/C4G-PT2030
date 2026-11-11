'use strict';
// Defence in depth for this harness, not a general hostile-code sandbox.
const deny = () => { throw new Error('G2_OFFLINE_NETWORK_DISABLED'); };
for (const [name, methods] of Object.entries({
  'node:http':['request','get','createServer'],
  'node:https':['request','get','createServer'],
  'node:http2':['connect','createServer','createSecureServer'],
  'node:net':['connect','createConnection','createServer'],
  'node:tls':['connect','createServer'],
  'node:dgram':['createSocket'],
  'node:dns':['lookup','resolve','resolve4','resolve6'],
})) {
  const mod=require(name);
  for (const method of methods) mod[method]=deny;
}
require('node:net').Socket.prototype.connect=deny;
globalThis.fetch=deny;
if (globalThis.WebSocket) globalThis.WebSocket=class { constructor(){deny();} };
require('node:module').syncBuiltinESMExports();
