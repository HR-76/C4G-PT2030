# Medição das restantes alterações de UI — 10/11/2026

Estado: comparação A/B/B/A em Chrome headless, com componentes React reais compilados em modo de desenvolvimento e serviço HTTP apenas em loopback. As respostas da API foram substituídas por dados sintéticos; não foram usadas bases, identidade externa ou R2. O script reconstrói a variante anterior na memória e não altera os ficheiros da aplicação. Confirma que os hashes das fontes se mantiveram durante a medição.

| Percurso | Antes | Depois |
|---|---:|---:|
| Gate do catálogo: commits React, incluindo montagem, após 5 verificações | 6 e 6 | 3 e 3 |
| Equipa: mediana da duração de renderização em 12 atualizações | 11,10 ms | 9,70 ms |
| Equipa: intervalo das 12 durações | 10,20–16,40 ms | 8,40–11,70 ms |

No gate, os cinco pedidos devolveram disponibilidade e revisão inalteradas; o intervalo de polling foi acelerado de 15 segundos para 150 ms apenas no ensaio. A verificação real mantém o intervalo original. Na equipa, a fixture apresentou 500 participantes e 500 tarefas já carregadas, com 333 tarefas abertas. Cada execução realizou seis atualizações do componente, preservou 500 participantes, 333 tarefas abertas no agregado e nenhum botão de edição para o perfil de consulta. A duração medida é `actualDuration` do React Profiler, não tempo de abertura da página ou latência de rede. A fixture apresenta diretamente os dados acumulados; não testa a paginação de produção nem autenticação real.

A série é pequena (duas execuções de cada variante, 12 atualizações por lado), usa build de desenvolvimento e não comprova ganho em produção. Não foi medida a correção do temporizador nesta série: a prova anterior está em `context/reviews/catalog-render-isolated-20261110/README.md`. A primeira execução desta fixture colocava o Profiler no conteúdo filho e não media o próprio gate; os seus resultados foram preservados em `context/reviews/remaining-render-isolated-20261110/results.json` e não são comparáveis aos contadores acima.

Dados completos: [results.json](results.json). Script: `test/integration/catalog-render-isolated/remaining-profile.cjs`. A comparação não altera o produto e não altera os testes de segurança existentes; os controlos de acesso são simulados nesta medição.
