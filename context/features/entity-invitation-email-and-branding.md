# Convite de nova entidade: email e identidade C4G nas páginas

Estado **Review** — 23/11/2026. Pedido do utilizador depois do ensaio da adesão no staging ([staging-entity-admission.md](staging-entity-admission.md)): as páginas de criar a entidade não tinham o logótipo da C4G e o convite não era enviado por email, ao contrário do convite de utilizador.

## Parte 1 — Logótipo e nome nas páginas

- **Páginas de ativação** (`/api/activation` e `/api/admission-activation`, servidas pelo servidor): o cabeçalho passa a mostrar o logótipo (`/logo-c4g.png`, do mesmo endereço) sobre fundo branco, em vez do texto «C4G Funding Platform»; o separador passa a «Oportunidades 2030», como a aplicação. A política de segurança da página não muda: já admitia imagens do próprio endereço.
- **Ficha da entidade** (`/adesao/…`): o cabeçalho mostra o logótipo em vez do mesmo texto.
- As páginas de definir a palavra-passe e de entrada são do Keycloak (tema C4G) e não mudam aqui.

Aceitação: as páginas mostram o logótipo com texto alternativo «C4G»; nenhuma mostra «C4G Funding Platform»; cabeçalhos de segurança e comportamento iguais.

## Parte 2 — Email do convite de entidade

- **Quando.** Ao emitir a ligação de um convite de entidade, o servidor envia-a por email ao administrador indicado. É o mesmo serviço de envio do convite de utilizador (Resend, com as variáveis `RESEND_API_KEY`, `ACTIVATION_EMAIL_FROM` e `ACTIVATION_PUBLIC_URL`), a partir do worker de adesão: a chave do serviço não entra no processo HTTP.
- **Conteúdo.** Modelo incluído no código, com o logótipo (o definido na Administração, ou o ficheiro por omissão), a ligação e a validade na hora de Lisboa. Não é editável na Administração: os modelos editáveis estão limitados por uma restrição na Central ao convite de utilizador, e acrescentar um tipo exige uma migração. Fica como trabalho posterior.
- **Depois do envio.** Se o serviço aceitar o email, a resposta deixa de incluir a ligação e a página diz para quem foi enviado. Se o envio não estiver configurado ou não for confirmado, a ligação é apresentada como antes, para entrega manual, e a página diz que o email não saiu. O convite nunca fica sem forma de chegar ao destinatário.
- **Reenviar.** «Reenviar convite» invalida a ligação anterior e emite e envia outra. A ligação não é guardada em claro em lado nenhum, por isso não se pode reenviar a mesma.
- **Âmbito.** Só a composição do staging (`ENTITY_ADMISSION_RUNTIME=central`). O ambiente local continua a mostrar a ligação.

Aceitação:

- Envio aceite: a resposta tem `emailDelivery.status = ACCEPTED` e não tem a ligação; a página mostra o destinatário e a validade.
- Envio não configurado ou não confirmado: a resposta mantém a ligação e `emailDelivery.status` diz qual foi; a página mostra a ligação e o aviso.
- O email leva à página de adesão (`/api/admission-activation#…`), nunca à de utilizadores, e o pedido ao serviço é idempotente por convite.
- Uma repetição do mesmo pedido, que já não tem a ligação, não envia nada.
- A fronteira do worker ganha um único método (`invitationEmail`); a ligação e a chave do serviço não aparecem em registos nem em respostas além da descrita.

## Limites

- O envio do convite de entidade não aparece no histórico de emails da Administração, que só conhece os tipos existentes.
- «Aceite» significa aceite pelo serviço de envio, não entregue na caixa de correio.
- Sem modelo editável nem modelo por entidade (ainda não existe entidade quando o convite é enviado).
