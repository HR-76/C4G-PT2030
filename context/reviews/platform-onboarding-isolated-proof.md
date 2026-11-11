# Prova isolada — ativação manual e segunda entidade

Estado: Review — prova de viabilidade executada com sucesso em 18/10/2026. O utilizador autorizou este ensaio antes de ligar o formulário ao ambiente habitual. O resultado não fecha a feature Entidades e utilizadores nem autoriza rollout da extensão experimental.

## Resultado observado

Gate final terminou com código zero e `MANUAL_ACTIVATION_AND_SECOND_TENANT_PROOF_PASS`. [Relatório sanitizado](../../output/playwright/c4g-onboarding-proof/verification.json). Imagem Java compilada com Maven/JDK 21 e Keycloak 26.8.0; Chrome real, OIDC com assinatura/JWKS, PKCE, state e nonce; PostgreSQL descartável com Central e duas bases tenant, migrações atuais e repositories reais de diretório.

| Percurso | Resultado |
| --- | --- |
| Conta nova, ligação manual, palavra-passe definida no Keycloak e retorno OIDC | PASS. Sem password escolhida pela C4G; email permanece não verificado. |
| Conta existente recebe vínculo adicional | PASS. Mesmo utilizador global, password existente utilizada e membership anterior preservada. |
| Conta autenticada diferente do destinatário | PASS: ativação recusada. |
| Ligação expirada, revogada ou utilizada | PASS: recusa sem ativação. |
| Revogar depois de abrir o formulário da password | PASS: POST recusado, zero credenciais de password nessa conta e nenhum acesso ativado. |
| Nova ligação após revogação | PASS: nova funciona; anterior permanece revogada. |
| GET de pré-visualização/scanner | PASS: não consome nem aceita o convite. |
| Falha após UPDATE de consumo e dois consumidores concorrentes | PASS: rollback devolve estado OPEN; concorrência permite um único consumo. |
| Segunda entidade: migrações, diretório persistido, falha/retoma | PASS. Não duplica tenant; publicação antes de prontidão recusada. |
| Bases A/B e credenciais API | PASS: acesso físico à outra base recusado e leituras privadas HTTP isoladas. |
| Worker | ACLs CONNECT separadas verificadas; não foi executado job com essas credenciais. |
| Administrador da nova entidade | Perfil/grants ORG_ADMIN atuais aplicados pela fixture; leitura de Acessos autorizada. |
| Candidatura privada de A e tarefa preexistente | Candidatura recusada a B/ausente da lista; tarefa preservada integralmente. |
| Catálogo comum | Leitura autorizada a A e B; coleção de ensaio vazia e igual. Não prova importação nova. |

O campo `lastCallbackError` do relatório regista a recusa intencional da conta errada; o estado final PASS resulta das asserções que verificaram essa recusa.

## Descobertas e correções durante o ensaio

1. O registo da ação requerida usa `authentication/register-required-action`, seguido da configuração por alias; o endpoint inicial incorreto foi corrigido no código de ensaio.
2. No formulário transitório com política no-referrer, o browser enviou uma origem opaca. O gate passou a usar nonce CSRF ligado a cookie HttpOnly/SameSite=Strict, validade e uso único, cumulativo com Sec-Fetch-Site same-origin e validação de Origin. Não se removeu a proteção para fazer o teste passar.
3. A direção comprovada foi uma extensão mínima Authenticator + RequiredAction, que delega a password ao UpdatePassword nativo. Não foi necessário ativar email, expor chaves do realm, criar passwords conhecidas pela C4G ou habilitar registo público. A adoção desta extensão no produto ainda precisa de contrato de operação/manutenção e integração final.

## Limites que permanecem

- O callback OIDC é real, mas a associação final e sessão HTTP usam helpers de teste já existentes. Não existe ainda coordenador persistido que torne convite, identidade, grants, projeções e sessão um percurso de produto recuperável.
- A transação de consumo é testada isoladamente. Falha entre consumo e criação do vínculo, perda de resposta entre sistemas e revogação durante o commit final exigem retoma/reconciliação; não se declara atomicidade distribuída.
- A preparação usa bases e schemas reais, mas não valida backup/restore, serviço de provisionamento de produção, credenciais externas, disponibilidade pública ou entrega de links a clientes reais.
- Não existem ainda rotas administrativas C4G de criação/emissão, auditoria F7 dos novos comandos, rate limiting operacional ou interface final ligada. A extensão tem endereço/realm de laboratório e não deve ser instalada tal como está.
- A política de MFA sintética dos helpers HTTP não significa que foi realizado MFA no login da prova. A decisão anterior sobre MFA opcional mantém-se.
- A captura do formulário nativo Keycloak está em inglês e a página de conclusão é técnica. São evidência funcional, não a apresentação final C4G ou comparação visual do piloto.

## Preservação e validação

Fontes adicionadas em [test/integration/platform-onboarding](../../test/integration/platform-onboarding/README.md); uma chamada opt-in adicionada ao gate de integração existente. O restante diff desse gate já existia e foi preservado. Nenhuma rota/código runtime, migration de produto, conta real ou base habitual foi alterada.

Maven/Java e node --check dos JavaScript de ensaio/hook PASS; git diff --check dos ficheiros rastreados tocados PASS. Não houve alteração ao frontend de produto, pelo que não foi necessário npm run build. [Formulário nativo](../../output/playwright/c4g-onboarding-proof/native-password-form.png) e [conclusão](../../output/playwright/c4g-onboarding-proof/activation-complete.png) inspecionados visualmente. Captura de falha anterior preservada como diagnóstico; não representa o resultado final.

No final, zero contentores com a etiqueta do ensaio; contentores habituais preservados. Health habitual consultado: ready=true, workerReady=true. Sem reinício da aplicação, alterações no realm habitual, envio de email, imports reais, commit ou deploy. Imagem Docker experimental mantida apenas como artefacto local de repetição.

## Recomendação

A viabilidade técnica está demonstrada. Avançar para o incremento de produto com os repositories existentes, diretório dinâmico por entidade e uma ponte de identidade restrita. Prioridade seguinte: coordenador persistido de criação/ativação, autoridade C4G e auditoria próprias, incluindo recuperação após consumo do convite. Só depois ligar o formulário e demonstrar o percurso na aplicação habitual.

Próximo passo: implementar o serviço de criação e ativação recuperável, com autorização/auditoria C4G, antes de ligar o ecrã de Entidades ao ambiente habitual.
