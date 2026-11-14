import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import './FormModal.css'

const controls = 'input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),a[href],[tabindex="0"]'

// The active modals, in the order they were opened. Only the last one contains the focus and answers the keyboard:
// two modals pulling the focus from each other never settle, and one Escape would close both.
const openModals = []

export default function FormModal({ title, children, onClose, locked = false, step, returnFocusRef, className = '', active = true }) {
  const panel = useRef(null), overlay = useRef(null), titleId = useId(), self = useRef({})
  const latest = useRef({ onClose, locked, active })
  useLayoutEffect(() => { latest.current = { onClose, locked, active } })
  useEffect(() => {
    if (!active) return
    const token = self.current, onTop = () => openModals.at(-1) === token
    openModals.push(token)
    const previous = returnFocusRef?.current || document.activeElement
    const siblings = [...document.body.children].filter(node => node !== overlay.current)
    const inert = siblings.map(node => node.hasAttribute('inert'))
    siblings.forEach(node => node.setAttribute('inert', ''))
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFirst = () => (panel.current?.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') || panel.current)?.focus()
    focusFirst()
    const contain = event => { if (onTop() && !panel.current?.contains(event.target)) focusFirst() }
    const keyboard = event => {
      if (!onTop()) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (!latest.current.locked) latest.current.onClose()
      }
      if (event.key !== 'Tab') return
      const items = [...panel.current.querySelectorAll(controls)].filter(node =>
        !node.closest('[hidden]') && node.checkVisibility?.() !== false)
      const first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); panel.current.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('focusin', contain)
    document.addEventListener('keydown', keyboard)
    return () => {
      const index = openModals.indexOf(token)
      if (index >= 0) openModals.splice(index, 1)
      document.removeEventListener('focusin', contain)
      document.removeEventListener('keydown', keyboard)
      siblings.forEach((node, index) => { if (!inert[index]) node.removeAttribute('inert') })
      document.body.style.overflow = overflow
      queueMicrotask(() => {
        if (latest.current.active && previous?.isConnected && !previous.closest('[inert], [hidden]')) previous.focus()
      })
    }
  }, [active, returnFocusRef])
  useEffect(() => {
    // Review replaces the form: keep focus inside the dialog after that change.
    if (active && openModals.at(-1) === self.current && !panel.current?.contains(document.activeElement)) panel.current?.focus()
  }, [active, step, locked])
  return createPortal(<div className="form-modal-overlay" ref={overlay} hidden={!active}>
    <section className={`form-modal ${className}`} ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="form-modal-heading"><h2 id={titleId}>{title}</h2>
        <button type="button" className="form-modal-close" aria-label="Fechar" disabled={locked} onClick={onClose}><X size={20} aria-hidden="true" /></button>
      </header>
      {children}
    </section>
  </div>, document.body)
}
