# GCNI — C1/C2 isolados
Estado: Review. Implementação autorizada explicitamente.

C1: transportar apenas a versão do servidor validada nesta invocação da admissão para a consulta de constraints. Sem cache de decisões, estado em req ou ligação, ou dados recebidos por HTTP. O leitor autónomo continua a consultar a versão.
C2: agrupar os guardas de admissão do leitor com metadados de projeção; manter o guarda inicial do repositório, os locks e todas as condições antes de ler dados protegidos. Não alterar hashes, grants, limites, checkpoints finais, renovação ou verifyLocked.

Aceitação: regressões antes da implementação; revogação e nova observação na mesma ligação; equivalência exata; suites completas/build; gate PostgreSQL próprio; OIDC e carga27/10000 tabela/ficha10 concorrentes,5 séries de10,40 aquecimentos/200 medições,zero erros,p95<=500ms. Baseline9dfce593bfaf409ca0bc087b78930460. Sem promoção/fontes. Autorrevisão e limpeza próprias.

Próximo passo: comparar a versão anterior com C1 e C2 separadamente numa carga alternada, para decidir quais manter; não avançar para novas consolidações sem benefício de desempenho demonstrado.

Resultado: funcional PASS; carga NOT_ACCEPTED. [Autorrevisão](../history/catalog-c1c2-2026-11-02.md).
