import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

const listPath = /^\/(catalogo|candidaturas|matching|notificacoes|perfil|perfil-organizacao(?:\/(?:pessoas|unidades))?)$/
const detailPath = /^\/(?:(?:catalogo|candidaturas|oportunidades|perfil-organizacao\/pessoas)\/[^/]+|conta\/seguranca)$/

// Keep keyboard position across async list → detail → list navigation.
export default function useListRouteFocus(main, identity) {
  const { pathname, search } = useLocation()
  const previous = useRef(pathname)
  const openers = useRef(new Map())

  function rememberOpener(event) {
    if (!listPath.test(pathname) || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    const link = event.target.closest('a[href]')
    if (!link || link.target === '_blank') return
    const target = new URL(link.href)
    const unitToPeople = pathname === '/perfil-organizacao/unidades' && target.pathname === '/perfil-organizacao/pessoas'
    const profileToDirectory = pathname === '/perfil-organizacao' && ['/perfil-organizacao/unidades','/perfil-organizacao/pessoas'].includes(target.pathname)
    if (target.origin !== window.location.origin || !(profileToDirectory || unitToPeople || detailPath.test(target.pathname))) return
    openers.current.set(pathname, { list: pathname + search, detail: target.pathname, href: link.href, alertId: link.dataset.alertId, label: link.getAttribute('aria-label'), identity })
  }

  useEffect(() => {
    const from = previous.current
    previous.current = pathname
    if (from === pathname || !(listPath.test(pathname) || detailPath.test(pathname))) return
    const content = main.current
    if (!content) return
    content.focus({ preventScroll: true })
    const saved = openers.current.get(pathname)
    if (!saved || from !== saved.detail || pathname + search !== saved.list || identity !== saved.identity) return
    openers.current.delete(pathname)
    function restore() {
      if (document.activeElement !== content) { observer.disconnect(); return }
      const link = [...content.querySelectorAll('a[href]')].find(a => a.href === saved.href && a.dataset.alertId === saved.alertId && a.getAttribute('aria-label') === saved.label)
      if (link) { observer.disconnect(); link.focus(); return }
      if (saved.alertId && content.querySelector('[data-alert-results-ready]')) {
        observer.disconnect()
        content.querySelector('[data-alert-focus-fallback][aria-pressed="true"]')?.focus()
      }
    }
    const observer = new MutationObserver(restore)
    observer.observe(content, { childList: true, subtree: true })
    restore()
    const stop = () => observer.disconnect()
    document.addEventListener('keydown', stop, true)
    document.addEventListener('pointerdown', stop, true)
    return () => {
      stop()
      document.removeEventListener('keydown', stop, true)
      document.removeEventListener('pointerdown', stop, true)
    }
  }, [pathname, search, main, identity])
  return rememberOpener
}
