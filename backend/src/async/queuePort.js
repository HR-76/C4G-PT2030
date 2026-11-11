const METHODS = Object.freeze(['publish','claim','heartbeat','complete','fail','cancel','deadLetter','getState','shutdown']);
function assertQueuePort(port) { if (!port || METHODS.some(m=>typeof port[m] !== 'function')) throw new TypeError('QueuePort contract is incomplete.'); return port; }
module.exports = { METHODS, assertQueuePort };
