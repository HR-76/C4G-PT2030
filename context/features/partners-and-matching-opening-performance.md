# Parceiros e Matching — desempenho

Estado: Review. Sem medição em ambiente real.

Sexto bloco da revisão de desempenho página a página (14/11/2026). Bloco anterior: [O meu trabalho e Calendário](my-work-and-calendar-opening-performance.md).

## Alterações

1. **Parceiros sem espera fixa** (frontend). A espera de 250 ms antes de cada pedido passa a aplicar-se só enquanto se escreve na pesquisa; abertura, outros filtros e paginação pedem de imediato.
2. **Parceiros: filtrar ou mudar de página** (frontend) mantém as linhas anteriores esbatidas e inativas até chegar a resposta.
3. **Matching: seletor de pessoas depois do resultado** (frontend). As páginas de pessoas do seletor são pedidas depois de os pedidos da página terminarem (`afterPageRequests`), em vez de competirem com o cálculo.
4. **Matching: mudar de pessoa** (frontend) mantém o resultado anterior esbatido e inativo até chegar a resposta; se o cálculo falhar, sai.
5. **Matching: catálogo central reutilizado** (servidor, decisão do utilizador). No modo por pessoa, as páginas do catálogo central eram lidas de novo em cada cálculo. `createOrganizationMatching` guarda agora a leitura durante 30 s e os cálculos simultâneos partilham-na; uma leitura falhada nunca é guardada. A pessoa, as oportunidades privadas da entidade e a revalidação de autoridade no fim continuam a ser lidas em cada cálculo. Consequência aceite: uma alteração ao catálogo central pode demorar até 30 s a refletir-se no Matching. Ativado em `productionComposition.js` (`centralPagesReuseMs:30000`); desligado por omissão na fábrica.

## Validação

- Backend: `matchingCentralReuse.test.js` (4), RED antes e GREEN depois; suite 3221 aprovados, 9 ignorados, 0 falhas.
- Frontend: `PartnersBrowse.test.jsx` (novo, 3) e `MatchingWorkspace.test.jsx` (+2); suite 1061 aprovados; build e lint aprovados.
- Sem browser, sem PostgreSQL real e sem medição do ganho do ponto 5.

## Por fazer

- Cada página do catálogo lida por `central.list` recalcula a lista de programas, que o Matching não usa. Com a reutilização passa a acontecer no máximo uma vez a cada 30 s; removê-lo exigiria uma leitura própria do catálogo para o Matching.
- O limite de 1000 itens e a paginação do Matching (PERF-03) continuam abertos.

## Leitura própria do catálogo para o Matching (20/11/2026) — Review

Medido no staging com a [medição por fase](request-phase-timing.md): `organization-directory/matching` demorava 4,9–5,5 s, dos quais cerca de 1 s nas fases de autoridade e do tenant. O resto era a leitura do catálogo central inteiro em páginas de 25: cada página recalculava a lista de programas de todo o catálogo (uma leitura de todas as revisões por página) e a apresentação e classificação de cada oportunidade. O Matching não usa nenhuma das duas. A reutilização de 30 s só evita este custo a quem volta a abrir dentro desse período.

Alteração (servidor): `listForMatching` no repositório e no leitor do catálogo — as mesmas linhas, a mesma ordem, o mesmo cursor e o mesmo modelo de leitura que a listagem, sem a lista de programas e sem apresentação/classificação. Aceita só o cursor. O Matching usa-a quando o leitor a oferece; a listagem do catálogo não muda. Fecha o primeiro ponto de «Por fazer» acima.

Fases novas na medição: `catalog.list` (o número de vezes é o número de páginas lidas), `catalog.programmes`, `matching.central`, `matching.private` e `matching.match`.

Validação: `catalogMatchingRead.test.js` (5, RED antes e GREEN depois), incluindo a igualdade da projeção do Matching entre a listagem e a leitura nova em 60 oportunidades; `catalogReader.test.js` atualizado para o método novo de leitura. Sem medição do ganho: a confirmar no staging. O limite de 1000 itens e a paginação do Matching (PERF-03) continuam abertos.

### Medição no staging e segunda correção (20/11/2026, commit 8eb026e) — Review

Catálogo com 29 páginas (cerca de 725 oportunidades). A leitura dedicada baixou a leitura fria do catálogo de cerca de 3,9 s para 2,9–4,1 s: menos do que o previsto, porque a lista de programas custava só 36 ms por página. O pedido ficou em 4,0 s a frio e 1,0–1,2 s dentro dos 30 s de reutilização. As fases mostraram dois custos que a primeira correção não tocou:

1. **Cruzamento de áreas (`matching.match`): 545–660 ms em todos os pedidos**, mesmo com o catálogo reutilizado. A sugestão de áreas por palavras-chave de cada oportunidade era recalculada em cada pedido, embora só dependa dos textos da oportunidade e nunca da pessoa. Passa a ser calculada uma vez por texto distinto (`thematicAreas.classify`, até 4000 entradas, resultado imutável).
2. **Validação de cada oportunidade em cada leitura.** A cache de factos por revisão tem 500 entradas e o catálogo tem mais: uma leitura completa em sequência nunca a aproveita. A leitura do Matching passa a ter a sua própria (1500 entradas, só o snapshot validado, comparado por resumo do conteúdo); uma revisão é validada de novo apenas quando o snapshot guardado muda.

Fase nova: `catalog.query` (a consulta SQL de cada página), para separar a base de dados do trabalho no processo.

Validação: `catalogMatchingRead.test.js` (+2, RED antes e GREEN depois). Ganho por medir no staging. Por decidir, consoante essa medição: a leitura fria do catálogo, que continua a ser de 29 páginas em série.

### Medição da segunda correção (20/11/2026, commit 7f1bad3)

- `matching.match`: de 545–660 ms para 16–21 ms.
- Pedido com o catálogo reutilizado (dentro dos 30 s): de 1,0–1,2 s para 0,53–0,68 s.
- Primeira leitura do catálogo depois de reiniciar a API (caches vazias): 3,3 s em 27 páginas, das quais 1,04 s em SQL (`catalog.query`, cerca de 37 ms por página) e o resto em validação no processo.
- **Por medir:** uma leitura do catálogo com as validações já em cache (as três aberturas seguintes caíram todas dentro dos 30 s de reutilização). O mínimo esperado é o tempo de SQL, cerca de 1 s.

### Terceira correção: validação repetida no modelo de leitura (20/11/2026) — Review

Nova medição no staging (commit 7f1bad3): relendo o catálogo com as validações em cache, `catalog.list` ainda demorou 2,8 s em 27 páginas, dos quais 1,33 s em SQL. Sobravam cerca de 1,45 s de trabalho no processo.

Reproduzido localmente com 725 oportunidades sintéticas e as caches quentes: 2,2 s por leitura completa. O perfil de CPU atribuiu metade do tempo a `cloneData`, chamado por `validateSnapshotV2` a partir de `projectTemporalV2` dentro de `createOpportunityReadModel`: o cálculo temporal **validava de novo o snapshot que `readOpportunitySnapshot` acabara de validar e congelar**, em todas as leituras de todas as oportunidades.

Alteração (`opportunities/v2/readModel.js`): quando o snapshot é o resultado congelado do validador, os factos temporais são calculados com `projectTemporalFacts`, sem segunda validação. Um valor que não seja esse resultado congelado continua a ser validado antes de ser usado. O resultado é idêntico.

Abrange todas as leituras de oportunidades da versão 2 (listagem e detalhe do catálogo, dashboards, Matching), não só o Matching.

Medição local, mesma máquina e mesmos dados: leitura completa com caches quentes de 2,2 s para 0,16 s; primeira leitura de 3,45 s para 1,56 s. No staging, por medir.

Validação: `readModelTemporalValidation.test.js` (3; o primeiro RED antes e GREEN depois): sem segunda validação, igualdade do modelo de leitura com e sem snapshot preparado em três instantes, e validação mantida para um valor não congelado.
