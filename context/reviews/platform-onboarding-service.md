# Serviço central de criação e ativação — 18/10/2026

Estado: Review. Incremento backend implementado e validado isoladamente. Não corresponde à disponibilização do percurso no ambiente habitual.

## Implementado

- Serviço em `backend/src/platformOnboarding/`: entidade PROVISIONING, etapas IDENTITY/TENANT/PROJECTION, convite manual e ativação do primeiro ORG_ADMIN. Identificadores e progresso persistem na central; erros externos não provocam eliminação nem compensação destrutiva.
- Sessão central ativa, versão de revogação, utilizador ativo e atribuição C4G_ADMIN revalidados em cada comando administrativo e na confirmação dos efeitos externos. Admin/gestor de entidade não substituem C4G. Emissor do convite revalidado na ativação.
- Leases de 60 segundos e fence impedem confirmar uma tentativa antiga. Repetição da criação compara intenção; emissão repetida devolve metadados, nunca recupera segredo. Para obter outra ligação, substituir o convite.
- Segredos de 256 bits, apenas digests persistidos; validade inicial de 24 horas e troca ligada ao navegador durante 10 minutos. Nova troca invalida a anterior. Claims HTTP não são prova de identidade: verificação pertence ao adaptador OIDC confiável.
- Ativação central única: membership, grants ORG_ADMIN limitados à entidade, consumo do convite, conclusão e F7 na mesma transação. Conta existente mantém identidade e outros vínculos. C4G não recebe membership automaticamente.
- Migração aditiva `020_platform_onboarding`, consultas fechadas e seis eventos F7. Sem down destrutivo: conservar histórico e convites consumidos. Migrações anteriores preservadas.
- Factory `platformOnboardingRoutes.js` exige middleware de sessão, CSRF e contexto transitório; respostas sem cache e erros sanitizados. Não montada no `app.js`/composição habitual. Conferido `frontend/src/api/api.js`: nenhuma chamada nova nem alteração do contrato usado pelo ecrã atual.

## Validação executada

1. `service-gate.ps1 -Probe`: PostgreSQL 17 descartável; migração, fingerprints de esquema/ACL/protocolo e checksum medidos e fixados. Sequência completa também validada pelo gate seguinte.
2. `service-gate.ps1`: **17 grupos PASS**, PostgreSQL real e login restrito `c4g_authority_runtime`. Criação concorrente, falha após efeito externo, retoma noutra instância, membership pendente, substituição/expiração/revogação, identidade e navegador errados, rollback F7, segunda entidade da mesma pessoa, revogação C4G durante preparação, sessões inválidas, fence antigo, ativação concorrente, preparação insuficiente e fronteira HTTP.
3. Perda da resposta de COMMIT injetada depois de PostgreSQL confirmar a ativação: repetição devolveu o recibo persistido, com apenas um evento de ativação.
4. **54 testes direcionados PASS**: contratos, F7, manifesto/preflight, coordenador de autoridade e perfis internos. O sandbox impediu inicialmente processos filhos; repetição autorizada passou.
5. `node --check`: **17 ficheiros PASS**. Frontend não alterado; build visual não aplicável.

Evidência sem segredos: `output/playwright/c4g-onboarding-service/migration.json` e `verification.json`. Containers/bases descartáveis removidos pelo gate. Nenhuma base habitual migrada, conta real criada ou mensagem enviada.

## Fronteira ainda por integrar

Os testes deste serviço usam adaptadores sintéticos de IdP, execução do provisionamento, projeção e verificação OIDC. Diretório central, protocolo de autoridade, F7 e transações são reais. A prova anterior com Keycloak/Chrome/bases físicas é separada; não prova a integração deste serviço com esses transportes.

A composição seguinte deve fornecer adaptadores que reconciliem efeitos pelo operationId e ownership, imponham timeout/cancelamento e não associem uma identidade desconhecida apenas por email. Conflitos de identidade exigem reconciliação, nunca alteração automática de credenciais. Confirmar migrações, isolamento físico e projeções antes de responder ao serviço. Credenciais de criação de bases/administração do IdP não pertencem ao runtime HTTP.

OIDC deve verificar assinatura, issuer/audience, state/nonce/PKCE, contexto transitório e conclusão da definição de password para conta nova. Sessão real com idle policy, CSRF, cookie HttpOnly/SameSite e controlo de abuso são requisitos da composição pública. Não instalar a SPI experimental no realm habitual neste incremento. Convites não criam sessão autenticada: depois da ativação usa-se login normal.

Atualização de 18/10/2026: a [integração dos adaptadores reais](platform-onboarding-real-adapters.md) passou posteriormente em composição isolada, com 12 grupos Keycloak/PostgreSQL/Chrome e sessões/memberships reais. A descrição acima dos adaptadores sintéticos continua a caracterizar este gate do serviço, não o novo gate integrado.

Próximo passo: preparar a composição do ambiente habitual e a configuração operacional da ativação antes de ligar o ecrã.
