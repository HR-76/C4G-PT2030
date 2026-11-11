'use strict';
const { types: { isProxy } } = require('node:util');
function isPlain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && !isProxy(value) && Object.getPrototypeOf(value) === Object.prototype; }
function cloneFreeze(value) { if (Array.isArray(value)) return Object.freeze(value.map(cloneFreeze)); if (isPlain(value)) { const out = {}; for (const key of Reflect.ownKeys(value)) out[key] = cloneFreeze(value[key]); return Object.freeze(out); } return value; }
module.exports = { cloneFreeze, isPlain };
