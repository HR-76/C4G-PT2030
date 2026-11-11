# Custo sequencial do dashboard C1

Investigação autorizada em 27/10/2026. Decisão a suportar: qual redução de custo atacar primeiro, mantendo no máximo uma lease tenant ativa por pedido, autoridade fresca nas fronteiras existentes e auditoria na mesma transação antes do commit?

## Âmbito e critério

Analisar código e medições; acrescentar apenas observação em processos de teste, sem alterar a aplicação, harnesses anteriores, dependências, migrations, grants, configuração ou dados Dev. Reutilizar as fixtures isoladas já autorizadas, com OIDC e roles/RLS reais. Não aumentar pools ou deadlines, omitir verificações, reutilizar autoridade entre checkpoints ou mover auditoria para depois da resposta.

A baseline é o [gate integral e repetição C1](../reviews/http-audit-dashboard-gate/README.md): 108/108 e 36/36 sucessos, mas dashboard C1 p95 7,40 → 9,73 → 10,64 s. A admissão tenant não mostrou fila em C1. Distinguir custo acumulado de consultas, spans inclusivos e tempo HTTP; não somar spans sobrepostos como parcelas independentes.

## Método

Um observador carregado só no processo de teste envolve os quatro ports chamados pela rota: report, privateSummary, centralSummary e dashboardContext. Regista início/fim, consultas por categoria/hash e checkpoints, sem guardar SQL, argumentos, tokens ou resultados. Conserva chamadas, receiver, resultados, erros e ordem. Reutiliza o profile standard sem alterações: 36 amostras, incluindo quatro dashboard C1 e aquecimento separado. Nos quatro C1 guarda intervalos das queries para distinguir soma de duração e cobertura real do tempo.

Evidência em `context/reviews/dashboard-c1-stages/`; diagnóstico em `test/integration/dashboard-c1/`. A interpretação deve confrontar contagens, invariantes, falhas e custo do observador com a execução anterior. A conclusão é uma recomendação, não uma decisão de arquitetura nem aprovação produtiva.

## Resultado

O custo está sobretudo nas verificações de metadados repetidas pelas três operações tenant, que agora são sequenciais. A espera de admissão não explica C1. A sequência retirou sobreposição entre relatório e oportunidades privadas; não tornou a consulta agregada do catálogo central cara. Isto é uma interpretação apoiada em código e observação, sem ensaio controlado alternando versões.

Quatro dashboard C1, excluindo aquecimento: HTTP médio **9898,05 ms**, p50 **10143,13 ms**, p95 **10223,32 ms**. O observador mede início/fim reais dos ports, e as quatro etapas não se sobrepõem. [Intervalos e decomposição](../reviews/dashboard-c1-stages/stages-summary.json), [dados integrais](../reviews/dashboard-c1-stages/results.json).

| Etapa | Tempo médio decorrido (ms) | Chamadas pg | Transações centrais de autoridade | Chamadas authority-protocol |
|---|---:|---:|---:|---:|
| Relatório | 3817,87 | 979 | 17 | 71 |
| Resumo privado | 2698,17 | 722 | 10 | 54 |
| Catálogo central aquecido | 13,38 | 8 | 0 | 0 |
| Validação final `dashboardContext` | 2740,45 | 772 | 11 | 67 |
| Fora das quatro etapas | 624,32 | 138 | 4 | 6 |
| Total no servidor | **9894,18** | **2619** | **42** | **198** |

Os 3,87 ms restantes, em média, separam a duração HTTP medida pelo cliente da duração observada pelo middleware. Não equivalem a uma medição isolada de rede. As três operações usam três leases ao longo do pedido, com no máximo uma ativa; a etapa central usa outro pool. As contagens observadas fecham exatamente o mapeamento estático. Este perfil usa o ramo de diretório da fixture com `documentsEnabled=false`; o ramo coordenado de documentos acrescenta consultas e não está quantificado aqui.

### O que ocupa o tempo

As durações SQL somadas são **8665,86 ms**, mas a união dos intervalos no driver é **8539,11 ms**: há **126,75 ms de sobreposição**, sobretudo no relatório. A união dos intervalos de metadados ocupa **7355,24 ms**, cerca de **74%** do intervalo observado no servidor. Esta cobertura temporal não é CPU PostgreSQL: inclui espera, rede e trabalho do driver. O residual de 1355,08 ms fora de queries também não pode ser classificado integralmente como CPU JavaScript.

Cada etapa tenant repete três `observeTenantRuntimeMetadata`; os spans inclusivos somam em média **1044,67 / 974,71 / 954,79 ms** em report/private/final. Cada transação de autoridade executa admissão e uma observação de segurança fresca após o lock. Os spans de admissão incluem o schema e não devem ser somados a ele. As 42 admissões consomem cerca de **4721,77 ms** inclusivos; o SQL funcional agregado de candidaturas permanece uma fração pequena.

A [repetição anterior sem este observador adicional](../reviews/http-audit-dashboard-c1/results.json) já mostrava 756 queries de metadados de autoridade e 882 tenant por dashboard; metadados eram 85,14% da **soma SQL**, não do tempo HTTP exclusivo. Os três hashes mais caros somavam 3632,28 ms: fotografia de segurança central (84 chamadas), constraints centrais (42) e índices centrais (42). As 84 fotografias correspondem a duas por transação coordenada: preflight e observação fresca após lock; não são automaticamente duplicação eliminável.

O `dashboardContext` não lê métricas, mas paga autenticação/contexto, resolução física, permissões, auditoria e finalização completas. Removê-lo eliminaria a revalidação após as outras fontes. O catálogo central demora apenas 13,38 ms aquecido: sobrepô-lo a outra fonte não é uma prioridade sustentada por este C1.

## Opções e recomendação

**Primeiro candidato: partilhar callbacks centrais curtos entre validações adjacentes, mantendo todas as chamadas existentes.** Há dois pares por etapa tenant:

- `captureAuthenticatedRequest` seguido de `resolve`, na entrada de [applications](../../backend/src/applications/composition.js#L200) e [opportunities](../../backend/src/opportunities/httpComposition.js#L189).
- `guardIdentity` seguido de `resolve`, antes de `prepare`, no [coordenador](../../backend/src/security/authorityCoordinator.js#L200).

Um `withAuthority` curto por par permite que ambas as chamadas usem a mesma transação central. O par captura/resolução termina antes de adquirir a lease; o par identidade/contexto do guard já ocorre durante a execução da lease e termina antes de `prepare` e do trabalho funcional. `prepare` continua separado, com validação fresca após o lock. Não partilha resultados entre esses pontos. A estimativa estática para esta fixture é **42 → 36 transações** e **2619 → 2421 chamadas pg**: seis vezes 33 chamadas de infraestrutura evitadas, mantendo as 198 chamadas de protocolo, as avaliações e os dez eventos de auditoria. Não é uma estimativa de milissegundos nem uma alteração implementada.

| Opção | Benefício possível | Condição e tradeoff |
|---|---|---|
| Callbacks curtos para os dois pares adjacentes | Menos admissões completas sem remover validações | Mesmas chamadas, erros, identidade, ordem, limites configurados e expirações; callback termina antes do trabalho funcional/prepare |
| Recolha conjunta de inputs das autorizações preliminares do report | Reduz admissões das consultas membership/grants | Recolher inputs no callback; avaliar e auditar fora dele, conservando permissões opcionais e erros |
| SQL composto dentro de cada recolha de metadados | Menos viagens e trabalho de catálogo repetido | Equivalência exata de valores/ordem/fingerprints e recusa de drift; conservar todos os checkpoints |
| Uma composição agregada numa única lease total | Pode reduzir ciclos completos F4/F5 | Mudança maior de contrato, guard, orçamento temporal e conjunto de permissões; não é o primeiro incremento recomendado |

Uma API que devolva identidade/contexto de uma única validação poderia depois reduzir mais consultas do que o primeiro candidato, mas altera internals de validação e exige provas próprias. Não confundir esse desenho com apenas partilhar uma transação mantendo todas as chamadas.

O callback comum terá um deadline transacional partilhado pelas duas chamadas, potencialmente mais restritivo do que dois budgets independentes. Preservar os limites configurados e as expirações não significa prometer a mesma janela efetiva; a prova de timeout deve cobrir explicitamente esse caso, sem aumentar limites para o contornar.

As autorizações adicionais de `prepare` **já** partilham a mesma transação central; não há uma admissão por item. Cada permissão continua a ser avaliada separadamente, com versões coincidentes e operação protegida registada. No report, as duas permissões de diretório são opcionais: uma recusa funcional produz `unitsAvailable:false`; não podem ser transformadas em permissões obrigatórias para todo o relatório.

## Fronteiras e riscos

Não envolver `authorization.authorize` indiscriminadamente num novo callback central. Um DENY/evento crítico faz append imediato; o callback poderia conservar o lock central enquanto espera pelo lock tenant de auditoria, e outro pedido conservar o lock tenant enquanto revalida na Central. Agrupar apenas recolha de inputs evita introduzir esse ciclo no novo percurso. Não envolver `attempt`, `lease.execute`, `prepare` ou `complete` no callback exterior: além de retenção longa, um `prepare` noutra transação pode esperar pelo lock detido pela própria operação; o guard tem de estar durável antes do trabalho protegido.

Conservar validações antes/depois de aquisição, início/fim físico, membership/diretório, epochs, fence, expiração e guard. Conservar flush antes de reset de role, verificações finais depois do flush, eventos individuais ordenados, erros persistentes, rollback e commit incerto. Não revalidar apenas no começo para compensar um custo menor.

Também não apagar automaticamente a segunda fotografia tenant: [observeTenantRuntimeMetadata](../../backend/src/security/tenantRuntimeMetadata.js#L10) observa antes da função privilegiada e [preflightTenantClient](../../backend/src/security/tenantMigrationPreflight.js#L536) volta a observar depois da mudança de role/execução. Agrupar SQL dentro de cada recolha é mais conservador do que transportar a fotografia através dessa fronteira.

Em READ COMMITTED, comandos sucessivos podem observar commits diferentes; agrupar consultas num statement altera a unidade da fotografia, mas não substitui a observação posterior ao lock nem a final. Não usar Repeatable Read para justificar reutilização de autoridade antiga. [PostgreSQL 17 — isolamento](https://www.postgresql.org/docs/17/transaction-iso.html). Qualquer agrupamento transacional deve usar o mesmo cliente; chamadas independentes ao pool não constituem uma transação conjunta. [node-postgres — transações](https://node-postgres.com/features/transactions).

Uma recolha SQL composta deve conservar ordenação, tipos/texto de números grandes, `null` versus campos ausentes, arrays vazios, normalização de constraints e versões admitidas. A materialização ou integração de CTEs depende da query e do plano; não presumir que escrever um `WITH` elimina trabalho repetido. [PostgreSQL 17 — CTEs](https://www.postgresql.org/docs/17/queries-with.html). Os fingerprints existentes não devem ser atualizados para acomodar diferenças do novo coletor.

## Implicações e limites

O primeiro candidato exige provar equivalência de decisões, eventos e recusas, bem como rotações/revogação/expiração entre captura e prepare, após espera na admissão e durante finalização/flush. A validação com drift e commit incerto continua necessária. Medir novamente C1/C4/C6 com limites iguais antes de concluir benefício; esta investigação não implementa nem aprova essa alteração.

O observador passou revisão independente e verificou que todas as queries e transações correspondem às contagens originais, com ordem das quatro etapas e ausência de sobreposição entre elas. Acrescenta ALS, hashes, promises e timestamps; a diferença face a outro ensaio não estima isoladamente esse overhead. Dados locais sintéticos, quatro C1, sem alternância controlada e com as limitações de roles/topologia da fixture: não demonstram capacidade produtiva.

Fontes primárias do produto: [rota](../../backend/src/routes/organizationDashboardRoutes.js#L31), [autoridade de sessão](../../backend/src/security/authenticatedAuthority.js#L79), [coordenador](../../backend/src/security/authorityCoordinator.js#L17), [autorização](../../backend/src/authorization/authorizationService.js#L44), [visibilidade do report](../../backend/src/applications/readAuthority.js#L34) e [finalização tenant](../../backend/src/security/tenantLeaseExecutor.js#L181). [Execução, integridade e limites do diagnóstico](../reviews/dashboard-c1-stages/README.md).

Próximo passo: validar um incremento de callbacks centrais curtos para os pares adjacentes, preservando todas as chamadas e repetindo as provas de autoridade/durabilidade e C1/C4/C6.
