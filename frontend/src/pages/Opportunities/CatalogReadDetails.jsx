import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CatalogStatus, PresentationText } from './CatalogPresentation'
import { labels, OfficialLink, Value } from './CatalogReadValues'

export function ErrorState({ error, retry }) {
  const [clock, setClock] = useState(Date.now())
  useEffect(() => {
    if (!error.retryAt) return
    const now = Date.now()
    setClock(now)
    if (now >= error.retryAt) return
    const timer = setInterval(() => {
      const current = Date.now()
      setClock(current)
      if (current >= error.retryAt) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [error.retryAt])
  const remaining = Math.max(
    0,
    Math.ceil(((error.retryAt || 0) - clock) / 1000),
  )
  const messages = {
    401: 'Sessão terminada. Inicie sessão para continuar.',
    403: 'O acesso foi revogado ou este contexto já não está autorizado.',
    410: 'Esta consulta expirou. Atualize os resultados para iniciar uma nova consulta.',
    400: 'Os filtros ou a paginação não são válidos.',
    404: 'Esta oportunidade não está disponível nesta consulta.',
    409: 'A paginação não corresponde a esta consulta. Atualize os resultados.',
    422: 'Um dos filtros não está disponível.',
    429: 'Foram feitos demasiados pedidos. Aguarde antes de tentar novamente.',
    503: 'A leitura está temporariamente indisponível.',
  }
  return (
    <div role="alert" className="cr-message">
      <p>
        {messages[error.status] ||
          'Não foi possível obter os dados. Verifique a ligação e tente novamente.'}
      </p>
      {error.status === 401 ? (
        <Link to="/login">Iniciar sessão</Link>
      ) : (
        error.status !== 403 && (
          <button type="button" onClick={retry} disabled={remaining > 0}>
            {remaining > 0
              ? `Tentar novamente em ${remaining} s`
              : [409, 410].includes(error.status)
                ? 'Atualizar resultados'
                : 'Tentar novamente'}
          </button>
        )
      )}
    </div>
  )
}
export function Summary({ item }) {
  return (
    <>
      <p className="cr-code">
        {item.kind === 'planned_notice' ? `ID do plano · ${item.sources?.find((source) => source.namespace === 'PORTUGAL2030_PLAN')?.externalId || 'Por confirmar'}` : <Value value={item.externalCode} />}
      </p>
      <p>{item.sources?.map((source) => `${labels[source.namespace] || source.namespace} · ${source.externalId}`).join(' | ')}</p>
      {item.kind === 'planned_notice' && <p className="cr-message">Registo do plano: a publicação do aviso e os prazos de candidatura ainda não estão confirmados.</p>}
      <h1>
        <Value value={item.title} />
      </h1>
      <p>
        {item.programmes?.items.map((p) => p.label).join(' · ') ||
          'Programa não indicado'}
      </p>
      <dl className="cr-classification"><div><dt>Tipificação</dt><dd><PresentationText field={item.presentation?.typification} fallback={labels[item.kind] || 'Não indicada'} /></dd></div><div><dt>Áreas</dt><dd><PresentationText field={item.presentation?.areas} /></dd></div></dl>
      <div className="cr-summary">
        <div>
          <strong>{item.fundingLabel}</strong>
          <p>
            {item.funding?.state === 'UNSUPPORTED' ? 'Consultar detalhe do financiamento' : <Value value={item.funding} />}
          </p>
        </div>
        <div>
          <strong>Prazo</strong>
          <p>{item.deadline?.label}</p>
          {item.deadline?.at && (
            <small>
              <Value value={item.deadline.at} />
            </small>
          )}
          <small>{item.deadline?.scopeLabel}</small>
        </div>
        <div>
          <CatalogStatus status={item.status} />
          <p>{item.quality?.flags.map((f) => labels[f] || f).join(' · ')}</p>
        </div>
      </div>
      <p>
        Abertura: <Value value={item.opening} />
      </p>
      {item.deadline?.state === 'conditional' && (
        <p className="cr-message">
          Prazo condicionado: {item.deadline.label}. Consulte as condições em
          Janelas e prazos.
        </p>
      )}
      {item.officialLinks?.map((link, i) => (
        <p key={i}>
          <OfficialLink url={link.url}>{link.label}</OfficialLink>
        </p>
      ))}
    </>
  )
}
export function Section({ name, title, id, store, state, descriptor, basePath }) {
  const section = state.sections[name]
  useEffect(() => {
    if (name === 'windows' && !section && !state.error)
      store.collection(id, name)
  }, [id, name, store, !!section, state.error])
  return (
    <details
      className="cr-section"
      open={name === 'windows' ? true : undefined}
      onToggle={(event) => {
        if (event.currentTarget.open && !section && !state.error)
          store.collection(id, name)
      }}
    >
      <summary>{title}</summary>
      <p>Completude: {labels[descriptor?.completeness] || 'Desconhecida'}</p>
      {section?.busy && <p role="status">A carregar…</p>}
      {section?.error && (
        <ErrorState
          error={section.error}
          retry={() => store.collection(id, name)}
        />
      )}
      {section?.data?.map((item, i) => (
        <article key={item.id || i}>
          {(item.supersedesId || item.supersedesVersionId) && (
            <p>
              Substitui um registo anterior; consulte o âmbito e a data de
              produção de efeitos.
            </p>
          )}
          <Value value={item} />
          {name === 'relationships' && item.targetId && (
            <Link
              to={`${basePath}/${item.targetId}?${new URLSearchParams({ ...state.filters, view: 'all' })}`}
            >
              Abrir oportunidade relacionada
            </Link>
          )}
          {['documents', 'evidence'].includes(name) && (
            <details>
              <summary>Identificação técnica e preservação</summary>
              <p>Identificador: {item.id}</p>
              <p>
                Versão substituída: {item.supersedesVersionId || 'Não indicada'}
              </p>
              <p>
                Localizador:{' '}
                {item.locator ? JSON.stringify(item.locator) : 'Não indicado'}
              </p>
              <p>SHA-256: {item.contentSha256 || 'Não disponível'}</p>
              <p>
                A ligação à fonte não garante o acesso aos bytes históricos
                desta versão.
              </p>
            </details>
          )}
        </article>
      ))}
      {section?.data?.length === 0 && !section.error && !section.busy && (
        <p>
          {descriptor?.completeness === 'complete'
            ? 'Sem elementos registados.'
            : 'Não há elementos disponíveis nesta leitura; a informação não está completa.'}
        </p>
      )}
      {section?.page?.hasMore && (
        <button
          disabled={section.busy}
          onClick={() => store.collection(id, name, true)}
        >
          Carregar mais {title.toLowerCase()}
        </button>
      )}
    </details>
  )
}
