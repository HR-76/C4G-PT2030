# Entrega 4 — Funding & Tenders, CORDIS e Erasmus

2026-10-17. Implementação e ativação local realizadas. **In Progress: validação de ingestão real pendente por timeout da API pública.** Não declarar esta fatia nem a entrega 4 concluídas.

## Resultado implementado

- Instalação habitual: até 100 resultados, 25 por página, quatro páginas, por execução manual. Outros ensaios conservam cinco resultados. Limites de tempo, resposta e retries mantidos.
- CORDIS seleciona Horizon/EURATOM e Erasmus seleciona Erasmus+ na mesma API Funding & Tenders, recuperando os filtros do piloto. Não é importação de projetos CORDIS. Só se aceitam as três seleções fechadas; a API valida também o programa devolvido.
- Uma identidade externa canónica e uma oportunidade central, independentemente da seleção. Correções manuais, revisões e observações preservadas. Ausência na recolha limitada não elimina dados.
- Histórico identifica a seleção; última execução individual permanece disponível mesmo fora das últimas 100 linhas da tabela. Pedidos têm chave vinculada à fonte. Pedido distinto durante outra execução recebe 409, mesmo na mesma fonte: não se confirma uma chave que não foi persistida. Repetir a chave original devolve a execução existente.
- Migração 017 conserva todos os dados e impede mais de uma recolha ativa. Downgrade recusa se existir histórico CORDIS/Erasmus. Corrigida compatibilidade do arranque do worker com Central 016/017, mantendo preflight exato.
- Sem cron novo, writes legacy, notificações novas ou alterações de permissões/tenancy. Interreg/POCTEP continuam pendentes.

## Verificação executada

1. 53 testes backend direcionados: paginação, filtros fechados, programa divergente, retries/timeout/caps, HTTP, intenção/fonte, autoridade atual, membership, configuração e preflight. `node --check` nos ficheiros alterados.
2. Seis testes frontend e `npm run build` PASS. Sessão anterior descartada, consulta falhada bloqueia submissão, repetição segura, três ações disponíveis e duas fontes pendentes.
3. PostgreSQL 17 descartável, runner canónico: 016 → 017, retorno sem dados novos, reaplicação, preflight, 100 resultados em quatro páginas, CORDIS/Erasmus sobrepostos produzem 102 identidades em vez de 104, correção manual preservada, concorrência, idempotência, revogação e proteção do histórico. [Prova](../../output/funding-programmes/disposable-verification.json).
4. Gate existente Funding: worker separado, falha parcial, reinício, crash real, retomada sem nova recolha, histórico e autoridade PASS. Fixtures receberam prazos futuros explícitos para continuar a representar chamadas elegíveis; a seleção temporal não foi enfraquecida.
5. Native PostgreSQL 18: backup com ACL restrita e leitura validada por pg_restore; migração 017; comparação de dados centrais antes/depois PASS. Worker reiniciado sem trabalho ativo e health 200. [Ativação](../../output/funding-programmes/local-upgrade.json).
6. Chrome com contas OIDC existentes: ações submetidas via interface, fontes persistidas corretas, tabela conferida com PostgreSQL, membro recebe 403 na administração e lê identidades do catálogo central. Desktop 1440/1008 e móvel 390 sem overflow nem erros JS. [Prova](../../output/playwright/c4g-funding-programmes/native-verification.json).
7. [Comparação lado a lado](../../output/playwright/c4g-funding-programmes/comparison.html) confrontada visualmente com o componente original do commit `3a79b25539040c2024051cf9ab6295680b760277`. Referência usa projeção do mesmo histórico público, não serviços legacy. Mantidas cinco secções compactas, ícones e tabela; C4G apresenta limites fixos aprovados, estado individual e ações disponíveis. Não recupera filtros arbitrários/tamanho livre do piloto.

## Limite observado na fonte real

As três execuções de 17/10, entre 23:35 e 23:39 (Lisboa), terminaram `SOURCE_TIMEOUT` após cerca de 47 segundos cada, sem receber novos registos. Consultas independentes via Node e curl também excederam o tempo limite; GET ao endpoint respondeu 405. Isto demonstra falha das consultas nesta verificação, não prova uma indisponibilidade global da Comissão Europeia. Os quatro sucessos anteriores do histórico e o catálogo existente foram preservados. A UI explica o timeout e permite repetir manualmente.

A documentação oficial descreve a pesquisa e o filtro por frameworkProgramme: [APIs Funding & Tenders](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis). O [guia Erasmus+](https://erasmus-plus.ec.europa.eu/es/programme-guide/part-c/how-to-apply/step-4-application-form) confirma a seleção atual 43353764. Os aliases adicionais recuperados do piloto ainda precisam da verificação da resposta FACET/SEARCH real; não foram apresentados como cobertura integral dos programas.

Próximo passo: repetir as três recolhas quando a API responder, conferir programas, novos registos e sobreposição reais no catálogo e atualizar esta prova antes de fechar a fatia.

## Nova tentativa — 17/10/2026, 23:44 (Lisboa)

Por pedido do utilizador, repetida a verificação de disponibilidade das três seleções antes de importar. Funding & Tenders, CORDIS e Erasmus voltaram a exceder 15 segundos cada, mesmo pedindo apenas um resultado, com o formulário e cabeçalhos do adaptador real. Nenhuma resposta HTTP válida recebida. [Resultado datado](../../output/funding-programmes/readiness-retry.json).

Health local 200, worker disponível, zero execuções ativas. Conservadas nove identidades no catálogo e as sete execuções anteriores. Não foram criadas novas execuções nativas enquanto as consultas públicas continuavam sem resposta. Sem alterações na aplicação ou dados de negócio nesta tentativa. Ingestão real, conferência dos programas e fecho desta fatia continuam pendentes; não existe monitorização automática agendada.

## Diagnóstico aprofundado — 17/10/2026, após 23:49 (Lisboa)

Novo pedido para obter respostas válidas, importar e conferir. Comparado o contrato público documentado (POST multipart, partes JSON) com o adaptador. Ensaios independentes, sem importação: corpo vazio, filtro mínimo, formulário completo e corpo serializado com Content-Length explícito excederam 12 segundos. GET ao endpoint com parâmetros públicos respondeu 405 em cerca de 0,5 segundos; POST sem parâmetros excedeu 10 segundos.

Chrome no próprio portal oficial: página de chamadas abriu, mas pedidos SEARCH/FACET ficaram pendentes e a consulta executada no contexto da página excedeu 15 segundos. Ambos os endereços IPv4 devolvidos pelo DNS oficial foram ensaiados separadamente, com o hostname original e validação TLS preservados: nenhum respondeu ao POST dentro de 20 segundos. Não foram alterados DNS, endereços ou limites de produção.

[Diagnóstico consolidado](../../output/funding-programmes/diagnostic-summary.json), [portal oficial observado](../../output/funding-programmes/official-portal.png). A evidência afasta um problema específico dos filtros, serialização ou de um único destino DNS; não permite distinguir definitivamente falha no serviço de um problema de rede a montante. Nenhuma resposta válida obtida, nenhuma nova importação disparada, nenhuma alteração da aplicação/dados de negócio. O bloqueio continua externo ao percurso local validado; esta fatia não está concluída.

## Retoma — 18/10/2026, 00:07–00:08 (Lisboa)

As três consultas públicas voltaram a exceder 15 segundos, mesmo pedindo apenas um resultado. [Verificação](../../output/funding-programmes/readiness-2026-10-18.json). Uma medição adicional, limitada a 45 segundos e sem alterar a aplicação, recebeu **HTTP 500 após 41 segundos**: existe resposta do serviço, mas não dados válidos para importar. [Medição prolongada](../../output/funding-programmes/extended-check-2026-10-18.json).

Health local 200; catálogo com nove identidades, sete execuções históricas e zero ativas. Não foram disparadas novas importações. A conferência de programas, registos e sobreposição reais continua impedida pela resposta de erro da fonte. Sem fecho da fatia e sem alterações da aplicação ou dos dados de negócio.

## Correção Erasmus+/RENEWFM — 18/10/2026

Auditoria oficial: a [chamada RENEWFM publicada pela CINEA](https://cinea.ec.europa.eu/news-events/news/renewfm-new-call-under-eu-renewable-energy-financing-mechanism-support-solar-pv-projects-bulgaria-2026-03-03_en) liga ao portal com `frameworkProgramme=43253967`; o [guia Erasmus+](https://erasmus-plus.ec.europa.eu/programme-guide/part-c/how-to-apply/step-4-application-form) usa `43353764`. O alias `43253967` recuperado do piloto estava incorreto.

Com autorização do utilizador, retirado `43253967` de `fundingTenders/programmes.js` e do filtro preservado em `services/erasmusSyncService.js`; `utils/programmeMapping.js` passa a convertê-lo para `RENEWFM`. Nenhum conector legado foi ativado, nem executada normalização retroativa de tabelas. Sem alterações HTTP, frontend, migrations ou limites.

- Regressão: os dois testes novos falharam no código anterior (filtro e conversão). Após correção, 22/22 testes direcionados PASS e `node --check` nos cinco ficheiros JavaScript alterados PASS.
- PostgreSQL descartável: worker persiste RENEWFM na recolha geral; Erasmus válido continua a atualizar/criar sem duplicar; resposta Erasmus mista rejeita RENEWFM com `SOURCE_RECORDS_REJECTED`, conserva os registos Erasmus válidos e deixa a identidade/revisão RENEWFM intacta. 102 identidades finais; correção manual, idempotência, revogação e proteção de histórico continuam PASS. [Prova](../../output/funding-programmes/disposable-verification.json).
- O primeiro ensaio não arrancou porque Docker estava parado; iniciado Docker Desktop e repetido. O ensaio misto inicial ainda esperava SUCCESS; a asserção foi corrigida para exigir o contrato existente ERROR/rejeição, preservando também o ensaio Erasmus válido. Nenhuma regra de execução foi alterada para obter PASS.
- Dados nativos: nove identidades, sete execuções e zero ativas antes/depois. Worker nativo encontrado parado; não iniciado neste incremento, que não pede importações reais. A correção será carregada no próximo arranque. [Verificação](../../output/funding-programmes/renewfm-separation-verification.json).

A separação está validada com respostas simuladas e persistência real numa base descartável. Não foi obtida nova resposta da API pública; a conferência das importações reais e o fecho da entrega 4 mantêm-se pendentes.

## Retoma com dados reais — 18/10/2026, 12:15–12:19 (Lisboa)

Por instrução do utilizador, confirmado zero trabalho ativo e arrancado o worker com a correção. Três consultas públicas de um resultado responderam HTTP 200 e passaram a normalização antes de qualquer submissão. [Disponibilidade verificada](../../output/funding-programmes/readiness-after-renewfm-fix.json). Arrancados API, Vite, Keycloak e proxy locais existentes; sem setup, migração ou alteração de credenciais.

Executado `node test/integration/integrations/programmes-native.cjs` no Chrome: login administrativo OIDC, três comandos pela interface e espera sequencial da conclusão. Todas as execuções SUCCESS, sem falhados:

| Seleção | Recebidos | Criados | Atualizados | Sem alteração | Limite atingido |
| --- | ---: | ---: | ---: | ---: | --- |
| Funding & Tenders | 100 | 83 | 1 | 3 | Sim |
| CORDIS (Horizon/Euratom via F&T) | 100 | 17 | 0 | 82 | Sim |
| Erasmus | 3 | 1 | 0 | 0 | Não |

Catálogo: nove → 110 identidades; sete → dez execuções; zero ativas; zero identificadores duplicados. As duas seleções gerais partilham 82 identificadores nesta execução, mantendo uma identidade central por chamada. UI/histórico conferem com PostgreSQL; membro continua sem administração (403) e lê o catálogo central; desktop/móvel sem overflow nem erros JS. Captura desktop revista visualmente. [Prova UI](../../output/playwright/c4g-funding-programmes/native-verification.json).

Conferência pública posterior, sem novas importações: Erasmus recebeu três registos, todos com `43353764`, nenhum `43253967`; dois excluídos por não serem atuais, um aceite e coincidente com o catálogo. CORDIS recebeu apenas `43108390` e `43298916`. Todos os registos comuns entre a conferência e as importações coincidem nos campos normalizados. [Conferência e amostras](../../output/funding-programmes/real-import-verification.json).

Limitações observadas:

- Uma primeira comparação exigia igualdade integral dos conjuntos entre consultas; falhou (99 persistidos versus 91 únicos na nova consulta CORDIS). A conferência seguinte registou explicitamente as diferenças: 88 únicos Funding & Tenders e 96 CORDIS, contra 87 e 99 nas importações. As respostas posteriores continham 12 e quatro repetições, respetivamente, sem exclusões temporais. Isto evidencia variação na paginação da fonte; não prova perda na persistência nem permite atribuir retroativamente a diferença de cada execução sem as respostas originais. Ordenação apenas por prazo, com muitos empates, é uma hipótese a verificar; não foi alterada.
- Um programa permanece numérico: `43254037`, chamada `ESC-HUMAID-2021-QUAL-LABEL-FP`. Outra chamada, `CERV-2024-CITIZENS-VALUES`, está normalizada como LIFE a partir dos dados recebidos; requer auditoria dos metadados/mapeamento oficial antes de qualquer correção. Não foi inferido um programa só pelo prefixo.
- Funding & Tenders e CORDIS atingiram o limite aprovado de 100 resultados. Não apresentar estes resultados como catálogo completo. Nenhuma chamada RENEWFM foi recebida nesta amostra real: a sua conversão continua sustentada pela documentação e pelos testes anteriores, não por uma importação real RENEWFM.

O bloqueio de resposta da API deixou de se verificar nesta sessão. Recolhas reais e percurso administrativo funcionaram; a qualidade das classificações e a estabilidade/cobertura da paginação ficam identificadas antes do fecho desta fatia. A entrega 4 global continua In Progress. Worker deixado ativo, sem agendamento de novas recolhas.

## Correção e reconciliação de identidade — 18/10/2026, 12:24–12:36 (Lisboa)

Implementado o incremento autorizado no contrato da entrega 4:

- `43251589 → CERV` e `43254037 → ESC`; ordenação composta por prazo descendente, referência ascendente e identificador de chamada ascendente.
- Tipo 8 usa `CASCADE:<callccm2Id>`; IDs ausentes/inválidos são rejeitados, sem fallback para o tópico. Chamadas diretas conservam a identidade atual; o prefixo é reservado. A referência legível continua em `callReference`, na pesquisa e no detalhe.
- Reconciliação explícita em `fundingTenders/reconciliation.js`, com preview/digest, lock comum à submissão, bloqueio de recolhas ativas, deteção de colisões/ambiguidade e transação integral. Usa o URL da última fonte, preserva UUID e correções manuais, acrescenta revisão/proveniência/auditoria e mantém observações, recibos e revisões anteriores imutáveis. O adaptador recusa aplicar identidades antigas por reconciliar.
- Sem migração de esquema, alteração de tenancy, autenticação, limites ou scheduler. A correção de CERV existente foi dirigida ao registo comprovado oficialmente; não foi feito UPDATE genérico LIFE → CERV.

Validação automática: 42 testes `funding*.test.js` PASS; sintaxe dos JS alterados PASS; dez testes `CentralOpportunities.test.jsx` e `npm run build` PASS. O teste PostgreSQL descartável comprova conservação de UUID/relação com revisão original, preservação byte a byte do histórico anterior, correções manuais, rollback integral após falha na segunda alteração, proteção contra preview obsoleto, segunda reconciliação sem alterações e segunda importação sem novas revisões/duplicados. [Prova descartável](../../output/funding-programmes/cascade-disposable-verification.json).

Executado `node backend/scripts/localPlatform/fundingIdentity.js` para preview e, após os testes e paragem verificada dos serviços locais, `--apply`: backup central protegido e legível, seis chaves externas reconciliadas e duas classificações corrigidas em sete registos. Todos os 110 UUIDs preservados; histórico e dados de negócio da organização conferidos antes/depois. Segunda preparação produziu zero alterações. [Preview](../../output/funding-programmes/identity-reconciliation-preview.json), [aplicação e preservação](../../output/funding-programmes/identity-reconciliation-native.json). Backup restrito identificado na prova, sem credenciais expostas.

API e worker reiniciados com a nova versão. As três consultas públicas limitadas responderam validamente antes de executar, pelo Chrome e conta administrativa OIDC existentes, as três importações autorizadas:

| Seleção | Recebidos | Únicos aceites | Novos | Sem alteração | Falhados |
| --- | ---: | ---: | ---: | ---: | ---: |
| Funding & Tenders | 100 | 100 | 5 | 95 | 0 |
| CORDIS (Horizon/Euratom) | 100 | 100 | 2 | 98 | 0 |
| Erasmus | 3 | 1 | 0 | 1 | 0 |

Catálogo final: **117 identidades, 13 execuções, zero ativas**. Não houve atualizações de campos nestas três recolhas; as correções de programa já tinham sido aplicadas na reconciliação. Uma nova leitura pública com o adaptador corrigido coincidiu integralmente com os campos e chaves de cada importação. Dois documentos Erasmus foram excluídos por não serem atuais. UUIDs reconciliados, histórico anterior e dados da organização voltaram a ser conferidos e preservados. [Prova real](../../output/funding-programmes/real-imports-identity-v2.json).

Chrome, membro OIDC: duas chamadas CERV independentes, ambas classificadas CERV, pesquisa pelo tópico funcional, detalhe no URL original com o mesmo UUID, referência legível e ligação oficial para a chamada 11674; ESC corrigido. `cascade-native.cjs` bloqueou todas as escritas de negócio e não registou erros JS. Desktop/móvel sem overflow; capturas revistas visualmente após concluir carregamentos/animações. [UI](../../output/playwright/c4g-funding-identity/native-verification.json), [lista](../../output/playwright/c4g-funding-identity/distinct-cerv-list.png), [detalhe móvel](../../output/playwright/c4g-funding-identity/preserved-detail-390.png).

Incremento validado. Os limites de 100 resultados mantêm-se: só duas das sete chamadas CERV identificadas na investigação pertencem à amostra atualmente recolhida, não se promete cobertura integral. Desempate estabilizou as consultas verificadas; não constitui garantia de snapshot contra atualizações futuras da fonte. A entrega 4 global permanece em curso pelas restantes integrações, importações e alertas. Nenhum commit, push ou deploy foi feito.
