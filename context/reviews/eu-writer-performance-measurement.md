# Medições M/H — custos dominantes da versão EU v2

31/10/2026 — **Review**. M e H concluídos na versão `eu-writer-trial-0ecb31dc7c705859`. O custo dominante observado é a leitura repetida de metadados de esquema e permissões: mediana de **81,6% do tempo HTTP do relatório e 83,0% do dashboard**, com um pedido de cada vez. A fila tenant observada ficou a zero. A prioridade de otimização é o trabalho executado nos checkpoints de segurança e esquema, preservando as suas garantias.

[Contrato](../features/eu-writer-performance-measurement.md) · [Descritor dos resultados](../references/performance/eu-writer-measurement.json) · [Protocolo desta campanha](eu-writer-performance-cf931b1c0f694aea93e9bdba37fafe9b/protocol.json) · [Resumo calculado](eu-writer-performance-cf931b1c0f694aea93e9bdba37fafe9b/summary.json).

## Execução e validade

M decorreu entre 16:46:36 e 16:51:09 UTC; H entre 16:51:25 e 17:04:03 UTC, sequencialmente. Foram usados apenas recursos descartáveis próprios e a cópia fixada de 1844 fontes, com os três overlays já documentados na [preparação](eu-writer-performance-executors.md). Nenhum código do produto, pool, timeout, esquema habitual ou serviço habitual foi alterado por esta medição.

- **M PASS:** 2400 chamadas medidas, 240 aquecimentos e 16 checkpoints funcionais; 12 blocos e seis pares alternados por revisão. Igualdade JSON/fingerprint, frescura, segurança, drift e recusa após lock passaram.
- **H PASS:** 108/108 pedidos medidos HTTP200, 21 aquecimentos, três fixtures independentes com 1000 candidaturas e 250 pessoas por tenant. Zero erros, timeouts, 503, falhas funcionais ou métricas incompletas.
- Antes de cada matriz H, a prontidão HTTP/OIDC foi repetida: 51 pedidos no conjunto das réplicas, com 24 sucessos e 27 recusas esperadas; isolamento, papéis limitados, RLS, writer inativo e drenagem confirmados.
- Análise offline **VALID**, sem inconsistências. Hashes dos relatórios e das cinco etapas, contagens e percentis foram conferidos independentemente. Integridade final das 1844 fontes e 38 versões de dependências PASS.
- Cinco processos filhos terminaram. Os dez contentores próprios foram removidos, com ausência confirmada por inventário Docker apenas em leitura. [Verificação final de cleanup](eu-writer-performance-cf931b1c0f694aea93e9bdba37fafe9b/cleanup/final.json).

Os [dados M](../../output/eu-writer-trial-6c172f4fcfaa4965a4d5a357ed12da8e/evidence/9174aa120073457fba0c28b51ec1a95e/report.json) e [dados H](../../output/eu-writer-trial-6c172f4fcfaa4965a4d5a357ed12da8e/evidence/287cf708112d4f139778986a3e771110/report.json) permanecem preservados. O analisador e nove CSV estão na pasta da campanha. Não se repetiram suites/build durante a carga; a validação local da versão está ligada à preparação anterior. W e C6 não foram executados.

## M — sete consultas versus consulta agregada

Valores em milissegundos; 600 amostras medidas por linha. Comparar variantes dentro da mesma revisão.

| Revisão | Variante | Comandos base + segurança por chamada | p50 | p95 | Máximo |
| --- | --- | ---: | ---: | ---: | ---: |
| 042 | M7 | 7 + 12 | 71,175 | 85,349 | 111,872 |
| 042 | M1 | 1 + 12 | 72,367 | 80,079 | 105,634 |
| 043 | M7 | 7 + 17 | 78,497 | 85,385 | 125,365 |
| 043 | M1 | 1 + 17 | 80,215 | 90,760 | 114,683 |

A agregação reduz seis comandos por chamada, mas não demonstrou melhoria consistente de latência neste ambiente. A mediana M1 é 1,67% superior em042 e 2,19% superior em043. M1 ganha a mediana em apenas dois dos seis pares042 e num dos seis pares043. A mediana das diferenças emparelhadas M1−M7 é +0,350ms em042 e +1,806ms em043.

O p95 agregado melhora em042, mas M1 ganha o p95 em apenas dois pares de cada revisão; a mediana das diferenças de p95 por par é positiva nas duas. Não há base para prometer um ganho HTTP pela simples redução 7→1, nem para extrapolar esta comparação local a outra rede/base.

Em M1/043, o trabalho observado pelo driver tem medianas de 43,658ms na consulta base e 33,550ms nas 17 consultas de segurança. O restante tempo mediano por chamada é 2,766ms. São estatísticas de componentes por chamada; não somar medianas para reconstruir a mediana total. [Pares e diferenças](eu-writer-performance-cf931b1c0f694aea93e9bdba37fafe9b/metadata-pairs.csv).

## H — latência da API

Três réplicas agregadas, aquecimentos excluídos. C1/C2/C4 designam um, dois ou quatro pedidos simultâneos. Os tempos incluem o cliente HTTP e parsing da resposta; não medem renderização React nem carregamento visual do ecrã.

| Cenário | Pedidos medidos | p50 (s) | p95 (s) | Máximo (s) |
| --- | ---: | ---: | ---: | ---: |
| Relatório C1 | 12 | 3,680 | 3,797 | 3,797 |
| Relatório C2 | 12 | 3,760 | 4,404 | 4,404 |
| Relatório C4 | 24 | 4,597 | 6,195 | 6,221 |
| Dashboard C1 | 12 | 8,912 | 9,129 | 9,129 |
| Dashboard C4 | 24 | 10,597 | 12,160 | 12,302 |
| Dashboard C4, dois tenants | 24 | 10,395 | 11,211 | 11,284 |

As réplicas individuais permanecem no [CSV de cenários](eu-writer-performance-cf931b1c0f694aea93e9bdba37fafe9b/http-scenarios.csv). O p95 nearest-rank por réplica, com apenas quatro/oito observações, coincide com o máximo; no agregado, n12 continua a usar o máximo e n24 usa o segundo maior. Esta amostragem caracteriza a baseline e não estabelece capacidade ou SLO de produção.

## Decomposição e prioridades

| Custo por pedido C1 | Relatório | Dashboard |
| --- | ---: | ---: |
| Comandos SQL observados, incluindo controlo transacional | 1195 | 2841 |
| Transações iniciadas | 52 | 113 |
| Chamadas a `assertCentralSchema` | 25 | 53 |
| Observações de metadados tenant | 3 | 9 |
| União temporal SQL antes da resposta, p50 | 3,379s | 8,218s |
| União SQL de metadados Central, p50 | 2,308s | 5,322s |
| União SQL de metadados tenant, p50 | 0,685s | 2,062s |
| Mediana da fração SQL/HTTP, calculada em cada pedido | 91,8% | 92,2% |
| Mediana da fração metadados/HTTP, calculada em cada pedido | 81,6% | 83,0% |

As categorias de metadados incluem consultas aos catálogos PostgreSQL e verificações de permissões. Os intervalos SQL incluem execução, transporte e espera observados pelo driver; não representam CPU PostgreSQL. As linhas de tempo e os spans são inclusivos e sobrepostos: não somar Central/tenant, spans de segurança, hold de ligações e latência HTTP como parcelas independentes.

Dois templates SQL concentram muito do trabalho: `centralSchemaSnapshot` em `centralSchemaManifest.js` e a consulta `SQL` usada por `authoritySecuritySnapshot` em `authoritySecurityManifest.js`. O primeiro ocorre 25 vezes por relatório e 53 por dashboard; o segundo ocorre 50/106 vezes. As 50/106 ocorrências SQL não são 50/106 chamadas ao span `assertAuthoritySecurity`, que tem 25/53: parte das ocorrências integra o próprio snapshot Central. A correspondência foi feita pelos hashes dos comandos da cópia fixada, sem recolher parâmetros ou dados pessoais.

A [atribuição conjunta por pedido](eu-writer-performance-cf931b1c0f694aea93e9bdba37fafe9b/derived-query-attribution.json) confirma que apenas estes dois templates cobrem uma mediana de54,0% do tempo do relatório e52,0% do dashboard em C1. A união conjunta tem p50 de1,971s e4,629s, respetivamente; foi calculada em cada pedido antes dos quantis, sem somar percentagens ou medianas separadas.

O dashboard faz nove observações tenant, com união mediana dos spans de 2,230s em C1, além do trabalho Central. Estas medições sustentam priorizar o custo e a repetição do trabalho dentro dos checkpoints. Não demonstram crescimento N+1 com o número de candidaturas: foi medido um volume fixo, não uma série de tamanhos.

Nos cenários concorrentes observou-se mais contenda, mas a fila tenant não foi o custo dominante observado. A aquisição completa pelo manager teve máximo de 27,582ms nos pedidos medidos; a maior soma de esperas de checkout por pedido foi 56,323ms. A fila observada ficou a zero nos eventos e no sampler, com até quatro leases ativas. O sampler de100ms pode não captar esperas breves.

Em C4, o custo observado de aquisição dos locks de autoridade aumenta: a mediana da soma por pedido passa de28,521 para315,002ms no relatório e de42,406 para464,308ms no dashboard. O máximo dessa soma no dashboard é640,319ms. Houve amostras PostgreSQL com até três sessões bloqueadas. Estes dados justificam medir a duração das secções protegidas, sem tratar o tempo de lock já incluído em SQL como uma parcela adicional a somar.

A preparação de auditoria também pesa nas caudas concorrentes: a união temporal por pedido da categoria `audit-prepare` tem p95 de1,499s no relatório C4 e1,641s no dashboard C4. É um alvo secundário de análise de contenda, já incluído nos intervalos SQL; não equivale a tempo exclusivo de CPU nem pode ser somado ao p95 HTTP.

Não houve consultas concluídas após a resposta nos 108 pedidos medidos. As drenagens entre cenários ficaram entre0,059 e0,269ms. A CPU observada do processo Node por fase foi aproximadamente36–65% de um núcleo; RSS atingiu436,99MiB e heap185,14MiB nas fases medidas. Estes valores incluem o observador e períodos de drenagem/cleanup que conservam a etiqueta da fase; não medem a CPU PostgreSQL nem a carga externa do host.

## Interpretação e próximo incremento

O alvo principal é reduzir o custo das consultas de esquema/ACL e o trabalho duplicado dentro da mesma fase de validação. Aumentar a concorrência admitida não é a prioridade sustentada por esta amostra: a demora já existe em C1 e não foi observada acumulação na fila tenant.

O candidato seguinte deve preservar os checkpoints frescos, membership/isolamento, as três leases do dashboard e as revalidações após lock. A semelhança de dois SQL não autoriza remover uma verificação pós-lock nem reutilizar indiscriminadamente resultados entre pedidos. Ensaiar uma alteração concreta em A/B com a mesma fixture e resultados equivalentes, medindo comandos, tempo SQL, CPU observada, contenda e latência final.

Limites: host não reservado em exclusivo, plano de energia Equilibrado, instrumentação presente em todas as réplicas, tráfego e identidades sintéticos e dependências verificadas por versão sem pin dos seus bytes. A versão medida exclui as otimizações paralelas posteriores do relatório/tenant; estes resultados não certificam essas alterações nem provam uma melhoria no ambiente habitual.

Revisão independente final aprovada, sem bloqueantes. Foram também conferidas as 44 referências por hash do descritor e os links locais deste relatório.

Próximo passo: preparar e medir em A/B uma otimização dos snapshots Central/segurança, mantendo todas as verificações de autoridade e a baseline agora medida.
