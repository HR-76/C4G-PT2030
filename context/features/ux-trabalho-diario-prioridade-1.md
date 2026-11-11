# Melhorias de trabalho diário — prioridade 1

Estado: Em implementação, 09/11/2026. Pedido do utilizador para iniciar a prioridade 1 da revisão de UX.

## Âmbito e aceitação
- Destacar, na vista inicial de gráficos do dashboard, prazos internos já disponíveis e autorizados, com ligações existentes; sem inferir tarefas ou novos indicadores. Manter as vistas e URLs existentes.
- Mostrar filtros ativos removíveis na lista de candidaturas, incluindo pesquisa, estado, unidade e oportunidade; preservar aplicação imediata, paginação e parâmetros de ordenação.
- Apresentar tarefas abertas primeiro e identificar tarefas não abertas entre as já carregadas, sem sugerir que a página atual é o conjunto completo; preservar autorização, paginação, mutações e histórico.
- Verificar estados vazios, ações existentes, testes focados, build e apresentação responsiva. Não criar dados reais nem alterar permissões.

## Resultado e limites
- Dashboard destaca prazos já devolvidos pelo resumo autorizado; filtros da lista de candidaturas podem ser removidos individualmente; tarefas abertas aparecem primeiro entre as carregadas.
- Build frontend PASS; 57 testes focados PASS, incluindo prazo, remoção de pesquisa e ordenação de tarefas carregadas.
- Validação visual responsiva e percurso com a sessão real continuam pendentes; a sessão Brave não pôde ser inspecionada na tentativa anterior. A organização de tarefas não pretende ordenar páginas ainda não carregadas. Não foram alterados backend, permissões ou dados.
