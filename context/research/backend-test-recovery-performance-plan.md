# Recuperação dos testes backend e verificação de desempenho

31/10/2026 — plano pedido pelo utilizador após as 34 falhas registadas durante a calibração das pesquisas. Diagnóstico e plano; nenhuma alteração de código, dependências, SQL ou configuração nesta análise.

## Decisão e recomendação

As 34 falhas históricas já não se reproduzem na árvore atual. Consolidar os testes corrigidos e verificar separadamente o desempenho dos percursos de metadados/admissão. A passagem dos testes demonstra os comportamentos exercitados; não mede latência ou capacidade da aplicação.

Manter a arquitetura aprovada Central + base por organização, membership central como autoridade e separação futura de API/worker. A investigação incide na implementação atual e não altera decisões de produto.

## Evidência atual

| Verificação | Resultado |
| --- | --- |
| Execução histórica das pesquisas | 2170 PASS / 34 FAIL / 7 SKIP |
| Primeira repetição dos quatro ficheiros afetados | 50 PASS / 5 FAIL; as 34 falhas originais não reapareceram |
| Repetição focada após confirmar a consistência do pacote043 | **55 PASS / 0 FAIL / 0 SKIP** |
| Suite backend completa atual | **2216 PASS / 0 FAIL / 7 SKIP**, 2223 testes |
| Verificação por hashes | 11 ficheiros relacionados sem alterações entre as respetivas leituras; não representa um snapshot integral do repositório |

Os dois mocks agora fornecem `knownManifest`; o teste do executor espera `ledgerEntries: knownManifest`; a comparação de versões/fingerprints inclui043. São alterações já presentes quando este diagnóstico começou, não correções implementadas nesta análise.

As cinco falhas da primeira repetição tinham a mesma exceção: `Central migration 043_opportunity_eu_writer_v2 up checksum mismatch`. A leitura posterior encontrou o SQL canónico e o checksum publicado iguais; a repetição passou. A origem temporal exata dessa inconsistência não foi determinada. O escritor EU v2 permanece trabalho ativo no contexto; não atribuir a ocorrência a uma regressão de desempenho nem considerá-la resolvida por simplesmente trocar um hash.

Logs e verificação: `output/search-bars-backend.log`, `output/backend-errors-plan-focused.log`, `output/backend-errors-plan-focused-confirmed.log`, `output/backend-errors-plan-full.log`, `output/backend-errors-plan-before.json`, `output/backend-errors-plan-package.json` e `output/backend-errors-plan-after.json`.

## Plano de ação

### 1. Consolidar uma versão estável dos testes e do pacote — prioridade imediata

- Coordenar o fecho do incremento EU v2 para que testes, manifestos, pacote043 e SQL correspondam à mesma versão de trabalho; registar hashes antes/depois de qualquer execução decisiva.
- Conservar a separação explícita entre manifesto base, pacote registado e versões conhecidas. Não adicionar fallbacks vazios aos mocks nem alargar versões admitidas para obter PASS.
- Usar as regressões existentes de `opportunityV2WriterPackage.test.js`: preservação do pacote11145, admissão042, instalação043 apenas explícita, checksum obrigatório, recusa de SQL alterado e versões incompletas.
- Se o mismatch regressar, comparar os bytes SQL canónicos com o pacote revisto e determinar se a migração é candidata ou já foi aplicada. Uma migração aplicada é preservada; alterações funcionais exigem migração aditiva e respetiva prova. Não recalcular fingerprints de esquema/permissões sem medição isolada.

Aceitação: foco dos quatro ficheiros e testes do pacote PASS numa baseline estável, suite backend sem falhas, sete SKIP identificados separadamente, nenhuma expectativa de segurança enfraquecida. O diagnóstico atual satisfaz a execução local; falta consolidá-la com o fecho do trabalho paralelo.

### 2. Confirmar a cobertura de correção e eficiência

- Verificar uma consulta base agregada por `centralSchemaSnapshot`, mantendo as consultas independentes de segurança; duas chamadas sucessivas produzem duas recolhas novas.
- Preservar bytes JSON/fingerprints, compatibilidade PostgreSQL17/18, deteção de alterações do esquema e de permissões, versões desconhecidas recusadas e revalidação após o lock antes de trabalho protegido.
- Inventariar as provas posteriores à agregação de28/10, incluindo os gates042/043, e conferir os hashes dos módulos realmente executados. Reutilizar evidência válida; completar apenas as lacunas identificadas.
- O relatório original da agregação comprovou7→1 chamadas num cliente controlado e explicitamente não mediu latência PostgreSQL. Provas posteriores de execução funcional não substituem uma comparação de desempenho entre as mesmas versões.

Aceitação: matriz requisito → teste/prova/hash, com limites explícitos e sem tratar a contagem de queries como ganho de latência. Se faltar equivalência SQL real, preparar um ensaio descartável atualizado a partir de `test/integration/authority-metadata/proof.ps1` e `proof.js`, com novos destinos; os scripts históricos cobrem029–032 e não devem ser executados sem adaptação.

### 3. Preparar e medir desempenho num ambiente isolado

- Preparar contrato, protocolo, versões A/B, volumes, perfis, fontes/hash e diretórios novos antes da carga. Reutilizar os harnesses HTTP/C1 existentes após rever a compatibilidade com o runtime atual.
- Medir primeiro o custo dos metadados e o percurso de um pedido; depois report C1/C2/C4, dashboard C1/C4 e dois tenants. Usar condições repetíveis, aquecimento separado e ordem equilibrada quando houver comparação A/B.
- Recolher p50/p95 HTTP, erros/503/timeouts, queries e transações por pedido, tempo de recolha de metadados Central/tenant, espera de admissão, leases ativas/fila, checkout, locks, CPU/memória e trabalho SQL que termina após a resposta. Registar a população de cada quantil e todas as tentativas falhadas.
- Distinguir tempo observado pelo driver, espera/rede e CPU SQL. Não somar spans sobrepostos como se fossem tempo exclusivo. Não comparar diretamente latências históricas de versões e cargas diferentes.

Aceitação: relatório reproduzível de latência, erros, trabalho e contenção, com baseline comparável e causas sustentadas pela instrumentação. Não existe nestes contratos um SLO HTTP global aprovado; qualquer limiar adicional deve ser definido antes do ensaio, sem inventar um compromisso produtivo.

### 4. Corrigir apenas os estrangulamentos demonstrados e provar a regressão

- Se a medição demonstrar um problema, documentar o contrato e critérios do incremento antes de alterar código; criar primeiro a regressão correspondente.
- Priorizar trabalho redundante, consultas e duração das secções com lock conforme a evidência. Não aumentar pools/timeouts nem introduzir cache entre decisões de autorização para mascarar saturação.
- Se o percurso alterado afetar admissão concorrente, preparar uma nova série C6 com fontes atuais e a política aprovada: p95 de admissão≤3000ms, máximo≤4000ms, margem≥1000ms para timeout5000ms e zero erros HTTP/admissão. Estes limites são de admissão, não de HTTP.
- C6 exige seis pares AB/BA, doze bursts,72 pedidos/216 admissões, ambiente válido, preservação de autoridade/auditoria e gate com exit0. O runner fixa módulos/destinos históricos e precisa de adaptação explícita; um burst isolado não aprova a regressão.

Aceitação: testes focados e completos PASS, `node --check` dos JavaScript alterados, suite frontend/build quando houver correção, invariantes preservados, prova comparativa relevante e revisão independente. Sem afirmar melhoria de desempenho quando apenas os testes foram corrigidos.

## Âmbito da execução futura

Esta análise executou apenas suites locais; não criou infraestrutura nem usou bases habituais. Conforme `AGENTS.md`, «Gates de integração que criam infraestrutura, aplicam SQL ou usam bases externas exigem âmbito isolado e autorização própria». Os ensaios previstos precisam desse âmbito concreto antes da execução. C6 pode ainda exigir reserva do host e suspensão de serviços identificados; não herda essa autorização do pedido de plano. Preservar evidências antigas, dados, ledger e SQL publicados; manter043 e retoma EU sujeitos ao contrato próprio.

## Fontes do repositório

- [Contrato de agregação](../features/central-schema-catalog-batch.md) e [prova local e limites](../reviews/central-schema-catalog-batch/README.md).
- [Deduplicação de autoridade e medições históricas](../reviews/authority-metadata-dedup/README.md).
- [Contrato EU v2](../references/opportunity-v2/eu-writer-contract.md) e [testes do pacote](../../backend/test/opportunityV2WriterPackage.test.js).
- [Metadados de autoridade](../../backend/test/authorityMetadataDedup.test.js), [catálogo](../../backend/test/centralSchemaCatalogBatch.test.js), [executor](../../backend/test/centralMigrationAndLifecycle.test.js) e [preflight](../../backend/test/centralMigrationPreflight.test.js).
- [Harness HTTP](../../test/integration/http-contention/README.md), [C1](../../test/integration/dashboard-c1/README.md), [política C6](../decisions/2026-10-27-c6-admission-slo.md) e [runner/gate](../../test/integration/c6-dedicated/README.md).

Atualização de31/10/2026: [consolidação e matriz de evidência concluídas](../reviews/eu-writer-baseline-performance.md), com versão arquivada `eu-writer-v2-d2898861a25b4f6e`, testes reproduzidos e hashes conferidos. O [protocolo M/H/W e C6 futuro](../references/performance/eu-writer-v2-protocol.md) está preparado; nenhum ganho de desempenho foi medido. O trabalho paralelo da janela043 e a correção dashboard/tenant034 ficam fora da versão fixada. A fase HTTP exige incorporar essa correção numa versão derivada e provar prontidão antes da carga.

Próximo passo: adaptar os executores de medição ao protocolo e preparar o ensaio isolado com fontes, dados e ambiente identificados.
