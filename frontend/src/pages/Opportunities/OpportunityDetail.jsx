import { useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { PrivateOpportunityDetail } from './PrivateOpportunities'

export default function OpportunityDetail() {
  const { organization } = useAuth()
  const { id } = useParams()
  return <PrivateOpportunityDetail key={`${organization?.id || 'no-organization'}:${id}`} organization={organization} id={id} />
}
