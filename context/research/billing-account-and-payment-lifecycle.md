# Faturação por cliente, pagamentos e IBAN

Data: 22/10/2026. Estado: recomendação para decisão; não constitui arquitetura aprovada nem autorização de implementação.

## Decisão analisada

Definir onde pertencem os dados de faturação e o IBAN, como representar o percurso entre serviço contratado, documento faturado e pagamento e como integrar a plataforma com o TOConline, sem transformar a C4G Funding Platform num programa fiscal próprio nem misturar dados comerciais com a ficha institucional geral.

## Contexto confirmado da aplicação

- A arquitetura futura coloca contratos, planos, organizações e administração C4G na base central. Os dados privados de candidaturas permanecem nas bases dos clientes.
- A [ficha completa da entidade](../features/complete-entity-profile.md) é a fonte canónica da identidade e dos contactos institucionais e exclui expressamente faturação, contratos e campos comerciais.
- A proposta de [administração de clientes](../features/platform-customer-administration.md) separa acompanhamento comercial, emissão fiscal e cobrança.
- Não existe no código ativo um domínio de faturação, faturas, pagamentos ou IBAN. “Billing / Processado / Em pagamento” é uma referência funcional, não um contrato já existente.
- Em 22/10/2026 foi confirmado que o software de faturação usado pela C4G é o **TOConline**.

## Factos confirmados sobre o TOConline

- O TOConline é software de faturação eletrónica certificado pela Autoridade Tributária e funciona como origem fiscal externa à plataforma C4G.
- Disponibiliza uma API OAuth 2.0 com recursos para clientes, documentos de venda, recibos, contas bancárias, PDF e comunicação de documentos.
- A API permite consultar e criar clientes, incluindo NIF, denominação, morada, email, telefone e contacto. O manual indica que nome e NIF deixam de poder ser alterados depois de existirem documentos associados.
- Os documentos de venda expõem total pendente (`pending_total`), vencimento, cliente, referência externa, conta bancária e PDF. A API suporta fatura, fatura simplificada e fatura-recibo.
- O endpoint atual de criação de documentos de venda finaliza automaticamente o documento. Um documento finalizado não pode ser atualizado ou eliminado. Este comportamento torna inadequada uma emissão automática na primeira fase.
- Os recibos podem liquidar parcialmente um documento ou abranger vários documentos. Os meios de pagamento incluem transferência bancária, débito direto autorizado e referência Multibanco, entre outros.
- No documento de venda, `bank_account_id` identifica uma conta da empresa emissora para receber fundos. Não representa o IBAN do cliente.
- No débito direto, o TOConline configura no cliente a autorização, data de autorização, IBAN do devedor, conta credora e série documental.
- A documentação oficial consultada não identifica webhooks, ambiente sandbox nem garantias de limites de chamadas. Estes pontos têm de ser confirmados com o fornecedor; a ausência na documentação consultada não prova que não existam.

## Avaliação técnica aprofundada da API

### Cobertura real e qualidade do contrato publicado

A documentação pública oferece matéria suficiente para uma integração, mas ainda não constitui um contrato executável seguro sem uma prova contra a empresa TOConline da C4G:

- o índice oficial publica uma especificação OpenAPI 3.0.3 com 68 paths e recursos para empresa, vendas, compras e tabelas auxiliares;
- a especificação mistura endpoints correntes `/api/v1/...`, endpoints não versionados `/api/...` e endpoints classificados como “Versões Anteriores”;
- clientes, moradas, contactos, serviços, contas e séries continuam em rotas não versionadas, enquanto os fluxos novos de documentos e recibos usam sobretudo `/api/v1`;
- os novos endpoints de documentos usam payload plano `application/json`, mas várias operações auxiliares e antigas usam envelope JSON:API e `application/vnd.api+json`;
- os `GET /api/v1/commercial_sales_documents` e `GET /api/v1/commercial_sales_receipts` têm respostas `200` sem schema publicado na especificação;
- a documentação contém divergências entre texto, exemplo e OpenAPI, incluindo método HTTP para comunicação à AT, path de envio de email e o parâmetro `finalize` mostrado num exemplo apesar de o texto afirmar que a criação v1 finaliza sempre;
- não existe no contrato publicado uma política de versões/depreciação, catálogo completo de erros, limite de página, limite de chamadas, `Retry-After`, webhook ou chave de idempotência.

Consequência: não gerar automaticamente um cliente SDK e assumir que está correto. O adaptador C4G deve ser pequeno, escrito sobre uma allowlist de operações verificadas e protegido por testes de contrato com respostas reais sanitizadas. A coleção Postman entregue com as credenciais da empresa é evidência adicional necessária, porque pode conter detalhes operacionais não refletidos no OpenAPI público.

### Autenticação e operação contínua

O acesso usa OAuth 2.0 Authorization Code com o único scope documentado `commercial`. As credenciais e os URLs OAuth/API são emitidos para a empresa TOConline, por um administrador, através de um link temporário de 72 horas. O `access_token` dura quatro horas e a documentação detalhada indica um `refresh_token` válido por oito horas, rodado na renovação.

Implicações:

- o conector é uma ligação ao **emitente C4G no TOConline**, não uma credencial por cliente faturado;
- a C4G deve guardar `api_base_url` e `oauth_base_url` como configuração validada do fornecedor, nunca aceitar um URL arbitrário enviado pelo frontend;
- `client_secret`, `access_token` e `refresh_token` ficam num secret manager; a base central conserva apenas referência opaca, estado, expiração e auditoria;
- a renovação deve ser single-flight e persistir atomicamente o novo par de tokens, para dois workers não invalidarem a sessão um do outro;
- renovar antes do limite e marcar `REAUTHORIZATION_REQUIRED` após falha definitiva. Uma indisponibilidade superior à janela do refresh pode exigir intervenção humana;
- o scope `commercial` é amplo e não há scope público apenas de leitura. A fase 1 deve impor read-only na própria allowlist do adaptador, sem endpoint genérico/proxy e sem métodos `POST`, `PATCH` ou `DELETE` alcançáveis pelo job.

A documentação afirma ainda que escritas exigem uma licença de Gestão Comercial ativa; os `GET` permanecem autorizados quando essa licença expira. Isto favorece uma primeira integração exclusivamente de leitura, mas o estado da licença deve ser tratado como dependência operacional antes de qualquer fase de escrita.

### Modelo de leitura necessário para a C4G

| Necessidade C4G | Origem TOConline a validar | Regra local |
| --- | --- | --- |
| Ligação do cliente | `GET /api/customers`, pesquisa por NIF e confirmação por `id` | NIF apenas encontra candidatos; associação final é explícita e guarda o ID externo como texto. |
| Identidade de faturação | cliente + `main_address`/addresses + contacts | Não substituir silenciosamente a ficha institucional; guardar projeção e divergência. |
| Documento fiscal | `GET /api/v1/commercial_sales_documents` ou leitura anterior suportada pelo fornecedor | Guardar tipo, número, datas, totais, saldo, estado, cliente e relações; TOConline mantém autoridade. |
| Notas de crédito/débito | mesma coleção, tipos `NC`/`ND`, com relação ao documento pai | Preservar `parent_documents_ids`/referência e calcular o efeito no saldo sem editar o original. |
| Recebimentos | `GET /api/v1/commercial_sales_receipts` e linhas de recibo | Uma linha aloca um valor a um documento; suportar pagamentos parciais e um recibo para vários documentos. |
| Fatura-recibo | documento `FR` e recibo criado automaticamente | Importar ambos e relacioná-los sem duplicar o pagamento. |
| PDF fiscal | `GET /api/url_for_print/{id}` para documento finalizado | Obter via backend; não expor nem registar links públicos/capability URLs sem conhecer validade. |
| Conta credora | conta referenciada por documento/série | Mostrar IBAN mascarado; não importar indiscriminadamente todas as contas bancárias disponíveis. |
| Séries e fiscalidade | séries, serviços, taxas, moedas e unidades | Catálogos necessários apenas numa futura emissão, nunca recalcular um documento já emitido. |

O cliente TOConline admite várias moradas e contactos. Criar um cliente gera uma morada principal vazia, que é atualizada numa operação separada. Uma futura escrita de dados de cliente será, portanto, uma saga multi-passo com recuperação de falhas; não deve ser apresentada como atualização atómica da ficha C4G.

### Estados que a API consegue — e não consegue — provar

O TOConline permite provar documento emitido, saldo pendente, vencimento, recibos e retificações. Com esses dados, a C4G pode apresentar **Faturado**, **Por pagar**, **Parcialmente pago**, **Pago**, **Em atraso**, **Anulado** e **Creditado**, depois de confirmar os códigos reais no spike.

O TOConline, por si só, não documenta uma operação financeira pendente entre a ordem e o recibo. Assim, **Em pagamento** não deve ser inferido de `payment_mechanism`, de envio por email ou de uma fatura com IBAN. Esse estado só fica disponível quando existir integração com um PSP, referência de pagamento, débito direto/banco ou outro sistema que reporte uma tentativa em curso.

### Idempotência e risco de emissão duplicada

`external_reference` existe nos documentos, mas a documentação não declara unicidade nem uma chave HTTP de idempotência. Logo, a referência externa ajuda a reconciliar; não impede, por si só, duas faturas.

Numa futura emissão:

- criar uma obrigação local única por `billing_cycle_id` e bloquear concorrência antes de chamar o fornecedor;
- usar uma referência externa estável e um fingerprint dos campos aprovados;
- não repetir automaticamente um `POST` após timeout ou perda de resposta, porque o TOConline pode ter finalizado o documento;
- perante resultado ambíguo, pesquisar por referência, cliente, data e valores e encaminhar colisões/ausência para reconciliação humana;
- só marcar sucesso depois de persistir o ID e número devolvidos/confirmados pelo TOConline;
- nunca usar a versão anterior, que permite rascunhos, apenas para contornar a finalização v1 sem confirmação escrita do fornecedor.

### Estratégia de sincronização

Sem webhook público documentado, o worker deve fazer polling conservador:

1. sincronização inicial paginada e limitada ao horizonte histórico aprovado;
2. leitura incremental com janela temporal sobreposta, se os filtros reais o permitirem;
3. reconsulta frequente de documentos com saldo pendente;
4. reconsulta menos frequente de documentos liquidados para detetar anulação, nota de crédito ou recibo revertido;
5. reconciliação diária de contagens e totais por cliente/período;
6. cursor só avança após persistência transacional; páginas repetidas são idempotentes.

Os exemplos devolvem timestamps sem timezone e a especificação não documenta a navegação integral entre páginas. Por isso, o cursor não deve depender exclusivamente de `updated_at`, nem assumir `page[number]`, até a prova técnica confirmar formato, ordenação, máximo de página e timezone. Para os oito clientes iniciais, uma importação limitada e reconciliação integral será mais segura do que otimização prematura.

### PDFs, email e comunicação à AT

- O PDF só está disponível para documento finalizado. Deve ser servido pelo backend após autorização C4G ou copiado para R2 privado com proveniência e retenção aprovadas; nunca entregar ao frontend uma capability URL não avaliada.
- O TOConline consegue enviar documentos por email, mas a resposta documentada apenas confirma sucesso imediato e destinatários. Sem idempotência ou webhook de entrega documentados, esta ação fica fora da fase 1.
- O endpoint de comunicação à AT pede utilizador e palavra-passe do Portal das Finanças no payload. A C4G não deve integrar esse endpoint nem custodiar essas credenciais; a comunicação permanece no TOConline/contabilidade.

## Riscos e perguntas que a documentação pública não resolve

Antes de implementar, é necessário confirmar com suporte ou numa empresa de teste:

1. qual endpoint de leitura de documentos/recibos é suportado para novas integrações e qual a política de retirada da versão anterior;
2. schemas reais dos `GET /api/v1`, filtros aceites, ordenação, paginação, máximo de página e timezone;
3. catálogo de estados para documento, recibo, anulação e comunicação, incluindo diferenças entre `FT`, `FR`, `NC` e `ND`;
4. limites de chamadas, comportamento de `429/5xx`, janelas de manutenção e contactos de suporte;
5. existência de webhooks, sandbox/empresa de demonstração e credenciais read-only;
6. validade/expiração dos URLs de PDF e se podem ser usados fora de uma sessão autenticada;
7. comportamento de `external_reference` e procedimento recomendado para resultado ambíguo de criação;
8. se a coleção Postman fornecida à C4G diverge da especificação pública e qual delas prevalece.

## Conclusões

### 1. O TOConline deve ser a fonte de verdade fiscal

A C4G Funding Platform deve ser a fonte de verdade do contrato/subscrição e da experiência do cliente. O TOConline deve continuar a ser a fonte de verdade de faturas, notas de crédito, recibos, numeração fiscal, PDFs e saldo fiscal pendente.

Quando houver divergência:

- o contrato e as condições comerciais aprovadas permanecem sob autoridade da C4G;
- o estado e os valores de um documento fiscal emitido permanecem sob autoridade do TOConline;
- uma correção fiscal deve ser efetuada no TOConline e depois sincronizada, nunca por edição local do documento.

### 2. Não adicionar um IBAN genérico à ficha institucional

“IBAN da entidade” é ambíguo e pode representar três coisas:

1. **Conta da C4G para receber transferências.** É uma conta da empresa emissora no TOConline, selecionada por `bank_account_id`; não é atributo de cada cliente.
2. **Conta do cliente para débito direto.** Só deve existir no contexto de uma autorização/mandato, com finalidade, titular, referência, estado, datas e prova.
3. **Conta do cliente para reembolsos ou pagamentos feitos pela C4G.** Deve ser uma conta de pagamento autónoma, com titular e finalidade explícitos.

A ficha da entidade pode mostrar apenas um resumo — por exemplo, **Faturação configurada**, contacto de faturação e método de pagamento — com ligação para uma secção própria. O IBAN completo não deve aparecer na ficha geral.

Para transferência bancária, a plataforma deve obter ou referenciar a conta credora configurada no TOConline. Para débito direto, deve preferir que o TOConline conserve o IBAN do devedor; a C4G só deve espelhar estado e metadados mascarados, salvo necessidade técnica e jurídica posteriormente aprovada.

### 3. Criar uma conta de faturação central por organização

No primeiro recorte, cada `organization` deve ter no máximo uma conta de faturação ativa, versionada e com histórico. Deve conter:

- denominação, NIF, morada e email de faturação;
- contacto operacional de faturação, sem criar conta ou acesso;
- referência de encomenda/compromisso e notas administrativas opcionais;
- condições de pagamento, periodicidade, moeda e método acordado;
- estado de configuração e revisão otimista;
- ligação validada ao cliente TOConline (`toconline_customer_id`) e data/estado da última sincronização.

O NIF ajuda na reconciliação inicial, mas não deve substituir o identificador externo estável nem permitir associações automáticas perante duplicados. Estes dados pertencem à base central C4G e não devem dar à Administração C4G acesso às candidaturas privadas do cliente.

### 4. Separar quatro ciclos de vida

Um único campo `status = PROCESSADO|EM_PAGAMENTO|PAGO` perde informação. O modelo deve separar:

| Dimensão | Estados mínimos recomendados | Observação |
| --- | --- | --- |
| Contrato/subscrição | `DRAFT`, `ACTIVE`, `SUSPENDED`, `ENDED` | “Em atraso” não é um estado contratual por si só. |
| Documento fiscal | `ISSUED`, `CREDITED`, `CANCELLED` | O TOConline é a autoridade; correções são novos documentos fiscais. |
| Entrega | `PENDING`, `SENT`, `FAILED` | Envio de email não significa pagamento. |
| Cobrança/pagamento | `PENDING`, `PARTIALLY_PAID`, `PAID`, `REVERSED`; `PROCESSING` apenas com fonte externa adequada | Um recibo pode liquidar parcialmente ou vários documentos; TOConline não prova, por si só, uma tentativa em curso. |

Na interface, estes estados podem ser resumidos em **A faturar**, **Faturado**, **Por pagar**, **Em pagamento**, **Pago** e **Em atraso**:

- **Por pagar**: documento emitido com `pending_total > 0` e sem operação de pagamento em curso;
- **Em pagamento**: só quando um futuro PSP/banco/débito direto confirmar uma operação iniciada; não é derivável apenas do TOConline;
- **Parcialmente pago**: total pendente superior a zero e inferior ao total do documento;
- **Pago**: `pending_total = 0`, confirmado por sincronização com o TOConline;
- **Em atraso**: vencimento ultrapassado e `pending_total > 0`, calculado e não gravado como verdade independente.

### 5. Usar um adaptador TOConline e sincronização reconciliável

O backend/worker deve encapsular o fornecedor atrás de um adaptador `TOCONLINE`, sem expor uma chamada genérica à API. A projeção local mínima deve guardar:

- `organization_id`, `toconline_customer_id` como texto e estado da associação validada;
- identificador, tipo, série/número, referência externa, emissão, vencimento, moeda, totais e `pending_total` do documento;
- relações com documentos retificativos e identificador do cliente/emitente na origem;
- referência privada ao PDF proveniente da origem, nunca o URL público em logs;
- recibos, estado/anulação e alocações de cada recibo aos documentos;
- payload bruto mínimo/versionado ou hash de proveniência suficiente para investigar mudanças de contrato;
- cursor/janela de sincronização, instante, resultado, contagens, tentativas e erro sanitizado.

Como não foram encontrados webhooks documentados, a primeira implementação deve usar reconciliação periódica por worker, com paginação verificada, janelas de datas sobrepostas, repetição com backoff e operações idempotentes. Cada execução deve voltar a confirmar documentos ainda pendentes e preservar histórico suficiente para auditoria. Um erro de parsing ou campo desconhecido coloca a execução em falha observável; não deve converter silenciosamente o documento para zero, pago ou inexistente.

Se no futuro a C4G criar documentos no TOConline, deve usar uma referência externa estável do ciclo de faturação para apoiar a reconciliação, sem assumir que ela impede duplicação. Antes de escrever, a aplicação deve apresentar uma pré-visualização explícita e validar cliente, série, produto/serviço, IVA, retenções, vencimento e conta bancária. A emissão nunca deve ser silenciosa, porque o endpoint atual finaliza o documento e não publica uma chave de idempotência.

### 6. Proteger credenciais, IBAN e dados fiscais

- Tokens OAuth de acesso e renovação pertencem exclusivamente ao backend/worker, através de referência a secret manager; nunca ao frontend, logs ou repositório. A rotação deve ser atómica e single-flight.
- As credenciais da API devem ser obtidas pelo administrador da empresa no TOConline e introduzidas por um canal seguro. Não devem ser enviadas em chat nem registadas em documentação.
- A C4G não deve recolher nem guardar utilizador/senha do Portal das Finanças para comunicar documentos à AT. Essa operação deve permanecer no TOConline/contabilidade, salvo projeto de segurança autónomo e aprovado.
- Mostrar IBAN mascarado por defeito e não o incluir em pesquisa global, métricas, eventos genéricos ou exports não específicos.
- Validar o checksum do IBAN não comprova titularidade. Alterações a contas de pagamento ou mandatos exigem autenticação recente, confirmação independente e auditoria sem copiar o IBAN para o evento.
- Não guardar dados de cartão. Uma futura cobrança por cartão deve usar um prestador de pagamentos e conservar apenas identificadores/tokens autorizados.

## Opções viáveis

| Opção | Benefício | Custo/risco | Avaliação |
| --- | --- | --- | --- |
| Acrescentar `iban` à ficha institucional | Implementação rápida | Finalidade ambígua, exposição excessiva e ausência de mandato/histórico | Não recomendada |
| Registo manual de referências TOConline | Entrega valor sem credenciais de integração | Reconciliação e erros manuais | Transição aceitável |
| Conta de faturação + sincronização TOConline só de leitura | Documentos, PDFs, recibos e saldos consistentes com a origem fiscal | Exige OAuth, mapeamento, worker e validação do contrato real | **Recomendada após spike read-only** |
| Criação controlada de faturas pela API TOConline | Reduz trabalho administrativo | Endpoint finaliza documentos e não documenta idempotência; exige reconciliação de resultados ambíguos | Fase posterior, após paridade de leitura |
| Motor fiscal nativo | Controlo integral | Certificação, ATCUD, comunicação AT, arquivo e risco operacional elevados | Não recomendado |

## Matriz de acesso recomendada

| Capacidade | Administração C4G de faturação | Administrador da entidade | Outros utilizadores |
| --- | --- | --- | --- |
| Ver dados de faturação próprios | Sim, para clientes autorizados | Sim, apenas própria entidade | Não por defeito |
| Editar contacto/morada de faturação | Sim | Propor/editar conforme política a confirmar | Não |
| Alterar NIF faturado, condições, preço ou contrato | Sim, com auditoria | Solicitar correção | Não |
| Ver documentos, PDF e estado de pagamento | Sim | Sim, apenas própria entidade | Permissão específica futura |
| Associar organização a cliente TOConline | Sim, com validação explícita | Não | Não |
| Emitir/corrigir documento fiscal | No TOConline; integração futura com permissão específica | Não | Não |
| Registar/reconciliar pagamento | No TOConline; sincronização C4G | Não | Não |
| Ver/alterar IBAN integral ou mandato | Permissão financeira específica | Apenas percurso próprio e confirmação | Não |

As permissões devem ser explícitas, não inferidas apenas pelo nome do perfil. Atraso de pagamento não suspende automaticamente a organização, memberships ou tenant. Tolerância, suspensão contratual e retenção precisam de política separada e auditada.

## Recorte funcional recomendado

### Fase 1 — projeção de leitura

- ligação única ao emitente C4G no TOConline, com estado `CONNECTED`, `DEGRADED` ou `REAUTHORIZATION_REQUIRED` e segredos externos à base;
- cartão **Dados de faturação** e ligação explícita ao cliente TOConline;
- cartão **Subscrição/contrato**, mantido pela C4G;
- resumo de saldo faturado, pago, por pagar e vencido;
- lista de documentos TOConline com tipo, número, emissão, vencimento, total, saldo, retificações e PDF original;
- recibos e respetivas alocações;
- sincronização periódica apenas por endpoints GET explicitamente autorizados e reconciliação manual auditada de exceções;
- vista da entidade limitada aos seus próprios dados e documentos.

Antes de ligar todas as entidades existentes, deve ser feito um spike técnico e depois um piloto com uma entidade real. O spike deve comparar a coleção Postman fornecida à C4G, o OpenAPI público e as respostas efetivas dos endpoints de leitura; deve confirmar versões, schemas, paginação, filtros, timezone, códigos de estado, PDFs e renovação OAuth. O piloto valida cliente, NIF, documentos, notas de crédito, recibos, saldos e permissões nos dois ecrãs. Nenhum dos dois cria, altera, envia ou anula documentos fiscais.

### Fase 2 — operações controladas

Só depois de a projeção de leitura demonstrar paridade e de serem confirmados sandbox/empresa de teste, limites, idempotência e suporte do fornecedor:

- criar ou atualizar clientes no TOConline com regras claras de autoridade;
- preparar documentos com pré-visualização e aprovação financeira explícita;
- emitir no TOConline com obrigação local única, referência externa estável e reconciliação de resultado ambíguo;
- enviar documentos e refletir resultados/erros;
- introduzir débito direto ou outro prestador de pagamentos como projeto separado.

## Decisões ainda necessárias

### Complemento — acesso fechado e dois canais comerciais

A plataforma deve continuar sem signup público. A aquisição comercial, a contratação, a cobrança e o acesso são processos separados:

1. uma empresa ou município pede demonstração/contacto fora da área autenticada;
2. a C4G qualifica a oportunidade e aprova uma proposta;
3. contrato, faturação e eventual pagamento seguem o canal acordado;
4. uma aprovação comercial interna autoriza a criação da adesão já existente;
5. apenas o convite nominal e a membership central ativada dão acesso à aplicação.

Uma página de sucesso de pagamento, um email conhecido ou a posse de uma referência comercial nunca criam organização, conta, membership ou sessão. Um eventual prestador de pagamentos deve comunicar por webhook autenticado e idempotente; o resultado é reconciliado no backend antes de qualquer decisão operacional. O Stripe Checkout, por exemplo, suporta sessões de pagamento ou subscrição e eventos próprios, mas isto é apenas capacidade de cobrança e não uma razão para o tornar fonte de verdade do acesso ([Checkout Sessions](https://docs.stripe.com/api/checkout/sessions), [webhooks](https://docs.stripe.com/api/webhook_endpoints)).

#### Duas ofertas, um único produto

Não criar uma versão “município” e outra “empresa”, nem aplicar silenciosamente um multiplicador baseado no tipo da entidade. O mesmo núcleo de software deve ser vendido em dois pacotes comerciais verificáveis:

| Dimensão | Empresas | Municípios / institucional |
| --- | --- | --- |
| Entrada | Pedido de demonstração ou contacto; proposta standard; convite após aprovação | Processo comercial e de contratação pública; convite após contrato eficaz e preparação |
| Contrato | Subscrição anual standard, com opção mensal apenas se comercialmente útil | Licença/subscrição anual ou plurianual por proposta e contrato |
| Cobrança inicial | Fatura e transferência; PSP privado opcional numa fase posterior | Fatura eletrónica B2G e transferência segundo contrato/compromisso |
| Produto | Mesmo catálogo, matching, candidaturas e reporting | O mesmo núcleo funcional |
| Escala e serviço | Limites standard, suporte normal, onboarding leve | Mais utilizadores/unidades, onboarding institucional, formação, migração, SLA, apoio à contratação, integrações e implantação dedicada opcional |
| Preço | Tabela por escalão e serviço | Proposta customizada, sustentada por escala, serviço, risco e requisitos contratuais |

O preço recomendado deve decompor-se em `licença base + escalão de capacidade + pacote de serviço + onboarding/integrações`. Desta forma, o valor superior de um município é explicado por escala, responsabilidade operacional, formação, suporte, governação, integração e opção de infraestrutura dedicada — não por uma cópia artificialmente diferente da aplicação. O preço acordado fica no contrato; as capacidades ficam num catálogo de entitlements versionado. Duas organizações podem ter as mesmas capacidades com preços negociados diferentes sem criar regras de autorização diferentes.

Evitar cobrança percentual sobre financiamento obtido e evitar preço por oportunidade descoberta. Além de tornar custos imprevisíveis, estes modelos confundem o papel da plataforma com consultoria de sucesso. Para o primeiro lançamento, número de utilizadores internos, número de unidades/equipas, volume de candidaturas ativas e nível de serviço são eixos comerciais mais controláveis; os limites concretos ainda precisam de validação com clientes.

#### Pagamento e faturação por canal

- **Empresas:** começar com proposta, contrato e faturação TOConline, usando transferência bancária ou outro meio já operacional. Um checkout privado para cartão/SEPA pode ser acrescentado mais tarde para contratos standard, associado a um cliente já aprovado, nunca exposto como signup.
- **Municípios:** manter contrato/encomenda/compromisso e faturação eletrónica como percurso principal. A eSPap indica que fornecedores da Administração Pública devem emitir faturas eletrónicas no âmbito da execução de contratos públicos, com exceções previstas no CCP; desde 5 de janeiro de 2026 o Portal das Finanças também disponibiliza emissão B2G para a FE-AP ([FAQ FE-AP](https://www.espap.gov.pt/FrontEnd/Paginas/Areas/SP_Fin/SP_Fin_FEAP_FAQ_tpl_1.aspx), [comunicação AT/FE-AP](https://www.feap.gov.pt/paginas/DetalheNoticia.aspx?ni=66)).
- **Fiscalidade:** o TOConline continua a emitir os documentos fiscais. Um PSP futuro recolhe dinheiro, mas não substitui automaticamente o software de faturação certificado; a AT mantém requisitos próprios para programas e documentos fiscais ([regras de faturação da AT](https://info.portaldasfinancas.gov.pt/pt/apoio_ao_contribuinte/Negocios/Faturacao/Regras_de_faturacao/Paginas/default.aspx)).

#### Modelo central recomendado

Sem implementar já, o domínio central deve distinguir:

- `commercial_offer`: proposta e versão dos termos apresentados;
- `customer_contract`: vigência, renovação, periodicidade, preço acordado e política de suspensão;
- `plan_version` e `entitlement_set`: capacidades/limites contratados, sem decidir autorização de utilizador;
- `billing_account`: identidade e contacto de faturação, ligada explicitamente ao cliente TOConline;
- `billing_cycle` e referências externas de documentos/recebimentos;
- `payment_attempt`: apenas quando um PSP futuro conseguir provar uma operação em curso;
- `commercial_approval`: decisão auditada que permite iniciar a adesão ou alterar o serviço.

O contrato comercial e o pagamento não substituem `organization.status` nem a membership central. Uma fatura vencida não suspende automaticamente a organização: aplica-se a política contratual de tolerância, notificação e decisão C4G auditada. Para municípios, a ativação pode ocorrer antes do recebimento quando o contrato o determinar; por isso, `PAID` nunca deve ser uma pré-condição universal de acesso.

#### Sequência recomendada

1. **Fase comercial manual:** propostas e contratos fora da aplicação, faturação TOConline, transferência, aprovação C4G e convite nominal. Permite vender já sem criar pagamentos ou signup.
2. **Domínio comercial central:** contratos, planos versionados, entitlements, conta de faturação e estado reconciliado do TOConline.
3. **Cobrança opcional para empresas:** checkout privado por prestador de pagamentos, apenas para ofertas standard e clientes previamente aprovados; webhooks idempotentes e reconciliação com faturação.
4. **Automação posterior:** renovações, avisos, portal de faturação e suspensão assistida, depois de política comercial, fiscal e jurídica aprovada.

### Questões comerciais a fechar

1. A subscrição empresarial será apenas anual ou também mensal?
2. Quais são os dois ou três escalões de capacidade que o mercado empresarial compreende melhor?
3. Que serviços institucionais são sempre incluídos no município e quais são opcionais?
4. A ativação empresarial exige contrato assinado, primeira fatura emitida ou primeiro pagamento confirmado?
5. Qual o período de tolerância e quem pode aprovar uma suspensão contratual?

### Questões técnicas e fiscais já identificadas

1. O IBAN pretendido é o da C4G para receber, o do cliente para débito direto ou o do cliente para reembolsos/payouts?
2. O primeiro método será transferência bancária com reconciliação, débito direto, referência de pagamento ou cartão?
3. Confirma-se que a primeira integração é estritamente de leitura? A emissão futura será uma decisão separada depois do piloto.
4. Quais são o modelo comercial, periodicidade, prazo, renovação e IVA aplicável? A plataforma não deve inferir tratamento fiscal.
5. O administrador da entidade pode editar dados de faturação ou apenas submeter um pedido de correção?
6. Existe uma empresa/conta TOConline própria para testes e acesso à coleção Postman emitida para a C4G? Quais são os limites, webhooks, versões suportadas e restrições confirmados pelo suporte?
7. Que política de retenção se aplica aos PDFs e projeções locais de documentos e recibos?

## Fontes

- [TOConline API — introdução e OpenAPI](https://api-docs.toconline.pt/): origem da especificação pública e da coleção Postman entregue ao integrador.
- [TOConline — especificação OpenAPI 3.0.3](https://app.swaggerhub.com/apis-docs/toconline.pt/toc-online_open_api/1.0.0): inventário público de paths, métodos, segurança e exemplos; contém endpoints atuais e anteriores.
- [TOConline API — setup e credenciais](https://api-docs.toconline.pt/setup-do-postman): administração da ligação, link temporário e coleção Postman.
- [TOConline API — autenticação detalhada](https://api-docs.toconline.pt/autenticacao-detalhada): Authorization Code, scope, validade e renovação dos tokens.
- [TOConline API — características dos pedidos](https://api-docs.toconline.pt/caracteristicas-dos-pedidos): licença, headers, filtros e recomendação de paginação.
- [TOConline — API](https://toconline.pt/api/): âmbito da API e autenticação OAuth.
- [TOConline API — documentos de venda](https://api-docs.toconline.pt/apis/vendas/documentos-de-venda): criação, consulta, finalização, cliente, conta bancária, referência externa e saldos.
- [TOConline API — documentos retificativos](https://api-docs.toconline.pt/apis/vendas/documentos-retificativos): notas de crédito/débito e relação com documentos anteriores.
- [TOConline API — clientes, morada e email](https://api-docs.toconline.pt/apis/empresa/clientes-morada-e-email): campos e operações de clientes.
- [TOConline — criação de clientes](https://manual.toconline.pt/support/solutions/articles/3000110520-cria%C3%A7%C3%A3o-de-clientes): restrições a nome e NIF após emissão de documentos.
- [TOConline API — recibos de venda](https://api-docs.toconline.pt/apis/vendas/recibos-de-venda): pagamentos, liquidação parcial e alocações.
- [TOConline API — PDF de documentos](https://api-docs.toconline.pt/apis/vendas/descarregar-pdf-de-documentos-de-venda): obtenção do PDF original.
- [TOConline API — envio de documentos por email](https://api-docs.toconline.pt/apis/vendas/envio-de-documentos-por-email): ação de envio e resposta documentada.
- [TOConline API — comunicação à AT](https://api-docs.toconline.pt/apis/vendas/comunicacao-de-documentos-a-at): credenciais fiscais exigidas pelo endpoint, que fica fora do conector C4G.
- [TOConline — configuração de débitos diretos](https://manual.toconline.pt/support/solutions/articles/3000117157-configura%C3%A7%C3%A3o-de-d%C3%A9bitos-diretos): autorização, IBAN devedor e conta credora.
- [OCC — TOConline](https://www.occ.pt/tocoline_landing_page/toconline-lp.html): certificação e integração fiscal/contabilística.
- [Autoridade Tributária — regras de faturação](https://info.portaldasfinancas.gov.pt/pt/apoio_ao_contribuinte/Negocios/Faturacao/Regras_de_faturacao/Paginas/default.aspx): software certificado, arquivo, QR e ATCUD.
- [eSPap — FAQ da Fatura Eletrónica na Administração Pública](https://www.espap.gov.pt/FrontEnd/Paginas/Areas/SP_Fin/SP_Fin_FEAP_FAQ_tpl_1.aspx): obrigação e exceções da faturação eletrónica em contratos públicos.
- [FE-AP — emissão B2G através do Portal das Finanças](https://www.feap.gov.pt/paginas/DetalheNoticia.aspx?ni=66): opção disponível desde 05/01/2026 para emissão e envio à FE-AP.
- [Stripe — Checkout Sessions](https://docs.stripe.com/api/checkout/sessions): pagamentos e subscrições em checkout alojado.
- [Stripe — webhooks](https://docs.stripe.com/api/webhook_endpoints): entrega de eventos de pagamento ao backend.
- [Banco de Portugal — débitos diretos](https://clientebancario.bportugal.pt/pt-pt/direitos-e-deveres-na-utilizacao-de-debitos-diretos): autorização, guarda e alteração de IBAN.
- [RGPD, artigos 5.º e 32.º](https://eur-lex.europa.eu/legal-content/PT/TXT/?uri=CELEX%3A32016R0679): finalidade, minimização, integridade, confidencialidade e segurança.

## Recomendação

Manter a plataforma fechada e adotar duas ofertas comerciais sobre um único produto: **Empresa**, com condições e limites standard, e **Institucional/Município**, com proposta, escala e serviços próprios. Começar sem checkout: contrato, TOConline, transferência, aprovação C4G e convite nominal cobrem os dois canais e permitem vender sem signup. A faturação B2G segue FE-AP/Portal das Finanças conforme aplicável. Um PSP como Stripe só deve entrar numa fase posterior para cobrança privada de empresas já aprovadas; não emite acesso, não substitui o TOConline e não decide suspensão.

Adotar também uma secção central **Faturação** por organização e manter a ficha geral como identidade institucional. Antes do MVP integrado, executar um spike read-only que fixe o contrato efetivamente suportado pela conta C4G, porque o OpenAPI público mistura versões e deixa respostas essenciais sem schema. Depois, implementar uma projeção apenas de leitura para clientes, documentos, retificações, PDFs, recibos e saldo pendente, mantendo contrato/subscrição na C4G. Não guardar um IBAN genérico na entidade. Não apresentar **Em pagamento** enquanto não existir uma origem que prove uma operação em curso. Só considerar emissão pela API como decisão separada depois de validar idempotência operacional, resultados ambíguos, governação fiscal e ambiente seguro de teste.

Next step: aprovar os dois pacotes comerciais — Empresa e Institucional/Município — escolhendo periodicidade, escalões de capacidade, serviços incluídos e condição de ativação, antes de desenhar qualquer checkout ou implementação de pagamentos.
