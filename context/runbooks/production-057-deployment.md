# Produção: preparação da migração 057 e deploy

Atualização — instalador inicial: para uma instância nova, usar o [bootstrap completo até058](production-bootstrap-installer.md). Este substitui os passos manuais de criar Central/tenant e depois aplicar057/058; não executar o job de atualização057 sobre a Central já instalada até058. A configuração privada, a infraestrutura e a autorização de deploy continuam separadas. O staging permanece fora do âmbito.

Preparado em 15/11/2026. **Não aplicado.** Staging inalterado. Domínios confirmados: aplicação `gcni.c4g.ai`, login `login.c4g.ai`. Base de código: `6e0b8942c5bad38efddfbe1977b2a37ac23898d3` (`Prod 1`, ramo local `staging-vps`). O bundle de preparação acrescentado neste trabalho ainda precisa de commit/release identificados; não foi criado commit, tag, merge ou push.

CI consultado no GitHub para o commit base: [CI #200](https://github.com/HR-76/C4G-PT2030/actions/runs/43739440762), concluído com success. Os testes locais anteriores estão [registados](../reviews/central-production-permissions-20261115/backend-suite-repair.md). Isto não substitui CI/ensaios da release final que incluir estes artefactos.

## 1. Alvo e decisão de execução

Preparar uma instalação nova: PostgreSQL próprio, instância/volume/rede/credenciais separados; Keycloak próprio com base própria; aplicação na mesma VPS, conforme [decisão](../decisions/2026-11-15-production-postgresql-on-vps.md). Sem cópia de dados/segredos/contas de staging. A instrução de não alterar staging prevalece sobre os ensaios nesse ambiente sugeridos no plano histórico: usar ambiente descartável/novo de produção isolado e registar a exceção.

| Identificador | Preparado / por confirmar |
|---|---|
| Raiz | `/srv/c4g-production` |
| Compose da aplicação | `deploy/production/compose.yaml`; projeto `c4g-production-app` |
| Redes externas exclusivas | `c4g-production-data`, `c4g-production-identity` |
| Central proposta | `c4g_central_production`, host TLS `c4g-production-postgres` |
| API | `127.0.0.1:8600`; verificar porta livre, sem alterar a 8500 existente |
| Frontend | `/srv/c4g-production/web/releases/<RELEASE_ID>`; build da mesma revisão API |
| Configuração | `/srv/c4g-production/config/<CONFIG_ID>`; instruções no [mapa de perfis](production-057-configuration.md) |
| Primeira entidade, UUIDs e tenant | **Por definir/provisionar** |
| Versão/digest PostgreSQL e Keycloak | **Por fixar e ensaiar**; 057 provada em PostgreSQL 18.6 descartável |
| Responsável, janela, RPO/RTO | **Por definir e testar** |
| Backups e recuperação externa | **Não demonstrados para produção** |

Não ativar tráfego enquanto houver bloqueios na secção 7. O compose preparado é da aplicação, não um instalador da VPS. Nunca usar `scripts/staging/install.js` ou os seus geradores/rollouts como atalho: introduzem alvos, flags, dados ou variantes específicas.

## 2. Artefactos e pré-requisitos

1. Identificar a revisão final, obter CI verde, fixar SHA completo, digest da imagem API, SHA256 do compose, CONFIG_ID e release de frontend. A etiqueta/merge para main previstos no plano de transição são uma ação separada; não executados aqui.
2. Construir a imagem API com `docker build -f deploy/production/Dockerfile -t <imagem-candidata> .` na raiz da revisão. Publicar/reter o digest e gerar frontend com `npm ci` e `npm run build` em builder limpo da mesma revisão; backend dependencies também são necessárias ao build frontend. `.dockerignore` exclui frontend do contexto API, por isso este Dockerfile não gera o frontend. Não usar `dist` antigo nem VITE_API_URL de testes; a configuração normal usa `/api`.
3. Fixar também imagens do pod e ClamAV por digest; não usar `latest`/`stable` como referência final. Copiar `release.env.example` para a pasta da release, preencher imagens `@sha256:...` e CONFIG_ID simples. Sem segredos nesse ficheiro.
4. Provisionar PostgreSQL e Keycloak em contentores/volumes/redes próprios, com TLS PostgreSQL e sem porta de base publicada no host. Validar memória/disco/ligações, incluindo ClamAV, pelo menos uma API e tenant(s). Os limites do compose são propostas a medir, não prova de capacidade. Não alterar limites ou reiniciar contentores de staging neste trabalho.
5. Bootstrap **genérico** da Central até 056 e provisionamento tenant/admin: percurso operacional próprio ainda a fechar. A cadeia genérica já foi provada em cluster descartável, mas `installProductionCentral.js` NÃO faz bootstrap, cria tenant, publica bindings F4 nem cria o primeiro administrador. Exigir recibo do provisionamento, identity marker, ledger/schema 056 e dados reais corretos antes de continuar.
6. Configurar os ficheiros privados seguindo [configuração](production-057-configuration.md). A primeira entidade e o contrato de perfis tenant têm de estar resolvidos; não há arranque funcional com lista de organizações vazia. Completar Keycloak, R2/scanner, backups fora da VPS e monitorização. Separar a credencial instaladora de todas as credenciais de serviço.
7. Fazer o checkpoint consistente e o ensaio de recuperação definidos no [rollback](production-057-rollback.md), antes do primeiro dado real e antes de cada upgrade.

## 3. Verificação anterior à migração

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

## 4. Aplicar 057 e provisionar

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
curl --fail --silent --show-error http://127.0.0.1:8600/health/ready
```

O tráfego externo continua em manutenção. Esperar assinaturas do ClamAV e healthcheck; a API valida os quatro perfis novos, schema, leitor de catálogo, identidade Central, configuração tenant e capacidades selecionadas. O binding e as permissões de cada tenant são verificados nas operações: exigem o ensaio funcional abaixo, não estão todos provados pelo ready. Se falhar, não substituir credenciais por superutilizador nem remover flags de segurança. A prontidão não substitui os seguintes testes:

- Login/logout/step-up nos domínios finais, cookies Secure/HttpOnly/__Host e CSRF.
- Identidades SQL reais sem superutilizador/ownership/pertenças extra; logs sem eventos permission denied.
- Administrador cria manual e importa PT2030 até aceitação; cliente autorizado consulta; repetição não duplica. Originais e PDFs só pelo port autenticado; ClamAV e armazenamento reais.
- Pelo menos dois tenants de ensaio próprios: troca de contexto, ausência de leitura/escrita/exportação cruzada, revogação imediata. Remover/arquivar fixtures por processo aprovado antes de admitir clientes.
- Faturação/email/convites apenas se as respetivas dependências e variantes estiverem resolvidas; não simular sucesso omitindo rotas requeridas.
- Backup externo, restauro, alerta e rotinas testados. Proposta de observação: 24 h no alvo isolado de ensaio/produção fechada, sem staging e sem elevar privilégios.

## 6. Publicação e corte

Preparar os dois vhosts de produção para revisão, sem substituir a configuração existente do proxy: `gcni.c4g.ai` serve a release frontend e encaminha `/api/*` e **explicitamente `/health/ready`** para 127.0.0.1:8600; o health nunca cai no fallback SPA. A sonda exige HTTP200 e JSON com `status="READY"`, não apenas HTTP200; `login.c4g.ai` encaminha apenas rotas públicas Keycloak da instância própria. Não expor admin API, métricas, management nem endpoints internos pelo vhost público. Não usar o Keycloak de staging.

Emitir CSP com frame-ancestors, X-Frame-Options e Referrer-Policy como headers HTTP e testar assets, OIDC e uploads. Definir trusted proxies e cadeia real de IP. A instalação atual de proxy não foi inspecionada neste trabalho; por isso não foi gerado um `sed` ou reload de configuração partilhada. Um reload mal feito pode afetar staging: o patch exato dos vhosts, validação do servidor e preservação das entradas existentes são condições do corte, não passos automáticos deste bundle.

Depois dos gates, aprovar a janela com o responsável e só então publicar DNS/proxy e admitir tráfego. Verificar ready externamente, login e primeiro percurso autorizado. Guardar recibo de release, configuração, base, backup e responsável. Nenhuma alteração DNS, proxy, VPS ou staging foi efetuada aqui.

## 7. Critério de avanço / pendências

**A preparação pode ser revista; a execução produtiva ainda está bloqueada por:** primeira entidade e provisionamento genérico Central056/tenant/admin; configuração privada e aceite integrado de convites/eliminação/email; versões/digests e recursos da infraestrutura; evidência de backup/restauro/RPO/RTO/responsável; configuração real Keycloak/R2/certificados/proxy; validação Docker na VPS; ensaio de rollback e release final identificada. A compatibilidade SQL dos convites/eliminação está integrada na058; os testes locais não comprovam os fornecedores reais.

O bloqueio de código da gestão de acessos com MFA opcional foi [corrigido localmente](../features/platform-access-optional-mfa.md), sem deploy. Incluir a correção na release candidata e validar o percurso OIDC de confirmação de sessão no ensaio isolado. O recibo `production-preparation.json` preserva o estado e os hashes da preparação anterior à correção; não representa os ficheiros atuais.

O rollback preparado é [este procedimento](production-057-rollback.md). Não usar down -v, apagar ledger, restaurar sobre staging ou voltar à imagem anterior sem prova de compatibilidade057. Na primeira entrada não existe uma release de produção anterior: a resposta segura é manutenção, correção sobre057 ou recuperação isolada com reconciliação explícita.

## 8. Validação desta preparação

Sete testes locais de estrutura/configuração aprovados: isolamento do Compose e dos mounts, scanner loopback, separação dos logins, TLS e domínios, política de autenticação registada, recusa dos placeholders e perfis de ensaio. YAML do compose/workflow analisado, sintaxe e lint aprovados. O gate de preparação foi acrescentado ao CI backend; o CI do bundle novo só poderá ser observado após publicação.

Docker não está disponível nesta máquina: não houve `docker compose config`, construção de imagem, arranque de contentores ou ensaio de proxy/infraestrutura. Não houve nova aplicação SQL ou alteração de runtime neste trabalho; as suites completas e os gates PostgreSQL anteriores referem-se à base6e0b894. A validação local não altera o estado bloqueado da secção7.

[Recibo da preparação](../reviews/central-production-permissions-20261115/production-preparation.json): revisão base, CI observado, contagens e hashes dos ficheiros. Os hashes identificam o bundle preparado, não uma release já publicada.
