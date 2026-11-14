"""Additive, single-transaction synthetic data load for the confirmed staging tenant.

Run as root on the VPS: python3 demonstrationLoad.py --apply --target app-teste.c4g.ai
Without --apply this only reads databases and prints the planned counts.
Never changes schema, accounts, existing rows, email queues or external services.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from demonstrationProbe import query, CONTAINER, DATABASES

BATCH = "DEMO-20261114"
ORG = "b2bfd1d8-2a65-4f93-9405-2666ce38e7b7"
ADMIN = "f88a0699-408e-462a-8f6b-7a54b6333bbb"
MEMBERS = {ADMIN, "3659e456-9bf9-4fe6-8d00-b61bfed512ff"}
UNIT_LABELS = ["Energia e Ambiente", "Inovação Digital", "Saúde e Bem-estar",
               "Educação e Capacitação", "Cultura e Património", "Desenvolvimento Territorial"]
PEOPLE = ["Ana Exemplo", "Bruno Exemplo", "Carla Exemplo", "Diogo Exemplo",
          "Eva Exemplo", "Filipe Exemplo", "Graça Exemplo", "Hélder Exemplo",
          "Inês Exemplo", "João Exemplo", "Lara Exemplo", "Miguel Exemplo"]
STATES = Counter(IDENTIFIED=5, PREPARATION=10, SUBMITTED=7, APPROVED=4,
                 REJECTED=2, CANCELLED=1, ARCHIVED=1)
TABLE_KEYS = {
    "organizational_scope.scope": "scope_id", "organizational_scope.person": "person_id",
    "organizational_scope.person_unit": "person_id", "organizational_scope.person_profile": "person_id",
    "opportunity_catalog.opportunity_interest": "interest_id", "opportunity_catalog.interest_unit": "interest_id",
    "opportunity_catalog.interest_change": "interest_id", "opportunity_catalog.application": "application_id",
    "opportunity_catalog.application_change": "application_id", "opportunity_catalog.application_unit": "application_id",
    "opportunity_catalog.application_work": "application_id", "opportunity_catalog.application_participant": "application_id",
    "opportunity_catalog.application_task": "task_id", "opportunity_catalog.application_work_change": "application_id",
    "opportunity_catalog.application_partners": "application_id", "opportunity_catalog.application_partner": "partner_id",
    "opportunity_catalog.application_partner_change": "application_id", "opportunity_catalog.application_chat_message": "message_id",
    "opportunity_catalog.application_alert": "alert_id", "opportunity_catalog.organization_notice": "notice_id",
    "opportunity_catalog.organization_notice_recipient": "notice_id",
}


def stable_id(key):
    h = hashlib.sha256((BATCH + ":" + key).encode()).hexdigest()
    return f"{h[:8]}-{h[8:12]}-5{h[13:16]}-8{h[17:20]}-{h[20:32]}"


class SQL(str):
    """Only code-owned SQL expressions; never wrap external strings with this."""


def literal(value):
    if isinstance(value, SQL):
        return str(value)
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, (dict, list)):
        return literal(json.dumps(value, ensure_ascii=False)) + "::jsonb"
    if not isinstance(value, str) or "\x00" in value:
        raise ValueError("Invalid SQL data")
    return "'" + value.replace("'", "''") + "'"


def uuid_array(ids):
    if any(not re.fullmatch(r"[0-9a-f-]{36}", item) for item in ids):
        raise ValueError("Invalid UUID array")
    return SQL("ARRAY[" + ",".join(literal(item) for item in ids) + "]::uuid[]")


def stage_path(status):
    paths = {"IDENTIFIED": [], "PREPARATION": ["PREPARATION"],
             "SUBMITTED": ["PREPARATION", "SUBMITTED"],
             "APPROVED": ["PREPARATION", "SUBMITTED", "APPROVED"],
             "REJECTED": ["PREPARATION", "SUBMITTED", "REJECTED"],
             "CANCELLED": ["CANCELLED"],
             "ARCHIVED": ["PREPARATION", "SUBMITTED", "APPROVED", "ARCHIVED"]}
    return ["IDENTIFIED"] + paths[status]


def build_rows(plan, members, sources):
    if plan.get("batch") != BATCH or plan.get("target") != "https://app-teste.c4g.ai":
        raise ValueError("Wrong plan target")
    apps = plan["applications"]
    if len(apps) != 30 or Counter(a["status"] for a in apps) != STATES:
        raise ValueError("Unexpected application count/statuses")
    if {m["id"] for m in members} != MEMBERS or len(sources) != 10:
        raise ValueError("Unexpected memberships or opportunity count")
    actor = next(m for m in members if m["id"] == ADMIN)["global_user_id"]
    rows = {table: [] for table in TABLE_KEYS}

    def add(table, **values):
        rows[table].append({"organization_id": ORG, **values})

    units = []
    for index, label in enumerate(UNIT_LABELS):
        uid = stable_id(f"unit:{index}")
        label = "[DEMO] " + label
        units.append({"unitId": uid, "label": label, "parentUnitId": None,
                      "lifecycle": "ACTIVE", "path": label})
        add("organizational_scope.scope", scope_id=uid, scope_type="UNIT", label=label,
            stable_code=f"DEMO20261114-U{index + 1}", provenance={"source": "SYNTHETIC_DEMO", "batch": BATCH},
            created_by_actor_type="HUMAN", created_by_actor_id=actor,
            updated_by_actor_type="HUMAN", updated_by_actor_id=actor)
    for index, name in enumerate(PEOPLE):
        pid = stable_id(f"person:{index}")
        add("organizational_scope.person", person_id=pid, name="[DEMO] " + name,
            email=f"pessoa{index + 1}@example.invalid", function_label="Investigador/a fictício/a",
            created_by=actor, updated_by=actor)
        add("organizational_scope.person_unit", person_id=pid,
            scope_id=units[index % 6]["unitId"], is_primary=True)
        add("organizational_scope.person_profile", person_id=pid, membership_id=None,
            biography=f"Perfil fictício para demonstração. {BATCH}. Sem conta de acesso.",
            keywords=UNIT_LABELS[index % 6] + "; investigação; inovação; sustentabilidade", updated_by=actor)
    for index, source in enumerate(sources):
        iid = stable_id(f"interest:{index}")
        unit = units[index % 6]
        notes = f"Interesse de demonstração {BATCH}; análise simulada, sem compromisso com o financiador."
        add("opportunity_catalog.opportunity_interest", interest_id=iid,
            central_opportunity_id=source["opportunity_id"], central_revision_id=source["revision_id"],
            central_snapshot=source["snapshot"], title=source["title"], notes=notes,
            created_by=actor, created_membership_id=ADMIN)
        add("opportunity_catalog.interest_unit", interest_id=iid, scope_id=unit["unitId"])
        add("opportunity_catalog.interest_change", interest_id=iid, revision=1, kind="REGISTER",
            title=source["title"], notes=notes, status="ACTIVE", unit_ids=uuid_array([unit["unitId"]]),
            unit_snapshot=[unit], actor_subject_id=actor, actor_membership_id=ADMIN)
    for index, app in enumerate(apps):
        if app["id"] != stable_id(f"application:{index}") or not app["title"].startswith("[DEMO] "):
            raise ValueError("Invalid batch application identity")
        source_index = index % 10
        source, unit = sources[source_index], units[source_index % 6]
        iid, aid = stable_id(f"interest:{source_index}"), app["id"]
        responsible = members[index % len(members)]["id"]
        stages = stage_path(app["status"])
        common = dict(application_id=aid, title=app["title"], responsible_membership_id=responsible,
                      deadline=app["deadline"], notes=app["notes"], total_budget=app["totalBudget"],
                      organization_budget=app["organizationBudget"], source_interest_id=iid, source_interest_revision=1)
        add("opportunity_catalog.application", **common, status=app["status"], revision=len(stages),
            created_by=actor, central_opportunity_id=source["opportunity_id"],
            central_revision_id=source["revision_id"], central_snapshot=source["snapshot"])
        for revision, status in enumerate(stages, 1):
            add("opportunity_catalog.application_change", **common, revision=revision,
                kind="CREATE" if revision == 1 else "TRANSITION",
                from_status=None if revision == 1 else stages[revision - 2], to_status=status,
                reason=None if revision == 1 else f"Simulação de estado para demonstração {BATCH}; sem submissão externa.",
                actor_subject_id=actor, unit_ids=uuid_array([unit["unitId"]]), unit_snapshot=[unit])
        add("opportunity_catalog.application_unit", application_id=aid, scope_id=unit["unitId"])
        revision = 1
        for member in members:
            revision += 1
            add("opportunity_catalog.application_participant", application_id=aid, membership_id=member["id"])
            add("opportunity_catalog.application_work_change", application_id=aid, revision=revision,
                kind="PARTICIPANT_ADDED", membership_id=member["id"], actor_subject_id=actor)
            add("opportunity_catalog.application_alert", application_id=aid,
                alert_id=stable_id(f"alert:{index}:{member['id']}"), recipient_membership_id=member["id"],
                event_key=f"{BATCH}:team:{aid}", type="APPLICATION_TEAM_ADDED",
                title=app["title"], message=f"Alerta fictício {BATCH}: participação na equipa de demonstração.")
        if len(app["tasks"]) != 3:
            raise ValueError("Each application must have three tasks")
        for task_index, task in enumerate(app["tasks"]):
            if task["id"] != stable_id(f"task:{index}:{task_index}") or task["status"] not in ("OPEN", "COMPLETED"):
                raise ValueError("Invalid task")
            task_values = dict(application_id=aid, task_id=task["id"], title=task["title"],
                               description=task["description"], deadline=task["deadline"], responsible_membership_id=responsible)
            add("opportunity_catalog.application_task", **task_values, status=task["status"])
            revision += 1
            add("opportunity_catalog.application_work_change", **task_values, revision=revision,
                kind="TASK_CREATED", status="OPEN", actor_subject_id=actor)
            if task["status"] == "COMPLETED":
                revision += 1
                add("opportunity_catalog.application_work_change", **task_values, revision=revision,
                    kind="TASK_COMPLETED", status="COMPLETED", actor_subject_id=actor)
        add("opportunity_catalog.application_work", application_id=aid, revision=revision)
        partner = app["partner"]
        if partner["id"] != stable_id(f"partner:{index}"):
            raise ValueError("Invalid partner identity")
        add("opportunity_catalog.application_partners", application_id=aid, revision=2)
        add("opportunity_catalog.application_partner", application_id=aid, partner_id=partner["id"], body=partner["body"])
        add("opportunity_catalog.application_partner_change", application_id=aid, revision=2,
            kind="PARTNER_CREATED", partner_id=partner["id"],
            snapshot={**partner["body"], "id": partner["id"], "active": True}, actor_subject_id=actor)
        if len(app["messages"]) != 2:
            raise ValueError("Each application must have two messages")
        for message_index, message in enumerate(app["messages"]):
            if message["id"] != stable_id(f"message:{index}:{message_index}"):
                raise ValueError("Invalid message identity")
            add("opportunity_catalog.application_chat_message", application_id=aid,
                author_membership_id=ADMIN, message_id=message["id"], body=message["body"])
    for index, label in enumerate(UNIT_LABELS):
        nid = stable_id(f"notice:{index}")
        title, body = "[DEMO] Reunião: " + label, f"Aviso fictício {BATCH}: rever as tarefas e os prazos das candidaturas de demonstração. Não implica uma reunião real."
        add("opportunity_catalog.organization_notice", notice_id=nid, author_subject_id=actor,
            author_membership_id=ADMIN, author_name=next(m for m in members if m["id"] == ADMIN)["display_name"],
            idempotency_key=stable_id(f"notice-key:{index}"),
            intention_digest=hashlib.sha256((BATCH + title + body).encode()).hexdigest(),
            title=title, message=body, recipient_count=len(members))
        for member in members:
            add("opportunity_catalog.organization_notice_recipient", notice_id=nid,
                recipient_membership_id=member["id"], notification_id=stable_id(f"notice-recipient:{index}:{member['id']}"),
                recipient_name=member["display_name"])
    return rows


def build_sql(rows):
    statements = ["BEGIN; SET LOCAL standard_conforming_strings=on; SET LOCAL lock_timeout='10s';",
                  "SET LOCAL statement_timeout='120s';", f"SET LOCAL app.organization_id={literal(ORG)};",
                  f"SET LOCAL app.membership_id={literal(ADMIN)};",
                  f"SELECT pg_advisory_xact_lock(hashtextextended({literal(BATCH)},0));"]
    for index, table in enumerate(TABLE_KEYS):
        # Brief table locks make preservation checks deterministic against simultaneous UI edits.
        statements.append(f"LOCK TABLE {table} IN SHARE ROW EXCLUSIVE MODE;")
        statements.append(f"CREATE TEMP TABLE demo_before_{index} ON COMMIT DROP AS SELECT to_jsonb(t) AS row FROM {table} t;")
    for table, records in rows.items():
        for row in records:
            if row["organization_id"] != ORG or any(not re.fullmatch(r"[a-z_]+", k) for k in row):
                raise ValueError("Invalid tenant or column")
            statements.append(f"INSERT INTO {table} ({','.join(row)}) VALUES ({','.join(literal(v) for v in row.values())});")
    statements.append("SET CONSTRAINTS ALL IMMEDIATE;")
    for index, (table, records) in enumerate(rows.items()):
        statements.append(f"""DO $demo$ BEGIN
          IF EXISTS(SELECT row FROM demo_before_{index} EXCEPT SELECT to_jsonb(t) FROM {table} t)
            THEN RAISE EXCEPTION 'PREVIOUS_ROWS_CHANGED:{table}'; END IF;
          IF (SELECT count(*) FROM {table})<>(SELECT count(*)+{len(records)} FROM demo_before_{index})
            THEN RAISE EXCEPTION 'COUNT_MISMATCH:{table}'; END IF;
        END $demo$;""")
    statements.append("COMMIT;")
    return "\n".join(statements) + "\n"


def backup(directory, database):
    destination = directory / (database + ".dump")
    with destination.open("xb") as stream:
        subprocess.run(["docker", "exec", CONTAINER, "pg_dump", "-U", "postgres", "-d", database, "-Fc"],
                       stdout=stream, stderr=subprocess.PIPE, check=True, timeout=240)
    if destination.stat().st_size < 1024:
        raise RuntimeError("Empty backup")
    with destination.open("rb") as stream:
        subprocess.run(["docker", "exec", "-i", CONTAINER, "pg_restore", "--list"],
                       stdin=stream, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=60)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--target", required=True, choices=["app-teste.c4g.ai"])
    args = parser.parse_args()
    folder = Path(__file__).resolve().parent
    plan = json.loads((folder / "demonstration-plan.json").read_text(encoding="utf-8"))
    central, tenant = DATABASES
    identity = query(central, "SELECT product_code,database_role FROM public.c4g_database_identity")
    if identity != [{"product_code": "C4G", "database_role": "CENTRAL"}]:
        raise RuntimeError("Central identity mismatch")
    tenant_identity = query(tenant, "SELECT product_code,database_role FROM c4g_system.tenant_identity")
    if tenant_identity != [{"product_code": "C4G", "database_role": "TENANT"}]:
        raise RuntimeError("Tenant identity mismatch")
    organizations = query(central, "SELECT id,slug,status FROM public.organization")
    if organizations != [{"id": ORG, "slug": "c4g-staging", "status": "ACTIVE"}]:
        raise RuntimeError("Unexpected staging organization")
    members = query(central, f"""SELECT m.id,m.global_user_id,m.base_role_code,u.display_name
        FROM public.organization_membership m JOIN public.global_user u ON u.id=m.global_user_id
        WHERE m.organization_id={literal(ORG)} AND m.status='ACTIVE' AND u.status='ACTIVE'
        AND m.valid_from<=now() AND (m.valid_until IS NULL OR m.valid_until>now()) ORDER BY m.id""")
    if {m["id"] for m in members} != MEMBERS or not any(m["id"] == ADMIN and m["base_role_code"] == "ORG_ADMIN" for m in members):
        raise RuntimeError("Membership authority changed")
    existing_apps = query(tenant, f"SELECT application_id,organization_id FROM opportunity_catalog.application WHERE application_id=ANY({uuid_array([a['id'] for a in plan['applications']])})")
    report_file = folder / "demonstration-result.json"
    if existing_apps:
        if len(existing_apps) == 30 and all(a["organization_id"] == ORG for a in existing_apps) and report_file.exists():
            prior = json.loads(report_file.read_text(encoding="utf-8"))
            if prior.get("batch") == BATCH and prior.get("committed") is True:
                print("DEMO_ALREADY_APPLIED_NO_WRITES " + str(report_file))
                return
        raise RuntimeError("Existing batch IDs require inspection; no writes attempted")
    if report_file.exists():
        raise RuntimeError("An earlier report exists; inspect before rerunning")
    interests = query(tenant, f"SELECT central_opportunity_id FROM opportunity_catalog.opportunity_interest WHERE organization_id={literal(ORG)}")
    excluded = uuid_array([r["central_opportunity_id"] for r in interests])
    sources = query(central, f"""SELECT o.opportunity_id,r.revision_id,o.title,r.snapshot
        FROM opportunity_catalog.opportunity o JOIN opportunity_catalog.revision r ON r.revision_id=o.current_revision_id
        WHERE o.lifecycle_state='ACTIVE' AND r.opportunity_id=o.opportunity_id
          AND NOT(o.opportunity_id=ANY({excluded})) AND length(o.title) BETWEEN 1 AND 2000
        ORDER BY o.opportunity_id LIMIT 10""")
    rows = build_rows(plan, members, sources)
    sql = build_sql(rows)
    counts = {table: len(records) for table, records in rows.items()}
    previous_counts = {table: query(tenant, f"SELECT count(*) AS count FROM {table}")[0]["count"] for table in rows}
    print(json.dumps({"batch": BATCH, "organizationId": ORG, "before": previous_counts, "planned": counts}, ensure_ascii=False), flush=True)
    if not args.apply:
        print("DEMO_PLAN_ONLY_NO_WRITES")
        return
    if os.geteuid() != 0:
        raise RuntimeError("Run this bounded load as root in Hostinger; no permanent privilege change is needed")
    # Refuse if any planned ID already exists, even in another organization.
    for table, key in TABLE_KEYS.items():
        ids = list({r[key] for r in rows[table]})
        if query(tenant, f"SELECT count(*) AS count FROM {table} WHERE {key}=ANY({uuid_array(ids)})")[0]["count"]:
            raise RuntimeError("Planned ID collision in " + table)
    os.umask(0o077)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup_dir = Path("/srv/c4g-staging/backups") / ("demo-" + run_id)
    backup_dir.mkdir(mode=0o700, parents=False, exist_ok=False)
    for database in DATABASES:
        backup(backup_dir, database)
    (backup_dir / "load.sql").write_text(sql, encoding="utf-8")
    manifest = {"batch": BATCH, "organizationId": ORG, "target": args.target,
                "before": previous_counts, "inserted": counts, "backupDirectory": str(backup_dir),
                "sqlSha256": hashlib.sha256(sql.encode()).hexdigest(), "committed": False,
                "ids": {t: sorted({r[TABLE_KEYS[t]] for r in rs}) for t, rs in rows.items()},
                "limitations": ["Direct SQL demonstration load, not HTTP workflow validation",
                                "No email, documents, invoices, accounts or access permissions created"]}
    (backup_dir / "manifest-before.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    result = subprocess.run(["docker", "exec", "-i", CONTAINER, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1",
                             "-U", "postgres", "-d", tenant], input=sql, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=240)
    (backup_dir / "psql.stdout").write_text(result.stdout, encoding="utf-8")
    (backup_dir / "psql.stderr").write_text(result.stderr, encoding="utf-8")
    if result.returncode:
        # PostgreSQL rolls back the uncommitted connection on failure. Never restore over existing data automatically.
        raise RuntimeError("LOAD_FAILED_INSPECT_NO_AUTOMATIC_RESTORE " + str(backup_dir / "psql.stderr"))
    manifest["committed"] = True
    manifest["after"] = {table: query(tenant, f"SELECT count(*) AS count FROM {table}")[0]["count"] for table in rows}
    manifest["verifiedBatchCounts"] = {t: query(tenant, f"SELECT count(*) AS count FROM {t} WHERE organization_id={literal(ORG)} AND {TABLE_KEYS[t]}=ANY({uuid_array(manifest['ids'][t])})")[0]["count"] for t in rows}
    if manifest["verifiedBatchCounts"] != counts:
        raise RuntimeError("COMMITTED_BUT_VERIFICATION_MISMATCH; inspect backup directory before any retry")
    with report_file.open("x", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2, ensure_ascii=False)
    os.chmod(report_file, 0o644)
    print("DEMO_COMMITTED_AND_VERIFIED " + str(report_file))


if __name__ == "__main__":
    main()
