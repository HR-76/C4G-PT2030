const METHODS = Object.freeze(['beginWrite', 'write', 'beginMultipart', 'writePart', 'commit', 'abort', 'abortMultipartSession', 'head', 'readRange', 'createDownloadCapability', 'health', 'shutdown']);
function assertObjectStoragePort(port) {
  if (!port || METHODS.some(method => typeof port[method] !== 'function') || Reflect.ownKeys(port).some(key => !METHODS.includes(key))) throw new TypeError('ObjectStoragePort contract is incomplete or open.');
  return port;
}
module.exports = { METHODS, assertObjectStoragePort };
