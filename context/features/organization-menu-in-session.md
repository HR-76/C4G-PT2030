# Menu «Organização» a partir da sessão

Estado: Review. Sem medição nem prova em ambiente real.

Seguimento do ponto 4 das [páginas da Organização](organization-pages-opening-performance.md), pedido pelo utilizador em 14/11/2026.

## Antes

Em cada carregamento completo, a moldura fazia dois pedidos (contexto do diretório e acessos) depois de a página carregar e só então mostrava o grupo «Organização» do menu. Perfis sem essas permissões (Técnico, Consulta) faziam os mesmos pedidos e recebiam duas recusas, com a respetiva auditoria.

## Alterações

- **Servidor.** `navigationFor(profileCode)` passa a incluir `directory`, `units` e `access`, derivados das permissões que o perfil recebe em `accessProfiles.js` (`organization_directory.read`, `organizational_scope.read`, `organization_membership.read`). A sessão já devolvia `organization.navigation`; só ganha estas três chaves. É apresentação: cada página continua a ser autorizada pelo motor.
- **Frontend (`Layout`).** O menu e a pesquisa de páginas usam de imediato a resposta da sessão. Os pedidos de contexto e de acessos continuam a correr para o que a sessão oferece: deixam essas páginas abrir de imediato e corrigem o menu se o servidor recusar (401, 403 ou 404). Uma falha que não seja recusa deixa de esconder o que a sessão ofereceu. Um perfil a quem a sessão não oferece nada não faz nenhum destes pedidos. Com uma API anterior, sem estas chaves, o menu espera pelos pedidos, como antes.

## Fora de âmbito

A ligação «Faturação» do menu depende de uma concessão individual (`billing.read`), não do perfil, e continua a aparecer depois do seu pedido.

## Critérios de aceitação

- Para cada perfil, `directory`, `units` e `access` coincidem com as permissões concedidas por `grantsForProfile`.
- Com a sessão a oferecer a área, as quatro ligações aparecem antes de qualquer resposta.
- Sem nada oferecido, não há pedidos de contexto nem de acessos.
- Uma recusa do servidor retira a ligação; uma falha de serviço não.

## Validação

- Backend: `applicationInterestContracts.test.js` (ajustado, +1) e `security/f3MembershipContext.test.js` (ajustado ao novo contrato da sessão); suite 3265 aprovados, 9 ignorados, 0 falhas.
- Frontend: `C4gShell.test.jsx` (+4); suite 1100 aprovados; build e lint aprovados.
- Sem browser nem sessão real.
