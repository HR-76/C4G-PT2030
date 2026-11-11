# Prova exploratória de consistência do matching — 10/11/2026

Estado: a paginação do matching continua por implementar. Esta prova não altera o percurso público nem demonstra consistência de produção.

O primeiro ensaio, com PostgreSQL 17 descartável e executor/guards existentes, reproduziu a captura desatualizada quando o marcador Central é libertado antes do commit tenant. Observou também, no cenário sintético, que manter o marcador até ao commit impede a mutação Central concorrente e que um rollback liberta o marcador. A execução completa terminou FAIL com `LEASE_TIMEOUT` numa etapa posterior; não se pode declarar o gate aprovado. Os resultados parciais estão em [integrated.json](integrated.json).

A segunda tentativa terminou por erro de ligação não tratado no processo de teste, sem relatório final. O harness estava a ser alterado em paralelo, pelo que os resultados das execuções não devem ser tratados como uma comparação de código congelado. As provas usam marcadores e evidência de autorização sintéticos; não cobrem todos os escritores, F5, paginação HTTP nem perda de ligação Central com um protocolo produtivo. O primeiro wrapper comunicou remoção do seu contentor; não se atribui automaticamente qualquer outro contentor visível a esta execução.

Foi acrescentado o teste `backend/test/organizationMatchingLargeOrdering.test.js`: a ordenação do motor existente é determinística em 1100 oportunidades sintéticas, com origens e entrada invertida. Com a suite de matching, 18 testes passaram. Isso não demonstra captura consistente nem paginação. O protótipo independente `test/integration/matching-pagination/rank-proof.test.cjs` passou 4 testes, incluindo uma demonstração de que percorrer fontes mutáveis sem snapshot pode produzir uma ordem obsoleta.

Para fechar: fixar uma versão do harness; validar perda de ligação e timeout sem permitir publicação; demonstrar proteção até ao commit com F5 e os escritores reais; especificar e validar cobertura transacional dos marcadores; só depois ligar cursores e paginação com >1000 registos e permissões por página. Preservar as bases habituais e deixar o R2 real para o final.
