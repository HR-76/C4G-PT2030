# Entrega 4 — adaptadores Interreg Europe e POCTEP

18/10/2026 · Complete. Implementação, processamento e importações reais verificados. Este incremento está concluído; a entrega 4 global continua em curso.

## Fecho com importações reais — 13:02 (Lisboa)

Após autorização explícita do utilizador, respostas públicas válidas, backup PostgreSQL protegido e registo dos hashes anteriores, o worker foi arrancado em PROCESSING. As quatro recolhas foram pedidas pela interface habitual com OIDC e autoridade administrativa existente.

| Execução | Recebidos | Criados | Sem alterações | Falhados | Resultado |
| --- | ---: | ---: | ---: | ---: | --- |
| Interreg Europe | 3 | 0 | 0 | 0 | SUCCESS: todas encerradas |
| POCTEP | 10 | 2 | 0 | 0 | SUCCESS: chamadas 9 e 10 |
| Interreg Europe, repetição | 3 | 0 | 0 | 0 | SUCCESS |
| POCTEP, repetição | 10 | 0 | 2 | 0 | SUCCESS |

Catálogo passou de 117 para 119 identidades; histórico de 13 para 17 execuções; zero execuções ativas no fim. Cada nova oportunidade POCTEP conserva uma revisão e duas observações de fonte. Nova consulta pública após as importações coincidiu com todos os campos importados e efetivos. Todos os hashes das linhas centrais anteriores, incluindo histórico, continuam presentes e iguais; fingerprints das tabelas de negócio tenant inalterados. Nenhuma identidade ou relação anterior foi substituída.

Chrome com as contas existentes: fontes/histórico administrativo e lista/detalhes reais das duas oportunidades conferidos; membro comum sem acesso administrativo; links oficiais e ações visíveis; 1440/390 px sem overflow e zero erros de página. Capturas reais inspecionadas visualmente. A comparação conserva a referência anterior do piloto; não implica nova aprovação visual do utilizador.

Provas: [verificação real](../../output/interreg-poctep/real-import-verification.json), [execuções e IDs](../../output/interreg-poctep/live-import-journal.json), [baseline e hashes](../../output/interreg-poctep/live-baseline.json), [browser real](../../output/playwright/c4g-official-live/native-verification.json), [comparação lado a lado](../../output/playwright/c4g-official-live/comparison.html). Percurso automatizado: `test/integration/integrations/official-live.cjs`. Sem alterações ao código da aplicação nesta ativação; as validações de implementação abaixo mantêm-se, complementadas pela prova real.

Limites mantidos: Interreg cobre somente as três chamadas gerais do Excel, sem chamadas restritas/ações-piloto; não há agendamento automático de recolhas, arquivo de ausentes ou promessa de catálogo integral. A restrição anterior de standby foi resolvida pela autorização explícita atual. Não houve notificações legadas nem escritas de negócio em organizações.

Próximo passo: recuperar o percurso de importação com pré-visualização, validação e resultado, começando por Portugal 2030.

## Registo histórico da preparação

As secções seguintes descrevem a fase anterior à autorização de processamento. As referências a standby, dados simulados e importações pendentes foram superadas pela validação real acima.

## Resultado

- Adaptadores centrais puros, sem chamadas ao serviço legado. Interreg lê as datas civis do Excel; POCTEP lê as tabelas oficiais via WordPress, confirma os prazos das abertas e mantém horário/condições no resumo. Notas, notícias e documentos não criam oportunidades. Dotação da chamada não é convertida em orçamento por candidatura.
- Chaves `INTERREG_EUROPE:2021-2027:CALL:n` e `POCTEP:2021-2027:CALL:n`, independentes de título/data/posição. Proveniência `OFFICIAL_PROGRAMME`, namespace próprio e referência legível. Funding & Tenders conserva chaves e namespace anteriores; prefixos reservados não podem ser apropriados por novos resultados EU.
- Reutilizados o worker, fila, controlo de autoridade atual, idempotência, exclusão global de concorrência, composição de correções manuais, observações e revisões. O nome técnico do job continua `funding_tenders.refresh`; não significa que as novas fontes sejam apresentadas como Funding & Tenders.
- Migração 018 altera apenas restrições, sem reescrever linhas ou identidades. Colisão com prefixos antigos impede a migração. Reversão impedida se já houver história das novas fontes. Nenhuma tabela legada encontrada na base central habitual; nenhuma sincronização legada executada.
- Interface mantém as cinco secções e tabela do piloto; lista/detalhe usam a fonte correta. Sem funcionalidades novas de IA, scoring, agendamento ou configuração genérica.

## Verificação

| Prova | Resultado |
| --- | --- |
| Testes backend de fontes, contratos, migrações, preflight e fronteiras tenant | 120 PASS |
| Frontend: integrações, catálogo e apresentação partilhada | 26 PASS |
| `npm run build` | PASS |
| Sintaxe dos JavaScript alterados | PASS |
| PostgreSQL descartável — novas fontes | PASS: ida/volta de migração, dados anteriores intactos, worker, correções manuais, FK, revisões imutáveis, repetição sem duplicados, erro sem escrita, ausência sem arquivo, autoridade e revogação |
| PostgreSQL descartável — Funding & Tenders/CORDIS/Erasmus e reconciliação | PASS |
| Consulta pública pelos adaptadores corrigidos | Interreg 3 chamadas históricas / 0 atuais; POCTEP 10 / 2 atuais; sem importação |
| Upgrade local | Migração 018, backup restrito e verificável, hashes de dados centrais/tenant iguais antes/depois |
| Chrome OIDC na instalação habitual | Cinco fontes, histórico correspondente à base, membro comum negado, zero erros de página/escritas, desktop 1440 e móvel 390 sem overflow |
| Pré-visualização de lista/detalhe POCTEP | HTTP simulado com fixtures oficiais, rotulado como teste; fonte POCTEP, duas identidades, prazo/horário visíveis |

Testes executados: `node --test backend/test/funding*.test.js backend/test/officialProgrammeSources.test.js backend/test/centralMigrationAndLifecycle.test.js backend/test/centralMigrationPreflight.test.js backend/test/f12OpportunityDomain.test.js backend/test/f12OpportunityPreflight.test.js backend/test/f12TenantOperationMatrix.test.js`; scripts `test/integration/funding-tenders/official.ps1` e `programmes.ps1`; frontend `FundingIntegrations.test.jsx`, `CentralOpportunities.test.jsx`, `OpportunityPresentation.test.jsx`; `test/integration/integrations/official-native.cjs`.

Provas: [PostgreSQL](../../output/interreg-poctep/disposable-verification.json), [migração](../../output/interreg-poctep/migration-fingerprints.json), [upgrade local](../../output/interreg-poctep/local-upgrade.json), [leitura pública corrigida](../../output/interreg-poctep/corrected-live-read.json), [browser](../../output/playwright/c4g-official-sources/native-verification.json).

## Comparação visual

[Piloto e C4G lado a lado, com pré-visualização POCTEP](../../output/playwright/c4g-official-sources/comparison.html). Capturas inspecionadas: composição das cinco secções preservada, ações e histórico visíveis; identidade C4G; detalhe móvel legível sem corte horizontal. Resumo longo é recolhível e identifica excerto. Diferenças deliberadas: limites fixos aprovados substituem inputs livres; sem atalhos para persistência legada; cobertura e erros explícitos por fonte. Aprovação visual do utilizador não inferida.

## Instalação e limites atuais

**117 identidades e 13 execuções anteriores preservadas; zero importações reais neste incremento.** API reiniciada com a migração 018. Configuração local das cinco fontes preparada. O worker está em `--standby`: verifica a composição e mantém heartbeat, mas não chama `runOnce()` nem agenda polling.

A revisão automática recusou o reinício normal porque este poderia executar trabalho pendente e contrariar a instrução de preparar antes das importações. A alternativa foi testada e aceite: arrancar em espera sem consumir jobs. A interface pode apresentar a ação de solicitar uma recolha, mas o processamento continua parado até ser explicitamente retomado; não confundir configuração pronta com importação operacional. Não foram solicitados jobs no browser.

Interreg cobre apenas as três chamadas gerais do Excel 2021–2027; chamadas restritas/ações-piloto ficam excluídas e identificadas na UI. POCTEP depende de tabelas HTML dentro da API WordPress: alteração de esquema, datas inválidas ou duplicados contraditórios produzem erro, não sucesso vazio. Uma nova chamada de estrutura não reconhecida exige revisão. As recolhas continuam limitadas, sem arquivar automaticamente ausentes/encerradas. Não houve migração automática de possíveis bases antigas do piloto.

Próximo passo: retomar o processamento do worker e executar as importações reais destas duas fontes, conferindo resultados, proveniência, repetição e percurso de catálogo antes de concluir esta fatia da entrega 4.
