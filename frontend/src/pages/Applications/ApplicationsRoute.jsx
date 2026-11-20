import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import ApplicationBrowse from './ApplicationBrowse'

// Which view of /candidaturas to show: the list, or the record (creation and
// detail) given as `Record`.
export default function ApplicationsRoute({ Record }) {
  const { id } = useParams(), [params] = useSearchParams(), { user, organization } = useAuth()
  if (!id && params.get('nova') !== '1' && params.get('ver') === 'interesses') {
    const rest = new URLSearchParams(params); rest.delete('ver'); const query = rest.toString()
    return <Navigate to={`/interesses${query ? `?${query}` : ''}`} replace />
  }
  return !id && params.get('nova') !== '1'
    ? <ApplicationBrowse key={user?.id + ':' + organization?.id} />
    : <Record key={`${user?.id}:${organization?.id}:${id || params.toString()}`} />
}
