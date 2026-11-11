# Threat model: identidade e isolamento — validação isolada

Em 09/11/2026 foram repetidos os gates de sessão e revogação com PostgreSQL 17 e Keycloak 26.8 descartáveis, dois tenants sintéticos, portas locais e identificadores exclusivos. Não foram usadas bases habituais nem R2 real. Os contentores com os dois identificadores de execução deixaram de existir após os gates.

| Estado | Evidência | Risco e limitação | Correção | Teste |
| --- | --- | --- | --- | --- |
| PASS nos cenários exercitados | [Sessões](threat-identity-sessions-20261109-v2/results-sessions.json): OIDC/PKCE, cookie, renovação, CSRF, logout e rotação; isolamento SQL/RLS e roles. | Roubo/replay de sessão e desvio de organização continuam dependentes da configuração implantada. | Nenhum defeito reproduzido que justifique alteração de código neste recorte. | Gate de sessão com navegador e PostgreSQL descartáveis. |
| PASS nos cenários exercitados | [Revogação](threat-identity-revocation-20261109-v2/results-revocation.json): leitura concorrente com autoridade obsoleta recusada e leituras posteriores recusadas. | A prova não cobre todos os percursos nem todos os cenários de implantação. | Manter revalidação e falha fechada; ampliar os cenários de acordo com os percursos críticos. | Gate de revogação; `SERVICE_UNAVAILABLE` na corrida é recusa esperada. |
| PASS | Testes focados F2, F3 e F5: 92 PASS, zero falhas, com HTTP de loopback. Primeira tentativa na sandbox teve EACCES nas ligações locais; repetição com acesso ao loopback passou. | São testes de código e doubles, não prova da topologia real. | Sem alteração de código. | `node --test test/security/f2Security.test.js test/security/f3MembershipContext.test.js test/f5FunctionalAuthorization.test.js` a partir de backend. |

O leitor central não coordenado da fixture usa `pg_read_all_data`: os testes não demonstram equivalência dos privilégios efetivos da Central em produção. Também não verificam proxy, MFA OTP, política ou configuração implantada. A paridade deve ser avaliada num ambiente isolado com uma configuração de permissões explicitamente definida; não inferir que a aplicação implantada está protegida globalmente.

Os restantes fluxos do threat model permanecem para validação própria; o R2 real continua adiado. O matching acima de 1000 continua por implementar e não é resolvido por estes gates.
