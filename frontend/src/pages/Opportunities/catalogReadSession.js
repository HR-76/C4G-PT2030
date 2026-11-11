// Snapshot and cursor capabilities stay in memory, never in browser storage.
const sessions = new Map()
export function clearCatalogSessions(status = 403, scope) {
  for (const [key, store] of sessions) {
    if (scope !== undefined && key !== scope) continue
    store.invalidate(status)
    sessions.delete(key)
  }
}
export function catalogSession(scope, api, filters) {
  if (!sessions.has(scope)) sessions.set(scope, createCatalogSession(api, filters))
  return sessions.get(scope)
}
export function createCatalogSession(api, filters = {}) {
  let state = {
    filters,
    pages: [],
    index: 0,
    detail: null,
    sections: {},
    options: {},
    meta: null,
    error: null,
    busy: false,
  }
  let epoch = 0,
    timer,
    serial = Promise.resolve()
  const listeners = new Set(),
    requests = new Set()
  const emit = (patch) => {
    state = { ...state, ...patch }
    listeners.forEach((fn) => fn())
  }
  const cancel = () => {
    epoch++
    requests.forEach((c) => c.abort())
    requests.clear()
    clearTimeout(timer)
  }
  function invalidate(status) {
    cancel()
    emit({
      pages: [],
      index: 0,
      detail: null,
      sections: {},
      options: {},
      meta: null,
      busy: false,
      error: { status },
    })
  }
  async function request(path, params, commit, localError) {
    const generation = epoch,
      controller = new AbortController()
    requests.add(controller)
    try {
      const result = await api(
        path,
        { ...params, ...(state.meta ? { snapshot: state.meta.snapshot } : {}) },
        controller.signal,
      )
      if (generation !== epoch) return
      if (!state.meta) {
        if (
          !result.meta?.snapshot ||
          !Number.isFinite(Date.parse(result.meta.expiresAt))
        )
          throw new Error('Invalid snapshot')
        const ttl = Math.min(
          900000,
          Date.parse(result.meta.expiresAt) - Date.now(),
        )
        if (ttl <= 0) {
          invalidate(410)
          return
        }
        timer = setTimeout(() => invalidate(410), ttl)
        emit({ meta: result.meta })
      } else if (
        state.meta.snapshot !== result.meta?.snapshot ||
        state.meta.generationId !== result.meta?.generationId
      ) {
        invalidate(410)
        return
      }
      commit(result)
    } catch (error) {
      if (generation !== epoch || controller.signal.aborted) return
      const status = error.response?.status || 0
      if ([401, 403, 410].includes(status)) invalidate(status)
      else {
        const seconds = Number(error.response?.headers?.['retry-after'])
        const retryAt =
          status === 429
            ? Date.now() +
              1000 * (Number.isFinite(seconds) && seconds > 0 ? seconds : 30)
            : null
        ;(localError || ((e) => emit({ error: e, busy: false })))({
          status,
          retryAt,
        })
      }
    } finally {
      requests.delete(controller)
    }
  }
  // Serialize creation of the first snapshot; subsequent reads share that context.
  const queue = (action) => {
    const generation = epoch
    serial = serial.catch(() => {}).then(() => generation === epoch && action())
    return serial
  }
  const list = (cursor) => {
    emit({ busy: true, error: null })
    return queue(() => {
      return request(
        '/opportunities',
        { ...state.filters, ...(cursor ? { cursor } : {}) },
        (result) => {
          const pages = cursor
            ? [...state.pages.slice(0, state.index + 1), result]
            : [result]
          emit({ pages, index: pages.length - 1, busy: false })
        },
      )
    })
  }
  return {
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getSnapshot: () => state,
    invalidate,
    list,
    apply(filters) {
      cancel()
      serial = Promise.resolve()
      emit({
        filters,
        pages: [],
        index: 0,
        detail: null,
        sections: {},
        options: {},
        meta: null,
        error: null,
        busy: false,
      })
      return list()
    },
    previous() {
      if (state.index > 0) emit({ index: state.index - 1 })
    },
    next() {
      const cached = state.pages[state.index + 1]
      if (cached) emit({ index: state.index + 1 })
      else return list(state.pages[state.index]?.page.nextCursor)
    },
    pause() {
      epoch++
      requests.forEach((c) => c.abort())
      requests.clear()
      serial = Promise.resolve()
      emit({
        busy: false,
        sections: {},
        options: Object.fromEntries(
          Object.entries(state.options).filter(([, v]) => !v.busy),
        ),
      })
    },
    revalidate(id) {
      return queue(() =>
        request(
          id ? `/opportunities/${encodeURIComponent(id)}` : '/opportunities',
          id ? {} : state.filters,
          () => {},
        ),
      )
    },
    detail(id) {
      epoch++
      requests.forEach((c) => c.abort())
      requests.clear()
      serial = Promise.resolve()
      emit({ busy: true, detail: null, sections: {}, error: null })
      return queue(() => {
        return request(
          `/opportunities/${encodeURIComponent(id)}`,
          {},
          (result) => emit({ detail: result.data, busy: false }),
        )
      })
    },
    collection(id, name, more = false) {
      return queue(() => {
        const previous = state.sections[name] || {}
        emit({
          sections: {
            ...state.sections,
            [name]: { ...previous, busy: true, error: null },
          },
        })
        return request(
          `/opportunities/${encodeURIComponent(id)}/${name}`,
          more ? { cursor: previous.page?.nextCursor } : {},
          (result) =>
            emit({
              sections: {
                ...state.sections,
                [name]: {
                  ...result,
                  data: more
                    ? [...(previous.data || []), ...result.data]
                    : result.data,
                },
              },
            }),
          (error) =>
            emit({
              sections: {
                ...state.sections,
                [name]: { ...previous, busy: false, error },
              },
            }),
        )
      })
    },
    options(dimension, more = false) {
      return queue(() => {
        const previous = state.options[dimension] || {}
        emit({
          options: {
            ...state.options,
            [dimension]: { ...previous, busy: true, error: null },
          },
        })
        return request(
          '/options',
          { dimension, ...(more ? { cursor: previous.page?.nextCursor } : {}) },
          (result) =>
            emit({
              options: {
                ...state.options,
                [dimension]: {
                  ...result,
                  data: more
                    ? [...(previous.data || []), ...result.data]
                    : result.data,
                },
              },
            }),
          (error) =>
            emit({
              options: {
                ...state.options,
                [dimension]: { ...previous, busy: false, error },
              },
            }),
        )
      })
    },
  }
}
