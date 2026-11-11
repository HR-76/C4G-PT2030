# GCNI — custo de execução das verificações PostgreSQL
Estado: Review. Pedido de continuidade explícito. Só ambiente isolado; sem promoção ou reativação de fontes.

## Plano e aceitação
1. Medir a reutilização de planos SQL, sem reutilizar resultados, fingerprints observados ou decisões de acesso. Cada checkpoint executa novamente todas as consultas.
2. Comparar objetos serializados e fingerprints com o percurso atual. Confirmar alterações de esquema e permissões na mesma ligação, incluindo depois de o plano estar preparado.
3. Não alterar referências, migrações, grants, membership, bloqueios, expiração, limites de pools ou contrato HTTP. Comportamento habitual por omissão preservado.
4. Regressão antes da implementação; suites completas, compilação, gate PostgreSQL próprio e autorrevisão.
5. Carga OIDC isolada idêntica: 27/10000, tabela/ficha,10 concorrentes,5 séries de10,40 aquecimentos e200 medições. Zero erros; p95<=500ms em todas as séries. Comparador fixo76406f9580dd4dbd8046364ec62fb98b.
6. Não aprovar capacidade sem evidência; registar variantes rejeitadas e limpeza dos recursos próprios.

Próximo passo: avaliar a consolidação das admissões dentro de cada pedido, identificando quais podem partilhar o mesmo checkpoint sem atravessar bloqueios ou reutilizar decisões entre pedidos, antes de implementar nova otimização.

## Decisão após medição
Planos preparados tiveram ganho variável e não foram ativados. A consulta com leitura direta de conenforced no PostgreSQL18 reduziu a mediana de execução SQL de26,873 para21,889ms em12 pares alternados A/B. Implementar só esta alteração: versão observada em cada checkpoint pelo preflight existente;17 mantém SQL anterior; versões não suportadas recusadas. Não alterar os objetos resultantes, as verificações ou os hashes. Carga completa decidirá a aceitação; esta medição não prova capacidade.

## Resultado
Funcional PASS; carga NOT_ACCEPTED. [Resultado e autorrevisão](../history/catalog-query-plans-2026-11-01.md).
