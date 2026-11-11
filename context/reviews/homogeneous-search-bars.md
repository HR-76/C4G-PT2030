# Verificação dos campos de pesquisa — 31/10/2026

Contrato: [campos de pesquisa homogéneos](../features/homogeneous-search-bars.md).

## Alteração

- Um `SearchInput` visual para 12 instâncias de código: catálogo, candidaturas, parceiros, diretório reutilizado por entidades/utilizadores, logs, faturação, modal de faturação, pessoas, interesses, destinatários e os dois filtros de oportunidades privadas.
- Altura 40px / 44px até 700px; raio 5px; lupa decorativa 16px; fonte 14px/400/1.4; padding 8px 11px 8px 35px; intervalo efetivo de 8px entre lupa e texto.
- Tokens existentes para superfície, borda, texto, placeholder e foco. O input mantém o seu contorno e foco nativos estilizados, sem resets `!important`.
- Rótulos, placeholders existentes, limites e handlers conservados. Sem alterações de pedidos, debounce, submissão ou estado funcional.
- Revisão independente contra cópias dos 17 ficheiros anteriores à alteração, sem findings acionáveis. O diff Git global contém trabalho anterior e não foi tratado como pertencente a este pedido.

## Regressão visual e responsiva

Prova reproduzível: `node output/playwright/search-bars-check.cjs`. Vite e Chrome isolados, porta temporária, todas as respostas API sintéticas. Nenhum serviço ou base de dados habitual utilizado.

- Antes da correção: `output/playwright/search-bars-baseline.json`, 24 combinações / 26 controlos a 1440/390px; diferenças confirmadas de raio (6/5px), lupa (14/16px/ausente), recuo de texto, placeholder e atributos do ícone. Zero erros de página.
- Depois: `output/playwright/search-bars-verified.json`, 48 combinações / 52 controlos a 1440/768/390/320px, zero falhas e zero erros de página.
- Verificados estilos computados, igualdade entre contextos, alturas, rótulos, lupa centrada, intervalo de texto, clique na lupa a focar o input, escrita/limpeza, foco visível e ausência de overflow horizontal. A medição aguarda as transições CSS existentes.
- Interações reais de teclado PASS: Tab chega à pesquisa com foco visível; Enter submete o termo e o pedido; Escape nativo limpa o campo controlado sem alterar o filtro aplicado antes da submissão; Limpar filtros repõe campo e URL. Prova: `node output/playwright/search-bars-check.cjs --interactions-only`, resultado `output/playwright/search-bars-interactions.json`.
- Capturas `output/playwright/search-bars-verified-*.png`. Revistas visualmente amostras de catálogo desktop, faturação mobile, diretório a 320px, modal de faturação mobile, destinatários desktop e filtros privados a 768px.

A matriz usa Chrome com dados sintéticos; não constitui prova de autenticação, acesso a dados reais ou comportamento em todos os motores de browser.

## Testes locais

- Focados: **107 PASS / 9 ficheiros**, `output/search-bars-focused.log`.
- Frontend completo: **493 PASS / 63 ficheiros**, `output/search-bars-frontend.log`.
- Build Vite: **PASS**, `output/search-bars-build.log`.
- Backend completo, executado antes das alterações ao frontend: **2170 PASS / 34 FAIL / 7 SKIP**, `output/search-bars-backend.log`. Falhas preexistentes em `authorityMetadataDedup.test.js` (13), `centralMigrationAndLifecycle.test.js` (1), `centralMigrationPreflight.test.js` (1) e `centralSchemaCatalogBatch.test.js` (19), na área de manifesto/metadados central. Não foram alterados ficheiros de backend nem expectativas de testes.

Sessões temporárias Vite/Chrome encerradas. Sem gates externos, alterações de dados, commit, push ou deploy.
