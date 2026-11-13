// Which dashboard to open is decided by the backend (organization.navigation.dashboard); there are no profile rules here.
export const usesTechnicianDashboard = organization => organization?.navigation?.dashboard === 'TECHNICIAN'
