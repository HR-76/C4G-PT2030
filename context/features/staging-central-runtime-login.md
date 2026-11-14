# Login de runtime da Central sem superutilizador (staging)

Estado: Draft — 14/11/2026, por aprovar. Nada implementado.

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
