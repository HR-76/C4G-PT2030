# Staging na VPS com PostgreSQL próprio

Estado: In Progress (12/11/2026). Decisão: [PostgreSQL do staging na VPS](../decisions/2026-11-12-staging-postgresql-on-vps.md).

Ambiente `app-teste.c4g.ai` e `login-teste.c4g.ai` na VPS C4G: PostgreSQL 18 em contentor, API a partir de um commit do GitHub, frontend estático servido pelo Caddy e Keycloak existente (realm `c4g-staging`, cliente `c4g-staging-app`). Dados sintéticos apenas.

## Estado encontrado a 12/11/2026

- Release em execução: `/srv/c4g-staging/api-release-0715f01`, construída de uma árvore `codex/staging-neon` com alterações locais de runtime para Neon, que não estão no GitHub (`neonCentralProfile.js`, `neonTenantProfile.js`, alterações em `tenantRuntimeMetadata.js` e `tenantMigrationPreflight.js`). Liga a uma Central Neon na versão 035 e a um tenant na 033.
- O perfil Neon admite exatamente um padrão de pertenças criado pelo PostgreSQL 16+ (`ADMIN` sem `SET` nem `INHERIT`, concedido pelo superutilizador de arranque) e fixa checksums e fingerprints por versão. Está congelado na Central 035 e no tenant 033; cada migração nova exige novos valores fixados.
- O pacote do primeiro utilizador (`primeiro-utilizador-staging-0715f01`) recusa qualquer alvo que não seja o host, a base e os identificadores Neon fixados no código.
- PostgreSQL 18.6 novo em `/srv/c4g-staging/postgres`: TLS com CA privada, rede `c4g-staging-data` (alias `c4g-postgres`), sem porta publicada, bases `c4g_central_staging` e `c4g_tenant_staging`. Necessário porque `NODE_ENV=production` exige TLS verificado em hosts que não sejam loopback.

## Critérios de aceitação

- O esquema Central e o do tenant instalam-se a partir do mesmo commit que a imagem da API, sem alterar migrações nem manifests, e passam `preflightCentral` e `preflightTenant`. Marco 1: Central 035 e tenant 033, o que o instalador base aplica. Marco 2: tenant 040, com os executores das migrações 034 a 040 (por fazer).
- Uma instalação nova com superutilizador passa os dois preflights. O defeito `CATALOG_SECURITY_DRIFT` (concessão a `c4g_f12_admin` fora do fingerprint fixado da 035) tem teste de regressão.
- A API liga à autoridade com `c4g_authority_runtime` e ao tenant com `c4g_staging_api`, ambos limitados. A ligação à Central usa o administrador do PostgreSQL, como o perfil local. Um login limitado com concessões nas tabelas da Central altera o fingerprint fixado e faz falhar `preflightCentral` (medido a 12/11/2026); fechar este ponto exige um perfil de runtime próprio, como o do Neon.
- Primeira organização, tenant, administrador e utilizador sintéticos criam-se por um script idempotente do repositório, sem hosts nem identificadores fixos no código. Associa-se ao utilizador existente no Keycloak pelo `subject`.
- O deploy parte de um SHA do GitHub, com imagem etiquetada por esse SHA e frontend na pasta da mesma etiqueta. O Caddy aponta para a etiqueta ativa.
- Nenhum segredo entra no Git, em logs ou na saída de comandos. Segredos ficam em ficheiros `600` na VPS.
- Validação: `/health/ready` com 200, login completo no browser em `app-teste.c4g.ai`, página da organização carregada (prova a ligação ao tenant) e recusa de acesso cruzado.
- O instalador local e os executores 034 a 040 continuam dependentes de Windows e de `localhost`; o de staging corre num contentor na rede do PostgreSQL.

## Implementação

- [install.js](../../backend/scripts/staging/install.js) e [environment.js](../../backend/scripts/staging/environment.js): comandos `install`, `person` e `env`, sobre o instalador local parametrizado ([schema.js](../../backend/scripts/localPlatform/schema.js)). Segredos gerados no primeiro uso, guardados num estado com modo 600 e escritos só em ficheiros.
- [deploy/staging](../../deploy/staging/README.md): Dockerfile, compose da API e runbook com os comandos da VPS.
- Correção: `schema.js` deixou de conceder `USAGE` em `opportunity_catalog` a `c4g_f12_admin`, concessão que nenhum fingerprint fixado inclui. Teste de regressão em `stagingInstaller.test.js`. Instalações locais existentes mantêm a concessão que já têm.

## Verificação (12/11/2026)

- PostgreSQL 18.6 temporário, com ICU `und`: instalação completa, repetição sem alterações, `person` (administrador da plataforma e administrador da organização, repetido) e `env` concluídos; `preflightCentral` aprovado na 035; tenant na 033.
- API arrancada com o ambiente gerado: `/health/ready` 200 e Central saudável. Verificação física do tenant (diretório, região `EU`, estado `AVAILABLE`) aprovada com o login limitado do tenant.
- Backend: 3105 testes, 3096 aprovados, 9 ignorados, 0 falhas; lint limpo.
- Não verificado: construção da imagem e do frontend (Docker indisponível nesta máquina), TLS entre a API e o PostgreSQL, login OIDC, criação das contas no Keycloak e qualquer passo na VPS.

## Fora de âmbito

Neon, R2, Resend, ClamAV, workers de oportunidades, produção e migração dos dados do staging Neon.

## Por decidir

- Política e destino dos backups lógicos do PostgreSQL de staging.
- Endurecimento do SSH e da firewall da VPS (a `ufw` está inativa; as definições efetivas do `sshd` não foram confirmadas).
- Como preservar no Git o código do perfil Neon antes de qualquer limpeza da VPS.
