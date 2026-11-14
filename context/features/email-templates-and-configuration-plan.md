# Plano técnico — Emails, fase 1 (template do convite e logótipos)

Estado: In Progress — ponto de situação de 14/11/2026 no fim deste documento. Incrementos 1, 2, 3, 5, 6 e 7 feitos; 4 por fazer. Por aprovar pelo utilizador. Estado anterior: Draft — 12/11/2026, por aprovar. Contrato em [Emails: templates e configuração](email-templates-and-configuration.md). Nada implementado; nenhuma dependência instalada; nenhuma base alterada.

Âmbito: só a fase 1. Emails do Keycloak, configuração e histórico têm plano próprio depois das respetivas perguntas.

## O que existe e condiciona o desenho

- O convite é enviado em `memberService.sendEmail` → IPC → `memberWorker` → `activationEmail.send`. O segredo de ativação é derivado no worker e nunca passa pelo processo HTTP nem pelo browser. Isto mantém-se.
- A chave de idempotência no Resend é `member-activation/<invitationId>`. Repetir a mesma chave com um corpo diferente é recusado pelo fornecedor. Logo, a versão do template tem de ficar fixada por convite.
- O resultado do envio é gravado em `receipt.activationEmail` de `platform_member_operation`, passado como parâmetro JSON. Acrescentar a versão do template a esse JSON não exige alterar o SQL admitido.
- A Central só aceita SQL de um catálogo fechado, admitido por hash em `authority_api.execute`, com manifestos e fingerprints. Tabelas e consultas novas entram como pacote controlado, como a faturação (`backend/src/platformBilling/sql.js` e migração 027).
- A faturação é o modelo mais próximo para tudo o resto: tabelas na Central por `organization_id`, versões, recibos de comando com chave de idempotência, auditoria, router de Admin C4G em `/api/admin/...` e router do cliente com contexto organizacional resolvido no servidor.
- `multer` e `express.raw` já existem no backend. Não há editor rico nem sanitização de HTML; Tiptap e `sanitize-html` estão aprovados.

Por confirmar antes de implementar:

- O diretório de migrações da Central termina em 035, mas a base local é referida como revisão 048 a 050, com pacotes em `backend/database/central/candidates/`. O número e a forma de registo do pacote novo decidem-se com o runner e o manifesto; não assumir.
- `context/features/member-email-local-rollout.md` regista o pacote `member_email_delivery` ensaiado mas sem COMMIT na base local em 06/11/2026. Confirmar o estado atual; sem ele, o resultado do envio não é gravado.
- `memberWorker.js` recusa um issuer que não seja `localhost`. Confirmar como o convite funciona em staging antes de contar com esta fase lá.

## Decisões técnicas propostas

1. **Dados na Central.** Templates, versões e logótipos ficam na Central, por `organization_id`, porque o envio do convite corre na Central e quem edita é o Admin C4G. O isolamento é imposto nas consultas e provado por testes, como na faturação.
2. **Logótipo guardado na base, não no R2.** Imagem até 512 KiB numa coluna `bytea` de uma tabela de versões. Os objetos R2 são privados e o R2 real continua adiado; um bucket público só para logótipos seria infraestrutura nova. Alternativa: R2 com caminho público dedicado, quando existir. Confirmado pelo utilizador em 12/11/2026, como exceção à regra geral de ficheiros no R2, limitada a logótipos de email.
3. **Endereço público do logótipo.** `GET /api/public/email-logos/<id>`, sem sessão, em que `<id>` é um identificador aleatório de 128 bits por versão. Só serve logótipos, com `Content-Type` fixo pelo tipo validado, `nosniff`, sem cookies e cache imutável. O identificador não revela a organização. Um logótipo removido deixa de ser usado em envios novos, mas o endereço das versões já enviadas continua a responder, para não partir emails antigos.
4. **Versão fixada por convite.** No primeiro envio de um convite regista-se a versão do template e do logótipo; repetições técnicas do mesmo convite reutilizam-nas. Um reenvio explícito cria convite novo e usa a versão atual.
5. **Composição em dois passos.** O serviço resolve o template (próprio da organização ou global), sanitiza, substitui `{Organizacao}` e `{Validade}` e entrega ao worker assunto, HTML e texto com um marcador interno no lugar da ligação. O worker substitui o marcador pela ligação real e envia. O worker recusa enviar se o marcador não existir exatamente nas duas partes.
6. **Validação de imagem sem dependência nova.** Verificar assinatura e cabeçalho PNG/JPEG e ler as dimensões do próprio ficheiro; recusar o resto. Sem reprocessar a imagem.

## Modelo de dados (Central, aditivo, sem backfill)

- `email_template`: tipo (`MEMBER_INVITATION`), âmbito (`GLOBAL` ou organização), versão atual, revisão. Uma linha por tipo e âmbito.
- `email_template_version`: assunto, HTML sanitizado, autor, data, digest do conteúdo. Imutável.
- `email_logo`: âmbito (`C4G` ou organização), versão atual ou nenhuma, revisão.
- `email_logo_version`: identificador público aleatório, tipo MIME validado, largura, altura, tamanho, SHA-256, bytes, autor, data. Imutável.
- `email_command_receipt`: chave de idempotência, digest da intenção e projeção do resultado, por organização e operação.

O template global por defeito não é semeado na base: vive no código, com versão própria, e aplica-se enquanto não existir linha `GLOBAL`.

## API

Admin C4G (`C4G_ADMIN` com sessão ativa, CSRF e origem, como na faturação):

- `GET /api/admin/email/templates` — tipos e, por tipo, se o global foi alterado e quantas organizações têm template próprio.
- `GET|PUT /api/admin/email/templates/member-invitation` — global.
- `GET|PUT /api/admin/email/organizations/:organizationId/templates/member-invitation` — próprio da organização; `POST .../reset` volta ao global.
- `POST .../preview` — devolve assunto, HTML sanitizado, texto e lista do que foi retirado. Não grava.
- `POST .../test` — envia para o endereço do administrador autenticado, com ligação de exemplo.
- `GET|PUT|DELETE /api/admin/email/logo` — logótipo da C4G.

Cliente (apenas Admin da entidade, organização resolvida no servidor):

- `GET|PUT|DELETE /api/organization-directory/email-logo`.

Público: `GET /api/public/email-logos/:id`.

Escritas levam `expectedRevision` e `idempotencyKey`. Erros públicos numa lista fechada; nada de detalhes internos.

## Incrementos

| # | Entrega | Ficheiros principais | Prova |
| --- | --- | --- | --- |
| 1 | Núcleo puro: variáveis, sanitização, HTML→texto, template por defeito, validação de imagem | `backend/src/emailTemplates/` (novo) | Testes unitários, incluindo HTML hostil e ficheiros inválidos |
| 2 | Pacote da Central: tabelas, consultas admitidas, manifestos | `backend/database/central/`, `backend/src/emailTemplates/sql.js`, manifestos em `backend/src/security/` | PostgreSQL descartável: aplicar, repetir, fingerprints, papéis |
| 3 | Serviço e API do Admin C4G, com auditoria e idempotência | `backend/src/emailTemplates/{service,repository,http,audit}.js`, `productionComposition.js` | Testes de autorização, isolamento A/B, revisão obsoleta, repetição |
| 4 | Envio: template e versão fixada no convite; envio de teste | `platformOnboarding/{memberService,memberWorker,activationEmail,memberWorkerClient}.js` | Regressão do envio atual, fixação de versão, marcador obrigatório |
| 5 | Logótipos: API da C4G, API do cliente e rota pública | `backend/src/emailTemplates/logo*.js`, `routes/organizationDirectoryRoutes.js` | Autorização por perfil, isolamento, cabeçalhos da rota pública |
| 6 | Interface Admin C4G: Email › Tipos, editor Tiptap, pré-visualização, teste | `frontend/src/pages/Platform/EmailTemplates.jsx`, `frontend/src/api/api.js`, navegação | Vitest, build, verificação visual a 1440 e 390 px |
| 7 | Interface do cliente: logótipo na ficha da entidade | `frontend/src/pages/Organization/EntityProfileCard.jsx` | Vitest, build, verificação visual |

Cada incremento fecha com `node --check`, testes focados, suites completas, lint e, no frontend, build. Os incrementos 1, 3 a 7 não tocam em bases. O incremento 2 só corre em PostgreSQL descartável; aplicar na base local habitual ou em staging exige autorização própria.

## Progresso

- 12/11/2026 — Incremento 1 em Review. `backend/src/emailTemplates/` (contratos, sanitização, texto, composição, template por defeito, validação de logótipo) e `backend/test/emailTemplates.test.js`. Ainda não é chamado por nenhuma rota nem pelo envio do convite: o email enviado continua a ser o atual.
  - Dependência: `sanitize-html` 2.18.1, versão fixa, MIT. A 2.18.2 tinha um dia à data da instalação e foi deixada para depois. `npm audit --omit=dev` sem vulnerabilidades.
  - Validação: 14 testes focados aprovados, `node --check` e lint aprovados. Suite backend: 3147 aprovados, 9 ignorados, 1 falha em `SEC-AC-01` (`test/security/f2Security.test.js`, lê `frontend/src/api/api.js`), fora deste incremento, que não altera o frontend.
  - Decisões tomadas na implementação: `{Logotipo}` é uma variável posicionável; o corpo é limitado a 20 000 caracteres de HTML; ligações só `https` sem credenciais ou `{LigacaoAtivacao}`; a validade é escrita em hora de Lisboa por extenso; o texto por defeito mantém as frases atuais e passa a ter a ligação como "Ativar acesso".

- 12/11/2026 — Incremento 6 em Review, contra API simulada. Página `frontend/src/pages/Platform/EmailTemplates.jsx` em `/administracao/email`, entrada "Email" no menu do Admin C4G, editor `EmailBodyEditor.jsx` (Tiptap), cliente `platformEmailApi` em `frontend/src/api/api.js`.
  - O que o ecrã faz: escolher âmbito (global ou entidade), editar assunto e corpo, inserir variáveis, pré-visualizar em HTML e em texto, enviar teste, guardar com revisão, repor com confirmação, carregar ou repor o logótipo da C4G e consultar o da entidade.
  - **O backend destas rotas ainda não existe.** Na aplicação real a página mostra erro ao carregar, até aos incrementos 2, 3 e 5. O contrato HTTP que a página espera está no cliente e na simulação; o incremento 3 tem de o cumprir ou ajustar os dois lados.
  - Pré-visualização de desenvolvimento: `frontend/email-preview.html`, com `emailTemplatesSimulation.js`, servida só por `npm run dev` em `/email-preview.html`. Não é entrada do build; confirmado que a simulação não aparece em `dist`. A sanitização da simulação é aproximada e não é fronteira de segurança.
  - Dependências: `@tiptap/react`, `@tiptap/starter-kit` e `@tiptap/pm` 3.32.2, versões fixas, MIT. A 3.33.1 tinha dois dias. `npm audit --omit=dev` sem vulnerabilidades. O editor fica num ficheiro próprio de 430 kB (137 kB comprimido), carregado só ao abrir esta página.
  - Decisões tomadas: a moldura da pré-visualização usa `sandbox="allow-same-origin"` sem `allow-scripts`, porque sem isso a política de imagens da página bloqueia o logótipo; bloquear o editor durante um pedido não conta como edição; as mensagens de resultado aparecem junto aos botões.
  - Validação: 17 testes novos aprovados (13 da página, 4 do editor real em jsdom), lint e build aprovados. Browser com API simulada a 1440 e 390 px: edição, gravação, pré-visualização com logótipo, envio de teste, troca de entidade e ausência de scroll horizontal. Suite frontend: 1003 aprovados numa execução; nas três seguintes, 1002 e 1 falha por tempo limite de 5 s em `ApplicationPartners.test.jsx` ("stops adding people at fifty"), que passa isolado (16 de 16) e não foi alterado. Suite backend: 3149 aprovados, 9 ignorados, 1 falha `SEC-AC-01`, a mesma de antes.
  - Não verificado: a página dentro da aplicação com sessão real, leitores de ecrã, e o comportamento do editor em Safari e Firefox.
- `.claude/launch.json` criado para arrancar o servidor de desenvolvimento do frontend na pré-visualização.

## Riscos

- **HTML em clientes de email.** A sanitização garante segurança, não aparência. Testar em caixas reais só numa etapa autorizada com destinatários controlados.
- **Rota pública nova.** É a primeira rota sem sessão que serve conteúdo carregado por clientes. Mitigação: só imagens validadas, tipo fixo, identificador aleatório, limite de pedidos.
- **Logótipo como rastreio de abertura.** Cada abertura do email pede a imagem ao servidor. Não registar esses pedidos por destinatário.
- **Pacote da Central.** É a parte mais demorada e a que pode bloquear o resto, pelo catálogo fechado e pelos fingerprints.
- **Tamanho da base.** No pior caso, 512 KiB por versão de logótipo. Limitar o número de versões guardadas por organização às referenciadas por envios e à atual.

## Ordem sugerida

1, depois 2 e 6 em paralelo (o 6 pode avançar com a API simulada), depois 3, 4, 5 e 7.

## Ponto de situação (14/11/2026)

Verificado no código e por execução das suítes. A frase "Nada implementado; nenhuma dependência instalada" do estado anterior já não era verdadeira.

| # | Incremento | Situação | Evidência |
| --- | --- | --- | --- |
| 1 | Núcleo puro | Feito | `backend/src/emailTemplates/` e 14 testes. Sanitização ensaiada a 14/11 com 23 entradas de ataque, 0 fugas ([registo](../reviews/email-html-sanitization-2026-11-14.md)). |
| 2 | Pacote da Central | Feito, sem registo anterior neste plano | Migração `051_email_templates` (2 tabelas, funções de escrita com verificação de administrador, registos imutáveis), pacote e manifestos, gate em `test/integration/email-templates/`. Aplicada no staging a 14/11/2026, como predecessora da 052. Não existe `sql.js` com as consultas admitidas. |
| 3 | Serviço e API do Admin C4G | Feito a 14/11/2026, em Review | Ver "Incremento 3" abaixo. |
| 4 | Envio com o template guardado | Por fazer | `activationEmail.js` envia o texto fixo atual. |
| 5 | Logótipos e rota pública | Feito a 14/11/2026, em Review | Ver "Incremento 5" abaixo. |
| 6 | Interface Admin C4G | Feito contra API simulada | Página, editor e cliente. A entrada "Email" está no menu e a página dá erro na aplicação real, porque falta o incremento 3. |
| 7 | Logótipo na ficha da entidade | Feito a 14/11/2026, em Review | Ver "Incremento 7" abaixo. |

Condicionantes: o staging não envia email, por isso o incremento 4 e o envio de teste só se provam com um fornecedor de email autorizado. As fases 2 e 3 do contrato dependem das perguntas 3, 4 e 5, ainda em aberto.

### Lista de tipos (14/11/2026, em Review)

- **Contrato:** secção "Lista de tipos" em [Emails: templates e configuração](email-templates-and-configuration.md).
- **Código:** `frontend/src/pages/Platform/EmailTypes.jsx` (lista em `/administracao/email`) e `EmailTemplates.jsx` (ecrã do tipo em `/administracao/email/:type`); catálogo fixo em `emailTemplatePresentation.js`. Sem alterações no backend: usa `GET /api/admin/email/templates`.
- **Correção associada:** `/administracao/email` e as suas subpáginas abrem sem organização ativa (`Layout.jsx`); antes mostravam "Área da organização".
- **Testes:** `EmailTypes.test.jsx` (4) e regressão em `C4gShell.test.jsx`. Suíte do frontend: 1084 a passar, 0 falhas; build e lint sem erros.
- **Não verificado:** a lista no navegador com sessão real, e o staging.

### Incremento 3 (14/11/2026, em Review)

- **Código:** `backend/src/emailTemplates/{sql,repository,service,http}.js`, ligado em `productionComposition.js` e montado em `/api/admin/email` (`app.js`).
- **Rotas:** `GET /templates`; e, para o global e para cada organização, `GET`, `PUT`, `POST /reset`, `POST /preview` e `POST /test` de `member-invitation`.
- **Autorização:** o serviço confirma o administrador C4G em cada pedido, antes de validar o que quer que seja. As escritas passam pela função `email_template_write`, que volta a confirmar a sessão dentro da base.
- **Idempotência e concorrência:** `expectedRevision` e `idempotencyKey`, resolvidos pela função da base. Repetir o mesmo pedido não cria segunda versão.
- **Erros públicos:** lista fechada de nove códigos; os motivos de um template inválido saem só com código e nome de variável. Tudo o resto sai como `SERVICE_UNAVAILABLE`.
- **Testes:** `backend/test/emailTemplateApi.test.js`, 14 testes (serviço e HTTP). Suíte do backend: 3216 a passar, 0 falhas, 9 ignorados.
- **Prova em PostgreSQL 18 descartável** (instalador de staging até à Central 052, serviço ligado com o papel limitado `c4g_central_runtime`): 12 passos, todos a passar. Cobre texto por defeito, recusa a quem não é administrador, gravação com limpeza, repetição, revisão desatualizada, isolamento entre a organização A e a B, organização desconhecida, template inválido sem versão criada, pré-visualização sem escrita, reposição com histórico, sessão revogada e escrita direta na tabela recusada.
- **Frontend:** mensagens para os códigos novos em `emailTemplatePresentation.js`, com teste.

Desvios e limites, por decidir ou por fazer:

- **Auditoria (critério 8).** O registo de quem gravou ou repôs, quando e em que organização fica no histórico imutável `email_template_version`. Não foram acrescentados eventos de auditoria F7: os códigos de evento são uma lista fechada na base, e acrescentá-los exige uma migração nova, que este incremento não devia tocar. Decisão do utilizador a 14/11/2026: o histórico imutável basta como auditoria; não se acrescentam eventos F7.
- **Envio de teste.** A rota existe e responde `EMAIL_DELIVERY_UNAVAILABLE` até ao incremento 4.
- **Logótipos.** Resolvido pelo incremento 5 (abaixo).
- **Leitura do autor.** A consulta lê `global_user`, que o papel `c4g_central_runtime` só pode ler a partir da Central 052.
- **Não verificado:** a página dentro da aplicação com sessão real, e o staging.

### Incremento 5 (14/11/2026, em Review)

Sem migração nova: a tabela `email_logo_version` e a função `email_logo_write` já vinham na Central 051.

- **Código:** `backend/src/emailTemplates/{logoService,logoHttp}.js`, consultas em `sql.js` e `repository.js`; ligado em `productionComposition.js`, `app.js` e `routes/organizationDirectoryRoutes.js`.
- **Rotas:** `GET|PUT|DELETE /api/admin/email/logo` (logótipo da C4G), `GET|PUT|DELETE /api/organization-directory/email-logo` (logótipo da entidade da sessão) e `GET /api/public/email-logos/:id`.
- **Contrato de escrita:** o corpo do `PUT` é a própria imagem (`image/png` ou `image/jpeg`). A revisão vai em `X-Logo-Revision` e a chave de idempotência em `Idempotency-Key` (UUID). O `DELETE` leva os mesmos dois cabeçalhos. Resposta: `{ url, revision, updatedAt }`, com `url` nulo quando se usa a imagem original.
- **Autorização:** o logótipo da C4G exige administrador C4G; o de uma entidade exige o Admin dessa entidade, na sessão que a selecionou. A entidade vem sempre do contexto da sessão, nunca do pedido. Um administrador C4G não altera o logótipo de uma entidade. A função da base volta a confirmar tudo dentro da escrita.
- **Validação:** tipo e dimensões lidos dos bytes; SVG e o resto são recusados. Um corpo acima de 512 KiB é recusado enquanto é lido (413).
- **Rota pública:** montada antes dos parsers e da sessão, por isso não lê nem cria cookies; fica atrás do limite de pedidos de `/api`. Serve só PNG e JPEG validados, com `Content-Type` do tipo guardado, `nosniff` e cache imutável. Não regista quem pede. Uma versão substituída ou removida continua a responder pelo seu nome.
- **Template e pré-visualização:** a vista do template passa a indicar o logótipo do âmbito (`ORGANIZATION` ou `C4G`). A pré-visualização inclui a imagem quando `PUBLIC_APP_URL` é HTTPS; em desenvolvimento local (HTTP) fica sem imagem.
- **Frontend:** o cliente passa a enviar `Idempotency-Key`; mensagem nova para `EMAIL_LOGO_NOT_SET`.
- **Testes:** `backend/test/emailLogoApi.test.js`, 15 testes (serviço, HTTP das três rotas, ordem de montagem). Suíte do backend: 3264 a passar, 0 falhas, 9 ignorados. Lint e build aprovados. Suíte do frontend: 1088 a passar e 1 falha por tempo limite em `ApplicationPartners.test.jsx` ("stops adding people at fifty"), a mesma já registada acima e fora deste incremento.

Decisão tomada na implementação, confirmada pelo utilizador a 14/11/2026:

- **Que logótipo leva um email de uma entidade.** Seguiu-se o critério 4d do contrato: uma entidade com logótipo próprio usa o dela, mesmo com o template global; sem logótipo próprio usa o da C4G. A frase da decisão de 12/11 ("o template de convite próprio de uma organização usa o dela") também admite a leitura de que só o template próprio leva o logótipo da entidade. O utilizador confirmou a primeira leitura: o logótipo segue a entidade, não o template.

Limites e por fazer:

- **Não verificado:** contra PostgreSQL real (o gate `test/integration/email-templates/` não foi repetido), na aplicação com sessão real e no staging.
- **O envio ainda não usa o logótipo:** depende do incremento 4.
- **Interface do cliente:** feita no incremento 7 (abaixo).
- **Versões antigas:** o histórico é imutável, por isso não há limpeza de versões substituídas (até 512 KiB cada).

### Incremento 7 (14/11/2026, em Review)

- **Código:** `frontend/src/pages/Organization/EntityEmailLogo.jsx` (secção "Logótipo nos emails"), mostrada em `OrganizationProfile.jsx` a seguir à ficha da entidade; cliente em `organizationDirectoryApi` (`emailLogo`, `emailLogoWrite`, `emailLogoRemove`); estilos em `entity-profile.css`.
- **Desvio ao plano:** a secção não ficou dentro de `EntityProfileCard.jsx`, porque esse componente também é usado pelo Admin C4G no diretório da plataforma, onde o logótipo de uma entidade não pode ser alterado.
- **Quem vê:** só o Administrador da entidade (`profileCode` `ORG_ADMIN` na sessão). Os outros perfis não veem a secção nem fazem o pedido. O servidor volta a decidir em cada pedido.
- **O que faz:** mostra o logótipo atual ou a indicação de que se usa o da C4G; carrega, substitui e remove. Recusa no browser ficheiros que não sejam PNG ou JPEG ou que excedam 512 KB; as dimensões são validadas pelo servidor. Depois de uma revisão desatualizada, recarrega o logótipo atual.
- **Testes:** `EntityEmailLogo.test.jsx` (6) e um teste novo em `OrganizationProfile.test.jsx`. Suíte do frontend: 1096 a passar, 0 falhas. Lint e build aprovados.
- **Não verificado:** verificação visual a 1440 e 390 px, a secção com sessão real e o staging.
