# Agrupamento de validações centrais adjacentes

Incremento separado em **Review**, autorizado e executado em 27/10/2026. Implementados três callbacks centrais curtos, mantendo todas as chamadas e o SQL existentes. `prepare` mantém transação e observações frescas separadas; auditoria, limites de admissão e finalização não foram alterados. Provas funcionais aprovadas, com menos queries/transações; C6 piora em latência e a feature global permanece aberta, sem aprovação produtiva.

## Causa e alteração

O dashboard executa três operações tenant sequenciais. Cada uma validava captura/contexto em duas transações centrais, e depois identidade/contexto em outras duas antes de `prepare`. Cada admissão acrescentava 33 chamadas de infraestrutura. A [investigação anterior](../../research/dashboard-c1-sequential-cost.md) mediu 42 transações centrais, 2619 queries e cerca de 74% do tempo servidor coberto por queries de metadados em C1.

| Ficheiro | Alteração |
|---|---|
| [applications/composition.js](../../../backend/src/applications/composition.js#L200) | Captura e resolução sequenciais dentro de um `withAuthority`; termina antes de resolver a lease |
| [opportunities/httpComposition.js](../../../backend/src/opportunities/httpComposition.js#L189) | Mesmo agrupamento, conservando o mapeamento de erros e a resolução/reconciliação posteriores |
| [authorityCoordinator.js](../../../backend/src/security/authorityCoordinator.js#L200) | Identidade e contexto num callback curto; termina antes do `prepare` independente |

O âmbito inclui todos os métodos dos dois facades e todos os consumidores de `bindAuthority.protect`, incluindo escritas e ações sensíveis. Não existe gating alternativo por READ. Não foram eliminadas chamadas de validação, modificadas queries/fingerprints ou introduzido cache. Captura/resolução fecha antes da lease; identidade/contexto do guard ocorre com a lease existente e fecha antes de prepare/trabalho funcional. Nenhuma autorização ou auditoria tenant foi incluída no novo callback.

O deadline transacional passa a ser comum ao par; pode ser mais restritivo que dois budgets independentes. Os limites configurados, expirações e deadline do guard permanecem iguais. A segunda validação continua a poder recusar expiração durante o callback. As medições confirmaram a projeção nesta fixture: **42→36 transações centrais (−14,29%)**, **2619→2421 queries (−7,56%)**, **198 chamadas de protocolo preservadas** e dez prepares/appends de auditoria por dashboard. Cada par mantém 14 chamadas F3 e passa de 80 para 47 queries totais na prova PostgreSQL; nenhuma validação foi eliminada.

## Testes e provas

- [Focados](focused.log): **120/120 PASS**, incluindo os 14 novos testes de [groupedAuthorityValidation](../../../backend/test/groupedAuthorityValidation.test.js). Coordinator, F3, registry, F5, catálogo e F4 reais com persistência/metadata controladas; não se falsifica branding. Cobrem READ, WRITE, ação sensível, sequência de queries preservada, prepare separado, revogação/membership/versões/epochs/expiração/grants/MFA entre grupo e prepare, budget comum com rollback, pedidos e tenants separados.
- [Suite backend](backend-suite.log): **1298 PASS, três falhas históricas e sete SKIP**, de 1308. Permanecem cancelamento ClamAV, fixture F12/F11 e correspondência histórica do catálogo SQL. Nenhuma foi alterada. A primeira tentativa focada foi impedida pelo sandbox ao criar subprocessos Node; [log](focused-sandbox-failure.log). A repetição com subprocessos permitidos passou.
- [PostgreSQL específico](postgres-short-groups.json): **11 PASS**. Login central limitado real, F3/registry/membership persistidos, 2→1 transações por par com igualdade exata da sequência F3, chamadas sucessivas com observações novas, prepare separado, revogação real de membership/sessão com avanço de epochs, drift ACL e expiração/budget. Os probes de prepare usam binding sintético e param antes de criar um guard; não constituem prova de commit tenant.
- [Drift/fingerprints](../grouped-authority-drift/postgres-proof.json): **19 PASS**, com equivalência exata 029–032, recusas de drift de role, membership de role, ACL de tabela/coluna/schema/função/estrutura e catálogo; inclui drift cometido durante espera real no advisory lock, recusado após o lock.
- [Durabilidade F4/F7](../grouped-authority-durability/postgres-proof.json): **10 PASS**. Persistência/cadeia, eventos críticos imediatos, rollback integral na segunda falha de append, observações negativas depois de espera real no lock de auditoria, guard expirado e commit incerto. Usa evidência F5 sintética e injeções documentadas; complementa, não substitui, a composição HTTP real.

A primeira prova específica classificava como F3 uma query de identidade de infraestrutura que também pertence ao catálogo fechado; por isso falhava a igualdade de sequências ao passar de duas transações para uma. A instrumentação nova observa o transporte `authority_api.execute` e guarda apenas hashes SQL estáticos reconhecidos. Todas as assertions foram preservadas. [Resultado inicial](postgres-short-groups-attempt1.json) e [log inicial](postgres-short-groups-attempt1.log) mantidos. Nenhuma alteração de runtime foi necessária para corrigir a prova.

Revisão independente dos três diffs e dos novos testes sem problema bloqueante nem assertions enfraquecidas. O POST real de candidaturas do gate HTTP passa pelos wrappers de applications e protect; ações sensíveis de oportunidades e os restantes consumidores do guard não têm todos uma mutação tenant real nesta matriz. A cobertura nova destes casos usa persistência e auditoria controladas. Endpoint/payload do frontend confirmados em `frontend/src/api/api.js:185`; cliente/rotas e frontend não foram alterados. Suites frontend/build não repetidos neste incremento exclusivamente backend.

## HTTP/OIDC e carga

Gate integral concluído: [33 verificações e 108/108 pedidos PASS](../grouped-authority-http/results.json), incluindo OIDC/PKCE, CSRF, rotação/logout, RLS, recusas cruzadas, POST de candidaturas com commit/auditoria e revogação concorrente. As três entradas em `failures` são recusas esperadas dos probes negativos (`RESOURCE_NOT_AVAILABLE` duas vezes e `ORGANIZATION_MISMATCH`); não são falhas de carga. Browse/report/dashboard mantêm uma seleção de candidaturas por pedido, payloads e contagens constantes nos volumes 25/1000/10000: respetivamente 970/1051/2421 queries, contra 1036/1117/2619.

Profile [standard](../grouped-authority-standard/results.json): **36/36 PASS**, seis aquecimentos 200. [C6](../grouped-authority-capacity/results.json): **6/6 PASS**, um aquecimento 200. Sem erros de admissão, descartes de ligações ou consultas concluídas após a resposta. Mesmos limites, versões, dados e harnesses dos respetivos baselines; nenhuma sobreposição entre provas/cargas desta execução. [Comparação reproduzível](comparison.json), com hashes das fontes, quantis, contagens, aquecimentos e métricas detalhadas de contenção. Os quantis usam sucessos; os totais incluem todos os pedidos.

### HTTP integral, concorrência 4

Baseline: `http-audit-dashboard-gate`, 12 pedidos por célula, um aquecimento excluído por célula. Milissegundos; antes → depois. Cada célula mantém 12/12 sucessos, payload e uma seleção de candidaturas.

| Percurso | Volume | p50 | p95 |
|---|---:|---:|---:|
| Browse | 25 | 5214,70 → 4911,19 | 6865,97 → 6746,51 |
| Report | 25 | 5669,62 → 5540,75 | 7808,30 → 7397,52 |
| Dashboard | 25 | 13430,11 → 12411,05 | 14605,30 → 14190,49 |
| Browse | 1000 | 5322,92 → 4889,42 | 7330,73 → 6768,11 |
| Report | 1000 | 4186,11 → 5150,89 | 7471,35 → 6567,68 |
| Dashboard | 1000 | 13154,56 → 11810,63 | 15084,25 → 12830,58 |
| Browse | 10000 | 5051,65 → 4642,51 | 6918,65 → 6335,69 |
| Report | 10000 | 5517,81 → 5105,15 | 7095,53 → 6821,34 |
| Dashboard | 10000 | 12600,18 → 11868,53 | 14605,92 → 13746,18 |

### Standard e capacidade

Baseline standard: `dashboard-c1-stages`, com o mesmo observador de etapas. Baseline C6: `audit-dashboard-capacity`, com o mesmo profile de capacidade. Não misturar estas séries com o gate integral ou com séries sem o observador de etapas. Fixture com 1000 candidaturas/250 pessoas por tenant; segundo tenant inicialmente frio no standard. Milissegundos; antes → depois.

| Cenário | Pedidos | p50 | p95 |
|---|---:|---:|---:|
| Report C1 | 4 | 4208,20 → 3104,08 | 4464,52 → 3878,68 |
| Report C2 | 4 | 4342,31 → 2500,09 | 4703,77 → 2808,39 |
| Report C4 | 8 | 5465,63 → 2872,99 | 7495,43 → 4036,00 |
| Dashboard C1 | 4 | 10143,13 → 7909,82 | 10223,32 → 9693,64 |
| Dashboard C4 | 8 | 13146,14 → 8296,82 | 14490,39 → 8807,79 |
| Dashboard dois tenants C4 | 8 | 13112,38 → 7230,48 | 13788,36 → 8248,62 |
| Dashboard C6 | 6 | 10718,42 → 17916,73 | 12403,14 → 19365,08 |

O p95 C1 melhora 5,18% neste confronto, mas não há demonstração de recuperação da regressão histórica (p95 7401,16 ms antes do sequenciamento, numa série sem observador adicional). Quatro amostras não permitem inferir um p95 estável. C6 piora 56,13%: o incremento não tem ganho uniforme de latência. As configurações são equivalentes, mas os ensaios foram sequenciais, em momentos diferentes, sem alternância A/B nem controlo completo do host; não atribuir toda a variação ao agrupamento.

### Etapas e contenção

A análise [por etapas](../grouped-authority-standard/stages-summary.json) confirma ordem, ausência de sobreposição, igualdade com as contagens originais e todos os intervalos C1. Tempos médios de parede em ms, antes → depois:

| Etapa C1 | Tempo | Queries | Transações centrais | Protocolo preservado |
|---|---:|---:|---:|---:|
| Report | 3817,87 → 3181,25 | 979 → 913 | 17 → 15 | 71 |
| Resumo privado | 2698,17 → 2352,72 | 722 → 656 | 10 → 8 | 54 |
| Catálogo central | 13,38 → 13,81 | 8 → 8 | 0 → 0 | 0 |
| Contexto final | 2740,45 → 2224,82 | 772 → 706 | 11 → 9 | 67 |
| Fora das etapas | 624,32 → 551,56 | 138 → 138 | 4 → 4 | 6 |

Em C1, média HTTP 9898,05→8327,46 ms; união dos intervalos SQL 8539,11→7273,15 ms; união de metadados 7355,24→6257,44 ms, ainda cerca de 75,17% do intervalo servidor. Soma SQL e spans inclusivos não são tempo de CPU nem devem ser somados à parede. Sem fila tenant em C1; espera máxima de admissão 0,22 ms.

Em C6, as mesmas 1533 queries de metadados por pedido (antes 1641) passam a somar em média 10505,99 ms, contra 6478,93 ms. Retenção somada média do lock de auditoria 1409,70→2562,58 ms; maior retenção individual 604,78→1165,96 ms. Retenção somada central 1415,76→2000,69 ms; máximo individual 90,97→218,73 ms. Estes intervalos aumentam apesar de haver menos transações; não identificam, por si, a causa da maior duração.

A revisão independente confirmou estes números nos resultados brutos. A soma da espera SQL pelo lock central diminui 1524,08→1306,17 ms; não há base para atribuir a regressão a mais espera por esse advisory lock. As mesmas 882 queries de metadata tenant passam de 2541,65 para 4939,68 ms somados. O aumento também em tenant, catálogo e sampler exige controlo do host para atribuição causal; o baseline C6 foi medido cerca de vinte horas antes. Nos cenários com quatro/seis amostras, o p95 empírico é o máximo observado.

Admissão C6: máximo ativo **5**, fila máxima **1**, ambos preservados; espera máxima **2886,70→4652,96 ms**, próxima do limite inalterado de 5000 ms. Checkouts físicos têm máximos de espera de 73,27 ms (autoridade) e 57,27 ms (tenant), sem erros; a maior pressão observada está na duração do trabalho e retenção da lease (máximo tenant 4904,06→8382,37 ms), não numa espera física de vários segundos. Frames com bloqueio de auditoria 16/122→29/179; bloqueio central 55/122→37/179. Frações de amostras não são percentagens exatas de tempo.

Riscos pendentes: custo dominante de metadados, variabilidade/C6 e margem reduzida de admissão; budget comum dos pares; cobertura sensível limitada descrita acima; três falhas globais anteriores. Não aumentar limites nem remover verificações para compensar estes resultados. Necessária uma comparação C6 alternada antes/depois, em ambiente controlado, para distinguir efeito do agrupamento de variação do host. **Estas medições não demonstram desempenho produtivo.**

Comandos de reprodução, na raiz, com os pré-requisitos dos runners e nomes de relatório novos para conservar este ensaio:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/authority-short-groups/proof.ps1 -Report grouped-authority-validation
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/authority-metadata/proof.ps1 -Report grouped-authority-drift
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/audit-dashboard/proof.ps1 -Report grouped-authority-durability
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/http-oidc/gate.ps1 -Samples 12 -Scope all -Report grouped-authority-http
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/dashboard-c1/profile.ps1 -Report grouped-authority-standard
node test/integration/dashboard-c1/analyze.js context/reviews/grouped-authority-standard/results.json
node test/integration/http-contention/summarize.js context/reviews/grouped-authority-standard/results.json
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/http-contention/profile.ps1 -Mode capacity -Report grouped-authority-capacity
node test/integration/http-contention/summarize.js context/reviews/grouped-authority-capacity/results.json
node context/reviews/grouped-authority-validation/compare.js
```

## Preservação

Baseline: HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, branch `feat/f13-organizational-profile`, 2235 entradas de estado e 2685 ficheiros inventariados. Worktree previamente alterado. [Baseline](baseline.json) e cópias dos três ficheiros anteriores em `before/`.

[Verificação final](preservation.json): **2680/2685 hashes estáveis**; as cinco alterações existentes são exatamente os três ficheiros de runtime acima, `context/features/http-flows-performance.md` e `context/current-work.md`. Zero alterações inesperadas, ficheiros ausentes ou ilegíveis; HEAD/branch iguais. Dos 466 ficheiros backend de runtime, só os três previstos mudaram; 179 frontend, 14 harness HTTP/profile e 190 ficheiros protegidos estáveis, incluindo os 136 de base/migrations e 13 de manifests/metadata. O observador de etapas também está incluído na comparação integral. Comparação sequencial dos ficheiros inventariados, não prova atómica de todo o repositório ou de dados ignorados.

Novos ficheiros funcionais: [14 testes de regressão](../../../backend/test/groupedAuthorityValidation.test.js#L172) e [prova PostgreSQL](../../../test/integration/authority-short-groups/proof.js) com [runner](../../../test/integration/authority-short-groups/proof.ps1) e [instruções/limites](../../../test/integration/authority-short-groups/README.md). Os restantes artefactos novos são evidência e scripts locais de comparação/preservação. [Sintaxe](syntax.json): sete ficheiros JavaScript e um PowerShell PASS. A primeira execução da comparação foi bloqueada ao criar o subprocesso Git no sandbox; a repetição com essa execução permitida passou, conservando o [log inicial](preservation-sandbox-failure.log).

[Verificação cruzada dos resultados e hashes das fontes finais](verification.json) PASS. [Pesquisa de padrões sensíveis nos 40 artefactos](artifact-scan.json) sem ocorrências, incluindo logs UTF-8/UTF-16LE; é uma verificação por padrões, não uma garantia universal de ausência de segredos.

Nenhuma migration, definição de grant/permissão, metadata/fingerprint, pool ou configuração de deploy foi alterada. Não foram usados ou alterados dados Dev. As mutações negativas de grants, roles e revogações ocorreram exclusivamente nas bases descartáveis de prova; os runners limparam os seus contentores, e a consulta final às quatro labels de prova devolveu zero contentores. Sem commit, merge, push ou deploy. A suite global continua a ter as três falhas históricas documentadas; este incremento não as corrige nem aprova produção.
