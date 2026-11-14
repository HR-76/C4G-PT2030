# Emails: templates e configuração

Estado: Draft — contrato proposto em 12/11/2026, por aprovar. Nada implementado. Decisões de produto da fase 1 fechadas, com [plano técnico](email-templates-and-configuration-plan.md) por aprovar. Há perguntas em aberto que bloqueiam as fases 2 e 3.

## Pedido

Pedido do utilizador em 12/11/2026, com uma aplicação C4G existente (SIEF) como referência visual: menu Email com Tipo, Configurações e Histórico.

Decisões confirmadas pelo utilizador:

- Cada organização pode ter templates próprios.
- O Admin C4G configura os emails de reposição de palavra-passe e de código por email.
- No cliente existe apenas a possibilidade de enviar os convites aos colaboradores.
- Âmbito desta feature: três tipos — convite de colaborador, reposição de palavra-passe e código por email.
- Só o Admin C4G edita templates, incluindo o de convite de cada organização.

## Tipos de email existentes (verificado em 12/11/2026)

| Tipo | Quem envia | Estado | Texto atual | Nesta feature |
| --- | --- | --- | --- | --- |
| Convite/ativação de colaborador | Aplicação, worker de identidade, API Resend | Implementado com reenvio ([contrato](member-activation-email.md)) | Fixo em `backend/src/platformOnboarding/activationEmail.js`, texto simples | Sim |
| Código por email (verificação adicional) | Keycloak, extensão `c4g-email-verification`, SMTP do Keycloak | Validado localmente com SMTP local ([contrato](optional-email-verification.md)) | Da extensão; o repositório não tem tema de email | Sim |
| Reposição de palavra-passe | Keycloak nativo | Desligado (`resetPasswordAllowed=false`) | Template por defeito do Keycloak | Sim |
| Mudança de estado da candidatura | Aplicação, outbox | Simulação; envio real desativado ([prontidão](application-status-emails-readiness.md)) | Fixo em `backend/src/applications/statusEmails/template.js` | Não |
| Envio de faturas | Aplicação (planeado) | Só [investigação](../research/c4g-admin-billing-and-invoice-delivery.md) | Não existe | Não |
| Convite ao primeiro administrador de entidade | Não é email: ligação entregue manualmente | — | — | Não |

Factos relevantes para o desenho:

- O cliente já envia e reenvia convites em `/access/users` (Admin da entidade e Gestor de financiamento, este só para o perfil Colaborador). Essa capacidade mantém-se; esta feature não a altera.
- O convite usa `RESEND_API_KEY`, `ACTIVATION_EMAIL_FROM` e `ACTIVATION_PUBLIC_URL` do ambiente do worker. Só fica guardado o resultado do último envio por operação; não há histórico de envios.
- O Keycloak é único para todas as organizações. Os seus emails são globais e saem por SMTP configurado no próprio Keycloak, não pela API Resend da aplicação.
- Verificado apenas no repositório e na documentação. O Keycloak de staging não foi inspecionado.

## Regras que esta feature não pode quebrar

- Sem campos de host, porta, utilizador, palavra-passe SMTP ou chave de API na interface, nem valores recuperáveis pela API. Segredos ficam no ambiente (ver [serviços externos](../decisions/hosting-and-external-services.md) e a investigação de faturação, secção Email).
- O segredo de ativação nunca chega ao browser nem fica em claro; a ligação é inserida no envio pelo worker.
- Um template não pode impedir a ativação: a ligação e a validade estão sempre presentes na mensagem enviada.
- Dados de uma organização não são lidos nem escritos por outra.
- Uma alteração de template não modifica a evidência de emails já enviados: templates têm versões.

## Contrato proposto

### Fase 1 — Template do convite por organização

Ecrã no Administrador C4G, menu Email › Tipos.

- Existe um template global do convite, que reproduz o texto atual. Cada organização pode ter um template próprio que o substitui; sem template próprio, usa o global.
- Campos editáveis: assunto e corpo. Variáveis numa lista fechada: `{Organizacao}`, `{LigacaoAtivacao}`, `{Validade}` e `{Logotipo}`. No assunto só `{Organizacao}` e `{Validade}`. `{Logotipo}` marca o sítio onde a imagem aparece; é opcional e não aparece na versão em texto.
- O corpo é HTML com logótipo, editado num editor de texto rico (decisão de 12/11/2026). Formatação admitida numa lista fechada: parágrafos, títulos, negrito, itálico, listas, ligações `https` e o logótipo. Sem scripts, estilos externos, formulários, iframes ou imagens de endereços arbitrários.
- O servidor sanitiza o HTML ao gravar e volta a validar ao enviar; não confia na sanitização do browser. O que for retirado é mostrado ao administrador antes de gravar.
- Cada envio leva também uma versão em texto simples, gerada a partir do HTML, com a ligação de ativação por extenso.
- O logótipo é referenciado por um endereço público HTTPS servido pela plataforma, não anexado nem embutido em base64.
- Logótipo (decisão de 12/11/2026): emails da aplicação levam o logótipo da C4G; emails de uma organização levam o logótipo dessa organização. Assim, o template global e os emails do Keycloak usam o da C4G, e o template de convite próprio de uma organização usa o dela. Uma organização sem logótipo carregado usa o da C4G.
- Logótipo da organização: uma imagem por organização, PNG ou JPEG, até 512 KiB e 1200×600 px, validada pelo conteúdo e não pela extensão. SVG é recusado. Substituir o logótipo não altera a evidência de envios anteriores.
- Quem carrega (decisão de 12/11/2026): o logótipo da C4G é carregado pelo Admin C4G, no Administrador C4G; o logótipo de uma entidade é carregado pela própria entidade, apenas pelo Admin da entidade. Gestor de financiamento, Colaborador e Técnico não carregam nem removem. O Admin C4G vê o logótipo da entidade no ecrã do template, sem o alterar.
- Enquanto o Admin C4G não carregar um logótipo, usa-se o atual `logo-c4g.png`.
- Gravar é recusado se faltar `{LigacaoAtivacao}` ou `{Validade}`, se existir uma variável desconhecida, ou se o assunto contiver quebras de linha. Limites: assunto 200 caracteres, corpo 20 000 caracteres de HTML.
- Pré-visualização com valores de exemplo, sem ligação real.
- Envio de teste para o endereço do próprio administrador autenticado, com ligação de exemplo não funcional e marca visível de teste.
- Cada gravação cria uma versão com autor e data. É possível repor o template global. O envio regista a versão usada.
- Reverter para o texto por defeito está sempre disponível e não apaga versões anteriores.

Critérios de aceitação:

1. Sem template próprio, o email enviado usa o template global por defeito.
2. Com template próprio na organização A, um convite da A usa-o e um convite da B não.
3. Gravar sem `{LigacaoAtivacao}` ou `{Validade}` devolve erro de validação e não cria versão.
4. Valores das variáveis são inseridos com escaping; o nome de uma organização nunca é interpretado como marcação.
4a. HTML com `<script>`, atributos de evento, `javascript:`, iframes ou imagens externas é gravado sem esses elementos, e o envio nunca os contém.
4b. O email enviado tem partes HTML e texto; a parte de texto contém a ligação de ativação e a validade.
4d. Um convite da organização A com logótipo próprio mostra o da A; um convite da B sem logótipo mostra o da C4G; nenhum convite mostra o logótipo de outra organização.
4e. Um ficheiro que não seja PNG ou JPEG válido, ou que exceda os limites, é recusado sem ser guardado.
4f. O Admin da entidade A carrega e remove o logótipo da A; não lê nem altera o da B. Outros perfis da A recebem recusa. O Admin C4G não altera o logótipo de uma entidade.
4c. O template por defeito em HTML transmite a mesma informação que o texto atual.
5. Só `C4G_ADMIN` lê e escreve templates; Admin da entidade e Gestor recebem recusa.
6. Reenviar um convite depois de editar o template usa a versão nova; o registo do envio anterior conserva a versão antiga.
7. Idempotência do envio, validade de 24 horas e invalidação por reenvio mantêm-se como no contrato atual.
8. Auditoria regista criação de versão e reposição, com ator e organização, sem o corpo do template nos logs.
9. Testes automatizados: isolamento entre organizações, autorização, validação, versão usada no envio e regressão do texto por defeito.

### Fase 2 — Emails do Keycloak (reposição de palavra-passe e código por email)

Ecrã no Administrador C4G, mesmos menu e padrão, com âmbito global.

- Campos editáveis: assunto e corpo de cada um dos dois tipos, com as variáveis que o Keycloak disponibiliza para esse tipo.
- A aplicação escreve os textos no Keycloak com uma conta de serviço restrita a essa operação; não lê nem devolve a configuração SMTP do realm.
- A reposição de palavra-passe só fica disponível aos utilizadores depois de decisão explícita de a ligar (pergunta 3).

Critérios de aceitação, a fechar depois da verificação técnica:

1. Alterar o texto na aplicação altera o email recebido num Keycloak 26.8.0 descartável com SMTP local.
2. A resposta da API nunca contém `smtpServer` nem outros segredos do realm.
3. Falha do Keycloak ao gravar é mostrada como falha; a aplicação não afirma que gravou.
4. Só `C4G_ADMIN` com sessão válida acede; a ação fica auditada.

Verificação técnica necessária antes de fechar esta fase:

- Confirmar se os textos de email do Keycloak 26.8.0 aceitam substituição por localização do realm (o repositório já escreve localização do realm em `backend/scripts/localPlatform/identityLocalization.js`) ou se exigem um tema de email implantado com ficheiros.
- Confirmar de onde a extensão `c4g-email-verification` obtém o texto do código por email e se é configurável sem recompilar.

### Fase 3 — Configuração e histórico

- Configuração: nome do remetente e endereço de resposta do convite, estado da configuração (configurado, em falta) e envio de teste. Sem segredos.
- Histórico: destinatário, tipo, organização, data, estado e erro dos convites enviados. Sem corpo da mensagem.

Depende das perguntas 4 e 5.

## Fora de âmbito

- Emails de mudança de estado da candidatura e de faturas.
- Domínios de envio próprios por cliente.
- Anexos, imagens além do logótipo e carregamento livre de imagens pelo editor.
- Qualquer alteração a quem pode convidar colaboradores.
- Uso do logótipo da entidade fora dos emails (cabeçalho da aplicação, relatórios).

## Perguntas em aberto

1. Resolvida em 12/11/2026: só o Admin C4G edita templates, incluindo o de convite de cada organização.
2. Resolvida em 12/11/2026: HTML com logótipo.
3. A reposição de palavra-passe é ligada no âmbito desta feature? Implica SMTP externo no Keycloak e revê a decisão de a manter desligada.
4. O histórico deve incluir os emails do Keycloak? A aplicação não os vê hoje; exigiria ler eventos do Keycloak.
5. Prazo de retenção dos endereços no histórico.
6. Resolvida em 12/11/2026: C4G carrega o seu; cada entidade carrega o seu, apenas o Admin da entidade.
6a. Armazenamento e endereço público do logótipo: proposta no [plano técnico](email-templates-and-configuration-plan.md) (guardado na Central, servido por rota pública dedicada). Confirmado pelo utilizador em 12/11/2026.
7. Resolvida em 12/11/2026: aprovados Tiptap no frontend (editor, extensões limitadas à formatação admitida) e `sanitize-html` no backend (lista fechada de elementos e atributos). Versões e licenças a confirmar na instalação.

## Validação prevista

Backend: testes focados e suite completa, `node --check` e lint. Frontend: testes, build e lint. Fase 2 com gate isolado em Keycloak e SMTP descartáveis, com autorização própria. Migrações provadas em PostgreSQL descartável antes de qualquer base habitual.
