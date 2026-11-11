# MFA opcional — evidência de 2026-10-17

Estado: Review. [Contrato](../features/optional-user-mfa.md) e [decisão explícita](../decisions/2026-10-17-user-optional-mfa.md) implementados na instalação local. Sem commit, publicação ou configuração de produção.

## Comportamento entregue

- `admin` e `hugo` entram em `http://localhost:3000` com as passwords anteriores, sem OTP por defeito. Segurança da conta → Gerir password e MFA abre as definições autenticadas do titular.
- Realm local `c4g-native-local` separado da demonstração; password obrigatória e OTP condicional à existência do autenticador configurado pelo titular. Autenticadores não são criados automaticamente. Repetir o instalador conserva os fatores e as passwords escolhidos pelo utilizador.
- Política reconhecida `c4g-user-mfa-v1`, categoria `recent-auth`, sem MFA obrigatório no login privilegiado ou nas ações sensíveis. Estas conservam a janela anterior de autenticação recente de 300 segundos. As permissões, isolamento, SoD, CAS e revogações mantêm-se.
- Evidência de sessão da política anterior é recusada. A autorização sensível com password é auditada como `SESSION`, sem declaração falsa de `RECENT_MFA`. A política antiga não foi modificada.
- Configuração anterior copiada para ficheiros privados ignorados pelo Git, no mesmo diretório protegido. Vínculos OIDC anteriores conservados; novos sujeitos ligados aos mesmos utilizadores globais. O ficheiro de acessos atual contém apenas credenciais iniciais, sem segredo TOTP.
- Textos dos percursos de importação, publicação, qualificação e decisão passam a referir confirmação de autenticação, sem anunciar MFA obrigatório independentemente da política.

## Verificação executada

1. `node test/integration/local-platform/gate.js`: PASS em PostgreSQL 18 isolado 5564, frontend/API 5190/5191, Chrome real e realm exclusivo de validação. Instalação/repetição, isolamento das bases, ambos os logins só com password, permissões distintas, ativação real através do Account Console, código errado recusado, reexecução do instalador com OTP ativo preservado, desativação pelo titular, login seguinte sem OTP e reinício com identidades conservadas. Endpoints de definições/gestão recusam acesso anónimo. Cluster de validação parado no fim; dados preservados.
2. Atualização nativa: cópias privadas anteriores, igualdade de passwords, IDs centrais, membership e grants comprovadas automaticamente. Hashes da configuração do realm, clientes, fluxos e credenciais do administrador da demonstração iguais antes/depois. Ambos os utilizadores locais sem OTP após a atualização inicial.
3. `node test/integration/local-platform/verifyNative.js`: PASS contra `npm run dev` em 3000/5000 e bases 5432. Admin acede às fontes sem receber acesso privado implícito; Hugo acede ao catálogo/área privada/candidaturas e recebe 403 na administração. Seleção de organização estrangeira recusada. Central 47 tabelas, tenant 128; zero oportunidades nas duas bases. Página de segurança disponível também ao admin sem membership.
4. Backend: 63 testes focados PASS (`optionalMfa`, `localPlatformConfiguration`, `security/f2Security`, `productionCompositionParity`, com a exclusão explícita abaixo); sintaxe dos ficheiros alterados PASS. Novos testes provam política reconhecida, recusa de política adulterada, bindings de realm, ação sensível com password sem falsa auditoria MFA, recusa de falta de grants/SoD/organização estrangeira/evidência expirada e URL de gestão fixada pelo servidor.
5. Frontend: 54 testes em 11 ficheiros PASS (conta, shell, documentos/decisão, editorial, PQ1 e pré-qualificação); build final PASS. Captura privada da página de segurança inspecionada: ligação e instruções legíveis, navegação C4G preservada. `git diff --check` dos ficheiros acompanhados passou.

## Limites e compatibilidade

- A execução integral de F2 encontrou uma falha independente da alteração de MFA: `frontend persists only the approved editorial recovery envelope, never authentication` encontra `sessionStorage` no novo diretório `pages/Organization`, pertencente ao trabalho paralelo. A regressão focada foi executada com `--test-skip-pattern='frontend persists only'`; 63 testes admitidos passaram. Não se alterou nem se relaxou essa asserção. Não declarar a suite geral integralmente verde.
- O rótulo histórico `organization.mfa_policy_code` das organizações existentes fica preservado. O runtime não o consome; a autoridade efetiva usa `authority_f5_state.policy_version` e `assurance_requirements`, atualizados com CAS e preservação dos grants. Novas organizações deste instalador usam o rótulo `USER_OPTIONAL`. Não se ampliou o protocolo SQL protegido nem se alteraram migrations aplicadas.
- Esta prova não configura recuperação por e-mail, infraestrutura produtiva ou novos utilizadores convidados. A instalação mantém os limites locais documentados em [LOCAL.md](../../LOCAL.md).
- Os controlos MFA antigos continuam disponíveis para ambientes históricos que usem explicitamente a política anterior. O realm da demonstração permaneceu intacto; não é a instalação nativa agora atualizada.

## Referências de implementação

Fluxo OTP condicional documentado pelo [Keycloak](https://www.keycloak.org/docs/latest/server_admin/index.html#_authentication-flows). Confirmadas na versão 26.8 as rotas do [Account Console](https://github.com/keycloak/keycloak/blob/26.8.0/js/apps/account-ui/src/routes.tsx), a [gestão de autenticadores pelo titular](https://github.com/keycloak/keycloak/blob/26.8.0/js/apps/account-ui/src/account-security/SigningIn.tsx) e o [formulário de confirmação TOTP](https://github.com/keycloak/keycloak/blob/26.8.0/themes/src/main/resources/theme/base/login/login-config-totp.ftl). Os testes usam estes percursos reais, sem substituir o login por tokens artificiais.

Próximo passo: revisão de utilização dos dois acessos locais e da opção Segurança da conta.
