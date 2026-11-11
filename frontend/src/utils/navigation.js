export function getHomePath(user) {
  if (!user) return '/login'
  return user.platformRoles?.includes('C4G_ADMIN') ? '/administracao/dashboard' : '/dashboard'
}
