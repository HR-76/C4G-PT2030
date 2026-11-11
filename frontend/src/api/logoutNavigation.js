// This in-memory boundary owns navigation until federated logout leaves the page.
// Residual API responses must still reject, but cannot start another login.
let pending = false
export const isLogoutNavigationPending = () => pending
export const beginLogoutNavigation = () => { pending = true }
export const cancelLogoutNavigation = () => { pending = false }
