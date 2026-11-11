// Shell requests (navigation permissions, unread badge) are secondary to the
// data of the page being opened. They start once the page's own requests have
// settled, so both do not compete for the same server-side authority checks.
// This only orders requests on the client; it never caches or skips any.
export function createPageRequestActivity({ quietMs = 250, maxWaitMs = 6000 } = {}) {
  let active = 0, quiet = null
  const waiters = new Set()
  // Everything waiting is released together, so shell requests do not queue
  // behind one another.
  const release = () => { quiet = null; for (const finish of [...waiters]) finish(true) }
  const arm = () => { clearTimeout(quiet); quiet = setTimeout(release, Math.max(0, quietMs)) }

  function start() {
    active++
    clearTimeout(quiet); quiet = null
  }

  function end() {
    active = Math.max(0, active - 1)
    if (!active && waiters.size) arm()
  }

  // Runs `work` after no page request has been in flight for `quietMs`, or
  // after `maxWaitMs` at the latest. Never runs it once `signal` is aborted.
  function afterPageRequests(signal, work) {
    if (signal?.aborted) return
    if (!active && quietMs <= 0) { work(); return }
    const limit = setTimeout(() => finish(true), maxWaitMs)
    const abort = () => finish(false)
    function finish(run) {
      if (!waiters.delete(finish)) return
      clearTimeout(limit)
      signal?.removeEventListener('abort', abort)
      if (run && !signal?.aborted) work()
    }
    waiters.add(finish)
    signal?.addEventListener('abort', abort, { once: true })
    if (!active && quiet === null) arm()
  }

  return Object.freeze({ start, end, afterPageRequests })
}

const testing = import.meta.env?.MODE === 'test'
export const pageRequests = createPageRequestActivity(testing ? { quietMs: 0 } : undefined)
export const afterPageRequests = pageRequests.afterPageRequests
