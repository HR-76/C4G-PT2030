# Staging na VPS: instalação e atualização

Contrato: [staging-vps-deployment.md](../../context/features/staging-vps-deployment.md). Tudo corre na VPS, como `root`, em `/srv/c4g-staging/`. Nenhum comando imprime segredos.

Pressupostos: PostgreSQL em `/srv/c4g-staging/postgres` (contentor `c4g-staging-postgres-db-1`, rede `c4g-staging-data`, bases `c4g_central_staging` e `c4g_tenant_staging`), Keycloak com o realm `c4g-staging` e o Caddy já a servir `app-teste.c4g.ai` e `login-teste.c4g.ai`.

## 1. Código e imagem

```bash
cd /srv/c4g-staging
[ -d src ] || git clone https://github.com/HR-76/C4G-PT2030.git src
cd src && git fetch origin && git checkout <ramo-ou-sha> && git pull --ff-only
export C4G_RELEASE=$(git rev-parse --short HEAD); echo "$C4G_RELEASE"
docker compose -f deploy/staging/compose.yaml build
```

## 2. Instalar esquemas, organização e tenant

Só na primeira vez. O comando é repetível: sem alterações, devolve o mesmo resultado. O contentor partilha a rede do PostgreSQL, por isso a ligação de administração nunca sai da máquina.

```bash
install -d -m 700 /srv/c4g-staging/state
docker run --rm --user 0:0 --network container:c4g-staging-postgres-db-1 --env-file /srv/c4g-staging/postgres/.env -e C4G_STAGING_STATE=/state/install.json -v /srv/c4g-staging/state:/state c4g-staging-api:$C4G_RELEASE node scripts/staging/install.js install
```

Resultado esperado: uma linha JSON com `organizationId`, `tenantId`, `centralVersion` `035_funding_source_resolution` e `tenantVersion` `033_organizational_opportunity_interests`. Um código em maiúsculas (por exemplo `STAGING_INSTALL_FAILED`) indica falha; o estado fica em `/srv/c4g-staging/state/install.json` (modo 600).

## 3. Variáveis privadas da API

Gera o ficheiro novo ao lado do atual, sem lhe tocar. Copia do ficheiro anterior só as definições não secretas (política de autenticação, URLs de retorno, sessão).

```bash
cp -a /srv/c4g-staging/api-private.env /srv/c4g-staging/api-private.env.neon-$(date +%Y%m%d)
docker run --rm --user 0:0 --env-file /srv/c4g-staging/postgres/.env -e C4G_STAGING_STATE=/state/install.json -v /srv/c4g-staging/state:/state -v /srv/c4g-staging/api-private.env:/carry.env:ro c4g-staging-api:$C4G_RELEASE node scripts/staging/install.js env --carry /carry.env --out /state/api-private.env.generated
```

## 4. Utilizadores

Cria as contas no Keycloak com o script que já existe (pede a palavra-passe com 16 ou mais caracteres e imprime o identificador da conta). Corre uma vez por conta:

```bash
cd /srv/c4g-staging/primeiro-utilizador-staging-0715f01
sed -e "s/utilizador-teste/admin-staging/" -e "s/utilizador.teste@c4g.invalid/admin.staging@c4g.invalid/" -e "s/'Utilizador'/'Admin'/g" -e "s/'Teste'/'Staging'/g" criar-keycloak.py > /tmp/criar-admin.py
ADMIN_SUBJECT=$(python3 /tmp/criar-admin.py); echo "$ADMIN_SUBJECT"
sed -e "s/utilizador-teste/gestor-staging/" -e "s/utilizador.teste@c4g.invalid/gestor.staging@c4g.invalid/" -e "s/'Utilizador'/'Gestor'/g" -e "s/'Teste'/'Staging'/g" criar-keycloak.py > /tmp/criar-gestor.py
GESTOR_SUBJECT=$(python3 /tmp/criar-gestor.py); echo "$GESTOR_SUBJECT"
rm -f /tmp/criar-admin.py /tmp/criar-gestor.py
```

Liga cada conta à plataforma. `--platform-admin` dá a Administração C4G; `--profile` dá um perfil da organização de staging (`ORG_ADMIN` Administrador, `FUNDING_MANAGER` Gestor de candidaturas, `CONTRIBUTOR` Técnico, `VIEWER`). O comando concede as mesmas permissões que a aplicação dá ao perfil e cria a pessoa no diretório do tenant:

```bash
RUN="docker run --rm --user 0:0 --network container:c4g-staging-postgres-db-1 --env-file /srv/c4g-staging/postgres/.env --env-file /srv/c4g-staging/api-oidc.env -e C4G_STAGING_STATE=/state/install.json -v /srv/c4g-staging/state:/state c4g-staging-api:$C4G_RELEASE node scripts/staging/install.js"
$RUN person --subject "$ADMIN_SUBJECT" --name "Administrador Staging" --email admin.staging@c4g.invalid --platform-admin
$RUN person --subject "$GESTOR_SUBJECT" --name "Gestor Staging" --email gestor.staging@c4g.invalid --profile ORG_ADMIN
```

## 5. Frontend

```bash
docker run --rm -v /srv/c4g-staging/src:/src -w /src node:24-bookworm-slim sh -ec "npm ci --prefix backend --omit=dev --no-audit --no-fund && cd frontend && npm ci --no-audit --no-fund && npm run build"
mkdir -p /srv/c4g-staging-web/releases/$C4G_RELEASE && cp -a /srv/c4g-staging/src/frontend/dist/. /srv/c4g-staging-web/releases/$C4G_RELEASE/
```

## 6. Ativar

```bash
cp /srv/c4g-staging/state/api-private.env.generated /srv/c4g-staging/api-private.env && chmod 600 /srv/c4g-staging/api-private.env
cd /srv/c4g-staging/src && docker compose -f deploy/staging/compose.yaml up -d
sed -i "s#root \* /srv/c4g-staging-web/releases/[A-Za-z0-9]*#root * /srv/c4g-staging-web/releases/$C4G_RELEASE#" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
curl -s -o /dev/null -w 'ready=%{http_code}\n' http://127.0.0.1:8500/health/ready
```

Esperado: `ready=200`. Depois, abre `https://app-teste.c4g.ai` e entra com uma das contas.

## Voltar atrás

```bash
cp -a /srv/c4g-staging/api-private.env.neon-<data> /srv/c4g-staging/api-private.env
cd /srv/c4g-staging/api-release-0715f01 && docker compose up -d
sed -i "s#root \* /srv/c4g-staging-web/releases/[A-Za-z0-9]*#root * /srv/c4g-staging-web/releases/0715f01#" /etc/caddy/Caddyfile && systemctl reload caddy
```

A base PostgreSQL nova não é alterada pelo regresso; a release antiga volta a usar o Neon.

## Atualizar um staging já instalado

Depois de `git pull` e de construir a imagem nova (passo 1), repete, por esta ordem, os comandos de instalação e de variáveis. Ambos são repetíveis e não alteram o que já existe:

1. `install` (passo 2): cria, se faltar, o login só de leitura do catálogo (`c4g_catalog_staging`).
2. `env` (passo 3), com `--carry` apontado para o `api-private.env` atual: acrescenta `FUNDING_TENDERS_RUNTIME=central`, `FUNDING_TENDERS_SOURCE=unconfigured` e `CATALOG_DATABASE_URL`, que ligam o catálogo e o Dashboard.
3. `person` outra vez para cada conta com perfil (passo 4): aplica as permissões do perfil e cria a pessoa no tenant, caso ainda não exista.
4. Ativar (passo 6).

### Conta de Técnico

```bash
cd /srv/c4g-staging/primeiro-utilizador-staging-0715f01
sed -e "s/utilizador-teste/tecnico-staging/" -e "s/utilizador.teste@c4g.invalid/tecnico.staging@c4g.invalid/" -e "s/'Utilizador'/'Tecnico'/g" -e "s/'Teste'/'Staging'/g" criar-keycloak.py > /tmp/criar-tecnico.py
TECNICO_SUBJECT=$(python3 /tmp/criar-tecnico.py); echo "$TECNICO_SUBJECT"; rm -f /tmp/criar-tecnico.py
$RUN person --subject "$TECNICO_SUBJECT" --name "Tecnico Staging" --email tecnico.staging@c4g.invalid --profile CONTRIBUTOR
```

## Limites conhecidos

- O catálogo e o Dashboard ficam ativos mas **vazios**: a recolha de oportunidades (worker e fontes) ainda não está ligada.
- O tenant fica na versão 033. As migrações 034 a 040 têm cada uma o seu executor e ainda não estão neste instalador; as páginas que dependem delas (chat, estratégia, detalhe de tarefas, eliminação de documentos) ficam indisponíveis até serem aplicadas.
- A ligação da API à Central usa o administrador do PostgreSQL, como o perfil local. Um login limitado alteraria os fingerprints fixados da Central e exige um perfil de runtime próprio.
- Não há worker, R2, e-mail nem ClamAV.
