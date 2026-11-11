# Executores EU v2 e prontidão HTTP

31/10/2026 — **Review**. Pedido concluído no âmbito do [contrato](../features/eu-writer-performance-executors.md): executores M/H adaptados, versão derivada com tenant034 preparada e funcionamento HTTP/OIDC comprovado antes da carga. A carga de desempenho ainda não foi executada.

## Versão fixada

Versão final: **`eu-writer-trial-0ecb31dc7c705859`**, com 1844 fontes. [Descritor de fecho](../references/performance/eu-writer-trial.json), [manifesto imutável](../../output/eu-writer-trial-6c172f4fcfaa4965a4d5a357ed12da8e/trial.json) e [arquivo das fontes](../../output/eu-writer-trial-6c172f4fcfaa4965a4d5a357ed12da8e/sources.zip).

A derivação parte dos 1807 ficheiros da baseline `eu-writer-v2-d2898861a25b4f6e`, acrescenta os 16 inputs públicos suplementares já identificados e 21 ficheiros deste incremento. Substitui apenas três fontes existentes, com hashes antes/depois no manifesto:

- Compatibilidade tenant034 em `backend/src/opportunities/httpComposition.js` e respetiva regressão `opportunityV2ConsumerAdmission.test.js`, provenientes da correção paralela do dashboard.
- Diretório de responsáveis em `backend/src/applications/composition.js`: obtém os IDs usados nas candidaturas através da ligação tenant sujeita a RLS e resolve os nomes pela interface fechada `responsibles.names`. Conserva responsáveis históricos/inativos, limites e verificações de autoridade. Não acrescenta permissões SQL.

Esta terceira correção foi necessária porque o SELECT Central direto do relatório não funciona com o papel limitado de runtime. Foi precedida por quatro regressões RED, depois GREEN. O template candidato preserva os restantes bytes da composição original. O agrupamento paralelo de leituras de autoridade do relatório presente no workspace **não faz parte desta versão de ensaio**; a sua evidência permanece separada.

SHA256 das fontes: `0ecb31dc7c70585959a97b38046e79c5aa0dec06b87763a557720ad3e8ce1d6c`. SHA256 do manifesto: `767625d37bece93c7877a577c527324ce514cec3081ed57451d1677b04be7afc`. ZIP/conteúdos/CRC, derivação e integridade antes/depois: PASS. Foram conferidas 38 versões de dependências reutilizadas através de três junctions explícitas; os bytes das dependências não estão arquivados nem individualmente fixados.

O manifesto mantém o estado original de captura `SOURCE_SNAPSHOT_ONLY`. A prontidão posterior pertence ao relatório externo ligado por hash; o manifesto não foi reescrito para acrescentar resultados.

## Prova funcional final

[Relatório integral](../../output/eu-writer-trial-6c172f4fcfaa4965a4d5a357ed12da8e/evidence/612a14e5e11c41c1a8d2fc38cda17c7c/report.json): **PASS**, com hashes dos dois relatórios de etapa conferidos independentemente.

| Etapa | Checks | Chamadas M funcionais | Casos de drift transacional | Recusas após lock | HTTP |
| --- | ---: | ---: | ---: | ---: | --- |
| Central043 / tenant034 | 26 PASS | 8 | 5 | 2 | 17 pedidos |
| Central042 / tenant034 | 6 PASS | 8 | 3 | 2 | Não executado nesta etapa |

Os 17 pedidos HTTP incluem oito respostas 200: relatório, oportunidade privada e dashboard em cada organização, mais a segunda página de ambos os relatórios. As nove recusas esperadas incluem dois cursores adulterados (400), quatro acessos cruzados entre organizações (404) e três pedidos anónimos (401).

O ensaio usou a composição Express real, HTTPS e login OIDC/PKCE no Keycloak isolado, cookies de sessão seguros e seleção de organização. Confirmou os resultados de negócio, papéis SQL limitados, membership/autoridade, RLS, paginação assinada e drenagem final com zero operações ativas ou em fila. Cada tenant recebeu 1000 candidaturas e 250 pessoas. O seed lógico, as imagens locais por ID imutável e os esquemas ficaram ligados à evidência. Identificadores e datas operacionais de instalação, subjects OIDC e credenciais são efémeros e separados do seed de negócio; não são apresentados como dados determinísticos.

M7/M1 produziram JSON e fingerprints iguais, com leituras de segurança e frescura preservadas. As alterações transacionais foram revertidas e os objetos revalidados. As quatro verificações após lock provocaram bloqueio real de transações e recusaram a operação protegida antes de executar o callback funcional.

Foram usadas instalações próprias e separadas para 043 e 042, com portas loopback. O writer ficou QUIESCED, sem pedidos pendentes e com runtime desativado. Os quatro contentores identificados por nome, label e ID foram removidos; ambos os processos filhos terminaram e a integridade final das fontes passou. Nenhuma base ou serviço habitual foi usado por este incremento.

## Executores preparados

O [protocolo original](../references/performance/eu-writer-v2-protocol.md) permanece preservado. O [README fixado nesta versão](../../output/eu-writer-trial-6c172f4fcfaa4965a4d5a357ed12da8e/sources/test/integration/eu-writer-performance/README.md) descreve instalação, pré-condições e modos explícitos.

- **M:** 042 e 043 separados; seis pares alternados M7/M1, dez aquecimentos e cem chamadas medidas por bloco, totalizando 600 amostras por variante/revisão. Aquisição de ligação separada e orçamento por bloco de 300 segundos.
- **H:** três fixtures independentes, cenários report C1/C2/C4 e dashboard C1/C4/dois tenants; 108 tentativas medidas e 21 aquecimentos. Erros, timeouts e 503 permanecem na evidência; quantis nearest-rank identificam a população de sucessos e a distribuição de todas as tentativas separadamente.
- Ambos exigem a prova funcional PASS para os mesmos hashes, seed e imagens. Métricas incompletas, divergência funcional, falta de drenagem ou cleanup impedem PASS. W opcional e C6 futuro continuam desativados.

A revisão corrigiu o controlo do orçamento H: os 180 segundos são verificados também após guardar cada resposta e após a conclusão dos workers. Quatro respostas de 50 segundos deixam quatro tentativas no relatório e reprovam aos 200 segundos; o limite exato de 180 segundos permanece elegível. Duas regressões RED→GREEN cobrem estes casos. A drenagem conserva o seu orçamento separado.

Comandos preparados para a medição posterior, a partir da raiz do repositório; **não foram executados neste incremento**:

```powershell
$trial = (Resolve-Path 'output/eu-writer-trial-6c172f4fcfaa4965a4d5a357ed12da8e').Path
$runner = Join-Path $trial 'sources/test/integration/eu-writer-performance/run.cjs'
$manifest = Join-Path $trial 'trial.json'
$proof = Join-Path $trial 'evidence/612a14e5e11c41c1a8d2fc38cda17c7c/report.json'
$certs = (Resolve-Path '.tmp/f2-integration').Path
node $runner --isolated --measure-metadata --manifest $manifest --tls-dir $certs --readiness-report $proof
node $runner --isolated --measure-http --manifest $manifest --tls-dir $certs --readiness-report $proof
```

## Validação e histórico preservado

Todas as validações seguintes foram executadas nas fontes da versão final, com [logs e verificação de integridade](../../output/eu-writer-trial-6c172f4fcfaa4965a4d5a357ed12da8e/evidence/local-validation/):

| Validação | Resultado |
| --- | --- |
| Testes focados dos executores, derivação, responsáveis e tenant034 | 68 PASS / 0 FAIL |
| Suite backend | 2217 PASS / 0 FAIL / 7 SKIP |
| Suite frontend | 494 PASS em 63 ficheiros |
| Build frontend | PASS |
| Sintaxe JavaScript | 21 ficheiros PASS |
| Integridade final e 38 versões de dependências | PASS |

Os sete testes backend ignorados são testes SQL com opt-in externo, identificados no log. A prova isolada executada aqui é evidência separada e não equivale a executar todos esses testes. Revisão independente da derivação, prova e executores concluída sem bloqueantes conhecidos após a correção do orçamento H.

As tentativas anteriores foram conservadas, sem alterar as suas fontes ou converter falhas em sucesso:

- Bundle `61bf8fb839f343caa5d9e23214cbff17`: rejeitado antes de criar infraestrutura porque incorporava também o agrupamento paralelo do relatório.
- Bundle `21ebf00bf185454bbcbf24a29253d99d`: falha da fixture ao tentar uma transição direta ACTIVE→QUIESCED; corrigida para a sequência de estados autorizada, com novo bundle.
- Bundle `4be8ed5cb7f346a59b504132794c5af9`: falha da expectativa de teste do dashboard; a API devolve corretamente o ID com prefixo de tipo, agora verificado pelo harness.
- Bundle `01eb5e7aed8945518100432d9ac2e756`: prova funcional PASS; substituído como candidato final pela correção do orçamento H. A sua prova não foi transferida: a nova versão repetiu integralmente a prova funcional.

Os tempos observacionais desta prova não demonstram melhoria de desempenho, throughput, capacidade ou SLO. As suites locais decorreram parcialmente em paralelo com a prova funcional; não constituem condições de benchmark. O próximo ensaio de carga deve usar a versão e as condições fixadas pelo protocolo. A prova histórica do writer conserva a sua identidade original e não certifica automaticamente os três overlays ou os executores acrescentados. Não houve commit, deploy ou ativação habitual neste incremento.

Próximo passo: executar as matrizes M/H com esta versão e analisar as amostras, recusas, drenagem e custos de metadados antes de escolher uma otimização.
