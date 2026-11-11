# Matching — plano de paginação consistente

Estado: proposta técnica em preparação, 09/11/2026. Não implementada; PERF-03 permanece aberto.

## Fronteira atual
`organizationDirectory/matching.js` reúne páginas dos leitores Central e tenant, limita cada fonte a 1000 itens, classifica globalmente e revalida a autoridade; no modo por pessoa também revalida estado e áreas. Cada leitor tem a sua própria operação protegida: a revalidação atual não demonstra um snapshot comum entre bases nem uma versão estável de todos os dados entre pedidos. O contrato HTTP aceita apenas personId, opportunityId e origin e devolve o conjunto completo.

## Direção candidata
Criar uma operação de cálculo limitada que materializa um resultado ordenado, com expiração, numa camada partilhada e protegida por organização e ator. Publicar o resultado apenas após comprovar uma fronteira consistente para todas as fontes e revalidar autoridade. Cada página deve voltar a autorizar a leitura e validar contexto, filtros, versão de algoritmo e validade. Uma continuação autenticada referencia apenas o resultado e a posição, não concede acesso por si própria. Ausência de versão ou mudança relevante invalida o resultado e exige novo cálculo; nenhuma página parcial é apresentada como resultado completo.

## Pré-requisitos antes de escolher ou implementar
1. Inventariar todas as escritas que podem afetar classificação, visibilidade, estado temporal, perfil e pessoas em Central e tenant, incluindo importações e vias administrativas; provar participação num protocolo comum ou identificar alternativa equivalente.
2. Definir onde reside a fronteira de consistência, como atravessa as duas bases e como lida com falhas, revogações, escritas concorrentes e relógio temporal. Snapshots independentes ou fingerprints pós-leitura, isoladamente, não demonstram estado comum.
3. Escolher armazenamento partilhado, isolamento por tenant, TTL, quotas, limites de tempo/memória, limpeza, recuperação e garantias de auditoria; avaliar se a arquitetura aprovada suporta a escolha sem introduzir autoridade nova.
4. Fechar contrato HTTP, tokens, ordenação global e tratamento de expiração/mudança; preservar compatibilidade ou versionar explicitamente. Detalhar mudança de UI apenas depois do contrato.
5. Criar testes de referência >1000 elementos em ambas as origens, empates, páginas vazias, alterações antes e depois da primeira página, expiração, adulteração, revogação e isolamento; verificar equivalência da concatenação ao resultado global. Executar prova HTTP/OIDC e PostgreSQL em ambiente descartável com ambas as bases.

## Alternativa investigada e limite
Novo varrimento por página com seleção limitada e fingerprint tem prova sintética em `test/integration/matching-pagination/rank-proof.cjs`. Não garante por si só uma leitura coerente entre Central e tenant, nem custos aceitáveis ou validade face a alterações concorrentes. Não ligar essa prova ao runtime sem resolver esses pontos.

## Próximo trabalho
Inventariar, com evidência de código e operações de escrita, os intervenientes da fronteira e a viabilidade de um marcador de versão partilhado; comparar essa opção com materialização coordenada antes de fixar o contrato. Nenhuma alteração de schema, runtime, dados ou limite foi efetuada neste passo.

## Inventário inicial de escritas — 09/11/2026

Ver [inventário e avaliação de versão](matching-inventario-versao.md): identificadas vias de pessoas/perfis, oportunidades privadas, publicação central, metadados de fonte e autoridade, além da dependência do tempo. Um vetor de versões locais transacionais é candidato plausível, ainda sem prova de cobertura e consistência. A listagem central calcula `asOf` por chamada, que o Matching não propaga atualmente. Mantêm-se pendentes o inventário de funções SQL/operadores e a prova de todas as vias de escrita. Nenhuma alteração no runtime.

Prova adicional: [vetor de versões sintético](../reviews/matching-version-vector-20261109/results.json) PASS em duas bases descartáveis, com commits concorrentes e rollback. Limites e inventário SQL adicional em [matching-inventario-versao.md](matching-inventario-versao.md); o protocolo produtivo continua por provar.
