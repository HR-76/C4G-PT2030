# Desempenho interno e data civil do Matching

Estado: Review, 19/10/2026.

## Objetivo

Reduzir o tempo do endpoint autenticado de Matching sem alterar resultados, ordem, explicações ou fronteiras de autorização, e corrigir a comparação de prazos para usar o dia civil de Lisboa.

## Evidência de partida

- O ajuste anterior eliminou pedidos duplicados no frontend, mas o endpoint continuou entre 7,3 s e 8,6 s no ambiente habitual.
- A leitura central isolada, incluindo 114 detalhes, demorou menos de 140 ms; não explica o custo dominante.
- Para cada oportunidade privada, o serviço volta a entrar no runtime autorizado através de `get`, apesar de a página da listagem já ter sido autorizada. É um N+1 de operações de autoridade, não apenas de SQL.
- O dia usado para excluir prazos expirados deriva de `toISOString()`, portanto de UTC. Durante a primeira hora do dia no horário de verão de Lisboa, uma oportunidade que terminou no dia anterior ainda pode ser apresentada.

## Âmbito aprovado por este pedido

- Criar uma leitura interna de páginas privadas para Matching que devolva os snapshots correntes dentro da mesma operação autorizada da listagem.
- Consumir essa leitura apenas no serviço de Matching; o contrato HTTP público de oportunidades permanece inalterado.
- Continuar a validar a autoridade no início e no fim do cálculo.
- Ler catálogo central e catálogo privado em paralelo, porque residem em fronteiras independentes.
- Calcular o dia civil em `Europe/Lisbon`.
- Não adicionar cache, não alterar o motor determinístico, os filtros, o limite de 1000 itens por fonte, os dados ou as permissões.

## Critérios de aceitação

1. Uma página privada exige uma operação autorizada de listagem, sem uma nova operação autorizada por oportunidade.
2. O snapshot usado na classificação é exatamente a revisão corrente devolvida pela mesma transação tenant da página.
3. Falta ou inconsistência de qualquer snapshot falha fechado; nunca produz resultados parciais.
4. A revalidação final do contexto continua obrigatória, incluindo depois de todas as leituras de origem.
5. Resultados, ordenação e explicações mantêm-se iguais para as mesmas fontes e relógio.
6. Às 23:30 UTC de 1 de julho de 2026, o dia do Matching é 2 de julho em Lisboa e uma oportunidade com prazo em 1 de julho já não aparece.
7. Testes direcionados, `node --check` dos ficheiros alterados e build frontend passam.
8. A medição do endpoint no ambiente habitual é repetida quando esse runtime estiver disponível; sem essa prova não se declara uma percentagem de melhoria backend.

## Implementação

- A composição privada ganhou `listForMatching`, método interno que reutiliza a autorização `OPPORTUNITY_READ`, lista uma página e lê todos os snapshots correntes numa única consulta dentro da mesma transação tenant preparada.
- O serviço usa essa página enriquecida sem chamar `get` por oportunidade privada. A ausência de qualquer snapshot falha fechado na composição.
- As leituras central e privada arrancam em paralelo. O limite, a paginação e a revalidação final não mudaram.
- O dia atual passou a ser formatado explicitamente em `Europe/Lisbon`.
- O contrato HTTP público de oportunidades e o motor de classificação não foram alterados.

## Resultado medido

No benchmark direto autenticado, as três amostras passaram de **8217, 7953 e 7343 ms** para **7035, 7102 e 7248 ms**. A mediana passou de 7953 ms para 7102 ms, uma redução de **10,7%**. As seis respostas têm dez resultados e o mesmo hash integral `1b800e3920b9ee1143c49a5bb2a11d8d708fef246c3ed78610b45542bd743d45`.

Na página completa, a mediana do endpoint passou apenas de 8404 ms para 8330 ms e o tempo até renderizar variou de 11707 ms para 12099 ms. Esta execução não demonstra melhoria material de UX: o conjunto habitual tem correspondências centrais e pouco trabalho privado, enquanto os custos fixos de contexto/autoridade continuam dominantes. O ganho estrutural desta alteração é evitar crescimento linear de operações autorizadas quando existirem oportunidades privadas; não extrapolar a redução de 10,7% como SLO ou ganho produtivo.

O bug de data foi reproduzido às 23:30 UTC de 1 de julho de 2026: em Lisboa já é 2 de julho. O teste confirma que uma oportunidade com prazo em 1 de julho deixa de aparecer.

## Validação

- Backend direcionado: **32/32 PASS**, incluindo Matching, diretório, HTTP F12, composição e segurança de importação.
- Frontend direcionado: **9/9 PASS**.
- `node --check` nos três ficheiros JavaScript alterados: PASS.
- Build Vite: PASS, 2118 módulos transformados.
- `git diff --check` no âmbito: PASS; apenas avisos de conversão LF/CRLF já configurada pelo repositório.
- Evidência nova: `output/matching-performance/after.json` e `page-after.json`. A medição frontend anterior foi preservada em `page-frontend-after.json`.

## Limite conhecido

Clarificação de 26/10/2026: a eliminação de N+1 deste incremento dizia respeito às oportunidades privadas. O percurso por oportunidade ainda lia cada pessoa individualmente; esse percurso foi corrigido na [feature GET/POST e desempenho](http-flows-performance.md), com páginas `peopleWithResearchAreas`.

Permanece cerca de sete a oito segundos de custo fixo no endpoint habitual. Uma alteração adicional exige instrumentação por fase das duas leituras de contexto/autorização e prova de que qualquer redução preserva a revogação final; esta fatia não enfraquece essa garantia.

