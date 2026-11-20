-- Reverses 052 exactly: removes only the SELECT grants that the up migration gave to c4g_central_runtime.
REVOKE SELECT ON public.c4g_schema_migration,
  public.c4g_database_identity,
  public.global_user,
  public.organization,
  public.organization_membership,
  public.tenant,
  public.tenant_schema_state
FROM c4g_central_runtime;
