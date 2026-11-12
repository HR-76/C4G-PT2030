// Development only: opens the Email screen with a simulated API, without
// session or backend. Served by `npm run dev` at /email-preview.html; it is
// not an entry of the production build.
import React from 'react'
import ReactDOM from 'react-dom/client'
import { EmailTemplatesView } from './pages/Platform/EmailTemplates'
import { createEmailSimulation } from './pages/Platform/emailTemplatesSimulation'
import './index.css'
import './c4g-shell.css'
import './c4g-surfaces.css'
import './c4g-foundations.css'

const { api, directoryApi } = createEmailSimulation()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <main className="page-content">
      <p className="alert alert-info" role="note">Pré-visualização de desenvolvimento com dados simulados. Nada é guardado nem enviado.</p>
      <EmailTemplatesView api={api} directoryApi={directoryApi}/>
    </main>
  </React.StrictMode>
)
