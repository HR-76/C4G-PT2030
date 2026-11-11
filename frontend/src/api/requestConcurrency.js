const cancelled = () => Object.assign(new Error('Contexto de sessão alterado.'), { code: 'ERR_CANCELED', __CANCEL__: true })

export function createContextRequestCoordinator({ drainMs = 250 } = {}) {
  let tail = Promise.resolve()
  const active = new Set()

  async function acquire({ read = false, signal } = {}) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    let done
    const entry = { read, controller, settled: new Promise(resolve => { done = resolve }) }
    const release = () => { active.delete(entry); signal?.removeEventListener('abort', abort); done() }
    entry.release = release
    active.add(entry)
    await tail
    if (controller.signal.aborted) { release(); throw cancelled() }
    return { signal: controller.signal, release }
  }

  function change(work) {
    const previous = [...active]
    for (const entry of previous) if (entry.read) entry.controller.abort()
    const result = tail.then(async () => {
      let timer
      await Promise.race([
        Promise.all(previous.map(entry => entry.settled)),
        new Promise(resolve => { timer = setTimeout(resolve, drainMs) }),
      ])
      clearTimeout(timer)
      // A broken transport may ignore abort forever; do not retain its listeners.
      for (const entry of previous) if (entry.read) entry.release()
      if (previous.some(entry => !entry.read && active.has(entry))) {
        throw Object.assign(new Error('Existe uma operação em curso. Repita a alteração de sessão.'), { code: 'SESSION_BUSY' })
      }
      return work()
    })
    tail = result.then(() => undefined, () => undefined)
    return result
  }

  return Object.freeze({ acquire, change })
}
