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
sed -i "s#root \* /srv/c4g-staging-web/releases/[A-Za-z0-9._-]*#root * /srv/c4g-staging-web/releases/$C4G_RELEASE#" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
curl -s -o /dev/null -w 'ready=%{http_code}\n' http://127.0.0.1:8500/health/ready
```

Esperado: `ready=200`. Depois, abre `https://app-teste.c4g.ai` e entra com uma das contas.

## Voltar atrás

```bash
cp -a /srv/c4g-staging/api-private.env.neon-<data> /srv/c4g-staging/api-private.env
cd /srv/c4g-staging/api-release-0715f01 && docker compose up -d
sed -i "s#root \* /srv/c4g-staging-web/releases/[A-Za-z0-9._-]*#root * /srv/c4g-staging-web/releases/0715f01#" /etc/caddy/Caddyfile && systemctl reload caddy
```

A base PostgreSQL nova não é alterada pelo regresso; a release antiga volta a usar o Neon.

## Recolha de oportunidades (worker)

A recolha contacta a API pública da Comissão Europeia, por isso só corre quando a ligares de propósito, em duas partes:

1. **Fila.** O `install` instala o esquema `pgboss` da Central, se faltar, e cria a fila `funding-tenders-refresh`. É repetível.
2. **Variáveis.** O `env` só inclui a recolha com `--collection`. `--collection all` recolhe **tudo**: páginas de 100 (o máximo da fonte) encadeadas pela cobertura durável (`FUNDING_TENDERS_COVERAGE=durable-v1`) até esgotar a fonte; no ambiente local, 1119 registos foram 45 páginas e cerca de 81 segundos. `--collection all-sources` faz o mesmo e admite também o CORDIS, o Erasmus+, o Interreg Europe e o POCTEP (estes dois últimos leem os sítios oficiais `interregeurope.eu` e `poctep.eu`). `--collection 5` é um ensaio de 5 resultados, sem cobertura. Sem a opção o ambiente fica com `FUNDING_TENDERS_SOURCE=unconfigured`, o ecrã Fontes diz «Configuração indisponível» e nada é chamado.
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

**Logins de runtime da Central: desligados por decisão de 14/11/2026.** A API e o worker ligam à Central com o administrador do PostgreSQL, e o `env` gera essa ligação por omissão. Não corras `runtime-logins` nem uses `env --central-runtime-login` no staging: medido na VPS, o login limitado chega para o arranque, mas as páginas que dependem do tenant respondem 503 ([registo](../../context/features/staging-central-runtime-login.md)).

Os comandos continuam no instalador para quando existir o perfil de runtime completo. Nessa altura a ordem é `upgrade --apply`, depois `runtime-logins`, depois `env --central-runtime-login`, e o `compose.yaml` tem de voltar a carregar o ficheiro do worker (`worker-central.env`) a seguir ao `api-private.env`. Os logins só podem existir como membros de `c4g_central_runtime` depois de a cadeia Central estar completa, porque as pertenças mudam o fingerprint de cada versão a partir da 036. Para aplicar uma migração nova com as pertenças ativas, revoga-as primeiro (`REVOKE c4g_central_runtime FROM c4g_central_staging_api, c4g_central_staging_worker`).

Depois reinicia só a API (`docker compose -f deploy/staging/compose.yaml up -d --force-recreate api`; sem o nome do serviço o `pod` também é recriado, o antivírus fica na rede antiga e a API entra em ciclo de reinícios, como aconteceu em 14/11/2026) e repete o `person` de cada conta, para a pessoa ficar projetada no tenant já na 040.

### Central 053: complemento das oportunidades

O `upgrade` aplica também a Central 053 (`053_opportunity_complement`), a seguir à 052. Guarda a descrição e os dados complementares que o Admin C4G escreve na ficha de uma oportunidade e o que for recolhido de portugal2030.pt ([contrato](../../context/features/opportunity-description-presentation.md)). A migração é irreversível e uma release anterior deixa de arrancar depois dela: faz a cópia das bases antes. O código novo arranca com a Central ainda na 052 (a ficha fica sem complemento), por isso podes ativar a release primeiro e aplicar a migração depois. As pertenças dos logins de runtime não precisam de ser revogadas para a 053: a variante com as pertenças ativas foi medida e está admitida.

A recolha a partir de portugal2030.pt vem desligada. Liga-se com a variável `OPPORTUNITY_COMPLEMENT_COLLECTION` no `api-private.env`:

- `facts`: página do aviso, código, prioridade, tipologias e taxa.
- `facts-and-summary`: o mesmo, mais o resumo publicado.

O ficheiro é lido em bruto: a linha leva só `NOME=valor`, sem espaços nem comentário a seguir ao valor.

Os Termos e Condições do site não permitem copiar conteúdo sem autorização, salvo citação com a origem identificada; a escolha de copiar o resumo é do responsável pelo ambiente. **Decisão de 14/11/2026: `facts`.** O `env --carry` mantém esta linha quando o ficheiro é regenerado. Um valor diferente dos três aceites (`disabled`, `facts`, `facts-and-summary`) impede a API de arrancar.

Para a ligar num staging já instalado:

```bash
F=/srv/c4g-staging/api-private.env; grep -q '^OPPORTUNITY_COMPLEMENT_COLLECTION=' $F && sed -i 's/^OPPORTUNITY_COMPLEMENT_COLLECTION=.*/OPPORTUNITY_COMPLEMENT_COLLECTION=facts/' $F || echo 'OPPORTUNITY_COMPLEMENT_COLLECTION=facts' >> $F
cd /srv/c4g-staging/src && export C4G_RELEASE=$(git rev-parse --short HEAD) && docker compose -f deploy/staging/compose.yaml up -d --force-recreate api
```

Depois, em Oportunidades, o Admin C4G usa «Atualizar dados PT2030».

## Atualizar um staging já instalado

Depois de `git pull` e de construir a imagem nova (passo 1), repete, por esta ordem, os comandos de instalação e de variáveis. Ambos são repetíveis e não alteram o que já existe:

1. `install` (passo 2): cria, se faltar, o login só de leitura do catálogo (`c4g_catalog_staging`).
2. `env` (passo 3), com `--carry` apontado para o `api-private.env` atual: acrescenta `FUNDING_TENDERS_RUNTIME=central`, `FUNDING_TENDERS_SOURCE=unconfigured` e `CATALOG_DATABASE_URL`, que ligam o catálogo e o Dashboard.
3. `person` outra vez para cada conta com perfil (passo 4): aplica as permissões do perfil, cria a pessoa no tenant caso ainda não exista e passa as permissões antigas para a política de MFA opcional (`c4g-user-mfa-v1`).
4. Ativar (passo 6).

### Logs da plataforma

A página Administração C4G → Logs só funciona com `PLATFORM_LOGS_RUNTIME=central` no `api-private.env`; sem ela responde 503. O `env` passa a gerar a variável. Num staging já instalado basta acrescentar a linha ao ficheiro atual (não é preciso regenerá-lo, o que obrigaria a repetir `--collection` e `--storage`) e recriar a API:

```bash
grep -q '^PLATFORM_LOGS_RUNTIME=' /srv/c4g-staging/api-private.env || echo 'PLATFORM_LOGS_RUNTIME=central' >> /srv/c4g-staging/api-private.env
```

Com a variável ligada, a API recusa arrancar (`C4G_API_START_FAILED`) se a tabela `public.platform_support_event` (Central 026) não existir. O histórico começa no primeiro arranque com a variável.

### Conta de Técnico

```bash
cd /srv/c4g-staging/primeiro-utilizador-staging-0715f01
sed -e "s/utilizador-teste/tecnico-staging/" -e "s/utilizador.teste@c4g.invalid/tecnico.staging@c4g.invalid/" -e "s/'Utilizador'/'Tecnico'/g" -e "s/'Teste'/'Staging'/g" criar-keycloak.py > /tmp/criar-tecnico.py
TECNICO_SUBJECT=$(python3 /tmp/criar-tecnico.py); echo "$TECNICO_SUBJECT"; rm -f /tmp/criar-tecnico.py
$RUN person --subject "$TECNICO_SUBJECT" --name "Tecnico Staging" --email tecnico.staging@c4g.invalid --profile CONTRIBUTOR
```

## Convites e ativação de utilizadores

Liga «Adicionar utilizador» (Acessos, e Utilizadores de uma entidade na Administração C4G), as páginas `/api/activation` e o email de ativação. Contrato: [staging-member-invitations.md](../../context/features/staging-member-invitations.md). Sem estes passos, essas páginas respondem 503.

São quatro peças: o módulo de ativação no Keycloak, a configuração que o comando `members` escreve em `/srv/c4g-staging/members`, o envio de email (Resend) e a rede entre a API e o Keycloak. O Keycloak reinicia uma vez (o login fica indisponível durante esse arranque) e o `pod` da API é recriado uma vez, por causa da rede nova.

**1. Pasta e segredo da ponte.** Não contacta o Keycloak; repetir mantém o segredo:

```bash
cd /srv/c4g-staging/src && export C4G_RELEASE=$(git rev-parse --short HEAD)
install -d -m 700 -o 1000 -g 1000 /srv/c4g-staging/members
MEMBERS="docker run --rm --user 0:0 --env-file /srv/c4g-staging/api-oidc.env -e C4G_STAGING_STATE=/state/install.json -v /srv/c4g-staging/state:/state -v /srv/c4g-staging/members:/members"
$MEMBERS c4g-staging-api:$C4G_RELEASE node scripts/staging/install.js members --prepare
```

Esperado: `{"prepared":true,"realm":"c4g-staging",...}`. `STAGING_MEMBER_TARGET_REQUIRED` significa que `OIDC_ISSUER` ou `PUBLIC_APP_URL` não estão no `api-oidc.env`; acrescenta ao comando o `--env-file` onde estiverem.

**2. Módulo no Keycloak.** Constrói o JAR a partir do repositório (a imagem do Keycloak não muda):

```bash
install -d -m 755 /srv/c4g-staging/keycloak-providers
docker build --target build -t c4g-activation-build dev/keycloak/manual-activation
ID=$(docker create c4g-activation-build) && docker cp $ID:/proof/target/c4g-manual-activation-1.0.jar /srv/c4g-staging/keycloak-providers/c4g-manual-activation.jar && docker rm $ID
chmod 644 /srv/c4g-staging/keycloak-providers/c4g-manual-activation.jar
```

No compose do Keycloak (projeto `c4g-staging-keycloak`, em `/srv/c4g-staging`), acrescenta ao serviço `keycloak`, em `volumes`:

```yaml
      - /srv/c4g-staging/keycloak-providers/c4g-manual-activation.jar:/opt/keycloak/providers/c4g-manual-activation.jar:ro
      - /srv/c4g-staging/members/c4g-activation.properties:/opt/keycloak/conf/c4g-activation.properties:ro
```

Recria só o Keycloak com esse compose (`up -d keycloak`) e confirma que entra em `https://login-teste.c4g.ai` como antes. O Keycloak arranca com `start`, por isso deteta o JAR novo e reconstrói-se sozinho no arranque.

**3. Clientes, fluxo e conta técnica no Keycloak.** O comando corre na rede do contentor do Keycloak, porque o Caddy não expõe a API de administração. As credenciais de administração ficam num ficheiro só do root, pedido sem as mostrar, e são apagadas no fim:

```bash
install -m 600 /dev/null /srv/c4g-staging/keycloak-admin.env
read -rp 'Administrador do Keycloak: ' V1; read -rsp 'Palavra-passe (não aparece): ' V2; echo
printf 'C4G_KEYCLOAK_ADMIN_USER=%s\nC4G_KEYCLOAK_ADMIN_PASSWORD=%s\n' "$V1" "$V2" > /srv/c4g-staging/keycloak-admin.env; unset V1 V2
$MEMBERS --network container:c4g-staging-keycloak-keycloak-1 --env-file /srv/c4g-staging/keycloak-admin.env c4g-staging-api:$C4G_RELEASE node scripts/staging/install.js members --keycloak-internal http://keycloak:8080
rm -f /srv/c4g-staging/keycloak-admin.env
```

Esperado: `{"configured":true,...}` com os três clientes. Códigos de recusa:

- `STAGING_KEYCLOAK_UNAVAILABLE`: o Keycloak não responde em `http://localhost:8080` dentro do seu contentor. Indica a porta certa com `-e C4G_KEYCLOAK_ADMIN_URL=http://localhost:<porta>` e usa a mesma porta em `--keycloak-internal`.
- `STAGING_KEYCLOAK_ISSUER_NOT_FIXED`: um pedido interno não anuncia `https://login-teste.c4g.ai/realms/c4g-staging`. O worker não conseguiria usar a API de administração; o Keycloak precisa do `hostname` fixo.
- `STAGING_KEYCLOAK_REQUEST_FAILED_<estado>` ao criar o fluxo: o módulo do passo 2 não está carregado.

`--keycloak-internal` é o endereço por que a API chega ao Keycloak na rede `c4g-staging-keycloak_default` (nome do serviço e porta interna).

**4. Email de ativação (Resend).** O remetente tem de ser de um domínio verificado no Resend. Em staging, convida só endereços de teste:

```bash
install -m 600 /dev/null /srv/c4g-staging/activation-email.env
read -rsp 'Chave de API do Resend (não aparece): ' V1; echo; read -rp 'Remetente (ex.: C4G <acessos@dominio>): ' V2
printf 'RESEND_API_KEY=%s\nACTIVATION_EMAIL_FROM=%s\nACTIVATION_PUBLIC_URL=https://app-teste.c4g.ai\n' "$V1" "$V2" > /srv/c4g-staging/activation-email.env; unset V1 V2
```

**5. Ativar.** As duas linhas ficam no `api-private.env` e o `env --carry` mantém-nas. O `pod` é recriado (rede nova), por isso a API e o antivírus são recriados com ele; a API pode reiniciar até o antivírus responder:

```bash
F=/srv/c4g-staging/api-private.env; grep -q '^MEMBER_ONBOARDING_RUNTIME=' $F || printf 'MEMBER_ONBOARDING_RUNTIME=central\nMEMBER_ONBOARDING_DIRECTORY=/members\n' >> $F
docker compose -f deploy/staging/compose.yaml --profile storage rm -sf api clamav
docker compose -f deploy/staging/compose.yaml --profile storage up -d pod api clamav
sleep 90; curl -s -o /dev/null -w 'ready=%{http_code}\n' http://127.0.0.1:8500/health/ready
```

**6. Ensaio (tu, no navegador).** Em Acessos, «Adicionar utilizador» com um endereço teu; abrir o email, definir a palavra-passe e entrar.

Depois de um `upgrade` do tenant, repete o passo 3: o `worker.json` guarda o estado do esquema do tenant. Não apagues `/srv/c4g-staging/members`: a chave que lá está identifica as contas criadas e deriva as ligações de ativação ainda válidas.

**Voltar atrás:** retira as duas linhas `MEMBER_ONBOARDING_` do `api-private.env` e recria a API (`up -d --force-recreate api`). As páginas voltam a 503; as contas e os clientes criados no Keycloak ficam.

## Adesão de novas entidades

Liga «Convidar uma entidade» (Administração C4G → Entidades), a ficha da entidade e a criação da base própria de cada entidade nova. Contrato: [staging-entity-admission.md](../../context/features/staging-entity-admission.md). **Ainda não foi ensaiado na VPS** (fase 5 do contrato): seguir estes passos é o ensaio. Exige os convites de utilizadores já ligados (secção anterior).

O que muda: os dois clientes de ativação do Keycloak passam a aceitar também o retorno `/api/admission-activation/callback`; a API ganha um processo interno com o login de administração do PostgreSQL, que cria uma base `c4g_onb_<id>` por entidade; a pasta `/srv/c4g-staging/admissions` passa a guardar, cifradas, as credenciais dessas bases.

**1. Pasta e ficheiro do worker.** Corre na rede do contentor do Keycloak, como o passo 3 dos convites. Repetir mantém as chaves já escritas:

```bash
cd /srv/c4g-staging/src && export C4G_RELEASE=$(git rev-parse --short HEAD)
install -d -m 700 -o 1000 -g 1000 /srv/c4g-staging/admissions
install -m 600 /dev/null /srv/c4g-staging/keycloak-admin.env
read -rp 'Administrador do Keycloak: ' V1; read -rsp 'Palavra-passe (não aparece): ' V2; echo
printf 'C4G_KEYCLOAK_ADMIN_USER=%s\nC4G_KEYCLOAK_ADMIN_PASSWORD=%s\n' "$V1" "$V2" > /srv/c4g-staging/keycloak-admin.env; unset V1 V2
docker run --rm --user 0:0 --network container:c4g-staging-keycloak-keycloak-1 --env-file /srv/c4g-staging/postgres/.env --env-file /srv/c4g-staging/api-oidc.env --env-file /srv/c4g-staging/keycloak-admin.env -e C4G_STAGING_STATE=/state/install.json -v /srv/c4g-staging/state:/state -v /srv/c4g-staging/members:/members:ro -v /srv/c4g-staging/admissions:/admissions c4g-staging-api:$C4G_RELEASE node scripts/staging/install.js admission
rm -f /srv/c4g-staging/keycloak-admin.env
```

Esperado: `{"configured":true,"realm":"c4g-staging","clients":["c4g-member-activation","c4g-member-existing"],"files":["worker.json"]}`. Códigos de recusa: `STAGING_MEMBERS_REQUIRED` (falta o `worker.json` dos convites), `STAGING_MEMBER_CLIENTS_INVALID` (os clientes não foram criados por esta instalação), `STAGING_ADMISSION_REDIRECT_NOT_APPLIED` (o Keycloak não guardou a alteração), `STAGING_KEYCLOAK_ADMIN_REQUIRED` ou `…_REFUSED` (credenciais de administração).

**2. Confirmar que a Central tem as tabelas da adesão** (devem ser duas linhas com `t`):

```bash
docker exec c4g-staging-postgres-db-1 psql -U postgres -d c4g_central_staging -Atc "select to_regclass('public.entity_admission') is not null; select to_regclass('public.entity_admission_invitation') is not null"
```

**3. Ativar.** Só a API é recriada:

```bash
F=/srv/c4g-staging/api-private.env; grep -q '^ENTITY_ADMISSION_RUNTIME=' $F || printf 'ENTITY_ADMISSION_RUNTIME=central\nENTITY_ADMISSION_DIRECTORY=/admissions\n' >> $F
docker compose -f deploy/staging/compose.yaml up -d --force-recreate api
sleep 60; curl -s -o /dev/null -w 'ready=%{http_code}\n' http://127.0.0.1:8500/health/ready
```

Se a API não ficar pronta, o worker não arrancou (ficheiro recusado ou emissor diferente de `OIDC_ISSUER`): volta atrás e repete o passo 1. Um `worker.json` escrito antes de 23/11/2026 não tem `tenantRoles` e é recusado: repetir o passo 1 acrescenta-o e mantém as chaves.

Uma adesão que não avança aparece no registo da API como `C4G_ADMISSION_STEP_FAILED <passo>:<código>` (uma linha por mudança, sem mensagens): `docker logs c4g-staging-api-api-1 2>&1 | grep C4G_ADMISSION`. `TENANT:LOCAL_IDENTITY_UNEXPECTED_MEMBERSHIP` significa que os agregadores partilhados `c4g_tenant_api_capabilities` e `c4g_tenant_worker_capabilities` têm papéis diferentes dos de `tenantRoles`; compara-os antes de mexer em concessões.

**4. Ensaio (tu, no navegador).** Como Admin C4G, em Entidades, «Convidar uma entidade» com um endereço teu; abrir a ligação mostrada, definir a palavra-passe, preencher a ficha e submeter. Dentro de alguns segundos deve existir uma base nova:

```bash
docker exec c4g-staging-postgres-db-1 psql -U postgres -Atc "select datname from pg_database where datname like 'c4g\_onb\_%'"
```

**Depois de existirem entidades novas:**

- `upgrade` (sem `--apply`) mostra-as em `onboardedTenants`. Com passos tenant por aplicar, `upgrade --apply` recusa com `STAGING_UPGRADE_ONBOARDED_TENANTS_UNSUPPORTED`, porque só migra a base da entidade instalada. `upgrade --apply --skip-onboarded` prossegue; as entidades novas ficam no esquema anterior e podem ficar indisponíveis.
- A retenção do chat (90 dias) e a eliminação de utilizadores não abrangem as entidades novas.
- As cópias de segurança abrangem-nas sem mais passos.

**Guardar fora da VPS:** a pasta `/srv/c4g-staging/admissions` inteira (`worker.json` e as subpastas `credentials` e `provisioning`). Sem ela, ou sem a `journalKey` que está no `worker.json`, a API deixa de conseguir entrar nas bases das entidades novas, mesmo com as cópias de segurança das bases. Não apagues nem regeneres o `worker.json`.

**Voltar atrás:** retira as duas linhas `ENTITY_ADMISSION_` do `api-private.env` e recria a API (`up -d --force-recreate api`). As rotas de adesão deixam de existir; as bases já criadas, os registos na Central e as contas no Keycloak ficam, e as entidades novas ficam inacessíveis até a adesão voltar a ser ligada.

## Limites conhecidos

- O catálogo e o Dashboard ficam ativos mas **vazios**: a recolha de oportunidades (worker e fontes) ainda não está ligada.
- Sem o `upgrade`, o tenant fica na 033 e as páginas que dependem das migrações 034 a 040 (chat, estratégia, detalhe de tarefas, eliminação de documentos) ficam indisponíveis.
- A ligação da API à Central usa o administrador do PostgreSQL, como o perfil local. Um login limitado alteraria os fingerprints fixados da Central e exige um perfil de runtime próprio.
- Sem e-mail além do de ativação de utilizadores (passo «Convites e ativação de utilizadores»). R2 e ClamAV só depois do passo «Armazenamento privado»; os documentos das candidaturas continuam por ligar.
