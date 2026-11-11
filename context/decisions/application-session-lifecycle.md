# Decisão: ciclo de vida da sessão aplicacional

## Estado

Aceite em 2026-10-04 como F2-D1 da Fundação de Segurança, Privacidade e Auditoria.

## Decisão

- As sessões aplicacionais são server-side e persistidas na base central C4G.
- O cookie contém apenas um identificador opaco; não contém identidade, roles, memberships, permissões ou tokens.
- Os tokens Keycloak permanecem exclusivamente no servidor e são protegidos em repouso.
- As expirações idle e absoluta são políticas configuráveis e versionadas; os prazos concretos não ficam hardcoded nesta fase.
- A renovação pode prolongar a expiração idle, mas nunca ultrapassa a expiração absoluta.
- O identificador de sessão roda após login, callback OIDC concluído, alteração de privilégio, autenticação recente e outros limites de confiança que venham a ser aprovados.
- A revogação pode produzir efeito imediato por sessão, utilizador e membership/organização quando aplicável.
- O logout local invalida a sessão aplicacional e coordena o logout com Keycloak.
- Sessões simultâneas são individualmente identificáveis e revogáveis.
- A sessão conserva apenas metadados mínimos necessários ao controlo e à auditoria, sem expor tokens em logs.
- Falha de validação, estado inválido, expiração ou impossibilidade de confirmar a sessão resulta em recusa de acesso.

## Fronteiras

- Keycloak continua a ser a fonte de verdade de credenciais, autenticação, MFA e sessão de identidade.
- A base central é a fonte de verdade da sessão e autorização aplicacionais.
- A membership central ativa continua a ser a fonte de verdade do acesso a uma organização.
- Esta decisão não aprova schema, SQL, biblioteca, algoritmo de proteção em repouso, prazos concretos, configuração Keycloak ou infraestrutura.

## Consequências

- `SEC-AC-01` e `SEC-AC-03` devem ser testados contra uma sessão revogável e persistida no servidor, nunca contra JWT autónomo no browser.
- A futura F3 deve concretizar a propagação de revogação por utilizador e membership/organização e a troca segura de organização.
- A política de cookie, CSRF, CORS e domínios de F2-D2 tem de preservar esta sessão opaca.
- A política de MFA e autenticação recente de F2-D3 tem de provocar rotação nos limites de confiança aprovados.
- A migração do piloto deve retirar tokens do `localStorage` e invalidar o mecanismo legado no cutover aprovado.

## Referências

- `context/features/security-privacy-and-audit-foundation.md`
- `context/decisions/multi-tenant-identity-and-data.md`
- `context/decisions/future-data-model.md`
- `context/references/logical-data-dictionary.md`
