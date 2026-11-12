# Plano técnico — Emails, fase 1 (template do convite e logótipos)

Estado: Draft — 12/11/2026, por aprovar. Contrato em [Emails: templates e configuração](email-templates-and-configuration.md). Nada implementado; nenhuma dependência instalada; nenhuma base alterada.

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

## Riscos

- **HTML em clientes de email.** A sanitização garante segurança, não aparência. Testar em caixas reais só numa etapa autorizada com destinatários controlados.
- **Rota pública nova.** É a primeira rota sem sessão que serve conteúdo carregado por clientes. Mitigação: só imagens validadas, tipo fixo, identificador aleatório, limite de pedidos.
- **Logótipo como rastreio de abertura.** Cada abertura do email pede a imagem ao servidor. Não registar esses pedidos por destinatário.
- **Pacote da Central.** É a parte mais demorada e a que pode bloquear o resto, pelo catálogo fechado e pelos fingerprints.
- **Tamanho da base.** No pior caso, 512 KiB por versão de logótipo. Limitar o número de versões guardadas por organização às referenciadas por envios e à atual.

## Ordem sugerida

1, depois 2 e 6 em paralelo (o 6 pode avançar com a API simulada), depois 3, 4, 5 e 7.
