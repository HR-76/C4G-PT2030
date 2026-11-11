# Diagnóstico do fingerprint de candidaturas

Estado: executado com autorização em 09/11/2026; repetição `browse-fingerprint-20261109-r2` com cleanup automático aprovado. Resultados em `context/reviews/browse-fingerprint-20261109-r2/README.md`. Não altera o runtime nem demonstra ganhos de uma correção. Para repetir, usar um nome de relatório ainda inexistente.

Com autorização específica, na raiz GCNI_C4G:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/application-browse-fingerprint/measure.ps1 -Report browse-fingerprint-20261109
```

Cria um único PostgreSQL 18 descartável, sem rede, portas publicadas ou mounts. Exige a imagem `postgres:18-alpine` já instalada; não instala dependências nem descarrega imagens. Usa apenas tabelas/funções temporárias e dados sintéticos (1 000, 10 000 e 50 000 registos). Remove exclusivamente o contentor criado, após conferir nome e label UUID. Recusa sobrescrever relatórios e para em erro SQL, timeout de statement (30 s) ou falha de cleanup. A password temporária não é escrita no relatório.

Guarda planos EXPLAIN ANALYZE/BUFFERS, versão/imagem e hashes em `context/reviews/<Report>/`. Alterna fingerprint/controlo em A/B/B/A duas vezes por volume. O controlo mantém contagem e página mas devolve NULL no fingerprint: serve exclusivamente para estimar o custo incremental; NÃO satisfaz o contrato de cursores da aplicação.

A fixture simplifica a projeção e exclui joins, RLS, autoridade, histórico, dados reais e HTTP. Antes de otimizar o runtime, recolher planos do percurso completo em fixture isolada e provar equivalência de respostas/digests, revogação e invalidação dos cursores. Nenhum ganho de produção pode ser deduzido deste microbenchmark. Não mudar algoritmos, índices ou retirar campos do digest com base apenas neste ensaio.
