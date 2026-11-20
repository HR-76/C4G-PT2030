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
