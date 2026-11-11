import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

const sectionFor = hash => {
  const target = hash.replace(/^#/, '')
  if (/^(documentos-revisao|documento-|revisao-)/.test(target)) return 'documents'
  if (/^(equipa-tarefas|tarefa-)/.test(target)) return 'team'
  if (target === 'parceiros') return 'partners'
  if (target === 'historico-candidatura') return 'history'
  return 'overview'
}

export default function ApplicationSections({ sections }) {
  const [active, setActive] = useState(() => sectionFor(window.location.hash))
  const [visited, setVisited] = useState(() => new Set([active]))
  const choose = id => {
    setActive(id)
    setVisited(previous => previous.has(id) ? previous : new Set([...previous, id]))
  }
  const root = useRef(null)
  useEffect(() => {
    const reveal = () => choose(sectionFor(window.location.hash))
    window.addEventListener('hashchange', reveal)
    return () => window.removeEventListener('hashchange', reveal)
  }, [])
  const followAnchor = event => {
    const link = event.target.closest('a[href^="#"]')
    if (!link) return
    const target = document.getElementById(link.getAttribute('href').slice(1))
    const panel = target?.closest('[data-application-panel]')
    if (panel && root.current?.contains(panel)) flushSync(() => choose(panel.dataset.applicationPanel))
  }
  return <div ref={root} className="application-workspace" onClickCapture={followAnchor}>
    <div className="application-tabs" role="tablist" aria-label="Secções da candidatura">
      {sections.map((section, index) => <button key={section.id} type="button" role="tab"
        id={`application-tab-${section.id}`} aria-controls={`application-panel-${section.id}`}
        aria-selected={active === section.id} tabIndex={active === section.id ? 0 : -1}
        onClick={() => choose(section.id)} onKeyDown={event => {
          const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
          if (!keys.includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length
          choose(sections[next].id)
          document.getElementById(`application-tab-${sections[next].id}`)?.focus()
        }}>{section.label}</button>)}
    </div>
    {sections.map(section => <div key={section.id} id={`application-panel-${section.id}`}
      data-application-panel={section.id} role="tabpanel" aria-labelledby={`application-tab-${section.id}`}
      tabIndex={0} hidden={active !== section.id}>{section.render ? section.render(visited.has(section.id)) : section.content}</div>)}
  </div>
}
