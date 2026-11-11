# Interesses organizacionais — HTTP e dados

Contrato de implementação de 30/10/2026 para [interesse organizacional](../features/organizational-opportunity-interest.md). Organização e ator vêm da sessão; o header `x-c4g-organization` deve coincidir com a organização resolvida. Nunca aceitar autoridade no payload.

## Interesses

Base `/api/opportunity-interests`. Leituras são privadas da organização, paginadas por cursor de 25 resultados. DTO: `interestId`, `opportunityId`, `centralRevisionId`, `snapshot` da oportunidade observada, `title`, `notes`, `status` (`ACTIVE`/`ARCHIVED`), `revision`, `unitIds`, `units` (IDs/labels/caminho/estado), `createdBy`, `createdMembershipId`, `createdAt`, `updatedAt` e `capabilities` (`canRegister`, `canManage`, `canCreateApplication`, `canIncludeResponsibleInTeam`). Campos de unidade: `unitId`, `label`, `parentUnitId`, `lifecycle`. Nomes do autor podem ser acrescentados apenas quando resolvidos pela autoridade; nunca exigir consulta geral do diretório.

- `GET /context`: capacidades atuais e disponibilidade do domínio. Nenhuma role do browser autoriza ações.
- `GET /units?purpose=ASSIGN|FILTER`: projeção mínima de unidades. ASSIGN exige registar ou gerir e devolve apenas UNIT ativas; FILTER exige leitura e inclui unidades arquivadas referenciadas. Sem pessoas/contactos/grants do diretório.
- `GET /summaries?opportunityIds=<UUIDs separados por vírgula>`: até 25 IDs; cada item contém `opportunityId`, `interestId` ou null, `status` e `unitIds`; leitura completa ou erro, nunca erro como ausência.
- `GET /`: filtros opcionais `q` (até 200), `unitId` (UUID ou `NONE`), `status` (`ACTIVE`, `ARCHIVED`, `ALL`; por omissão ACTIVE), `cursor`; responde `items`, `nextCursor`, `capabilities`. Os itens resumidos omitem `snapshot` e `notes`; o detalhe contém esses campos.
- `POST /`: `opportunityId`, `centralRevisionId`, `unitIds` (0–50 UUIDs distintos), `idempotencyKey`. Regista sem campos de candidatura; snapshot exato validado no catálogo. Mesmo agregado organizacional já existente devolve-o sem sobrescrever, inclusive se arquivado.
- `GET /:id`: DTO completo e capacidades atuais.
- `GET /:id/history?cursor=…`: histórico imutável com revisão/ação/ator/instante/notas/unidades/motivo.
- `PUT /:id`: `notes` (null ou texto até 10000), `unitIds`, `expectedRevision`, `idempotencyKey`; gestão apenas, estado ACTIVE.
- `POST /:id/archive`: `reason` (1–500), `expectedRevision`, `idempotencyKey`; arquivo lógico terminal nesta fatia.

Permissões distintas `opportunity_interest.read`, `.register`, `.manage`; operações `OPPORTUNITY_INTEREST_READ`, `_REGISTER`, `_MANAGE`, recurso `OPPORTUNITY_INTEREST`. Grants explícitos instalados pelo mecanismo de perfis: leitura nos quatro perfis, registo em administrador/gestor/técnico e gestão em administrador/gestor. Sem autoridade implícita de autor, unidade ou Admin C4G. Mutações/histórico/recibo/auditoria partilham transação, RLS e organização. Não aplicar grants a contas reais nesta implementação.

Erros: 400 contrato inválido; 403 recusa; 404 recurso indisponível uniforme; 409 revisão/estado/unidade/idempotência em conflito; 503 schema/serviço indisponível ou resultado por confirmar. Capacidade de schema obrigatória `ORGANIZATIONAL_OPPORTUNITY_INTERESTS`; anterior à migração não aceitar gravação parcial nem usar armazenamento do browser como persistência funcional.

## Candidatura a partir de interesse

Reutilizar `POST /api/applications` com campos opcionais **conjuntos** `sourceInterestId` e `sourceInterestRevision`, mais `unitIds` (0–50, seleção confirmada) e `includeResponsibleInTeam` (booleano explícito; falso por omissão). A origem continua CENTRAL, com `opportunityId` e `centralRevisionId` exatos, título/responsável/deadline e campos existentes. O interesse mantém a revisão histórica observada; o formulário obtém e apresenta a revisão atual, avisando se mudou. O servidor valida que a revisão central selecionada ainda é a atual. Referência de interesse exige leitura/gestão atuais, compatibilidade com a oportunidade e CAS; o servidor não aceita unidades de outra entidade. A criação, associação, unidades, equipa opcional e eventos/recibo são atómicos. A mesma chave recupera o mesmo resultado antes de verificar mutações posteriores. Campos ausentes em clientes antigos não alteram digests/recibos antigos.

`GET /api/applications/:id` acrescenta referência do interesse e unidades explícitas. `PUT` aceita `unitIds` opcional; omissão preserva associações, lista vazia retira com histórico. Histórico conserva as unidades de cada revisão. A inclusão explícita na equipa exige também `APPLICATION_WORK_EDIT`; nunca atribui permissões adicionais à membership.

`GET /api/applications/units` devolve opções mínimas de filtro: UNIT ativas e arquivadas ainda associadas a candidaturas acessíveis. Usa a mesma autoridade e limite de equipa da lista, sem leitura geral de pessoas. Browse aceita `unitId` UUID ou `NONE`, filtrado por associação direta com EXISTS para evitar duplicação; as contagens da consulta respeitam esse filtro. O reporting histórico pela unidade do responsável conserva a definição, distinguindo-a da afetação explícita. Registos anteriores sem afetação permanecem sem unidade.

## Schema e recuperação

Migração tenant aditiva `033_organizational_opportunity_interests`, registada com fingerprint medido após as duas fases PostgreSQL isoladas autorizadas em 30/10/2026. Não aplicada ao ambiente habitual. Agregado/histórico/recibo de interesse e afetações explícitas por unidade; referência opcional e afetações da candidatura. FKs compostas por organização, RLS forçada, histórico append-only, ausência de DELETE/TRUNCATE no runtime. Não reinterpretar `organization_opportunity` nem candidaturas anteriores.

Browser conserva intenção antes do POST, falha de armazenamento impede envio com erro recuperável. Resposta tardia não muda navegação. Retry usa mesma chave/payload; reload permite confirmar envio sem criação automática. Voltar/Cancelar só aceitam destinos internos conhecidos e conservam filtros/contexto.
