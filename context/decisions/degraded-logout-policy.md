# Decisão: logout degradado no MVP

## Estado

Aceite em 2026-10-05 como política operacional de F2 para falhas simultâneas das persistências de sessão.

## Decisão

- O logout limpa sempre o cookie local, mesmo quando o registry ou o session store estão indisponíveis.
- Uma falha de revogação persistente devolve `503 LOGOUT_INCOMPLETE`; a aplicação nunca comunica sucesso nesse caso.
- A autenticação permanece fail-closed enquanto não for possível validar a sessão na base central.
- A aplicação tenta coordenar o logout com o Keycloak mesmo quando a revogação local fica incompleta.
- A resposta degradada sinaliza `retryRequired` e fornece o URL de logout do Keycloak; o cliente limpa o estado local e conclui a navegação federada sem transformar o `503` em sucesso.
- Depois da recuperação das dependências, o utilizador deve autenticar-se novamente e repetir o logout. Este retry confirma o estado recuperado, mas não garante revogação da cópia roubada do SID anterior, que permanece o risco residual aceite.
- O MVP não introduz Redis, broker, outbox de logout ou outro armazenamento secundário para este fluxo.

## Risco residual aceite

Se uma cópia do cookie tiver sido roubada antes do logout e registry e store falharem simultaneamente, essa cópia poderá voltar a ser utilizável depois da recuperação, caso os dois registos persistentes tenham permanecido ativos. O `503` e a limpeza do cookie protegem o browser que iniciou o logout, mas não constituem revogação durável da cópia roubada.

Este risco é aceite apenas para o MVP e deve ser reavaliado antes de aumentar a exposição, os requisitos contratuais ou o nível de assurance da plataforma.

## Condições operacionais

- Indisponibilidade da base central impede autenticação e não ativa fallback permissivo.
- O cliente trata explicitamente `LOGOUT_INCOMPLETE`, limpa o estado local e navega para o logout Keycloak. A resposta identifica que um novo logout é obrigatório após recuperação.
- A observabilidade distingue logout concluído, logout incompleto e indisponibilidade do logout de identidade, sem registar cookies ou tokens.
- Runbooks devem instruir o utilizador a repetir o logout e a equipa operacional a confirmar recuperação do registry/store.

## Consequências

- F2 não implementa uma fila durável de reconciliação de logout.
- A resposta `503 LOGOUT_INCOMPLETE` é comportamento esperado e não pode ser convertida em sucesso pelo frontend ou proxy.
- O logout coordenado no Keycloak é best-effort; a sua falha não restaura acesso local nem transforma um logout local incompleto em sucesso.

## Referências

- `context/features/security-privacy-and-audit-foundation.md`
- `context/decisions/application-session-lifecycle.md`
- `context/decisions/session-cookie-csrf-and-origin-policy.md`

## Clarificacao operacional F2

- Se a leitura inicial do session store falhar, apenas `GET /api/auth/csrf` e `POST /api/auth/logout` podem prosseguir com o SID previamente validado pela assinatura do cookie.
- O POST continua a exigir Origin/Referer exato e prova CSRF HMAC ligada ao SID; os restantes pedidos falham fechado.
