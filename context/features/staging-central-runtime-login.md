# Login de runtime da Central sem superutilizador (staging)

Estado: Implementado e validado em base descartável — 14/11/2026. Commit e VPS pendentes de aprovação.

Pedido: a auditoria global de 14/11/2026 classificou como prioridade alta a ligação da API e do worker à Central com o administrador do PostgreSQL. Esta especificação define o que muda, como se prova e o que fica fora.

## Problema (factos verificados)

- O gerador do ambiente de staging ([environment.js](../../backend/scripts/staging/environment.js), linha 140) define `CENTRAL_DATABASE_URL` com o login `postgres`, que é superutilizador. A API e o worker de importação leem essa variável ([centralDb.js](../../backend/src/config/centralDb.js), [fundingTendersWorker.js](../../backend/src/config/fundingTendersWorker.js)). Por isso todo o tráfego Central de staging corre como superutilizador.
- O papel `c4g_central_runtime`, que as migrações e o instalador local criam, é `NOLOGIN` por construção ([schema.js](../../backend/scripts/localPlatform/schema.js), linha 64). Não existe, portanto, um login que o use.
- O login `c4g_authority_runtime` é limitado, mas cobre só o protocolo de autoridade (`AUTHORITY_DATABASE_URL`). Não cobre o resto das consultas da API.
- O login `c4g_catalog_staging` já existe como login de leitura do catálogo, provisionado pelo instalador de staging ([install.js](../../backend/scripts/staging/install.js), linhas 57 a 63). É o padrão a reutilizar.
- A instalação dos esquemas continua a exigir superutilizador. A [via sem superutilizador está suspensa](managed-postgres-installer-authority.md) e fica fora deste pedido.

## Âmbito

Dentro:

1. Um login de runtime para a API e outro para o worker, ambos `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, criados pelo instalador de staging.
2. Pertença apenas a `c4g_central_runtime`, com `INHERIT`, `NOSET` e `NOADMIN`. Nenhuma pertença a `c4g_authority_*`.
3. `CENTRAL_DATABASE_URL` da API e do worker a apontar para esses logins no ficheiro de ambiente gerado.
4. Segredos em ficheiros de modo 600, como os restantes.

Fora:

- Instalação e migrações com superutilizador (continuam no administrador do PostgreSQL da VPS, como hoje).
- Alterações a migrações publicadas, checksums ou fingerprints fixados.
- Produção e o Neon.
- Recolha de oportunidades (decisão separada do utilizador).

## Decisões em aberto

1. **Nomes dos logins.** Proposta: `c4g_central_staging_api` e `c4g_central_staging_worker`.
2. **Um ou dois logins.** Proposta: dois, para o worker poder ser limitado separadamente.
3. **Grants em falta.** Se `c4g_central_runtime` não cobrir uma consulta da API, há duas vias: (a) acrescentar grants com uma nova migração, que muda checksums e exige revisão; (b) dar a pertença a um papel intermédio criado pelo instalador, fora das migrações. A proposta é medir primeiro e só decidir depois. Não se acrescentam grants às escondidas.
4. **Sensibilidade do fingerprint.** Não se sabe ainda se uma pertença nova a `c4g_central_runtime` altera o fingerprint fixado da Central 050. Se alterar, a alteração tem de ser explícita e justificada, nunca silenciosa.

## Decisões aprovadas (14/11/2026)

1. Logins `c4g_central_staging_api` e `c4g_central_staging_worker`.
2. Dois logins, um por processo.
3. Medir primeiro; nenhum grant acrescentado às escondidas.
4. Mudança de fingerprint só explícita e justificada.

## Implementação (local)

- [environment.js](../../backend/scripts/staging/environment.js): `CENTRAL_DATABASE_URL` da API usa `c4g_central_staging_api`; novo `workerCentralEnvironment` escreve a URL do worker num ficheiro próprio.
- [install.js](../../backend/scripts/staging/install.js): gera as duas palavras-passe no estado (modo 600), cria os logins com `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, concede só `c4g_central_runtime` (`INHERIT TRUE, SET FALSE, ADMIN FALSE`) e verifica os atributos e as pertenças em cada execução. O `env` escreve também `worker-central.env.generated`.
- [compose.yaml](../../deploy/staging/compose.yaml): o worker lê `/srv/c4g-staging/worker-central.env` depois do ficheiro partilhado, por isso a URL dele prevalece.
- Testes: [stagingCentralRuntimeLogin.test.js](../../backend/test/stagingCentralRuntimeLogin.test.js) novo; fixtures de `stagingInstaller` e `stagingStorageEnvironment` atualizados. Testes de staging: 39 a passar. Lint sem erros.

## Resultado medido (PostgreSQL 18.6 descartável, 14/11/2026)

- Instalação de HEAD (sem alterações), em base nova: passa. Central 035, tenant 033.
- Instalação com as alterações, em base nova: os esquemas instalam-se, mas a verificação final `preflightCentral` falha com `Central schema drift detected for 035` (fingerprint observado `b22a1b66…`).
- A causa é a pertença de `c4g_central_runtime`. O snapshot de segurança da autoridade ([authoritySecurityManifest.js](../../backend/src/security/authoritySecurityManifest.js), linhas 68 a 76) inclui todas as pertenças em que `c4g_central_runtime` é pai ou membro. Com as duas pertenças revogadas, o preflight passa (fingerprint `8b772f6c…`). Com só uma revogada, a verificação continua a falhar.
- Os logins em si não entram no snapshot; só a pertença.

## Admissão aprovada (opção A, 14/11/2026)

> Superseded: a admissão de 035 foi retirada; a admissão atual é a de 052 (ver "Resultado final").


- [stagingCentralRuntimeAdmission.js](../../backend/src/security/stagingCentralRuntimeAdmission.js): admite exatamente dois fingerprints da Central 035, o de esquema (`b22a1b66…`) e o de autoridade (`bc7e9e9c…`), para o padrão de dois logins de staging como membros de `c4g_central_runtime`. Exige a flag `C4G_STAGING_CENTRAL_RUNTIME_LOGINS=admitted-v1`, que só o instalador de staging e o ficheiro privado de staging definem. Produção não a define e continua a recusar esta variante.
- Ligada às duas verificações ([centralSchemaManifest.js](../../backend/src/security/centralSchemaManifest.js) e [authoritySecurityManifest.js](../../backend/src/security/authoritySecurityManifest.js)). Nenhuma outra admissão foi alterada.
- Testes: [stagingCentralRuntimeAdmission.test.js](../../backend/test/stagingCentralRuntimeAdmission.test.js). Suíte completa do backend: 3189 a passar, 0 falhas, 9 ignorados. Lint sem erros.

## Resultado medido após a admissão (PostgreSQL 18.6 descartável, 14/11/2026)

> Superseded pelo resultado final: o login de runtime agora é criado depois da cadeia, e o preflight passa com a variante de 052.

- Instalação completa em base nova: passa (Central 035, tenant 033). Também passa com o login de runtime do worker.
- O login `c4g_central_staging_api` liga-se e não é superutilizador (`rolsuper = false`, `rolbypassrls = false`, `rolcreaterole = false`).
- **O `preflightCentral` feito com esse login falha:** `permission denied for table c4g_database_identity`. O papel `c4g_central_runtime` tem 33 grants de tabela, mas não tem `SELECT` em `c4g_database_identity` nem em `organization`, e tem `USAGE` em `public`.
- Isto significa que a API, com este login, não fica pronta. O primeiro erro é só o primeiro: a lista completa só aparece ao correr a API inteira.
- Por isso a configuração atual (`CENTRAL_DATABASE_URL` com o login novo) **não pode ir para a VPS**. A VPS continua a usar o administrador do PostgreSQL até haver decisão sobre os grants.

## Decisão pendente: grants de `c4g_central_runtime`

- **G1:** uma migração Central nova que dê ao `c4g_central_runtime` os `SELECT`/DML que a API usa. Limpo para a arquitetura, mas acrescenta uma migração, novos checksums e novos fingerprints fixados. Exige rever cada grant.
- **G2:** grants só em staging, no instalador. Mais rápido, mas muda o esquema e exige novas admissões, e torna o staging diferente de produção.
- **G3:** parar aqui. A API de staging continua com o administrador do PostgreSQL, como hoje, e o item fica como medido e bloqueado.

## Decisão pendente: como admitir a pertença

- **Opção A (recomendada):** registar explicitamente, para a Central 035 e só para staging, o fingerprint que resulta do padrão de pertenças esperado (dois logins, `INHERIT TRUE, SET FALSE, ADMIN FALSE`). Tudo o resto continua a ser verificado exatamente. Produção não admite esta variante.
- **Opção B:** excluir do snapshot as pertenças de logins de runtime. Mais simples, mas esconde uma parte do que a verificação de autoridade protege. Não recomendada.
- **Opção C:** manter a API como administrador do PostgreSQL. Não resolve o problema, só o adia.

## Critérios de aceitação

1. Após `install`, os dois logins existem com os atributos acima e a única pertença é `c4g_central_runtime`. Verificado por consulta a `pg_roles` e `pg_auth_members`.
2. `preflightCentral` e `preflightTenant` passam com o login de runtime instalado. Qualquer alteração de fingerprint é documentada e aprovada antes de ser aceite.
3. Com `CENTRAL_DATABASE_URL` novo, `SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user` devolve `rolsuper = false` na API e no worker.
4. `/health/ready` responde 200 com o login novo.
5. Fluxos de staging funcionam com o login novo: login OIDC, página da organização, Dashboard, catálogo e recusa de acesso cruzado.
6. Lista de erros `permission denied` recolhida durante 24 horas com o login novo em paralelo ao antigo, antes de mudar. Cada erro é tratado com uma decisão registada (decisão 3 acima).
7. Testes unitários novos: o gerador de ambiente nunca escreve `postgres` em `CENTRAL_DATABASE_URL`, e o instalador cria os logins com os atributos e pertenças exigidos.
8. Suite do backend e lint sem falhas.
9. Reversão: repor a linha anterior do ficheiro de ambiente, reiniciar a API e o worker e confirmar `ready=200`. Não é preciso alterar a base de dados.
10. Nenhuma palavra-passe aparece em logs, saída de comandos ou Git.

## Verificação prevista

- PostgreSQL 18 descartável, com o instalador em modo de runtime novo: `install`, `person`, `env` e `preflight`.
- Suite do backend e lint.
- Ensaio no staging da VPS, com a lista de erros da critério 6, antes da troca definitiva.
- Teste no navegador de `app-teste.c4g.ai` com uma conta de cada perfil.

## Ligações

- [Decisão do PostgreSQL do staging](../decisions/2026-11-12-staging-postgresql-on-vps.md)
- [Implantação na VPS](staging-vps-deployment.md)
- [Instalação sem superutilizador (suspensa)](managed-postgres-installer-authority.md)

## Inventário para G1 (14/11/2026)

Medido no código do backend, sem executar a API: a `src/` referencia 50 tabelas `public` distintas. As mais usadas são `global_user`, `organization`, `organization_membership`, `application_session`, `tenant`, `organization_connection*`, `organization_provisioning`, `billing_*`, `platform_onboarding_*`, `entity_admission`, `tenant_*` e as tabelas `authority_*`.

Limites já decididos que condicionam G1:

- **R5-001** ([f13-organizational-profile.md](f13-organizational-profile.md)): o `c4g_central_runtime` geral não recebe memberships nem grants do protocolo de autoridade. As tabelas `authority_*` e as escritas de `application_session` do protocolo ficam com `c4g_authority_runtime`.
- **AV-01** ([decisão](../decisions/2026-10-25-av01-api-runtime-boundary.md)): cada capacidade recebe o seu perfil, com autorização explícita. Não se atribuem papéis genéricos.
- **Plataforma e faturação:** `platform-billing-control-phase-a` concede ao runtime central apenas o `SELECT` necessário às projeções de leitura.

Consequência: G1 não é uma migração única de "dar tudo". Tem de ser uma lista aprovada de tabelas e operações, e as escritas que não couberem no perfil de leitura precisam de um caminho próprio. Esta lista ainda não foi aprovada.

Proposta para aprovação (G1 restrito): `SELECT` no `c4g_central_runtime` nas tabelas de identidade, organização e tenant que a API lê no arranque e nas páginas (`c4g_database_identity`, `organization`, `global_user`, `organization_membership`, `tenant`, `tenant_schema_state`), sem escritas e sem tabelas `authority_*`. Depois medir a API com esse papel e listar as escritas e os `permission denied` restantes.

## Medição do G1 restrito (14/11/2026, base descartável, grants aplicados à mão só para medir)

- Com `SELECT` em `c4g_database_identity`, `organization`, `global_user`, `organization_membership`, `tenant` e `tenant_schema_state`, o preflight ainda falha em `c4g_schema_migration` (ledger de migrações).
- Com `SELECT` também em `c4g_schema_migration`, o preflight deixa de pedir leituras: **sete tabelas bastam** para o preflight com o login de runtime.
- Mas os grants mudam o snapshot de esquema, e a verificação devolve drift: fingerprint observado `112c2165…`. Ou seja, o G1 precisa de uma **migração versionada** com os seus pins, não de grants aplicados à parte. Os grants feitos à mão nesta medição foram só para medir e a base foi descartada.

## Bloqueio: onde entra a migração G1

A cadeia Central de staging é 035 → 050 (aplicada pelo `upgrade`), e a 051 (`email_templates`) está em `candidates/` e em Draft, à espera de decisões de produto. Uma migração nova precisa de um número posterior ao último aplicado:

- **Opção 1:** registar a G1 como 052, depois da 051. Staging só a aplica quando a 051 for aprovada e promovida. Liga o G1 a uma decisão alheia.
- **Opção 2:** registar a G1 logo a seguir à 050, como versão própria, e a 051 passa a ficar depois dela. Obriga a reordenar a candidata 051, que ainda não foi aprovada.
- **Opção 3:** admitir como variante exata de staging, à semelhança da opção A. Viola "nenhum grant às escondidas" e foi recusada pelo utilizador.

## Resultado final: migração 052 (14/11/2026)

Aprovado: G1 restrito, registado como 052 depois da 051 (candidata em Draft).

- **Migração:** [central_runtime_read.up.sql](../../backend/database/central/candidates/central_runtime_read.up.sql) dá `SELECT` ao `c4g_central_runtime` em `c4g_schema_migration`, `c4g_database_identity`, `global_user`, `organization`, `organization_membership`, `tenant` e `tenant_schema_state`. Reversível: [central_runtime_read.down.sql](../../backend/database/central/candidates/central_runtime_read.down.sql). Não há escritas, tabelas `authority_*` nem pertenças.
- **Pacote:** [centralRuntimeReadPackage.js](../../backend/src/security/centralRuntimeReadPackage.js). Checksum do SQL fixado. Fingerprints generic, medidos com a cadeia 035 → 051 → 052 e sem pertenças de staging: esquema `e1fdad20…`, autoridade `3b9dc627…`. Cadeia própria em `centralRuntimeReadManifest`, para que o 051 nunca aponte para o 052.
- **Pertenças de staging:** a variante com os dois logins como membros é admitida só para 052, com `stagingCentralRuntimeAdmission.js` (esquema `2b6d672a…`, autoridade `69fe6140…`). A admissão de 035 foi retirada, porque os logins deixam de existir durante a cadeia.
- **Ordem de instalação de staging:** `install` (sem logins) → `upgrade --apply` → `runtime-logins` (novo comando: cria/verifica os logins e corre o preflight). O [runbook](../../deploy/staging/README.md) já reflete esta ordem.

### Verificação

- Base PostgreSQL 18.6 descartável, ordem de staging completa: `install` passa; `upgrade --apply` chega à 052; `runtime-logins` passa com `centralVersion` 052.
- Login `c4g_central_staging_api` e `c4g_central_staging_worker`: `rolsuper = false`, `rolbypassrls = false`, `rolcreaterole = false`, e `preflightCentral` **passa** nos dois.
- Sem a flag `C4G_STAGING_CENTRAL_RUNTIME_LOGINS` (regime de produção), a mesma variante é recusada com drift em 052.
- Backend: `npm test` com 3193 a passar, 0 falhas, 9 ignorados. Lint sem erros.

### Ainda não feito

- Nada foi commitado, nada foi levado à VPS. A VPS continua com a API a usar o administrador do PostgreSQL.
- Testes de API completa com o login de runtime (além do preflight): as leituras das páginas ainda não foram medidas com este login. Se faltar algum `SELECT`, a lista aparece nos erros `permission denied` e é uma nova decisão de âmbito.
- O worker de recolha, que também usa o login, só foi verificado ao nível do preflight.
