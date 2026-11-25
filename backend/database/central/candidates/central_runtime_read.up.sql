-- Central 052: read-only projections for the central runtime role (c4g_central_runtime).
-- Scope approved on 14/11/2026 (G1 restrito): SELECT only, on the identity, organization and tenant
-- projections that the API reads, plus the migration ledger that the central preflight reads.
-- No writes, no authority tables and no membership changes (context/decisions R5-001, AV-01).
GRANT SELECT ON public.c4g_schema_migration,
  public.c4g_database_identity,
  public.global_user,
  public.organization,
  public.organization_membership,
  public.tenant,
  public.tenant_schema_state
TO c4g_central_runtime;
