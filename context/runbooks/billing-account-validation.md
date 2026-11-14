# Pedido de validação dos dados de faturação

## Funcionalidade

No Admin C4G, **Faturação → Fichas de faturação** permite escolher a entidade,
editar a conta e guardar. **Rever dados e pedir validação** apresenta a versão
já guardada; **Pedir validação** regista o pedido e os emails dos administradores
ativos, atomicamente. Não inclui alterações ainda não guardadas no formulário.

Na entidade, **Faturação → Confirmação dos dados de faturação** permite ao
ORG_ADMIN rever e confirmar os dados. A confirmação guarda autor, data e versão.
Quem só tem `billing.read` continua a consultar faturação, sem poder confirmar.
A ligação do email não dá permissões nem confirma dados. Se a organização
selecionada for diferente, a página pede que o utilizador selecione a correta.

Uma alteração posterior da conta torna a confirmação desatualizada. A C4G pode
pedir a validação da nova versão. Pedidos e confirmações anteriores são imutáveis.

## Instalação explícita

Não aplicada a Dev, staging ou produção neste trabalho. A Central 054 é aditiva e
irreversível; exige Central 053 e um preflight válido. Efetuar a cópia de segurança
prevista para o ambiente antes de instalar. Não usar SQL avulso para contornar o
manifesto. A variante com os dois logins de staging foi ensaiada e usa a flag
`C4G_STAGING_CENTRAL_RUNTIME_LOGINS=admitted-v1` já prevista para esse ambiente.
Variantes adicionais de schema precisam de admissão própria; o pacote
não aceita silenciosamente outras extensões da Central.

1. Disponibilizar `CENTRAL_MIGRATION_DATABASE_URL` ao processo de migração por meio
   do gestor de segredos do ambiente. Nunca imprimir a ligação.
2. Plano só de leitura: `node backend/scripts/installBillingValidation.js`.
3. Instalação: `node backend/scripts/installBillingValidation.js --apply`.
   Repetir é um no-op. O instalador confirma o preflight após a migração.
4. Configurar um login dedicado, sem superuser, criação de bases/roles, replicação
   ou bypass RLS. Conceder apenas CONNECT à Central e membership no role NOLOGIN
   `c4g_billing_validation_worker`, criado pela migração. Não reutilizar os logins
   da API, do coordenador ou de outro worker. O role tem apenas as duas funções
   fechadas de claim/finish; não lê nem escreve diretamente as tabelas.
5. No processo separado de email, configurar `BILLING_VALIDATION_DATABASE_URL`,
   `RESEND_API_KEY`, `BILLING_EMAIL_FROM` e `PUBLIC_APP_URL` (origem HTTPS, sem path).
   Arrancar com `npm --prefix backend run worker:billing-validation` e supervisionar
   o processo, incluindo reinício e SIGTERM. As credenciais ficam só no servidor.
6. Na API, configurar `BILLING_VALIDATION_RUNTIME=central` e reiniciar.
   A readiness exige a Central 054; sem a flag, a capacidade fica desativada.

A desativação da flag oculta o fluxo novo, mantendo a edição da ficha. Parar o
worker suspende envios; pedidos e confirmações não são eliminados.

## Entrega e operação

- Cada destinatário tem uma entrega persistida e uma identidade fixa. O worker
  obtém uma lease de dois minutos e faz o envio fora da transação HTTP.
- Antes de reclamar a entrega, revalida o administrador, a entidade e a versão.
  Revogação, email alterado depois da primeira tentativa, versão substituída ou
  pedido confirmado cancelam o envio pendente.
- O assunto/texto não contêm NIF, morada ou notas internas. A denominação vem da
  versão imutável da ficha; a ligação encaminha para a área autenticada.
- O worker tenta novamente após cinco minutos, no máximo oito tentativas e dentro
  de 20 horas da primeira. Mantém a chave de idempotência do fornecedor.
  Este limite fica abaixo da [janela de 24 horas do Resend](https://resend.com/changelog/idempotency-keys).
- `ACCEPTED` significa que o fornecedor aceitou o email; não prova entrega na caixa
  de correio. Só uma ação autenticada produz `CONFIRMED`. Não há webhooks de entrega
  neste incremento.
- Uma entrega `FAILED` permanece visível à C4G. Não apagar a linha nem gerar outra
  chave para repetir um envio ambíguo; verificar o fornecedor antes de qualquer
  recuperação operacional. O pedido continua disponível na plataforma.
- Não alterar remetente/origem durante retries pendentes: o fornecedor exige o
  mesmo corpo para a mesma chave. Após oito falhas, a recuperação é operacional;
  não existe botão de reenvio neste incremento.

## Validação

`node test/integration/billing-account-validation/gate.cjs` cria uma Central
PostgreSQL 18 descartável em `.tmp`, instala o pacote registado e testa permissões,
isolamento, pedidos concorrentes/idempotência, confirmação, conflito de versão,
leases, retry e revogação antes do email. Não envia emails reais.

`--calibrate` mede assinaturas sem registar a migração; reservado ao desenvolvimento
do pacote. `--staging` reproduz os dois logins de staging e a admissão correspondente.
Os dados são sintéticos e o cluster é parado no final, preservando a evidência.

Testes adicionais: `backend/test/billingValidation.test.js` e
`frontend/src/components/BillingValidationPanel.test.jsx`. A entrega real e a sessão
OIDC no ambiente de destino exigem uma verificação após ativação explícita.
