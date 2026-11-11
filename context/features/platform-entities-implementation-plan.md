# Entidades e primeiro administrador — plano de implementação

Estado: Prepared / feature Draft, 18/10/2026. Preparação técnica solicitada pelo utilizador; não é execução, migração ou ativação. [Contrato funcional e visual](platform-entities-and-users.md). Canal confirmado: ligação temporária entregue manualmente pela C4G, sem email automático.

## Conclusão da inspeção

Atualização de 18/10/2026: após a prova de viabilidade, o utilizador autorizou implementar o [serviço central recuperável](platform-onboarding-service.md). Este incremento está em Review, com migração e testes isolados; adaptadores operacionais e ligação do ecrã permanecem etapas seguintes. O estado Prepared acima descreve a preparação original do plano global.

É necessário um incremento integrado de administração central, preparação de tenant e identidade. Uma página com INSERT de organização ou uma password temporária não satisfaz o percurso aprovado. A fundação de autorização e isolamento pode ser reutilizada; faltam a coordenação da criação e a ativação manual.

| Evidência no repositório | Reutilização e trabalho necessário |
| --- | --- |
| `backend/database/central/migrations/000_central_identity_baseline.up.sql` | Identidade global e vínculo issuer/subject, com email global único; não criar outra identidade por entidade. |
| `backend/database/central/migrations/002_f3_organization_memberships.up.sql` | Organização e membership com estado PENDING_PROJECTION, revisão e unicidade pessoa/organização; faltam convites e operação de criação coordenada. |
| `backend/src/security/tenantProvisioningRepository.js` | Estados, atribuição única de tenant, concorrência e eventos; não provisiona sozinho a base nem a conta. |
| `backend/src/security/tenantDirectoryRepository.js` e `tenantWorkloadDirectoryRepository.js` | Diretório e referências verificadas; usar para resolução de múltiplas entidades. |
| `backend/scripts/localPlatform/runtime.js:66` | Substitui o diretório por snapshot de uma única organização. Precisa de evolução e prova antes de uma segunda entidade funcionar no ambiente habitual. A configuração de credenciais também contém apenas uma ligação. |
| `backend/src/security/localTenantIdentityProvisioner.js` | Identidades PostgreSQL API/worker e verificação de isolamento; ferramenta local privilegiada, não deve executar sob a API pública. |
| `backend/src/security/oidcClient.js` e `routes/oidcAuthRoutes.js` | Login/callback com PKCE, state e nonce; reutilizar. Não existe aqui um fluxo de convite/definição inicial de password. |
| `backend/src/security/identityRepository.js` | Só resolve conta ACTIVE previamente ligada a issuer/subject. Callback de convite tem de reconciliar essa ligação de forma explícita, sem associação oportunista por email. |
| `backend/src/organizationDirectory/accessProfiles.js` | Perfil ORG_ADMIN e grants atuais; atribuí-los pelo protocolo de autoridade, sem poderes C4G implícitos. |
| `backend/src/audit/` e `fundingTenders/audit.js` | Auditoria já tem catálogos/contratos fechados; acrescentar eventos próprios, não reutilizar eventos de oportunidades para criação de clientes. |
| `frontend/src/App.jsx`, `Sidebar.jsx`, `api/api.js` | Ligar rotas, menu e cliente próprios da plataforma, preservando `/utilizadores` organizacional. |

## 1. Prova de ativação sem email — primeira unidade de execução

Objetivo: provar em realm/contas descartáveis que a pessoa define a própria password no Keycloak, regressa por OIDC e aceita a entidade correta; expiração, revogação e substituição continuam eficazes durante todo o percurso.

O endpoint oficial `execute-actions-email` envia email e devolve 204; não é uma API para devolver uma ligação à aplicação. Não ativar SMTP fictício, capturar emails ou extrair tokens dos logs como solução. O guia oficial permite extensões por Action Token Handler SPI. O compose do repositório fixa Keycloak 26.8.0; confirmar a versão efetivamente usada antes da prova e fixar a compatibilidade da extensão.

Direção técnica recomendada para investigar: ponte mínima no Keycloak para a definição inicial de password de uma conta nova, usando ações nativas e autorização de uso único do convite central. Não entregar à API chaves de assinatura do realm, não recolher passwords na aplicação e não abrir registo público. A adoção da extensão é proposta técnica, ainda não uma decisão arquitetural aprovada; a prova deve produzir recomendação concreta, custo de manutenção e alternativa caso não cumpra os critérios. Não instalar a extensão no realm habitual nesta etapa.

Conta existente dispensa definição de password: OIDC normal, identidade exata esperada e confirmação do novo vínculo. Uma ligação de convite não pode servir para recuperar ou assumir uma conta existente.

Saída obrigatória: contrato verificável de emissão/troca/retorno, vínculo ao issuer/subject, sessão transitória, comportamento após resposta perdida, e prova de que revogar/substituir também impede concluir uma sessão de ativação anteriormente aberta. Um token derivado que permaneça utilizável após revogação não passa a prova. Aceitação só é consumida definitivamente quando a ativação central estiver confirmada; reservas de utilização precisam de expiração e retoma segura.

## 2. Modelo central e migrações aditivas

Desenhar migrações novas, sem alterar SQL já aplicado. Escolher números no momento de execução e atualizar manifests, hashes, catálogos, preflight e allowlists envolvidos, incluindo runtime local/worker que atualmente reconhecem versões fechadas.

Novos agregados propostos:

- **Operação de criação:** ID estável, autor C4G, chave de idempotência, digest da intenção, organização, fase, revisão, referências externas, erro sanitizado e recibo. Distinguir pedido persistido de efeito externo verificado.
- **Contacto/identificação administrativa:** país, identificação fiscal normalizada quando presente, sigla e website. Nome legal/display permanecem canónicos na organização central; perfil tenant recebe projeção controlada, não uma segunda verdade editável sem coordenação.
- **Convite do primeiro administrador:** ID, organização, identidade/destinatário esperado, perfil fixo ORG_ADMIN, digest do segredo, validade, revisão, emissão, substituição, revogação, reserva de uso e aceitação. Relações e restrições compostas impedem mistura entre entidades; apenas uma emissão corrente por intenção de acesso.
- **Eventos administrativos próprios:** criação/preparação, emissão/revogação/substituição e ativação, sem token, URL completa, password ou conteúdo pessoal desnecessário. Alteração central e evento crítico na mesma transação sempre que partilhem a base; efeitos externos usam estado persistido e reconciliação.

Ponto encontrado no esquema: `organization` exige `legal_name`, `type_code`, `reporting_currency` e política MFA. O formulário anterior não pode simplesmente omiti-los. Proposta a apresentar na revisão final: denominação legal com opção explícita “Igual ao nome da entidade”; tipo de entidade visível; moeda de reporting EUR sugerida e editável. MFA mantém a política já aprovada, sem nova obrigatoriedade. País não escolhe sozinho a região física. Não preencher tipo UBI nem atribuir um plano comercial por defeito. Estes ajustes de campos ficam propostos, não silenciosamente aprovados.

Para preparar um pedido incompleto, guardar a intenção no agregado de criação, sem fabricar valores legais para satisfazer NOT NULL. A entidade canónica só nasce quando os campos exigidos estiverem resolvidos. O estado PROVISIONING é real e não dá acesso.

## 3. Coordenação da criação e preparação local

1. Autorizar C4G atual, validar dados e persistir uma operação única. Repetição da mesma chave/conteúdo devolve o recibo; conteúdo diferente produz conflito.
2. Resolver destinatário e colisões. Preservar contas existentes. Criar conta nova no serviço de identidade apenas com ownership verificável da operação e sem password conhecida pela C4G.
3. Criar organização PROVISIONING e vínculo inicialmente inelegível quando houver identidade global definida; antes disso conservar o destinatário no convite, não fabricar um subject.
4. Preparar tenant através de adaptador controlado: base isolada, identidades API/worker distintas, migrations, marker, capabilities, ligação, backup e verificação. API não recebe CREATEDB, credenciais de migrador ou admin do realm.
5. Publicar ligação disponível só depois das verificações; resolver nova entidade pelo diretório e credenciais corretas. Atualizar API e worker em conjunto, preservando o tenant habitual.
6. Emitir convite apenas quando o espaço estiver preparado. Aceitação faz transição autorizada do vínculo, grants/projeções e versões; depois confirmar login/seleção real da organização.

Cada passo externo exige intenção persistida, identificador de operação, consulta de resultado e retoma. Falha não provoca eliminação automática. Uma organização pode ficar preparada enquanto o administrador ainda não aceitou; a interface deve mostrar ambas as condições.

Primeiro adaptador de prova: PostgreSQL local/realm isolado já usados nos gates. Produção Neon, região, gestão de segredos, recuperação e disponibilidade pública conservam os requisitos de F4; o plano não escolhe nem contrata fornecedores novos. O processo privilegiado de preparação deve ser separado da API e limitado a operações permitidas; integração concreta com execução/worker existente será decidida na prova, sem novo motor genérico de workflows.

## 4. Contratos HTTP propostos

Prefixo administrativo `/api/admin/entities`, sujeito à autoridade C4G atual e proteção de sessão/origem/CSRF. Nomes abaixo são desenho de contrato, não endpoints existentes.

| Operação | Resposta/garantia |
| --- | --- |
| GET lista e GET `/:id` | Paginação, filtros, estados separados, capacidades atuais; sem dados de candidaturas. |
| POST criação | 202 com ID da operação, entidade quando disponível e URL de estado; sem segredo e sem falso sucesso de preparação. |
| GET `/operations/:id` | Recibo e fase persistida; reautorizar leitura. |
| POST `/:id/preparation/retry` | Retoma da operação existente, com revisão e chave idempotente. |
| POST `/:id/administrator-invitation` | Emissão explícita após pré-condições; segredo devolvido uma vez, no-store. |
| POST `/:id/administrator-invitation/replace` ou `/revoke` | Revisão esperada, confirmação visual e revogação da emissão anterior. |
| GET `/:id/users` e GET utilizadores de plataforma | Contas únicas e vínculos autorizados; sem edição de papéis C4G neste recorte. |

Percurso público `/ativar-acesso`: segredo aleatório de pelo menos 256 bits em fragmento de URL, removido do endereço após captura em memória e enviado por POST ao serviço de troca, nunca query-string em logs. A página não tem trackers/recursos de terceiros; usar no-store e no-referrer. Proteções de origem, CSRF do contexto transitório, limitação de tentativas e respostas inválidas sem enumeração devem ser testadas. A abertura GET não aceita nem consome o convite. Rotas de troca/início e callback OIDC terão contrato final após a prova de identidade; não criar um callback que confie no email ou num parâmetro do browser.

Validade inicial proposta: 24 horas, uso único, substituição explícita. Emissão com resposta perdida não permite recuperar o token em claro; reconciliar estado e oferecer nova emissão que invalide a anterior. A repetição de uma emissão confirmada devolve metadados e não um segundo token.

## 5. Frontend e sequência de entrega

Novas páginas propostas em `frontend/src/pages/Platform/`: lista, ficha, criação em três passos e ativação. Cliente próprio em api.js; rotas administrativas protegidas no App e entrada no Sidebar. Usar os tokens/tabelas/formulários C4G especificados. Separar “utilizadores da plataforma” de Acessos da organização.

Primeiro montar leituras e formulário contra contratos validados; depois ligar criação, estado e retoma; finalmente emissão/cópia/revogação e ativação. Protótipo ou resposta simulada é identificado como tal. Só declarar entrega funcional quando a pessoa entra efetivamente na nova entidade e vê o catálogo, com isolamento demonstrado.

## 6. Provas e passagem ao ambiente habitual

| Critério | Prova requerida |
| --- | --- |
| C4G administra; cliente não | HTTP com C4G, admin/gestor/técnico de A e B, autoridade revogada durante o pedido. |
| Dados preservados | Fingerprints antes/depois de tenants, contas, vínculos, grants, tarefas e histórico existentes; baseline e migração incremental descartáveis. |
| Criação recuperável | Falhar depois de cada efeito externo, repetir, perder resposta, executar pedidos concorrentes; um resultado sem duplicação ou adoção de recurso desconhecido. |
| Primeiro acesso | Keycloak real, conta nova e existente, password definida pelo titular, sujeito incorreto recusado, email não marcado verificado por entrega manual. |
| Convite seguro | Expirado, revogado, substituído, usado duas vezes, scanner GET, sessão já iniciada, corrida ativar/revogar, ausência de segredos nos logs. |
| Duas entidades funcionais | Seleção A/B, ligações e credenciais próprias, catálogo comum, recusa de leituras/escritas/exportações cruzadas e isolamento de worker. |
| Interface utilizável | Browser 1440/390, teclado, estados vazios/erro/pendentes, cópia indisponível e resposta incerta; revisão visual com utilizador. |

Executar testes direcionados backend, node --check, frontend e npm run build. Ensaiar primeiro com dados descartáveis. Ativação habitual apenas com backup verificado, migrações/manifest coerentes e prova integrada, sem criar clientes reais de teste. Sem commit, deploy, envio de mensagens ou contratação de serviço neste plano.

## Estado de prontidão

**Atualização após autorização de execução, 18/10/2026:** [prova isolada PASS](../reviews/platform-onboarding-isolated-proof.md), com extensão Authenticator + RequiredAction Keycloak, OIDC real, conta nova/existente e diretório persistido A/B. A preparação documental abaixo descreve o estado anterior ao ensaio. A viabilidade ficou demonstrada; coordenação recuperável de identidade/convite/membership, sessão final, autorização/auditoria administrativas e operação pública ainda não estão implementadas. Não promover a feature inteira a Ready/Complete com base na fixture.

Preparação documental concluída. A feature global continua Draft: ponte Keycloak sem email e preparação de múltiplos tenants precisam da prova técnica acima; ajustes de campos obrigatórios ainda são propostas. Não há bloqueio por email/R2/antivírus para estudar e demonstrar este percurso. Não se pede ao utilizador que escolha mecanismos criptográficos ou detalhes de bases; primeiro produzir uma opção técnica concreta e verificável.

## Fontes oficiais consultadas em 18/10/2026

- [Keycloak Admin REST API — execute-actions-email](https://www.keycloak.org/docs-api/latest/rest-api/index.html): envio por email, parâmetros de validade/redirect e resposta 204; não devolve ligação para cópia.
- [Keycloak Server Developer Guide — Action Token Handler SPI](https://www.keycloak.org/docs/latest/server_development/index.html#_action_token_spi): extensões de ações de autenticação. A documentação latest não prova compatibilidade com a versão instalada; validar na versão fixada da prova.

Próximo passo: executar a prova isolada de ativação manual no Keycloak e de preparação de uma segunda entidade, antes de ligar o formulário ao ambiente habitual.
