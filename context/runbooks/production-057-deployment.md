# Produção: instalação inicial 058 e percurso histórico de upgrade 057

Atualização — instalador inicial: para uma instância nova, usar o [bootstrap completo até058](production-bootstrap-installer.md). Este substitui os passos manuais de criar Central/tenant e depois aplicar057/058; não executar o job de atualização057 sobre a Central já instalada até058. A configuração privada, a infraestrutura e a autorização de deploy continuam separadas. O staging permanece fora do âmbito.

Preparado em 15/11/2026. **Não aplicado.** Staging inalterado. Domínios confirmados: aplicação `gcni.c4g.ai`, login `login.c4g.ai`. Base histórica da integração atual: `af594e7ef6529770652a8bb51e63c0b3f0763c46` (`Prod 4`). As alterações locais posteriores ainda precisam de uma revisão final identificada; este trabalho não criou commit, tag, merge ou push.

Evidência histórica da preparação inicial: [CI #200](https://github.com/HR-76/C4G-PT2030/actions/runs/43739440762), observado com success para `6e0b8942c5bad38efddfbe1977b2a37ac23898d3` (`Prod 1`), e [testes locais dessa fase](../reviews/central-production-permissions-20261115/backend-suite-repair.md). Não representa CI de `Prod 4` nem da integração atual; exigir CI/ensaios da revisão final antes do corte.

## 1. Alvo e decisão de execução

Preparar uma instalação nova: PostgreSQL próprio, instância/volume/rede/credenciais separados; Keycloak próprio com base própria; aplicação na mesma VPS, conforme [decisão](../decisions/2026-11-15-production-postgresql-on-vps.md). Sem cópia de dados/segredos/contas de staging. A instrução de não alterar staging prevalece sobre os ensaios nesse ambiente sugeridos no plano histórico: usar ambiente descartável/novo de produção isolado e registar a exceção.

| Identificador | Preparado / por confirmar |
|---|---|
| Raiz | `/srv/c4g-production` |
| Compose da aplicação | `deploy/production/compose.yaml`; projeto `c4g-production-app` |
| Bootstrap inicial | `deploy/production/compose.bootstrap.yaml`; projeto `c4g-production-bootstrap`; plano por omissão |
| Redes externas exclusivas | `c4g-production-data`, `c4g-production-identity` |
| Central proposta | `c4g_central_production`, host TLS `c4g-production-postgres` |
| API | `127.0.0.1:8600`; verificar porta livre, sem alterar a 8500 existente |
| Frontend | `/srv/c4g-production/web/releases/<RELEASE_ID>`; build da mesma revisão API |
| Configuração | `/srv/c4g-production/config/<CONFIG_ID>`; instruções no [mapa de perfis](production-057-configuration.md) |
| Primeira entidade e administrador | **Por indicar pelo utilizador em configuração privada**; o instalador prepara tenant, perfis e diretório |
| Versão/digest PostgreSQL e Keycloak | **Por fixar e ensaiar**; 057 provada em PostgreSQL 18.6 descartável |
| Responsável, janela, RPO/RTO | **Por definir e testar** |
| Backups e recuperação externa | **Não demonstrados para produção** |

Não ativar tráfego enquanto houver bloqueios na secção 7. O compose preparado é da aplicação, não um instalador da VPS. Nunca usar `scripts/staging/install.js` ou os seus geradores/rollouts como atalho: introduzem alvos, flags, dados ou variantes específicas.

## 2. Artefactos e pré-requisitos

1. Identificar a revisão final, obter CI verde, fixar SHA completo, digest da imagem API, SHA256 do compose, CONFIG_ID e release de frontend. A etiqueta/merge para main previstos no plano de transição são uma ação separada; não executados aqui.
2. Construir a imagem API com `docker build --label org.opencontainers.image.revision=<SHA_COMPLETO> -f deploy/production/Dockerfile -t <imagem-candidata> .` na raiz da revisão. Publicar/reter o digest apenas na etapa autorizada e gerar frontend com `npm ci` e `npm run build` em builder limpo da mesma revisão; backend dependencies também são necessárias ao build frontend. `.dockerignore` exclui frontend do contexto API, por isso este Dockerfile não gera o frontend. Não usar `dist` antigo nem VITE_API_URL de testes; a configuração normal usa `/api`.
3. Fixar também imagens do pod e ClamAV por digest; não usar `latest`/`stable` como referência final. Copiar `release.env.example` para a pasta da release, preencher imagens `@sha256:...` e CONFIG_ID simples. Sem segredos nesse ficheiro.
4. Provisionar PostgreSQL e Keycloak em contentores/volumes/redes próprios, com TLS PostgreSQL e sem porta de base publicada no host. Validar memória/disco/ligações, incluindo ClamAV, pelo menos uma API e tenant(s). Os limites do compose são propostas a medir, não prova de capacidade. Não alterar limites ou reiniciar contentores de staging neste trabalho.
5. Para a instância nova, preparar e executar o [instalador completo](production-bootstrap-installer.md) pelo job isolado `compose.bootstrap.yaml`: Central até058, tenant até041, perfil `production-editorial-v1`, primeiro administrador e binding F4. O modo por omissão só planeia; `--apply` é explícito. Este percurso substitui o bootstrap manual até056 e os passos057/058 das secções3–4. A conta OIDC inicial verificada continua a ser pré-requisito externo; os dados reais da entidade/administrador aguardam o utilizador.
6. Configurar os inputs privados e rever os ficheiros gerados seguindo [configuração](production-057-configuration.md). A API carrega `api.env`, `central-runtime.env` e `api-features.env`; o worker usa `billing-mail.env` e a retenção `retention-runtime.env`. Convites/eliminação, faturação e email de autenticação/histórico estão no âmbito aprovado. Completar Keycloak, R2/scanner, backups fora da VPS e monitorização. Separar a credencial instaladora de todas as credenciais de serviço.
7. Fazer o checkpoint consistente e o ensaio de recuperação definidos no [rollback](production-057-rollback.md), antes do primeiro dado real e antes de cada upgrade.

## 3. Percurso histórico: verificar uma Central existente em 056

Esta secção e a seguinte são exclusivas do upgrade de uma Central já provisionada em056. **Não executar numa instalação inicial concluída pelo bootstrap058.** Nesse caso, seguir os recibos/preflights do instalador e avançar para a secção5 depois dos gates de aceitação.

Os comandos seguintes são o procedimento preparado **para execução futura aprovada**, na nova produção. Não foram executados neste trabalho. O operador identifica a instância/volume e confirma system identifier, base, rede e certificados contra o inventário de produção. O nome da base sozinho não prova que o alvo é correto.

Na pasta da revisão aprovada, usar sempre o ficheiro compose e o release.env de produção explícitos:

```bash
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.yaml --profile maintenance config --quiet
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.yaml --profile maintenance run --rm --no-deps migrate
```

O segundo comando **só verifica o nome da base e apresenta o plano**: não valida toda a baseline e não instala nada. Antes do apply, correr `preflightCentral` com o URL instalador e exigir a versão 056 genérica, ledger e fingerprints exatos. Não usar `scripts/preflightCentral.js` com o URL limitado NOINHERIT diretamente: esse CLI antigo não cria o role pool. Exemplo de preflight administrativo sem impressão de segredos:

```bash
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.yaml --profile maintenance run --rm --no-deps -T migrate node <<'NODE'
const {Pool}=require('pg');
const {databasePoolOptions}=require('./src/config/databaseConfig');
const pool=new Pool({...databasePoolOptions(process.env,'PRODUCTION_INSTALL_DATABASE_URL','CENTRAL_DB'),max:1});
(async()=>{
  try {
    const r=await require('./src/security/centralMigrationPreflight').preflightCentral(pool);
    if(r.currentVersion!=='056_email_delivery_history')throw Error('BASELINE_REQUIRED');
    console.log('PRODUCTION_056_PREFLIGHT_OK');
  } catch {console.error('PRODUCTION_PREFLIGHT_FAILED');process.exitCode=1;}
  finally {await pool.end();}
})();
NODE
```

Se o ledger já estiver em 057, parar e inventariar: pode ser uma tentativa parcialmente concluída. O runner SQL é repetível, mas o provisionador de logins recusa logins existentes. Não repetir apply às cegas nem remover logins para o fazer passar.

## 4. Percurso histórico: aplicar 057 e depois 058

Com baseline, checkpoint e âmbito validados, ficheiro `central-logins.json` com exatamente seis passwords independentes (mínimo 32 caracteres), e serviços de escrita parados:

```bash
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.yaml --profile maintenance run --rm --no-deps migrate node scripts/installProductionCentral.js --expected-database c4g_central_production --apply --credentials /run/private/central-logins.json
```

Guardar resultado sanitizado, SHA do código e checksums do pacote. Nunca imprimir ficheiros privados, SQL com passwords, env ou `docker inspect` com variáveis. O instalador primeiro commita 057, depois cria os seis logins numa transação separada; erro no segundo passo pode deixar 057 aplicada. Seguir a matriz de rollback, não deduzir que a base voltou a 056.

Conferir a configuração privada com cada login correspondente; provisionar separadamente a password do `c4g_authority_runtime`. Não montar install.env/central-logins.json na API. Remover o acesso instalador dos processos de serviço; manter os meios de recuperação com o operador.

Para convites e eliminação, aplicar de seguida o [pacote incremental058](production-058-account-lifecycle.md) pelo instalador próprio. Preserva057 e os logins; não repetir o provisionador057. O check e o apply da058 são explícitos e o arranque produtivo com esses runtimes exige o novo schema. Incluir058 no checkpoint, release e ensaio de rollback.

## 5. Arranque privado e verificação

```bash
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.yaml --profile release config --quiet
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.yaml --profile release up -d pod clamav api
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.yaml --profile billing-mail up -d billing-mail
curl --fail --silent --show-error http://127.0.0.1:8600/health/ready
```

O tráfego externo continua em manutenção. Esperar assinaturas do ClamAV e healthcheck; a API valida os quatro perfis novos, schema, leitor de catálogo, identidade Central, configuração tenant e capacidades selecionadas. O binding e as permissões de cada tenant são verificados nas operações: exigem o ensaio funcional abaixo, não estão todos provados pelo ready. Se falhar, não substituir credenciais por superutilizador nem remover flags de segurança. A prontidão não substitui os seguintes testes:

- Login/logout/step-up nos domínios finais, cookies Secure/HttpOnly/__Host e CSRF.
- Identidades SQL reais sem superutilizador/ownership/pertenças extra; logs sem eventos permission denied.
- Administrador cria manual e importa PT2030 até aceitação; cliente autorizado consulta; repetição não duplica. Originais e PDFs só pelo port autenticado; ClamAV e armazenamento reais.
- Pelo menos dois tenants de ensaio próprios: troca de contexto, ausência de leitura/escrita/exportação cruzada, revogação imediata. Remover/arquivar fixtures por processo aprovado antes de admitir clientes.
- Convite, ativação, mudança de perfil, revogação e eliminação, incluindo falha/retoma; validação de faturação e entrega pelo worker próprio; edição/publicação de email de autenticação e consulta do histórico. As dependências destes percursos aprovados são condições de abertura, sem omissão silenciosa de rotas.
- Backup externo, restauro, alerta e rotinas testados. Proposta de observação: 24 h no alvo isolado de ensaio/produção fechada, sem staging e sem elevar privilégios.

## 6. Publicação e corte

Preparar os dois vhosts de produção para revisão, sem substituir a configuração existente do proxy: `gcni.c4g.ai` serve a release frontend e encaminha `/api/*` e **explicitamente `/health/ready`** para 127.0.0.1:8600; o health nunca cai no fallback SPA. A sonda exige HTTP200 e JSON com `status="READY"`, não apenas HTTP200; `login.c4g.ai` encaminha apenas rotas públicas Keycloak da instância própria. Não expor admin API, métricas, management nem endpoints internos pelo vhost público. Não usar o Keycloak de staging.

Emitir CSP com frame-ancestors, X-Frame-Options e Referrer-Policy como headers HTTP e testar assets, OIDC e uploads. Definir trusted proxies e cadeia real de IP. A instalação atual de proxy não foi inspecionada neste trabalho; por isso não foi gerado um `sed` ou reload de configuração partilhada. Um reload mal feito pode afetar staging: o patch exato dos vhosts, validação do servidor e preservação das entradas existentes são condições do corte, não passos automáticos deste bundle.

Depois dos gates, aprovar a janela com o responsável e só então publicar DNS/proxy e admitir tráfego. Verificar ready externamente, login e primeiro percurso autorizado. Guardar recibo de release, configuração, base, backup e responsável. Nenhuma alteração DNS, proxy, VPS ou staging foi efetuada aqui.

## 7. Critério de avanço / pendências

**A preparação pode ser revista; a execução produtiva ainda depende de:** dados privados da primeira entidade e administrador; configuração privada e aceite integrado de convites/eliminação/faturação/email; versões/digests e recursos da infraestrutura; evidência de backup/restauro/RPO/RTO/responsável; configuração real Keycloak/R2/certificados/proxy; ensaio Docker isolado; ensaio de rollback e release final identificada. O bootstrap Central058/tenant041 e o perfil editorial/PQ1 já têm implementação e gates próprios; falta aplicá-los no alvo final após aprovação, não criar um percurso manual até056. Os testes locais não comprovam os fornecedores reais.

O bloqueio de código da gestão de acessos com MFA opcional foi [corrigido localmente](../features/platform-access-optional-mfa.md), sem deploy. Incluir a correção na release candidata e validar o percurso OIDC de confirmação de sessão no ensaio isolado. O recibo `production-preparation.json` preserva o estado e os hashes da preparação anterior à correção; não representa os ficheiros atuais.

O rollback preparado é [este procedimento](production-057-rollback.md). Não usar down -v, apagar ledger, restaurar sobre staging ou voltar à imagem anterior sem prova de compatibilidade057. Na primeira entrada não existe uma release de produção anterior: a resposta segura é manutenção, correção sobre057 ou recuperação isolada com reconciliação explícita.

## 8. Validação desta preparação

Os testes `test/production-preparation.test.cjs` e `test/production-rehearsal.test.cjs` validam a estrutura dos modelos e o executor com Docker simulado: isolamento, separação de credenciais, bootstrap por omissão em plano, coerência dos mounts, imagens imutáveis, bloqueio de contextos/builders remotos e limpeza limitada ao projeto criado. O [ensaio Docker preparado](../../deploy/rehearsal/production/README.md) distingue a prova da imagem candidata/PostgreSQL da aceitação HTTP e dos fornecedores reais.

Docker não está disponível nesta máquina: não houve `docker compose config`, construção de imagem, arranque de contentores ou ensaio de proxy/infraestrutura. Os gates PostgreSQL descartáveis e as suites da integração são registados separadamente; não implicam alterações de runtime em staging/produção nem execução Docker. Não foi observado CI novo nem publicado este pacote.

[Validação da integração atual](../reviews/production-release-integration-20261115/validation.md): instalação limpa e retomas em PostgreSQL descartável, suites completas e limites do ensaio preparado.

[Recibo histórico da preparação inicial](../reviews/central-production-permissions-20261115/production-preparation.json): revisão base, CI observado, contagens e hashes daquela fase. Os hashes não identificam os ficheiros atuais nem uma release já publicada.
