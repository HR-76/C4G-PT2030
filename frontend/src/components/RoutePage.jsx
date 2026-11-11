import LoadingIndicator from './LoadingIndicator'
import { Component, lazy, Suspense } from 'react'

class PageError extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <section role="alert">
      <p>Não foi possível abrir esta página. Volte a carregar para tentar novamente.</p>
      <button onClick={() => window.location.reload()}>Recarregar página</button>
    </section>
    return this.props.children
  }
}

// Declare once at module scope: navigation must not recreate lazy components.
export default function routePage(load) {
  const Page = lazy(load)
  return function RoutePage(props) {
    return <PageError><Suspense fallback={<LoadingIndicator className="page-loading">A carregar página…</LoadingIndicator>}>
      <Page {...props} />
    </Suspense></PageError>
  }
}
