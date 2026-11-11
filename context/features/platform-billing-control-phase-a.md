# Administração C4G — controlo de faturação, Fase A

**Estado:** Complete — fecho formal em 26/10/2026. Fase A implementada, revista sem findings materiais, validada e instalada no ambiente habitual.

**Área:** Administração C4G → Faturação

**Dependência de produto:** [Administração C4G — clientes, utilizadores, faturação e comunicação](platform-customer-administration.md)

**Fundamentação:** [Controlo de faturação e envio de documentos](../research/c4g-admin-billing-and-invoice-delivery.md) e [ciclo de faturação e pagamento](../research/billing-account-and-payment-lifecycle.md)

## Objetivo

Dar à equipa C4G uma visão central, fiável e auditável da faturação de cada entidade cliente: período, valor, documento emitido externamente, vencimento, montantes recebidos e saldo.

Esta fase é um registo operacional interno. Não emite faturas, não cobra pagamentos, não envia emails e não altera automaticamente o acesso das entidades.

## Requisitos confirmados

- A funcionalidade pertence exclusivamente ao módulo do Administrador C4G.
- A plataforma continua fechada, sem signup público.
- A emissão fiscal permanece no TOConline ou no circuito B2G/FE-AP aplicável.
- O mesmo produto serve empresas e municípios; condições e valores são contratuais, não variantes de código.
- A aplicação deve permitir acompanhar período, valor, emissão e pagamento.
- Histórico e dados são preservados; correções não eliminam nem reescrevem silenciosamente evidência anterior.
- Estado financeiro não concede, revoga ou suspende memberships.

## Âmbito incluído

### 1. Conta de faturação central

Cada organização pode ter uma conta de faturação corrente e respetivo histórico de versões:

- denominação legal faturada;
- NIF/identificação fiscal e país;
- morada de faturação;
- email e contacto operacional de faturação;
- referência opcional do cliente no TOConline;
- condições de pagamento em dias e notas administrativas;
- revisão, autor e timestamps.

A conta de faturação referencia a organização central, mas não substitui a ficha institucional. Uma alteração cria nova versão; ciclos e documentos anteriores conservam o snapshot usado no momento do registo.

### 2. Ciclo de faturação

O ciclo representa uma obrigação comercial num período, mesmo antes de existir documento fiscal:

- `organization_id` resolvido no servidor;
- início e fim do período como datas civis;
- descrição curta do serviço;
- montante exato e moeda ISO 4217;
- data prevista de emissão, data de vencimento e notas;
- referência opcional a contrato/subscrição futura;
- estado, revisão, autor e timestamps.

Usar intervalo de datas, não um enum de mês, para suportar faturação mensal, trimestral, anual ou irregular. O período tem limites inclusivos, data inicial não posterior à final e não pode ser alterado depois de associado a um documento emitido.

Estados do ciclo:

- `DRAFT`: preparado e ainda alterável;
- `READY_TO_ISSUE`: conferido pela C4G e pendente de emissão externa;
- `ISSUED`: tem documento fiscal externo válido associado;
- `CREDITED`: foi integralmente corrigido por documento retificativo externo;
- `CANCELLED`: cancelado antes de emissão ou anulado externamente com referência verificável.

As transições são explícitas e auditadas. Não há eliminação física através da interface.

### 3. Referência de documento fiscal externo

Depois da emissão no sistema fiscal, a C4G regista:

- sistema de origem (`TOCONLINE`, `FE_AP` ou outro código aprovado);
- tipo, número e identificador/referência externa;
- data de emissão e vencimento;
- moeda, subtotal, imposto e total exatos;
- estado fiscal `ISSUED`, `CREDITED` ou `CANCELLED`;
- referência ao documento retificado, quando aplicável;
- snapshot da identidade de faturação;
- autor, revisão e timestamps.

O número deve ser único dentro do mesmo sistema de origem, emitente e tipo. Associar o documento move o ciclo para `ISSUED` apenas se valores, moeda e entidade forem coerentes. Divergências exigem correção explícita; não são arredondadas nem ignoradas.

A interface apresenta **Documento fiscal externo** e identifica a origem. Não existe ação “Emitir fatura”.

### 4. Pagamentos manuais

Cada recebimento é um registo imutável associado ao documento:

- montante e moeda;
- data efetiva de pagamento como data civil;
- método controlado, inicialmente `BANK_TRANSFER`, `DIRECT_DEBIT`, `CARD_PROVIDER`, `OTHER`;
- referência externa opcional;
- nota operacional;
- origem `MANUAL_C4G` nesta fase;
- autor e timestamps.

Uma correção cria um estorno ligado ao pagamento original; não altera nem apaga o registo. A soma líquida das alocações não pode exceder o total devido, salvo operação de regularização futura expressamente especificada.

Estado de pagamento derivado:

- `UNPAID`: valor líquido recebido igual a zero;
- `PARTIALLY_PAID`: valor líquido entre zero e o total;
- `PAID`: valor líquido igual ao total;
- `REVERSED`: pagamentos existentes integralmente estornados e saldo novamente em aberto.

`OVERDUE` é um indicador derivado quando o saldo é positivo e a data civil de vencimento já passou. Não é um estado gravado nem um checkbox.

## Regras e invariantes

1. Todos os dados deste domínio pertencem à base central C4G; não são copiados para bases de cliente.
2. `organization_id`, ator e autoridade são resolvidos pela sessão validada; não são confiados ao browser.
3. Apenas organizações conhecidas podem receber conta, ciclo, documento ou pagamento.
4. Montantes usam representação decimal exata e moeda explícita. Não usar `float`/`double` nem converter moedas implicitamente.
5. Totais agregados são apresentados por moeda; moedas diferentes nunca são somadas numa única cifra.
6. Datas de período, emissão, vencimento e pagamento são datas civis; timestamps de auditoria permanecem UTC.
7. Um documento fiscal não é considerado pago por ter sido registado ou enviado.
8. Uma fatura vencida não suspende automaticamente organização, tenant, conta ou membership.
9. Escritas usam revisão esperada/idempotência para impedir duplicação por duplo clique, retry ou concorrência.
10. Arquivo, cancelamento, nota de crédito e estorno preservam histórico e autoria.
11. Nenhum evento, erro ou log técnico contém credenciais, dados bancários completos ou snapshots fiscais desnecessários.

## Autoridade e auditoria

Capacidades funcionais previstas:

- `platform.billing.read`;
- `platform.billing.manage`;
- `platform.billing.payment.record`.

Nesta fase, só sessões centrais C4G autorizadas podem obter estas capacidades. Administradores, gestores e restantes utilizadores das entidades recebem recusa, incluindo quando conhecem IDs válidos.

São auditados, no mínimo:

- criação e alteração da conta de faturação;
- criação, edição e transição do ciclo;
- associação/correção do documento externo;
- registo e estorno de pagamentos;
- leitura de detalhe financeiro quando a política central a classificar como sensível;
- recusas relevantes e conflitos de concorrência.

A auditoria identifica ator, operação, recurso, organização, resultado, correlação e revisões, sem copiar documentos ou dados financeiros completos para o payload.

## Experiência de utilização

### Navegação

Adicionar **Faturação** à área Plataforma C4G. A rota e o item de menu não aparecem para utilizadores sem acesso central; a API continua a recusar acesso direto.

### Resumo e lista

Apresentar:

- faturado no período;
- recebido no período;
- saldo por receber;
- saldo vencido;
- contagem de documentos e entidades com saldo.

Filtros:

- entidade;
- intervalo do período;
- estado do ciclo;
- estado de pagamento;
- vencido/não vencido;
- moeda.

Tabela:

- entidade;
- período;
- número do documento ou “Por emitir”;
- emissão e vencimento;
- total, pago e saldo;
- estado fiscal e estado de pagamento.

Pesquisa, filtros, ordenação e paginação são executados no servidor. O estado vazio distingue ausência de dados, ausência de resultados e falha de carregamento.

### Detalhe

Apresentar num único ecrã:

- identidade faturada e contacto;
- ciclo e estado;
- referência do documento fiscal;
- totais e saldo;
- pagamentos e estornos;
- timeline auditável das alterações.

Ações visíveis apenas quando permitidas:

- criar/editar ciclo;
- marcar pronto para emissão;
- registar documento fiscal externo;
- registar pagamento parcial ou total;
- estornar pagamento com motivo;
- registar correção, crédito ou cancelamento externo.

Cada ação de impacto financeiro mostra resumo e exige confirmação explícita. Conflitos de revisão mantêm os dados introduzidos e pedem atualização; não sobrescrevem trabalho concorrente.

## Contrato conceptual de API

As rotas exatas ficam para o plano técnico, mas o contrato deve separar consultas e comandos:

- listar/resumir faturação com filtros e paginação;
- consultar conta, ciclo, documento, pagamentos e timeline;
- criar/versionar conta de faturação;
- criar/editar/transitar ciclo;
- associar ou retificar referência fiscal externa;
- registar/estornar pagamento.

Comandos aceitam chave de idempotência e `expectedRevision` quando alteram um agregado existente. Respostas não expõem ligações de base, referências de credenciais, dados de infraestrutura ou detalhes internos do TOConline.

## Fora do âmbito desta fase

- Emissão, finalização, anulação ou comunicação fiscal pela plataforma.
- Integração ou sincronização com TOConline/FE-AP.
- Upload, armazenamento ou download de PDFs.
- Configuração de Resend/SMTP, templates ou envio de email.
- Cobrança por Stripe, cartão, referência, débito direto ou outro PSP.
- Reconciliação bancária automática.
- Portal de faturação para administradores das entidades.
- Gestão integral de propostas, contratos, planos, entitlements ou preços.
- Suspensão automática por incumprimento.
- Conversão cambial e agregação entre moedas.
- Eliminação física de registos financeiros.

## Dependências e sequência futura

- A Fase B ligará PDFs privados após R2 e scanner reais estarem operacionais.
- O envio por Resend reutilizará outbox/worker, idempotência e webhooks, sem configuração SMTP genérica no frontend.
- Uma integração TOConline começará por sincronização só de leitura após spike do contrato real.
- Contratos/planos podem passar a originar ciclos, mas não alteram este histórico retroativamente.

## Plano técnico detalhado

### Evidência da implementação atual

- A última migration central existente é `026_platform_logs`; o novo esquema deve ser a migration aditiva `027_platform_billing`.
- `platformDirectory/service.js` estabelece o padrão das consultas C4G: validar sessão antes de obter resultados, usar `BEGIN READ ONLY`, limitar o tempo da query e revalidar a autoridade antes do commit.
- `platformDirectory/access.js` estabelece o padrão das escritas centrais: `authorityCoordinator.write`, scopes explícitos, revisão esperada, idempotência e auditoria na mesma transação.
- O runtime de autoridade só executa SQL constante incluído em `authorityProtocolQueries.js` e materializado pela função `authority_api.execute`; acrescentar queries dinâmicas ou acesso direto às tabelas fica proibido.
- A UI administrativa já usa lazy routes, `platformOnly`, `platformDirectoryApi`, estados vazios distintos, paginação no servidor e navegação sem organização selecionada.
- As migrations centrais recentes são irreversíveis depois de conterem dados. O rollback seguro deste incremento é transacional durante a aplicação da migration e, depois de aplicada, rollback de aplicação mantendo o esquema aditivo; não se elimina histórico financeiro.

### 1. Migration central `027_platform_billing`

Criar `backend/database/central/migrations/027_platform_billing.up.sql`, sem `down.sql`, marcada como irreversível no manifesto. A migration deve ser integralmente transacional pelo runner existente e não fazer backfill, emitir documentos ou criar ciclos para entidades existentes.

#### Tabelas

| Tabela | Responsabilidade e invariantes principais |
| --- | --- |
| `billing_account` | Cabeçalho corrente: `id`, `organization_id` único, `current_version`, `revision`, timestamps. Uma conta por organização. |
| `billing_account_version` | Versões imutáveis da identidade faturada: denominação, país/NIF, morada, email/contacto, referência externa, condições de pagamento, notas, autor e data. Chave única `(billing_account_id, version)`. |
| `billing_cycle` | Agregado corrente: organização, versão da conta, período, descrição, moeda, montante, datas, estado e `revision`. FK direta para a versão imutável da conta usada. |
| `billing_cycle_revision` | Snapshot imutável de cada criação/edição/transição; chave `(billing_cycle_id, revision)`. |
| `billing_fiscal_document` | Referência ao documento externo, ciclo, origem, emitente, tipo, número, datas, totais, moeda, documento retificado, estado e revisão. Nunca contém PDF nesta fase. |
| `billing_fiscal_document_revision` | Snapshot imutável das transições/correções da referência fiscal. |
| `billing_payment_record` | Lançamento append-only `PAYMENT` ou `REVERSAL`, com montante positivo, moeda, data civil, método, referência, nota, origem e ator. O estorno referencia exatamente um pagamento anterior. |
| `billing_activity` | Timeline funcional append-only com códigos fechados, recurso, revisão, ator e metadados não sensíveis. Não substitui o ledger F7. |
| `billing_command_receipt` | Idempotência por organização, operação e UUID de pedido; guarda digest canónico da intenção e projeção mínima do resultado. Payload diferente com a mesma chave falha. |

#### Tipos e constraints

- UUIDs gerados no servidor; FKs restritivas para `organization`, `global_user` e agregados de faturação.
- Datas de negócio em `date`; `created_at`/`updated_at` em `timestamptz` UTC.
- Montantes em `numeric(20,6)`, nunca `real`/`double precision`; API e frontend transportam valores como strings decimais canónicas para evitar perda IEEE-754.
- Moeda `text` com formato `^[A-Z]{3}$`; sem conversão. Todos os pagamentos e documentos associados têm de coincidir com a moeda do ciclo.
- Estados e tipos com `CHECK` fechado conforme o contrato; descrições/notas com limites explícitos e sem JSON livre para dados financeiros.
- `period_start <= period_end`, totais não negativos e total fiscal positivo para uma fatura emitida.
- Unique parcial/composta para `(source_code, issuer_reference, document_type, document_number)` e uma fatura principal por ciclo; documentos retificativos são novas linhas ligadas ao documento corrigido.
- Um reversal não pode reverter outro reversal, cruzar documento/organização/moeda nem exceder o montante ainda não estornado.
- Índices para lista por `(organization_id, period_start desc, id)`, estado, vencimento, documento, pagamentos e timeline; paginação com ordenação estável por data + UUID.

#### Segurança da migration

- Owner das tabelas de escrita: `c4g_authority_owner`.
- `REVOKE ALL` de `PUBLIC`, `c4g_central_runtime` e `c4g_authority_runtime`; conceder ao runtime central apenas `SELECT` necessário às projeções de leitura.
- Acrescentar `authority_first_lock` e `authority_write_guard` a todas as tabelas mutáveis, impedindo writes fora de `authorityCoordinator.write`.
- Estender `authority_api.execute` apenas com hashes das queries constantes definidas pelo módulo.
- Estender o catálogo/constraints do ledger com os eventos de faturação e manter os respetivos payloads sem montantes, NIF, email, morada ou notas.
- Atualizar `centralMigrationManifest.js` com checksum, schema fingerprint e authority security fingerprint reais produzidos pelo gate; atualizar os testes que fixam a sequência do manifesto.

### 2. Modelo de domínio backend

Criar `backend/src/platformBilling/` com responsabilidades separadas:

- `contracts.js`: parsing fechado, normalização NFC, UUIDs, datas civis, decimal canónico, moeda, email, paginação, estados e erros públicos.
- `sql.js`: todas as queries constantes admitidas pela authority allowlist; zero SQL composto com valores do pedido.
- `repository.js`: projeções de lista/detalhe e operações atómicas sobre os agregados.
- `authorization.js`: autoridade C4G e catálogo interno de operações/capacidades.
- `audit.js`: criação dos eventos F7 centrais e `billing_activity` na mesma transação.
- `service.js`: regras de estado, idempotência, concorrência, cálculo de saldos e orchestration.
- `http.js`: router Express e tradução fechada de erros.

Decisões de implementação:

1. Saldos não são campos editáveis. `paidAmount` e `balanceAmount` resultam da soma exata de pagamentos menos estornos dentro da transação/read model.
2. `paymentStatus` e `overdue` são derivados no serviço/query; não são persistidos.
3. Criação/alteração da conta acrescenta primeiro a versão imutável e atualiza o head por CAS.
4. Criação/edição/transição do ciclo atualiza o head e acrescenta `billing_cycle_revision` na mesma transação.
5. Um documento emitido bloqueia alterações ao período, montante, moeda e snapshot da conta do ciclo.
6. Documento retificativo é novo registo; crédito/cancelamento atualiza o estado corrente através de revisão e mantém o documento anterior.
7. Pagamento e reversal são apenas inserts. O documento/ciclo é bloqueado `FOR UPDATE` enquanto se calcula o saldo para impedir excesso em corridas concorrentes.
8. Todas as escritas verificam o receipt antes da mutação, comparam o digest, executam domínio + timeline + F7 + receipt e confirmam atomicamente.
9. Leituras usam uma transação `READ ONLY`, limite de cinco segundos, autoridade antes da query e imediatamente antes de devolver o resultado.

### 3. Autorização e auditoria

Definir operações internas estáveis:

| Operação | Capacidade | Recurso |
| --- | --- | --- |
| `PLATFORM_BILLING_READ` | `platform.billing.read` | `BILLING_PORTFOLIO`, `BILLING_CYCLE` |
| `PLATFORM_BILLING_ACCOUNT_WRITE` | `platform.billing.manage` | `BILLING_ACCOUNT` |
| `PLATFORM_BILLING_CYCLE_CREATE/EDIT/TRANSITION` | `platform.billing.manage` | `BILLING_CYCLE` |
| `PLATFORM_BILLING_DOCUMENT_RECORD/TRANSITION` | `platform.billing.manage` | `BILLING_DOCUMENT` |
| `PLATFORM_BILLING_PAYMENT_RECORD/REVERSE` | `platform.billing.payment.record` | `BILLING_PAYMENT` |

Na Fase A, uma atribuição central ativa `C4G_ADMIN` concede as três capacidades; `SUPPORT` e perfis de entidade não recebem nenhuma. Os códigos ficam separados para permitir segregação futura sem alterar endpoints ou auditoria. Não se cria já um ecrã de gestão dessas capacidades.

Para cada pedido:

- confirmar `request.sessionID === authContext.sessionId`, utilizador/sessão ativos e assignment C4G ativo;
- ignorar `platformRoles` enviados/forjados no browser;
- resolver organização e recurso no servidor;
- nas escritas, usar scopes `POLICY`, `ORG:<id>`, `SUBJECT:<actor>` e o digest da sessão pelo coordenador;
- revalidar assignment antes do commit/retorno;
- manter a política MFA opcional já aprovada; esta fase não introduz step-up obrigatório por limiar inventado.

Eventos F7 propostos:

- `PLATFORM_BILLING_ACCOUNT_CHANGED`;
- `PLATFORM_BILLING_CYCLE_CHANGED`;
- `PLATFORM_BILLING_DOCUMENT_RECORDED`;
- `PLATFORM_BILLING_DOCUMENT_CHANGED`;
- `PLATFORM_BILLING_PAYMENT_RECORDED`;
- `PLATFORM_BILLING_PAYMENT_REVERSED`.

O payload contém apenas `detailCode`, revisão anterior/nova e referências opacas necessárias. Montantes, NIF, email, morada, número fiscal e notas ficam fora do ledger. `audit/event.js` deve reconhecer `PLATFORM_BILLING` como operação central sem membership tenant.

### 4. API HTTP

Montar router próprio em `/api/admin/billing`, com autenticação existente, CSRF global para comandos, `Cache-Control: no-store`, limite normal de JSON e fallback fechado. Não reutilizar `/api/admin/directory` para comandos financeiros.

#### Consultas

- `GET /summary?from=&to=&currency=` — totais por moeda e contagens.
- `GET /cycles?q=&organizationId=&from=&to=&cycleStatus=&paymentStatus=&overdue=&currency=&page=` — lista paginada.
- `GET /cycles/:cycleId` — conta/snapshot, ciclo, documento(s), pagamentos, saldo, estados derivados e timeline.
- `GET /organizations/:organizationId/account` — conta corrente e revisão; ausência devolve projeção vazia, não dados inventados.

#### Comandos

- `PUT /organizations/:organizationId/account` — criar/versionar conta; body com `idempotencyKey`, `expectedRevision` e campos fechados.
- `POST /cycles` — criar ciclo com organização, versão da conta e `idempotencyKey`.
- `PUT /cycles/:cycleId` — editar apenas `DRAFT`, com `expectedRevision`.
- `POST /cycles/:cycleId/transitions` — `READY_TO_ISSUE` ou cancelamento permitido, com `expectedRevision`, motivo quando necessário e `idempotencyKey`.
- `POST /cycles/:cycleId/documents` — registar fatura ou documento retificativo externo e transitar o ciclo de forma atómica.
- `POST /documents/:documentId/transitions` — registar cancelamento/crédito externo com referência e revisão esperada.
- `POST /documents/:documentId/payments` — pagamento parcial/total.
- `POST /payments/:paymentId/reversals` — estorno explícito com motivo.

Respostas monetárias usam strings; datas civis usam `YYYY-MM-DD`; timestamps usam ISO UTC. A API não aceita `organizationId` no body quando já está resolvido pela rota/recurso.

Mapa de erros:

- `400`: input, decimal, data, moeda ou transição inválidos;
- `403`: capacidade C4G ausente/revogada;
- `404`: organização/recurso inexistente ou indisponível;
- `409`: revisão stale, idempotency conflict, documento duplicado, moeda divergente ou pagamento excessivo;
- `503`: dependência/commit não confirmado, sem mensagem interna.

Atualizar o error boundary de `app.js` para abranger `/api/admin/billing` e impedir stack/payload em desenvolvimento. O router devolve sempre códigos fechados e correlation id onde o padrão de plataforma o exigir.

### 5. Composição e integração backend

- Criar o serviço com `centralPool` apenas para leituras e `authorityCoordinator` para escritas.
- Compor em `productionComposition.js` somente no runtime OIDC com Central e authority pool distintos; falhar no arranque se as dependências obrigatórias não existirem.
- Montar em `app.js` antes do fallback 404 e acrescentar o catálogo de endpoints administrativos.
- Não adicionar worker, cron, Resend, R2, TOConline ou dependência npm nesta fase.
- O preflight central deve exigir a migration `027` antes de ativar o código; durante rollout aditivo, a release anterior pode continuar a ler a versão anterior já aprovada, mas a nova rota não arranca sobre schema incompleto.

### 6. Interface

Criar:

- `frontend/src/pages/Platform/PlatformBilling.jsx` — resumo, filtros e tabela;
- `frontend/src/pages/Platform/PlatformBillingDetail.jsx` — detalhe/timeline e ações;
- `frontend/src/pages/Platform/platform-billing.css` — estilos próprios, reutilizando tokens/tabelas/cards existentes;
- componentes pequenos de formulário/modal apenas quando partilhados entre duas ações.

Alterar:

- `frontend/src/api/api.js`: novo `platformBillingApi`, mantendo o cliente central e CSRF existentes;
- `frontend/src/App.jsx`: lazy routes `/administracao/faturacao` e `/administracao/faturacao/:cycleId`, ambas `platformOnly`;
- `Sidebar.jsx`: item **Faturação** em Administração e segurança, com ícone financeiro existente no `lucide-react`;
- `Layout.jsx`: título e inclusão no conjunto de páginas de plataforma que não exigem organização selecionada;
- `PlatformDashboard.jsx`: atalho para Faturação, sem misturar métricas financeiras no dashboard geral nesta fase.

Comportamento:

- quatro cartões de resumo por moeda; se houver mais de uma moeda, mostrar grupos separados;
- filtros refletidos no URL e enviados ao servidor; página volta a 1 quando um filtro muda;
- tabela responsiva com entidade, período, documento, emissão/vencimento, total, pago, saldo e estados;
- ecrãs distintos para loading, erro, lista vazia e filtros sem resultados;
- valores formatados por helper decimal-safe que separa sinal, parte inteira e fração e usa `Intl.NumberFormat` apenas em componentes seguros; não converter o valor monetário integral para `Number` nem fazer aritmética no browser;
- formulários mantêm os dados em conflito `409` e oferecem atualização, sem repetir automaticamente comandos;
- confirmação explícita antes de documento, pagamento, estorno, crédito ou cancelamento;
- não apresentar botões de PDF, enviar email ou emitir fatura.

### 7. Testes e evidência

#### Backend unitário/contrato

Criar `backend/test/platformBilling*.test.js` para:

- parser fechado, datas civis, decimais, moedas, email, limites e rejeição de campos inesperados;
- matriz completa de transições;
- cálculo exato de saldo, parcial, pago, reversed e overdue;
- idempotência igual/divergente e CAS stale;
- projeções HTTP e mapa fechado de erros;
- request não autorizado recusado antes de adquirir conexão;
- auditoria sem dados financeiros/PII proibidos.

#### PostgreSQL real descartável

Criar `test/integration/platform-billing/gate.js` e wrapper PowerShell seguindo o fixture central existente. Demonstrar:

1. migration limpa `026 → 027`, repetição segura e ledger/checksums/fingerprints;
2. preservação de entidades, sessões, memberships, catálogo e restantes tabelas;
3. ACLs: runtime comum não escreve; authority runtime não executa SQL não allowlisted; PUBLIC sem acesso;
4. admin C4G real autorizado; admin/gestor/técnico de duas entidades, `SUPPORT`, sessão expirada/revogada e claim forjada recusados;
5. conta versionada e snapshot anterior preservado;
6. ciclos mensal/anual/irregular, validações e transições válidas/inválidas;
7. unicidade de documento e referências cruzadas recusadas;
8. pagamento parcial/total, excesso, estorno e duas corridas concorrentes sem saldo negativo/duplicação;
9. mesma idempotency key com mesma intenção reproduz resultado; intenção diferente falha;
10. F7 + timeline + mutação + receipt fazem commit ou rollback em conjunto;
11. totais por moeda, filtros e paginação estável sem duplicados;
12. nenhuma operação altera `organization`, memberships, sessões ou dados tenant.

Como a migration é irreversível, o gate não apaga tabelas com dados para simular down. Prova rollback transacional injetando falha durante a aplicação e confirma ausência de versão parcial; prova rollback de aplicação executando a release anterior contra schema `027` aditivo.

#### Frontend

Criar testes Vitest para:

- rota/menu apenas para C4G e funcionamento sem organização selecionada;
- loading, erro/retry, vazio e ausência de resultados;
- filtros/paginação no URL e cancelamento de respostas tardias;
- agrupamento por moeda e formatação pt-PT;
- formulários, confirmação, 409 preservando input e não repetição automática;
- ações ausentes quando o backend não concede capacidade;
- ausência explícita de emissão, PDF, email e SMTP.

#### Browser e regressão

- Gate Chrome/Playwright contra PostgreSQL descartável em 1440 × 900 e 390 × 844: lista, criação de ciclo, documento externo, pagamento parcial, saldo e estorno.
- Confirmar teclado, labels, foco de modal, tabela móvel e ausência de overflow horizontal/erros de consola.
- Executar `node --check` nos JS alterados, testes backend direcionados, gate PostgreSQL, testes frontend direcionados e `npm run build` em `frontend/`.
- Executar regressões de diretório, dashboard, autenticação, autoridade, audit e migrations centrais afetadas.
- Não aplicar a migration ao ambiente habitual antes de backup/restauro verificado e aprovação explícita desse rollout.

### 8. Ordem de implementação

1. Implementar contratos puros e testes de domínio.
2. Criar migration `027`, SQL allowlist, triggers, ACLs e gates de migration/segurança.
3. Implementar repositório, idempotência, regras transacionais e auditoria.
4. Implementar autorização e API HTTP; integrar composição fail-closed.
5. Implementar cliente frontend, rotas, navegação, lista/resumo e detalhe.
6. Implementar formulários e confirmações de comandos.
7. Completar testes PostgreSQL/HTTP/frontend e browser descartável.
8. Rever contra os 15 critérios, documentar evidência e só então propor instalação no ambiente habitual.

### 9. Mapeamento dos critérios para validação

| Critérios | Prova principal |
| --- | --- |
| AC 1, 12 | Gate PostgreSQL/HTTP com admin C4G, perfis de duas entidades e claims forjadas. |
| AC 2 | Teste de versões da conta e snapshots dos ciclos. |
| AC 3, 5, 6 | Contratos + constraints + cenários reais de ciclos/documentos. |
| AC 4 | Receipt idempotente, digest divergente e corridas CAS. |
| AC 7, 8 | Pagamentos/estornos concorrentes e relógio civil controlado. |
| AC 9 | Queries agregadas, moedas e paginação; UI com zero/vazio/erro. |
| AC 10 | Hash/diff das tabelas de organização, tenant, sessão e membership antes/depois. |
| AC 11 | Falhas injetadas antes do commit e verificação conjunta de domínio/timeline/F7/receipt. |
| AC 13 | Pesquisa estática, testes de UI e ausência de chamadas externas. |
| AC 14 | Suites direcionadas, gate PostgreSQL, browser, sintaxe e build. |
| AC 15 | Gate `026 → 027`, falha transacional e compatibilidade da release anterior. |

## Implementação — primeira fatia (22/10/2026)

Implementados os contratos puros em `backend/src/platformBilling/contracts.js`, com payloads fechados para conta, ciclo, transições, documento fiscal externo, pagamento e estorno. UUIDs, datas civis, strings decimais exatas, moeda, texto NFC, email, revisões e vocabulários fechados são recusados antes de qualquer acesso à base. Os valores monetários são normalizados como strings e não passam por `Number`.

A migration central irreversível `027_platform_billing` cria as nove relações previstas, sem backfill e sem dados inferidos. O esquema inclui versões/snapshots imutáveis, FKs restritivas com organização e moeda, unicidade do documento fiscal, uma fatura principal por ciclo, validação concorrente de pagamentos/estornos, timeline funcional e receipts idempotentes. As escritas usam scopes `ORG:<organization_id>`, triggers de primeiro lock, guard antes do efeito e confirmação diferida do authority coordinator; `PUBLIC`, runtime central e authority runtime não recebem escrita direta.

As queries do repositório estão fechadas em `backend/src/platformBilling/sql.js`, incluídas no catálogo de hashes e materializadas pela extensão privada do executor de autoridade. O catálogo F7 reconhece os seis eventos centrais de faturação, sem admitir montantes, NIF, email, morada, número de documento ou notas no payload.

Manifesto central registado com prova PostgreSQL 17 descartável:

- checksum: `8f6f39cc106073452ffe9f206ae19b771f267d48eef96c684bb5f084e727f0a9`;
- schema fingerprint: `21ea761a468dd301d923ddcb03a22be7c8eabd558d3829ac1e023cac70b0516b`;
- authority security fingerprint: `6ffce0530152e20ee383019c8efd728ef1f66c2385978c04290ec49a6fdd5243`.

Evidência desta fatia: 69 testes direcionados PASS, sintaxe dos JavaScript alterados PASS e gate canónico `000→027` PASS, incluindo repetição sem reaplicação, preflight, nove tabelas vazias antes da fixture, 27 triggers de autoridade, ACLs, escrita coordenada real e recusa de scope de organização incorreto. A migration não foi aplicada ao ambiente habitual.

## Implementação — segunda fatia (22/10/2026)

Implementados `backend/src/platformBilling/repository.js`, `service.js` e `audit.js` para conta de faturação e ciclos. O serviço fecha os payloads antes da base, exige a sessão viva e o papel central `C4G_ADMIN`, confirma a organização ativa dentro da transação e abre a escrita com scopes `POLICY`, `ORG` e `SUBJECT`. O repositório aplica CAS por revisão, digest canónico SHA-256 ligado a operação/organização/ator/recurso, replay de receipts e conflito para reutilização divergente da chave. Receipts, timeline e F7 usam a mesma chave scoped por `operation_code`, evitando colisões legítimas entre comandos distintos.

Cada criação, edição ou transição grava snapshot imutável, timeline funcional, evento F7 central não sensível e receipt pela mesma ligação transacional. O receipt é deliberadamente o último efeito. A revisão de ciclo passou a preservar `change_reason`; a função de append F7 central e a constraint do ledger passaram a admitir explicitamente `PLATFORM_BILLING`, mantendo o vocabulário fechado.

Evidência desta fatia: 52 testes dirigidos PASS; `node --check` PASS; gate PostgreSQL 17 `000→027` PASS com reexecução, preflight, repository real, versões da conta, snapshots dos ciclos, replay, conflito de intenção, CAS stale, timeline/F7/receipt e rollback integral provocado por falha F7 numa segunda organização. A suite backend completa executou 1073 testes e conserva três falhas não relacionadas já presentes no worktree: duas expectativas antigas do manifesto tenant (`026`/26 versus `030`/30) e o scan F2 que encontra `localStorage` no frontend. Nenhuma foi alterada nesta fatia. A migration continua sem aplicação no ambiente habitual.

## Implementação — terceira fatia (22/10/2026)

Completadas no mesmo repositório e serviço as operações `DOCUMENT_RECORD`, `DOCUMENT_TRANSITION`, `PAYMENT_RECORD` e `PAYMENT_REVERSE`. Um documento principal exige ciclo `READY_TO_ISSUE`, revisão esperada, organização/moeda e total coerentes e transita ciclo + snapshot para `ISSUED` atomicamente. Documentos retificativos são linhas novas ligadas à fatura original; créditos parciais preservam `ISSUED`, crédito integral transita documento original e ciclo para `CREDITED`, e o cancelamento da nota integral restaura ambos para `ISSUED` sem apagar histórico.

Pagamentos e estornos são apenas inserts. O repositório resolve o ciclo, bloqueia ciclo/documento/pagamento numa ordem estável, delega ao PostgreSQL a proteção concorrente contra excesso e calcula `paidAmount`, `balanceAmount` e `UNPAID|PARTIALLY_PAID|PAID|REVERSED` com `numeric(20,6)` convertido apenas em strings canónicas. Cancelar/creditar uma fatura com recebimentos líquidos é recusado; estornos continuam possíveis para preservar a regularização. Todas as quatro operações usam digest idempotente, timeline, F7 não sensível e receipt final na mesma transação coordenada.

A migration passou a impor `subtotal + tax_total = total`, estado correto do ciclo na associação, alvo fiscal principal e limite cumulativo das notas de crédito. As queries adicionais ficaram no executor fechado da autoridade; checksum e fingerprints foram renovados por prova real, não por inferência.

Evidência desta fatia: 24 testes específicos PASS e sintaxe PASS. O gate PostgreSQL 17 `000→027` PASS prova documento externo, replay, pagamento parcial e total, estorno integral, duas tentativas concorrentes com apenas uma aceite, nota de crédito integral, cancelamento/restauro, 27 triggers, ACLs, fingerprints e atomicidade timeline/F7/receipt. A migration não foi aplicada ao ambiente habitual. A API HTTP continua deliberadamente fora desta etapa.

## Implementação — quarta fatia (22/10/2026)

Implementadas as projeções de resumo por moeda, lista de ciclos, detalhe financeiro do ciclo e conta de faturação da entidade. A lista suporta pesquisa, entidade, intervalo sobreposto, estado do ciclo, estado de pagamento, vencido, moeda e paginação de 25 registos, com ordenação estável por início do período e UUID. O detalhe reúne o snapshot da conta usado pelo ciclo, documentos externos, pagamentos/estornos e timeline. Uma entidade conhecida sem conta devolve explicitamente `account: null`; uma entidade inexistente continua a falhar fechada.

Os montantes continuam a sair como strings decimais canónicas. `adjustedTotal`, `paidAmount`, `balanceAmount`, `UNPAID|PARTIALLY_PAID|PAID|REVERSED` e `overdue` são derivados em PostgreSQL considerando fatura principal, notas de débito/crédito ativas, pagamentos e estornos. A data civil é fornecida pelo serviço em `Europe/Lisbon`, sem depender do relógio ou timezone da base. Cada leitura exige uma sessão viva com `C4G_ADMIN` antes e depois da projeção, dentro de `BEGIN READ ONLY` com limite de cinco segundos.

A migration concede ao runtime central leitura das tabelas de faturação e apenas das colunas `id`, `display_name`, `legal_name` e `status` de `organization`, suficientes para as projeções. Não concede escrita nem acesso aos restantes campos da entidade. O detalhe executa queries sequenciais na mesma ligação PostgreSQL, evitando concorrência inválida sobre um único `pg.Client`.

Evidência desta fatia: 29 testes direcionados PASS, `node --check` PASS e gate PostgreSQL 17 `000→027` PASS. O gate prova valores exatos e separados por moeda, filtros, estado pago/vencido, detalhe completo, ausência explícita de conta, paginação estável com 26 ciclos, leitura pelo runtime central, dupla autorização, fingerprints e preservação das garantias de escrita anteriores. A migration não foi aplicada ao ambiente habitual e nenhuma rota HTTP foi criada nesta etapa.

## Implementação — quinta fatia (22/10/2026)

Criada a API administrativa fechada em `/api/admin/billing`, com quatro consultas e oito comandos para conta, ciclos, documentos fiscais externos, pagamentos e estornos. As rotas usam a autenticação OIDC e o CSRF globais já existentes, limite JSON de 64 KiB, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, catálogo explícito de endpoints e fallback `405`. A composição produtiva só expõe o router quando a segurança central está ativa e reutiliza pools central e de autoridade distintos.

Nos comandos sobre recursos existentes, a organização deixou de ser aceite do cliente: ciclo, documento ou pagamento são resolvidos no servidor por queries estáticas autorizadas e a capacidade `C4G_ADMIN` é revalidada antes da leitura e dentro da escrita coordenada. Queries em comandos, corpos em leituras, campos desconhecidos, IDs inválidos e referências cruzadas são recusados. A fronteira HTTP traduz validação, autorização, ausência, CAS, idempotência e conflitos financeiros para códigos `400`, `403`, `404` e `409`; falhas não reconhecidas devolvem `503`, sempre com código público estável e `correlationId`, sem mensagem SQL, stack ou detalhe interno.

Evidência desta fatia: 33 testes direcionados PASS, incluindo quatro testes HTTP reais sobre Express, e `node --check` PASS. O gate PostgreSQL 17 `000→027` PASS percorre também a API real, prova consulta, criação e edição por ID com organização resolvida no servidor, recusa de query injection, ator forjado e rota desconhecida, preservando ACLs, atomicidade, idempotência e projeções anteriores. Os pins atuais de `027`, renovados na correção formal e corrigidos no rollout para o owner técnico canónico, são checksum `8f6f39cc106073452ffe9f206ae19b771f267d48eef96c684bb5f084e727f0a9`, schema fingerprint `21ea761a468dd301d923ddcb03a22be7c8eabd558d3829ac1e023cac70b0516b` e authority security fingerprint `6ffce0530152e20ee383019c8efd728ef1f66c2385978c04290ec49a6fdd5243`. O cliente frontend e a interface permaneciam fora desta etapa histórica.

## Implementação — sexta fatia (22/10/2026)

Implementado o cliente `platformBillingApi` para as quatro projeções e os oito comandos administrativos, mantendo leituras canceláveis, limites de tempo explícitos e organização apenas na criação do ciclo ou na conta da entidade. Comandos sobre ciclo, documento e pagamento enviam apenas o ID do recurso; a associação à organização continua resolvida no servidor.

Criadas as rotas protegidas `/administracao/faturacao` e `/administracao/faturacao/:cycleId`, disponíveis apenas a `C4G_ADMIN` e independentes da seleção de uma organização. A navegação administrativa e o dashboard C4G incluem acesso direto ao módulo, sem misturar moedas ou transformar métricas financeiras em indicadores globais.

A lista apresenta um livro financeiro por moeda, pesquisa e filtros refletidos no URL, paginação no servidor e estados distintos de carregamento, erro, ausência de dados e ausência de resultados. A formatação monetária preserva strings decimais exatas, incluindo valores acima do limite seguro de `Number`. O assistente inicial cria/versiona a conta de faturação e depois o ciclo, sem expor emissão fiscal, PDF, email ou SMTP.

O detalhe reúne saldo, ciclo, snapshot faturado, documentos externos, pagamentos/estornos e timeline. As ações são condicionadas pelo estado do agregado; comandos financeiros passam por uma revisão explícita, usam uma chave de idempotência estável por diálogo e nunca repetem automaticamente uma intenção após erro. Um conflito `409` conserva os dados introduzidos e oferece atualização explícita. Os diálogos têm foco inicial, contenção de foco, Escape e retorno de foco.

A direção visual segue o sistema C4G com uma composição de livro financeiro: teal para estrutura, verde para ações, números tabulares, saldo dominante e tabelas que passam a cartões no móvel. A inspeção Playwright em `1440×1000` e `390×844` confirmou lista, detalhe integral e diálogo de pagamento; zero erros de consola, sem overflow horizontal, e o foco inicial do diálogo foi confirmado. As respostas foram simuladas apenas no browser porque a migration continua fora do ambiente habitual; a API/PostgreSQL real permanece coberta pelo gate descartável da fatia anterior.

Evidência desta fatia: 21 testes frontend administrativos PASS, dos quais 13 cobrem diretamente cliente, interface e navegação de faturação; incluem endpoints, valores decimais exatos, moedas separadas, filtros/URL, descarte de respostas antigas, conta+ciclo, ações válidas, confirmação, idempotência visual, conflito CAS e visibilidade do menu. `npm run build` PASS com 2126 módulos transformados. Nenhum dado, acesso, migration ou configuração habitual foi alterado.

## Correção dos findings e segunda revisão formal (22/10/2026)

Os quatro findings da primeira revisão foram corrigidos. O cancelamento de uma nota de débito é agora recusado quando retiraria valor abaixo dos pagamentos líquidos, tanto no repositório como no trigger concorrente da migration. As transições inválidas de ciclo e documento e o novo conflito financeiro devolvem `409` estável. O detalhe publica `allowedActions` calculadas no servidor para ciclo, documentos e pagamentos; a interface renderiza exclusivamente essas permissões e deixa de oferecer pagamento com saldo zero, transição fiscal impossível ou estorno esgotado. Recusas de autorização, conflitos CAS/idempotentes e conflitos funcionais, incluindo SQLSTATE de constraints, produzem eventos F7 separados, sem montantes, documentos, mensagens internas ou outros dados sensíveis.

Regressões novas cobrem: nota de débito 50 sobre fatura 100, pagamento 150 e recusa do cancelamento nas duas camadas; mapeamento HTTP das duas transições e do conflito financeiro; projeções e UI sem ações proibidas; F7 para `DENY`, `STALE_REVISION`, transição recusada e excesso detetado pelo PostgreSQL. A revisão repetida não encontrou findings bloqueantes ou relevantes no recorte da Fase A. Evidência final: 89 testes backend de billing/autoridade/F7/migrations/composição PASS, 13 testes frontend direcionados PASS, `node --check` PASS, build Vite PASS e gate PostgreSQL 17 real descartável `000→027` PASS com nove tabelas, 27 triggers e todos os marcadores funcionais ativos. A migration `027` continua por aplicar no ambiente habitual.

## Aprovação do plano

Não permanecem decisões materiais que bloqueiem a Fase A. O plano adota o papel `C4G_ADMIN` existente como único grant inicial, mantém capacidades separadas no contrato e não introduz configuração comercial, fiscal ou de fornecedores. A feature pode passar a implementação quando o utilizador o autorizar.

## Critérios de aceitação

1. Uma sessão C4G autorizada consegue abrir Faturação; um administrador de entidade e uma sessão sem função central recebem `403`, mesmo usando diretamente a API e IDs conhecidos.
2. A C4G cria e versiona uma conta de faturação sem alterar silenciosamente a ficha institucional; ciclos antigos preservam o snapshot anterior.
3. É possível criar ciclos mensais, anuais e irregulares com período válido, moeda e valor exatos; intervalos inválidos e montantes/moedas inválidos são recusados no servidor.
4. O mesmo comando repetido com a mesma chave não cria duplicados; payload diferente com a mesma chave é recusado; duas edições concorrentes não perdem dados silenciosamente.
5. Um ciclo só entra em `ISSUED` com documento fiscal externo coerente. A interface não oferece nem declara emissão fiscal pela C4G Funding Platform.
6. O número fiscal duplicado para o mesmo emitente/origem/tipo é recusado sem afetar o documento existente.
7. Pagamentos parciais calculam saldo e `PARTIALLY_PAID`; a liquidação exata produz `PAID`; excesso é recusado; estorno preserva o pagamento original e recalcula o estado.
8. `OVERDUE` é calculado pela data de vencimento e saldo. Mudança de data civil não requer job nem grava uma transição artificial.
9. Resumo e lista apresentam totais rastreáveis e separados por moeda, com filtros e paginação estáveis; zero, ausência e erro não são confundidos.
10. Nenhuma operação financeira altera automaticamente `organization.status`, tenant, membership, sessão ou permissões.
11. Todas as mutações produzem auditoria coerente; falha de autorização, validação, auditoria ou commit não deixa alteração parcial.
12. Dados de duas entidades permanecem corretamente associados e filtrados; IDs forjados, organização inexistente e referências cruzadas são recusados.
13. Não existe upload de PDF, envio de email, formulário SMTP, chamada TOConline ou chamada a prestador de pagamentos nesta fase.
14. Testes automatizados cobrem domínio, autorização, idempotência, concorrência, transações, cálculos e HTTP em PostgreSQL descartável; frontend tem testes direcionados e revisão desktop/móvel; `node --check` e `npm run build` passam.
15. Migração central é aditiva, tem percurso de upgrade/rollback seguro conforme política do repositório e preserva todos os dados existentes.

## Riscos e decisões adiadas

- A política de retenção fiscal/documental será fechada antes da Fase B.
- A necessidade de dupla confirmação para pagamentos de valor elevado será decidida antes de produção; não será inferida por limiar arbitrário.
- IVA, retenções e arredondamentos continuam sob autoridade do sistema fiscal. Esta fase apenas regista os totais do documento externo.
- O primeiro conjunto de métodos de pagamento é vocabulário operacional, não prova de integração financeira.

## Prontidão

O recorte e o plano estão suficientemente definidos para implementação. As decisões adiadas não alteram o comportamento da Fase A, desde que o modelo preserve histórico, moeda, referências externas e extensibilidade para documentos/entrega.

## Correção do carregamento lazy no ambiente local (23/10/2026)

O Vite conservava no grafo HMR a resolução histórica `platformBilling.js` depois de o componente ter passado a `PlatformBilling.jsx`, produzindo falha no import dinâmico ao abrir `/administracao/faturacao`. Os imports lazy da lista e do detalhe passaram a indicar explicitamente os ficheiros `.jsx` com o casing real. O módulo transformado servido pelo ambiente habitual referencia agora `/src/pages/Platform/PlatformBilling.jsx`; lista e detalhe respondem `200` com `text/javascript`. Uma regressão fixa os dois caminhos. Quatro ficheiros/14 testes direcionados e o build Vite com 2126 módulos passaram. A correção não altera a API, dados ou estado da migration `027`.

## Preparação do rollout local (23/10/2026)

O rollout da `027_platform_billing` ficou separado em duas ações explícitas. `npm run billing:prepare-local` não aplica migrations: confirma o alvo local exato e a versão `026`, cria dumps privados consistentes da base central e do tenant com snapshots PostgreSQL exportados, valida a listagem dos arquivos, restaura cada dump numa base temporária e exige igualdade dos dados mais os preflights canónicos de schema e segurança. `npm run billing:apply-local` só pode ser executado depois dessa prova; volta a validar os hashes dos dumps, recusa drift desde o backup, exige as aplicações locais desligadas, confirma ausência de imports em curso e só então aplica exclusivamente a `027`, revalida o fingerprint final, as nove tabelas vazias e a preservação integral dos dados anteriores e do tenant.

O ensaio inicial no ambiente habitual terminou `PASS` sem instalar a migration. A base central restaurou em `026_platform_logs` com fingerprint `1980f4d6d94cbfd239950b1c605afce4f8501915b4ce8d082a0d88518883c638`; o tenant restaurou em `030_organization_notices` com fingerprint `e39a77c76efb85ce9e19fe17f2e92057739681ded45601cb3e2c1374fca6a623`. O restauro normaliza 16 entradas ACL explícitas do owner capturadas no contrato de origem porque `pg_dump` omite essas entradas quando são semanticamente equivalentes aos privilégios implícitos; o fingerprint canónico completo é exigido após a normalização. Não ficaram bases temporárias. A evidência e os dumps estão sob ACL privada em `.tmp/local-platform/platform-billing-rollout/`.

## Instalação no ambiente habitual (23/10/2026)

Após autorização explícita, as aplicações locais foram paradas e foi renovado o backup verificado em `.tmp/local-platform/platform-billing-rollout/backup-2026-10-22T23-07-14-703Z`. A `027_platform_billing` foi aplicada sem backfill. Uma falha da validação posterior ao commit revelou que o gate descartável tinha capturado os fingerprints com `c4g_billing_admin`, enquanto o procedimento canónico cria os objetos históricos com `c4g_f12_admin`, role técnica `NOLOGIN`; a substituição exclusiva do nome do owner reproduziu exatamente os hashes anteriores, provando ausência de drift estrutural ou de ACL. O gate foi corrigido para executar todas as migrations sob `SET SESSION AUTHORIZATION c4g_f12_admin` e remover o `SUPERUSER` no final.

Pins instalados: checksum `8f6f39cc106073452ffe9f206ae19b771f267d48eef96c684bb5f084e727f0a9`, schema `21ea761a468dd301d923ddcb03a22be7c8eabd558d3829ac1e023cac70b0516b` e security `6ffce0530152e20ee383019c8efd728ef1f66c2385978c04290ec49a6fdd5243`. A ação de apply passou a retomar com segurança quando o commit já ocorreu mas a evidência final ainda não foi persistida. O resultado final `APPLIED` confirma dados central e tenant preservados e as nove tabelas de faturação vazias. O gate PostgreSQL descartável passou com 27 triggers e todos os cenários funcionais; 76 testes direcionados e build Vite com 2126 módulos passaram. O frontend, API e worker foram reiniciados e apresentam health integral; leitura de faturação com sessão C4G ativa passou no ambiente habitual.

## Fecho formal (26/10/2026)

A Fase A e a correção de carregamento lazy ficam concluídas no âmbito contratado. A segunda revisão formal não encontrou findings bloqueantes ou relevantes; a migration `027` está instalada no ambiente habitual e a prova de rollout, preservação, autoridade, idempotência, pagamentos, estornos, API e interface está registada acima. Na reconferência de fecho, a seleção conjunta executou 51 testes backend e 39 testes frontend com sucesso. A suite frontend global executou 52 ficheiros/314 testes com sucesso e parou apenas no parse de `EntityAdmission.jsx`, pertencente à feature ainda ativa de adesão; pelo mesmo motivo, o build global atual não chegou ao lote de faturação. O build e as provas integrais exigidos pela Fase A tinham passado antes dessa alteração externa.

Permanecem fora do âmbito, sem impedir este fecho: emissão fiscal, TOConline/FE-AP, PDF/R2, Resend/SMTP, cobrança automática, reconciliação bancária e suspensão por incumprimento.
