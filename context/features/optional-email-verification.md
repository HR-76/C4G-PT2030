# Verificação adicional por email — AV-02 substituído

## Integração APP autorizada em 2026-10-25 — validada localmente

O componente externo RC4 foi validado no Keycloak 26.8.0; o histórico abaixo conserva as fases anteriores.
Esta fase integra a APP sem alterar o ciclo de desafios nem a política documental.

- Configuração explícita `OIDC_EMAIL_VERIFICATION=keycloak-account-v1`; ausência mantém estado indisponível, nunca OFF presumido.
- Consulta server-side da API Account do próprio utilizador, limitada ao tipo `email-authenticator`, sem administração. Token de acesso cifrado AES-256-GCM na sessão server-side, ligado a issuer/subject; chave derivada por HKDF da SESSION_SECRET, máximo 1800 s (30 minutos), sem refresh token e nunca além da validade emitida pelo fornecedor. Expiração exige nova autenticação explícita; falha não é convertida em opção desativada.
- Ajuste solicitado em 2026-11-06: a consulta deve continuar disponível depois dos 5 minutos e até aos 30 minutos após autenticação; configurar também o cliente OIDC local para emitir tokens de 1800 s. Testar expiração aos 30 minutos e respeito por tokens de validade inferior. Sessões já emitidas conservam a validade original.
- Validação do ajuste: 10 testes focados PASS, verificações de sintaxe e build PASS. Cliente `c4g-native-local` atualizado e relido com `access.token.lifespan=1800`; valor anterior guardado no backup local. Suites gerais com 14 falhas frontend e 3 backend em áreas não alteradas (não classificadas como baseline comprovada nesta execução); logs em `.tmp/account-security-frontend-tests.log` e `.tmp/account-security-backend-bounded.log`.
- POST protegido por sessão, origem e CSRF inicia apenas `c4g-email-enable|disable`. Retorno fixo `/conta/seguranca`, state/nonce/PKCE preservados e identidade do retorno vinculada à sessão iniciadora.
- Nova consulta ao IdP após retorno; nenhum redirect, flag ou claim inventado prova o sucesso. Preferência permanece exclusivamente no IdP.
- Aceitação: login OFF pela APP; ativação e desativação pelos botões reais; estado confirmado; login ON só após SMTP local; cancelamento sem nova sessão; persistência após reinício; indisponibilidade/expiração explícitas; regressões proporcionais e build.
- Limites: entrypoint autónomo, serviços descartáveis, zero R2/SMTP externo; nenhuma alteração de realms existentes, dependências ou política de revisão; recuperação por perda de email continua pendente.

Resultado desta integração: PASS pelo entrypoint autónomo e browser real, com Keycloak 26.8.0/RC4, PostgreSQL e SMTP local. Ativação/desativação pelos botões da APP, consulta confirmada, login OFF/ON, cancelamento sem sessão e persistência após reinício da API comprovados. Evidência: `C:\Users\Utilizador\c4g-evidence\optional-email-app-integration\20261025-223907\report.md`. Configuração e limitações em `context/references/optional-email-app-integration.md`. SMTP externo, múltiplos nós e recuperação por perda do email não ficam validados.

Estado histórico anterior: Blocked no componente IdP; política documental implementada e validada localmente. Decisão explícita do utilizador em 2026-10-25. Substitui recuperação visual de TOTP obrigatório; não revoga mecanismos de contas existentes.

## Contrato aprovado

A preferência individual pertence ao IdP, não ao browser nem a uma segunda tabela da APP. Desativada: login normal e decisão documental com sessão válida e grants, sem MFA obrigatório. Ativada: cada nova sessão da APP exige código de email, inclusive com SSO existente; nenhuma sessão autorizada antes da conclusão. Preservar OIDC server-side, state, nonce, PKCE, TLS, CSRF, cookies e política de sessão.

Ativar e desativar exigem reautenticação recente e prova do email verificado. Mudança de endereço não transfere proteção para endereço não verificado. Perda do email não permite bypass informal; recuperação depende de procedimento aprovado, ainda não definido para este mecanismo.

Apenas `application.review.decide` deixa de exigir assurance adicional. Preservar membership, grants, organização/recurso, requerente e decisor distintos, versões exatas AVAILABLE/CLEAN, CAS, auditoria e idempotência. SUPPORT e operações sensíveis dos outros domínios mantêm a política existente. Não equiparar email a TOTP nem fabricar claims.

## Plano e dependência

1. Confirmar Keycloak/componentes locais e fontes oficiais, sem instalar.
2. Alterar política documental e linguagem da UI; acrescentar regressões sem inventar preferência/disponibilidade de email.
3. Provar login normal e decisão documental pelo browser real, com identidades sintéticas; reutilizar restantes provas anteriores.
4. Após aprovação de componente adequado: integrar preferência/desafio no IdP e testar ativação, desativação, SSO e falhas. Não implementar autenticador próprio.

Keycloak local 26.8.0 sem provider externo. Email depende de seleção e autorização específica de extensão. Enquanto bloqueado, mostrar indisponibilidade sem toggle fictício; preservar acesso à gestão existente da conta.

## Limites propostos, ainda não implementados

Código criptográfico de 8 dígitos; validade 300 s; transação 600 s; 5 tentativas cumulativas por transação, não repostas por reenvio; intervalo mínimo 60 s; no máximo 3 reenvios por transação e 5 emissões por utilizador em 15 minutos, acumuladas entre transações. Reautenticação para alteração da preferência no máximo 300 s.

Verificador protegido contra recuperação offline de códigos de baixa entropia; uso único e vínculo utilizador/transação; substituição invalida o anterior; falha de envio não autentica. Sem simulation mode, códigos/segredos em logs/URLs ou material de autenticação em localStorage.

## Aceitação

- Login e decisão sem MFA com autorização normal; preservar recusas de sessão, grants, membership, A/B, SoD e estados documentais.
- Opção ativa: código correto/incorreto/expirado/reutilizado/de outra transação, reenvios, limites, falha SMTP e SSO existente comprovados no IdP/browser reais.
- Ativação/desativação e persistência comprovadas na fonte IdP.
- SMTP local identificado; não inferir entrega externa, MFA forte ou operação VPS.

Sem novas migrations, alterações a realms existentes ou instalação de dependências nesta etapa. Migrations oficiais aplicadas apenas nas bases descartáveis do ensaio. Evidência: `C:\Users\Utilizador\c4g-evidence\optional-email-verification\20261025-202930`.

## Resultado local de 2026-10-25

18 testes backend, 17 frontend e build PASS. Chrome com Keycloak 26.8.0, PostgreSQL Central/Tenant reais e API pelo entrypoint normal: dois logins sem TOTP/email, associação e pedido pela UI, decisor distinto, HTTP 200, persistência do pedido/versão e auditoria SESSION. Claims reais observadas: acr c4g-loa1, amr vazio/pwd, nunca otp. Uma versão AVAILABLE/CLEAN foi preparada como fixture; não houve upload/scan/download ou reexecução das provas R2/OOXML. Recursos exclusivos removidos.

Isto comprova a política sem assurance adicional, não a alternância de uma preferência ainda inexistente. Todas as provas com email ativo continuam bloqueadas. A imagem local não contém provider de email OTP. O candidato `mesutpiskin/keycloak-2fa-email-authenticator` v26.7.2 publica artefacto KC26.8.0 e adesão individual, mas o código da ativação guarda verificador em claro, resend repõe tentativas e remoção não demonstra desafio de email. Não foi instalado; adoção exige versão adequada e autorização específica. Avaliação e fontes: `idp-assessment.md` na evidência externa. Sem alteração da configuração de utilizadores reais, nem promessa de MFA forte ou entrega de email.
