import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { CheckCircle, Info, X, XCircle } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const removeToast = useCallback(id => {
    setToasts(current => current.filter(toast => toast.id !== id))
  }, [])

  const showToast = useCallback(({ type = 'info', title, message, duration = 4200 }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts(current => [...current, { id, type, title, message }])
    window.setTimeout(() => removeToast(id), duration)
    return id
  }, [removeToast])

  const api = useMemo(() => ({
    showToast,
    success: (title, message) => showToast({ type: 'success', title, message }),
    error: (title, message) => showToast({ type: 'error', title, message }),
    info: (title, message) => showToast({ type: 'info', title, message }),
  }), [showToast])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {toasts.map(toast => {
          const Icon = ICONS[toast.type] || Info
          return (
            <div key={toast.id} className={`toast toast-${toast.type}`} role="status">
              <Icon size={18} />
              <div className="toast-body">
                <strong>{toast.title}</strong>
                {toast.message && <span>{toast.message}</span>}
              </div>
              <button className="toast-close" onClick={() => removeToast(toast.id)} aria-label="Fechar notificação">
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
