# Decisão: cookie de sessão, CSRF e política de origem

## Estado

Aceite em 2026-10-04 como F2-D2 da Fundação de Segurança, Privacidade e Auditoria.

## Decisão

- Em produção, o frontend e a API partilham a mesma origem pública.
- O reverse proxy publica a API sob `/api` nessa origem.
- O cookie de sessão usa o prefixo `__Host-` e os atributos `Secure`, `HttpOnly`, `Path=/` e `SameSite=Lax`.
- O cookie não define o atributo `Domain` e, por isso, permanece host-only.
- As operações que alteram estado exigem um token CSRF associado à sessão e enviado num header próprio.
- A API valida o header `Origin` e, quando este não estiver disponível num fluxo admissível, valida `Referer` segundo uma política estrita.
- `SameSite` é uma defesa adicional e não substitui a validação do token CSRF nem da origem.
- O fluxo normal de produção não ativa CORS entre o frontend e a API.
- O desenvolvimento local pode autorizar apenas origins exatas, explicitamente configuradas por ambiente; wildcard com credenciais é proibido.
- Pedidos credenciados provenientes de origins não autorizadas são recusados.
- O MVP não adota frontend e API cross-site nem depende de cookies third-party.
- As exceções técnicas necessárias ao callback OIDC são limitadas ao fluxo de autenticação e validadas através de `state`, `nonce` e PKCE; não constituem uma exceção genérica à proteção CSRF de operações mutáveis.

## Fronteiras

- Keycloak mantém a responsabilidade pela autenticação e pelo fluxo OIDC; a aplicação mantém a responsabilidade pela sessão aplicacional e pelas defesas CSRF da sua API.
- Esta decisão define o contrato de segurança e a topologia pública, mas não aprova configuração de reverse proxy, nomes de domínios, origins concretas, header concreto, formato do token CSRF, bibliotecas ou infraestrutura.
- Os endpoints OIDC de início e callback são navegações de autenticação explicitamente modeladas; não tornam admissíveis pedidos mutáveis cross-site.
- Instalações futuras com topologia diferente exigem decisão própria e não alteram silenciosamente a política do MVP.

## Consequências

- `SEC-AC-01` deve comprovar que o cookie respeita os atributos aprovados e que tokens OIDC não são expostos ao browser, URL ou logs.
- `SEC-AC-03` deve incluir testes negativos para token CSRF ausente, inválido, reutilizado fora da sessão ou apresentado a partir de origem não autorizada.
- Os testes por ambiente devem cobrir a ausência de CORS no fluxo normal de produção e a allowlist exata no desenvolvimento local.
- O reverse proxy tem de preservar a origem pública e encaminhar `/api` de forma consistente, sem expor diretamente a porta interna da API.
- A futura migração do piloto tem de retirar o JWT do `localStorage` e substituir o contrato de autenticação do cliente pelo cookie de sessão e pelo mecanismo CSRF aprovados.

## Referências

- `context/features/security-privacy-and-audit-foundation.md`
- `context/architecture.md`
- `context/decisions/application-session-lifecycle.md`
- `context/decisions/hosting-and-external-services.md`

## Clarificacao operacional F2

- A prova CSRF e derivada por HMAC do identificador de sessao ja autenticado pela assinatura do cookie. Continua ligada ao SID, roda com o SID e e verificavel sem ler o session store.
- Esta forma permite que o logout degradado mantenha CSRF e origem estritos quando o store falha antes do controller; nao cria uma excecao permissiva para pedidos mutaveis.
