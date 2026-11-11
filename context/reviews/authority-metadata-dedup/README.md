# Deduplicação de metadados nos pontos de validação

Incremento em Review, autorizado em 26/10/2026 após a [investigação de contenção](../../research/authority-contention.md). Reduz recolhas repetidas na mesma admissão e no leitor. Não introduz cache entre chamadas, alterações de privilégios ou mudanças no protocolo de autoridade. A matriz standard terminou com 36/36 sucessos, contra 35/36 antes; o burst passou de 2/6 para 4/6 sucessos, mantendo duas respostas 503. A redução de trabalho está demonstrada; a latência concorrente não melhorou uniformemente. **A aceitação de carga continua FAIL; não há aprovação produtiva.**

## Causa e alteração

O preflight incluía a fotografia de segurança de autoridade no fingerprint integral do schema, voltava a recolhê-la para a comparação específica de segurança e repetia essa recolha depois de terminar o preflight. O coordenador fazia ainda a recolha necessária após adquirir o lock. A admissão passa de três recolhas para uma; a recolha posterior ao lock mantém-se. O leitor também recolhia o schema para identificar a versão e voltava a recolhê-lo para validar essa mesma versão.

| Ficheiro | Alteração |
|---|---|
| [authoritySecurityManifest.js](../../../backend/src/security/authoritySecurityManifest.js#L50) | Comparação pura da fotografia com a versão explícita; admissão reutiliza a evidência validada no preflight e continua a recusar versões sem contrato de autoridade |
| [centralSchemaManifest.js](../../../backend/src/security/centralSchemaManifest.js#L102) | Valida o fingerprint integral e o fingerprint de autoridade com a mesma fotografia local; helper para selecionar uma versão estritamente admitida com uma recolha |
| [catalogReaderSchema.js](../../../backend/src/security/catalogReaderSchema.js#L9) | Usa a recolha única mantendo a allowlist 029–032 e os erros específicos de segurança |
| [authorityMetadataDedup.test.js](../../../backend/test/authorityMetadataDedup.test.js) | Doze regressões de frescura, deriva, login, ausência de contrato e leitor |
| [Prova PostgreSQL](../../../test/integration/authority-metadata/README.md) | Equivalência com as fontes anteriores, deriva e corridas reais após o lock |

As queries, campos, ordenação, normalização e hashes dos manifests não foram alterados. A validação independente do catálogo continua a recolher os seus dados; estes não pertencem à fotografia de autoridade embutida no schema. O coordenador, a sua consulta após o lock, os epochs e as validações de início/fim não foram editados. A fotografia lógica continua composta por vários statements; não passou a ser um snapshot SQL atómico.

## Verificação funcional e de segurança

- [Testes focados](focused.log): 49 PASS, incluindo os 12 novos testes.
- [Suite backend](backend-suite.log): 1259 PASS, três falhas históricas e sete SKIP, de 1269 testes. As falhas são cancelamento ClamAV, fixture F12/F11 e correspondência histórica do catálogo SQL; coincidem com a [baseline anterior](../http-session-epochs/README.md). Não foram corrigidas neste incremento.
- [PostgreSQL 17.11](postgres-proof.json): 19 verificações PASS. Fotografias JSON e fingerprints exatamente iguais às fontes anteriores nas revisões 029, 030, 031 e 032. Três recolhas por admissão antes, uma depois; duas admissões seguintes continuam a fazer duas recolhas.
- Oito casos de drift recusados e restaurados na fixture: atributo de role, membership de role, ACL de tabela, coluna e schema, função, estrutura de tabela e ACL do catálogo validada separadamente.
- Duas corridas PostgreSQL reais: bloquear a transação no advisory lock, alterar ACL/role noutra ligação após o preflight e libertar o lock. Ambas terminaram em `AUTHORITY_SECURITY_DRIFT`, sem executar a callback funcional.
- [Revogação HTTP/OIDC](results-revocation.json): nove verificações PASS; roles/RLS reais, login PKCE e recusa de leitura concorrente após revogação central. A leitura ficou bloqueada na admissão tenant; a revogação fez commit antes da libertação e a resposta foi 503, seguida de recusa das leituras seguintes. Esta prova não cobre todas as fronteiras possíveis de revogação.

A revisão independente do diff não encontrou problemas bloqueantes. Confirmou que coordenador, preflight, manifest de migrations e validadores separados do catálogo estão byte a byte iguais à baseline. O gate histórico `authority-commit-gate.js` contém corridas de finalização e commit incerto, mas tem expectativas de revisões antigas; não foi executado nem reparado neste incremento. As validações de finalização foram preservadas e os testes unitários existentes foram executados, sem afirmar nova prova PostgreSQL de todas essas corridas.

O primeiro comando de testes focados encontrou `EPERM` nos subprocessos dentro do sandbox; a repetição autorizada com runner normal passou os mesmos testes, conservando apenas a falha histórica do catálogo SQL ([log](focused-existing-unrestricted.log)). Frontend/build não foram repetidos neste incremento exclusivamente backend; não houve mudança de contratos HTTP nem de fontes frontend.

## Medições e limites

Repetição do harness existente, sem alterações neste incremento, com 1000 candidaturas e 250 pessoas por tenant, os mesmos limites e contentores exclusivos. A comparação usa a [matriz anterior](../authority-contention/README.md). [Resultados standard](../authority-metadata-contention/results.json) e [resumo](../authority-metadata-contention/summary.json).

| Cenário | Sucessos antes → depois | p50 antes → depois (ms) | p95 antes → depois (ms) |
|---|---:|---:|---:|
| Report C1 | 4/4 → 4/4 | 5607 → 4287 | 6353 → 4417 |
| Report C2 | 4/4 → 4/4 | 5338 → 5852 | 7455 → 6709 |
| Report C4 | 7/8 → 8/8 | 9084 → 7839 | 10893 → 11090 |
| Dashboard C1 | 4/4 → 4/4 | 8403 → 6345 | 9128 → 7401 |
| Dashboard C4 | 8/8 → 8/8 | 15177 → 15622 | 15641 → 18376 |
| Dashboard C4, dois tenants | 8/8 → 8/8 | 13480 → 12091 | 16957 → 15228 |
| Dashboard C6, burst | 2/6 → 4/6 | 18103 → 16055 | 18832 → 17576 |

Por pedido, as recolhas SQL de segurança de autoridade passaram de **84 para 42 no report** e de **168 para 84 no dashboard**, menos 50%. As transações de autoridade mantiveram-se em 21/42. O total de queries passou de 1159 para 1117 no report e de 2703 para 2619 no dashboard. Não se confundem estas duas reduções: a redução de 50% é das recolhas de segurança, não de todo o SQL.

Em report C1, o tempo acumulado de metadata desceu de 4574 para 3099 ms/pedido. Sob C4, o dashboard manteve cinco slots ocupados e até três em fila. A metadata central desceu de 6665 para 5739 ms/pedido, mas aumentaram os tempos de metadata tenant (2948 → 3703), preparação de auditoria (4235 → 4365) e chamada ao lock central (1622 → 2260). Esta execução não demonstra uma melhoria geral da latência concorrente nem permite atribuir causalidade à diferença do p95.

Os quantis incluem apenas respostas 200: no report C4, o quantil anterior excluía uma falha; o atual inclui oito sucessos. São quatro/oito amostras e uma execução por cenário, em ordem fixa. O standard anterior foi recolhido antes da adição da telemetria explícita de admissão ao harness, já usada no burst anterior e nestas repetições. A comparação estrutural de queries é exata; a diferença de overhead e as condições locais limitam inferências sobre a latência.

No [burst C6](../authority-metadata-capacity/results.json), houve 16 admissões: 12 concedidas e quatro expiradas aos 4999,71–5005,36 ms, duas por cada HTTP falhado. As duas respostas públicas foram `503 SERVICE_UNAVAILABLE`; os quatro erros internos foram `POOL_EXHAUSTED`. Não houve `LEASE_TIMEOUT` nesta repetição. Mantiveram-se cinco ativos e até sete em fila; os 12 checkouts físicos tenant tiveram máximo de 64,21 ms e zero erros. A saturação continua na admissão. Os quantis do burst comparam apenas dois sucessos anteriores com quatro atuais.

Não foram observadas conclusões de queries após resposta nesta matriz/burst. O cancelamento dos ramos do dashboard não foi alterado; este resultado não prova resolução do problema observado anteriormente. [Resumo do burst](../authority-metadata-capacity/summary.json) e [comparação calculada](comparison.json).

Os ensaios usam dados sintéticos locais, uma distribuição simples e instrumentação observacional. O segundo tenant começa frio no cenário misto. As durações de queries incluem rede/fila no client e podem sobrepor-se. O leitor central não coordenado da fixture usa `pg_read_all_data`; não existe paridade integral com privilégios produtivos nem demonstração de SLO/capacidade produtiva. A deduplicação não altera a serialização da auditoria, o fan-out do dashboard ou o deadline do preflight.

## Preservação

Baseline: HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, branch `feat/f13-organizational-profile`, 2158 entradas de estado e 2608 ficheiros inventariados com hash. O worktree já estava alterado. [Baseline](baseline.json) e fontes anteriores preservadas nesta pasta. Nenhuma migration, grant, permissão, configuração de deploy ou dado Dev foi alterado; DDL e grants de teste executaram exclusivamente nas fixtures descartáveis.

[Comparação final de preservação](preservation.json), [verificação consolidada](verification.json) e [hashes finais](source-hashes.json). Os contentores com as labels exclusivas das duas provas foram removidos. A comparação cobre os ficheiros inventariados; não afirma imutabilidade integral de ficheiros ignorados ou do ambiente.

Próximo passo: reduzir a retenção do lock de auditoria e a pressão de admissão do dashboard num incremento próprio, preservando autoridade e durabilidade, e repetir a mesma matriz. Não aumentar limites para converter estes timeouts em sucessos aparentes.
