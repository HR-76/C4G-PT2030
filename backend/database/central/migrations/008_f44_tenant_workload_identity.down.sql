DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tenant_workload_binding LIMIT 1)
 OR EXISTS(SELECT 1 FROM public.tenant_workload_connection_version LIMIT 1) THEN
   RAISE EXCEPTION 'F44_ROLLBACK_REQUIRES_EMPTY_WORKLOAD_DIRECTORY';
 END IF;
END $$;
ALTER TABLE public.tenant_workload_binding DROP CONSTRAINT tenant_workload_current_fk;
DROP TRIGGER tenant_workload_binding_guard ON public.tenant_workload_binding;
DROP TRIGGER tenant_workload_version_guard ON public.tenant_workload_connection_version;
DROP FUNCTION public.f4_workload_binding_guard();
DROP FUNCTION public.f4_workload_version_guard();
DROP TABLE public.tenant_workload_connection_version;
DROP TABLE public.tenant_workload_binding;
