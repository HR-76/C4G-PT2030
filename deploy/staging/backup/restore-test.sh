#!/usr/bin/env bash
# Teste de restauro: descarrega a última cópia de cada base do R2, decifra e restaura num PostgreSQL 18 descartável
# (contentor sem rede, removido no fim). Não toca nas bases do staging. Código diferente de zero em qualquer falha.
# Contrato: context/features/staging-backups.md · Operação: context/runbooks/staging-backups.md
set -uo pipefail
umask 077
source "$(dirname "$0")/common.sh"

require_ready
NAME="c4g-restore-test-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"/*; }
trap cleanup EXIT

fail=0
sql() { docker exec "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -Atq "$@"; }

log "start-throwaway-postgres"
docker run -d --name "$NAME" --network none -e POSTGRES_PASSWORD="$(openssl rand -hex 16)" postgres:18 >/dev/null || { echo "RESTORE_CONTAINER_FAILED"; exit 1; }
ready=0
for _ in $(seq 1 45); do docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1 && { ready=1; break; }; sleep 2; done
[ "$ready" = 1 ] || { echo "RESTORE_POSTGRES_NOT_READY"; exit 1; }
sleep 3

for db in "${DATABASES[@]}"; do
  log "restore:$db"
  rm -f "$WORK"/restore-*
  if ! r2 latest --database "$db" --out "/b/restore-$db.dump.enc" --manifest-out "/b/restore-$db.json" >/dev/null; then echo "RESTORE_FAIL $db no-copy-in-r2"; fail=1; continue; fi
  if ! decrypt "$WORK/restore-$db.dump.enc" "$WORK/restore-$db.dump"; then echo "RESTORE_FAIL $db decrypt"; fail=1; continue; fi
  docker cp "$WORK/restore-$db.dump" "$NAME:/tmp/$db.dump" && docker cp "$WORK/restore-$db.json" "$NAME:/tmp/$db.json" || { echo "RESTORE_FAIL $db copy"; fail=1; continue; }

  # Os papéis c4g_* do manifesto (só nomes, sem ligação) têm de existir antes do restauro, como no servidor de origem.
  sql -c "DO \$\$ DECLARE r text; BEGIN FOR r IN SELECT jsonb_array_elements_text(pg_read_file('/tmp/$db.json')::jsonb->'roles') LOOP IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I NOLOGIN', r); END IF; END LOOP; END \$\$" || { echo "RESTORE_FAIL $db roles"; fail=1; continue; }
  sql -c "CREATE DATABASE restore_check ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' TEMPLATE template0" || { echo "RESTORE_FAIL $db create"; fail=1; continue; }

  if ! docker exec "$NAME" pg_restore -U postgres -d restore_check --exit-on-error "/tmp/$db.dump" 2>"$WORK/restore-$db.err"; then
    echo "RESTORE_FAIL $db pg_restore"; head -n 5 "$WORK/restore-$db.err"; fail=1
    sql -c "DROP DATABASE IF EXISTS restore_check WITH (FORCE)" >/dev/null 2>&1; continue
  fi

  events=$(sql -d restore_check -c "$EVENTS_SQL")
  tables=$(sql -d restore_check -c "$TABLES_SQL")
  want_events=$(sql -c "select (pg_read_file('/tmp/$db.json')::jsonb->>'auditEvents')::bigint")
  want_tables=$(sql -c "select (pg_read_file('/tmp/$db.json')::jsonb->>'tables')::int")
  if [ "$events" -ge "$want_events" ] && [ "$tables" -eq "$want_tables" ]; then verdict=ok; else verdict=FAIL; fail=1; fi
  printf '{"database":"%s","restore":"%s","auditEvents":%s,"manifestAuditEvents":%s,"tables":%s,"manifestTables":%s}\n' "$db" "$verdict" "$events" "$want_events" "$tables" "$want_tables"
  sql -c "DROP DATABASE restore_check WITH (FORCE)" >/dev/null
done

[ "$fail" = 0 ] && log "restore-test-ok" || log "restore-test-failed"
exit "$fail"
