import { useAuth } from '../../contexts/AuthContext'
import { PrivateOpportunityList } from './PrivateOpportunities'

export default function OpportunitiesList() {
  const { organization } = useAuth()
  return <PrivateOpportunityList key={organization?.id || 'no-organization'} organization={organization} />
}
