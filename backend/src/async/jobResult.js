const { OUTCOMES } = require('./constants');
const BRAND = Symbol('trustedJobResult');
function result(code, detailCode = null) { if (!OUTCOMES.includes(code) || (detailCode !== null && !/^[A-Z][A-Z0-9_]{0,63}$/.test(detailCode))) throw new TypeError('Job result is invalid.'); return Object.freeze({ [BRAND]:true, code, detailCode }); }
function classify(value) { return value && value[BRAND] === true && OUTCOMES.includes(value.code) ? value : result('PERMANENT','UNTRUSTED_FAILURE'); }
function isTrustedResult(value,code=null){return Boolean(value&&value[BRAND]===true&&OUTCOMES.includes(value.code)&&(code===null||value.code===code));}
module.exports = { classify, isTrustedResult, result };
