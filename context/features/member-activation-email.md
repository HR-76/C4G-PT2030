# Email de ativação de utilizadores

Pedido confirmado em 2026-11-06. Ao preparar um utilizador da organização, enviar automaticamente uma ligação para ativação e definição da palavra-passe. Disponibilizar reenvio.

## Critérios de aceitação

- Enviar após concluir identidade e projeção, mantendo o acesso pendente até à ativação.
- Usar o destinatário do registo autorizado e a origem pública configurada no servidor.
- Novas contas definem a palavra-passe. Contas existentes autenticam-se no percurso existente.
- Ligações de uso único, válidas por 24 horas. Reenvio explícito invalida a anterior.
- Repetir um pedido usa a mesma ligação e chave de idempotência. Não enviar ligações expiradas, revogadas ou usadas.
- Mostrar envio aceite, envio por confirmar e configuração em falta. Aceitação pelo fornecedor não prova entrega na caixa de correio.
- Credenciais de email e derivação de segredos ficam no worker de identidade. Nenhum segredo de ativação é devolvido pelo endpoint de email.

## Implementação

O journal persistente de convites conserva a intenção e o digest. O worker deriva a mesma ligação para recuperar uma resposta incerta e envia através de Resend. O resultado mais recente fica no receipt da operação. As tentativas são iniciadas pela preparação e pelo reenvio na interface. Um consumidor periódico de outbox e webhooks de entrega continuam fora deste fluxo síncrono.

Configuração do worker por variáveis de ambiente `RESEND_API_KEY`, `ACTIVATION_EMAIL_FROM` e `ACTIVATION_PUBLIC_URL` (origem HTTPS acessível aos destinatários). A chave de ownership já configurada no worker é usada com separação de domínio para derivar os tokens. Reiniciar o runtime após configurar. Não alterar essa chave enquanto houver convites válidos.

Resend conserva as chaves de idempotência durante 24 horas. O serviço recusa reenvio técnico após a expiração do convite. Referência https://resend.com/changelog/idempotency-keys
