# Administração C4G — controlo de faturação e envio de documentos

**Estado:** recomendação de produto e arquitetura  
**Data:** 2026-10-22  
**Âmbito:** administração central C4G; não altera a aplicação nem ativa fornecedores externos

## Pergunta

Como permitir à C4G controlar a faturação das entidades e enviar por email as faturas emitidas, sem transformar a plataforma num programa fiscal, sem expor segredos SMTP e sem confundir emissão, entrega e pagamento?

## Evidência do repositório

- A arquitetura futura coloca contratos, planos e configuração global na base central e reserva o painel de plataforma à C4G.
- O Resend já é a escolha aprovada para email transacional. O envio deve passar por outbox persistente, worker separado, idempotência, retries e webhooks.
- O armazenamento documental aprovado usa R2 privado, versões imutáveis, validação de PDF, análise de malware e downloads autorizados; a integração real R2/scanner continua por concluir.
- O TOConline foi confirmado como sistema de faturação da C4G e deve continuar a ser a fonte fiscal de documentos, numeração, notas de crédito, recibos e saldo fiscal.
- A implementação SMTP existente pertence ao legado UBI e não constitui arquitetura aprovada.
- A fundação local de jobs/outbox existe, mas ainda não tem consumer produtivo Resend nem prova end-to-end com o fornecedor.

## Referências externas relevantes

- A Autoridade Tributária mantém requisitos próprios para programas certificados, arquivo e elementos fiscais como QR e código único do documento. Um PDF carregado na plataforma não pode ser apresentado como uma fatura emitida pela C4G Funding Platform ([AT — regras de faturação](https://info.portaldasfinancas.gov.pt/pt/apoio_ao_contribuinte/Negocios/Faturacao/Regras_de_faturacao/Paginas/default.aspx)).
- Nas relações com entidades públicas, a faturação eletrónica B2G segue o circuito FE-AP quando aplicável; desde 05/01/2026, o Portal das Finanças também permite a emissão e o envio destes documentos para a FE-AP ([FE-AP — comunicação de 20/02/2026](https://www.feap.gov.pt/paginas/DetalheNoticia.aspx?ni=66)).
- O Resend suporta anexos, chaves de idempotência e eventos distintos para envio, entrega, atraso, rejeição, complaint e falha ([anexos](https://resend.com/docs/dashboard/emails/attachments), [idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys), [eventos](https://resend.com/docs/webhooks/event-types)). Os webhooks devem ser verificados criptograficamente e processados de forma idempotente ([verificação de webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests)).
- A OWASP recomenda armazenamento centralizado, mínimo privilégio, rotação, revogação e auditoria de segredos; estes não devem ser expostos nem registados em claro ([OWASP — Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)).

## Recomendação

Criar uma área única **Faturação** no módulo de Administração C4G, composta por duas capacidades separadas:

1. **Controlo de faturação** — registo comercial e operacional dos ciclos, documentos fiscais externos e pagamentos.
2. **Documentos e envio** — associação do PDF fiscal já emitido e envio transacional auditável ao contacto de faturação.

Não criar um motor fiscal, um checkout ou uma caixa genérica de configuração SMTP neste incremento.

### Fronteira de responsabilidade

| Responsabilidade | Fonte de verdade |
| --- | --- |
| Contrato, periodicidade, preço acordado e entidade cliente | C4G Funding Platform, base central |
| Fatura/nota de crédito/recibo, numeração e validade fiscal | TOConline ou circuito B2G aplicável |
| PDF privado e respetiva versão | Metadados centrais + R2 privado |
| Intenção e histórico de envio | Outbox/eventos da C4G |
| Aceitação e entrega do email | Resend + webhooks persistidos |
| Pagamento contabilístico/fiscal | TOConline; registo manual apenas até existir sincronização |
| Acesso à aplicação | Membership central; nunca o estado isolado de uma fatura |

## Modelo funcional

### 1. Conta de faturação por entidade

Manter uma conta central versionada, distinta da ficha institucional geral:

- denominação legal, NIF, país e morada de faturação;
- email principal e contactos adicionais de faturação;
- cliente externo TOConline, quando existir;
- condições de pagamento e notas administrativas;
- origem, autor e datas de cada alteração.

Alterar os dados atuais não deve reescrever o snapshot associado a documentos já emitidos.

### 2. Ciclo de faturação

Não modelar apenas um campo `mês`. Usar `period_start` e `period_end`, porque haverá contratos mensais, anuais, trimestrais ou períodos irregulares. Cada ciclo deve ter:

- entidade e contrato/subscrição;
- período de serviço;
- data prevista de emissão e vencimento;
- montante em unidade monetária exata e moeda;
- estado do ciclo;
- notas e referências operacionais;
- autor, timestamps e histórico de transições.

Estados mínimos recomendados: `DRAFT`, `READY_TO_ISSUE`, `ISSUED`, `CREDITED`, `CANCELLED`. `OVERDUE` deve ser derivado da data de vencimento e do saldo, não gravado como um booleano independente.

### 3. Documento fiscal externo

Depois de emitir no TOConline/FE-AP, a C4G regista:

- tipo e número do documento;
- fornecedor/sistema de origem;
- identificador e referência externos;
- datas de emissão e vencimento;
- total, imposto, total pago e saldo;
- estado fiscal e ligação ao ciclo;
- PDF fiscal correspondente.

O ecrã deve chamar-lhe **Documento fiscal externo** ou **Fatura emitida no TOConline**, nunca sugerir que a plataforma o emitiu.

### 4. Pagamentos

`Pago` não deve ser uma checkbox destrutiva. Criar registos de pagamento/alocação com montante, data, método, referência externa, origem e autor. Isto permite pagamentos parciais, estornos e reconciliação posterior.

Estados apresentados: `POR_PAGAR`, `PARCIALMENTE_PAGO`, `PAGO`, `ESTORNADO`; `EM_ATRASO` é calculado. Até existir sincronização, mostrar sempre a origem **Registo manual C4G** e exigir confirmação explícita.

## Documentos

- Aceitar apenas PDF para este fluxo, com limite de tamanho configurado.
- Guardar em R2 privado através do `ObjectStoragePort`; nunca criar URL pública permanente.
- Aplicar a pipeline aprovada: validação real do tipo, checksum, análise de malware e estado `AVAILABLE` apenas após resultado limpo.
- Congelar a versão anexada ao envio. Substituir um PDF cria nova versão e não altera o conteúdo de um envio anterior.
- Disponibilizar download por autorização e URL assinada de curta duração.
- Reter metadados, hash, associação ao documento, ator e eventos de acesso conforme política a aprovar.

## Email: configuração e envio

### Não expor configuração SMTP genérica no painel

A plataforma já escolheu Resend. A chave de API e o segredo de webhook devem ficar no cofre/configuração do ambiente, acessíveis apenas ao worker/API que necessite deles. Não devem existir campos de UI para host, porta, utilizador ou password SMTP, nem valores recuperáveis pela API.

O painel pode apresentar configuração funcional não secreta:

- nome do remetente;
- endereço `From` de domínio verificado;
- `Reply-To`;
- estado de verificação do domínio e saúde do fornecedor;
- template ativo e respetiva versão;
- último teste técnico, sem revelar segredos.

Se surgir no futuro uma exigência contratual de SMTP próprio, deve ser um adapter de infraestrutura aprovado, com `credential_reference` opaca para um cofre, TLS obrigatório, destinos permitidos, rotação e auditoria. Não uma ligação arbitrária criada por qualquer administrador.

### Percurso de envio

1. O administrador abre o documento emitido e escolhe **Preparar envio**.
2. A API valida permissões, estado fiscal, PDF `AVAILABLE`, destinatário e versão do template.
3. O ecrã mostra uma pré-visualização completa: destinatários, assunto, corpo e nome/hash do anexo.
4. A confirmação cria, na mesma transação, um pedido imutável de entrega e uma mensagem de outbox.
5. O worker lê o PDF privado, envia-o como anexo pelo Resend e usa uma chave de idempotência estável.
6. A aplicação persiste o identificador do fornecedor e processa webhooks com assinatura verificada e deduplicação.
7. Reenvios são novas tentativas explícitas, com motivo e nova identidade de entrega; nunca um clique silenciosamente repetível.

Estados de entrega separados do documento e do pagamento:

`QUEUED`, `PROCESSING`, `SENT`, `DELIVERED`, `DELAYED`, `BOUNCED`, `COMPLAINED`, `SUPPRESSED`, `FAILED`.

`SENT` significa que o fornecedor aceitou o pedido; não prova entrega, leitura, emissão fiscal ou pagamento.

### Conteúdo e privacidade

- Envio transacional, separado de newsletters e marketing.
- Um destinatário principal e CCs explícitos; sem BCC oculta por defeito.
- Guardar snapshot mínimo do destinatário, assunto, template, documento/versão e eventos; evitar duplicar o corpo e PII sem necessidade.
- Templates versionados. Uma alteração posterior não pode modificar a evidência do email já enviado.
- Política de retenção e base jurídica para documentos, contactos e eventos devem ser aprovadas antes de produção.

## Experiência no Administrador C4G

### Lista “Faturação”

Filtros por entidade, período, estado fiscal, pagamento e entrega. Colunas principais:

- Entidade;
- Período;
- Nº do documento;
- Emissão e vencimento;
- Total, pago e saldo;
- Estado fiscal;
- Estado de pagamento;
- Estado do último envio.

Indicadores: emitido no período, recebido, por receber e vencido. Os totais devem resultar dos documentos/registos existentes e indicar a moeda; nunca misturar moedas num único total sem conversão explícita.

### Detalhe

Uma timeline reúne, sem colapsar estados diferentes:

- criação/alteração do ciclo;
- registo do documento fiscal;
- upload e validação do PDF;
- preparações, envios e eventos de entrega;
- pagamentos/alocações, correções e notas de crédito;
- todas as ações administrativas auditáveis.

Ações: registar documento, anexar PDF, pré-visualizar e enviar, reenviar com motivo, registar pagamento parcial/total e registar correção/anulação externa.

### Configuração

Separar:

- **Configuração comercial:** condições, periodicidade e contactos;
- **Identidade de envio:** remetente, reply-to, template e saúde/verificação;
- **Infraestrutura:** segredos e fornecedor, fora da UI funcional.

## Autorizações

Capacidades centrais recomendadas:

- `platform.billing.read`;
- `platform.billing.manage`;
- `platform.billing.payment.record`;
- `platform.billing.delivery.send`;
- `platform.billing.settings.manage`.

Todas exigem contexto central C4G. Administradores das entidades não recebem acesso neste primeiro recorte. Mesmo que inicialmente a mesma pessoa acumule permissões, os códigos separados preservam futura segregação de funções.

## Entidades de dados sugeridas

- `billing_account` e `billing_account_version`;
- `billing_cycle`;
- `fiscal_document_reference`;
- `billing_document_version` com referência ao objeto privado;
- `payment_record` e `payment_allocation`;
- `invoice_delivery` e `invoice_delivery_recipient`;
- `email_template_version`;
- reutilização de `email_outbox_message` e eventos do fornecedor;
- eventos de auditoria para todas as mutações relevantes.

Estas entidades pertencem à base central. Referenciam `organization_id`, mas não são copiadas para bases de cliente.

## Fases recomendadas

### Fase A — controlo manual seguro

- Conta de faturação, ciclos, referências de documentos externos e pagamentos manuais.
- Dashboard e timeline.
- Sem emissão fiscal, PDF ou envio real.

### Fase B — documento privado e envio transacional

- PDF via R2/scanner reais.
- Pré-visualização, confirmação, outbox/worker Resend, anexos, webhooks e histórico.
- Requer domínio de envio verificado, segredos por ambiente e testes end-to-end.

### Fase C — reconciliação TOConline só de leitura

- Importar/reconciliar documentos, PDFs, recibos e saldo sem criar documentos fiscais.
- Exibir divergências; não sobrescrever silenciosamente registos manuais.

### Fase D — automação posterior

- Eventual emissão controlada, lembretes e cobrança apenas após contrato técnico, fiscal e operacional separado.
- Municípios continuam a respeitar o percurso B2G/FE-AP aplicável.

## Opções rejeitadas

| Opção | Motivo |
| --- | --- |
| Campos `Emitido` e `Pago` como booleanos | Perdem datas, origem, valores parciais, estornos, correções e auditoria. |
| Gerar “faturas” PDF dentro da aplicação | Confunde documento de controlo com documento fiscal e duplica o sistema certificado. |
| Configurar qualquer SMTP no painel | Expõe segredos e aumenta risco, suporte, rotação e abuso; contradiz a arquitetura Resend aprovada. |
| Enviar diretamente no pedido HTTP | Cria timeouts, duplicados e resultados ambíguos; não suporta retries/reconciliação robustos. |
| Marcar `Pago` quando o email é entregue | Entrega, pagamento e emissão são ciclos independentes. |
| Suspender automaticamente acesso por atraso | O acesso é governado pela membership e pela decisão contratual C4G, não por um único estado financeiro. |

## Riscos e decisões ainda necessárias

1. Política de IVA, retenção, vencimentos e arredondamentos continua no sistema fiscal; confirmar com contabilidade o que deve ser apenas exibido.
2. Definir retenção dos PDFs e evidência de envio, incluindo obrigações contabilísticas e RGPD.
3. Confirmar destinatário principal e regras de CC por entidade.
4. Definir se o registo manual de pagamento exige dupla confirmação para montantes elevados.
5. Confirmar volumes e tamanho máximo dos anexos antes do desenho operacional.
6. Validar o contrato real da API TOConline antes da Fase C.

## Conclusão

A funcionalidade deve avançar no Administrador C4G, mas como **controlo central de faturação + entrega de documentos fiscais externos**. O MVP deve representar períodos, valores, saldo, emissão, pagamentos e entrega como registos auditáveis e independentes. O TOConline/FE-AP permanece responsável pela emissão fiscal; R2 guarda os PDFs privados; Resend envia por outbox/worker. A UI pode gerir identidade e templates de email, mas nunca credenciais SMTP/API.
