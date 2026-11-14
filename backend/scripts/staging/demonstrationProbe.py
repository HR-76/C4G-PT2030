"""Read-only staging inventory. Does not insert data or change privileges."""
import json
import os
from pathlib import Path
import subprocess

CONTAINER = "c4g-staging-postgres-db-1"
DATABASES = ("c4g_central_staging", "c4g_tenant_staging")


def query(database, sql):
    statement = (
        "BEGIN READ ONLY; SET LOCAL statement_timeout='15s'; "
        "SELECT coalesce(json_agg(q),'[]'::json) FROM (" + sql + ") q; COMMIT;"
    )
    result = subprocess.run(
        ["docker", "exec", "-i", CONTAINER, "psql", "-X", "-q", "-A", "-t",
         "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database],
        input=statement, text=True, capture_output=True, check=True, timeout=25,
    )
    return json.loads(result.stdout.strip())


def main():
    report = {"batch": "DEMO-20261114", "databaseWrites": False}
    for database in DATABASES:
        report[database] = {
            "identity": query(database, "SELECT current_database() AS database, version() AS postgres"),
            "columns": query(database, """SELECT table_schema,table_name,column_name,data_type,is_nullable
                FROM information_schema.columns
                WHERE table_schema IN ('public','opportunity_catalog','organizational_scope','tenant_control')
                AND (table_name IN ('organization','organization_membership','global_user','c4g_database_identity',
                    'scope','person_profile','person','opportunity','revision','opportunity_interest','opportunity_interest_change',
                    'opportunity_interest_unit','application_unit')
                    OR table_name LIKE 'application%' OR table_name LIKE '%migration%')
                ORDER BY table_schema,table_name,ordinal_position"""),
            "constraints": query(database, """SELECT n.nspname AS schema,c.relname AS table_name,
                con.conname AS name,pg_get_constraintdef(con.oid) AS definition
                FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
                JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='opportunity_catalog'
                  AND (c.relname LIKE 'application%' OR c.relname LIKE 'opportunity_interest%')
                ORDER BY c.relname,con.conname"""),
        }
    central = report[DATABASES[0]]
    central["organizations"] = query(DATABASES[0], "SELECT id,display_name,slug,status FROM public.organization ORDER BY id")
    central["memberships"] = query(DATABASES[0], """SELECT id,global_user_id,organization_id,base_role_code,status,
        valid_from,valid_until FROM public.organization_membership ORDER BY organization_id,id""")
    tenant = report[DATABASES[1]]
    tenant["applications"] = query(DATABASES[1], """SELECT organization_id,status,count(*) AS count
        FROM opportunity_catalog.application GROUP BY organization_id,status ORDER BY organization_id,status""")
    tenant["units"] = query(DATABASES[1], """SELECT organization_id,scope_id,scope_type,label,lifecycle
        FROM organizational_scope.scope ORDER BY organization_id,scope_id LIMIT 100""")
    tenant["interests"] = query(DATABASES[1], """SELECT organization_id,interest_id,central_opportunity_id,
        central_revision_id,title,status,revision FROM opportunity_catalog.opportunity_interest
        ORDER BY organization_id,interest_id LIMIT 100""")
    output = Path(__file__).resolve().with_name("demonstration-readiness.json")
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    print("READ_ONLY_STAGING_INVENTORY_OK " + str(output))


if __name__ == "__main__":
    main()
