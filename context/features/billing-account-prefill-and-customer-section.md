# Dados de faturação: pré-preenchimento e secção do cliente

Estado: In Progress — 2026-11-12. Fases 1 e 2 em Review; Fases 3 e 4 não iniciadas.

Estende [Controlo de faturação — Fase A](platform-billing-control-phase-a.md) e
[Faturação do cliente](customer-billing.md). Responde à pergunta 5 de
[billing-account-and-payment-lifecycle.md](../research/billing-account-and-payment-lifecycle.md).

## Situação atual (implementação)

- No C4G Admin, "Preparar faturação" abre o formulário "Configurar conta de faturação"
  vazio, exceto a denominação legal (`organizationLegalName`). País fiscal "PT" e prazo
  "30" são valores por omissão do formulário (`frontend/src/pages/Platform/PlatformBilling.jsx`).
- `GET /api/platform/billing/organizations/:id/account` devolve só nome e denominação
  legal da organização, mais a conta corrente se existir (`platformBilling/sql.js`, `accountDetail`).
- A ficha da entidade (`organization_registration.fields`, base Central) já contém NIF
  validado, morada, complemento, código postal, localidade, email institucional e
  responsável, preenchidos pelo cliente no registo e em `EntityProfileCard.jsx`.
- O cliente só tem `/api/billing/{access,summary,invoices,invoices/:id}`. Não existe
  leitura nem escrita da conta de faturação do lado do cliente.

## Decisões do utilizador (12/11/2026)

1. **Edição mista.** O administrador da entidade edita diretamente morada, email e
   contacto de faturação. NIF e denominação legal faturada só mudam por pedido de
   correção à C4G.
2. **Divergência avisa, não sincroniza.** Alterar a ficha da entidade não altera a
   conta de faturação. C4G Admin e cliente veem um aviso de diferenças, com ação para
   aplicar os valores da ficha.
3. **Criação pelo cliente ou pela C4G.** O administrador da entidade pode criar a conta
   antes da C4G; a C4G encontra-a pronta ao preparar o ciclo.

## Contrato

### 1. Pré-preenchimento no C4G Admin

Quando a entidade não tem conta, o formulário abre com sugestões da ficha:

| Campo da conta | Origem na ficha | Natureza |
| --- | --- | --- |
| Denominação legal | `organization.legal_name` | Já existente |
| NIF | `nif` | Valor confirmado |
| País fiscal | fixo `PT` | A ficha só admite Portugal |
| Morada / Complemento | `address` / `addressComplement` | Valor da ficha |
| Código postal / Localidade | `postalCode` / `locality` | Valor da ficha |
| Email de faturação | `institutionalEmail` | Sugestão assinalada |
| Contacto | `responsibleName` | Sugestão assinalada |
| Região, prazo, origem e referência externas, notas | — | Exclusivos da C4G |

O administrador C4G confirma e guarda; nada é gravado sem essa ação. Campos sugeridos
são identificados como vindos da ficha. Ficha incompleta: os campos em falta ficam vazios.

Limites diferem: morada 250 na ficha e 200 na conta; localidade 150 e 120. Um valor que
exceda o limite da conta é apresentado para correção manual, nunca truncado em silêncio.

### 2. Secção "Dados de faturação" no cliente

Na área Faturação da entidade, visível a quem já consulta faturação (ORG_ADMIN ou
grant `billing.read`). Só o ORG_ADMIN altera.

- **Consulta:** denominação legal, NIF, país fiscal, morada, complemento, código
  postal, localidade, região, email e contacto de faturação. Nunca notas internas,
  origem ou referência externas, autores ou revisões técnicas.
- **Edição direta (ORG_ADMIN):** morada, complemento, código postal, localidade,
  região, email e contacto de faturação. Cada gravação cria nova versão da conta, com
  revisão otimista, idempotência e auditoria; os restantes campos transitam inalterados
  da versão anterior.
- **Só consulta para o cliente:** denominação legal, NIF e país fiscal, com indicação
  de que a correção é pedida à C4G.
- **Criação (ORG_ADMIN, sem conta):** formulário pré-preenchido como em 1. Denominação
  e NIF vêm da ficha e não são editáveis. Sem NIF confirmado na ficha, a criação não
  está disponível e a página encaminha para completar a ficha.
- Ciclos e documentos já registados mantêm o snapshot da versão usada.
- A organização vem sempre do contexto autenticado; nunca do pedido. Membership
  revalidada antes e depois, como nas restantes leituras de faturação do cliente.

### 3. Aviso de divergência

Calculado na leitura, sem estado gravado. Compara a versão corrente da conta com a
ficha em denominação legal, NIF, morada, complemento, código postal e localidade.
Email e contacto ficam fora: são sugestões, não equivalências.

- C4G Admin: aviso no modal e na faixa "Dados de faturação", com os campos diferentes
  e a ação "Aplicar valores da ficha", que preenche o formulário para confirmação.
- Cliente: aviso na secção. A ação aplica apenas os campos que o cliente pode editar;
  diferenças em NIF ou denominação indicam o pedido de correção.
- Sem ficha ou sem conta não há aviso.

### 4. Histórico no C4G Admin

A timeline da conta distingue alterações feitas pelo cliente das feitas pela C4G.

## Fora de âmbito

Emissão fiscal, TOConline, IBAN e mandatos, preços e contrato, alteração da ficha da
entidade a partir da faturação, sincronização automática entre ficha e conta.

## Perguntas em aberto (não resolver por inferência)

1. **Pedido de correção de NIF/denominação:** basta uma indicação para contactar a C4G,
   ou deve existir um pedido registado na plataforma, com fila no C4G Admin?
2. **Prazo de pagamento na criação pelo cliente:** assumir 30 dias até a C4G rever, ou
   deixar a conta sem prazo definido? O cliente vê o prazo em consulta?
3. **Aviso à C4G quando o cliente altera a conta:** só timeline, ou também notificação?

## Notas técnicas a confirmar antes de implementar

- As escritas de faturação passam por `authority_api.execute_platform_billing`, um
  executor fechado por hash cuja verificação de sessão exige `C4G_ADMIN`. A escrita
  pelo cliente precisa de instruções próprias, logo de uma migração Central aditiva
  (a seguir à 050), com manifesto, checksum e gate PostgreSQL descartável.
- A leitura da ficha na Central para o pré-preenchimento exige confirmar as permissões
  do role usado pelas leituras de faturação sobre `organization_registration`.
- Capacidade de escrita: decidir entre reutilizar ORG_ADMIN inerente ou criar
  `billing.account.edit` no catálogo de autorização. Sem grant delegável nesta entrega.
- Evento de auditoria para alteração pelo cliente (novo código ou origem no existente).

## Plano

1. **Fase 1 — pré-preenchimento C4G Admin.** Leitura da conta devolve sugestões da
   ficha; formulário usa-as; aviso de divergência no modal. Sem migração de escrita.
2. **Fase 2 — consulta do cliente.** `GET /api/billing/account`, secção na área
   Faturação, aviso de divergência.
3. **Fase 3 — criação e edição pelo cliente.** Migração Central, comando
   `PUT /api/billing/account`, auditoria e origem na timeline.
4. Pedido de correção na plataforma, se a pergunta 1 o confirmar.

Cada fase: regressões primeiro, testes focados, suites completas, lint e build.
Alterações de autorização e migração exigem testes automatizados e gate isolado com
autorização própria; nada é aplicado a bases habituais sem pedido.

## Fase 1 — implementação e verificação (12/11/2026)

Só frontend. O modal já recebia `platformDirectoryApi`; a ficha é lida por
`GET /api/admin/directory/entities/:id/registration`, já autorizada a administradores
C4G. Sem alterações de backend, SQL, migrações ou permissões: as notas técnicas sobre
permissões de leitura da ficha deixam de se aplicar a esta fase.

- `frontend/src/pages/Platform/billingAccountPrefill.js`: correspondência entre ficha e
  conta, diferenças e limites. `PlatformBilling.jsx`: leitura da ficha em paralelo com a
  conta, pré-preenchimento, nota de origem, aviso de divergência e bloqueio por limite.
- Só fichas com NIF confirmado sugerem valores ou geram aviso. Falha na leitura da
  ficha não bloqueia: o formulário abre vazio com uma nota.
- "Aplicar valores da ficha" só preenche o formulário; a gravação continua a exigir
  "Guardar dados de faturação". Email, contacto, prazo e campos C4G nunca são alterados
  por essa ação.
- Regressões primeiro: 4 testes falharam antes da alteração e passam depois
  (`PlatformBillingPrefill.test.jsx`, 6 testes). Faturação administrativa: 22 PASS.
- Suite frontend: 980 PASS e 1 falha em `ApplicationPartners.test.jsx` (timeout de 5 s),
  alheia a esta alteração: isolado, o ficheiro passa (16 PASS). Build e lint PASS.
- Não verificado: aspeto visual no browser e comportamento com dados reais no ambiente
  habitual. A divergência só aparece no modal "Preparar faturação"; a página de detalhe
  do ciclo não a mostra.

## Fase 2 — implementação e verificação (12/11/2026)

Consulta, sem escritas. Sem migração: o role das leituras centrais já tem `SELECT`
sobre `billing_account` e `billing_account_version` (migração 027).

- Backend: `GET /api/billing/account`, método `account` em `customerBilling`. Mesma
  autorização das faturas (ORG_ADMIN ou `billing.read`, revalidada antes e depois),
  transação só de leitura, organização vinda do contexto autenticado. Devolve só a
  versão corrente e só denominação, país e identificação fiscal, morada, complemento,
  código postal, localidade, região, email e contacto. Notas, origem e referência
  externas, autor, identificadores e prazo de pagamento não são selecionados.
- Frontend: secção "Dados de faturação" em `/faturacao`, só consulta; não aparece no
  histórico nem no detalhe da fatura. Sem conta, explica que a C4G ainda não a
  configurou. Falha na leitura da conta não esconde as faturas.
- Aviso de divergência: a ficha é lida por `GET /api/organization-directory` (contexto
  já existente). Quem não a pode ler não vê aviso. O aviso lista os campos e o valor
  da ficha, sem ação: a ação de aplicar pertence à Fase 3.
- Prazo de pagamento fica fora da consulta até a pergunta 2 ser respondida.
- Regressões primeiro. Backend focado 12 PASS; frontend de faturação 34 PASS.
- Suite backend: 3132 PASS, 9 SKIP e 1 falha em `outboundRedirectIsolation.test.js`,
  que passa isolado e não toca em faturação. Suite frontend: 983 PASS e o mesmo timeout
  de `ApplicationPartners.test.jsx`. `node --check`, build e lint PASS.
- Não verificado: PostgreSQL real (a consulta SQL só correu contra doubles), browser e
  ambiente habitual. O backend em execução tem de ser reiniciado para servir a rota.

## Verificação visual com API simulada (12/11/2026)

Ecrãs reais servidos pelo Vite, com `api` e `directoryApi` simulados, a 1440 e 390 px.
O harness era temporário e foi removido.

- C4G Admin: formulário pré-preenchido com nota de origem; aviso de divergência com
  valores da conta e da ficha; "Aplicar valores da ficha" altera só os campos
  divergentes e o aviso desaparece; morada acima de 200 caracteres mostra o erro e
  bloqueia o botão de guardar.
- Cliente: secção com os dados, sem controlos; aviso de divergência; estados sem conta
  e de falha de leitura, este com as faturas visíveis. Sem overflow horizontal.
- Corrigido nesta passagem: a 390 px o aviso do modal ficava comprimido ao lado do
  botão; passa a empilhar abaixo de 640 px.
- Continua por verificar: aplicação real com OIDC e PostgreSQL. Este checkout
  (`C4G-PT2030`) não tem o estado privado `.tmp`, pelo que `npm run dev` recusa com
  `LOCAL_DEV_SETUP_REQUIRED`; o instalador não foi executado.

## Critérios de aceitação

- Entidade com ficha completa e sem conta: o modal C4G abre com NIF, morada, código
  postal e localidade da ficha; email e contacto aparecem como sugestões assinaladas.
- Entidade sem ficha completa: o modal abre como hoje, sem erro.
- Entidade com conta: o modal mostra a conta, não a ficha; diferenças geram aviso.
- Valor da ficha acima do limite da conta não é truncado nem gravado sem correção.
- Cliente ORG_ADMIN vê e edita morada, email e contacto; a gravação cria nova versão
  e ciclos anteriores mantêm o snapshot.
- Cliente não consegue alterar NIF, denominação, país fiscal, prazo, referências
  externas ou notas, nem por pedido HTTP direto.
- Membro com `billing.read` sem ser ORG_ADMIN consulta e não altera.
- Membro sem acesso financeiro, outra organização ou membership suspensa: indisponível.
- Notas internas e referências externas nunca saem na projeção do cliente.
- Conflito de revisão entre cliente e C4G: recusa com 409 e dados introduzidos mantidos.
- Repetição com a mesma chave de idempotência não cria segunda versão.
- Alteração feita pelo cliente aparece na timeline do C4G Admin com a origem.
- Carregamento, erro, vazio e troca de organização não mostram dados anteriores.
