# Arquivo habitual EU legado — 391 candidatos v2

01/11/2026. Pacote OIDC `1e849d47-89e1-4fad-b2cd-0208c0d348b8`; export completo SHA-256 `141d242c4804ea75a0ba3cae9cb83e2e122061e8f455ed8315930f254ac94b6e`. Os 391 recibos foram validados individualmente contra o ledger Central, pacote, ator, evento, binding e evidência antes da janela. EU estava `QUIESCED`/fence 7.

## Execução e recuperação

A janela habitual `7ccf90f0-53bb-40a9-a214-11dd5aff1da7` pausou os serviços às 00:33:05 UTC. O backup/restauro novo `output/opportunity-v2-window/7ccf90f0-53bb-40a9-a214-11dd5aff1da7/backup-restore-3acc13b4-7a3f-42a6-8e4c-cef90c2abbb3.json` passou: Central 044/tenant 034, dados, sequências e configuração protegida restaurados sem drift, instância temporária encerrada. A fronteira imediata voltou a comparar dados, sequências, configuração e zero sessões externas: PASS. Preflight OIDC 391/391 repetido dentro da pausa.

O instalador registado aplicou apenas `045_opportunity_eu_legacy_prearchive`. O executor arquivou 391 identidades, cada uma com run terminal e autorização OIDC consumida na mesma transação do candidato. Reconciliação interna: `ARCHIVED_AND_RECONCILED`, 391 novos, zero repetidos, 391 candidatos. O relatório primário `output/eu-legacy-archive-execution-7ccf90f0-53bb-40a9-a214-11dd5aff1da7/execution.json` terminou **FAIL** porque o worker recusou o catálogo 045 e a saúde não regressou dentro do prazo. Esse estado de falha é preservado; não reinterpretar o relatório primário como PASS.

Causa identificada: `backend/src/opportunities/preflight.js` reconhecia os catálogos até 044, mas faltavam a entrada 045 e a tabela `eu_legacy_prearchive_use_v1` na lista fechada. Foi adicionada regressão RED→GREEN em `backend/test/opportunityV2ReconciliationAdmission.test.js`, corrigido o preflight e reiniciados os serviços locais. A saúde posterior confirmou `ready`, worker e admissões `true`. Suite backend após a correção: 2374 PASS, 0 FAIL, 7 SKIP (`output/eu-legacy-postarchive-backend-tests.log`). A primeira corrida da suite teve uma falha isolada em `f3OrganizationHttpErrors`; o teste focado passou e a repetição integral ficou verde.

## Conferência final read-only

`scripts/eu-legacy-archive-postcheck.cjs` passou às 00:37:04 UTC: migração 045 instalada, 391 candidatos/391 permits/391 runs vinculados ao export, digests de conteúdo e payload coincidentes, **398 heads v1 preservados** (UUID, revisão e rowVersion), sete conflitos sem candidato, EU `QUIESCED`/fence 7, zero writes na conferência. O arquivo conserva snapshots oficiais v2; não houve aceitação de revisões nem retoma da recolha automática. O pacote expira às 00:51:19 UTC; a execução e a conferência ocorreram antes disso.

## Limite da fase

Os 391 registos estão arquivados como candidatos para revisão posterior. A aceitação de cada candidato e a retoma do escritor EU requerem autoridade e plano próprios. Os sete conflitos continuam excluídos e exigem resolução causal separada. Não fazer replay de aprovações ou novo arquivo com o pacote expirado.
