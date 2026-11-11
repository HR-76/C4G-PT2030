# Consulta de candidaturas — comparação isolada de 09/11/2026

A consulta completa apresentou ganho consistente com 10 000 candidaturas sintéticas, mantendo resultados, contagens e fingerprints iguais. O runner terminou COMPLETE, código 0, com integridade das fontes e remoção do contentor próprio. A consulta final de contentores com label `c4g.browse-full` devolveu zero resultados.

## Alteração validada

- A listagem pede apenas o prazo factual final do snapshot congelado, sem compilar abertura, próximo prazo ou estado temporal atual. A deduplicação, ordenação dos intervalos e recusa de múltiplos candidatos finais mantêm as regras originais.
- `SET LOCAL jit = off` evita a compilação JIT nesta transação protegida. Esta alteração foi introduzida pela auditoria paralela e incluída explicitamente na confirmação; não é uma alteração global de PostgreSQL.
- Mantêm-se fingerprint de todo o conjunto filtrado, paginação/ordenação, filtros de organização/equipa/recurso, limites, parâmetros, guardas, auditoria e protocolo de autoridade. Sem migrações, índices novos, grants, caches ou alteração de timeouts produtivos.

Não foi implementada a hipótese posterior de substituir a comparação de intervalos por um máximo: a confirmação da mitigação JIT já demonstrou um ganho claro, sem exigir essa mudança adicional de algoritmo.

## Medições

PostgreSQL 18.6 descartável. Instalador e migrações da fixture real do projeto, Central 035, duas bases tenant, role funcional e RLS. Identidade e autoridade de entrada sintéticas. Fixture mista com origens privadas, centrais históricas v1 e canónicas v2, histórico e participantes. Nenhuma ligação às bases habituais ou fornecedores externos.

A: SQL original com JIT ligado. B: SQL atual com JIT desligado localmente, como no runtime. A/B/B/A repetido duas vezes por cenário: quatro amostras por variante, 144 medições no total. Tempos são execução SQL, incluindo compilação JIT; não incluem HTTP/OIDC, preparação de autoridade nem ida/volta do SET LOCAL. Todos os planos, amostras e intervalos estão em [results.json](results.json); resumo em [summary.json](summary.json).

| Cenário com 10 000 registos | Antes, mediana | Depois, mediana | Redução aproximada |
| --- | ---: | ---: | ---: |
| Primeira página | 1339,28 ms | 573,18 ms | 57% |
| Página profunda | 1293,34 ms | 535,50 ms | 59% |
| Pesquisa | 957,34 ms | 191,57 ms | 80% |
| Estado / data de mudança | 1248,52 ms | 511,80 ms | 59% |
| Ordenação por prazo | 1211,44 ms | 514,15 ms | 58% |
| Sem unidade associada | 1255,60 ms | 519,86 ms | 59% |
| Equipa com dez candidaturas | 752,70 ms | 2,88 ms | >99% |
| Equipa sem candidaturas | 744,16 ms | 0,87 ms | >99% |
| Recursos integralmente recusados | 0,26 ms | 0,24 ms | Sem ganho material |

Com 1 000 registos os ganhos são pequenos e os intervalos sobrepõem-se: primeira página 56,65 → 52,73 ms. Houve pequenas regressões de mediana em equipa (2,01 → 2,08 ms) e filtro sem unidade (55,09 → 55,89 ms). Não declarar melhoria universal. Não extrapolar para capacidade/p95 de produção ou abertura da página no navegador. Trabalho paralelo na máquina é uma fonte de ruído; a comparação usa alternância dentro da mesma execução.

## Verificações

- Resultados completos e fingerprints A/B iguais em todos os nove cenários, nos dois volumes.
- RLS: parâmetro de outra organização e contexto de outra organização não devolvem linhas.
- Cursores assinados: páginas sem sobreposição; adulteração, alteração de filtros, utilizador, organização, permissões e dados fora da página são recusadas. Guarda recusada impede acesso SQL; equipa sem autorização devolve vazio.
- 28 comparações temporais entre cálculo original e novo em UTC/Lisboa: ausência, legado, duplicados, fases, períodos ambíguos, ano zero e fronteira DST. As oportunidades v2 do corpus também participaram nas comparações completas.
- [sources.json](sources.json) contém hashes dos três ficheiros produtivos, verificados no fim. As fontes medidas estão preservadas neste diretório.
- Não constitui nova prova de OIDC, revogação central concorrente, auditoria de commit ou latência HTTP. Esses mecanismos não foram alterados.

## Tentativas anteriores

O diagnóstico `browse-full-20261109` mediu o SQL original. A primeira comparação `browse-full-ab-20261109` terminou todas as medições/verificações, mas falhou a integridade final porque a auditoria paralela acrescentou o SET LOCAL durante o ensaio. A evidência foi preservada e não certifica o estado final. Esta confirmação incorporou explicitamente esse comando e terminou com fontes estáveis. Os contentores próprios foram removidos em ambas as execuções.

Os resultados das suites e build são registados separadamente em `validation.md`, com os logs e as limitações de ambiente. Não confundir o gate SQL com essas suites.
