# Metadados — correção e comparação isolada

06/11/2026. Incremento implementado localmente; sem deploy ou alterações às bases habituais.

## Alteração

As validações de autoridade e a componente de autoridade do snapshot central passam a usar o transporte compacto já existente. As definições de funções deixam de ser transmitidas repetidamente por destinatário de ACL; o coletor reconstrói o mesmo JSON antes de calcular o fingerprint. Não há cache entre pedidos/checkpoints, nem alterações a locks, autorização, grants, migrações, pools ou timeouts. O coletor raw mantém-se como referência.

A experiência de materializar definições com CTE foi descartada: mediana A 11,125 ms / B 11,235 ms, sem ganho consistente. Apenas a ativação do transporte compacto foi conservada.

## Comparação

A = fontes anteriores congeladas e verificadas por SHA-256, carregadas apenas pelo preload do harness. B = código corrigido. Quatro execuções sequenciais A/B/B/A, 36 pedidos medidos e seis warmups por execução, PostgreSQL 17 e Keycloak descartáveis, dados sintéticos (1000 candidaturas e 250 pessoas por tenant). Mesmas imagens Docker e fontes controladas em todas as execuções; todos os `integrity.json` indicam ausência de alterações. Sem suites/build concorrentes. 144/144 pedidos medidos bem-sucedidos.

Quantis por nearest rank, agrupando as amostras individuais das duas execuções de cada variante; warmups excluídos. Tempos em ms:

| Cenário | N por variante | A p50 | B p50 | A p95 | B p95 |
|---|---:|---:|---:|---:|---:|
| Relatório C1 | 8 | 2094,70 | 2053,94 | 2236,15 | 2136,89 |
| Relatório C2 | 8 | 2224,15 | 2269,24 | 2558,63 | 2563,73 |
| Relatório C4 | 16 | 2640,87 | 2653,40 | 3791,99 | 3780,64 |
| Dashboard C1 | 8 | 4756,28 | 4717,88 | 5086,52 | 4798,24 |
| Dashboard C4 | 16 | 5884,95 | 5959,55 | 7313,00 | 7053,38 |
| Dashboard dois tenants C4 | 16 | 5997,73 | 6045,68 | 6421,03 | 6453,61 |

Microbenchmark alternado, 60 amostras por variante após warmup, sob role runtime:

| Ambiente | A p50 | B p50 | A p95 | B p95 |
|---|---:|---:|---:|---:|
| PostgreSQL 17 / esquema 035 | 11,060 | 9,943 | 12,408 | 10,723 |
| PostgreSQL 18 / esquema 050 | 11,710 | 10,659 | 13,030 | 12,472 |

Ganho consistente na consulta: cerca de 10,1%/9,0% na mediana e 13,6%/4,3% no p95, respetivamente. HTTP apresenta resultados mistos: não demonstra aceleração generalizada nem significância estatística. O dashboard continua perto de sete segundos no p95 concorrente. Estes são tempos HTTP de fixture, não tempos de abertura/renderização no browser nem SLO de produção. O HTTP usa esquema 035; a equivalência e deriva foram adicionalmente provadas no esquema atual 050 em PostgreSQL 18.

## Segurança e testes

- Regressões de ativação do compacto falham contra A e passam contra B; transporte malformado é recusado sem fallback permissivo.
- Nove verificações em cada uma das duas versões PostgreSQL: equivalência byte a byte raw/compact e fingerprint registado; ACL PUBLIC de função/coluna, flags de role, função estrangeira e terceiro, definição de função, ACL de schema, ACL vazia e deriva fresca após lock na mesma ligação.
- Gate HTTP/OIDC de revogação aprovado: revogação concorrente impede leitura obsoleta; membership revogada recusa leituras seguintes. O erro SERVICE_UNAVAILABLE durante a corrida é a recusa esperada, não uma falha do gate.
- Fixture real verifica RLS, isolamento físico entre tenants e ausência de privilégios indevidos nos logins da API.
- Backend: 2705 PASS / 7 SKIP / 0 FAIL; frontend: 811 PASS; build e sintaxe PASS.
- Contentores dos ensaios removidos; consulta final dos labels próprios sem recursos restantes.

## Evidência e reprodução

- [Dados agregados](comparison.json).
- Resultados individuais: [A1](../metadata-remediation-a1-final-20261106/results.json), [B1](../metadata-remediation-b1-final-20261106/results.json), [B2](../metadata-remediation-b2-final-20261106/results.json), [A2](../metadata-remediation-a2-final-20261106/results.json). Cada pasta inclui manifestos de fontes, imagens e integridade.
- [Prova PostgreSQL 17](../metadata-remediation-final-proof-20261106/results.json), [prova PostgreSQL 18/esquema 050](../metadata-remediation-pg18-current-20261106/results.json), [revogação](../metadata-remediation-revocation-20261106/results-revocation.json).
- Harness: `test/integration/metadata-remediation/run.ps1 -Variant A|B -Report <pasta-nova>`; prova: `test/integration/metadata-remediation/proof.ps1`; esquema atual: `test/integration/metadata-remediation-current/proof.ps1`. Executar apenas no âmbito isolado autorizado. O runner A/B recusa sobrescrever relatórios existentes; as provas usam destinos fixos.
- Tentativas exploratórias preservadas: CTE sem ganho, planos e comparação de transportes. Uma tentativa inicial A1 falhou no quoting do preload antes da série medida; uma prova inicial falhou por chamar um helper não exportado. Corrigidos apenas os harnesses e repetidos integralmente; não integram os 144 pedidos.

## Pendências prioritárias

PERF-01 permanece parcialmente aberto: reduzir o custo das restantes verificações centrais/tenant mediante equivalência e revogação comprovadas, sem remover checkpoints. PERF-02/03 continuam abertos: consultas/projeções do catálogo e completude/paginação do matching requerem medições e regressões próprias. Não alterar estes contratos neste incremento.
