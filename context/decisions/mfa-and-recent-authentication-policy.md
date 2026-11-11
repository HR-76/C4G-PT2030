# Decisão: MFA e autenticação recente

## Estado

Aceite em 2026-10-04 como F2-D3 da Fundação de Segurança, Privacidade e Auditoria.

Política de evidência TOTP clarificada e aprovada em 2026-10-05.

## Decisão

- MFA é obrigatório para administradores C4G, suporte e administradores das organizações.
- Cada organização pode exigir MFA a todos os seus membros, mas nunca reduzir os mínimos definidos pela C4G.
- Ações sensíveis exigem autenticação recente ou MFA recente conforme uma categoria de risco.
- As janelas de autenticação recente são configuráveis, versionadas e definidas fora do código.
- O catálogo definitivo de ações sensíveis e respetivas categorias será fechado em F5/D11; não pode enfraquecer os mínimos desta decisão.
- O step-up é executado pelo Keycloak; a aplicação não implementa um mecanismo MFA próprio.
- A API valida no servidor `issuer`, `audience`, assinatura, `state`, `nonce`, PKCE, `auth_time`, `acr` e `amr`, conforme aplicável ao fluxo e à prova exigida.
- Roles, flags ou qualquer estado fornecido pelo browser nunca constituem prova de MFA.
- Depois de um step-up válido, a aplicação roda o identificador da sessão antes de retomar a operação.
- Ausência, expiração, insuficiência ou ambiguidade da evidência necessária implica recusa da ação.
- Recuperação e alteração de fatores são tratadas pelo Keycloak e devem produzir os eventos de auditoria aplicáveis na plataforma.

### Evidência autoritativa para MFA com TOTP

- `c4g-loa2` é a prova autoritativa de que o flow Keycloak atingiu o nível MFA configurado, mas nunca é suficiente isoladamente.
- A aplicação exige cumulativamente um token OIDC integralmente validado, `acr` exatamente igual a `c4g-loa2`, `amr` contendo `otp`, `auth_time` dentro da janela aplicável e a versão reconhecida da política e do mapa ACR/LoA.
- A versão configurada por `AUTH_POLICY_VERSION` identifica conjuntamente a política de assurance e o mapa ACR/LoA declarativo usado nessa decisão. Evidência criada sob outra versão falha fechado.
- `amr` não tem de conter `pwd`: o mapper oficial publica as referências das executions preservadas em `AUTHENTICATORS_COMPLETED`, pelo que a password validada no LoA 1 pode não constar do claim quando o LoA 2 termina em TOTP.
- `amr=["otp"]` isolado também não é suficiente; só satisfaz MFA quando acompanhado pelo `acr=c4g-loa2`, recência e versão reconhecida.
- Claims hardcoded, claims fornecidas pelo browser e mappers que inventem métodos de autenticação são proibidos.
- O mapa `c4g-loa1`/`c4g-loa2` e os flows Keycloak permanecem declarativos, versionados e sujeitos a testes de import e integração.
- A aplicação mantém um manifesto reconhecido por versão que vincula o conteúdo integral da política, a categoria privilegiada e o mapa `c4g-loa1=1`/`c4g-loa2=2`; uma versão desconhecida ou conteúdo alterado sob a mesma versão impede o arranque.
- ACR desconhecido, AMR sem `otp`, evidência expirada ou divergência de configuração produzem recusa.

## Fronteiras

- Keycloak é a fonte de verdade da autenticação, dos fatores, da recuperação e da evidência de assurance.
- A API é responsável por validar a resposta OIDC, associar apenas evidência validada à sessão server-side e aplicar a política exigida por cada ação.
- A base central conserva apenas os metadados mínimos necessários para sessão, decisão e auditoria; não duplica fatores, segredos MFA ou credenciais.
- Esta decisão fixa os identificadores `c4g-loa1`/`c4g-loa2` e a regra cumulativa para TOTP; não fixa valores concretos para janelas, configuração operacional Keycloak, catálogo final de ações ou schema.

## Consequências

- `SEC-AC-04` deve provar os mínimos por perfil, a política opcional da organização, o step-up, a rotação da sessão e a recusa de evidência ausente, expirada, insuficiente ou ambígua.
- A política de sessão deve conservar o instante, o nível e o método de autenticação validados, juntamente com a versão da política usada na decisão.
- A autorização futura deve pedir uma categoria de assurance, não interpretar diretamente roles como prova de MFA.
- Alterações e recuperação de fatores exigem integração de eventos e auditoria sem transportar segredos ou dados dos fatores.
- A indisponibilidade do Keycloak ou a impossibilidade de validar a prova exigida faz a ação protegida falhar fechado.

## Referências

- `context/features/security-privacy-and-audit-foundation.md`
- `context/decisions/application-session-lifecycle.md`
- `context/decisions/session-cookie-csrf-and-origin-policy.md`
- `context/decisions/multi-tenant-identity-and-data.md`
