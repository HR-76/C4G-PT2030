# Candidaturas — estados e campos HTTP

Incremento da [entrega 3](../features/c4g-pilot-parity-delivery-3.md), schema tenant `027_application_lifecycle`. API autenticada existente `/api/applications`; organização resolvida pela sessão/membership central, nunca pelo corpo. Cliente `frontend/src/api/api.js`, rotas `backend/src/routes/applicationSliceRoutes.js`.

## Comandos

`POST /`: mantém os campos obrigatórios `opportunityId`, `evaluationId` (UUID ou null), `title` (1–200 caracteres, sem espaços nas extremidades), `responsibleMembershipId`, `deadline` (data civil ISO válida), `idempotencyKey`. Origem central acrescenta `origin: "CENTRAL"` e `centralRevisionId` exata, com `evaluationId: null`. Não exige Matching nem perfil pessoal. Estado inicial `IDENTIFIED`.

`PUT /:id`: mantém `title`, `responsibleMembershipId`, `deadline`, `expectedRevision` positiva e `idempotencyKey`.

Ambos aceitam três campos opcionais: `notes` (texto até 10 000 caracteres ou null), `totalBudget` e `organizationBudget` (string decimal EUR ou null). Formato numérico: inteiro sem zeros à esquerda, entre 0 e 99999999999999.99, até duas casas; exemplo `"120000.67"`, `"0"`, `"0.00"`. Não aceita número JSON, vírgula, notação científica, negativo ou arredondamento. Não impõe proporção entre os dois orçamentos. Omissão na criação grava null; omissão em edição conserva o campo. Null limpa o campo. Não materializar chaves ausentes na intenção normalizada: os recibos anteriores continuam a repetir a resposta original.

`POST /:id/transitions`: `status`, `reason` obrigatório (1–500 caracteres, sem espaços nas extremidades), `expectedRevision`, `idempotencyKey`. Matriz exata no contrato da entrega 3. Correção entre etapas abertas permitida; aprovação/rejeição após submissão; resultados só transitam para arquivo; canceladas/arquivadas sem reabertura. Editar dados não muda estado. Submissão é registo interno, sem envio ao financiador.

## Leituras e respostas

Projeção conserva os campos existentes e acrescenta `notes`, `totalBudget`, `organizationBudget`, `statusChangedAt`, `lastSubmittedAt`, `lifecycleExtended`. Orçamentos devolvidos como strings decimais ou null; zero permanece explícito. Datas de estado/submissão provêm de eventos, não de edições; `lastSubmittedAt` conserva o último registo mesmo após recuo. `GET /:id` inclui `opportunityTitle` e `opportunityClosingDate`, distintas do prazo interno. Histórico paginado conserva cada snapshot de dados e motivo.

Listagem mantém paginação por cursor e filtro `opportunityId`; histórico e responsáveis conservam paginação existente. Filtros, contagens e ordenação completos do piloto ainda não são disponibilizados neste incremento. Sem novos endpoints ou permissões; todas as leituras/comandos conservam autorização cumulativa, auditoria, CAS e isolamento.

Erros existentes mantidos: 400 para contrato inválido, 403/404 para acesso/recurso indisponível, 409 para revisão/estado/responsável/idempotência em conflito. Em schema anterior, campos novos são recusados com 409 `SCHEMA_UPGRADE_REQUIRED`; comandos antigos conservam o contrato anterior até migração. Não se alteram tarefas, equipa ou revisão documental por efeito de mudança de estado.
