# Decisão: identidade global e base por organização

## Estado

Aceite.

Nota de evolução: a política de MFA deste registo foi substituída em 2026-10-17. A cardinalidade atual de memberships e a resolução automática da organização seguem [Arquitetura](../architecture.md), não uma interpretação de que a organização é escolhida entre várias memberships ativas. As restantes cláusulas históricas são mantidas para contexto.

## Decisão

- Keycloak C4G é responsável por credenciais, autenticação, verificação de e-mail, recuperação, MFA, sessões de identidade e federação OIDC/SAML.
- A base central C4G mantém identidade aplicacional, organizações, memberships, convites, organização ativa e autorização funcional.
- Cada organização tem uma base Neon separada com o mesmo esquema e versão.
- A membership central é a fonte de verdade do acesso.
- A base do cliente guarda `global_user_id`, perfil local, unidades, permissões, equipas e dados operacionais.
- Credenciais, MFA e sessões nunca são duplicados.
- `UNIQUE(user_id, organization_id)` na membership central.
- A API resolve a base apenas depois de validar sessão e membership.

## Sessão e MFA

- OpenID Connect Authorization Code Flow com PKCE.
- Cookies `HttpOnly`, `Secure` e `SameSite` adequado; sem tokens em `localStorage`.
- **Substituído em 2026-10-17:** a obrigatoriedade anterior de MFA para perfis privilegiados e a possibilidade de imposição por organização não representam a política corrente. A [decisão posterior](2026-10-17-user-optional-mfa.md) estabelece MFA opcional por escolha individual, incluindo ações administrativas e sensíveis; mantém autenticação recente e os restantes controlos ali descritos.
- Um realm C4G único é o padrão inicial; identidade válida não concede acesso a uma organização.

## Autorização

Resultado de identidade, organização selecionada, perfil da membership, unidades, equipas, participação e recurso. Mudanças críticas produzem efeito imediato ou através de cache curta revogável.

## Sincronização

Outbox central e eventos idempotentes sincronizam projeções locais. Inclui retries, fila de erro, estado de sincronização e reconciliação periódica. Uma membership só fica operacional quando o perfil local obrigatório existir.

## Exceção dedicada

Identidade autónoma apenas por exigência contratual, através de adaptadores e sem fork do produto.
