# Alteração do tipo da entidade

Estado: publicado no staging em 15/11/2026; confirmação funcional na interface pendente.

## Contrato confirmado

A Administração C4G e quem já tem permissão de edição da ficha podem alterar o tipo, incluindo entidades com UNSPECIFIED. A ação Alterar tipo é independente do preenchimento da ficha. Só admite as oito categorias da adesão; não altera nome, NIF, acessos nem estado da entidade.

A identidade central e o tipo na ficha são atualizados na mesma transação, com autorização atual, auditoria, revisão otimista e recibo idempotente. Um conflito exige atualização da ficha; não sobrescrever alterações concorrentes. Uma ficha incompleta continua incompleta. UNSPECIFIED é apresentado como Por definir.

## Aceitação

- Alteração e posterior consulta pela entidade e pela Administração C4G.
- Correção de UNSPECIFIED sem obrigar ao preenchimento dos restantes campos.
- Rejeição de categorias inválidas, sessão revogada, falta de permissão, organização diferente e revisão desatualizada.
- Repetição de envio incerto sem duplicar gravação nem auditoria.
- Migração aditiva do protocolo central; nenhuma alteração de dados ou implantação implícita.

Este contrato substitui, apenas para o tipo, a restrição de identidade imutável em complete-entity-profile.md.

## Implementação e instalação

- Ação **Alterar tipo** partilhada no perfil da organização e na ficha administrativa, sem exigir o resto da ficha. `UNSPECIFIED` aparece como **Por definir**.
- PUT `/api/organization-directory/registration/type` e PUT `/api/admin/directory/entities/:id/type` recebem exclusivamente `typeCode`, `expectedTypeCode`, `expectedRevision` e `requestId`. Reutilizam a autorização atual de edição da ficha e a autoridade central.
- Atualização atómica de `organization.type_code` e `organization_registration.fields.typeCode`; revisão da ficha, recibo e evento `PLATFORM_REGISTRATION_CHANGED` com detalhe `ENTITY_TYPE_CHANGED`, tipo anterior e novo. Sem alterar os snapshots históricos de adesão.
- Pacote explícito `055_entity_type_edit`, sobre `054_billing_account_validation`. A migração acrescenta uma query fechada ao protocolo e concede apenas UPDATE(type_code) ao proprietário do protocolo, sem escrita direta ao runtime.
- Instalador `backend/scripts/installEntityType.js`: diagnóstico por omissão; `--apply` é explícito. Requer `CENTRAL_MIGRATION_DATABASE_URL` fornecida pelo operador. Nunca registar o valor dessa variável.
- A instalação habitual, commit, push e publicação não foram executados. A variante de staging foi medida com logins sintéticos na base descartável; não se contactou o staging.

## Evidência isolada

`node test/integration/entity-type-edit/gate.cjs` cria e encerra uma instância PostgreSQL 18 própria em `.tmp`, sem ligação a bases existentes. `ENTITY_TYPE_GATE_STAGING_LOGINS=1` reproduz a variante de permissões de staging; `ENTITY_TYPE_GATE_CALIBRATE=1` serve apenas para medir a assinatura canónica.

Prova real: instalação e repetição sem efeitos, preflight 055, ausência de UPDATE direto para runtime, gravação pelo runtime de autoridade, replay, conflito de tipo/revisão, rollback integral perante falha de auditoria e dois escritores concorrentes. Resultado PASS na variante de staging: `.tmp/entity-type-edit-pg-1794704212730/fingerprints.json`. A variante genérica foi validada em `.tmp/entity-type-edit-pg-1794703747745`.

As quebras de linha do SQL são normalizadas pelo instalador antes da medição; não medir o SQL CRLF bruto, pois a função guardada recebe texto diferente.

## Validação da aplicação

- Frontend completo: 127 ficheiros, 1126 testes PASS (`.tmp/entity-type-frontend-final.log`). Teste administrativo adicional e regressões finais da ficha: 17 PASS (`.tmp/entity-type-final-focused.log`). Os timeouts da primeira execução em paralelo desapareceram com dois workers; os 44 casos dos três ficheiros afetados passaram também isoladamente.
- Backend completo: 3347 testes, 3334 PASS, 9 ignorados e 4 falhas. Três eram fixtures do catálogo que ainda desconheciam 055; foram corrigidas, acrescentada a prova de admissão de 055 e os 15 testes de `authorityMetadataDedup.test.js` passaram. A falha restante, SEC-AC-01 em `security/f2Security.test.js`, é anterior a este trabalho: `pages/Applications/useNextStepCompletion.js` já contém `sessionStorage` em HEAD, mas não está na lista de exceções desse teste. Não foi alterada nem ocultada.
- Serviços/rotas da ficha: 8 PASS; protocolo fechado, pacote e serviço: 16 PASS. A nova query está incluída na comparação exata entre catálogo JavaScript e SQL autorizado.
- Build de produção, lint e verificação sintática dos scripts alterados executados; nenhum commit, push, migração habitual ou deploy.

## Publicação no staging — 15/11/2026

Execução pelo utilizador na consola da VPS, autorizada nesta conversa. Resultado devolvido: `CENTRAL=055_entity_type_edit`, `READY=200` e `PUBLICACAO_055_CONCLUIDA`. Frontend ativo: `/srv/c4g-staging-web/releases/entity-type-055-20261115T140228Z`. Backup final e configurações privadas: `/srv/c4g-staging/backup/entity-type-055-activation-20261115T140228Z` (não copiar para logs).

A API preserva a correção PT2030 da imagem anterior. API, worker de recolha e worker de validação de faturação foram recriados com configurações guardadas. A ativação exigiu corrigir campos de rede incompatíveis na recriação Docker e três listas de versões admitidas: productionComposition, customerBilling/pdfRuntime e catalogReaderSecurity. A correção das imagens usa root apenas no build e repõe o utilizador original. 29 testes focados de catálogo/faturação passaram.

As imagens efetivas são `c4g-staging-api:c262040-pt2030-entity-type-055-v1` para API e `c4g-staging-api:c262040-entity-type-055-v1` para os dois workers, incluindo a correção de readiness. Os contentores anteriores foram preservados parados. Não arrancar imagens 054 contra a Central 055. Uma futura publicação por Compose deve selecionar imagens compatíveis com 055; os caminhos/labels anteriores foram preservados, não constituem indicação da imagem atual.

A prontidão e publicação foram confirmadas pelo resultado enviado pelo utilizador; a alteração de um tipo real pela interface ainda não foi observada. Nenhum tipo real foi escolhido automaticamente.
