# Partilhado por backup.sh e restore-test.sh (não se executa sozinho). Contrato: context/features/staging-backups.md.
ROOT=/srv/c4g-staging
PG_CONTAINER=c4g-staging-postgres-db-1
KEY_FILE="$ROOT/backup/backup.key"
WORK="$ROOT/backup/work"
R2_ENV="$ROOT/r2.env"
DATABASES=(c4g_central_staging c4g_tenant_staging)
# Imagem da API mais recente construída nesta VPS (contém scripts/staging/r2Backup.js). C4G_RELEASE força uma etiqueta.
RELEASE="${C4G_RELEASE:-$(docker images c4g-staging-api --format '{{.Tag}}' 2>/dev/null | head -n 1)}"
IMAGE="c4g-staging-api:$RELEASE"

# Contagens registadas no manifesto no momento da cópia e repetidas no restauro (mesma consulta nos dois lados).
TABLES_SQL="select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'"
EVENTS_SQL="select count(*) from audit.event"

log() { printf '{"at":"%s","step":"%s"}\n' "$(date -u +%FT%TZ)" "$1"; }

# Cliente R2 dentro da imagem da API (a pasta de trabalho aparece em /b). Só imprime JSON sem segredos.
r2() { docker run --rm --user 0:0 --env-file "$R2_ENV" -v "$WORK":/b "$IMAGE" node scripts/staging/r2Backup.js "$@"; }

encrypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$KEY_FILE" -in "$1" -out "$2"; }
decrypt() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass "file:$KEY_FILE" -in "$1" -out "$2"; }

require_ready() {
  [ -s "$KEY_FILE" ] || { echo "BACKUP_KEY_MISSING"; exit 1; }
  [ -s "$R2_ENV" ] || { echo "BACKUP_R2_ENV_MISSING"; exit 1; }
  docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "BACKUP_IMAGE_MISSING $IMAGE"; exit 1; }
  install -d -m 700 "$WORK"
}
