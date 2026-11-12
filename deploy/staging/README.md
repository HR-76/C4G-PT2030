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

## Recolha de oportunidades (worker)

A recolha contacta a API pública da Comissão Europeia, por isso só corre quando a ligares de propósito, em duas partes:

1. **Fila.** O `install` instala o esquema `pgboss` da Central, se faltar, e cria a fila `funding-tenders-refresh`. É repetível.
2. **Variáveis.** O `env` só inclui a recolha com `--collection`. `--collection all` recolhe **tudo**: páginas de 100 (o máximo da fonte) encadeadas pela cobertura durável (`FUNDING_TENDERS_COVERAGE=durable-v1`) até esgotar a fonte; no ambiente local, 1119 registos foram 45 páginas e cerca de 81 segundos. `--collection 5` é um ensaio de 5 resultados, sem cobertura. Sem a opção o ambiente fica com `FUNDING_TENDERS_SOURCE=unconfigured`, o ecrã Fontes diz «Configuração indisponível» e nada é chamado.
3. **Worker.** Está no compose sob o perfil `collection`, que `up -d` não arranca sozinho: `docker compose -f deploy/staging/compose.yaml --profile collection up -d worker`. Para parar: `docker compose -f deploy/staging/compose.yaml --profile collection stop worker`.

A API pública da UE não devolve financiador e o contrato de oportunidade exige um; em staging o worker etiqueta os registos com «Financiador não indicado pela fonte (recolha de staging)» (nunca substitui um financiador que a fonte traga). É só para testar: produção usa o escritor v2 com revisão humana.

O worker só aceita a recolha de staging contra a base `c4g_central_staging` do anfitrião `c4g-postgres`, com TLS verificado e `NODE_ENV=production`; qualquer outra combinação impede o arranque. Cada atualização é pedida pelo administrador em Administração C4G → Fontes de oportunidades, com «Atualizar agora».

## Armazenamento privado (Cloudflare R2) e antivírus (ClamAV)

Liga duas funcionalidades que precisam de ficheiros privados verificados: os PDFs de faturação e o carregamento central do PT2030 (pré-visualização). Os documentos das candidaturas são outra peça (fila e worker próprios) e **não** ficam ligados por este passo. O ClamAV corre na mesma rede que a API (ambos partilham a rede do contentor `pod`), porque a aplicação só aceita um antivírus em `127.0.0.1:3310`; só arranca com o perfil `storage`.

**1. Na Cloudflare (tu).** R2 → criar dois buckets **privados** na jurisdição **UE** (por exemplo `c4g-staging-documents` e `c4g-staging-quarantine`; têm de ser diferentes) → «Manage API tokens» → token com permissão de leitura e escrita de objetos **só nesses dois buckets** → guardar o *Access Key ID*, o *Secret Access Key* e o endpoint `https://<conta>.eu.r2.cloudflarestorage.com`. Nunca colar estes valores no chat nem em Git.

**2. Ficheiro de valores na VPS.** Os valores ficam num ficheiro só do root. O bloco pede-os sem os mostrar (o segredo não aparece no ecrã):

```bash
install -m 600 /dev/null /srv/c4g-staging/r2.env
read -rp 'Endpoint R2 (https://...eu.r2.cloudflarestorage.com): ' V1
read -rp 'Bucket de documentos: ' V2
read -rp 'Bucket de quarentena: ' V3
read -rp 'Access Key ID: ' V4
read -rsp 'Secret Access Key (não aparece): ' V5; echo
printf 'C4G_R2_ENDPOINT=%s\nC4G_R2_DOCUMENTS_BUCKET=%s\nC4G_R2_QUARANTINE_BUCKET=%s\nC4G_R2_ACCESS_KEY_ID=%s\nC4G_R2_SECRET_ACCESS_KEY=%s\n' "$V1" "$V2" "$V3" "$V4" "$V5" > /srv/c4g-staging/r2.env
unset V1 V2 V3 V4 V5; chmod 600 /srv/c4g-staging/r2.env; wc -l /srv/c4g-staging/r2.env
```

A aplicação recusa construir o armazenamento sem a declaração `C4G_R2_LAYER_C_VALIDATED=true`, que é **tua**: só a acrescentas no passo 4, depois de a verificação passar. A verificação prova credenciais, buckets acessíveis e antivírus a responder; a validação funcional completa (escrita condicional, ficheiros grandes) só fica provada com um carregamento real no passo 7. `C4G_R2_MULTIPART_CONDITIONAL_VALIDATED` mantém-se desligado, por isso ficheiros que exijam envio em partes são recusados.

**3. Antivírus.** Descarrega as assinaturas ao arrancar (alguns minutos) e fica num volume persistente:

```bash
cd /srv/c4g-staging/src && export C4G_RELEASE=$(git rev-parse --short HEAD)
docker compose -f deploy/staging/compose.yaml --profile storage up -d clamav
until [ "$(docker inspect -f '{{.State.Health.Status}}' c4g-staging-api-clamav-1)" = healthy ]; do sleep 10; done; echo clamav pronto
```

**4. Verificar R2 e antivírus** (só imprime booleanos; não escreve nem lê objetos). O contentor junta-se à rede do «pod» (dono da rede da API e do antivírus), onde o antivírus escuta:

```bash
docker run --rm --network container:c4g-staging-api-pod-1 --env-file /srv/c4g-staging/r2.env c4g-staging-api:$C4G_RELEASE node scripts/staging/install.js storage-check
```

Esperado: `{"r2":true,"scanner":true}`. Se `r2` for `false`: token, endpoint, nomes dos buckets ou permissões. Se `scanner` for `false`: o passo 3 ainda não terminou. Só com os dois verdadeiros, faz a tua declaração:

```bash
echo 'C4G_R2_LAYER_C_VALIDATED=true' >> /srv/c4g-staging/r2.env
```

**5. Gerar o ambiente com o armazenamento.** Repete as mesmas opções que já usas (`--collection all` se a recolha estiver ligada); o `--storage` valida o ficheiro antes de escrever e recusa tudo o que não seja EU, buckets distintos ou declaração em falta:

```bash
docker run --rm --user 0:0 --env-file /srv/c4g-staging/postgres/.env -e C4G_STAGING_STATE=/state/install.json -v /srv/c4g-staging/state:/state -v /srv/c4g-staging/api-private.env:/carry.env:ro -v /srv/c4g-staging/r2.env:/r2.env:ro c4g-staging-api:$C4G_RELEASE node scripts/staging/install.js env --carry /carry.env --storage /r2.env --out /state/api-private.env.generated
```

**6. Ativar.** A API e o ClamAV partilham a rede do contentor `pod`, que nunca reinicia com a API (se a API fosse a dona, cada reinício criaria uma rede nova e o antivírus ficava para trás, deixando a API em ciclo de reinícios). Ao passar do compose antigo para este, o `pod` precisa da porta 8500 que a API antiga ocupa, por isso a API antiga é removida primeiro. Se alguma vez recriares o `pod` (por exemplo ao mudar a sua imagem), recria também o antivírus: `up -d --force-recreate clamav`; sem isso a API não fica pronta. A API pode reiniciar uma ou duas vezes até o antivírus responder, porque a prontidão (`/health/ready`) exige R2 e antivírus:

```bash
cp /srv/c4g-staging/state/api-private.env.generated /srv/c4g-staging/api-private.env && chmod 600 /srv/c4g-staging/api-private.env
docker compose -f deploy/staging/compose.yaml --profile storage rm -sf api clamav
docker compose -f deploy/staging/compose.yaml --profile storage up -d pod api clamav
sleep 60; curl -s -o /dev/null -w 'ready=%{http_code}\n' http://127.0.0.1:8500/health/ready
```

**7. Ensaio funcional (tu, no navegador).** Administração C4G: carregar uma folha de teste PT2030 e ver a pré-visualização; e, num ciclo de faturação, confirmar um PDF pequeno. Se algum falhar, diz-me o que o ecrã mostra.

**Voltar atrás:** gera o ambiente sem `--storage`, copia-o e recria a API (`up -d --force-recreate pod api`); as duas funcionalidades voltam a «indisponível». O ClamAV e os buckets não são apagados. Objetos já enviados ficam no R2.

## Subir os esquemas ao nível do ambiente local (Central 050 e tenant 040)

O `install` deixa a Central na 035 e o tenant na 033. O comando `upgrade` aplica, por ordem, os pacotes registados que o ambiente local usa: Central 042, 043, 044, 045, 048, 049 e 050 e tenant 034 a 040. Cada passo verifica o preflight da versão que deixou e o estado do tenant é publicado na Central. É repetível: o que já está aplicado é ignorado. **As migrações são irreversíveis**, por isso faz primeiro uma cópia:

```bash
install -d -m 700 /srv/c4g-staging/backups && for d in c4g_central_staging c4g_tenant_staging; do docker exec c4g-staging-postgres-db-1 pg_dump -U postgres -Fc $d > /srv/c4g-staging/backups/$d-$(date +%Y%m%d%H%M).dump; done; ls -la /srv/c4g-staging/backups | tail -4
```

Sem `--apply` o comando só mostra o que falta e não altera nada:

```bash
RUN="docker run --rm --user 0:0 --network container:c4g-staging-postgres-db-1 --env-file /srv/c4g-staging/postgres/.env -e C4G_STAGING_STATE=/state/install.json -v /srv/c4g-staging/state:/state c4g-staging-api:$C4G_RELEASE node scripts/staging/install.js"
$RUN upgrade
$RUN upgrade --apply
```

Depois reinicia a API (`docker compose -f deploy/staging/compose.yaml up -d --force-recreate`) e repete o `person` de cada conta, para a pessoa ficar projetada no tenant já na 040.

## Atualizar um staging já instalado

Depois de `git pull` e de construir a imagem nova (passo 1), repete, por esta ordem, os comandos de instalação e de variáveis. Ambos são repetíveis e não alteram o que já existe:

1. `install` (passo 2): cria, se faltar, o login só de leitura do catálogo (`c4g_catalog_staging`).
2. `env` (passo 3), com `--carry` apontado para o `api-private.env` atual: acrescenta `FUNDING_TENDERS_RUNTIME=central`, `FUNDING_TENDERS_SOURCE=unconfigured` e `CATALOG_DATABASE_URL`, que ligam o catálogo e o Dashboard.
3. `person` outra vez para cada conta com perfil (passo 4): aplica as permissões do perfil, cria a pessoa no tenant caso ainda não exista e passa as permissões antigas para a política de MFA opcional (`c4g-user-mfa-v1`).
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
- Sem o `upgrade`, o tenant fica na 033 e as páginas que dependem das migrações 034 a 040 (chat, estratégia, detalhe de tarefas, eliminação de documentos) ficam indisponíveis.
- A ligação da API à Central usa o administrador do PostgreSQL, como o perfil local. Um login limitado alteraria os fingerprints fixados da Central e exige um perfil de runtime próprio.
- Sem e-mail. R2 e ClamAV só depois do passo «Armazenamento privado»; os documentos das candidaturas continuam por ligar.
