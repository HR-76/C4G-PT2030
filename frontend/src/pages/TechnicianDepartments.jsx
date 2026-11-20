import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Target } from 'lucide-react'
import { organizationDirectoryApi } from '../api/api'
import DepartmentContext, { departmentsWithProfile } from './Organization/DepartmentContext'
import './Organization/organization.css'

// The objectives of the departments the Técnico belongs to, read with the personal
// profile after the dashboard itself. It is context only: without a linked person,
// a department or a filled profile, or if the read fails, the section stays out.
export default function TechnicianDepartments({ organizationId }) {
  const [data, setData] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    organizationDirectoryApi(organizationId).self(controller.signal).then(result => { if (!controller.signal.aborted) setData(result.data) }, () => {})
    return () => controller.abort()
  }, [organizationId])
  if (!departmentsWithProfile(data?.departments).length) return null
  return <section className="technician-priorities" aria-labelledby="technician-departments-title">
    <div className="technician-section-heading"><div><Target size={19} aria-hidden="true" data-icon-tone="blue" /><h2 id="technician-departments-title">Os objetivos dos meus departamentos</h2></div><Link to="/perfil">Ver o meu perfil</Link></div>
    <DepartmentContext departments={data.departments} areas={data.areas} />
  </section>
}
