# Convites e eliminação de utilizadores após a Central 057

Estado: Review (15/11/2026). Implementação e validação local concluídas. Pedido aprovado: compatibilidade produtiva dos convites e da eliminação, com testes, sem alterar staging nem fazer deploy.

## Contrato e instalação

Integrar os comandos de recibo de convite e de eliminação numa migração incremental `058_platform_account_lifecycle`, depois da `057_production_central_permissions`. Preservar SQL, checksums e registos históricos da 057 e das variantes de staging. A instalação exige seleção explícita do pacote e verificação do alvo e do estado anterior; não ocorre no arranque da API. Uma repetição do pacote instalado é inócua, mas drift de schema, ledger ou permissões é recusado.

Convites e eliminação usam o protocolo de autoridade existente, com SQL fechado e login limitado. Não conceder acesso direto à nova tabela nem poderes adicionais aos perfis produtivos. MFA continua opcional, com autenticação recente nas operações sensíveis. A eliminação conserva o histórico, revoga acesso antes dos efeitos externos e retoma por fases; não elimina recursos institucionais de outros utilizadores.

## Critérios de aceitação

- Instalação limpa até 058 e upgrade 057→058 dão o mesmo schema e permissões, medidos em PostgreSQL descartável; 057 permanece imutável.
- Manifest, runner, preflight, leitores e readiness reconhecem exatamente 058. Nenhuma admissão genérica de fingerprints observados no arranque.
- Convites funcionam pelo login de autoridade sem superutilizador, incluindo recibo de envio, repetição e recusa de ator ou organização não autorizados; destinatários e segredos ficam restritos ao fluxo próprio.
- Eliminação funciona pelo mesmo protocolo, com proteção do próprio/último administrador, autenticação recente, revisão, revogação de sessões e memberships, idempotência e retomada após falha externa.
- Falha de auditoria faz rollback real da transação; outros utilizadores/organizações mantêm os dados. Leitura/escrita direta e escalada de privilégios são recusadas.
- Regressões primeiro a vermelho; testes focados, gates PostgreSQL, suites completas, lint, sintaxe e build aprovados. Simulações de fornecedores externos são explicitadas.

## Limites

Não configurar nem contactar Keycloak, email, tenants ou bases persistentes reais. Os gates usam dados sintéticos e cluster próprio local descartável, no âmbito já autorizado para os testes de produção. Esta entrega prepara código e instalação; não ativa flags nem executa deploy em nenhum ambiente.

## Validação

- PostgreSQL 18.6 descartável: upgrade com 28 verificações e instalação limpa com 26, todas aprovadas. Os fingerprints de schema, autoridade, catálogo, leitura e perfis produtivos são idênticos entre os dois percursos. Clusters parados e diretórios de dados removidos pelo próprio gate.
- A 057 original recusou os comandos ausentes antes da extensão. Provados rollback de migração, preservação dos registos/ledger anteriores, instalação explícita, repetição e recusa de drift.
- Convites: autorização/isolamento, recibo committed antes do fornecedor, falha/retoma, não duplicação de envio e rollback de ativação por auditoria. Eliminação: autenticação recente sem exigir MFA, proteção própria/último administrador de entidade, revogação antes de falha externa, retoma, anonimização seletiva e rollback real de auditoria/dados.
- Tenant041: migração, RLS, anonimização e repetição executadas em PostgreSQL real, separadamente do port de projeção simulado durante o fluxo Central.
- Testes focados: 51 aprovados; preparação de produção: 7 aprovados; lint, sintaxe, build e `git diff --check` aprovados. Suite frontend completa: 1150 aprovados em 128 ficheiros.
- Suite backend completa: 3453 testes, 3444 aprovados, 9 ignorados existentes, zero falhas. Todas as suites/build/lint terminaram com exit code 0.

[Recibo, pins e resultados](../reviews/platform-account-lifecycle-20261115/validation-summary.json) preservados, sobre `b32d334d94e9b40cb0741d6984067d99bebd34ee` e a correção local de acessos anterior. Procedimento de aplicação, configuração pendente e recuperação no [runbook058](../runbooks/production-058-account-lifecycle.md). 057, candidatos/admissões históricos e scripts de staging mantêm o conteúdo anterior.

Keycloak/email/OIDC são simulados; o teste não envia mensagens nem elimina identidades reais. Permanecem necessários os ficheiros privados, bindings tenant e ensaio integrado no ambiente isolado antes da ativação. Sem commit, push, staging ou deploy.
