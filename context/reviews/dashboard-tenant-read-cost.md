# Dashboard — custo repetido das operações tenant

31/10/2026. [Contrato](../features/dashboard-tenant-read-cost.md). Agrupamento implementado e equivalência comprovada em PostgreSQL real. Menos consultas do coletor, mas sem melhoria material de latência demonstrada no ensaio local. Medição HTTP integral ainda pendente por indisponibilidade da aplicação habitual.

## Alteração e fronteiras

`backend/src/security/tenantSchemaFingerprint.js` agrupa apenas SELECTs adjacentes de segurança dentro de cada snapshot fresco. Mantém filtros, ordenação, propriedades condicionais, auditoria, autorização, três leases sequenciais e os checkpoints antes/depois da função privilegiada e da finalização. Não introduz cache, novos privilégios, migrations, paralelismo ou alterações dos limites.

O JSON conserva a ordem das propriedades. Dois campos precisam de conversão textual explícita para manter os tipos devolvidos anteriormente pelo driver: o `count(*)` int8 e o array PostgreSQL `name[]` das roles de políticas. O segundo foi detetado pela comparação real, corrigido com regressão RED→GREEN e revalidado sem alterar fingerprints registados.

O agrupamento membership/diretório não foi aplicado: a configuração local usa pools distintos, pelo que não sustentava a redução prevista de transações coordenadas. A junção das três leases também não integra este incremento, pois alteraria as fronteiras de commit/auditoria.

## Comparação real do coletor

Ligação limitada existente, transações `READ ONLY`, um aquecimento por variante e dez pares sequenciais AB/BA, sem setup de infraestrutura ou alterações de dados. Baseline congelada e candidato compilados dos bytes identificados por hash. Todas as 22 observações produziram o mesmo fingerprint; configuração e fonte permaneceram estáveis; rollback e fecho concluídos.

| Medida por snapshot | Antes | Depois |
| --- | ---: | ---: |
| Comandos SQL | 25 | 9 |
| Mediana | 65,54 ms | 65,62 ms |
| Média | 67,11 ms | 66,79 ms |
| Mínimo | 60,71 ms | 57,52 ms |
| Máximo | 78,68 ms | 83,68 ms |

Redução de 64% dos comandos desta função; mediana ligeiramente pior (+0,13%, calculado antes do arredondamento) e média praticamente igual (−0,48%). Seis dos dez pares foram mais rápidos. Não há evidência de melhoria material do tempo nem extrapolação destes milissegundos para o dashboard completo. Com os 18 snapshots do percurso existente, a projeção estrutural é 450→162 comandos desta função; essa contagem agregada não foi observada por HTTP neste incremento.

Evidência: `output/dashboard-tenant-cost/snapshot-compare-2026-10-31T16-40-48.973Z/results.json`. Baseline SHA256 `d0baa7265dbf86ada926fe783cf52d110f84dbdbbfe415c1df4ab07f89a972bf`; candidato `6876998c3d37a255333a90c0bad3eeff784797e3ec82a08242c2785bbbc748d5`.

As três tentativas anteriores, interrompidas na primeira divergência de fingerprint, permanecem arquivadas. A diferença era exclusivamente o campo `roles`: string no driver original e array no JSON. Não foram usadas nas estatísticas finais. O perfil inicial de cinco snapshots também está separado da comparação.

## Diagnóstico complementar

O perfil sanitizado `EXPLAIN ANALYZE`, com três observações por SELECT, localizou a maior parte do custo da consulta base na projeção de constraints: mediana15,916ms. A consulta base apresentou mediana direta33,183ms, parsing1,186ms e execução instrumentada29,656ms. Os ACL de metadata/import/document repetem scans de catálogos; os planos não identificam, por si só, uma alteração segura com ganho garantido. Tempos do driver e do EXPLAIN pertencem a execuções distintas e não devem ser somados/subtraídos como uma decomposição exata.

Um protótipo apenas em memória substituiu `to_jsonb(con)` por `row_to_json(con)`. Preservou o fingerprint, mas piorou a mediana59,71→61,65ms e a média61,24→65,64ms. Foi descartado; a fonte de produção conserva `to_jsonb`. Resultados em `explain-2026-10-31T16-42-26.014Z/` e `constraint-json-compare-2026-10-31T16-43-48.166Z/`, dentro da pasta de evidência.

## Validação e limites

- Regressões novas:19 PASS, incluindo SQL anterior, bytes/fingerprints, int8/name[], condições opcionais, vazios, erros, isolamento concorrente e 18 leituras frescas. RED original1 PASS/16 FAIL; RED da conversão name[]13 PASS/6 FAIL; logs preservados.
- Foco do coletor e observador anterior:54 PASS. Observador novo:5 PASS, incluindo proteção de fontes e restauro após instalação incompleta.
- Backend:2280 PASS,0 FAIL,7 SKIP; frontend:495 PASS; build PASS; sintaxe de oito ficheiros PASS. Evidência em `backend-suite.log`, `frontend-suite.log`, `frontend-build.log` e `final-hashes.json`.
- Revisão independente confirmou as estatísticas, a ordem AB/BA, os hashes e a distinção entre prova estrutural e tempo HTTP; sem problemas acionáveis na versão final. A medição real e a regressão específica corrigiram a lacuna inicial de tipos nos doubles.
- Harness HTTP preparado em `test/integration/dashboard-tenant-cost/measure-native.cjs --compare`: exige três leases emitidas,18 snapshots, histogramas de comandos/grupos, paridade das respostas/fingerprints, transações centrais iguais, fontes/configuração/ledger estáveis e cleanup.

As portas3000 e5000 estavam indisponíveis na última conferência guardada em `http-readiness-final.json` (16:46:10 UTC); bridge, PostgreSQL e identidade estavam acessíveis. A janela043 estava documentada como trabalho paralelo ativo. Não se iniciou/reiniciou a aplicação habitual nem se geriram serviços de outro trabalho. O microbenchmark não substitui login OIDC, medição HTTP, carga concorrente ou SLO de produção. Sem commit, push ou deploy.

Próximo passo: executar o A/B HTTP preparado quando o ambiente habitual estiver disponível e estável; usar o perfil de constraints/ACL para orientar qualquer otimização posterior.
