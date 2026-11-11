import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Trash2, X } from 'lucide-react'

const ICONS = {
  danger: Trash2,
  warning: AlertTriangle,
  info: Info,
  success: CheckCircle2,
}

function ConfirmDialog({ state, onCancel, onConfirm }) {
  const panel = useRef(null), cancelButton = useRef(null), id = useId()
  useEffect(() => {
    if (!state) return
    const previous = document.activeElement
    cancelButton.current?.focus()
    const containFocus = event => {
      if (panel.current && !panel.current.contains(event.target)) cancelButton.current?.focus()
    }
    const keyboard = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); return }
      if (event.key !== 'Tab' || !panel.current) return
      const controls = [...panel.current.querySelectorAll('button:not(:disabled)')]
      const first = controls[0], last = controls.at(-1)
      if (!panel.current.contains(document.activeElement)) { event.preventDefault(); cancelButton.current?.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keyboard)
    document.addEventListener('focusin', containFocus)
    return () => {
      document.removeEventListener('keydown', keyboard)
      document.removeEventListener('focusin', containFocus)
      if (previous?.isConnected) previous.focus?.()
    }
  }, [state, onCancel])
  if (!state) return null

  const tone = state.tone || 'warning'
  const Icon = ICONS[tone] || ICONS.warning

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div ref={panel} className={`confirm-dialog confirm-${tone}`} role="dialog" aria-modal="true"
        aria-labelledby={`${id}-title`} aria-describedby={state.message ? `${id}-message` : undefined}
        onClick={e => e.stopPropagation()}>
        <button type="button" className="confirm-close" onClick={onCancel} aria-label="Fechar">
          <X size={16} />
        </button>
        <div className="confirm-icon">
          <Icon size={22} />
        </div>
        <div className="confirm-content">
          <p className="eyebrow">{state.eyebrow || 'Confirmação'}</p>
          <h2 id={`${id}-title`}>{state.title}</h2>
          {state.message && <p id={`${id}-message`}>{state.message}</p>}
        </div>
        <div className="confirm-actions">
          <button ref={cancelButton} type="button" className="btn btn-secondary" onClick={onCancel}>
            {state.cancelLabel || 'Cancelar'}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {state.confirmLabel || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function useConfirmDialog() {
  const [state, setState] = useState(null)
  const pending = useRef(null)

  useEffect(() => () => { pending.current?.(false); pending.current = null }, [])

  const confirm = useCallback(options => new Promise(resolve => {
    pending.current?.(false)
    pending.current = resolve
    setState(options)
  }), [])

  const close = useCallback(result => {
    pending.current?.(result)
    pending.current = null
    setState(null)
  }, [])
  const cancel = useCallback(() => close(false), [close])
  const accept = useCallback(() => close(true), [close])

  const dialog = (
    <ConfirmDialog
      state={state}
      onCancel={cancel}
      onConfirm={accept}
    />
  )

  return { confirm, dialog }
}
