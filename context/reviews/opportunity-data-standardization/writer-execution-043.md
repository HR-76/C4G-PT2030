# Janela043 e primeiro ciclo EU — execução e conferência

31/10/2026. **043 instalada, primeiro ciclo parcialmente executado e fonte finalmente suspensa por recuperação autenticada.** A conferência dos dados passou. O resultado global é `INCOMPLETE_CODE_DRIFT`: alterações paralelas no código impedem certificar que o workspace final corresponde ao plano aprovado. O incremento fica em **Review**, com reconciliação pendente.

[Descritor completo](../../references/opportunity-v2/writer-execution-043.json) · [Contrato autorizado](../../references/opportunity-v2/writer-execution-043-contract.md) · [Estado operacional final](../../../output/opportunity-eu-writer-execution-f8a24684-e5d7-4d8f-942e-bf61b7071a1d/final-state.json).

## Resultado efetivo

| Componente | Resultado observado |
| --- | --- |
| Instalação | Central `042→043`, tenant `034` preservado; migrador registado e fingerprints verificados |
| Configuração | Apenas acrescentado `opportunityEuWriter`, política `eu-existing-v2.0`, mapping aprovado |
| Aprovação | Login OIDC normal; evento persistido, cadeia de auditoria e autoridade administrativa recente revalidados antes da instalação |
| Backup da execução | Restauro isolado PASS de236 tabelas,55775 linhas e sete configurações; dados, sequências, schemas, roles/ACL e ausência de drift verificados |
| Recolha | Um único pedido EU;189 batches no mesmo ciclo, sem segundo enqueue |
| Controlo inicial | `FAIL`: `CONTROLLED_HTTP_UNCERTAIN` na observação e na tentativa de suspensão |
| Recuperação | `PASS`: suspensão/quiescência por OIDC, com os requestIds originais; nenhum novo enqueue |
| Estado final | `QUIESCED`, fence7, zero leases ativas; API, worker e admissões saudáveis |
| Pendência operacional | Um run ainda `RUNNING` no registo durável, já expirado e classificado como não recuperável automaticamente; não está a executar com uma lease ativa |
| Dados | Conferência PASS com código original verificado por hash |
| Código atual | Cinco ficheiros ausentes e um alterado face ao plano; paridade final e cobertura dessa versão pela aprovação não certificadas |

A fonte ficou quiescente às `2026-10-31T16:42:21.806Z`; a leitura final às `2026-10-31T16:48:21.126Z` confirmou fence7, zero leases e um run expirado. Não se deve confundir suspensão com conclusão do ciclo.

## Plano, backup e instalação

O novo plano da preparação `c361d18a-254c-43e9-af7f-520cbdd57016` tem digest `52a497cafd8b484891114b341a2e722e6aba4154c042b87460daaec1552492ed` e validade até `2026-10-31T17:30:32.803Z`. A [aprovação autenticada](../../../output/opportunity-eu-writer-window-c361d18a-254c-43e9-af7f-520cbdd57016/approval-b6059269-57db-4944-8924-e08495656eda.json) corresponde ao evento `01a192cc-9edb-7e3e-8758-f556ef694690`, validado contra a auditoria persistida. Não foram fabricadas sessões nem escritas aprovações diretamente em SQL.

Uma primeira tentativa de preparação terminou antes de criar o backup; os serviços foram restabelecidos. Na investigação observaram-se ligações externas transitórias. O preview isolado voltou a passar, e a repetição realizou a cópia coordenada sem essas ligações. O [relatório falhado](../../../output/opportunity-eu-writer-window-d39127d4-cf00-4b46-b2b6-2784df9ba17d/window.json) foi preservado.

A preparação renovada teve uma pausa de65,583s e backup `d6bb88f7-dd79-4b86-a0bb-f6a7f5ce7217`. Depois da aprovação, a execução voltou a observar a11145 e produziu outro backup, incorporando as escritas recentes de autenticação/auditoria. Esta pausa durou67,378s. A [cópia própria da execução](../../../output/opportunity-v2-window/f8a24684-e5d7-4d8f-942e-bf61b7071a1d/backup-restore-cff1439f-b2b4-442b-8cc9-1eafffa083d6.json), `cff1439f-b2b4-442b-8cc9-1eafffa083d6`, conserva dumps privados sob ACL restrita; o cluster de restauro foi limpo.

Imediatamente antes da instalação, a comparação de dados/sequências/configuração coincidiu com essa cópia, com zero sessões externas. A autoridade administrativa persistida permaneceu protegida por locks durante a instalação. O pacote `opportunity-eu-writer-v2` foi aplicado pelo migrador registado. O [relatório de instalação](../../../output/opportunity-eu-writer-execution-f8a24684-e5d7-4d8f-942e-bf61b7071a1d/window.json) e a [baseline anterior ao ciclo](../../../output/opportunity-eu-writer-execution-f8a24684-e5d7-4d8f-942e-bf61b7071a1d/before-cycle.json) confirmam preservação e saúde, ainda com fonte quiescente.

O login físico habitual do worker é proprietário/superutilizador. Foram comprovadas as capacidades e fronteiras SQL previstas; esta janela **não certifica um login habitual com privilégios mínimos**.

## Primeiro ciclo e integridade dos dados

Pedido único: run/cycle `7266ad6b-8880-4ec1-9399-4751187831c5`. A enumeração terminou com45 páginas e1120 registos, iguais ao total remoto estável:527 incluídos,593 excluídos pelo âmbito, zero duplicados e zero inválidos. A enumeração completa não significa que os detalhes de todos os candidatos tenham sido tratados.

| Conferência final | Resultado |
| --- | --- |
| Batches |45 de descoberta concluídos;143 de oportunidades conhecidas concluídos; um run conhecido pendente |
| Arquivos canónicos |138 rederivados e vinculados aos respetivos mapping/payload/decisão |
| Decisões |137 `REVIEW`; uma `ACCEPTED/UNCHANGED`, exclusivamente11145 |
| Motivos das137 revisões |`LEGACY_MIGRATION_REQUIRES_REVIEW` e `MAPPING_BASELINE_UNAVAILABLE` |
| Trabalho por conferir |Cinco alvos `CONFLICT`,391 `DISCOVERED` e dois `PENDING` |
| Publicação automática |Zero oportunidades criadas ou atualizadas; nenhuma migração v1 aceite automaticamente |
| Auditoria |138 eventos SERVICE e quatro operações humanas de controlo vinculados; cadeias DATA4457 e OPERATIONS2 válidas |
| Preservação |538 identidades/heads e1502 revisões;537 outros heads e identidades com linhas completas iguais;129 tabelas de negócio tenant e histórico de1216 runs preservados |

Os137 resultados de revisão provêm das decisões e alvos reais da fase `KNOWN`; não devem ser substituídos pelo `review_count=0` do agregado de descoberta. O ciclo permanece não terminal e `complete=false`.

Os cinco alvos em conflito são `CASCADE:17045`, `CEF-T-2021-AFIFCOEN-WORKS-LNG`, `CEF-T-2021-AFIFCOEN-WORKS-ZE`, `CEF-T-2021-AFIFGEN-UNITS` e `CEF-T-2021-AFIFGEN-WORKS-LNG`. Este ensaio não resolveu esses conflitos nem aprovou as137 migrações.

**11145:** foi efetivamente observada pelo ciclo, além dos previews. Resultado `UNCHANGED`, com uma nova observação e um recibo, sem criar revisão. UUID e revisão5/CAS5 preservados; montante `120000`, tipo PostgreSQL `numeric`, sete prazos. A moeda continua `NOT_FOUND`/NULL: não se transforma esse estado em EUR por inferência. O digest de conteúdo permaneceu `355df5dc59a25556d9103fa276921d7e43d66a1087630481b0c4867460a96ce6`.

## Incidente, recuperação e limite da certificação

O [controlador original](../../../output/opportunity-eu-writer-execution-f8a24684-e5d7-4d8f-942e-bf61b7071a1d/controlled-cycle.json) terminou com falha às `16:37:23.724Z`. A API apresentou respostas incertas; os logs registaram reinícios nodemon e posterior paragem. Uma primeira tentativa de reiniciar os serviços também falhou; após diagnóstico, a segunda recuperou a saúde. A exceção HTTP individual não conservou detalhe suficiente para estabelecer uma causa única.

O [helper de recuperação](../../../output/opportunity-eu-writer-execution-f8a24684-e5d7-4d8f-942e-bf61b7071a1d/recovery.json) só admitia `suspend` e `quiesce`, actor original, política/mapping e sequência de fences3→4→5→6→7. Reutilizou as intenções originais, suspendeu às `16:42:03.937Z`, drenou as leases e reconheceu quiescência. O orçamento normal de300s **não garantiu a suspensão atempada neste incidente**. A recuperação não transforma o controlador em PASS nem o ciclo em concluído.

Durante a janela foram observadas divergências do plano em `backend/src/security/tenantSchemaFingerprint.js` e ausência de `backend/src/apiBootstrap.js` e dos quatro utilitários `errorResponse.js`, `notificationVisibility.js`, `opportunityStatus.js` e `platformUrl.js`. O trabalho paralelo foi preservado. A [conferência estrita](../../../output/opportunity-eu-writer-execution-f8a24684-e5d7-4d8f-942e-bf61b7071a1d/after.json) registou `FAIL/ENOENT` e não foi sobrescrita.

A [conferência independente dos dados](../../../output/opportunity-eu-writer-execution-f8a24684-e5d7-4d8f-942e-bf61b7071a1d/after-diagnostic.json) usou módulos APP cujos bytes coincidem com os hashes originais, recuperando a implementação arquivada do fingerprint quando necessário. SQL e configuração privada mantiveram validação estrita. Resultado: `dataVerificationStatus=PASS`, mas estado global `INCOMPLETE_CODE_DRIFT`; sem certificação do código atual ou de nova aprovação sobre ele. Dependências npm instaladas e a credencial física externa do leitor não foram recertificadas. As leituras consistentes por base não equivalem a um lock distribuído de manutenção.

## Validação e recuperação futura

Antes da janela: [gate isolado32 PASS](../../../output/opportunity-v2-writer-1d50edb180944b7fa988aebab2b54b3f/verification.json),863 hashes estáveis e cleanup; backend2255 PASS/0 FAIL/7 SKIP, frontend495 PASS/build PASS,32 testes operacionais e12 verificações de sintaxe. Os16 artefactos normativos, Excel original e149 SQL anteriores estavam preservados. A primeira tentativa do gate esperava indevidamente SUCCESS para uma fixture v1 que exigia REVIEW; foi conservada, corrigida no harness e repetida integralmente. Estes resultados pertencem à versão validada antes das alterações paralelas.

O helper restrito de recuperação passou quatro testes. O diagnóstico e loader passaram11 testes e revisão independente. Não houve segunda recolha para ocultar a falha.

Manter043 e EU quiescente. Não repetir a instalação042→043 nem o controlador original; os relatórios exclusivos impedem repetição cega. O run expirado e os seus envelopes devem ser reconciliados por um procedimento próprio, sem fabricar sucesso ou apagar o histórico. Antes de nova retoma, fixar a versão do código, renovar os testes/provas e a autoridade, conferir as137 revisões e cinco conflitos, e definir o tratamento dos393 alvos restantes.

O backup disponível é coordenado **anterior à043**. Um restauro destrutivo exigiria uma janela própria e preservação/reconciliação das observações, decisões, auditoria e restantes escritas posteriores; não basta repor isoladamente Central, tenant ou configuração. Não foi realizado downgrade nem restauro sobre as bases habituais.

Próximo passo: reconciliar o run expirado e as pendências numa versão de código congelada, antes de preparar outra retoma controlada.
