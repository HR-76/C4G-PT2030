# Prioridade 3 — consistência, telemóvel e carregamento

Estado: Em implementação, 09/11/2026. Pedido do utilizador para avançar com a prioridade 3 de UX.

## Âmbito e aceitação
- Reutilizar o indicador de carregamento acessível existente em listas administrativas e faturação; conservar estados, acessos, dados, filtros e erros.
- Melhorar a adaptação de filtros ativos e valores monetários longos em ecrãs pequenos sem truncar valores nem alterar cálculos.
- Executar testes focados e build; verificar apresentação em desktop e telemóvel com dados de exemplo. Não apresentar alterações cosméticas como melhoria comprovada de latência.
- A medição dos percursos reais e a otimização de desempenho permanecem sujeitas a ambiente acessível e evidência própria; não executar testes de carga ou mutações em bases habituais.

## Resultado e limites
- Carregamento partilhado aplicado a entidades/utilizadores, logs e faturação; filtros longos e cartões de indicadores ajustados para conter texto extenso.
- Build e 51 testes focados PASS. Revisão isolada em 1440 e 390 px com filtro e montante sintéticos longos: sem overflow horizontal; valores mantidos, com quebras de linha.
- A revisão não substitui os percursos reais e não mede tempos de resposta. Acesso à sessão real continua pendente; medições/otimizações PERF-01/02/03 continuam trabalho próprio.

## Ensaio isolado de percursos e tempo — 09/11/2026

[Resultados r3](../reviews/ux-priority3-20261109-r3/results.json): PostgreSQL e Keycloak descartáveis, duas entidades sintéticas, 1000 candidaturas e 250 pessoas por entidade, uma oportunidade central sintética; OIDC e aplicação compilada. Duas aberturas por largura (1440/390). Tempos até ao conteúdo selecionado e duas frames, em milissegundos: dashboard 4708/4740 (1440), 4233/4174 (390); catálogo 1690/2189, 1685/2254; candidaturas 4221/3689, 4699/4210. Os pedidos principais de dashboard demoraram 3287–3615 ms e os de candidaturas 2645–3420 ms na amostra. Duas amostras não sustentam percentis ou conclusões de produção; instrumentação adiciona amostragem e a largura de viewport não emula hardware/rede de telemóvel.

Sem overflow horizontal nas páginas inspecionadas, com capturas sintéticas na pasta r3. Abriu-se o detalhe da oportunidade em ambas as larguras. A conta sintética não apresentou ação de registar interesse no detalhe, pelo que o percurso completo até criação de candidatura não foi demonstrado; não interpretar ausência dessa ação como defeito sem verificar permissões e configuração da fixture. Não se testou submissão de candidatura nem sessão real. A segunda execução r2 com catálogo vazio confirma apenas o estado vazio; a primeira medição de catálogo usou seletor menos rigoroso e não serve de referência. Não foram alteradas bases habituais; integridade de fontes PASS. O runner executou a limpeza dos seus contentores; existem outros contentores com a mesma família de etiquetas, cuja origem não foi atribuída a estas execuções e que foram preservados.


## Percurso completo com permissões de interesse — 10/11/2026

A fixture original de `http-oidc/fixture.js` concedia permissões de oportunidade e candidatura, mas não `opportunity_interest.read`, `.register` e `.manage`. Para este ensaio as três foram acrescentadas exclusivamente às duas contas ORG_ADMIN sintéticas, usando a alteração de autoridade da fixture antes de iniciar as sessões. Não se conclui que as contas reais tenham as mesmas permissões.

[Resultado](../reviews/catalog-application-ux-20261110/results.json): OIDC, isolamento e readiness PASS; em 1440 e 390 px, cada entidade registou um interesse transversal, abriu a lista e o detalhe, preparou candidatura, preencheu título, responsável e prazo e criou candidatura sintética, chegando à respetiva ficha. Sem overflow horizontal medido no formulário e na ficha; capturas disponíveis no relatório. Bases e contas de negócio habituais não foram usadas. A oportunidade e as candidaturas existiram apenas nas bases descartáveis.

Limite: surgiram erros de pedidos em curso durante o encerramento dos pools, depois dos dois percursos terem passado. O relatório ficou COMPLETE e a integridade de fontes foi confirmada; a consulta de contentores por etiqueta após o ensaio não encontrou contentores da família de teste. O ensaio não mede desempenho nem valida permissões, dados ou sessão reais do Hugo.
