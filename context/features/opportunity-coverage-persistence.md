# P1 — persistência e encadeamento da cobertura

Estado: Complete, 28/10/2026. Persistência implementada, validada e ativada em Dev com autorização explícita do utilizador. Subcontrato de `opportunity-sources-calibration.md`; enriquecimento, PT2030 e alertas ficam para fases posteriores.

## Contrato

- Um pedido administrativo europeu inicia um ciclo. Cada job recolhe uma página limitada, guarda-a e aplica-a antes de criar o próximo job; cada job conserva deadline de cinco minutos e lease de 150 segundos.
- Ciclo, lote, checkpoint e identidades vistas são persistidos em tabelas centrais aditivas. O checkpoint e os itens são gravados na mesma transação. A conclusão do lote e a criação do seguinte/outbox também são atómicas.
- Falha antes do stage repete a mesma página; depois do stage reutiliza os itens duráveis; depois do finish não cria outro sucessor. Autoridade administrativa é revalidada em cada transação, inclusive na continuação.
- Cursor vinculado ao filtro, ordenação, seleção, versão de normalização, tamanho da página e data de referência. Alterações incompatíveis falham explicitamente. Não há aumento ilimitado de requests por job.
- Contagens: recebidos = únicos aceites + duplicados + excluídos + inválidos. Resultados aplicados são separados. Duplicados entre páginas não criam revisões extra. Totais remotos variáveis, duplicação e incompatibilidade de contagem resultam em PARTIAL, nunca numa alegação de snapshot estável.
- Interface mostra ciclos agregados e progresso, não confunde a última página com uma sincronização completa. Histórico anterior permanece consultável. Uma nova tentativa após erro cria novo ciclo e preserva o anterior.
- Ativação depende da migração validada e de configuração explícita de cobertura; ambientes anteriores continuam limitados e operacionais. Sem migração Dev ou produção implícita.

## Aceitação

Fixture PostgreSQL isolada com 1200 resultados/48 páginas; repetição sem novas revisões; contagens com duplicados/exclusões/inválidos; crash antes/depois de stage e finish; rollback da publicação do sucessor; revogação; expiração; cursor incompatível; 429; desvio de total; idempotência do pedido; UI agregada. Testes focados, suites completas e build. Gate de migração com autorização própria, incluindo fingerprints e preservação de histórico/roles.

## Implementação e evidência

- Migração aditiva `033_funding_coverage`: ciclo, lote e identidades vistas, sem reescrever oportunidades, revisões ou execuções anteriores. Proprietário fixo `c4g_opportunity_central_owner`; runtime com grants mínimos; leitor tenant sem acesso a estas tabelas operacionais. Segurança das três tabelas incluída no fingerprint do catálogo.
- `fundingTenders/coverage.js` mantém checkpoint e contagens na transação do stage. `repository.js` conclui lote, cria sucessor e publica outbox atomicamente. `worker.js` recolhe uma página por job e reutiliza stage persistido após retoma. Cada envelope conserva cinco minutos de validade, sem prolongar a validade do anterior.
- Cursor contém hash de endpoint/filtro/ordenação/tamanho de página/versão, mais a data civil de referência; ciclo conserva hash/data mesmo quando só existe uma página. Registos duplicados entre páginas não são reaplicados. Total remoto variável ou duplicados impedem SUCCESS; inválidos não impedem recolher as páginas seguintes, mas o ciclo termina ERROR.
- Histórico HTTP agregado por pedido/ciclo, com últimos ciclos completos independentes da janela de 100 entradas. Sem alteração das rotas ou dos argumentos existentes em `frontend/src/api/api.js`. Contagens mostram recebidos, únicos, duplicados, excluídos, inválidos, resultados aplicados e pendentes. Confirmação idempotente continua possível durante indisponibilidade.
- Configuração `durable-v1` exige schema 033. Suporte à leitura/continuação de ciclos permanece quando se desativa a criação de ciclos novos. Heartbeat anuncia suporte aos checkpoints; pedidos novos são recusados enquanto o worker ainda for incompatível.

Gate final autorizado: `test/integration/funding-tenders/coverage.ps1`, PostgreSQL descartável na porta 5559, dados exclusivamente sintéticos. **PASS** em `output/funding-coverage-20261028/gate-dd14494d19d94a3fb6ac41aeb081a93e/verification.json`. Runner oficial e preflight de 033 passaram; 1200 identidades em 48 páginas; segundo ciclo com 1200 inalteradas e nenhuma nova revisão; rollback do sucessor/outbox, replay de stage, fence antigo, revogação, expiração, 429, duplicados, total variável e grants testados. Expiração parcial: 25 aceites, 10 aplicados, 15 pendentes. Todos os contentores do gate removidos, ausência confirmada por etiqueta.

Tentativas anteriores conservadas: primeiro percurso completo passou; ensaio ampliado encontrou erro da fixture de expiração (consultava `lastRun` depois de alterar artificialmente a ordenação), corrigido para identificar o ciclo exato. Uma falha de preparação ficou sem causa comprovada; diagnóstico seguro foi acrescentado. Revisão encontrou proprietário dependente do login de migração; corrigido com regressão e fingerprint medido. O preflight recusou corretamente o fingerprint antigo durante essa correção; não foi enfraquecido.

Validação final: backend **1601 PASS, 0 FAIL, 7 SKIP preexistentes**; frontend **359 PASS**; build e sintaxe PASS. Chrome 1440/390 com API sintética: contagens e cobertura parcial visíveis, sem overflow (`output/playwright/funding-coverage-*.png`). Revisão final sem bloqueios adicionais para a implementação; não equivale à ativação do runtime.

## Ativação pendente e limites

Leitura de Dev em 28/10/2026 às 22:22:15Z: schema **030_application_responsibles**, **119** identidades, cobertura **disabled** (`output/funding-coverage-20261028/runtime-check.json`). Nenhuma migração Dev/produção, nova recolha real, commit ou deploy foi executado nesta fase.

Não é possível aplicar apenas 033 sobre este estado: depende de **031_tenant_directory_resolution** e **032_single_organization_membership**. Essa atualização deve ser revista e autorizada no seu âmbito, incluindo a verificação não destrutiva de conflitos que a migração 032 recusa. Não resolver conflitos por eliminação/alteração automática de memberships.

Depois das migrações autorizadas: reiniciar o worker compatível, confirmar heartbeat/progresso e `coverageSupported`; ativar `state.funding.coverage='durable-v1'` na composição local (equivalente a `FUNDING_TENDERS_COVERAGE` no runtime), reiniciar a API e confirmar o contrato de estado. A partir daí, um pedido administrativo inicia o ciclo. Não foi alterado o estado local persistido nesta implementação.

A API remota continua paginada e mutável: contagens consistentes não constituem garantia de snapshot imutável. Um pedido expirado conserva dados/checkpoints e exige nova intenção para um novo ciclo; não se alarga silenciosamente o deadline. Enriquecimento, Portugal 2030 e alertas permanecem fora deste incremento.

## Ativação local autorizada — 28/10/2026

O utilizador autorizou a revisão das dependências e a ativação local nesta sessão. A secção anterior conserva o estado antes da ativação.

Revisão READ ONLY: schema030 admitido, zero conflitos de memberships para 032 e zero recolhas em curso. Executado `backend/scripts/localPlatform/activateFundingCoverage.js --apply`: runner canónico aplicou apenas 031, 032 e 033, com transação e preflight. Preservadas **119 identidades, 135 revisões e 1 membership**. Configuração privada local atualizada atomicamente para `funding.coverage='durable-v1'`, sem registar credenciais. Worker da sessão reiniciado e API recarregada pelo nodemon.

O primeiro arranque recusou `OPPORTUNITY_SCHEMA_DRIFT`: o preflight F12 mantinha a lista anterior de tabelas. Regressão RED→GREEN acrescentada para 032/033 com tabela em falta e tabela extra; corrigida a lista estrita apenas a partir de 033, sem relaxar a recusa de drift. O gate P1 passa a chamar também este preflight; essa chamada foi comprovada neste incremento pela regressão e pelo arranque local real, não por nova execução do gate completo.

Verificação às **22:28:40Z**: schema033, preflight central e oportunidades PASS; modo `durable-v1`; worker PROCESSING/ready/coverageSupported; API5000 e proxy3000 devolvem HTTP200/ready; endpoint administrativo sem sessão devolve401. Evidência sem segredos: `output/funding-activation-20261028/verification.json`. Logs da primeira falha preservados. Backend **1601 PASS/7 SKIP preexistentes**, frontend **359 PASS**, build e sintaxe PASS após a correção.

Não foi iniciada nova recolha real: a ativação não altera por si só as 119 identidades. Sem alteração de produção, commit ou início de P2–P5.

## Primeira recolha real — validada

Iniciada pelo utilizador no fluxo administrativo autenticado em 28/10/2026 às 22:31:37Z; concluída às 22:32:59Z (~81 s). Ciclo `acc4ed90-4183-4f14-9ba1-04b7c185ed21`: **SUCCESS**, 45 páginas/lotes, total remoto estável de1119, recebidos1119, únicos aceites526, duplicados0, excluídos593, inválidos0, criados414, atualizados0, inalterados112, falhados0 e nenhum lote ativo. Contagens do ciclo, lotes e identidades vistas conferidas em READ ONLY.

Verificação pública independente, sem jobs nem escrita na base, percorreu novamente as45 páginas:1119 recebidos,526 aceites e **593 exclusivamente com prazo anterior a2026-10-28**. Zero sem prazo, estado divergente ou invalidade. Assim,1119=526+593 e526=414+112; o limite anterior de100 não truncou a recolha.

Catálogo passou de119 para **533** identidades:531 EU (261 no intervalo de datas,265 futuras,5 históricas com prazo passado) e2 POCTEP (1 no intervalo,1 histórica). Não confundir intervalo de datas com elegibilidade confirmada; P2/P3 continuam responsáveis pela qualificação de estado/detalhe. Não foram removidos os registos históricos nem executada nova recolha POCTEP nesta validação.

Evidência: `output/funding-live-validation-20261028/counts.json`, `exclusions.json` e `catalog-dates.json`. O navegador integrado estava indisponível e Computer Use interrompeu o controlo por não confirmar o URL; o pedido foi iniciado pelo próprio utilizador, sem contorno de autenticação. A validação posterior usou apenas leitura da base e da API pública.

Próximo passo: seguir para P2 — estado temporal e atualização dos registos existentes — mantendo esta recolha como referência real de cobertura.
