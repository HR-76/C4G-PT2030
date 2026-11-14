#!/usr/bin/env bash
set -euo pipefail
umask 077
proof_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
test -f "$proof_dir/test/integration/user-deletion/keycloak.cjs"
node_image="$(docker inspect --format '{{.Config.Image}}' c4g-staging-api-api-1)"
case "$node_image" in c4g-staging-api:*) ;; *) echo 'Imagem inesperada'; exit 1;; esac
docker image inspect quay.io/keycloak/keycloak:26.8.0 >/dev/null
available_mb="$(awk '/MemAvailable:/ {print int($2/1024)}' /proc/meminfo)"
if [ "$available_mb" -lt 1500 ]; then echo 'PROVA_ADIADA: menos de 1500 MB de memória disponível.'; exit 1; fi
proof_suffix="$(python3 -c 'import secrets; print(secrets.token_hex(8))')"
proof_name="c4g-user-deletion-proof-$proof_suffix"
proof_env="$(mktemp /tmp/c4g-user-deletion-proof-XXXXXXXX.env)"
cleanup(){ docker rm -f "$proof_name" >/dev/null 2>&1 || true; rm -f -- "$proof_env"; }
trap cleanup EXIT
printf 'KC_BOOTSTRAP_ADMIN_USERNAME=deletion-proof\nKC_BOOTSTRAP_ADMIN_PASSWORD=%s\n' "$(python3 -c 'import secrets; print(secrets.token_hex(32))')" > "$proof_env"
echo 'A iniciar o Keycloak descartável, sem acesso à rede do staging…'
docker run --detach --pull=never --name "$proof_name" --network none --memory=768m --cpus=1 --tmpfs /opt/keycloak/data:rw,mode=1777 --env-file "$proof_env" quay.io/keycloak/keycloak:26.8.0 start-dev --http-enabled=true --hostname=http://127.0.0.1:8080 --hostname-strict=false >/dev/null
ready=false
for attempt in $(seq 1 60); do
 if docker run --rm --pull=never --network "container:$proof_name" --entrypoint node "$node_image" -e "fetch('http://127.0.0.1:8080/realms/master',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then ready=true; break; fi
 sleep 2
done
if [ "$ready" != true ]; then echo 'KEYCLOAK_ISOLADO_NAO_FICOU_PRONTO'; exit 1; fi
docker run --rm --pull=never --network "container:$proof_name" --env-file "$proof_env" --mount "type=bind,src=$proof_dir,dst=/proof,readonly" --entrypoint node "$node_image" /proof/test/integration/user-deletion/keycloak.cjs
echo 'PROVA_ISOLADA_CONCLUIDA; contas e serviços do staging não alterados.'
