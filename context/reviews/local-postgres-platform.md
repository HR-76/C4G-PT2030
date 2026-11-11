# Plataforma local — evidência de 2026-10-17

Estado: **Review**, instalação e critérios técnicos deste recorte concluídos. Contrato: [local-postgres-platform](../features/local-postgres-platform.md). Instruções: [LOCAL.md](../../LOCAL.md).

## Implementação preparada

- `npm run setup:local` aplica migrations canónicas, provisiona credenciais tenant limitadas e prepara C4G/admin/hugo. Recusa bases inicialmente não vazias, roles C4G desconhecidos e locale incompatível; não recria bases.
- `npm run dev` no backend passa pelo runtime nativo; Vite continua em 3000 com proxy para 5000 e porta estrita. O entrypoint histórico `dev:local` também passa a chamar efetivamente `start()`.
- Configuração privada e acessos em `.tmp/local-platform`, protegidos por ACL e ignorados pelo Git. O instalador lê `PGPASSWORD` de `backend/.env`, sem imprimir/copiar a password para documentação.
- Canonicalização da representação adicional de NOT NULL em PostgreSQL 18, mantendo `attnotnull` no fingerprint e recusando constraints não canónicas. Central, tenant e preflight F12 admitem apenas 17/18.
- Cliente e fluxo OIDC exclusivos desta instalação, MFA de 300 segundos; demonstração e fluxo F2 de dois segundos preservados. Membership central é a autoridade de Hugo. Nenhuma membership privada atribuída ao admin.

## Provas executadas

- PostgreSQL **18.3 nativo**, clusters de prova isolados em 5563/5564. Migrations e preflights Central/tenant PASS, inicialmente até 024 e posteriormente até 025, com o ordinal 013 reservado. Fingerprint final Central e autoridade compatíveis.
- Remoção transacional de NOT NULL de `opportunity.title` recusada por drift; rollback preservou o schema. Testes unitários recusam NOT NULL com semântica não canónica.
- Regressão de preflight, apenas leitura, na demonstração PostgreSQL 17: Central e tenants A/B PASS.
- Instalador na porta 5564: reexecução sem alterar ledger, owner técnico NOLOGIN/NOSUPERUSER após instalação, login tenant sem CONNECT à Central, duas identidades/uma membership e zero oportunidades centrais PASS. Seed repetida sem duplicação.
- Chrome real, Vite 5190/API 5191: **gate completo PASS**, incluindo OIDC/TOTP, administração exclusiva de plataforma, catálogo vazio, dados privados/candidaturas, recusa de organização alheia e reinício preservando identidades. Instalação isolada repetida sem alterar ledger. Seleção redundante de organização removida do teste; F12 passou a admitir PostgreSQL 18 verificado.
- Última suite focada: **59/59 PASS**. O trabalho paralelo corrigiu a contagem do catálogo de auditoria; esta tarefa atualizou as duas expectativas da última versão de compatibilidade no teste do manifest para 025, preservando os controlos.
- Build frontend PASS. `node --check` dos ficheiros JavaScript da implementação PASS, incluindo a última guarda adicional de estado; `git diff --check` no recorte rastreado PASS.
- `npm run setup:local` executado e repetido nas bases efetivas 5432: **LOCAL_PLATFORM_READY**. Inicialmente devolveu `28P01`; a atualização da credencial pelo utilizador resolveu essa dependência.
- Backend e frontend iniciados com os comandos reais **`npm run dev`**, respetivamente em 5000 e 3000. API antiga deste repositório identificada pelo caminho de `src/server.js` e substituída; restantes servidores preservados.
- `node test/integration/local-platform/verifyNative.js`: **NATIVE_5432_NPM_DEV_ADMIN_HUGO_PASS**. 47 tabelas Central e 128 tenant (incluindo partições); zero oportunidades em ambas. Login efetivo `admin`/`hugo`, C4G selecionada pelo servidor, Hugo com catálogo/privadas/candidaturas 200 e administração 403; admin com administração 200 e sem acesso privado implícito. Pedido de recolha do admin devolve 503 `SOURCE_NOT_CONFIGURED`; não inicia recolhas.
- Capturas privadas em `.tmp/local-platform/native-proof`, sem formulários de credenciais. Interface de catálogo C4G vazio e administração verificadas visualmente; o teste aguarda o carregamento da administração antes da captura.

## Dependências resolvidas e decisões executadas

1. Credencial atualizada pelo utilizador e verificada por ligação direta. Nunca apresentada em outputs/documentação.
2. Ambas as bases estavam vazias. O tenant tinha provider libc, incompatível com o contrato ICU `und`. A revisão automática inicialmente recusou a substituição sem autorização explícita. O utilizador aprovou preservar a antiga e preparar a nova. A base original ficou em `c4g_tenant_dev_before_c4g_20261017`; nova base UTF8/ICU `und`/UTC ocupa `c4g_tenant_dev`. A única sessão impedindo renomeação era pgAdmin inativa/sem transação, desligada com guardas explícitas. Nenhuma base ou tabela eliminada.
3. Catálogo de auditoria foi corrigido pelo trabalho paralelo; migration 025 já integra o manifest validado. Nenhum evento removido ou controlo dispensado.
4. Intermitência MFA diagnosticada: o Keycloak 26.8 usa por defeito zero segundos para a referência AMR quando `default.reference.maxAge` falta. Configurou-se **300 segundos apenas nos authenticators do fluxo próprio**, alinhados com a política já aprovada; nenhum mapper estático nem relaxamento da validação. A API administrativa mascara o valor da referência no GET; o instalador reconcilia apenas configs com alias da instalação. Fundamento: [AmrUtils 26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/protocol/oidc/utils/AmrUtils.java) e [constantes oficiais](https://github.com/keycloak/keycloak/blob/26.8.0/server-spi-private/src/main/java/org/keycloak/models/Constants.java). Prova final real inclui atraso deliberado de 1500 ms antes de cada callback; ambos os logins e permissões passaram. Instrumentação temporária removida.

Sem bloqueios técnicos conhecidos para este recorte. Restantes funcionalidades e revisão humana mantêm os seus próprios estados.

## Limites

Runtime de desenvolvimento com diretório fixo validado no servidor e Central com credencial administrativa. Não é provisioning de produção nem validação integral das funcionalidades em curso. F11/R2, e-mail e worker/recolha externa não foram ativados. O teste isolado usa `c4g-native-validation-hugo`; a instalação efetiva usa `hugo`, com identidade e membership próprias. Os servidores de prova 5563/5564 foram parados, conservando dados e artefactos; os servidores npm dev efetivos permanecem ativos em segundo plano (PIDs/logs privados em `.tmp/local-platform`). Demonstração, identidades anteriores e alterações paralelas preservadas. Nenhuma operação Git mutável.
