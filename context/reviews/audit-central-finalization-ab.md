# Recolha em lote de metadados tenant após auditoria: A/B

Estado: medição sintética isolada em 01/11/2026. A primeira H deste incremento permanece FAIL. A segunda H é válida e passou o protocolo, mas **não validou redução consistente do custo dominante nem da cauda**.

## Âmbito e proveniência

O [contrato](../features/audit-central-finalization-performance.md) fixa a auditoria síncrona, a cadeia e idempotência, a membership Central como autoridade, as verificações após lock, os checkpoints frescos e os limites 10/15 s. O [diagnóstico C4](../../output/c4-blocker-diagnostic/9d3a63204f9744929730c1adea5a0361.json) correlacionou PIDs no B da H anterior: 59 observações de espera em `audit.prepare_append_v1`, com bloqueadores em outras transações tenant auditadas. Observações amostradas não são uma contagem de transações independentes.

O [pacote imutável](../../output/tenant-snapshot-ab-8e6f1ae3964141ff982fb91116efcfbf/ab.json) usa A igual ao B anterior e B com recolha em lote dos catálogos de segurança tenant. A única alteração de runtime entre os braços é `tenantSchemaFingerprint.js`; a projeção da autoridade e o JSON/fingerprint de segurança continuam iguais. Há 25 SQL em A e nove em B por snapshot. A versão Central043/tenant034, imagens, fixture e protocolo estão vinculados ao manifesto. A alteração no workspace já existia; esta comparação congela-a perante a versão anterior e não aplica mudanças à base habitual.

## Gates antes da carga

- Regressão de segurança tenant RED em A e GREEN em B; 74 testes focados backend em B passaram. A suíte backend na árvore de validação isolada passou com 2283 testes, 0 falhas e 7 ignorados. Os três overlays de testes Central são os mesmos usados na campanha anterior e não alteram o runtime.
- Frontend: 494 testes PASS e build PASS.
- [Prontidão](../../output/tenant-snapshot-ab-8e6f1ae3964141ff982fb91116efcfbf/evidence/9bdd38a2a5f4417fbe3ecd8f37b4154d/report.json): equivalência043/042, prova PostgreSQL real após função e após lock, OIDC/HTTP e controlos de isolamento PASS; cleanup e integridade das fontes PASS.
- [M](../../output/tenant-snapshot-ab-8e6f1ae3964141ff982fb91116efcfbf/evidence/3314c3d2d6dd4595ad9a868ecea93613/report.json): 2400/2400 medições válidas, 12/12 pares com p50 mais baixo. Tenant0 p50 92,883→88,788 ms (−4,41%); tenant1 94,526→90,120 ms (−4,66%). Estes números medem o snapshot isolado, não a latência HTTP H.

## H

A [primeira H](../../output/tenant-snapshot-ab-8e6f1ae3964141ff982fb91116efcfbf/evidence/74d8215da6824e1eb2915aa92bafda4d/report.json) começou antes da meia-noite UTC e terminou FAIL no braço 5B. Houve 216/216 respostas HTTP200 nos seis braços tentados, mas dois pedidos `report-c2` depois de 00:00 divergiram do digest do warmup anterior a 00:00. Todos os recursos da execução foram removidos; a proveniência passou. O relatório guarda os digests e os tempos, sem o corpo normalizado, de modo que a passagem de data explica fortemente a divergência mas a diferença exata de campo não ficou provada. H ficou incompleta e **não valida redução**.

A [segunda H](../../output/tenant-snapshot-ab-8e6f1ae3964141ff982fb91116efcfbf/evidence/ef5da2e2f55a442fa98ea627a873e1e9/report.json), iniciada após 00:00 UTC com os mesmos bytes, fechou os oito braços AB/BA/AB/BA em PASS. A [análise offline](../../test/integration/audit-finalization-ab/summary.json) deu `VALID`, zero problemas de validação e protocolo PASS: 288/288 HTTP200, 56/56 warmups, 136 controlos, 0 HTTP503/timeout/falha funcional, contagens de checkpoints invariantes, integridade das fontes e cleanup PASS. O primeiro FAIL continua arquivado separadamente.

| Cenário H, pares completos | p50 A→B | p95 A→B | p50 B vs A | p95 B vs A |
| --- | ---: | ---: | ---: | ---: |
| report C1 | 3323,9→3304,2 ms | 3446,0→3693,9 ms | −0,59% | +7,19% |
| report C2 | 3539,7→3464,0 ms | 4025,9→4022,0 ms | −2,14% | −0,10% |
| report C4 | 4100,5→4101,3 ms | 5676,2→5765,3 ms | +0,02% | +1,57% |
| dashboard C1 | 7858,4→7744,1 ms | 8248,4→14963,1 ms | −1,45% | +81,41% |
| dashboard C4 | 9878,9→9708,2 ms | 11577,0→11463,3 ms | −1,73% | −0,98% |
| dashboard C4, dois tenants | 9793,0→9699,7 ms | 10869,4→10898,4 ms | −0,95% | +0,27% |

Os 320 `audit-prepare` de dashboard C4 por variante tiveram p95 de 52,2 ms em A e 80,0 ms em B; máximos de 1,418 e 1,637 s. Com dois tenants, p95 de 5,8 e 7,2 ms. A mediana da retenção observada do lock de autoridade em C4 foi 1231,5→1200,6 ms num tenant e 1217,7→1248,7 ms em dois. Estas distribuições misturam contenção e trabalho concorrente; não estabelecem redução causal da espera de auditoria. O p95 de dashboard C1 em B resulta de um pedido de 14,963 s, HTTP200 e instrumentação completa, com 7,541 s de metadados Central e 4,195 s tenant; preserva-se como cauda medida, sem o descartar como ruído.

**Decisão:** a recolha em lote reduz o custo isolado M e o número de SQL, preservando autoridade/auditoria, mas o seu ganho em H não é convincente e a cauda C1 piorou. A nova H é PASS como execução e contrato funcional; o objetivo de reduzir o bloqueio/custo dominante em H continua por cumprir. Não promover este candidato com alegação de melhoria de H. O próximo experimento deve atacar a duração da transação que detém a cabeça `DATA` e a repetição de metadados Central, mantendo auditoria síncrona, snapshots frescos e revalidação após lock; repetir diagnóstico/PIDs para qualquer nova alteração antes de atribuir causalidade.
