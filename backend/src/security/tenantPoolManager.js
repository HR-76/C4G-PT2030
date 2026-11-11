const { validatePolicy } = require('./tenantPoolPolicy');
const { tenantFailure, aggregateCleanup, isTrustedRuntimeFailure } = require('./tenantRuntimeErrors');

function integer(value, name, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} is invalid.`);
  return value;
}

function nowMillis(clock) {
  const value = clock.now();
  const number = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Tenant runtime clock returned an invalid instant.');
  return number;
}

const WORKLOADS = Object.freeze(['API', 'WORKER']);
function workload(value) {
  if (!WORKLOADS.includes(value)) throw new TypeError('Tenant workload is invalid.');
  return value;
}

function createTenantPoolManager({ poolFactory, policy, clock, scheduler, jitter }) {
  if (typeof poolFactory !== 'function' || !clock || !scheduler
      || typeof scheduler.setTimeout !== 'function' || typeof scheduler.clearTimeout !== 'function'
      || typeof jitter !== 'function') throw new TypeError('Tenant pool manager dependencies are incomplete.');
  const limits = validatePolicy(policy);
  const entries = new Map();
  const creating = new Map();
  const fences = new Map();
  const publishedVersions = new Map();
  const deniedKeys = new Set();
  const blockedScopes = new Set();
  const versionLifecycle = new Map();
  const circuits = new Map();
  const activeByTenant = new Map();
  const capacityTasks = new Set();
  const credentialDisposals = new Set();
  const credentialCleanupTimeouts = new Set();
  const credentialCleanupErrors = new Set();
  const clientCleanups = new Set();
  const physicalObservers = new Set();
  const queue = [];
  let active = 0;
  let closed = false;
  const backgroundCleanupErrors = new Set();

  const scopeFor = (tenantId, workloadValue) => `${tenantId}:${workload(workloadValue)}`;
  const circuitScopeFor = (tenantId, workloadValue, connectionVersion) =>
    `${scopeFor(tenantId, workloadValue)}:${integer(connectionVersion, 'connectionVersion', 1)}`;
  const keyFor = (tenantId, workloadValue, connectionVersion) => `${scopeFor(tenantId, workloadValue)}:${connectionVersion}`;
  const fenceFor = (tenantId, workloadValue) => fences.get(scopeFor(tenantId, workloadValue)) || 0;
  function capacity(task) {
    if ((activeByTenant.get(task.tenantId) || 0) >= limits.perTenantLimit) return false;
    const ceiling = task.workloadClass === 'OPERATIONAL'
      ? limits.globalLimit : limits.globalLimit - limits.operationalReserve;
    return active < ceiling;
  }
  function queueCapacity(tenantId, workloadClass) {
    const globalCeiling = workloadClass === 'OPERATIONAL'
      ? limits.globalQueueLimit : limits.globalQueueLimit - limits.operationalQueueReserve;
    if (queue.length >= globalCeiling) return false;
    return queue.filter(task => task.tenantId === tenantId).length < limits.perTenantQueueLimit;
  }
  function circuitFor(tenantId, workloadValue, connectionVersion) {
    const scope=circuitScopeFor(tenantId,workloadValue,connectionVersion);
    if (!circuits.has(scope)) circuits.set(scope, { failures: 0, nextAttemptAt: 0, openedUntil: 0, halfOpen: false });
    return circuits.get(scope);
  }
  function assertCircuit(task) {
    const circuit = circuitFor(task.tenantId, task.workload, task.connectionVersion);
    const now = nowMillis(clock);
    if (circuit.openedUntil > now) throw tenantFailure('CIRCUIT_OPEN', 'TENANT_NOT_AVAILABLE', { correlationId: task.correlationId });
    if (circuit.openedUntil && circuit.openedUntil <= now) {
      if (circuit.halfOpen) throw tenantFailure('CIRCUIT_OPEN', 'TENANT_NOT_AVAILABLE', { correlationId: task.correlationId });
      circuit.halfOpen = true;
    }
    if (circuit.nextAttemptAt > now) {
      throw tenantFailure('RETRY_BACKOFF', 'TENANT_NOT_AVAILABLE', { correlationId: task.correlationId });
    }
  }
  function recordSuccess(tenantId, workloadValue, connectionVersion) {
    Object.assign(circuitFor(tenantId, workloadValue, connectionVersion), { failures: 0, nextAttemptAt: 0, openedUntil: 0, halfOpen: false });
  }
  function recordFailure(tenantId, workloadValue, connectionVersion) {
    const circuit = circuitFor(tenantId, workloadValue, connectionVersion);
    circuit.failures += 1;
    circuit.halfOpen = false;
    const exponent = Math.max(0, circuit.failures - 1);
    const base = Math.min(limits.maxBackoffMs, limits.backoffBaseMs * (2 ** exponent));
    const offset = Number(jitter({ tenantId, failures: circuit.failures, baseMs: base }));
    const delay = Math.max(0, Math.min(limits.maxBackoffMs, base + (Number.isFinite(offset) ? offset : 0)));
    circuit.nextAttemptAt = nowMillis(clock) + delay;
    if (circuit.failures >= limits.circuitFailureThreshold) {
      circuit.openedUntil = nowMillis(clock) + Math.max(limits.circuitResetMs, delay);
    }
  }
  function cleanupFailure(code, correlationId = null) {
    return tenantFailure(code, 'TENANT_OPERATION_UNAVAILABLE', { correlationId });
  }
  function recordBackgroundCleanup(error) {
    backgroundCleanupErrors.add(error);
    return error;
  }
  function recordCredentialCleanup(error) {
    credentialCleanupErrors.add(error);
    return recordBackgroundCleanup(error);
  }
  function sanitizedRuntimeFailure(error, correlationId) {
    return isTrustedRuntimeFailure(error) ? error
      : tenantFailure('TENANT_UNREACHABLE', 'TENANT_NOT_AVAILABLE', { correlationId });
  }
  function validCredentialLease(credentialLease) {
    return credentialLease && typeof credentialLease === 'object' && 'material' in credentialLease
      && typeof credentialLease.dispose === 'function';
  }
  async function disposeCredentialLease(credentialLease, correlationId) {
    if (!credentialLease) return;
    try { await credentialLease.dispose(); }
    catch { throw cleanupFailure('CREDENTIAL_CLEANUP_FAILED', correlationId); }
  }
  function trackCleanup(collection, cleanup) {
    collection.add(cleanup);
    cleanup.then(() => collection.delete(cleanup), () => collection.delete(cleanup));
    return cleanup;
  }
  function trackedCredentialDisposal(credentialLease, correlationId) {
    const cleanup = disposeCredentialLease(credentialLease, correlationId);
    credentialDisposals.add(cleanup);
    const reconcile = () => Promise.resolve().then(() => {
      credentialDisposals.delete(cleanup);
      credentialCleanupTimeouts.delete(cleanup);
    });
    cleanup.then(reconcile, reconcile);
    return cleanup;
  }
  async function disposeTaskCredential(task) {
    const credentialLease = task.credentialLease;
    task.credentialLease = null;
    await trackedCredentialDisposal(credentialLease, task.correlationId);
  }
  function observeRejectedCredentialDisposal(disposal, error) {
    const observer = disposal.catch(cleanup => {
      recordCredentialCleanup(aggregateCleanup(error, cleanup));
    });
    observer.catch(() => {});
  }
  function rejectWithTrackedCredentialDisposal(error, credentialLease, correlationId) {
    observeRejectedCredentialDisposal(trackedCredentialDisposal(credentialLease, correlationId), error);
    return Promise.reject(error);
  }
  function settleTaskRejection(task, error) {
    observeRejectedCredentialDisposal(disposeTaskCredential(task), error);
    task.reject(error);
  }
  function abortPromise(task) {
    return new Promise((resolve, reject) => {
      if (task.abortController.signal.aborted) {
        reject(task.abortReason || cleanupFailure('ACQUIRE_TIMEOUT', task.correlationId));
        return;
      }
      task.abortController.signal.addEventListener('abort', () => reject(
        task.abortReason || cleanupFailure('ACQUIRE_TIMEOUT', task.correlationId)
      ), { once: true });
    });
  }
  function creationAbortPromise(creation) {
    return new Promise((resolve, reject) => {
      if (creation.abortController.signal.aborted) {
        reject(creation.abortReason || cleanupFailure('ACQUIRE_TIMEOUT', creation.correlationId));
        return;
      }
      creation.abortController.signal.addEventListener('abort', () => reject(
        creation.abortReason || cleanupFailure('ACQUIRE_TIMEOUT', creation.correlationId)
      ), { once: true });
    });
  }
  function finishPhysical(task) {
    task.pendingPhysical -= 1;
    if ((task.timedOut || task.cancelled) && task.pendingPhysical === 0) releaseTaskCapacity(task);
  }
  function observePhysical(task, promise, cleanupLate, cleanupCode, signal = task.abortController.signal) {
    task.pendingPhysical += 1;
    task.physicalStarted = true;
    const observer = promise.then(value => {
      if (!signal.aborted) return;
      return Promise.resolve().then(() => cleanupLate(value)).catch(() => {
        recordBackgroundCleanup(cleanupFailure(cleanupCode, task.correlationId));
      });
    }, () => {}).finally(() => finishPhysical(task));
    physicalObservers.add(observer);
    observer.finally(() => physicalObservers.delete(observer));
    return promise;
  }
  async function awaitPhysicalObservers(errors) {
    if (!physicalObservers.size) return;
    let timeout;
    const deadline = new Promise((resolve, reject) => {
      timeout = scheduler.setTimeout(() => reject(cleanupFailure('PHYSICAL_CLEANUP_TIMEOUT')), limits.drainTimeoutMs);
    });
    try { await Promise.race([Promise.all([...physicalObservers]), deadline]); }
    catch (error) { errors.push(error); }
    finally { scheduler.clearTimeout(timeout); }
  }
  async function awaitTrackedCleanup(promises, errors, timeoutCode, onTimeout = null) {
    if (!promises.length) return [];
    let timeout;
    const deadline = new Promise((resolve, reject) => {
      timeout = scheduler.setTimeout(() => reject(cleanupFailure(timeoutCode)), limits.drainTimeoutMs);
    });
    try { return await Promise.race([Promise.allSettled(promises), deadline]); }
    catch (error) {
      if (onTimeout) onTimeout();
      errors.push(error);
      return null;
    }
    finally { scheduler.clearTimeout(timeout); }
  }
  async function createPool(task, creation) {
    const produced = observePhysical(task, Promise.resolve().then(() => poolFactory(Object.freeze({
      tenantId: task.tenantId,
      workload: task.workload,
      connectionVersion: task.connectionVersion,
      credentialMaterial: creation.credentialLease.material,
      signal: creation.abortController.signal
    }))), async latePool => {
      if (latePool && typeof latePool.end === 'function') await latePool.end();
    }, 'POOL_CLEANUP_FAILED', creation.abortController.signal);
    return Promise.race([produced, creationAbortPromise(creation)]);
  }
  async function connectPool(entry, task) {
    const connected = observePhysical(task, Promise.resolve().then(() => entry.pool.connect()),
      lateClient => releaseClient(lateClient, task.abortReason || cleanupFailure('ACQUIRE_TIMEOUT', task.correlationId)),
      'CLIENT_CLEANUP_FAILED');
    return Promise.race([connected, abortPromise(task)]);
  }
  async function closeEntry(entry) {
    if (entry.closed) return;
    if (entry.idleTimer) scheduler.clearTimeout(entry.idleTimer);
    if (entry.drainTimer) scheduler.clearTimeout(entry.drainTimer);
    entry.idleTimer = null;
    entry.drainTimer = null;
    if (entry.closePromise) return entry.closePromise;
    if (!entry.endPromise) {
      const physicalEnd = Promise.resolve().then(() => entry.pool.end()).then(() => {
        entry.closed = true;
        entry.cleanupError = null;
        entries.delete(entry.key);
      }, () => {
        entry.cleanupError = cleanupFailure('POOL_CLEANUP_FAILED');
        throw entry.cleanupError;
      });
      entry.endPromise = physicalEnd;
      physicalEnd.catch(() => {});
      physicalEnd.then(() => {
        if (entry.endPromise === physicalEnd) entry.endPromise = null;
      }, () => {
        if (entry.endPromise === physicalEnd) entry.endPromise = null;
      });
    }
    entry.closePromise = (async () => {
      let timeout;
      const deadline = new Promise((resolve, reject) => {
        timeout = scheduler.setTimeout(() => reject(cleanupFailure('POOL_CLEANUP_TIMEOUT')), limits.drainTimeoutMs);
      });
      try {
        await Promise.race([entry.endPromise, deadline]);
        if(entry.resolveDrain){entry.resolveDrain();entry.resolveDrain=null;entry.rejectDrain=null;}
      } catch (error) {
        if (error?.internalCode === 'POOL_CLEANUP_TIMEOUT') entry.cleanupError = error;
        if(entry.rejectDrain){entry.rejectDrain(error);entry.resolveDrain=null;entry.rejectDrain=null;}
        throw error;
      } finally {
        scheduler.clearTimeout(timeout);
        entry.closePromise = null;
      }
    })();
    return entry.closePromise;
  }
  async function ensureEntry(task) {
    const key = keyFor(task.tenantId, task.workload, task.connectionVersion);
    if (blockedScopes.has(scopeFor(task.tenantId, task.workload)) || deniedKeys.has(key)) {
      throw tenantFailure('CONNECTION_NOT_AVAILABLE', 'TENANT_NOT_AVAILABLE', { correlationId: task.correlationId });
    }
    const existing = entries.get(key);
    if (existing && existing.cleanupError) throw existing.cleanupError;
    if (existing && !existing.closed && !existing.draining) return existing;
    if (existing && existing.draining) throw tenantFailure('CONNECTION_NOT_AVAILABLE', 'TENANT_NOT_AVAILABLE', { correlationId: task.correlationId });
    let creation = creating.get(key);
    if (!creation) {
      creation = { key, correlationId: task.correlationId, credentialLease: task.credentialLease,
        abortController: new AbortController(), abortReason: null, waiters: new Set(), completed: false,
        failureRecorded: false, promise: null };
      task.credentialLease = null;
      creating.set(key, creation);
      creation.promise = (async () => {
        let primary = null;
        try {
          const pool = await createPool(task, creation);
          if (!pool || typeof pool.connect !== 'function' || typeof pool.end !== 'function') {
            const invalid = cleanupFailure('INVALID_POOL_RESULT', task.correlationId);
            if (pool && typeof pool.end === 'function') {
              try { await pool.end(); }
              catch {
                const combined = aggregateCleanup(invalid, cleanupFailure('POOL_CLEANUP_FAILED', task.correlationId));
                recordBackgroundCleanup(combined);
                throw combined;
              }
            }
            throw invalid;
          }
          try {
            await trackedCredentialDisposal(creation.credentialLease, creation.correlationId);
            creation.credentialLease = null;
          } catch (cleanup) {
            creation.credentialLease = null;
            try { await pool.end(); }
            catch {
              const combined = aggregateCleanup(cleanup, cleanupFailure('POOL_CLEANUP_FAILED', task.correlationId));
              recordBackgroundCleanup(combined);
              throw combined;
            }
            throw cleanup;
          }
          const entry = { key, tenantId: task.tenantId, workload: task.workload, connectionVersion: task.connectionVersion,
            pool, active: 0, draining: false, closed: false, idleTimer: null, drainTimer: null,
            closePromise: null, endPromise: null, cleanupError: null,drainCompletion:null,resolveDrain:null,rejectDrain:null };
          if (closed) {
            try { await pool.end(); } catch { throw cleanupFailure('POOL_CLEANUP_FAILED', task.correlationId); }
            throw tenantFailure('POOL_CLOSED', 'TENANT_OPERATION_UNAVAILABLE', { correlationId: task.correlationId });
          }
          entries.set(key, entry);
          creation.completed = true;
          return entry;
        } catch (error) {
          primary = error;
          throw error;
        } finally {
          const credentialLease = creation.credentialLease;
          creation.credentialLease = null;
          try {
            if (credentialLease) {
              try { await trackedCredentialDisposal(credentialLease, creation.correlationId); }
              catch (cleanup) {
                const failure = primary
                  ? aggregateCleanup(sanitizedRuntimeFailure(primary, creation.correlationId), cleanup) : cleanup;
                recordCredentialCleanup(failure);
                throw failure;
              }
            }
          } finally {
            creating.delete(key);
          }
        }
      })();
    }
    creation.waiters.add(task);
    task.creation = creation;
    try {
      const entry = await Promise.race([creation.promise, abortPromise(task)]);
      task.creation = null;
      return entry;
    } catch (error) {
      try { await disposeTaskCredential(task); }
      catch (cleanup) { throw aggregateCleanup(error, cleanup); }
      throw error;
    } finally {
      creation.waiters.delete(task);
      if (!creation.completed && creation.waiters.size === 0 && !creation.abortController.signal.aborted) {
        creation.abortReason = task.abortReason || cleanupFailure('ACQUIRE_TIMEOUT', task.correlationId);
        creation.abortController.abort();
      }
    }
  }
  function scheduleIdle(entry) {
    if (entry.active !== 0 || entry.draining || entry.closed) return;
    if (entry.idleTimer) scheduler.clearTimeout(entry.idleTimer);
    entry.idleTimer = scheduler.setTimeout(async () => {
      entry.idleTimer = null;
      try { await closeEntry(entry); } catch { /* retained on the entry for reconciliation */ }
    }, limits.idleTimeoutMs);
  }
  function settleCapacity(task, delta) {
    active += delta;
    const value = (activeByTenant.get(task.tenantId) || 0) + delta;
    if (value === 0) activeByTenant.delete(task.tenantId); else activeByTenant.set(task.tenantId, value);
  }
  function holdTaskCapacity(task) {
    task.capacityHeld = true;
    capacityTasks.add(task);
    settleCapacity(task, 1);
  }
  function releaseTaskCapacity(task) {
    if (!task.capacityHeld) return;
    settleCapacity(task, -1);
    task.capacityHeld = false;
    capacityTasks.delete(task);
    pump();
  }
  function cancelTask(task, error) {
    if (task.settled) return;
    task.cancelled = true;
    task.settled = true;
    task.abortReason = error;
    scheduler.clearTimeout(task.timeout);
    task.abortController.abort();
    const index = queue.indexOf(task);
    if (index >= 0) queue.splice(index, 1);
    settleTaskRejection(task, error);
    if (task.pendingPhysical === 0) releaseTaskCapacity(task);
  }
  function cancelMatching(predicate, errorFor) {
    for (const task of [...queue, ...capacityTasks]) {
      if (!task.settled && predicate(task)) cancelTask(task, errorFor(task));
    }
  }
  function releaseClient(client, discardReason) {
    if (typeof client.release !== 'function') throw new TypeError('Tenant client has no release operation.');
    return client.release(discardReason || undefined);
  }
  async function executeTask(task) {
    task.dispatched = true;
    holdTaskCapacity(task);
    let entry;
    try {
      assertCircuit(task);
      entry = await ensureEntry(task);
      await disposeTaskCredential(task);
      if (task.timedOut) { scheduleIdle(entry); return; }
      if (entry.idleTimer) { scheduler.clearTimeout(entry.idleTimer); entry.idleTimer = null; }
      if (entry.draining || entry.closed || task.expectedFence !== fenceFor(task.tenantId,task.workload)) {
        throw tenantFailure('TRANSITION_CONFLICT', 'TENANT_NOT_AVAILABLE', { correlationId: task.correlationId });
      }
      const client = await connectPool(entry, task);
      if (task.timedOut || task.cancelled) {
        try { await releaseClient(client, task.abortReason || cleanupFailure('ACQUIRE_TIMEOUT', task.correlationId)); }
        catch { /* caller already received a sanitized timeout; pool remains tracked */ }
        scheduleIdle(entry);
        return;
      }
      if (closed || entry.closed || entry.draining || blockedScopes.has(scopeFor(task.tenantId,task.workload))
          || deniedKeys.has(entry.key) || task.expectedFence !== fenceFor(task.tenantId,task.workload)) {
        const conflict = tenantFailure('TRANSITION_CONFLICT', 'TENANT_NOT_AVAILABLE', { correlationId: task.correlationId });
        try { await releaseClient(client, conflict); }
        catch { throw cleanupFailure('CLIENT_CLEANUP_FAILED', task.correlationId); }
        throw conflict;
      }
      entry.active += 1;
      recordSuccess(task.tenantId, task.workload, task.connectionVersion);
      let released = false;
      const deadline = nowMillis(clock) + limits.leaseTimeoutMs;
      scheduler.clearTimeout(task.timeout);
      task.settled = true;
      task.resolve(Object.freeze({
        client,
        tenantId: task.tenantId,
        workload: task.workload,
        connectionVersion: task.connectionVersion,
        fence: task.expectedFence,
        deadline,
        async release({ discard = false, cause = null } = {}) {
          if (released) throw tenantFailure('LEASE_ALREADY_RELEASED', 'TENANT_OPERATION_UNAVAILABLE', { correlationId: task.correlationId });
          released = true;
          const physicalCleanup = (async () => {
            let releaseError;
            try { await releaseClient(client, discard ? (cause || new Error('Tenant client discarded.')) : null); }
            catch {
              releaseError = cleanupFailure('CLIENT_CLEANUP_FAILED', task.correlationId);
              recordBackgroundCleanup(releaseError);
            }
            entry.active -= 1;
            releaseTaskCapacity(task);
            let poolCleanupError = null;
            if (entry.draining && entry.active === 0) {
              try { await closeEntry(entry); } catch (error) { poolCleanupError = error; }
            } else scheduleIdle(entry);
            pump();
            if (releaseError && poolCleanupError) throw aggregateCleanup(releaseError, poolCleanupError);
            if (releaseError) throw releaseError;
            if (poolCleanupError) throw poolCleanupError;
          })();
          trackCleanup(clientCleanups, physicalCleanup);
          physicalCleanup.catch(() => {});
          let timeout;
          const deadline = new Promise((resolve, reject) => {
            timeout = scheduler.setTimeout(() => reject(cleanupFailure(
              'CLIENT_CLEANUP_TIMEOUT', task.correlationId
            )), limits.drainTimeoutMs);
          });
          try { await Promise.race([physicalCleanup, deadline]); }
          finally { scheduler.clearTimeout(timeout); }
        }
      }));
    } catch (error) {
      try { await disposeTaskCredential(task); }
      catch (cleanup) { error = aggregateCleanup(error, cleanup); }
      if ((!task.timedOut && !task.cancelled) || task.pendingPhysical === 0) releaseTaskCapacity(task);
      if (entry) scheduleIdle(entry);
      if (task.timedOut || task.cancelled) { pump(); return; }
      scheduler.clearTimeout(task.timeout);
      task.settled = true;
      if (!error || !['CIRCUIT_OPEN', 'RETRY_BACKOFF', 'CONNECTION_NOT_AVAILABLE', 'TRANSITION_CONFLICT'].includes(error.internalCode)) {
        if (!task.creation || !task.creation.failureRecorded) {
          recordFailure(task.tenantId, task.workload, task.connectionVersion);
          if (task.creation) task.creation.failureRecorded = true;
        }
      }
      task.reject(sanitizedRuntimeFailure(error, task.correlationId));
      pump();
    }
  }
  function pump() {
    if (closed) return;
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let index = 0; index < queue.length; index += 1) {
        const task = queue[index];
        if (!capacity(task)) continue;
        queue.splice(index, 1);
        executeTask(task);
        progressed = true;
        break;
      }
    }
  }
  function incrementFence(tenantId, workloadValue) {
    const scope=scopeFor(tenantId,workloadValue),next = fenceFor(tenantId,workloadValue) + 1;
    fences.set(scope, next);
    return next;
  }
  function synchronizeFence({tenantId,workload:workloadValue,fence,connectionVersion=null}){
    workload(workloadValue);integer(fence,'fence');const scope=scopeFor(tenantId,workloadValue),current=fenceFor(tenantId,workloadValue);
    if(fence<current)throw tenantFailure('STALE_FENCE','TENANT_NOT_AVAILABLE');
    if(connectionVersion!==null){integer(connectionVersion,'connectionVersion',1);const published=publishedVersions.get(scope);if(fence===current&&published!==undefined&&published!==connectionVersion&&!deniedKeys.has(keyFor(tenantId,workloadValue,published)))throw tenantFailure('STALE_FENCE','TENANT_NOT_AVAILABLE');publishedVersions.set(scope,connectionVersion);}
    fences.set(scope,fence);return fence;
  }
  async function transition(tenantId, workloadValue, connectionVersion, immediate) {
    workload(workloadValue);
    const key = keyFor(tenantId, workloadValue, connectionVersion);
    const targetState = immediate ? 'REVOKED' : 'DRAINING';
    const currentState = versionLifecycle.get(key);
    if (currentState === 'REVOKED' || currentState === targetState) {
      const existing = entries.get(key);
      if (existing && existing.cleanupError) return closeEntry(existing);
      return;
    }
    if (!currentState) incrementFence(tenantId,workloadValue);
    versionLifecycle.set(key, targetState);
    deniedKeys.add(key);
    cancelMatching(task => task.tenantId === tenantId && task.workload === workloadValue && task.connectionVersion === connectionVersion,
      task => tenantFailure('CONNECTION_NOT_AVAILABLE', 'TENANT_NOT_AVAILABLE', { correlationId: task.correlationId }));
    const entry = entries.get(key);
    if (!entry) return;
    entry.draining = true;
    if(!entry.drainCompletion){entry.drainCompletion=new Promise((resolve,reject)=>{entry.resolveDrain=resolve;entry.rejectDrain=reject;});entry.drainCompletion.catch(()=>{});}
    if (entry.idleTimer) scheduler.clearTimeout(entry.idleTimer);
    if (immediate || entry.active === 0) return closeEntry(entry);
    if (!entry.drainTimer) entry.drainTimer = scheduler.setTimeout(async () => {
      entry.drainTimer = null;
      try { await closeEntry(entry); } catch { /* retained on the entry for reconciliation */ }
    }, limits.drainTimeoutMs);
  }

  return Object.freeze({
    acquire({ tenantId, workload:requestedWorkload, connectionVersion, workloadClass, credentialLease, correlationId }) {
      if (!validCredentialLease(credentialLease)) return Promise.reject(new TypeError('Tenant credential lease is invalid.'));
      if (closed) return rejectWithTrackedCredentialDisposal(
        tenantFailure('POOL_CLOSED', 'TENANT_OPERATION_UNAVAILABLE', { correlationId }), credentialLease, correlationId
      );
      const workloadValue=requestedWorkload;
      try { workload(workloadValue);if(credentialLease.workload&&credentialLease.workload!==workloadValue)throw new TypeError('Tenant workload binding is invalid.'); } catch(error) { return rejectWithTrackedCredentialDisposal(error, credentialLease, correlationId); }
      if (typeof tenantId !== 'string' || !Number.isSafeInteger(connectionVersion)
          || !['FUNCTIONAL', 'OPERATIONAL'].includes(workloadClass)) {
        return rejectWithTrackedCredentialDisposal(
          new TypeError('Tenant pool acquisition is invalid.'), credentialLease, correlationId
        );
      }
      const published=publishedVersions.get(scopeFor(tenantId,workloadValue));if(published!==undefined&&published!==connectionVersion)return rejectWithTrackedCredentialDisposal(tenantFailure('CONNECTION_NOT_AVAILABLE','TENANT_NOT_AVAILABLE',{correlationId}),credentialLease,correlationId);
      if (!queueCapacity(tenantId, workloadClass)) {
        return rejectWithTrackedCredentialDisposal(
          tenantFailure('POOL_EXHAUSTED', 'TENANT_OPERATION_UNAVAILABLE', { correlationId }), credentialLease, correlationId
        );
      }
      const expectedFence = fenceFor(tenantId,workloadValue);
      return new Promise((resolve, reject) => {
        const task = { tenantId, workload:workloadValue, connectionVersion, workloadClass, credentialLease, correlationId,
          expectedFence, resolve, reject, timeout: null, timedOut: false, settled: false,
          dispatched: false, capacityHeld: false, physicalStarted: false, pendingPhysical: 0, cancelled: false,
          failureRecorded: false, abortReason: null, abortController: new AbortController() };
        task.timeout = scheduler.setTimeout(() => {
          if (task.settled) return;
          task.timedOut = true;
          task.settled = true;
          task.abortReason = cleanupFailure('ACQUIRE_TIMEOUT', correlationId);
          task.abortController.abort();
          const index = queue.indexOf(task);
          if (index >= 0) queue.splice(index, 1);
          if (task.dispatched && task.physicalStarted && !task.failureRecorded) {
            recordFailure(task.tenantId, task.workload, task.connectionVersion);
            task.failureRecorded = true;
          }
          if (task.pendingPhysical === 0) releaseTaskCapacity(task);
          settleTaskRejection(task, tenantFailure('POOL_EXHAUSTED', 'TENANT_OPERATION_UNAVAILABLE', { correlationId }));
          pump();
        }, limits.acquireTimeoutMs);
        queue.push(task);
        pump();
      });
    },
    getFence: fenceFor,
    synchronizeFence,
    synchronizeBlocked({tenantId,workload:workloadValue,fence}){workload(workloadValue);integer(fence,'fence');synchronizeFence({tenantId,workload:workloadValue,fence});blockedScopes.add(scopeFor(tenantId,workloadValue));return fence;},
    drainVersion: ({ tenantId, workload:workloadValue, connectionVersion }) => transition(tenantId, workloadValue, connectionVersion, false),
    awaitDrained({tenantId,workload:workloadValue,connectionVersion}){workload(workloadValue);const entry=entries.get(keyFor(tenantId,workloadValue,connectionVersion));return entry?.drainCompletion||Promise.resolve();},
    revokeVersion: ({ tenantId, workload:workloadValue, connectionVersion }) => transition(tenantId, workloadValue, connectionVersion, true),
    async blockWorkload(tenantId, workloadValue) {
      const scope=scopeFor(tenantId,workloadValue);
      if (!blockedScopes.has(scope)) incrementFence(tenantId,workloadValue);
      blockedScopes.add(scope);
      cancelMatching(task => task.tenantId === tenantId && task.workload === workloadValue, task => tenantFailure(
        'CONNECTION_NOT_AVAILABLE', 'TENANT_NOT_AVAILABLE', { correlationId: task.correlationId }
      ));
      for (const entry of entries.values()) {
        if (entry.tenantId === tenantId && entry.workload === workloadValue) deniedKeys.add(entry.key);
      }
      await Promise.all([...entries.values()].filter(entry => entry.tenantId === tenantId && entry.workload === workloadValue)
        .map(entry => closeEntry(entry)));
      return Object.freeze({tenantId,workload:workloadValue,fence:fenceFor(tenantId,workloadValue)});
    },
    allowWorkload({ tenantId, workload:workloadValue, connectionVersion, expectedFence }) {
      const scope=scopeFor(tenantId,workloadValue);
      if (!blockedScopes.has(scope) || fenceFor(tenantId,workloadValue) !== expectedFence
          || deniedKeys.has(keyFor(tenantId, workloadValue, connectionVersion))) {
        throw tenantFailure('TRANSITION_CONFLICT', 'TENANT_NOT_AVAILABLE');
      }
      blockedScopes.delete(scope);
      return fenceFor(tenantId,workloadValue);
    },
    async blockTenant(tenantId) {
      const states={};
      for(const workloadValue of WORKLOADS)states[workloadValue]=await this.blockWorkload(tenantId,workloadValue);
      return Object.freeze(states);
    },
    allowTenant({tenantId,workloads}) {
      if(!workloads||Reflect.ownKeys(workloads).length!==WORKLOADS.length)throw tenantFailure('TRANSITION_CONFLICT','TENANT_NOT_AVAILABLE');
      for(const workloadValue of WORKLOADS){const value=workloads[workloadValue],scope=scopeFor(tenantId,workloadValue);if(!value||!blockedScopes.has(scope)||fenceFor(tenantId,workloadValue)!==value.expectedFence||deniedKeys.has(keyFor(tenantId,workloadValue,value.connectionVersion)))throw tenantFailure('TRANSITION_CONFLICT','TENANT_NOT_AVAILABLE');}
      for(const workloadValue of WORKLOADS)blockedScopes.delete(scopeFor(tenantId,workloadValue));
      return Object.freeze(Object.fromEntries(WORKLOADS.map(value=>[value,fenceFor(tenantId,value)])));
    },
    snapshot() {
      const credentialTimeouts = credentialCleanupTimeouts.size;
      return Object.freeze({ active, queued: queue.length, pools: entries.size,
        tenants: activeByTenant.size, circuitsOpen: [...circuits.values()].filter(value => value.openedUntil > nowMillis(clock)).length,
        credentialDisposalsPending: credentialDisposals.size,
        credentialCleanupTimeouts: credentialTimeouts,
        credentialCleanupFailures: credentialCleanupErrors.size,
        cleanupFailures: [...entries.values()].filter(entry => entry.cleanupError).length
          + backgroundCleanupErrors.size + credentialTimeouts });
    },
    async closeAll() {
      closed = true;
      cancelMatching(() => true, task => tenantFailure(
        'POOL_CLOSED', 'TENANT_OPERATION_UNAVAILABLE', { correlationId: task.correlationId }
      ));
      const errors = [];
      const pendingCreations = [...creating.values()].map(creation => creation.promise);
      await awaitPhysicalObservers(errors);
      const trackedCredentials = [...new Set([...pendingCreations, ...credentialDisposals])];
      if (trackedCredentials.length) {
        const outcomes = await awaitTrackedCleanup(trackedCredentials, errors, 'CREDENTIAL_CLEANUP_TIMEOUT', () => {
          for (const disposal of credentialDisposals) credentialCleanupTimeouts.add(disposal);
        });
        if (outcomes) {
          errors.push(...outcomes.filter(outcome => outcome.status === 'rejected'
            && !['POOL_CLOSED', 'ACQUIRE_TIMEOUT'].includes(outcome.reason?.internalCode)).map(outcome => outcome.reason));
        }
      }
      const pendingClientCleanups = [...clientCleanups];
      if (pendingClientCleanups.length) {
        const outcomes = await awaitTrackedCleanup(pendingClientCleanups, errors, 'CLIENT_CLEANUP_TIMEOUT');
        if (outcomes) errors.push(...outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason));
      }
      for (const entry of [...entries.values()]) {
        try { await closeEntry(entry); } catch (error) { errors.push(error); }
      }
      errors.push(...backgroundCleanupErrors);
      if (errors.length) throw errors.slice(1).reduce((primary, cleanup) => aggregateCleanup(primary, cleanup), errors[0]);
    }
  });
}

module.exports = { createTenantPoolManager, validatePolicy };
