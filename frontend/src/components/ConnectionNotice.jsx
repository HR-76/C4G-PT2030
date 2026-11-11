import { useEffect, useState } from 'react'
import './ConnectionNotice.css'

export default function ConnectionNotice() {
  const [offline, setOffline] = useState(() => navigator.onLine === false)
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false)
    window.addEventListener('offline', update)
    window.addEventListener('online', update)
    update()
    return () => { window.removeEventListener('offline', update); window.removeEventListener('online', update) }
  }, [])
  if (!offline) return null
  return <div className="connection-notice" role="status">Sem ligação à internet. Para consultar ou guardar dados, volte a ligar-se. Os envios por confirmar não são repetidos automaticamente.</div>
}
