import FilterBar from '../../components/FilterBar'
import SearchInput from '../../components/SearchInput'

export default function CatalogFilters({ draft, setDraft, state, store, apply, labels, ErrorState }) {
  const field = (name, type = 'text') => {
    const Input = name === 'q' ? SearchInput : 'input'
    return (
    <label key={name}>
      {labels[name]}
      <Input
        type={type}
        value={draft[name] || ''}
        maxLength={name === 'q' ? 200 : 100}
        onChange={(event) => setDraft({ ...draft, [name]: event.target.value })}
      />
    </label>
    )
  }
  const select = (name, values) => (
    <label key={name}>
      {labels[name]}
      <select
        aria-label={labels[name]}
        value={draft[name] || ''}
        onChange={(event) => setDraft({ ...draft, [name]: event.target.value })}
      >
        <option value="">Todos</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {labels[v] || v}
          </option>
        ))}
      </select>
    </label>
  )
  return (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              apply(draft)
            }}
          >
            <FilterBar>
              <div className="cr-filters">
                {field('q')}
                {select('status', [
                  'planned',
                  'forthcoming',
                  'open',
                  'closed',
                  'suspended',
                  'cancelled',
                  'conditional',
                  'unknown',
                ])}
                {select('quality', ['partial', 'conflicted', 'stale'])}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={state.busy}
                >
                  Pesquisar
                </button>
              </div>
            </FilterBar>
            <details
              className="cr-more"
              onToggle={(event) => {
                if (event.currentTarget.open && !state.error)
                  for (const dimension of ['programme', 'source', 'kind'])
                    if (!state.options[dimension]) store.options(dimension)
              }}
            >
              <summary>Mais filtros</summary>
              <div className="cr-filters">
                {['programme', 'source', 'kind'].map((dimension) => (
                  <div key={dimension}>
                    <label>
                      {labels[dimension]}
                      <select
                        aria-label={labels[dimension]}
                        value={draft[dimension] || ''}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            [dimension]: event.target.value,
                          })
                        }
                      >
                        <option value="">Todos</option>
                        {draft[dimension] &&
                          !state.options[dimension]?.data?.some(
                            (v) => v.id === draft[dimension],
                          ) && (
                            <option value={draft[dimension]}>
                              {draft[dimension]}
                            </option>
                          )}
                        {state.options[dimension]?.data?.map((v) => (
                          <option key={v.id} value={v.id}>
                            {labels[v.label] || v.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {state.options[dimension]?.error && (
                      <ErrorState
                        error={state.options[dimension].error}
                        retry={() => store.options(dimension)}
                      />
                    )}{' '}
                    {state.options[dimension]?.page?.hasMore && (
                      <button
                        type="button"
                        disabled={state.options[dimension]?.busy}
                        onClick={() => store.options(dimension, true)}
                      >
                        Mais opções de {labels[dimension].toLowerCase()}
                      </button>
                    )}
                  </div>
                ))}
                {field('deadline_from', 'date')}
                {field('deadline_to', 'date')}
                {field('funding_min')}
                {field('currency')}
                {select('sort', [
                  'title',
                  'deadline',
                  '-deadline',
                  '-observed_at',
                ])}
              </div>
            </details>
          </form>
  )
}
