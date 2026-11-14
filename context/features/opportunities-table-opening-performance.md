# Abertura da tabela de Oportunidades — desempenho

Estado: Review. Sem medição em ambiente real.

Segundo bloco da revisão de desempenho página a página (14/11/2026), depois do [Dashboard](dashboard-opening-performance.md). Queixa do utilizador: na tabela de Oportunidades, o interesse e «Iniciar candidatura» não aparecem ao mesmo tempo que a tabela. Decisão do utilizador: «botões logo» — a tabela não espera pelos interesses.

## Causa

A página pedia a lista; só depois de conhecer as linhas pedia os interesses dessas oportunidades, e as permissões (registar interesse, criar candidatura) vinham nessa segunda resposta. «Iniciar candidatura» ficava escondido até lá.

## Alterações (só frontend)

1. **Permissões em paralelo com a lista.** `CatalogInterests` pede `GET /opportunity-interests/context` ao montar, sem esperar pelas linhas. «Iniciar candidatura» aparece assim que a permissão é conhecida e deixa de depender do estado dos interesses. O pedido só é feito quando não há permissões confirmadas na sessão; a resposta dos resumos continua a confirmá-las em cada entrada. Substitui a regra anterior «sem pedido de contexto quando os resumos trazem a permissão»: passa a haver, no máximo, um pedido de contexto por utilizador e organização enquanto os dados confirmados existirem.
2. **Interesses confirmados.** Os resumos de interesse da mesma página e as permissões usam os [dados confirmados](confirmed-reads-page-reuse.md): aparecem de imediato na reabertura e são lidos de novo. Se a nova leitura dos interesses for recusada, saem do ecrã, incluindo as permissões que o servidor não confirmou nessa entrada.
3. **Primeira página do catálogo confirmada.** `CentralOpportunities` mostra de imediato a primeira página da mesma consulta (filtros e ordenação) e lê-a de novo. Páginas seguintes e a ficha são sempre lidas do servidor.

A autorização real não muda: criar candidatura e registar interesse continuam a ser decididos pelo servidor no momento da ação.

## Critérios de aceitação

- Com a lista respondida e os interesses ainda por responder, «Iniciar candidatura» está visível e ativo nas linhas não arquivadas.
- Sem permissão de criar candidatura, o botão não aparece.
- Na reabertura, tabela, coração e botão aparecem antes de qualquer resposta; lista e resumos são pedidos de novo; o contexto não é pedido.
- Outro utilizador nunca vê dados confirmados.

## Validação

- Regressões em `CentralOpportunities.test.jsx` (+4) e dois testes ajustados ao novo contrato do pedido de contexto (`CentralOpportunities.test.jsx`, `InterestFlow.test.jsx`).
- `frontend/test-harness/setup.js` limpa os dados confirmados antes de cada teste.
- Frontend 1034 aprovados, build e lint aprovados. Sem browser nem sessão real.

## Pontos 4 a 6 (14/11/2026, só frontend)

4. **Oportunidade já lida.** «Iniciar candidatura» na tabela entrega ao formulário, pelo estado da navegação, o registo que acabou de ler. O formulário usa-o em vez de o pedir outra vez quando é a mesma oportunidade e revisão e foi lido há menos de 60 s; caso contrário lê como antes. Só no catálogo da entidade (`centralOpportunitiesApi`). O servidor continua a validar a revisão ao criar.
5. **Lista de Candidaturas ao filtrar.** Ao mudar filtro, ordenação ou página, as linhas anteriores ficam no ecrã, esbatidas e inativas (`inert`, `aria-busy`), até chegar a nova resposta. Se a leitura falhar, saem.
6. **Código do detalhe separado da lista.** A rota usa `ApplicationsPage`, que abre a lista sem o código do registo (criação, detalhe, equipa, documentos, chat, parceiros) e o descarrega ao abrir um registo, ou 1,5 s depois de a lista aparecer. No build: lista 24 KB de JavaScript e 13 KB de CSS (antes 130 KB e 56 KB num só ficheiro); registo 110 KB e 43 KB. `PrivateApplications` mantém o comportamento para os testes existentes; a escolha da vista está em `ApplicationsRoute`.

Regressões: `ApplicationBrowse.test.jsx` (+2), `PrivateApplications.test.jsx` (+1), `CentralOpportunities.test.jsx` (+1). Frontend 1038 aprovados, build e lint aprovados; sem browser. Nota: `PrivateApplications.test.jsx` regista 4 a 5 erros não tratados de formatação de pilha no jsdom, também presentes com os ficheiros da versão commitada; não foram introduzidos aqui.

## Por fazer deste bloco

7. Cascata de pedidos no detalhe da candidatura.
