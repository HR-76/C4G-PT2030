#!/usr/bin/env bash
# Cópia diária das bases do staging para o R2 (pasta backups/staging/). Corre como root, via systemd.
# Contrato: context/features/staging-backups.md · Operação: context/runbooks/staging-backups.md
set -euo pipefail
umask 077
source "$(dirname "$0")/common.sh"

exec 9>/var/lock/c4g-staging-backup.lock
flock -n 9 || { echo "BACKUP_ALREADY_RUNNING"; exit 0; }

require_ready
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
trap 'rm -rf "$WORK"/*' EXIT

for db in "${DATABASES[@]}"; do
  log "dump:$db"
  # Manifesto: contagens e papéis (só nomes) no momento da cópia, para o teste de restauro.
  docker exec "$PG_CONTAINER" psql -U postgres -d "$db" -Atc "select json_build_object('database',current_database(),'serverVersion',current_setting('server_version_num'),'auditEvents',($EVENTS_SQL),'tables',($TABLES_SQL),'roles',(select coalesce(json_agg(rolname order by rolname),'[]'::json) from pg_roles where rolname like 'c4g\_%'))" > "$WORK/$db.json"
  docker exec "$PG_CONTAINER" pg_dump -U postgres -Fc "$db" > "$WORK/$db.dump"
  [ -s "$WORK/$db.dump" ] || { echo "BACKUP_DUMP_EMPTY $db"; exit 1; }
  encrypt "$WORK/$db.dump" "$WORK/$db.dump.enc"
  rm -f "$WORK/$db.dump"
  log "upload:$db"
  r2 put "/b/$db.dump.enc" --database "$db" --stamp "$STAMP"
  r2 put "/b/$db.json" --database "$db" --stamp "$STAMP" --kind manifest
  rm -f "$WORK/$db.dump.enc" "$WORK/$db.json"
done

log "prune"
args=(); for db in "${DATABASES[@]}"; do args+=(--database "$db"); done
r2 prune "${args[@]}" --apply
log "status"
r2 status "${args[@]}"
