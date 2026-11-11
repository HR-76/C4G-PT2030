# Entrega 4 — página de integrações e histórico

2026-10-17. Primeiro incremento em Review; entrega 4 em curso.

O utilizador autorizou avançar e deixar a configuração dos anexos para o final. Entrega 3 continua com pendência documental, incluindo composição e demonstração efetiva, não apenas credenciais.

## Resultado

Página habitual `/integracoes` recupera as cinco secções do piloto. O cabeçalho/ícone/secção foi extraído para `IntegrationSourceSection` e é partilhado pelas páginas original e atual. Mantém marca C4G, densidade e tabela de histórico; acrescenta estado de recuperação e contagens de falhas/inalterados já persistidas. Datas, fonte e estado são legíveis integralmente; adaptação móvel conserva todos os campos.

O GET `/api/admin/integrations/funding-tenders` conserva `source`, `lastRun`, `sourceMode` e acrescenta `runs` (máximo 100), `runsLimited` e `received` nas execuções. Ordem `created_at DESC, run_id DESC`; read-only depois de confirmar utilizador ativo e atribuição central C4G_ADMIN. Sem payloads recolhidos ou identificadores de quem pediu a execução. Cliente continua em `frontend/src/api/api.js`, sem novo endpoint ou canal de acesso.

POST, idempotência do servidor, worker, limites, agendamento, grants e esquema permanecem os existentes. Interface preserva a mesma intenção após resposta incerta, impede duplo envio, bloqueia atualização após falha da consulta, descarta respostas de outra conta e distingue modo de teste de fonte real. As quatro fontes não ligadas apresentam impedimento explícito e ação desativada.

## Estado individual das fontes

| Fonte | Evidência e limite |
|---|---|
| Funding & Tenders | Modo habitual `live-local`; quatro execuções persistidas conferidas. Atualização manual continua limitada a cinco resultados. Não foi disparada nova recolha nem ampliada cobertura neste incremento. |
| CORDIS | Conector preservado usa Funding & Tenders com filtros Horizon/EURATOM e writes legacy. Ligação à central pendente. |
| Erasmus+ | Conector preservado usa Funding & Tenders com filtros e writes legacy. Ligação à central pendente. |
| Interreg Europe | Código em `externalOpportunitySyncService.js`; disponibilidade externa/parser atual e adaptação central ainda não comprovados. |
| POCTEP | Mesmo serviço legado; consulta atual e adaptação central ainda não comprovadas. |

Importações e alertas não foram implementados neste incremento. Nenhuma fonte pendente é declarada operacional.

## Verificação

- Backend: 11 testes PASS (`fundingIntegrationHistory`, `fundingPlatformCatalog`, `fundingTendersAuthority`), incluindo limites/projeção, HTTP, autoridade atual, revogação e separação cliente/plataforma.
- Frontend: 5 testes PASS (`FundingIntegrations`), incluindo cinco fontes, modo não configurado/teste, repetição da intenção, falha de consulta e descarte entre contas.
- Build frontend e sintaxe backend/scripts: PASS.
- Chrome habitual com contas OIDC existentes: ADMIN consulta os mesmos quatro registos e contadores da base; utilizador de organização recebe 403. Desktop 1440/1280/1008 e móvel 390, teclado, zero erros de página, zero escritas de negócio/recolhas e fingerprint do catálogo/histórico preservado.
- Comparação com componente original do commit `3a79b25539040c2024051cf9ab6295680b760277`, usando os mesmos contadores públicos projetados no formato antigo. A referência é estática, não liga ao backend legacy nem prova esses conectores. Comparação inspecionada; corrigida truncagem de datas/fonte/estado antes da captura final.

[Comparação lado a lado](../../output/playwright/c4g-integrations/comparison.html), [prova nativa](../../output/playwright/c4g-integrations/native-verification.json). Scripts reproduzíveis: `test/integration/integrations/native.cjs` e `reference.cjs`.

## Continuação

Completar cobertura/paginação de Funding & Tenders e adaptar os filtros CORDIS/Erasmus ao catálogo central sem duplicação; verificar as duas outras fontes individualmente. Importação e alertas seguem no âmbito da entrega 4. Configuração e validação reais dos anexos ficam para o fecho, conforme orientação do utilizador. Não confundir esta recuperação inicial da página com conclusão da entrega 4 ou equivalência integral do piloto.
