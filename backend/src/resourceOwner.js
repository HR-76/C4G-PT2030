'use strict';

function createResourceOwner() {
  const resources = new Map();
  let closing;
  function own(resource, dispose) {
    if (closing) throw new Error('RESOURCE_OWNER_CLOSING');
    if (resources.has(resource)) return resources.get(resource);
    let result;
    const close = () => result ||= Promise.resolve().then(dispose);
    resources.set(resource, close);
    return close;
  }
  function close() {
    return closing ||= (async () => {
      const failures = [];
      for (const dispose of [...resources.values()].reverse()) {
        try { await dispose(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'OWNED_RESOURCE_CLOSE_FAILED');
    })();
  }
  return Object.freeze({own, close});
}
module.exports = {createResourceOwner};
