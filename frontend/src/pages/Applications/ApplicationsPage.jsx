import { lazy, Suspense, useEffect } from 'react'
import LoadingIndicator from '../../components/LoadingIndicator'
import ApplicationsRoute from './ApplicationsRoute'

// The list opens without the code of the record (detail, team, documents,
// chat, partners). That code is fetched when a record is opened, and ahead of
// time shortly after the list is shown so the first opening does not wait.
const loadRecord = () => import('./PrivateApplications')
const LazyRecord = lazy(() => loadRecord().then(module => ({ default: module.ApplicationRecord })))
function Record() {
  return <Suspense fallback={<LoadingIndicator className="page-loading">A carregar página…</LoadingIndicator>}><LazyRecord /></Suspense>
}
export default function ApplicationsPage() {
  useEffect(() => { const timer = setTimeout(() => { loadRecord().catch(() => {}) }, 1500); return () => clearTimeout(timer) }, [])
  return <ApplicationsRoute Record={Record} />
}
