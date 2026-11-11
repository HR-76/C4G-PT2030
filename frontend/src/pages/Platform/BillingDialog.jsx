import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export default function BillingDialog({ title, description, children, onClose, busy = false, wide = false }) {
  const panel = useRef(null), closeButton = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    closeButton.current?.focus()
    const keyboard = event => {
      if (event.key === 'Escape' && !busy) onClose()
      if (event.key !== 'Tab') return
      const controls = [...panel.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus?.() }
  }, [busy, onClose])
  return <div className="billing-dialog-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onClose()
  }}>
    <section ref={panel} className={`billing-dialog${wide ? ' billing-dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="billing-dialog-title">
      <header><div><h2 id="billing-dialog-title">{title}</h2>{description && <p>{description}</p>}</div>
        <button ref={closeButton} type="button" className="billing-dialog-close" aria-label="Fechar" disabled={busy} onClick={onClose}><X size={20}/></button>
      </header>
      {children}
    </section>
  </div>
}

