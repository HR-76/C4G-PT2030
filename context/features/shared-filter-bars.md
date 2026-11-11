# Barras de filtro partilhadas

Pedido de 29/10/2026: implementar a análise de uniformização com frontend-design.

## Contrato e direção

Base branca #ffffff, fundo #f5f7f7, borda #cbdad6, texto #123247, rótulos #52636a e foco petróleo #075b59. Tipografia existente: rótulos 12px/600, valores 14px; controlos 40px desktop e 44px mobile, gap 12px, pesquisa larga. Sem animações ou contagens inventadas.

Composição: pesquisa e seletores / filtros avançados quando necessários / ações / resultados existentes. Variante integrada para quadros existentes e compacta para pesquisas em formulários. Filtros rápidos conservam botões de estado.

Revisão: não transformar todas as barras em formulários idênticos. Uma estrutura e CSS comuns com variantes, mantendo filtros imediatos onde úteis e submissão explícita para consultas compostas.

## Critérios de aceitação

- Cobrir catálogo, oportunidades privadas, candidaturas, parceiros, entidades/utilizadores, logs, faturação, pessoas, matching, alertas e pesquisas de destinatários/entidade em formulários.
- Catálogo: programa, estado, prazo e datas apenas aplicados ao submeter; limpar continua a mostrar todos os prazos. Datas inválidas bloqueiam submissão. Manter URL e paginação.
- Preservar debounce de candidaturas/parceiros; adicionar atraso aos filtros textuais privados e limpeza para estado ACTIVE. Pessoas: limpar para estado ACTIVE.
- Rótulos visíveis; foco por teclado dentro de search-box; aria-pressed nos tipos de alerta.
- Campos alinhados, mobile sem overflow; separar ações de conteúdo dos filtros de alerta; matching com título separado.
- Preservar isolamento, permissões, dados e contratos HTTP; não usar fixtures como dados reais.
- Testes focados, suite frontend, build e verificação Chrome de todos os tipos de barra em desktop/mobile. Registar limitações/falhas separadamente.

Estado: Review — implementação e validação concluídas em 29/10/2026.

## Resultado

- Componente FilterBar partilhado com variantes normal, integrada e compacta. Aplicado às 11 páginas identificadas, à pesquisa de entidade no modal de faturação e à pesquisa de destinatários.
- Aplicar filtros/Limpar filtros uniformizados nas consultas explícitas. Catálogo deixa de aplicar o prazo antes dos restantes campos; testes confirmam ausência de consulta antes da submissão e preservação dos filtros ao voltar da ficha.
- Pesquisas automáticas identificadas; debounce e cancelamento nas oportunidades privadas, mantendo os mecanismos existentes de candidaturas/parceiros. Limpeza de pessoas e oportunidades privadas repõe ACTIVE.
- Candidaturas agrupam estados, pesquisa e ordenação mobile. Todos os oito estados ficam visíveis em grelha mobile. Alertas expõem seleção com aria-pressed; ações separadas por uma linha.
- Faturação usa grelha de duas linhas em desktop. Pesquisa dentro de formulários usa a variante compacta.

## Validação e limites

- Frontend: 381 PASS em 57 ficheiros (`output/filter-bars-tests-final.log`). Após o ajuste final da ordenação mobile, 7 testes de ApplicationBrowse PASS (`output/filter-bars-sort-tests.log`). Build Vite PASS (`output/filter-bars-build.log`).
- Chrome isolado com API sintética: 22 combinações (11 páginas a 1440px/390px), alturas 40/44px, botões mobile com pelo menos 44px, foco visível, ausência de overflow horizontal e erros de página. Catálogo aplicar/limpar, modal de faturação e pesquisa de destinatários verificados. Resultado `output/playwright/filters-verification.json`, script `filter-bars-check.cjs` e capturas `filters-*.png` na mesma pasta. Capturas representativas de todos os tipos de barra revistas visualmente.
- Backend local: 1632 PASS, 2 FAIL, 7 SKIP nesta execução. Falhas em `official CEF and DIGITAL facet IDs do not exchange programmes` e `opportunitySourceEnrichment.test.js`, na área de fontes de oportunidades, fora dos ficheiros alterados. Log `output/filter-bars-backend.log`; não se afirma que a suite backend passou.
- Sem backend alterado, gates externos, dados reais, commit ou deploy. A única alteração em api.js permite passar AbortSignal à consulta privada existente; rota e parâmetros HTTP preservados.
