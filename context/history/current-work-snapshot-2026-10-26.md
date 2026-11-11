# Arquivo integral do trabalho registado até 26/10/2026

Este ficheiro preserva o conteúdo anterior de `context/current-work.md`, incluindo processos concluídos, estados intermédios e registos históricos. Os caminhos relativos nele contidos foram escritos quando o documento se encontrava diretamente em `context/`; para consultar os artefactos associados, resolver esses caminhos a partir de `context/`.

## Uma conta de entidade, uma entidade — In Progress (26/10/2026)

[Contrato funcional](features/single-organization-membership.md). Clarificação confirmada: a C4G administra a plataforma; cada conta operacional de cliente pertence a uma única entidade e recebe aí o seu perfil. O cabeçalho deixará de permitir seleção entre entidades, a Central recusará memberships não removidas simultâneas e o histórico continuará preservado. Sem aplicação de migrations ou alteração de contas reais neste recorte.

## Remoção do runtime legacy UBI — Complete (26/10/2026)

[Contrato e resultado](features/remove-ubi-legacy-runtime.md). Eliminados da aplicação executável o runtime UBI, autenticação JWT/password, pool/base de fallback, bootstrap/jobs, rotas, serviços, UI, assets, scripts/demo e testes exclusivos do piloto. O único runtime é C4G multi-instituição com OIDC, membership central e tenants autorizados. Dados, migrations e evidência histórica foram preservados, sem entrypoints ou fallback. Frontend 320/320 e build PASS; backend direcionado 120/120 e sintaxe de 503 ficheiros PASS. Suite backend global 1222/1225, com as três falhas anteriores fora do recorte. Sem operação sobre bases, commit, deploy ou credenciais.

## Concorrência de pedidos — fase 1 — Review (26/10/2026)

[Contrato, implementação e validação](features/request-concurrency-phase-1.md); [revisão conclusiva](reviews/request-concurrency-phase-1.md). A fila HTTP global foi substituída por uma barreira concorrente em torno de mudanças do contexto organizacional; leituras independentes e uploads já não se bloqueiam, pedidos obsoletos das três listas adotadas são cancelados e leituras de candidaturas deixaram de adquirir o advisory lock organizacional. O catálogo classifica agora cada operação explicitamente como `read` ou `write`; comandos preservam o lock atual. Frontend 323/323 e build PASS; candidaturas/autoridade backend 43/43 PASS; baseline PostgreSQL local confirma cinco pares de leituras sobrepostos e zero locks de leitura. Veredicto **REQUEST CHANGES**: mantém-se em Review até prova HTTP/OIDC integrada. A suite backend global fica em 1223/1226 com três falhas preexistentes comprovadas fora do recorte; `dev/local/check.js` continua apagado no worktree. Sem alegação de melhoria de latência sem baseline anterior comparável.

## Verificação adicional por email — Blocked (25/10/2026)

[Contrato aprovado](features/optional-email-verification.md). A decisão documental usa sessão normal: 18 testes backend, 17 frontend, build e prova Chrome/Keycloak/PostgreSQL com dois utilizadores, decisão HTTP 200, versão exata persistida e auditoria SESSION passaram. Políticas dos outros domínios preservadas. Email ativo/adesão/desativação permanecem bloqueados: Keycloak 26.8.0 não contém o provider; a extensão candidata v26.7.2 tem lacunas de verificador, reenvios e desativação. Necessária versão adequada e autorização específica de instalação/validação; não foi criado autenticador próprio. UI explicita indisponibilidade, sem preferência fictícia. Evidência externa: `C:\Users\Utilizador\c4g-evidence\optional-email-verification\20261025-202930\report.md`. AV-01 e gates anteriores não repetidos.

## Correção do carregamento da faturação — Review (23/10/2026)

Corrigido o import lazy da lista e do detalhe de faturação para caminhos `.jsx` explícitos e com o casing real. O servidor Vite deixou de resolver o módulo para o caminho histórico inexistente `platformBilling.js`; os dois módulos ativos respondem como JavaScript. Regressão adicionada ao teste de navegação. Quatro ficheiros de teste/14 testes direcionados e build Vite com 2126 módulos PASS. A migration `027` está agora instalada e os dois módulos respondem `200` no ambiente habitual.

## Rollout local da faturação — concluído (23/10/2026)

Após autorização explícita, as aplicações foram paradas, foi produzido e restaurado com sucesso um backup final privado em `.tmp/local-platform/platform-billing-rollout/backup-2026-10-22T23-07-14-703Z` e a migration `027_platform_billing` foi instalada no ambiente habitual. A primeira validação pós-commit detetou que os pins da `027` tinham sido capturados com o utilizador descartável `c4g_billing_admin`, em vez do owner técnico não-login `c4g_f12_admin` exigido pela instalação local; não existia drift estrutural ou de permissões. Os pins foram corrigidos para schema `21ea761a468dd301d923ddcb03a22be7c8eabd558d3829ac1e023cac70b0516b` e security `6ffce0530152e20ee383019c8efd728ef1f66c2385978c04290ec49a6fdd5243`, mantendo o checksum SQL. O gate PostgreSQL descartável com o owner canónico passou, a retoma do rollout gravou `APPLIED`, confirmou dados central/tenant preservados e nove tabelas vazias. A compatibilidade cumulativa do worker deixou de depender de listas fechadas por versão. APP reiniciada: frontend `200`, health `ready`, `workerReady` e `admissionReady`, API sem sessão `401`, leitura habitual autorizada PASS e módulos de faturação `200`. Evidência final: 76 testes direcionados PASS, build Vite com 2126 módulos PASS e gate PostgreSQL com nove tabelas/27 triggers/API/CAS/idempotência/pagamentos/estornos PASS.

## Controlo de faturação C4G — Review (23/10/2026)

[Contrato e plano técnico da Fase A](features/platform-billing-control-phase-a.md) implementados e submetidos a segunda revisão formal. Os quatro findings foram fechados: cancelamento de nota de débito protegido no repositório e no trigger concorrente; transições inválidas mapeadas para `409`; `allowedActions` calculadas no servidor controlam pagamento, documentos e estornos na interface; recusas e conflitos relevantes, incluindo SQLSTATE, ficam no F7 sem dados sensíveis. Regressões cobrem os quatro cenários. Resultado da revisão: sem findings bloqueantes ou relevantes no recorte. Evidência: 89 testes backend de billing/autoridade/F7/migrations/composição PASS, 13 testes frontend direcionados PASS, `node --check` e build Vite PASS, e gate PostgreSQL descartável `000→027` PASS com nove tabelas, 27 triggers, defesa contra sobrepagamento e auditoria de recusas. Pins finais corrigidos para o owner técnico canónico: checksum `8f6f39cc106073452ffe9f206ae19b771f267d48eef96c684bb5f084e727f0a9`, schema `21ea761a468dd301d923ddcb03a22be7c8eabd558d3829ac1e023cac70b0516b`, security `6ffce0530152e20ee383019c8efd728ef1f66c2385978c04290ec49a6fdd5243`. A migration está aplicada no ambiente habitual. Não inclui emissão fiscal, TOConline, PDF, R2, email, SMTP/Resend, cobrança ou suspensão automática. O restante trabalho em curso abaixo não foi substituído.

## Órbita de financiamento no login C4G — Review (22/10/2026)

Implementação e evidência em [features/c4g-login-funding-orbit.md](features/c4g-login-funding-orbit.md). A segunda revisão aproxima a mensagem da órbita, mantém o título em duas linhas no desktop, reforça moderadamente núcleo e labels e versiona o CSS para invalidar a composição antiga ainda visível na captura do utilizador. Cinco testes direcionados, sintaxe e inspeção Chrome em 1920 × 920, 1440 × 900 e 390 × 844 PASS; órbita centrada com desvio inferior a 0,01 px e sem overflow horizontal. Formulário, autenticação, conteúdo e velocidade da animação permanecem inalterados.

## Arranque local a partir da raiz — Review (23/10/2026)

Contrato e evidência em [features/local-root-development-startup.md](features/local-root-development-startup.md). `npm run dev` recupera automaticamente apenas os contentores Keycloak/proxy habituais já existentes, aguarda pela metadata OIDC real e depois supervisiona API, worker configurado e frontend. Não usa `compose up`, não recria identidade e não executa migrations ou seeds; PostgreSQL continua externo. Treze testes focados, sintaxe, build com 2126 módulos e smoke real desde contentores parados até saúde integral PASS. `Ctrl+C` libertou as portas da aplicação e preservou Keycloak/proxy ativos para o arranque seguinte.

## Ficha completa da entidade — Review (21/10/2026)

[Contrato, matriz e validação](features/complete-entity-profile.md). Fonte administrativa central partilhada entre Administração C4G e entidade, preenchimento explícito das entidades anteriores, contacto principal operacional distinto de representante legal/acesso, e matriz de edição definida. API e componente comuns implementados; 21 testes funcionais/HTTP/backend direcionados, 17 testes de composição, 16 testes frontend, sintaxe e build passam. `setup:local` e health PASS; primeira ficha canónica da C4G criada explicitamente e confirmada nos ecrãs Admin/entidade, incluindo desktop e móvel sem overflow. Número de trabalhadores corrigido para 8 por confirmação do utilizador, com revisão canónica 2 e data de referência 2026-10-21.

## Simplificação do conteúdo do frontend — Review (21/10/2026)

[Contrato, matriz e resultado](features/frontend-content-simplification.md). Terceira passagem concluída nos sete ajustes residuais. Oito ficheiros/68 testes direcionados e build PASS; prova Playwright em seis páginas, incluindo o detalhe de oportunidade, a 1440 × 900 e 390 × 844, sem overflow, textos removidos ou erros de consola. Suite completa com 274 testes PASS e as mesmas duas falhas preexistentes fora do âmbito.

## Simplificação da página de logs — Review (21/10/2026)

[Contrato](features/platform-simple-logs.md) revisto para retirar texto explicativo permanente e concentrar os limites importantes do histórico num ícone de informação acessível junto ao título. A regra de conteúdo ficou registada para toda a interface; quatro testes direcionados e build frontend PASS.

## Paginação dos logs — Review (21/10/2026)

[Contrato](features/platform-simple-logs.md) e API revistos para 15 eventos por página, preservando pesquisa, filtro, ordenação e controlos de navegação. Um teste backend, quatro testes frontend, sintaxe e build PASS; gate PostgreSQL atualizado, sem repetição da composição isolada nesta revisão.

## Desempenho interno e data civil do Matching — Review (19/10/2026)

[Contrato, medição e validação](features/matching-backend-performance.md). Eliminado o N+1 de operações autorizadas ao carregar snapshots privados, preservando a transação tenant e a revalidação final; corrigido o dia do prazo para `Europe/Lisbon`. Benchmark direto: mediana 7953 ms → 7102 ms (−10,7%) com dez resultados e hash integral idêntico. A página completa não demonstrou melhoria material e mantém cerca de 8,3 s no endpoint, dominados por custo fixo ainda por instrumentar. 32 testes backend, nove frontend, sintaxe e build PASS.

## Limpeza de código morto — Review (19/10/2026)

[Âmbito, remoções e validação](features/dead-code-cleanup.md). Removidos módulos órfãos, bindings sem referências, clientes e estilos exclusivos de páginas desligadas. Grafo frontend e pesquisa backend sem novos órfãos conhecidos; build, 11 testes frontend direcionados, 83 backend direcionados e sintaxe PASS. A suite global conserva cinco falhas preexistentes por expectativas já desatualizadas (duas frontend e três backend). Sem alteração de contratos ativos, dados, migrations ou autorização.

## Desempenho do Matching — Review

[Medições e critérios](features/matching-performance.md). Corrigida duplicação de efeitos e prioridade dos pedidos: mediana até aos resultados de 26,4 s para 11,7 s no ambiente habitual, redução de 55,7%. Três comparações completas por hash confirmam dez correspondências idênticas. 13 testes frontend, seis backend e build PASS. Backend e autorização intactos; cerca de oito segundos do serviço permanecem para análise por fase, sem atribuir esse custo ao catálogo central.

## Revisão das secções — apresentação e resiliência (18/10/2026)

[Âmbito, correções e limitações](features/c4g-sections-presentation-review.md). Títulos e navegação coerentes, ficha da organização ligada ao Matching recuperado, paginação vazia corrigida e leitura de alertas preservada perante falha transitória da atualização de prazos. 83 testes direcionados e build PASS; revisão Chrome desktop/mobile da entidade e Administração C4G. Mantém-se uma questão de desempenho no Matching e as integrações adiadas. Sem alteração de dados de negócio ou permissões.

## Portugal 2030 na Administração C4G — Review (18/10/2026)

[Contrato e evidência](features/portugal2030-platform-ownership.md). Página movida para `/administracao/importar`, exclusiva C4G, retirada do menu entidade. 23 testes frontend, autorização PostgreSQL e prova Chrome C4G/entidade PASS. Envio continua indisponível: armazenamento/antivírus adiados e processamento central por compor; não reutiliza o destino privado anterior.

## Registar interesse na tabela do catálogo — Review (18/10/2026)

[Contrato e evidência](features/catalog-table-interest.md). Botão na coluna Candidaturas, ligado à criação existente para a entidade ativa, consultando a revisão atual ao clicar. Build, 12 testes e prova Chrome desktop/mobile com conta de entidade PASS. Sem alteração de API ou dados de negócio.

## Segurança da conta e Keycloak — Review (18/10/2026)

[Apresentação e evidência](features/account-security-presentation.md). Ecrã reorganizado em Password/MFA, ação principal e instruções; tema account C4G atualizado apenas por CSS, com backup anterior. 14 testes frontend, build e prova real Chrome 1440/390 PASS; realm, contas e política MFA preservados. Próximo passo: revisão visual com o utilizador.

## Dashboard da administração C4G — Review (18/10/2026)

[Contrato e evidência](features/platform-admin-dashboard.md). Dashboard e início de sessão C4G ligados a métricas centrais reais: entidades, contas, oportunidades, distribuição por estado, atividade e entidades recentes. Nove grupos PostgreSQL, 20 testes frontend, 11 backend, build/sintaxe e confronto real Chrome 1440/390 PASS. Sem migração nem alteração de dados de negócio. Próximo passo: rever o dashboard com o utilizador.

## Logs simples da plataforma — Review (18/10/2026)

Contrato e evidência: [logs](features/platform-simple-logs.md). Página `/administracao/logs` ativa no ambiente habitual, com entradas OIDC e erros técnicos, pesquisa e filtros. Migração 026 após backup/restauro verificado; dados anteriores preservados. Sete grupos PostgreSQL, 17 testes backend de regressão, 21 testes frontend, build/sintaxe e prova Chrome 1440/390 PASS. Convite real adiado por pedido do utilizador. Próximo passo: rever a página com o utilizador.

## Adesão de entidades no ambiente habitual — Review (18/10/2026)

[Recorte E integrado](features/platform-entity-registration-local.md): worker automático privado e supervisionado, resolvedor dinâmico cifrado, convite C4G e percurso completo ativos. Backup central/tenant com restauro e comparação PASS; 022–025 aplicadas preservando contas, memberships, catálogo e dados. 57 testes backend, 32 frontend, onze grupos PostgreSQL de adesão, build/sintaxe e prova isolada Keycloak/PostgreSQL/Chrome PASS. OIDC habitual e revisão visual 1440/390 PASS; workers e health saudáveis, recuperação automática local comprovada. Zero convites/entidades fictícias criados no ambiente habitual; sem envio de email. Próximo passo: rever o primeiro convite real com o utilizador. As secções seguintes preservam as etapas anteriores, incluindo os limites de composição isolada então existentes.

## Conclusão da ficha e preparação — Review / prova isolada PASS (18/10/2026)

[Contrato e evidência](features/platform-entity-registration-completion.md). Submissão do snapshot persistido, reserva única PT+NIF, trabalho durável e preparação/ativação com os adaptadores existentes implementados. Central 025 apenas em base descartável. 47 testes backend, 18 frontend, dez grupos PostgreSQL e prova integrada Keycloak/PostgreSQL/Chrome PASS. Retoma após perda de respostas e reinício, rollback da ativação, dados anteriores e tarefas preservados; perfil completo e ecrãs desktop/mobile conferidos. Nenhuma configuração habitual alterada. Próximo passo: composição habitual do worker/resolvedor e ligação do percurso, com backup/restauro e revisão local (recorte E).

## Ficha portuguesa: rascunho e perfil — Review / prova isolada PASS (18/10/2026)

[Recorte, critérios e evidência](features/platform-entity-registration-draft.md). Implementação isolada do rascunho com revisão/idempotência, validações portuguesas e formulário em quatro passos. Contactos canónicos integrados no perfil por adoção administrativa explícita, com gravação separada da descrição. Migrações aditivas 023/024; sem instalação no ambiente habitual. 60 testes backend, 25 frontend, oito grupos PostgreSQL, build e sintaxe PASS. Prova integrada Keycloak/PostgreSQL/Chrome PASS, incluindo contactos no perfil, permissões revogadas, isolamento e tarefas preservadas; capturas desktop/mobile conferidas. Próximo passo: conclusão da adesão, reserva fiscal e provisionamento no recorte D.

## Convite pré-entidade e sessão limitada — Review / prova isolada PASS (18/10/2026)

Implementação autorizada do primeiro recorte do [plano](features/platform-entity-invited-registration-plan.md), exclusivamente em composição isolada. Agregado de adesão independente de entidade/membership; identidade e convite com propósito ADMISSION; autoridade de sessão resolvida no servidor. Migração 022 registada com hashes próprios e aplicada apenas no ensaio; composição habitual sem adesões continua compatível com Central 021, validando hashes se a 022 estiver presente. Ficha, integração de contactos e provisionamento da entidade ficam para os incrementos seguintes. [Implementação, provas e limites](reviews/platform-entity-admission.md).

74 testes focados, 10 grupos PostgreSQL do novo serviço, 12 grupos do serviço de utilizadores e prova real Keycloak/PostgreSQL/Chrome PASS. Conta nova limitada, pessoa existente com dois vínculos e password preservados, CSRF/autorização C4G, cancelamento antes de gravar password, catálogo recusado e logout disponível comprovados. Capturas 1440/390 conferidas; build frontend e sintaxe PASS. Sem instalação habitual; consulta de diagnóstico observou `/health/db` 503 no runtime habitual, não certificado por esta prova. Próximo passo: rascunho/formulário obrigatório da ficha portuguesa.

## Entidades, utilizadores e acesso C4G — In Progress (18/10/2026)

**Adesão restrita e ficha da entidade — In Progress.** C4G inicia apenas com nome/email; convidado autentica-se, completa ficha obrigatória e só depois obtém acesso à nova entidade. **Portugal confirmado:** PT e EUR fixos, NIF português e código postal 0000-000 obrigatórios. [Contrato funcional](features/platform-entity-invited-registration.md) e [plano técnico](features/platform-entity-invited-registration-plan.md). Convite, sessão limitada, rascunho, formulário e contactos canónicos são os recortes isolados acima. Conclusão da adesão, reserva fiscal e provisionamento retomável continuam pendentes. Preservar descrição, pessoas, unidades e competências no tenant. Sem bloqueio retroativo das entidades existentes; conflitos de identidade resolvidos pela C4G e proposta de conclusão normal sem segunda aprovação manual.

**Criação de utilizadores e gestão de acessos por entidade — Review / operacional local.** Painel na ficha C4G e em Acessos, com três perfis, preparação retomável, ligação manual e ativação Keycloak. Prova real com duas entidades, mesma identidade, password nativa, revogação antes de guardar password e isolamento PASS. Central 021 aplicada com backup/restauro; diretório físico publicado; contas, memberships, grants, catálogo e dados tenant preservados. Keycloak existente conservado, módulo local instalado e API/worker operacionais. Formulário e lista conferidos por OIDC habitual em 1440/390, sem criar utilizadores de teste. [Revisão e evidência](reviews/platform-member-access.md). Email permanece adiado. Criação de uma nova entidade continua distinta e pendente de ligação ao ecrã habitual.

**Atualização visual do login — Review:** composição da referência enviada pelo utilizador aplicada no Keycloak habitual: formulário branco à esquerda, painel C4G à direita; formulário primeiro em móvel. Gate OIDC real e layout 1920/1440/900/390 PASS; campos nativos e mostrar/ocultar password conferidos, conta/realm preservados. [Capturas e evidência](reviews/platform-access-identity.md). Próximo passo deste incremento: rever o novo login com o utilizador.

[Feature ativa](features/platform-entities-users-and-access.md) e [plano operativo](features/platform-entities-users-operational-plan.md) criados a pedido do utilizador, reutilizando o diretório e o serviço de onboarding. Confirmado: C4G/administrador adicionam os três perfis internos; gestor adiciona apenas Técnicos. Email de recuperação continua para o final. **Login/identidade em Review e ativos:** acesso em `/`, ligação de recuperação com indisponibilidade explícita e tema Account C4G no Keycloak; [3 testes backend, 3 frontend, dois gates Chrome, build/sintaxe PASS](reviews/platform-access-identity.md). Configuração de autenticação/contas preservada; nenhuma alteração de password/MFA/email. Entrada direta corrigida em `/` e `/login`, eliminando a exceção que ainda mostrava o botão na captura do utilizador; 7 testes DirectLogin, gates Chrome/OIDC 1440/390 e build PASS. Sessão existente preservada e orientação de recuperação presente também no Keycloak. Criação/ativação real e utilizadores adicionais permanecem pendentes da composição operacional, sem migrações nem comandos montados no ambiente habitual. Próximo passo: composição operacional de criação da entidade/primeiro administrador antes da ligação do formulário.

## Entidades e utilizadores — consulta habitual / Review (18/10/2026)

**Implementado e ativo no ambiente habitual.** [Contrato](features/platform-directory-screen.md) e [revisão](reviews/platform-directory-screen.md): menu Plataforma C4G → Entidades e utilizadores, entidades/contas/vínculos reais, pesquisa, estados, paginação e ficha. Conta nominativa C4G visível sem membership privada; administrador de entidade recusado. **3 testes backend, 6 grupos PostgreSQL/HTTP, 17 testes frontend, build/sintaxe e Chrome OIDC 1440/390 PASS.** API reiniciada, sem migrations ou alterações de contas/acessos/dados de negócio. Apenas consulta administrativa; criação/ativação continua dependente de composição operacional, sem montar os comandos experimentais. Próximo passo: rever o diretório no ambiente habitual e continuar a composição operacional da criação/ativação.

## Adaptadores reais de onboarding — Review (18/10/2026)

Adaptadores Keycloak, PostgreSQL, journal cifrado e OIDC ligados ao serviço central existente em composição isolada. [Contrato](features/platform-onboarding-real-adapters.md) e [validação](reviews/platform-onboarding-real-adapters.md): **12 grupos reais, 17 do serviço central, 47 testes e sintaxe de 13 ficheiros PASS**. Conta nova e existente, segunda entidade, retoma após falhas/reinício, projeção, sessões OIDC normais, autorização C4G, Acessos, catálogo com registo sintético, isolamento HTTP/físico e candidatura/tarefa preservadas após reconciliação. Revogação com formulário aberto bloqueia password e membership; conta errada, convite usado e colisão desconhecida recusados. Containers e scratch próprios removidos. **Limite:** SPI/worker/composição ainda de ensaio; o orquestrador conserva privilégios de bootstrap/inspeção, não constituindo empacotamento público nem separação operacional final de segredos. Ecrã/realm/bases habituais não alterados. Próximo passo: preparar a composição do ambiente habitual, com configuração própria da ativação e separação dos segredos, antes de ligar o formulário. As secções seguintes preservam o histórico; a indicação anterior de adaptadores sintéticos refere-se apenas ao gate separado do serviço.

## Serviço central de criação/ativação — Review (18/10/2026)

Implementação autorizada: [contrato](features/platform-onboarding-service.md) e [validação](reviews/platform-onboarding-service.md). Serviço persistido com autorização C4G atual, retoma por etapas/lease/fence, convites manuais e ativação atómica com grants e F7. Migração central 020 e factory HTTP preparadas; **54 testes e 17 grupos PostgreSQL/HTTP PASS**, incluindo perda da resposta de COMMIT depois de confirmação real. Conta existente numa segunda entidade mantém identidade e vínculos. Runtime restrito não recebe acesso direto às tabelas nem credenciais de provisionamento. Ecrã/ambiente habitual não ligados e bases habituais não migradas. **Limite:** adaptadores IdP/provisionamento/projeção/verificação OIDC ainda sintéticos no gate do serviço; a prova Keycloak anterior é separada. Próximo passo: integrar adaptadores reais em composição isolada e repetir o percurso completo antes de ligar o ecrã habitual. Secções seguintes preservam o contexto das etapas anteriores.

## Prova isolada de criação/ativação — Review (18/10/2026)

Utilizador autorizou executar a prova de ativação manual e segunda entidade. **Gate final PASS**, em Keycloak 26.8.0 separado, Chrome real e PostgreSQL descartável. Conta nova define password nativa; conta existente conserva identidade/vínculo anterior. Expiração/revogação/reutilização/conta errada recusadas, incluindo revogação com formulário aberto; consumo com rollback/concorrência verificado. Diretório real A/B, preparação com falha/retoma, migrações e isolamento físico/API; candidatura privada inacessível à outra entidade, tarefa preservada, catálogo consultável (vazio no ensaio). [Resultados e limites](reviews/platform-onboarding-isolated-proof.md). Código experimental em test/integration/platform-onboarding; apenas hook opt-in no gate anterior. Containers removidos; realm/bases/serviços habituais intactos e health ready/workerReady true. **Não é integração final:** membership/sessão usam fixture; coordenador recuperável, auditoria de convites, rotas administrativas, worker real e operação pública ainda pendentes. Plano global permanece Draft; apenas a viabilidade foi comprovada. Próximo passo: implementar serviço de criação/ativação recuperável, com autorização/auditoria C4G, antes de ligar o ecrã ao ambiente habitual.

## Entidades e primeiro administrador — implementação preparada / Draft (18/10/2026)

[Plano técnico](features/platform-entities-implementation-plan.md) preparado a pedido do utilizador: reutilização de identidade/memberships/perfis, operações e convites centrais, rotas, preparação de tenants, interface e testes. Inspeção confirmou snapshot local limitado a uma entidade e ausência do fluxo de ativação manual de conta nova. Documentação oficial Keycloak consultada: execute-actions-email envia email, não devolve ligação; ponte nativa de ações requer prova técnica isolada. Ligação manual permanece decisão confirmada; email/R2/antivírus continuam adiados. Campos centrais obrigatórios ausentes do formulário foram explicitados como ajustes propostos. Sem código, migrações, reinícios, contas ou convites reais; feature global ainda Draft. Próximo passo: executar prova isolada da ativação manual e preparação de uma segunda entidade, antes de ligar o formulário ao ambiente habitual.

## Entidades e utilizadores — detalhe do ecrã / Draft (18/10/2026)

Por pedido do utilizador, detalhada a [lista, ficha e criação da entidade com primeiro administrador](features/platform-entities-and-users.md), aplicando frontend-design aos tokens e composição C4G existentes. Percurso proposto: Entidade → Primeiro administrador → Rever e criar → resultado com preparação/acesso discriminados. **Utilizador confirmou ativação por ligação temporária entregue manualmente pela C4G.** Contrato atualizado com gerar/copiar/revogar/substituir, uso único, conta nova/existente, aceitação explícita e testes; validade inicial de 24 horas proposta, sem afirmar aprovação desse prazo. Email automático continua adiado. Apenas documentação, sem ecrã novo, contas, bases, migrations, ligações emitidas ou mensagens. Integração de identidade e preparação técnica ainda por concretizar; pendências anteriores preservadas. Próximo passo: preparar a implementação do percurso de criação e ativação manual.

## Administração C4G — clientes, faturação e comunicação / Draft (18/10/2026)

O utilizador pediu análise de três áreas de administração e confirmou que o serviço será pago. [Proposta e critérios de aceitação](features/platform-customer-administration.md): Entidades e utilizadores, Subscrições e faturação e Comunicação com clientes, ligadas à mesma ficha de entidade. Recomenda-se começar por criação assistida da entidade/primeiro administrador, depois acompanhamento comercial e comunicação. Modelo de cobrança, sistema de faturação e audiência permanecem por confirmar; propostas não constituem decisões aprovadas. Apenas documentação alterada, sem implementação, contas novas, cobrança ou mensagens. Email, armazenamento/antivírus e entrega 5 global mantêm as pendências anteriores. Próximo passo: confirmar o âmbito inicial de Entidades e utilizadores e detalhar a criação de uma entidade com o seu primeiro administrador.

## Conta nominativa de administração C4G — operação concluída (18/10/2026)

Criada a única conta administrativa solicitada, com o email fornecido pelo utilizador, no ambiente habitual. Papel `C4G_ADMIN`, sem membership privada, password temporária em ficheiro local protegido e alteração obrigatória no primeiro login. Chrome confirmou aceitação da password e parou na alteração obrigatória; leitura administrativa de fontes e vínculo OIDC verificados. Contas anteriores, memberships e grants preservados. [Registo e limites](references/local-named-platform-admin.md). A criação de entidades/primeiros acessos na interface permanece por implementar; o utilizador foi informado. O incremento de perfis abaixo continua em Review.

## Perfis internos no ecrã Acessos — Review (18/10/2026)

**Implementado e ativo no ambiente habitual, 18/10/2026, 16:09 (Lisboa).** O utilizador corrigiu a matriz: o gestor da entidade também atribui acessos à sua equipa. [Contrato](features/organization-internal-access-profiles.md) e [revisão/provas](reviews/organization-internal-access-profiles.md): administrador atribui os três perfis; gestor atribui Técnico a contas de Consulta existentes e suspende/reativa técnicos; técnico mantém consulta por equipa e concessões específicas de trabalho. O próprio acesso está protegido. Perfil/permissões/versões/auditoria atómicos, confirmação visual, revisão concorrente e repetição segura. Sem convites ou contas externas. **85 testes backend, 10 frontend, build/sintaxe, PostgreSQL HTTP A/B e Chrome 1440/390 PASS.** Migração central 019 aplicada com backup verificado, sem alterar contas, memberships, grants, catálogo ou dados tenant. API/worker reiniciados e saudáveis; nenhuma importação pendente ou solicitada. OIDC habitual PASS: uma conta ORG_ADMIN, próprio acesso protegido; nenhuma alteração de perfil real. Gestão de várias contas demonstrada exclusivamente em dados descartáveis. Entrega 5 global e pendências de armazenamento/antivírus/email mantêm-se. Próximo passo: rever o ecrã Acessos com o utilizador.

## Técnicos — acesso por equipa / Review (18/10/2026)

**Implementado e ativo no ambiente habitual, 18/10/2026, 15:44 (Lisboa).** [Contrato, implementação e provas](features/application-technician-team-access.md). Técnicos (`CONTRIBUTOR`) consultam apenas candidaturas em cuja equipa têm participação ativa; grants amplos anteriores não ultrapassam essa restrição. A remoção retira leitura/alteração nos pedidos seguintes, incluindo listas, parceiros, alertas, indicadores e CSV. Contagens mistas no catálogo devolvem zero para candidaturas inacessíveis; origens privadas/centrais verificadas. Sem novos poderes de escrita, perfis, convites ou migrações. **71 testes backend, 15 frontend, build/sintaxe, PostgreSQL/HTTP A/B e Chrome 1440/390 PASS.** Tarefa/histórico anterior/grants preservados no ensaio; suspensão e rollback de auditoria verificados. API reiniciada; OIDC habitual PASS, zero candidaturas reais, fingerprints de dados de negócio/memberships/grants inalterados. Técnicos demonstrados exclusivamente com dados descartáveis, sem criar contas reais de teste. [HTTP](../output/playwright/c4g-team-access/http-verification.json), [browser](../output/playwright/c4g-team-access/browser-verification.json), [ambiente habitual](../output/playwright/c4g-team-access/native-verification.json). Gestão/atribuição de perfis no ecrã Acessos permanece por concluir; entrega 5 global e pendências de armazenamento/antivírus/email mantêm-se. Próximo passo: rever a gestão simples dos perfis internos no ecrã Acessos.

## Utilizadores internos e registo de parceiros — Draft (18/10/2026)

**Âmbito simplificado por decisão posterior do utilizador:** parceiros ficam apenas registados com a sua informação e pessoas/contactos na candidatura, para conhecimento do gestor, aproveitando o percurso recuperado na entrega 3. Convites, acesso externo, partilha e tarefas para parceiros foram retirados do plano ativo; não são requisitos de fecho desta fase. [Plano atualizado e histórico da decisão](features/organization-users-and-application-guests.md). Mantêm-se administração C4G, catálogo comum, candidaturas privadas por entidade e técnicos apenas nas candidaturas da sua equipa. O detalhe das ações dos perfis internos permanece por especificar; não foi implementado nesta análise. Apenas documentação alterada, sem mudanças de permissões, dados ou serviços. A revisão do Dashboard e a entrega 5 global abaixo permanecem pendentes; armazenamento, antivírus e email mantêm-se para o final.

## Recuperação do piloto — entrega 5 / In Progress (18/10/2026)

**Dashboard, indicadores e relatório — Review, 18/10/2026.** Recuperados e ativos no ambiente habitual: estados, taxa de sucesso, fontes reais, prazos internos, orçamentos exatos com ausências explícitas, histogramas/tabelas por unidade/estado/candidatura e CSV reautorizado/auditado. Utilizador confirmou unidade principal atual do responsável, com grupo sem associação. 50 testes backend, 12 frontend, build/sintaxe, PostgreSQL/HTTP A/B com 32 candidaturas de ensaio e Chrome 1440/390 PASS; OIDC habitual, CSV e recarregamento PASS. Ambiente habitual: zero candidaturas, 119 registos de catálogo consultados; dados de negócio preservados. Sem migrations/grants ou alterações ao worker. [Contrato](features/c4g-pilot-parity-delivery-5-dashboard.md), [revisão/limites](reviews/c4g-pilot-parity-delivery-5-dashboard.md), [comparação](../output/playwright/c4g-dashboard/comparison.html). Entregas 3 e 4 continuam com as pendências documentais e email para o final; entrega 5 global não concluída. Próximo passo: rever a comparação e o relatório com o utilizador.

## Recuperação do piloto — entrega 4 / In Progress (2026-10-17)

**Comunicação administrativa — Review, 18/10/2026.** Recuperada e ativa no ambiente habitual: apenas administradores da organização, seleção individual com opção de todos os membros ativos, revisão antes do envio, histórico preservado e avisos gerais na caixa pessoal. Nenhuma pessoa pré-selecionada; sem monitorização da leitura pelo remetente. Migração 030 e duas permissões explícitas aplicadas com backups protegidos/auditoria; dados, identidades, memberships e grants anteriores preservados. 120 testes backend, 17 frontend, build/sintaxe, PostgreSQL HTTP/Chrome A/B e regressão dos alertas anteriores PASS. OIDC habitual confirma administração organizacional, seleção vazia e recusa do administrador da plataforma sem organização (409). Caixa/histórico reais vazios; nenhum envio real de teste. Formulário identificado como adaptação nova, pois o original não foi encontrado. [Contrato](features/c4g-pilot-parity-delivery-4-communication.md), [provas/limites](reviews/c4g-pilot-parity-delivery-4-communication.md), [comparação](../output/playwright/c4g-notices/comparison.html). Email, armazenamento/antivírus e fecho global da entrega 4 continuam pendentes. Próximo passo: rever a comparação com o utilizador na aplicação habitual.

**Alertas de candidaturas — Review, 18/10/2026.** Recuperados e ativos no ambiente habitual: estado, inclusão na equipa, prazos 30/7/1, caixa pessoal, leitura individual/em lote, links e contagem. O utilizador confirmou responsável/equipa (autor excluído) e email para o final. Migração tenant 029 aplicada com backup protegido, hashes anteriores preservados e API reiniciada. 98 testes backend, dez frontend, build, PostgreSQL A/B e Chrome 1440/390 PASS; OIDC habitual 200. Caixa real vazia porque não há candidaturas nesta instalação; geração e leitura demonstradas apenas com dados de ensaio identificados. [Contrato](features/c4g-pilot-parity-delivery-4-alerts.md), [revisão e limites](reviews/c4g-pilot-parity-delivery-4-alerts.md), [comparação](../output/playwright/c4g-alerts/comparison.html). Prazos verificados ao entrar/atualizar a aplicação, sem scheduler global. Comunicação administrativa ainda por adaptar; email, armazenamento/antivírus e fecho global continuam pendentes. Próximo passo: rever a comparação e delimitar a comunicação administrativa da entrega 4.

**Portugal 2030 — Review, 18/10/2026.** Percurso preparado: ficheiro/folha, validação, pré-visualização, confirmação, resultados por linha, revisão de duplicados, relatório e retoma pelo histórico; composição do piloto e identidade C4G preservadas. Corrigidos isolamento visual entre contextos, repetição de envio incerto, datas Excel, linhas físicas e verificação de integridade. 33 testes backend, 11 frontend, build, gate PostgreSQL API/worker A/B e browser 1440/390 PASS. Excel oficial: 177 linhas válidas, zero erros/IDs repetidos; sem importação. O utilizador confirmou manter armazenamento/antivírus para o final: runtime habitual continua desativado, com explicação e envio bloqueado. [Contrato](features/c4g-pilot-parity-delivery-4-portugal2030.md), [provas/pendências](reviews/c4g-pilot-parity-delivery-4-portugal2030.md), [comparação](../output/playwright/c4g-portugal2030/comparison.html). Dados/histórico reais preservados. Importação real e entrega 4 global não concluídas. Próximo passo: recuperar e verificar os alertas existentes, mantendo a configuração documental para o final.

**Interreg Europe e POCTEP concluídos — 18/10/2026, 13:02 (Lisboa).** Processamento ativado por autorização explícita, após respostas públicas válidas e backup protegido. Quatro recolhas reais na interface: Interreg leu três chamadas encerradas e criou zero; POCTEP leu dez e criou duas; repetição de ambas SUCCESS, zero duplicados, POCTEP duas sem alterações e sem novas revisões. Catálogo: **119 identidades, 17 execuções, zero ativas** no fim da verificação. Nova leitura pública coincide com os campos persistidos; linhas/histórico anteriores e dados tenant intactos. Chrome OIDC desktop/móvel PASS, fontes corretas, histórico conferido e administração negada a membro comum. Worker em PROCESSING, sem recolhas automáticas agendadas. [Fecho e limites](reviews/c4g-pilot-parity-delivery-4-interreg-poctep.md), [comparação real](../output/playwright/c4g-official-live/comparison.html), [arquivo do incremento](history/c4g-pilot-parity-delivery-4-interreg-poctep.md). Entrega 4 global continua em curso. Próximo passo: recuperar o percurso de importação com pré-visualização, validação e resultado, começando por Portugal 2030.

Os registos seguintes conservam as etapas anteriores; as pendências de processamento/importação Interreg e POCTEP descritas abaixo ficaram resolvidas pela validação acima.

**Interreg Europe e POCTEP implementados — 18/10/2026.** Adaptadores corrigidos e ligados à fila/catálogo centrais com identidades por fonte/período/chamada, datas civis e proveniência própria. Migração 018 aplicada localmente com backup restrito; 117 identidades, 13 execuções e dados/histórico da organização preservados. 120 testes backend, 26 frontend, build, PostgreSQL descartável e Chrome OIDC desktop/móvel PASS. Leitura pública pelo código corrigido: Interreg três históricas/zero atuais; POCTEP dez/duas atuais. Zero importações reais. **Worker em `--standby`, sem consumir jobs:** reinício normal recusado pela revisão automática por poder executar recolhas pendentes; alternativa sem processamento testada e aceite. API e interface reconhecem cinco fontes; apresentação POCTEP validada com HTTP simulado, identificado como teste. [Provas/limites](reviews/c4g-pilot-parity-delivery-4-interreg-poctep.md), [comparação](../output/playwright/c4g-official-sources/comparison.html). Próximo passo: retomar processamento e conferir as duas importações reais antes do fecho. Entrega 4 global permanece em curso.

**Interreg Europe e POCTEP verificados — 18/10/2026.** Fontes públicas acessíveis (HTTP 200). Interreg mantém o XLSX oficial, com três chamadas gerais encerradas e indicação de ausência de novas chamadas abertas; conversão atual de datas depende do fuso e a identidade exige revisão. POCTEP tem dez chamadas no calendário, duas abertas (9.ª e 10.ª); API pública WordPress confirmada. Parser antigo extrai duplicados/notícias e datas invertidas, pelo que mudar apenas o endereço não basta. [Investigação e recomendação](research/interreg-poctep-source-verification-2026-10-18.md), [provas](../output/interreg-poctep/verification.json). Seis asserções de auditoria PASS; nenhuma sincronização legada, importação ou alteração da aplicação/dados. Disponibilidade das fontes verificada; adaptação central, testes de persistência e percurso real continuam pendentes. Próxima ação: recuperar os adaptadores com identidade/proveniência próprias, datas corretas e histórico preservado, conforme recomendação documentada.

**Correções aplicadas e validadas — 18/10/2026, 12:35 (Lisboa).** Classificações CERV/ESC corrigidas; ordenação composta aplicada; chamadas em cascata usam identidade própria `CASCADE:<callccm2Id>`, mantendo a referência legível do tópico. Reconciliação local com backup: seis chaves externas e duas classificações corrigidas em sete registos, sem mudar os 110 UUIDs existentes, relações, histórico anterior ou dados da organização. 42 testes backend, 10 frontend, build, PostgreSQL descartável (rollback, correções manuais, idempotência e relações) PASS. API/worker reiniciados; consultas públicas válidas antes de três novas importações: cinco novos registos Funding & Tenders, dois CORDIS, nenhum Erasmus; todas SUCCESS, zero falhados. **117 identidades, 13 execuções, zero ativas.** Nova conferência pública coincidiu integralmente com os campos/identidades importados. UI OIDC confirma duas chamadas CERV distintas, link antigo preservado e referência legível; desktop/móvel sem overflow. [Provas](reviews/c4g-pilot-parity-delivery-4-programmes.md), [dados reais](../output/funding-programmes/real-imports-identity-v2.json), [UI](../output/playwright/c4g-funding-identity/native-verification.json). Este incremento está validado; entrega 4 global continua em curso, com Interreg/POCTEP, importações e alertas ainda por verificar. Funding & Tenders/CORDIS continuam limitados a 100 resultados, sem promessa de catálogo completo nem snapshot imutável da fonte.

Os registos seguintes conservam a investigação e as verificações anteriores; as recomendações de classificação/desempate/identidade abaixo já foram implementadas neste incremento.

**Auditoria oficial concluída — 18/10/2026, 12:24 (Lisboa).** FACET confirma `43251589 → CERV` (atualmente convertido indevidamente em LIFE) e `43254037 → ESC` (sem nome). Três repetições das consultas atuais mostraram paginação instável; desempate `deadlineDate DESC, identifier ASC, callccm2Id ASC` foi aceite pela API e manteve conjunto/ordem estáveis em três repetições das três seleções. Encontrado também um problema de identidade: sete chamadas CERV em cascata têm o mesmo `identifier`, mas `callccm2Id` distintos; a deduplicação atual pode fundir chamadas diferentes. Zero chaves duplicadas no catálogo não valida esse caso. [Investigação, provas e recomendação](research/funding-classification-pagination-2026-10-18.md). Sem alterações da aplicação ou dados: 110 identidades, dez execuções, zero ativas. Antes de fechar: documentar e corrigir conversões, desempate e identidade por tipo, reconciliando o catálogo sem perder relações/histórico; testar e voltar a conferir importações reais. Recomendações ainda não implementadas.

**Importações reais retomadas — 18/10/2026, 12:15–12:19 (Lisboa).** Worker arrancado com a correção Erasmus/RENEWFM; API local, frontend e autenticação existentes arrancados. As três consultas públicas devolveram HTTP 200 válido antes das importações. Recolhas submetidas na interface com a conta administrativa existente: Funding & Tenders recebeu 100, criou 83, atualizou um e conservou três; CORDIS recebeu 100, criou 17 e reconheceu 82 existentes; Erasmus recebeu três e criou um. Todas SUCCESS, zero falhados. Catálogo passou de nove para **110 identidades**, sem identificadores duplicados, dez execuções históricas, zero ativas. [Conferência real](../output/funding-programmes/real-import-verification.json), [percurso UI](../output/playwright/c4g-funding-programmes/native-verification.json).

O bloqueio de disponibilidade anterior não se reproduziu. **Fecho ainda pendente de qualidade/cobertura:** consultas posteriores devolveram conjuntos parcialmente diferentes dentro do limite de 100, com repetições entre páginas; os registos comuns conferem com os dados persistidos. Erasmus devolveu apenas `43353764`, sem RENEWFM; dois resultados foram excluídos por não serem atuais na consulta de conferência. Código `43254037` continua sem nome no catálogo (`ESC-HUMAID-2021-QUAL-LABEL-FP`); `CERV-2024-CITIZENS-VALUES` está normalizado como LIFE, merecendo auditoria dos metadados/mapeamento oficial antes de corrigir. Não alterar por inferência do prefixo. Não há recolha automática agendada. Próxima ação: conferir estes casos e a estabilidade da paginação, preservando as importações reais e o limite aprovado. Interreg/POCTEP, importações e alertas mantêm as pendências próprias.

Os registos seguintes descrevem as verificações anteriores à retoma bem-sucedida.

**Correção Erasmus/RENEWFM — 18/10/2026:** removido `43253967` dos filtros Erasmus central e legado; conversão partilhada corrigida para `RENEWFM`, mantendo `43353764` como `ERASMUS`. Os dois testes de regressão falharam antes da correção; depois passaram os 22 testes direcionados, verificações sintáticas e o teste do worker em PostgreSQL descartável. A recolha geral persiste RENEWFM corretamente; Erasmus rejeita esse programa sem alterar a sua identidade/revisão. [Prova](../output/funding-programmes/renewfm-separation-verification.json). Sem importações reais: nove identidades, sete execuções, zero ativas antes/depois. Worker nativo encontrado parado; a correção será carregada no próximo arranque. Conferência real e fecho continuam pendentes.

**Última verificação externa: 18/10, 00:08 (Lisboa).** Três consultas públicas excederam 15 segundos; uma medição de diagnóstico mais longa recebeu HTTP 500 após 41 segundos. [Prova](../output/funding-programmes/extended-check-2026-10-18.json). Sem dados válidos para retomar a importação. Naquela verificação: health local 200, nove identidades preservadas, sete execuções anteriores, zero ativas; sem nova importação nem alterações da aplicação. A fonte externa não foi novamente consultada durante a correção Erasmus/RENEWFM.

Funding & Tenders ampliado para 100 resultados/25 por página/quatro páginas; CORDIS/Erasmus ligados à recolha central por seleções fechadas, identidade partilhada, correções manuais preservadas e histórico por fonte. Central 017 aplicada no ambiente habitual com backup restrito e dados preservados. 53 testes backend, seis frontend, build, gates PostgreSQL com retomada/crash e Chrome OIDC desktop/móvel PASS. [Provas e limites](reviews/c4g-pilot-parity-delivery-4-programmes.md), [comparação com piloto](../output/playwright/c4g-funding-programmes/comparison.html).

**Validação de ingestão real pendente:** as três recolhas solicitadas na interface terminaram SOURCE_TIMEOUT, sem novos registos; erros ficam no histórico e catálogo anterior preservado. Repetir com resposta real da API e conferir filtros/cobertura antes de declarar esta fatia concluída. Não confundir PASS do percurso/segurança com sucesso da fonte. Interreg/POCTEP, importações e alertas continuam pendentes.

Nova tentativa em 17/10 às 23:44 (Lisboa): as três consultas públicas, limitadas a um resultado, excederam 15 segundos cada. Health local 200, worker disponível, nove identidades preservadas, zero execuções ativas. Não disparadas novas importações sem resposta válida da fonte. [Verificação datada](../output/funding-programmes/readiness-retry.json). Sem monitorização automática agendada; fecho continua pendente.

Diagnóstico posterior (após 23:49): pedidos mínimos, formulário completo e serialização explícita falham; o próprio portal no Chrome mantém SEARCH/FACET pendentes. Ambos os IPv4 publicados pelo DNS excedem 20 segundos mantendo TLS válido. [Diagnóstico consolidado](../output/funding-programmes/diagnostic-summary.json). Sem resposta válida, nova importação ou alteração da aplicação. Falha de serviço/rede a montante ainda impede a conferência real e o fecho.

Configuração dos anexos adiada para o final por instrução do utilizador. A entrega 3 mantém a pendência documental, incluindo composição, serviços reais e validação final; não está concluída. Trabalho conforme [contrato da entrega 4](features/c4g-pilot-parity-delivery-4.md).


## Recuperação do piloto — entrega 3 / In Progress (2026-10-17)

Pedido atual: recuperar anexos reais (E3-07/08). **In Progress — adaptadores preparados, percurso ainda não operacional.** O utilizador confirmou que R2 e antivírus ainda não estão configurados. Implementados adaptadores R2/S3 e ClamAV INSTREAM, limites/integridade/isolamento de prefixos e diagnóstico sem segredos; bootstrap corrigido para não declarar prontidão com portas nulas/handlers vazios. 39/39 testes locais PASS (comandos SDK e protocolo simulados), node --check PASS; aplicação habitual responde HTTP 200. Sem alterações de dados, migrations, grants ou frontend. Faltam serviços reais, composição APPLICATION/F11/F7/F9, endpoints/worker, inspeção OOXML e interação/validação visual. [Contrato e configuração](references/application-attachments-transport.md), [provas e limites](reviews/c4g-pilot-parity-delivery-3-attachments.md). Não declarar entrega 3 concluída. A instrução posterior do utilizador autoriza avançar para a entrega 4, adiando a configuração documental para o final.

O registo seguinte corresponde ao incremento anterior de parceiros/contactos, já ativado e validado.

Recorte anterior: recuperar parceiros e contactos por candidatura (E3-06). **Review — implementado, ativado com autorização explícita e validado no ambiente habitual.** Formulário/cartões/tabela originais recuperados, pesquisa/filtros/paginação, pessoas com IDs estáveis, remoção lógica e histórico. [Contrato](references/application-partners-http.md), [provas e comparação](reviews/c4g-pilot-parity-delivery-3-partners.md). Build, 28 testes frontend/11 backend, PostgreSQL/API e Chrome A/B PASS; tarefas preservadas. A rejeição inicial da revisão automática foi resolvida pela autorização explícita do utilizador. Executado `node backend/scripts/localPlatform/applicationPartners.js --apply`: migration 028 aplicada, backup protegido/verificado e dados anteriores preservados; privilégios temporários retirados. Backend reiniciado para reler o snapshot. `test/integration/application-partners/native.cjs` PASS com OIDC existente: Parceiros, Pessoas, perfil, Matching, candidaturas, responsáveis e catálogo; desktop/móvel, zero erros de página ou escritas de negócio. Provas em `local-upgrade.json`, `native-verification.json` e capturas `native-*` na pasta da comparação. Anexos reais pendentes; entrega 3 integral continua em curso.

Incremento anterior: implementar os estados e campos previstos a partir dos componentes originais. **Incremento implementado, ativado com autorização explícita e validado no ambiente habitual.** Novas candidaturas em Identificada, matriz confirmada com motivos/histórico, prazo civil, notas e dois orçamentos exatos; componentes originais partilhados com o runtime atual. Tarefas e revisão existentes preservadas. [Contrato](features/c4g-pilot-parity-delivery-3.md), [provas e limites](reviews/c4g-pilot-parity-delivery-3-states-fields.md), [comparação lado a lado](../output/playwright/c4g-application-lifecycle/comparison.html).

Validação: build PASS, 34 testes frontend, 13 backend; PostgreSQL descartável confirmou migração, rollback, recibos antigos e tarefas; 64 combinações HTTP; Chrome confirmou criação/edição/releitura, resposta perdida, submissão/recuo/aprovação e isolamento. Comparação revista pelo utilizador, que confirmou «Já vi vamos avançar».

A rejeição inicial da revisão automática ficou resolvida pela autorização explícita do utilizador. Executado `node backend/scripts/localPlatform/applicationLifecycle.js --apply`: backup protegido e verificado, migração 027 aplicada, dados/histórico/tarefas/recibos preservados e privilégios temporários retirados. Backend local reiniciado. `test/integration/application-lifecycle/native.cjs` PASS com OIDC existente: Pessoas, perfil, Matching, candidaturas, responsáveis e catálogo; lista e formulário visíveis, sem erros de página nem escritas de negócio. Evidência em `local-upgrade.json`, `native-verification.json` e capturas `native-*` na pasta da comparação.

A lista completa foi recuperada e validada: oito colunas, filtros/contagens autorizados, ordenação global, paginação e estado com motivo/repetição segura. Build, 17 testes frontend, 19 backend, PostgreSQL/HTTP e Chrome A/B PASS; OIDC habitual PASS sem escritas de negócio. [Provas e comparação da lista](reviews/c4g-pilot-parity-delivery-3-list.md). A entrega 3 completa permanece em curso: transporte documental real pendente. Entregas 4–5 não iniciadas.

E3-02 implementado segundo [contrato HTTP](references/application-list-http.md); comparação preparada, sem inferir aprovação visual deste novo bloco. O bloco de parceiros/contactos está agora implementado, ativo e validado acima.

## Registos anteriores

## Recuperar a aplicação do piloto com identidade C4G / Review — entrega 1 (2026-10-17)

**Revisão final concluída — pronta para fecho da entrega 1:** densidade da tabela e faixa Prazo/Candidaturas/Dotação/Registo recuperadas; Registar interesse ligado à criação atual; descrição expansível preserva a fonte completa. Build, 72 testes frontend/12 backend e browser real PASS nas provas anteriores. Ensaio descartável PostgreSQL com duas organizações e Chrome: criação manual, edição, transição, histórico relido, resposta perdida recuperada e isolamento PASS. Corrigida a concorrência entre leitura privada e atualização do contexto usando a fila existente. Comparação final revista sem novas correções obrigatórias no âmbito; detalhe mais alto pelas adaptações documentadas ao catálogo central. Aprovação visual do utilizador não inferida; entrega 2 não iniciada. Nesta revisão apenas documentação, sem nova execução dos testes. [Veredicto, comparação e limites](reviews/c4g-pilot-parity-delivery-1.md).

**Registo anterior de execução (antes das correções):** Dashboard ligado às consultas atuais autorizadas, menu visível acima de 768 px e Programa/Fonte separados. Validação final: build, 41 testes frontend/14 backend e Chrome real ADMIN/gestor PASS; quatro detalhes, filtros, larguras e formulário manual verificados, zero escritas de negócio. [Comparação e limites](reviews/c4g-pilot-parity-delivery-1.md): persistem diferenças de densidade e faixa de indicadores do detalhe; não foi repetida criação persistida numa organização de ensaio. Entrega 1 permanece em curso para revisão da comparação; entrega 2 não iniciada. O parágrafo seguinte regista a fase inicial de planeamento, anterior às alterações na aplicação.

Direção reafirmada pelo utilizador: mesmas funcionalidades e experiência da aplicação UBI, com visual C4G e Organização → Departamentos/Unidades → Pessoas; melhorias novas só depois. [Plano de ação e critérios de equivalência](features/c4g-pilot-parity-action-plan.md): cinco entregas, começando pela composição original, Dashboard e oportunidades, com comparação lado a lado. Matching, perfil pessoal, parceiros, anexos, utilizadores, importações, fontes e alertas fazem parte da recuperação. Preservar catálogo central, autenticação/memberships, isolamento, dados e trabalho existente; candidatura manual independente de Matching/perfil completo. Este plano passa a orientar a sequência proposta; a revisão técnica de acesso abaixo não prova paridade visual, que o utilizador contestou. Nesta tarefa houve apenas análise e documentação, sem alterações na aplicação, bases, serviços ou Git mutável. Os registos anteriores são preservados como histórico.

## Fecho C4G — entrega 1: acesso e visibilidade / Review (2026-10-17)

Executado o incremento 1 autorizado do [plano de fecho](features/c4g-app-closure-plan.md): ADMIN entra nas fontes e consulta o catálogo comum sem organização; gestor entra no catálogo com contexto C4G. Leitura de plataforma em endpoint próprio com autoridade atual na transação somente de leitura; fronteira de membership dos clientes preservada. Menu recolhível até 1100 px e também em desktop, navegação por contexto, saída explícita de áreas privadas sem organização, tabela mais legível e ajuda expansível. [Prova e capturas](reviews/c4g-access-navigation/README.md): 46 testes frontend/18 backend, build/sintaxe e Chrome/OIDC real admin/hugo em localhost:3000 PASS, quatro detalhes, filtros/recarregamento, teclado e larguras 1008/1280/1440/390. Hashes de dados antes/depois iguais: nove oportunidades, perfil, três unidades e uma pessoa preservados; zero recolhas/escritas de negócio. Sem migrations, alterações de acessos, reativação legacy ou Git mutável; residual preservado. Pronto para revisão visual pelo utilizador na janela habitual; Dashboard, matching e preenchimento da equipa pertencem às entregas seguintes.

## Consolidação da instalação local C4G / Review (2026-10-17)

[Contrato executado](features/local-platform-consolidation.md): localhost:3000/5000 e PostgreSQL nativo 5432 são o ambiente de trabalho. Nove oportunidades, 17 revisões e quatro recolhas transferidas com auditoria íntegra; conta/MFA/membership preservados e seis grants do perfil acrescentados. Ficha C4G, três unidades e Hugo Romão preenchidos a partir das fontes oficiais, sem inferir unidade principal nem criar acesso. Worker existente ligado à Central nativa; demonstração 5189/5561 arquivada e parada, volume/candidatura sintética preservados. [Evidência](reviews/local-platform-consolidation/README.md): rollback prévio, repetição sem duplicação, 30 testes backend/17 frontend, build/sintaxe e Chrome com acessos reais PASS; última passagem apenas de leitura, quatro detalhes e perfil em desktop/móvel com base antiga parada. Sem nova recolha, funcionalidades adicionais ou Git mutável. Pronto para revisão do perfil pelo utilizador; confirmar organograma e afetações reais. Os registos anteriores descrevem os ambientes antes desta consolidação.

## MFA opcional por utilizador / Review (2026-10-17)

[Contrato](features/optional-user-mfa.md) e [decisão](decisions/2026-10-17-user-optional-mfa.md) aplicados: MFA opcional em toda a aplicação local, incluindo operações administrativas/sensíveis; admin/hugo entram com as passwords anteriores. Segurança da conta permite gerir MFA pelo titular. Realm nativo próprio; identidades globais, memberships, grants e demonstração preservados. [Evidência e limites](reviews/optional-user-mfa.md): Chrome real comprovou ativação, OTP errado, reinstalação, desativação e ambos os acessos nativos; 63 testes backend focados/54 frontend, sintaxe e build PASS. Asserção global de storage F2 do trabalho paralelo registada separadamente, sem a relaxar. Sessões antigas exigem novo login. Npm dev ativo em 3000/5000; cluster de prova parado. Pronto para revisão de utilização local.

## Plataforma local — PostgreSQL nativo e acessos / Review (2026-10-17)

[Contrato autorizado](features/local-postgres-platform.md) instalado nas bases nativas 5432: Central/tenant, entidade C4G, acessos admin/hugo com OIDC/MFA e catálogo vazio. Backend e frontend iniciados por `npm run dev` em 5000/3000. [Evidência e limites](reviews/local-postgres-platform.md): PostgreSQL 18 nativo, idempotência/reinício, browser real, separação de permissões e teste com atraso de callback PASS; 59 testes backend, sintaxe e build PASS. Locale tenant corrigido mediante autorização explícita, preservando a base original como `c4g_tenant_dev_before_c4g_20261017`. Credencial e bloqueio do catálogo de auditoria resolvidos. Configuração/acessos privados em `.tmp/local-platform`; [instruções](../LOCAL.md). Demonstração e trabalho paralelo preservados; sem recolha externa ou dados de negócio de exemplo. Pronto para revisão humana deste recorte; não declara as restantes funcionalidades prontas para produção.

## Perfil da Organização — estrutura e pessoas / Complete — revisão local concluída (2026-10-17)

Correção e conclusão da revisão autorizadas pelo utilizador. “Temas e prioridades” e “Perfil publicado” agora consultam os serviços existentes: ligação apenas após sucesso, indisponibilidade/recusa/consulta inconclusiva apresentadas no perfil, nova verificação e descarte de respostas antigas. Critério 8 concluído: 21 testes frontend e build PASS; Chrome/OIDC real nas duas entidades, larguras 1440/768/390, nova consulta sem navegação para erro e todas as leituras do diretório 200. Catálogo e candidatura preservados, zero escritas de negócio. [Evidência final](reviews/organization-profile-recovery/README.md#correção-dos-atalhos-e-conclusão-da-revisão). Publicação/matching não foram ativados; nenhuma outra funcionalidade iniciada. Evidência da implementação anterior abaixo preservada.

[Recuperação executada](features/organization-directory-recovery.md): Organização → Departamentos/Unidades → Pessoas, reutilizando a árvore/serviço F13-P1, identidade central e apresentação existente com marca C4G. Ficha da organização, criação/renomeação/hierarquia de unidades, pessoas com várias afetações e unidade principal, pesquisa/filtros/paginação e inativação; nenhuma conta ou membership implícita. [Evidência e limites](reviews/organization-profile-recovery/README.md): 103 testes backend, 129 frontend antes dos dois novos testes de fila e 17 focados finais, build/sintaxe, integridade PostgreSQL 17/18, HTTP A/B e Chrome PASS. Corrida inicial com a consulta de organizações resolvida pela fila existente, mantendo os controlos de autoridade. Demonstração 5189 atualizada pela migration aditiva 025 e comprovada com OIDC/MFA real nas duas entidades; nove oportunidades e candidatura preservadas, zero registos de negócio criados. Diretório vazio preparado para uso; matching/editorial conservam os seus gates. Instalação nativa e MFA opcional pertencem às tarefas paralelas; residual preservado. Revisão local concluída acima, sem declaração de prontidão de produção.

## Catálogo C4G — candidaturas e financiamento / Review (2026-10-17)

[Recorte executado](features/catalog-application-financing-parity.md): lista mostra candidaturas autorizadas da organização (estado/ligação direta ou contagem/estados), por consulta privada limitada à página; financiamento coerente entre lista e detalhe, com montantes exatos ou ligação aos valores na descrição. [Prova e limites](reviews/catalog-application-financing-parity/README.md): 51 testes frontend, 44 backend distintos, sintaxe/build e Chrome/OIDC real em arranque normal PASS; quatro detalhes, filtros/âncoras, nove oportunidades centrais preservadas, candidatura A visível/B recusada, lista privada 200 e larguras 1440/768/390. Sem escritas de negócio, recolhas, migrations ou Git mutável. Registada intermitência `AUTHORITY_WRITE_PENDING` no recarregamento direto da lista privada, antes do SQL; percurso normal passou, coordenação de sessão não alterada. Demonstração 5189 ativa e trabalho paralelo preservado. Critério para a adaptação seguinte: perfil da organização → departamentos/unidades → pessoas, reutilizando o racional e a infraestrutura existentes, com marca C4G e isolamento por entidade.

## Recuperação UBI — lista e detalhe de oportunidades / Review (2026-10-17)

Executada a [recuperação visual e funcional](features/opportunities-ubi-ui-recovery.md): tabela responsiva, cabeçalho/indicadores/ficha e candidaturas da organização, adaptados dos componentes UBI aos serviços central/privado existentes. Catálogo central, filtros melhorados, autenticação e fronteiras multi-entidade preservados. Filtros conservados ao voltar do detalhe; revisão central exata e edição/arquivo privados mantidos. [Prova e limites](reviews/opportunities-ubi-ui-recovery/README.md): 41 testes frontend, 6 backend, sintaxe, build e Chrome/OIDC real PASS; quatro detalhes, nove registos preservados, candidatura existente em A/inacessível em B e largura móvel. Demonstração 5189 ativa no arranque normal. Sem endpoints legacy reativados, recolha externa, migrations, alteração de identidades ou dados de negócio; residual preservado. Próximo passo: revisão visual deste recorte pela referência UBI antes de outra funcionalidade.

## Direção confirmada — recuperar frontend UBI sobre a plataforma C4G (2026-10-17)

O utilizador determinou que a experiência UBI é a referência, preservando a autenticação nova e as melhorias úteis; não reconstruir a aplicação nem continuar alterações isoladas sem esta comparação. [Matriz página a página e critério de recuperação](reviews/2026-10-17-frontend-ubi-referencia-recuperacao.md). Baseline `3a79b25539040c2024051cf9ab6295680b760277`, igual à referência local `legacy-origin/main`: 12 de 20 ficheiros de páginas iguais, três alterados apenas numa ligação; várias páginas estão ocultas por placeholders ou substituídas por interfaces mais reduzidas no modo F12. Recuperar apresentação e percursos existentes, adaptando dados/perfil/permissões multi-entidade; nunca repor autenticação ou acesso global legacy. Esta direção prevalece na sequência de recuperação sobre os próximos passos isolados abaixo, sem eliminar histórico, contratos, segurança ou residual. Comparação estática concluída; nenhuma implementação nesta tarefa. Próxima recuperação proposta: lista e detalhe de oportunidades usando os componentes UBI sobre catálogo central/privado já construído.

## Cat?logo ? detalhes e filtros / Review (2026-10-17)

[Contrato](features/catalog-details-filters.md). Quatro detalhes corrigidos e condi??es principais confirmadas nas fichas oficiais; sele??o de programa e atalhos 7/14/30 dias operacionais. Atualiza??o real: zero criadas/quatro atualizadas/zero falhas. Backend 18/18, frontend focado 6/6, build e Chrome real (filtros combinados, hist?rico, m?vel e candidatura preservada) PASS. [Prova e limites](reviews/c4g-catalog-demo/details-and-filters.md): Gnomon/METU s?o chamadas distintas indevidamente colapsadas pelo t?pico; a interpreta??o anterior de duplicado n?o prova duplicidade. Intermit?ncia MFA local observada, sem relaxar controlos. Sem outro dom?nio, Git mut?vel ou elimina??o de residual.


## Entrega 2 — seleção atual da fonte corrigida / Review (2026-10-17)

[Contrato](features/funding-current-opportunities-fix.md) e [prova](reviews/c4g-catalog-demo/current-selection.md). API mantém alguns avisos antigos como abertos; o adaptador agora considera todas as datas e seleciona o próximo prazo civil >= hoje UTC, com amostra ordenada por prazo descendente. Filtro existente preenchido com hoje na UI; limpar permite histórico. Atualização real limitada: quatro criadas/zero falhas (cinco resultados, uma identidade duplicada), cinco antigas e candidatura anterior preservadas. Backend focado 16/16, frontend 100/100 e build PASS; Chrome OIDC/MFA comprovou registos atuais e candidatura antiga acessível. Ambiente 5189 continua ativo, sem avançar para outras funcionalidades. O finding de seleção por primeira data abaixo é histórico; cobertura integral e confirmação de condições na fonte continuam fora desta prova.

## Entrega 2 — ambiente persistente com catálogo real / Review (2026-10-17)

[Contrato](features/c4g-catalog-demo-environment.md) e [operação/evidência](reviews/c4g-catalog-demo/README.md). Ambiente separado em http://localhost:5189, PostgreSQL próprio em 5561, volume persistente, API e worker em processos separados. Login real OIDC/MFA no Keycloak local, cliente exclusivo e gestor próprio; cliente e bases habituais preservados. Chrome comprovou ADMIN → recolha real → cinco registos → detalhe → candidatura privada A/recusa B. Reinício de API/worker preservou catálogo/candidatura. Primeira recolha: cinco criadas/zero falhas; repetição após correção CEF: zero criadas/quatro atualizadas/zero falhas. Build, frontend 100/100, backend focado 18/18 PASS. **Finding em aberto: amostra real contém prazos antigos; validar consulta/atualidade antes de demonstração comercial de avisos abertos.** Sem nova funcionalidade, produção ou completude prometida. Os estados seguintes são históricos e não substituem este avanço.

## Entrega 2 — consulta do catálogo C4G / In Progress (2026-10-17)

Continuação autorizada pelo utilizador, preservando Funding & Tenders em Review e a entrega 1. [Recorte em Review](features/c4g-catalog-usability.md): pesquisa central por título/identificador, programa, datas inclusivas, paginação anterior/seguinte, identificação de dados sintéticos, recuperação de erro e revisão móvel. Sem novas migrations ou recolhas externas. PostgreSQL/Chrome A/B PASS em duas execuções; largura mínima legada que cortava a tabela móvel corrigida e reconferida nas capturas finais. Build, 100 testes frontend/16 backend focados e teclado/menu móvel PASS. O ambiente habitual não foi reconfigurado. O ensaio real anterior eliminou os seus registos; demonstração integrada real e ambiente durável continuam pendentes. [Evidência final](reviews/c4g-delivery-2/README.md). Entrega 2 integral permanece In Progress.

## Entrega 1 — identidade e navegação C4G / Review (2026-10-17)

Execução explicitamente autorizada: visual C4G, tokens semânticos, login/identidade global, navegação por trabalho/organização/plataforma, organização ativa e estados “Em integração” para páginas ainda dependentes do piloto no modo F12. Catálogo central e candidaturas preservados; modo legacy mantido. [Evidência, capturas e ambiente identificado](reviews/c4g-delivery-1/README.md): frontend ativo em localhost:3100, API em localhost:5000 com health positivo; build e 96/96 testes frontend PASS; Chrome automatizado de shell, teclado/móvel e rotas PASS com API/sessões sintéticas. Sem login real, validação de worker ou declaração de prontidão comercial. Sem alterações backend/bases, recolhas ou operações Git mutáveis. Pronto para revisão visual; não fecha as entregas funcionais seguintes nem altera o estado do trabalho Funding Tenders abaixo.

## Orientação funcional C4G — plano de recuperação (2026-10-17)

Objetivo confirmado pelo utilizador: pôr a APP C4G multi-entidade a funcionar, com visual C4G, catálogo central, matching, candidaturas, equipa, tarefas, documentos, Dashboard e alertas; sem acrescentar funcionalidades agora. **Catálogo central e matching fazem parte da recuperação obrigatória**, não são extensões adiáveis. Perfil completo/matching não bloqueiam candidatura manual. [Plano de ação proposto](features/c4g-functional-recovery-plan.md): cinco entregas, começando por identidade/navegação C4G e ambiente identificado; aproveita a integração Funding & Tenders em curso. Planeamento apenas, sem implementação nesta tarefa e sem alterar estados/fechos abaixo. Recorte e mapping do matching têm decisões delimitadas na entrega 3; não autorizam contornar contratos F13/F14. Todo o residual fica preservado.

## Funding & Tenders — ADMIN → catálogo central → clientes / Review (2026-10-17)

[Contrato](features/funding-tenders-central-first-slice.md) implementado com a precedência por campo confirmada pelo utilizador. [Evidência, inventário de fontes, limitações e comandos de demonstração](reviews/funding-tenders-central/README.md): PostgreSQL 17 Central+A/B, Chrome, worker em processo separado, interrupção forçada/retoma, concorrência, correções manuais e candidatura privada PASS; backend 115/115, frontend 91/91, build e sintaxe PASS. Migrations Central 015 e tenant 024 admitidas pelos runners canónicos. Ensaio real autorizado e executado em `127.0.0.1:5560/funding_live_rehearsal`: uma página, cinco oportunidades criadas, zero falhadas, cinco listadas e detalhes lidos; contentor descartável removido. Browser com registos reais permanece por demonstrar antes de considerar o marco do piloto fechado. Ambiente habitual e residual preservados. Sem stage/commit/push/deploy.

## Recomendação do plano — oportunidades reais antes do piloto (2026-10-17)

Adicionar um marco explícito obrigatório do MVP, antes de considerar o produto pronto para piloto: **uma integração real comprovada de ponta a ponta — API → recolha no worker → persistência versionada no catálogo central → listagem e detalhe na interface multi-tenant**. Esta recomendação não altera o trabalho ativo, os fechos anteriores ou critérios já evidenciados; não autoriza implementação, recolha externa, dados reais em desenvolvimento ou rollout.

Menor fatia recomendada: reaproveitar a consulta/normalização de `euFundingSyncService.js` para uma recolha limitada de EU Funding & Tenders, após contrato e critérios aprovados. Não basta ligar o cron legado: os serviços antigos escrevem na base UBI e notificam utilizadores legados; CORDIS e Erasmus consultam a mesma API. Faltam composição central autorizada, proveniência de API (a migration central 006 admite apenas `C4G_MANUAL`), job produtivo de recolha e leitura central integrada na UI. Preservar revisões, correções manuais e identidade externa estável; não reutilizar a alteração de `source` dos conectores antigos como deduplicação.

Recolher fontes públicas comuns uma vez para a central; fontes privadas e credenciais organizacionais exigem execução, segredos e persistência isolados por tenant, sem promoção implícita. A importação XLSX Portugal 2030 concluída não satisfaz este marco de API. A configuração `.env.local` inspecionada usa modo legacy, seed sintética e cron europeu desligado; isso não constitui bloqueio das chamadas manuais externas.

Dependências/gates propostos: confirmar condições de reutilização, autenticação e limites do fornecedor; limitar páginas/volume/tempo e tratar 429/5xx; definir autoridade de serviço e agendamento F9, idempotência/concorrência/retry e auditoria; testar mapping/datas/paginação, atualização sem perda de correções/histórico, proveniência e deduplicação, reinício após falha parcial e isolamento Central/A/B. Concluir com recolha real pequena expressamente autorizada em ambiente aprovado e prova de listagem/detalhe após reinício, sem notificações ou candidaturas implícitas. Fixtures não substituem este gate. Inspeção estática apenas: sem chamadas externas, consultas às bases ou execução de conectores; disponibilidade e termos atuais dos fornecedores não foram verificados.

## Candidaturas — documentos e revisão interna / READY_FOR_HUMAN_REVIEW (2026-10-17)

[Contrato aprovado](features/application-documents-internal-review.md) implementado: versão F11 exata, download autorizado, pedido sobre conjunto fixado, decisão `APPROVED`/`CHANGES_REQUESTED` com comentário, grant próprio, decisor distinto e `RECENT_MFA`, histórico e nova revisão quando o conjunto fica obsoleto, sem transição automática. [Evidência local e lista única de pendências](reviews/application-documents-internal-review/README.md): migration 023 up/down, PostgreSQL A/B e Chrome PASS; regressões focadas e build PASS. Sem fecho humano. F11 produtivo permanece fechado sem R2/scanner/Camada C; IdP simulado e dados locais. As fatias anteriores mantêm o fecho humano restrito; pipeline completo por concluir. Os registos seguintes são históricos.

## Candidaturas — equipa e tarefas / Complete — fecho humano restrito (2026-10-17)

[Contrato e fecho restrito](features/application-team-tasks.md): participantes por membership central válida, sem grants implícitos; criação, atribuição, edição, conclusão e cancelamento de tarefas, com histórico que apresenta autor, tarefa e valores resultantes. Concluir tarefas não altera automaticamente a candidatura. O finding da apresentação do histórico foi resolvido e a decisão humana aprovou o fecho restrito em 2026-10-17. [Evidência e lista única de pendências](reviews/application-team-tasks/README.md): PostgreSQL/browser e suites anteriores validaram o incremento; a correção final da interface teve teste de componente 4/4 e build PASS, sem nova validação no browser integrado. Provas locais com PostgreSQL descartável e IdP simulado; staging, produção, IdP externo e dados reais não validados. A primeira fatia fechada e o residual ficam preservados; pipeline completo por concluir. Próxima fatia **proposta**, sem implementação nesta tarefa: “Documentos e revisão interna”, reutilizando F11 e os mecanismos de autorização existentes. Sem stage/commit/push/deploy. Os registos seguintes são históricos.

## Candidaturas — primeira fatia utilizável / Complete — fecho humano restrito (2026-10-17)

[Contrato curto aprovado](features/application-first-slice.md), backend e interface entregues. Criação manual a partir de oportunidade F12 e criação com avaliação F14 exata opcional, responsável central e prazo obrigatórios, listagem, detalhe, edição, transições e histórico funcionam na interface. Os três findings de interface da revisão foram corrigidos: paginação de responsáveis, saída de recusa definitiva e isolamento de intenção por utilizador/sessão. PostgreSQL descartável e Chrome voltaram a comprovar A/B, idempotência e recuperação de resultado incerto; prova integrada 503 → logout → outro utilizador na mesma organização confirmou ausência de repetição. Frontend 84/84 e build PASS. [Evidência e lista única de pendências](reviews/application-first-slice/README.md). Revisão restrita com GO e aprovação humana explícita em 2026-10-17; nenhum blocker conhecido. Fechado apenas este incremento; o pipeline integral continua fora desta fatia. Residual preservado; sem stage/commit/push/deploy. Os registos seguintes são históricos.

## Marco F13→F14 — READY_FOR_HUMAN_REVIEW / reconferência restrita (2026-10-17)

Os quatro pontos do percurso ativar → avaliar → explicar → decidir → consultar histórico continuam comprovados: capacidade conjunta e recusa acima do limite, paginação sem perdas, dois restarts F12 append-only e fluxo PostgreSQL/browser com A/B e recuperação. A [reconferência do gate de histórico](reviews/f13-pq1-capacity-fix/recheck-history-gate.md) confirma 28/29 ficheiros do recorte e 29/29 artefactos com os hashes registados; o único delta do recorte é um ramo posterior e exclusivo de teste de candidaturas, sem alteração às fases de capacidade. Não se afirma identidade integral das dependências transversais posteriores nem reexecução das provas. A alteração posterior no carregamento das rotas teve testes frontend 80/80, build e Chrome de navegação/guarda PASS; não altera o domínio nem os componentes do percurso. [Provas e lista única de pendências](reviews/f13-pq1-capacity-fix/README.md). Sem blockers de capacidade do histórico; a admissão da migration 023 do trabalho posterior não é certificada por esta reconferência. Nenhuma repetição rotineira de gates. O fecho humano anterior aplica-se ao percurso restrito; F13/F14 integrais permanecem In Progress. Sem stage/commit/push/deploy. Os registos seguintes são históricos.

## Manutenção transversal — rotas carregadas a pedido (2026-10-17)

Páginas separadas por import dinâmico, com estado de carregamento e recuperação por reload perante falha. Guardas e layout mantidos. JavaScript principal: 612,83→243,66 kB; gzip 184,24→80,76 kB (não inclui os chunks da página visitada). Build PASS sem aviso de bundle; frontend 80/80 PASS, incluindo carregamento e falha sintética. Chrome sobre build produtivo com sessão simulada: acesso direto, navegação entre rotas, chunks a pedido e guarda administrativa antes do carregamento PASS (`node test/integration/lazy-routes.cjs`, após build). Sem nova prova de backend/autorização real. Restam WCAG integral, limpeza de estado sem leitura e desempenho transversal na lista de pendências existente. Sem stage/commit/push/deploy.

## Manutenção transversal — paginação a pedido corrigida (2026-10-17)

Pq1Details consulta uma página inicial por catálogo e por experiência selecionada, com continuação explícita. Respostas documentais antigas são ignoradas após mudança/limpeza da seleção ou desmontagem; referências guardadas fora da página permanecem selecionadas. Três regressões dedicadas em Pq1Details.test.jsx; frontend 78/78 e build PASS (aviso de bundle mantém-se). Contratos HTTP e backend inalterados. Próximo ponto da revisão: carregamento diferido das rotas. Restantes melhorias continuam na lista única da evidência do fecho restrito; sem stage/commit/push/deploy.

## Manutenção transversal — foco do menu móvel corrigido (2026-10-17)

Menu móvel fechado oculto e inerte; aberto com foco contido, Escape/botão de fecho e regresso ao botão de abertura. Navegação e mudança desktop→móvel preservam foco visível. Chrome real com componentes/CSS produtivos e sessão sintética: Tab/Shift+Tab, abertura, Escape, fecho, navegação e resize PASS (`node test/integration/mobile-navigation.cjs`). Frontend 75/75 e build PASS; mantém aviso de bundle. Não constitui auditoria WCAG integral. Fecho humano restrito anterior preservado; restantes melhorias mantêm-se na lista única da evidência abaixo. Sem stage/commit/push/deploy.

## Desbloqueio F13→F14 — Complete / fecho humano restrito (2026-10-17)

**C-PQ1-01 e fixture F12-E2-R2-001 resolvidos.** Percurso ativar → avaliar → explicar → decidir → consultar histórico demonstrado com PostgreSQL/browser: snapshot exato de 262144 bytes, excesso +1 recusado, 205 revisões de autoria (~11,7 MB), paginação sem omissões/duplicações, A/B e recuperação/UNKNOWN preservados. Backend 851/851, frontend 75/75 e build PASS; F12 com dois restarts consecutivos e regressão temática comprovados. [Evidência e lista única de pendências](reviews/f13-pq1-capacity-fix/README.md). Sem blockers identificados. Revisão técnica favorável e aprovação humana explícita em 2026-10-17: fechado apenas o percurso ativar → avaliar → explicar → decidir → consultar histórico. Limites/deadlines, fechos anteriores e residual preservados. F13/F14 integrais não declarados Complete; sem stage/commit/push/deploy. Os registos seguintes são históricos e não substituem este estado.

Nota de manutenção F12 — 2026-10-17, sem substituir o trabalho ativo F13-PQ1: correções F12-E2-R1-001/002 implementadas (preflight por capacidades cumulativas; harness com downgrades adjacentes canónicos até 012, reserva 013 preservada). Backend 834/834, focados 85/85, frontend 69/69/build, sintaxe e diff do âmbito PASS. Nova revisão read-only identificou F12-E2-R2-001 MEDIUM em test/integration/f12/gate.js:20: TRUNCATE CASCADE no restart é recusado pela proteção append-only F13. Gate PostgreSQL F12 passou runner/preflight/forward mas não terminou; F9 PostgreSQL não foi alcançado. Gate HTTP ultrapassou o downgrade/reapply e as assertions HTTP anteriores à chamada browserCreationFlow final; FAIL global por porta 5173 ocupada, sem terminar processo preexistente e sem declarar E2E integral. Sem enfraquecer triggers, sem alterar migrations/pins, sem fecho ou promoção de critérios. [Detalhe e limites F12](features/f12-private-opportunity-authoring.md#correção-e-segunda-revisão--2026-10-17).

Marco F13→F14-PQ1 — **In Progress / BLOCKED por C-PQ1-01 (capacidade conjunta do histórico)**, 2026-10-17: percurso ativar → avaliar → explicação → decisão humana local → histórico implementado. [Matriz consolidada única](reviews/f13-pq1-consolidated/README.md), com execução PostgreSQL/browser, evidência anterior reutilizada e inspeção separadas. Revogações de activate/evaluate/decide, F11, expiração exata, CAS/F7, corridas de critérios/ativação e recuperação original por lookup comprovadas nas provas aí identificadas. Backend 844/844, focados 36/36, frontend 75/75 e build PASS. Browser final A→B→A, três decisões persistidas, recuperação e 503 concorrente comprovados. Fecho bloqueado: material de 71 975 bytes com histórico de 355 037 bytes falha em deriveAuthors perante o teto de 256 KiB; falta admissão/capacidade conjunta comprovada. Findings de fila de sessão, vínculo F7 e decisão UNKNOWN/CURRENT corrigidos e validados. UNKNOWN e limites locais mantidos. Sem candidaturas, score ou comunicação. Fechos anteriores e F13 integral In Progress preservados.

Trabalho ativo: [F13-PQ1-ACTIVATE — materialização e ativação para F14-PQ1](features/f13-pq1-materialization-and-activation.md), **In Progress** (2026-10-17), implementação coordenada iniciada por pedido humano explícito. A1 refinada aprovada: histórico íntegro expirado/revogado não impede READY/ativação, não sustenta SATISFIED atual e não é convertido em UNKNOWN persistido; falta de acesso recusa, integridade/incompatibilidade falham fechado. D1–D7 preservadas. Revogação posterior consultada no ledger autoritativo PQ1, sob o mesmo lock transacional do escritor; resultado histórico, freshness e autorização separados. Extensão mínima do consumidor especificada, sem protocolo paralelo. Limites conjuntos preservados (100 items totais temas/prioridades), tetos operacionais e medições futuras explícitos, sem capacidade comprovada.

F13-PQ1-PUBLISH permanece **Complete — fecho humano restrito**, publicação multidomínio imutável e inativa; critérios evidenciados permanecem fechados. F13 integral **In Progress**. Tarefa própria ativa: implementação coordenada de materialização/ativação e avaliação/consulta F14-PQ1, com percurso integrado e gates do contrato; sem disponibilizar ativação temática isolada. Histórico desta especificação: Draft inicial, A1 refinada pendente e agora aprovada; não houve implementação nestas tarefas documentais.

### Primeiro bloco implementado — núcleo ainda não exposto

Materializador determinístico, identidade da publicação exata, leitura autoritativa de revogação com lock F13-P1, três avaliadores e freshness. [Evidência parcial](reviews/f13-pq1-activation/README.md): 15 testes novos PASS; backend 814/814; probe PostgreSQL real do leitor PASS, sem alegar HTTP/browser/ativação. Confirmado limite conjunto adicional de canonicalização: 256 KiB, abaixo do envelope de 1 MiB. Próximo bloco: persistência/manifestos, operações de ativação e consumo com autorização/auditoria/recuperação, depois HTTP/UI integrada. In Progress; nenhum percurso novo disponibilizado e nenhum gate integral declarado satisfeito.

### Segundo bloco implementado — persistência e transações internas

Migration tenant 019, snapshot/avaliação imutáveis, ponteiro CAS e recibos; operações internas ativar, consultar baseline, avaliar e consultar resultado, com F2/F5/F4/F7 e recuperação existente. [Evidência e matriz parcial](reviews/f13-pq1-transactions/README.md): focados 21/21, backend 820/820, PostgreSQL descartável de migrations e composição Central/A/B. Sem HTTP/UI ou montagem produtiva. Contrato **In Progress**: próximos trabalhos são preview/lookup/contratos HTTP e UI integrada, provas de revogação/F11/deadlines no consumidor e capacidade máxima. UNKNOWN pode persistir; sem fecho humano ou ativação isolada disponibilizada. O “próximo bloco” do registo anterior descreve a sequência antes desta entrega.

### Terceiro bloco implementado — preview, lookup e percurso HTTP/UI

Preview com token opaco, recuperação por lookup e percurso ativar → avaliar → consultar integrados, sob configuração conjunta explícita F13/F14. [Evidência e matriz acumulada](reviews/f13-pq1-http/README.md): 30/30 focados, 837/837 backend, 70/70 frontend/build; Central 013 e HTTP/browser A/B com PostgreSQL descartável. Os 8 testes UI novos usam API simulada; a prova browser separada usa produção composta e IdP sintético. Perda de resposta após commit → 503 → reload → lookup demonstrada; não equivale ao gate de 503 por concorrência na mesma sessão. Tenant 019 e fechos anteriores preservados.

Contrato integral **In Progress**. Pendentes: provas específicas de revogação/F11/deadlines, concorrência da mesma sessão e capacidade máxima conjunta; UNKNOWN pode persistir sem resolução automática. Próximo passo: completar estes gates antes da revisão para fecho humano; sem fecho nem publicação/deploy nesta tarefa.

## F13-PQ1-PUBLISH — Complete: fecho humano restrito

Percurso fechado: competências → experiências/evidências → verificação → submissão → aprovação → publicação multidomínio **imutável e inativa** → leitura. Finding de confirmação desfasada **resolvido**: alteração relevante invalida a confirmação e exige nova confirmação explícita. Parecer read-only PASS/GO seguido de aprovação humana; contrato PUB-01–15 conferido por evidência integrada, testes focados e mecanismos partilhados, sem lacuna obrigatória impeditiva identificada.

Referências: [evidência integrada e matriz](reviews/f13-pq1-publish/README.md), [matriz PUB-01–15](reviews/f13-pq1-publish/acceptance-matrix.md) e [correção/revisão](reviews/f13-pq1-confirmation/README.md). Provas anteriores PostgreSQL/HTTP/browser A/B, autorização, MFA/segregação, imutabilidade, CAS/F7/recuperação, migrations e F12/F9 reutilizadas; backend 799/799. Os **14 testes novos da correção estão incluídos nos 62 testes frontend PASS**, com build PASS e API simulada; não são provas PostgreSQL/browser integral. Nenhuma suite foi repetida neste fecho documental.

Antes da atualização: snapshot original de 652 ficheiros reconciliado com o delta (648 inalterados, dois componentes UI e dois documentos ativos), hashes da correção e 22 artefactos originais conferidos; HEAD/índice invariantes. Evidência histórica preservada. Limitações: 503 não demonstra rollback; UNKNOWN pode persistir sem resolução automática garantida, com bloqueio por recurso/dependência e suporte; certas combinações de sessão/membership/MFA/F7 têm cobertura partilhada e inspeção, não execução PQ1 individual. Sem validação de staging, produção, IdP externo, dados reais, SLO ou acessibilidade integral. F13 integral In Progress; sem READY, ativação ou avaliação F14.

### Histórico preservado — revisão anterior ao fecho PQ1

Trabalho ativo: [F13-PQ1-PUBLISH — publicação multidomínio inativa](features/f13-pq1-publish.md), **Review — READY_FOR_HUMAN_REVIEW**. Corrigido o finding médio da revisão read-only (NO-GO anterior): alterações no painel de competências/evidências invalidam a confirmação pendente; uma nova confirmação envia os valores atuais. [Evidência complementar e regressões](reviews/f13-pq1-confirmation/README.md): 14 regressões novas, suite frontend 62/62 e build PASS. Backend, migrations e gates PostgreSQL anteriores reutilizados, não reexecutados nesta correção exclusivamente de UI. [Evidência original](reviews/f13-pq1-publish/README.md) e matriz PUB-01–15 preservadas; limitações UNKNOWN e de provas partilhadas mantidas. Sem fecho humano; F13 integral In Progress. Publicação inativa, sem READY, materialização, ativação ou F14. Próxima etapa: revisão read-only da correção para nova decisão humana de fecho restrito.

Registo histórico anterior à aprovação D1–D7: Trabalho ativo: [F14-PQ1 — primeira pré-qualificação parcial F13→F14](features/f14-first-partial-prequalification.md), **Draft — PROPOSTA** (2026-10-16). Contrato próprio com entradas exatas, três avaliadores sem score, lacunas F13, decisões humanas separadas e matriz de aceitação pendente. D1–D7 aguardam decisão; nenhuma implementação autorizada ou iniciada. Próximo incremento proposto: **F13-PQ1-PUBLISH**, interface mínima de competências e publicação multidomínio, após aprovação e contrato técnico. Critérios evidenciados permanecem **Complete** no âmbito restrito já fechado; F13 integral permanece **In Progress**.

Registo histórico da próxima etapa no fecho anterior: Trabalho ativo: nenhuma implementação iniciada por este fecho. **Próxima etapa proposta:** concretização do contrato de pré-qualificação F13→F14, ainda não iniciada nem autorizada para implementação. F13 integral permanece **In Progress**.

## Critérios evidenciados — Complete: fecho humano restrito (2026-10-16)

Decisão humana explícita: **GO restrito aprovado**, incluindo a correção de freshness e as limitações da revisão final. Fechado apenas o percurso **criar → rever → confirmar → consultar** critérios privados tenant-local. Finding de freshness **resolvido**, com precedência **UNAVAILABLE → REVIEW_REQUIRED → CURRENT**. Confirmação exclusivamente editorial, sem avaliação de elegibilidade.

Âmbito, limitações aceites e distinção das provas no [contrato fechado](features/f13-f14-minimal-qualification-contract.md); referências à [evidência original](reviews/opportunity-evidenced-criteria/README.md) e à [correção/matriz de aceitação](reviews/opportunity-criteria-freshness/README.md). Antes da atualização documental: **704 hashes**, contrato e HEAD coincidentes; **11 + 17 artefactos** conferidos sem divergências. Focados 15/15, backend 790/790 e gate PostgreSQL/HTTP/browser PASS são resultados anteriores executados; frontend/build e gates dedicados foram reutilizados. Não foram repetidos testes neste fecho nem alterados artefactos históricos; os documentos de fecho são posteriores ao snapshot testado.

Limitações mantidas: **503 não prova falha definitiva**; a intenção pode permanecer **UNKNOWN**, com novas gravações conflitantes bloqueadas e encaminhamento para suporte, **sem garantia de resolução automática**. Certas combinações de revogação concorrente e falha F7 na gravação assentam em mecanismos partilhados efetivamente exercitados e inspeção da composição, não em execução específica. O percurso browser → 503 concorrente na mesma sessão → lookup não foi executado integralmente. Provas locais não validam staging, produção, IdP externo ou dados reais.

F13 integral continua **In Progress**. Avaliação F14, snapshot READY, ativação, scoring e decisões humanas sobre avaliações permanecem fora deste incremento; a próxima etapa é apenas proposta.

### Histórico preservado — estado anterior ao fecho

As menções seguintes a Review e ausência de fecho humano descrevem estados anteriores; não constituem trabalho ativo.

Trabalho ativo: [correção de freshness dos critérios evidenciados](reviews/opportunity-criteria-freshness/README.md), **Review — READY_FOR_HUMAN_REVIEW** (2026-10-16), sem fecho humano. Finding baixo resolvido: head/histórico/detalhe coerentes, UNAVAILABLE > REVIEW_REQUIRED > CURRENT, leitura de referências agrupada e histórico imutável. Focados 15/15, backend 790/790, PostgreSQL/HTTP/browser A/B e suplemento da matriz PASS; sintaxe/whitespace PASS. Evidência anterior preservada. A primeira tentativa do probe de concorrência na mesma sessão devolveu 503; diagnóstico preservado, teste final com dois sujeitos/sessões independentes PASS. Sem migrations/frontend alterados, avaliação F14, ativação ou candidatura. F13 integral permanece In Progress.

Registo anterior preservado: [critérios evidenciados da oportunidade — contrato técnico](features/f13-f14-minimal-qualification-contract.md), **Review** — percurso criar → rever → confirmar → consultar interpretações privadas tenant-local implementado e validado; READY_FOR_HUMAN_REVIEW, sem fecho humano. Backend 782/782, frontend 41/41, build, migrations, gates F12/UBI/editorial e browser A/B PASS. Evidência: [revisão do incremento](reviews/opportunity-evidenced-criteria/README.md). Avaliação F14 e ativação excluídas; ativação temática limitada adiada, respetivas D1–D2 não aprovadas. F13 integral permanece **In Progress**.

## F13 — interface editorial mínima e Central 010: Complete (2026-10-15)

**Fecho humano restrito aprovado**, após revisão final read-only PASS; **B1 resolvido**. Entregues authoring temático, submissão, completude editorial, MFA com nova confirmação, aprovação, publicação imutável e inativa, leitura e recuperação de intenções. Conferidos 722 hashes de código e 21 artefactos sem divergência. Backend 775/775, frontend 37/37, build, gates Central/HTTP A/B/editorial/F12/UBI e browser Chrome PASS. Âmbito e referência à revisão: `context/features/f13-minimal-editorial-interface.md`; evidência preservada: `context/reviews/f13-editorial-b1/README.md`.

F13 integral permanece **In Progress**; Central 009 e F13/016 mantêm os respetivos fechos. Sem snapshot READY, ativação ou consumo F14. Validação local com PostgreSQL descartável e IdP simulado; staging, produção, IdP externo, dados reais e SLO não validados. Sem auditoria WCAG integral nem ensaio separado de zoom 200%.

**Próxima etapa proposta, não iniciada:** especificação de ativação e do contrato de consumo do perfil. A baseline temática não é suficiente para matching; este fecho não autoriza automaticamente a implementação dessa etapa. Os registos seguintes são históricos.

## F13/016 — Complete: fecho humano restrito (2026-10-15)

Decisão humana explícita: **GO restrito aprovado; incremento editorial F13/016 Complete**. O finding temporal do guard está **resolvido**. O fecho abrange submissão com completude persistida, aprovação, versão imutável, publicação inativa e leitura autorizada do recorte temático, incluindo a correção do deadline de publicação e a validação local documentada. Não inclui ativação, snapshot READY ou consumo F14.

Antes deste registo foram conferidos os **671 hashes** de `context/reviews/f13-016-temporal-guard/tested-snapshot.json` e os **18 artefactos** listados em `artifact-hashes.json`, sem divergências ou ficheiros adicionais no recorte testado. Resultados existentes: **110/110** focados, **761/761** backend, provas temporais PostgreSQL/HTTP, gates F13/Central, F13-P1, F12 cumulativo/importação e UBI/Chrome PASS. Referência integral: `context/reviews/f13-016-temporal-guard/README.md`; hashes dos manifestos e âmbito formal em `context/features/f13-editorial-baseline-publication.md`.

**F13 integral permanece In Progress**, sem promoção dos seus critérios integrais. A UI editorial ainda não está implementada. Staging, produção, IdP externo e dados institucionais reais não foram validados; mantêm-se também os limites de SLO e fornecedores externos. A próxima entrega será a especificação da interface editorial mínima, não iniciada por este fecho.

Os registos de revisão, resultados e planos anteriores abaixo são preservados como histórico. As suas menções a Review/READY_FOR_HUMAN_REVIEW e a uma decisão de fecho ainda pendente descrevem o estado anterior a esta decisão. Este fecho documental não altera código, migrations nem evidência histórica; não repete testes funcionais.

## Histórico — F13/016: correção temporal validada (2026-10-15)

**Review — READY_FOR_HUMAN_REVIEW**, sem fecho humano; F13 integral **In Progress**. Corrigido o deadline de publicação para incluir a expiração da membership do aprovador, sem prolongar os limites existentes ou alterar operações sem approvalEvidence. `null` explícito sem prazo; omitido/inválido/expirado recusado; instante exato expirado. Validações inicial e final preservadas, sem novo protocolo ou migration.

Evidência final: 19 novos testes determinísticos; focados **110/110**, backend **761/761**, sintaxe **7/7** e whitespace do recorte PASS. Gate editorial PostgreSQL/HTTP **PASS**, incluindo rollback real após INSERTs/seals no instante exato e após expiração, epochs invariantes, guard ABORTED e ausência de publicação/idempotência/evento funcional persistidos. Expirado à entrada recusado sem guard; válido até ao fim permitido. Mutação em memória retirando só o novo limite faz falhar os dois testes críticos, como esperado.

Gates F13/Central, F13-P1, F12 cumulativo/F9, importação F12 migration/funcional e UBI/Chrome **PASS**; fingerprints 016 A/B, retorno 015 e autoridade Central reconfirmados. Evidência e snapshot em `context/reviews/f13-016-temporal-guard/README.md`; detalhes em `context/features/f13-editorial-baseline-publication.md`. Docker recuperou após indisponibilidade inicial; não resta prova PostgreSQL pendente neste recorte. Revisão read-only do delta sem findings materiais. Fixtures locais não validam IdP externo, staging, produção, dados UBI reais ou SLO. Sem UI nova/stage/commit/push/deploy; resíduos preservados. Próximo passo: decisão humana de fecho restrito.

## Histórico — plano de continuidade proposto (2026-10-15)

Plano para discussão, sem aprovação de novas features, alteração de estados ou autorização de rollout. A evidência de testes abaixo pertence às entregas anteriores; não foi repetida nesta ação de planeamento.

1. Rever e obter fecho humano restrito do incremento editorial F13/016, confrontando contrato, diff e evidência já registada. F13 integral continua In Progress; publicação editorial permanece inativa.
2. Consolidar o contexto: separar trabalho ativo do histórico preservado e atualizar as referências à implementação/testes após verificação dos scripts atuais. Preservar todos os resíduos do worktree e não reabrir entregas fechadas sem evidência concreta.
3. Propor como próxima fatia funcional uma UI mínima para o lifecycle editorial já entregue: leitura, submissão, aprovação e publicação inativa, com organização ativa, permissões e erros explícitos. Documentar contrato e critérios antes de implementar; confirmar o percurso de edição e os endpoints disponíveis. Não incluir activation, READY ou matching por inferência. Aproveitar uma entrega separada e delimitada para resolver F12-UI-001/002 antes de rollout.
4. Planear a ativação/consumo do perfil por F14 numa feature própria: confirmar cobertura exigida, completion, versões, invalidação e dados desconhecidos; mapear lacunas reais de F13 e aprovar apenas as fatias necessárias. Não tratar a baseline temática publicada como perfil integral pronto para matching.
5. Após contratos e dependências prontos, implementar uma fatia vertical de matching determinístico e qualificação, seguida de candidaturas e reporting. Cada fatia exige critérios próprios e testes de permissões, isolamento e rastreabilidade; scores, regras e pesos ficam versionados e a decisão humana é explícita.
6. Preparar staging/piloto por checklist própria: IdP/MFA, providers, diretório/segredos, API/worker, documentos, backup/restore e observabilidade. Catálogos produtivos e eventual amostra UBI exigem decisões/autorização próprias. Provas sintéticas locais não autorizam produção.

Validação por incremento: testes focados e regressões afetadas; frontend build e provas de browser para UI; node --check nos JS alterados; PostgreSQL Central + tenants A/B para autorização, tenancy, migrations, jobs, documentos e reporting; revisão formal contra os critérios. Repetir suites/gates adicionais quando mudanças ou findings o justificarem.

Próximo passo: revisão/fecho humano restrito de F13 editorial/016, mantendo o restante plano como proposta.

## Histórico — F13: lifecycle editorial da baseline em revisão (2026-10-15)

Estado do incremento: **Review — READY_FOR_HUMAN_REVIEW**, sem fecho humano formal. F13 integral permanece In Progress. Contrato e evidência: `context/features/f13-editorial-baseline-publication.md`. Submissão/completion persistidas → aprovação → versão imutável → publicação inativa → leitura autorizada entregues, incluindo HTTP com login limitado e guard Central.

Aprovação humana: recorte fixo de temas/prioridades de drafts mistos com identidade integral de origem separada do conteúdo editorial; policy produtiva única `F13_EDITORIAL_THEME_REQUIRED_V1` (temas KNOWN, prioridades KNOWN ou UNKNOWN explícito, até 100 itens, ausência/vazio INCOMPLETE); autores do material/seleção incluídos e submissor impedidos de aprovar/publicar; mesmo checker permitido nas duas operações mediante grants/MFA próprios.

Migration aditiva `016_f13_editorial_baseline_publication`, com up/down, instalação técnica governada, RLS/ACL, manifesto e pins reconciliados. Up `18365bce636ff77a257b55724545711db33b12520d6b34e0f613c1a256b6331d`; down `b3ed12fac21708f16bdb8d66a23f9d08d2f301dd3b313125f46bb1b785e5b87c`; fingerprint `bc47c3c859f9790136b70dc40d1159978f2f30ce80ffb124ec6522b546a6ea5a`. Central 009 e migrations fechadas preservados. Runtime opt-in `PROFILE_EDITORIAL_RUNTIME=f13-editorial`, policy resolvida no servidor e cadeia API explícita validada; sem administração genérica.

Evidência local: focados F13/root **35/35**, executor **33/33**, backend final **742/742 PASS**; gates editorial Central/A/B (incluindo HTTP, autoria, draft misto, revogação, falha F7 e commit incerto), F13/Central, F13-P1, F12 migration/funcional/cumulativo e UBI/browser **PASS**. Sintaxe **52 JS PASS**; whitespace do recorte PASS, mantendo três blank lines preexistentes fora do âmbito. Revisão read-only final sem blockers materiais; constraints JSON, sealing diferido sob role limitada e fixtures cumulativas corrigidos/revalidados. Sem staging, produção, rollout, IdP/fornecedores externos, dados UBI reais ou SLO validados; sem nova UI ou repetição de suite/build frontend. Índice vazio, HEAD preservado e sem stage, commit, push ou deploy. Próximo passo: revisão/fecho humano restrito deste incremento.

As propostas C1–C9 e o adiamento dependente da migração UBI abaixo são histórico de outra sequência, não pré-requisito deste incremento. UBI não define o produto. Não implementar a fatia de constraints; não reutilizar 013 reservada. Sem activation, READY, overlays, archive/restore, matching ou UI. F12 mantém o fecho restrito no commit `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; restantes resíduos preservados.

## Importação Excel/CSV de oportunidades privadas (2026-10-12)

- Tipo: `Feature`
- Estado: `Complete` — fecho humano restrito aprovado em 2026-10-14, após revisão final read-only sem blockers materiais. Os contratos funcionais F12 permanecem inalterados. Este fecho limita-se à evidência local e descartável registada e não valida staging, produção ou rollout.
- Objetivo: permitir que uma organização carregue um ficheiro XLSX Portugal 2030 privado, pré-visualize e confirme um mapeamento fechado, e acompanhe um job F9 que cria oportunidades privadas F12 de forma isolada, idempotente, auditada e reconciliável.
- Contrato vigente: `context/features/opportunity-catalog.md`, secção “Importação Excel/CSV de oportunidades privadas”.

### Critérios de entrada para planeamento

- O ficheiro original e os relatórios são documentos privados F11; acesso, download e retenção não contornam F5/F11.
- O upload nunca escolhe tenant, organização, actor, permissões, infraestrutura, estado de validação ou catálogos. A organização ativa, membership e actor vêm do contexto confiável F3/F4/F5.
- O processamento é assíncrono por F9, com identidade de ficheiro, job e linha, idempotência, retry/cancelamento controlados, reconciliação de commit incerto e relatório final.
- Cada linha aceite cria apenas oportunidade privada no tenant da organização ativa. Não cria nem altera catálogo central, outras organizações ou catálogos auxiliares.
- Duplicados exatos e candidatos incertos são separados; candidatos incertos exigem decisão humana e nunca são fundidos automaticamente.
- F7 crítico acompanha os efeitos na mesma transação; F10 permanece sanitizado e de baixa cardinalidade. Arquivo é lógico, sem DELETE ou hard delete.
- UI mínima: upload, seleção/mapeamento e preview, confirmação, progresso, cancelamento/retry autorizado, revisão de correspondências incertas e relatório descarregável/autorizado.

### Fora do âmbito

CSV ativo, execução sobre dados UBI reais, conectores externos, matching, candidaturas, inferência automática de correspondências, criação silenciosa de catálogos, tenant 013 e rollout produtivo.

### Decisões aprovadas para o primeiro MVP XLSX

1. Primeira fonte/formato: Portugal 2030 em `.xlsx`, uma folha escolhida explicitamente e aliases comprovados pelo parser piloto. CSV fica inativo.
2. Destino: contrato F12, criação privada em `DRAFT`; preview nunca cria. Campos obrigatórios ausentes rejeitam a linha e não existem defaults de moeda, estado funcional ou montante.
3. Duplicados: `EXACT` não cria; `POSSIBLE` aguarda revisão humana com MFA recente; `DISTINCT` pode criar. Catálogo desconhecido não cria seed/mapping.
4. Limites: 10 MiB, 5 000 linhas, preview das primeiras 200 linhas válidas e de todos os erros, um job ativo por organização.
5. F5: upload, preview, confirm, read, cancel, review e download-report; MFA recente em confirm/review, sem maker-checker nesta versão.
6. F7: upload, confirmação, cancelamento, revisão e conclusão/falha do job; outcomes por linha ficam no job, sem evento F7 por linha.
7. Original e relatório privados por F11, sem eliminação automática. Relatório UI e CSV UTF-8 com linha, estado, código, conflito e ID resultante.

### Implementação e evidência desta ação

- Migration tenant `015_f12_opportunity_xlsx_import`, posterior a `014`, com `013` ainda `RESERVED`: checksum up `58ecebd8c4dd726bd7f65d4ec16adebab44bc3a838ca8177ef486e983c7ba509`, down `a9ea1f4389eccbe76ed94a8fdd98e8bedd92596d78ff18b93dc86dedef008f6b` e fingerprint cumulativo `8c96af15c713ba36658d462e348ff3b69324042cd163bf426bb9b55353bec5ac`. `015` admite `CSV` apenas como classe documental F11 do relatório gerado; CSV continua inativo como fonte. Down recusa perda de dados; runtime não recebe `DELETE`/`TRUNCATE`.
- Parser Portugal 2030 exclusivamente `.xlsx`, folha explícita, 10 MiB/5 000 linhas, preview de 200 válidas e todos os erros, fórmulas nos campos mapeados recusadas. Aliases comprovados: `ID`; `Designação do Aviso`; `Programa`; `Objetivo Específico`; `Tipo Ent. Beneficiária`; `Data Início Prevista`; `Data Fim Prevista`. `Natureza Aviso`, `Fundo`, `Dotação Fundo`, `Quadrimestre`, `NUTS II` e `Modalidade Apresentação Candidatura` são ignorados de forma explícita; não há moeda/montante assumidos.
- F5: sete permissões distintas (`upload`, `preview`, `confirm`, `read`, `cancel`, `review`, `download_report`); `confirm` e `review` são sensíveis e exigem MFA recente, sem SoD/maker-checker. Bundles continuam vazios.
- F7: seis eventos de job, sem evento por linha. O upload, confirmação/outbox, cancelamento, revisão e fecho/falha usam idempotency keys; payloads não incluem nome/título/conteúdo/documento/PII. Outcomes por linha ficam no job.
- F9: envelope v2 fechado `opportunity.import.portugal2030`, payload apenas `{importId}`, lineage inicial e enqueue no outbox na transação de confirmação. Cada linha usa transação independente e request determinístico F12; `EXACT` não cria, `POSSIBLE` aguarda revisão e `DISTINCT` cria `DRAFT/PENDING_REVIEW`. O relatório CSV UTF-8 contém apenas `line,state,code,conflict,result`.
- HTTP/UI: rotas privadas `/api/imports` para upload, preview, confirmação, leitura/progresso, cancelamento, review e relatório; `/api/legacy/imports` fica explicitamente delimitado. Em runtime F12 não existe fallback para o controller legacy: sem composição explícita F4/F5/F7/F9/F11, a rota nova responde indisponível/falha startup quando selecionada. UI apresenta organização ativa e não decide por `ADMIN`/`PROFESSOR` no runtime F12.
- Evidência atual de integração: Testes focados F12 **27/27 PASS**, backend **713/713 PASS**, frontend **27/27 PASS** e build Vite **PASS** (aviso conhecido de chunk superior a 500 kB). Migration gate XLSX 015, gate funcional `F12_IMPORT_ENTRYPOINT_CENTRAL_AB`, gate cumulativo F12 e gate UBI completo/browser **PASS**. O primeiro clone executou esta matriz; o segundo repetiu focados, backend, build e gates funcional, cumulativo e UBI/browser sobre o mesmo patch, reproduzido byte-for-byte. PostgreSQL 17, Central e organizações A/B são fixtures sintéticas, sem dados UBI reais. `node --check` passou em 58 JavaScript e whitespace passou nos patches isolados. Os resíduos de whitespace F13 do worktree principal estão excluídos.
- Correções adicionais após os gates: o preflight reconhece deliberadamente as tabelas/RLS/grants não destrutivos de 015 sem relaxar 014; headers vazios não deslocam o mapping e headers duplicados falham fechado; replay de upload liberta a nova versão F11 não referenciada; `COMMIT_UNCERTAIN` é reconhecido pelo código público ou interno; a falha F11 ao regenerar o relatório após review marca `RECONCILIATION_REQUIRED` e o retry converge sem duplicar oportunidade, outcome ou F7. Scans no recorte da entrega encontraram apenas a password efémera construída pelo gate e o secret sintético explícito da fixture; zero PII detetada.
- Correção de segurança final: a role `c4g_import_worker_runtime` conserva somente `SELECT/INSERT` em `opportunity`, `revision`, `provenance` e `idempotency_record`; `SELECT/INSERT` e updates de estado fechados em `import_job`/`import_row_outcome`; `SELECT` e updates de relay em `outbox`; `SELECT/INSERT` e updates de processamento em `inbox`; `EXECUTE` nas duas funções F7; e `USAGE` nos três schemas correspondentes. Foram removidos `UPDATE` geral de `opportunity`, writes em `organization_opportunity`, `opportunity_document_binding` e `duplicate_candidate`, e `INSERT` em `outbox`. Não existem grants de sequência. O fingerprint inclui agora atributos e ACLs diretos desta role; o down revoga exatamente os grants da up.
- O binding worker valida recursivamente a cadeia completa `login -> c4g_tenant_worker_capabilities -> {c4g_import_worker_runtime,c4g_f4_metadata_executor}`, incluindo opções `SET/INHERIT/ADMIN`, atributos seguros de todos os nós e ausência de ACLs, ownership ou default ACL na agregadora. Qualquer aresta ou autoridade adicional direta ou transitiva falha fechado. O gate PostgreSQL provou configuração válida, role obrigatória ausente, role API direta e herdada, agregadora com `BYPASSRLS`, grant direto de coluna na agregadora, `SET ROLE` API recusado, ACLs negativas com `42501` e escrita cross-organization recusada por RLS. O hook de commit incerto limpa a mutação armada em `ROLLBACK`, preserva Promise e as assinaturas callback de `Pool.connect` e `client.query`, decora uma vez e injeta uma única falha apenas depois do `COMMIT` pretendido.

### Findings e estado para handoff

- `F12-IMPORT-R1-001` — **RESOLVED**: a raiz deixa de aceitar workflow/contexto já montados; constrói repository F12, F7, outbox F9 e registry executável a partir das fronteiras produtivas F4/F5/F11. O worker aceita o registry e runner explícitos, e ausência de infraestrutura falha no arranque sem legacy/fallback. O gate atravessou composição, outbox, relay, inbox e worker. Layer C/provider externo continua não validado e bloqueia rollout, não o fecho humano restrito local.
- `F12-IMPORT-R1-002` — **RESOLVED**: criado e aprovado `test/integration/f12-import/functional-gate.ps1`, com Central e duas organizações PostgreSQL 17, isolamento A/B, MFA/revogação, preview sem criação, processamento e relatório. A matriz executada está registada acima; cenários externos de provider, staging e rollout não foram promovidos.
- `F12-IMPORT-R1-003` — **RESOLVED**: falha F11 depois da decisão `POSSIBLE` marca agora `RECONCILIATION_REQUIRED`; retry idempotente regenera/liga o relatório e regressa a `COMPLETED_WITH_ISSUES` sem nova oportunidade, outcome ou F7. Prova focada PASS.
- `F12-IMPORT-R1-004` — **RESOLVED**: adapter F10 fechado para upload, preview, confirmação, leitura, cancelamento, review, relatório e processamento; dimensões limitadas a operação/resultClass, sem IDs, nomes, linhas ou conteúdo. Prova focada PASS e falhas de telemetry continuam não autoritativas.
- `F12-IMPORT-R2-001` — **RESOLVED**: o processo worker possui agora runtime produtivo explícito com registry, relay, inbox, processor, polling e shutdown; o modo XLSX selecionado sem esse runtime falha o arranque, em vez de terminar com sucesso sem consumir jobs. O contexto de execução é reconstruído no worker a partir da membership/authority Central e a causation usa UUIDv7 válido.
- `F12-IMPORT-R2-002` — **RESOLVED**: o gate deixou de instanciar diretamente a composição da importação. A prova começa nos entrypoints reais `server.start` e `worker.main`, usa HTTP real na API e mede as consultas à pool legacy, cujo resultado foi zero.
- `F12-IMPORT-R2-003` — **RESOLVED**: headers desconhecidos bloqueiam o preview com `IMPORT_HEADER_DECISION_REQUIRED` até existir decisão explícita `IGNORE` ou `REJECT`. `IGNORE` entra no mapping/digest persistido e é reproduzido pelo worker/review; `REJECT` recusa o ficheiro. UI e contrato HTTP recolhem as decisões sem criar mappings novos.
- `F12-IMPORT-R2-004` — **RESOLVED**: recusas funcionais F5, incluindo `PERMISSION_NOT_GRANTED`, são apresentadas como `403`; falhas técnicas como `POLICY_DATA_UNAVAILABLE`, `AUDIT_CRITICAL_UNAVAILABLE`, permission/policy desconhecida e restantes indisponibilidades continuam em `503`.
- `F12-IMPORT-R3-001` — **RESOLVED, superseded pela correção R4**: o gate deixou de importar `worker.main` ou de lhe injetar um runtime; lança um processo separado com `node src/worker.js` e usa pg-boss real entre processos. A seleção configurável da factory completa introduzida nessa correção foi removida por `F12-IMPORT-R4-001`.
- `F12-IMPORT-R4-001` — **RESOLVED**: o comando deixou de selecionar uma factory completa por configuração. A factory produtiva está entregue em `backend/src/config/opportunityImportWorkerFactory.js`, compõe o entrypoint, registry, polling e ownership do runtime; a configuração externa fica limitada ao provider das fronteiras de infraestrutura ainda dependentes de Layer C/ambiente. O gate fornece esse provider descartável, mas executa a factory e o runtime do backend.
- `F12-IMPORT-R4-002` — **RESOLVED**: timeout no shutdown do subprocesso força `SIGKILL` apenas para limpeza e faz o gate falhar; a falha também é propagada pelo bloco final. Teste automatizado prova `SIGTERM → timeout → SIGKILL → rejeição`, e o gate real terminou normalmente dentro do limite.
- `F12-IMPORT-R5-001` — **RESOLVED**: `backend/src/config/opportunityImportWorkerInfrastructure.js` entrega a composição interna de Central/F4/F5, diretório organizacional confirmado na Central, transações tenant, F12, pg-boss, outbox/inbox e relay. A única seleção modular externa é `OPPORTUNITY_IMPORT_F11_PROVIDER`, cujo contrato fechado admite apenas `documentPortFactory` e `close`; o provider do gate deixou de construir membership, autorização, tenant directory, queue, inbox, relay ou runtime.

### Decisões antes de autorizar uma amostra UBI real

1. Identificar a fonte/versão concreta do ficheiro, a folha e um exemplar previamente sanitizado, com autorização de tratamento; não reutilizar dados reais como fixture.
2. Aprovar os headers/aliases reais e decidir, coluna a coluna, o que é mapeado, preservado apenas como proveniência ou ignorado. O MVP atual só aceita os aliases Portugal 2030 listados acima.
3. Confirmar a política de `EXACT`, os critérios determinísticos de `POSSIBLE` e o tratamento dos conflitos com oportunidades já existentes; não existe merge ou update automático.
4. Aprovar os catálogos/mapeamentos permitidos e a resolução de valores desconhecidos. O comportamento atual é não criar seeds nem mappings.
5. Fechar limites operacionais ainda externos ao ficheiro: concorrência global do worker, tentativas/backoff, prazo de reconciliação, quotas e procedimento de cancelamento/falha parcial.
6. Definir retenção e acesso ao original, versões de relatório, outcomes e legal hold. Neste MVP não existe eliminação automática.
7. Disponibilizar e validar o Layer C F11 privado e o provider/scan externos no ambiente alvo; a composição local, F10 e o gate funcional Central+A/B estão concluídos, mas não constituem validação de staging/produção.

Estado final em 2026-10-14: **Complete — GO restrito**, por decisão humana. R2-003 e R2-004 permanecem resolvidos e protegidos por regressões. A fixture UBI cria idempotentemente `c4g_import_worker_runtime` com atributos mínimos canónicos e verifica-os antes da migration 015, sem acrescentar memberships. O gate UBI/browser passou após esta correção e nos dois clones. Contexto transacional, identidade própria do worker, cadeia transitiva fechada, redelivery idempotente e limpeza do hook por `ROLLBACK`, incluindo callbacks, permanecem cobertos.

Commits locais existentes: baseline `e5a22590a008d5e93a17b8a4c07eb1e7d887ddfb` e importação XLSX `6c0be3af7001f4f8b46aede5320d5daf8b8e4e8c`. O fecho documental restrito da importação XLSX F12 fica registado nesta secção. Nenhum push, PR ou deploy foi executado.

Este fecho não valida staging, produção, rollout, fornecedores externos, Layer C/F11 externo, IdP externo ou dados UBI reais. CSV como fonte e migração de dados reais ficam fora do âmbito; CSV é apenas relatório F11. F13 integral permanece `In Progress`.

## Etapa funcional 2 — criação e arquivo de oportunidades privadas F12 (2026-10-12)

**Complete — entrega F12 formalmente fechada em 2026-10-12 após revisão final read-only, sem findings bloqueadores.** Pré-requisito F4/tenant 014 concluído, incluindo F4-014-R1-001. Fluxo aprovado: organização ativa → criar → listar/filtrar → detalhe → editar com CAS → arquivar → confirmar ausência da vista ACTIVE e consulta histórica ARCHIVED autorizada. A aprovação é restrita às fixtures e à composição exercitada; não valida IdP externo, onboarding, provider/diretório externos, staging, produção, rollout ou SLO.

Contratos/aceitação entregues: POST /api/opportunities (requestId + fields funcionais fechados), POST /api/opportunities/:id/archive (requestId + expectedRowVersion); F5 próprios OPPORTUNITY_PRIVATE_CREATE/OPPORTUNITY_ARCHIVE, sem READ implícito. Identidade/organização/provenance server-side, F4 client físico limitado, guard de autoridade existente, F7 transacional, F10 cardinalidade baixa. Receipts UUID/revision/CAS sem snapshot; GET exige READ e permite histórico arquivado, sem edição/arquivo repetido por nova intenção. Vista inicial ACTIVE; ARCHIVED disponível por filtro explícito. Idempotência por organização/operação/key/digest completo, replay reautorizado, CAS, rollback F7 e recovery de COMMIT incerto. As provas A/B, grants assimétricos, membership/organização inválidos, inputs de autoridade rejeitados e ausência de hard delete passaram em PostgreSQL/HTTP/frontend/Chrome. Nenhum AC F13 foi promovido; F13 permanece In Progress e os seus estados foram preservados.

Preparação do piloto permanece limitada a checklist: issuer/client/redirect OIDC, origens HTTPS/cookies/CSRF, MFA e policy; identidades/stable subjects, organizações elegíveis e memberships atuais; tenant directory/generation/binding/schema 014 e credenciais API NOINHERIT; pool dedicada do authority coordinator; grants READ/CREATE/UPDATE/ARCHIVE e SoD/MFA de arquivo; backup/restore e ambiente de demonstração. Valores externos/provider e dados de onboarding permanecem pendentes; não inserir segredos na documentação nem declarar IdP/onboarding reais comprovados. Rotas, corte, provas finais e limites locais estão registados abaixo; esta checklist externa continua por validar.

### Resultados da entrega funcional 2 (2026-10-12)

- Percurso HTTP e Chrome PASS: dois utilizadores/tenants, criação pela UI → lista → detalhe → edição/CAS → confirmação de arquivo → ausência em ACTIVE → histórico ARCHIVED por GET autorizado; B não descobre nem acede ao registo A. Sessões sintéticas persistidas na Central real, não login em IdP externo.
- Rotas F12: GET/POST /api/opportunities, GET/PUT /api/opportunities/:id, POST /api/opportunities/:id/archive; receipts sem conteúdo em todas as mutações. DELETE/subrotas fora da entrega: 405, sem fallback. /api/legacy/opportunities conserva controllers/rotas piloto (incluindo DELETE legacy e áreas/sugestões); outros módulos legacy inalterados. Descoberta pública GET / distingue catálogo F12 de legacy, testada por HTTP real sem base.
- Gate `powershell -NoProfile -File test/integration/ubi/private-opportunity-gate.ps1`: PASS final, F4 API NOINHERIT sem preparação administrativa, 29 drifts, quatro adulterações, runner 012→014→012→014 e rollback up/down. HTTP: criação concorrente/replay único, conflito de intenção em summary, CREATE/ARCHIVE sem READ, replay recusado após revogação do grant, CAS/estado inválido no arquivo, zero hard delete, F7 criado/arquivado persistidos uma vez; rollback quando falha especificamente o evento funcional após a mutação; COMMIT incerto reconciliado para CREATE/ARCHIVE. Membership REMOVED recusada; organização SUSPENDED não permite emitir contexto nem seleção; inputs de autoridade rejeitados. Zero queries legacy nos fluxos demonstrados.
- Backend `npm test`: **685/685 PASS**; focados F12/F4/runner/matriz/composição: **75/75 PASS**. Frontend `npm test`: **27/27 PASS**, incluindo StrictMode, CAS, validação/recusa/sessão, retry de intenção incerta sem nova key e sem novo POST quando receipt confirmado mas READ recusado. `npm run build`: PASS, 2053 módulos; aviso bundle >500 kB permanece, sem redesenho/otimização nesta entrega. Gate F12 PostgreSQL PASS, incluindo F9 **3/3 PASS**. Falhas intermédias eram do harness (injeção atingia F5 em vez do evento funcional; tentativa de construir contexto ineligível e espera por título B já alterado), corrigidas sem relaxar autorização, isolamento ou assertions de dados.
- Migrations/pins anteriores e especificação F13 preservados por hashes do snapshot inicial; nenhum SQL 013, importação real, mudança de dados legacy, matching/candidaturas ou nova abstração de segurança. Critérios E2 restritos documentados em context/features/f12-private-opportunity-authoring.md; nenhum AC integral F13 promovido. A revisão read-only posterior autorizou o fecho formal registado abaixo; sem commit/stage.
- Verificações finais: node --check **12 JS PASS**, git diff --check PASS, scans por padrões de private keys/credenciais/URLs PostgreSQL com password/JWT/emails com zero hits nos 16 ficheiros desta entrega (não é auditoria exaustiva de PII). Índice vazio; gates removeram somente os seus recursos descartáveis pelo finally; nenhum container dos gates restante, recursos preexistentes preservados. A única mudança após o gate E2E final foi a descrição pública de rotas no GET /, comprovada por HTTP no teste backend, sem alteração ao fluxo CRUD.
- Pendentes do piloto: valores/validação externa da checklist acima (IdP, URLs/claims/MFA, organizações/subjects/memberships/grants reais, directory/credenciais/pools aprovados, operação/backup/restore). UI conserva a key/intenção na instância do formulário; recuperação após encerramento do browser exige confirmação pelo estado persistido/procedimento operacional, não presumir rollback ou criar outro registo às cegas. Não declara rollout, IdP, onboarding ou SLO reais PASS.
- Importação: contrato promovido e implementação local iniciada no início deste documento; continua sem autorização para dados UBI reais ou rollout. Candidaturas continuam a exigir contrato separado.

### Fecho formal F12 — revisão final read-only (2026-10-12)

- Composição aprovada no fluxo migrado: F3/F4/F5/F7/F10/F12. A organização, actor, membership e tenant são derivados do contexto confiável; a identidade API F4 é `NOINHERIT`, com roles, ACLs e metadata fail-closed. Não existe pool/controller legacy, fallback silencioso ou decisão baseada apenas em `ADMIN`/`PROFESSOR` no percurso F12.
- Persistência: criação idempotente por digest da intenção; update e arquivo com `expectedRowVersion`/CAS; replay reautorizado e sem duplicação F7; commit incerto reconciliado; falhas F5/F7 fazem rollback integral. Mutations devolvem receipt sem conteúdo e não contornam READ. Arquivo é lógico; não existe `DELETE` ou hard delete no namespace F12.
- Rotas F12: `GET/POST /api/opportunities`, `GET/PUT /api/opportunities/:id`, `POST /api/opportunities/:id/archive`; contexto organizacional por `GET /api/auth/session`, `GET /api/auth/organizations` e `POST /api/auth/organization`. UI: `/oportunidades` e `/oportunidades/:id`.
- Legacy delimitado: `/api/legacy/opportunities`, `/api/legacy/opportunities/:id`, research areas/suggestions/auto-research-areas e UI `/legacy/oportunidades/:id`; dashboard, estrutura UBI, utilizadores, professores, áreas, candidaturas, parceiros, imports, integrações, matching e notificações permanecem legacy. Isto é compatibilidade explícita, não fallback.
- Revisão executada: backend focado **74/74 PASS** e suite completa **685/685 PASS**; frontend **27/27 PASS**; build Vite PASS, 2053 módulos; `node --check` **141/141 PASS**; `git diff --check` PASS; scans de credenciais e PII sem ocorrência no recorte F12.
- Gates: F12 PASS na repetição integral, F9 PostgreSQL **3/3 PASS**, F13-P1 PASS, F13 principal/007 PASS, 008–011 PASS; HTTP/Chrome F12 com Central e dois tenants sintéticos PASS, incluindo isolamento A/B, grants assimétricos, revogação, CAS, replay, rollback F7, commit incerto, zero queries legacy e zero hard deletes. Runner canónico **012→014→012→014 PASS**.
- O gate isolado 012 está vermelho apenas pela expectativa desatualizada registada como `F13-GATE-012-001`: esperava aplicar só 012, mas o manifest canónico aplica 012 e 014, mantendo 013 reservado. Não foi observada falha de isolamento ou integridade produtiva.
- Nenhum dado UBI real foi migrado. Sessões, organizações, tenants, oportunidades e documentos usados nas provas foram sintéticos. Tenant 013 permanece `RESERVED`, adiado, sem SQL ou ledger materializado.

### Backlog resultante da revisão F12

- `F12-UI-001` — MEDIUM: tornar a lista responsiva e acessível em viewports móveis; corrigir antes do rollout produtivo.
- `F12-UI-002` — MEDIUM: acrescentar semântica modal, foco inicial/trap, Escape e reposição de foco ao diálogo de arquivo; corrigir antes do rollout produtivo.
- `F13-GATE-012-001` — RESOLVED em 2026-10-12: o gate isolado usa deliberadamente o prefixo canónico `000–012`; a prova integral continua a validar `012 → RESERVED 013 → 014`. Gate isolado repetido com PASS, sem alteração ao runner produtivo.
- `F12-SEC-R1-001` — LOW: corrigir a classificação F10 de `OPPORTUNITY_NOT_FOUND`/indisponibilidade; melhoria não bloqueadora.
- `F12-UI-003` — LOW: traduzir os estados internos visíveis para português; melhoria não bloqueadora.
- `POOL_CLEANUP_TIMEOUT` — observação: ocorreu uma vez na primeira execução do gate F12, o cleanup concluiu e a repetição integral passou. Investigar apenas se voltar a ocorrer; não é finding funcional neste fecho.

## Tenant 014 — F4 runtime metadata access (2026-10-11)

O fecho F4 abaixo permanece válido; esta entrega não altera o respetivo código, migrations, pins ou limites.

### Fecho formal restrito (2026-10-12)

**Complete — tenant 014 e admissão produtiva do fluxo vertical F12 formalmente fechadas no âmbito restrito, por decisão humana explícita.** F4-014-R1-001 corrigido e revalidado; revisão formal read-only repetida sem findings bloqueadores e sem alterações aos cinco ficheiros congelados. UBI-V1-R1-001 (admissão limitada), R1-002 e R1-003 corrigidos e revalidados. A revisão final executou novamente o gate PostgreSQL/HTTP/Chrome com 29 drifts, incluindo alteração explícita do fingerprint nos quinze casos de ACL de base, HTTP 503 e zero mutação/novo F7/idempotência. Fluxo positivo limitado A/B, CAS/replay/COMMIT incerto e runner 012→014→012→014 PASS. Backend 682/682, focados 72/72, gate F12 e F9 PostgreSQL 3/3 PASS; node --check, git diff --check e scans PASS. Pins tenant 014 abaixo inalterados; 013 RESERVED, sem SQL ou linha fictícia de ledger.

O fecho comprova o runtime API NOINHERIT com metadata F4 mínima e o fluxo F12 sobre fixtures sintéticas; não aprova deploy/rollout, IdP externo, provider/diretório externos, SLO ou migração de dados UBI reais. Não autoriza nova fatia, tenant 013, lifecycle, activation, matching ou candidaturas. F13 continua **In Progress**; AC-13/AC-15 **PARTIAL**; AC-14/AC-16/AC-17 **PENDING**; restantes critérios inalterados, nenhum promovido. Este registo prevalece sobre os estados Review/Draft/impedimentos históricos abaixo. Não arquivar/resetar a feature F13 integral.

Esta ação de fecho modifica somente current-work.md e a especificação F4 metadata; não altera código, migrations, manifest, pins, critérios ou dados. Sem commit/stage; não repete testes funcionais, apenas git diff --check após o registo.

### Histórico pré-fecho da tenant 014

**Review — implementação e provas concluídas em 2026-10-12; sem fecho formal.** Contrato explicitamente aprovado. Reparo da admissão F4 para o fluxo vertical F12. 013 permanece RESERVED para F13/fatia 9 adiada, sem ficheiro SQL, checksum, aplicação ou linha de ledger. Única lacuna admitida: 012→014, por reserva explícita no manifest; down 014→012 restaura o ledger/schema efetivo, sem materializar 013. Nenhuma outra lacuna é implicitamente permitida.

Contrato: owner/executor dedicados NOLOGIN, executor e API NOINHERIT; função fechada para marcador, geração, ledger/checksums e flags de integridade F9, sem SQL caller ou projeção funcional. Executor/API sem SELECT/DML direto. EXECUTE exclusivamente ao executor via aggregator API com SET TRUE/INHERIT FALSE/ADMIN FALSE. Sem owner/migrator/role geral como autoridade runtime. SECURITY DEFINER com search_path fixo, owner de privilégios mínimos; fingerprint/ACLs validados antes do uso na mesma transação/client físico e antes de commit. Role/contexto restaurados ou conexão rollback/discarded, nunca reutilizada com estado residual.

Critérios desta entrega: login API real limitado no HTTP F12 e A/B; nenhum caminho de preparação administrativa no runtime; drift ACL/owner/função/membership/metadata recusado; rollback/restauração; percurso canónico 012→014→012→014 e falha parcial atómica; pins coerentes; R1-002/R1-003 revalidados. Resultados e pins só após provas reais. Setup/migrations/fixtures sintéticas podem usar o runner migrador; não são a identidade da preparação/operação runtime.

Limites: não alterar migrations anteriores/Central 009, não criar SQL/ledger fictício 013, não migrar dados reais UBI, não implementar matching/F13 lifecycle ou APIs administrativas; sem commit/stage; F13/ACs preservados. O histórico abaixo permanece como evidência anterior, não como estado final desta ação.

### Evidência final tenant 014 (2026-10-12)

Correção F4-014-R1-001 implementada e provada (2026-10-12): a revisão independente encontrou CREATE ON DATABASE concedido ao executor sem recusa da admissão. Acrescentada observação das ACLs da base atual (owner/executor/PUBLIC, incluindo grant option) ao fingerprint e recusa explícita dos privilégios efetivos CREATE/TEMP/CONNECT do owner/executor. Nenhum grant novo; nenhum SQL/pin de migration alterado. Estado: Review, sem fecho automático. Gate HTTP/Chrome PASS com **29 drifts**, incluindo quinze casos adicionais de base (CREATE/TEMP/CONNECT para owner/executor, com/sem grant option, e PUBLIC): HTTP 503, sem alteração funcional, novo F7 ou resultado idempotente. Suite backend **682/682**, focados **72/72**, gate F12 e F9 PostgreSQL **3/3 PASS**; node --check nos três JS alterados, git diff --check e scans por padrões nos cinco ficheiros da correção PASS. Fingerprint canónico e runner 012→014→012→014 permanecem iguais. Após este registo, congelar código/documentação para a repetição read-only, incluindo nova asserção explícita de alteração do fingerprint perante cada drift de base. A evidência histórica abaixo não cobria este finding.

- Pins: Up `5051cc10b19d034d30969ab63f1aa9275716b4e51da3eb866b6e7fd09d8ee7d1`; Down `6e91968cc279cfa787344285d3d9ad1191fba3690d23062bbad9644868a76937`; fingerprint `039997acfeb75dd7540ebaad805ed9a18aec4cdc3418bf155c205c1cad87b1b3`. Contrato e matriz de privilégios em `context/features/f4-runtime-metadata-access.md`.
- `powershell -NoProfile -File test/integration/ubi/private-opportunity-gate.ps1`: PASS, PostgreSQL 17/Central real/dois tenants; session_user API NOINHERIT e provider/verifier produtivos, **administrativePreparationFixture=false**. HTTP e Chrome: seleção A/B, lista/cursor/detalhe/edição/CAS/releitura persistida, grants assimétricos, replay, rollback F7, revogação e reconciliação de COMMIT incerto. Zero queries legacy. Directory/residency e sessão Central são fixtures sintéticas; IdP externo não exercitado.
- Recusas reais: SELECT/DML direto API/executor, runtime geral/PUBLIC, 14 casos de drift ACL/owner/membership/função/atributos, grants diretos API, ADMIN OPTION, geração stale, destino B com binding A e quatro adulterações do resultado metadata (marker, ledger, flag false e tipo de flag). Recusas de mutação verificam ausência de alteração funcional, novo F7 e resultado idempotente; admissão recupera após remoção autorizada do drift.
- Runner canónico **012→014→012→014 PASS**, sem linha 013; fingerprint/ledger/roles recuperados. Falhas injetadas entre SQL e ledger em up e down fazem rollback integral. Down recusa roles compartilhadas com outra base. Metadata preliminar usa READ ONLY no mesmo client limitado, sem capability funcional; a transação funcional repete a observação e revalida antes do commit. Role/contexto restaurados em sucesso/rollback; erro não permite reutilização contaminada.
- Backend `npm test`: **682/682 PASS**. Focados F4/manifest/runner/lease/F12 HTTP/matriz/composição: **72/72 PASS**. Gates `test/integration/f12/migration-gate.ps1`, `test/integration/f13p1/migration-gate.ps1` e `test/integration/f13/migration-gate.ps1`: PASS; F9 PostgreSQL no gate F12 **3/3 PASS**. Frontend `npm test`: **15/15 PASS**; `npm run build`: PASS, aviso preexistente de chunk >500 kB.
- `node --check`: **23 ficheiros PASS**; `git diff --check`: PASS. Scans por padrões de private keys, credenciais, URLs PostgreSQL com password, JWT e emails: zero hits nos ficheiros desta entrega; não equivalem a uma auditoria exaustiva de PII. Gates removeram apenas os seus containers/volumes pelo finally; nenhum container de gate restante, recursos preexistentes preservados. Índice vazio, sem commit/stage.
- **UBI-V1-R1-001: reparo implementado e admissão limitada revalidada, pendente de revisão formal. R1-002/R1-003: corrigidos e revalidados** (receipt sem conteúdo/replay sem READ implícito; recusa uniforme antes de erro dependente do estado). Não reabrir sem evidência concreta. Migrations anteriores e documentação F13 preservadas por comparação com snapshot inicial. F13 continua In Progress; AC-13/AC-15 PARTIAL, AC-14/AC-16/AC-17 PENDING. Nenhum AC promovido.
- Pronto para revisão formal read-only de tenant 014 e fluxo vertical. Rollout, IdP externo, dados UBI reais, SLO e outros perfis de runtime permanecem fora da prova; não declarar deploy/fecho produtivo.

## Fluxo vertical UBI → oportunidades privadas multi-instituição (2026-10-11)

### Correções UBI-V1-R1 e decisão de metadata F4 (2026-10-11)

**In Progress; sem fecho autorizado.** Este registo prevalece sobre a evidência histórica abaixo. R1-001 tem a inspeção SQL corrigida, mas a admissão produtiva continua bloqueada pelo contrato de identidade/metadata. R1-002/R1-003 corrigidos e provados em PostgreSQL/HTTP; revisão read-only final não autoriza o fecho enquanto R1-001 permanecer aberto. Nenhuma migration, manifest, checksum, fingerprint pin ou grant produtivo foi alterado.

- **R1-001 — inspeção:** preflight/fingerprint resolvem tabelas/função por OID no pg_catalog e ACLs por aclexplode/acldefault, em vez de resolução nominal dependente de USAGE e de information_schema filtrado pelo caller. Preservam a mesma projeção/fingerprint canónico, sem acrescentar permissões. Prova PostgreSQL compara administrador e login limitado; grant SELECT a PUBLIC é detetado, e a remoção do drift recupera o fingerprint. Isso não aprova o uso da role geral no runtime funcional.
- **R1-001 — impedimento residual:** o login de inspeção que herda c4g_tenant_runtime não pode assumir a role funcional F12. A identidade API aprovada pelo provisioner F4 é NOINHERIT, com aggregator fechado/SET TRUE/INHERIT FALSE/ADMIN FALSE; não pode usar c4g_tenant_runtime (C4G_TENANT_RUNTIME_ALLOWLIST_UNPROVEN) e não dispõe de acesso a c4g_system.tenant_identity/schema_migration. Não conceder a role geral nem privilégios administrativos para mascarar o impedimento. Configured runtime recusa também INHERIT e membership geral. A prova positiva continua explicitamente com preparação administrativa; não declarar admissão produtiva PASS.
- **R1-002:** receipt HTTP fechado (`opportunityId`, `revisionId`, `revisionNumber`, `rowVersion`), sem snapshot/título/summary/montantes ou outros campos funcionais. Mesma projeção no replay, inclusive após perda de READ; GET continua a exigir READ próprio. UI já relê a revisão pelo GET autorizado.
- **R1-003:** erro de materialização dependente do estado é retido internamente e só devolvido após o guard/F5 real. Recusa F5 é 404 uniforme, tanto para alvo existente como inexistente; input inválido autorizado conserva 400, com rollback integral. Não acrescentar uma segunda autorização/auditoria para esta validação.

Decisão humana nesta ação: **definir e aprovar primeiro o contrato mínimo de metadata F4**. Não implementar novas roles/ACLs/migration deste contrato até aprovação final. Não reutilizar tenant 013, não modificar migrations publicadas e não avançar F13, matching ou candidaturas.

#### Contrato mínimo proposto — Draft, pendente de aprovação final

1. Ownership F4/security; OrganizationalProfile e F12 apenas consomem observação confiável. Sem HTTP/admin API de metadata, nova fundação genérica ou pool funcional privilegiada.
2. Owner dedicado NOLOGIN/NOINHERIT, sem superuser/BYPASSRLS/administração de roles; executor metadata NOLOGIN/NOINHERIT. A identidade API existente mantém NOINHERIT e apenas membership SET TRUE/INHERIT FALSE/ADMIN FALSE via aggregator API aprovado. Nunca membership em owner/migrator/c4g_tenant_runtime.
3. Superfície PostgreSQL fechada para observar somente marcador físico, geração/revisão, ledger/checksums e os flags fixos de integridade F9 atualmente verificados pelo preflight. Sem linhas de outbox, payloads, dados funcionais, PII, credenciais ou SQL arbitrário. Executor não recebe SELECT/DML direto em tabelas de controlo ou funcionais; recebe apenas USAGE indispensável e EXECUTE das funções aprovadas. Owner recebe apenas leituras indispensáveis à função. SECURITY DEFINER só para essas leituras, search_path fixo, parâmetros tipados/validados, EXECUTE PUBLIC revogado.
4. Observação na mesma conexão física e transação F4, com tenant/generation esperados revalidados, role metadata transaction-local/restaurada e contexto limpo em sucesso/erro/rollback; não fabricar capability pública. Catálogos de schema/ACL e fingerprint continuam caller-independent. Executor não altera configuração, fence, ledger ou estado funcional. Drift, mismatch ou falha de leitura fecham acesso antes da função F12.
5. Migration **tenant de reparo F4 separada**, com número/nome a decidir explicitamente antes de implementar, sem ocupar/reutilizar tenant 013 reservado nem alterar Central 009 ou migrations publicadas. Up/down, ACLs/roles/memberships, ledger, preflight, checksum/fingerprint e gates devem evoluir conjuntamente; nenhum pin ou PASS nesta proposta.
6. Provas exigidas: session_user API real NOINHERIT em A/B; sem DML/CREATE/ALTER/roles administrativas; geral/worker/PUBLIC recusados; metadata não permite ler dados funcionais; client/destino/generation drift e grants excessivos recusados; role/context restaurados; igualdade de fingerprint e upgrade/downgrade seguro; HTTP e E2E completos sem preparação administrativa. Pronto apenas após estas provas e revisão read-only.

Resultados desta correção: backend **680/680 PASS**, focados **62/62 PASS**, frontend **15/15 PASS**, build PASS (aviso chunk >500 kB inalterado), gates F12/F13-P1/F13 PASS, incluindo F9 PostgreSQL **3/3 PASS**; node --check **7 ficheiros PASS**, git diff --check PASS, scan por padrões credenciais/PII nos 7 ficheiros JS de correção com zero hits. Gate HTTP/Chrome A/B **PASS**, exit 0: receipt sem conteúdo com UPDATE-only, replay após remoção de READ, erros 404/404 para ator sem grants e 400 com rollback/idempotência ausente para ator autorizado, isolamento/CAS/F7/COMMIT incerto e cursor. Inspeção limitada/fingerprint e drift PUBLIC provados; identidade API NOINHERIT oficial recusa SELECT no marcador mesmo após SET ROLE funcional, pelo que **admissão produtiva NÃO PASS**. Containers/volumes dos gates removidos pelo próprio finally; recursos preexistentes preservados. F13/ACs e fechos restritos anteriores inalterados. Estado final: R1-002/R1-003 revalidados; R1-001 PARTIAL/aberto; contrato metadata Draft pendente de aprovação, sem nova migration.

### Evidência histórica da implementação inicial (não constitui fecho produtivo)

**In Progress — implementação explicitamente aprovada.** Login OIDC → seleção de organização → lista com cursor → detalhe → edição com expectedRowVersion/CAS → releitura da revisão F12. Corte explícito nas rotas GET /api/opportunities, GET /api/opportunities/:id e PUT /api/opportunities/:id; modo F12 fail-closed, sem pool/controller legacy ou autoridade de tenant/organização fornecida pelo cliente. Restantes operações legacy preservadas sem misturar IDs dos dois modelos.

Critérios desta entrega: contexto server-side F3, execução física preparada F4, recursos/grants F5, F7 transacional e idempotência F12, F10 de baixa cardinalidade; isolamento A/B, revogação/organização inválida, grants assimétricos, CAS controlado, rollback e releitura. Frontend reutiliza layout/componentes e integra organização ativa, DTOs UUID/cursor/revision, loading/vazio/recusa/conflito/sessão expirada e moeda do registo. Evidência e limites de admissão produtiva abaixo; não declarar a entrega produtiva concluída a partir das fixtures.

### Implementação e corte explícito

- `OPPORTUNITIES_RUNTIME=f12` exige `AUTH_MODE=oidc`; valor desconhecido ou configuração incompleta impede a composição. Default explícito compatível `legacy`; não existe retry/fallback de UUID F12 para controllers/pool legacy.
- Rotas F12: `GET /api/opportunities` (cursor, pageSize, filtros F12), `GET /api/opportunities/:id` (snapshot/revision/rowVersion/permissions server-side) e `PUT /api/opportunities/:id` (`requestId`, `expectedRowVersion`, `changes` fechados). UUID obrigatório; input adicional de actor, membership, organization, tenant, correlation, assurance ou resource recusado. Conflito CAS/intenção devolve 409; inacessível 404 uniforme; sessão inválida 401; indisponibilidade/coordenação de autoridade 503. Nenhum stack/SQL é devolvido.
- Seleção utiliza as rotas F3 existentes `GET /api/auth/organizations`, `POST /api/auth/organization` e `GET /api/auth/session`; organizationId do POST é apenas candidato a seleção revalidada, nunca autoridade funcional. Frontend relê a sessão após rotação e descarta imediatamente o contexto/resultados antigos.
- Composição privada usa session authority opaca, membership/grants Central coordenados, policy engine F5 real, recursos carregados server-side, runtime/lease F4 e **a mesma conexão preparada** para loaders, F5/F7, CAS, idempotência e commit guard. Repository não dispõe de caminho standalone utilizável nesta composição. COMMIT incerto consulta o registo tenant via recovery existente e reautoriza F3/F5 antes de devolver replay.
- Digest UPDATE inclui alvo, expected revision, snapshot completo e provenance funcional; exclui apenas timestamp/identidade de registo gerados. Replay precede emissão do evento crítico e não duplica `OPPORTUNITY_REVISION_CREATED`. Registos idempotentes de um contrato/digest anterior não são traduzidos silenciosamente.
- Pool tenant configurada separada da legacy através de configuração server-side `OPPORTUNITY_API_CREDENTIALS_JSON` e `OPPORTUNITY_ALLOWED_RESIDENCY_JSON`; não registar os seus valores. Reutiliza provider, pool manager, directory, binding verifier e preflight F4. Login administrativo/BYPASSRLS recusado; pool criada pelo root encerrada no shutdown. Não provisiona nem popula dados produtivos.
- Compatibilidade intencional em `/api/legacy/opportunities` e `/legacy/oportunidades/:id` para os consumidores legacy restantes; não é fallback. Dashboard/Matching/Notifications só ajustam links legacy, sem alterar lógica funcional. Candidaturas, importações, jobs e restantes controllers preservados.
- Frontend: AuthContext, OrganizationSelector/Header, wrappers OpportunitiesList/OpportunityDetail e PrivateOpportunities; layout, EmptyStatePanel, ToastProvider reutilizados. UUID/cursor/CAS; edição disponibilizada apenas pela decisão F5 do servidor, não por ADMIN/PROFESSOR; montantes textuais exatos com moeda declarada, sem EUR fixo. Conflito bloqueia guardar até releitura; retry da mesma intenção mantém a key; consulta 503 exige repetição explícita. A lista de organizações não é relida em paralelo a cada seleção; seleção/uso continuam revalidados no servidor.

### Evidência executada (2026-10-11)

- `npm test` em backend: **678/678 PASS**; inclui F3/OIDC/F4/F5/F7/F10/F12 e contratos fechados HTTP adicionados. Testes PostgreSQL que exigem env disposable não são inferidos a partir desta contagem.
- Focados: `node --test backend/test/f12PrivateOpportunityHttp.test.js backend/test/f12OpportunityDomain.test.js backend/test/f12ServiceAuthorization.test.js backend/test/f12TenantOperationMatrix.test.js backend/test/productionCompositionParity.test.js backend/test/security/f3MembershipContext.test.js`: **60/60 PASS**.
- `npm test` em frontend: **15/15 PASS**, incluindo seleção/releitura da sessão, descarte de respostas antigas A/B, loading/vazio/cursor/filtros, UUID, CAS/releitura, recusa, 401/403/404/503, repetição explícita e retenção da idempotency key. Harness isolado: `npm install --prefix test-harness` antes dos testes; aplicação mantém o toolchain Vite existente.
- `npm run build` em frontend: **PASS**, 2053 módulos; aviso de chunk principal >500 kB permanece, não é evidência de performance/SLO.
- `powershell -NoProfile -File test/integration/ubi/private-opportunity-gate.ps1`: **PASS** com Central real, duas bases PostgreSQL 17, sessão persistida/CSRF/membership/grants reais, Express composto, SQL funcional sob `c4g_opportunity_tenant_runtime`. Lista/detalhe/edição/releitura, cursor ligado a filtros, A/B, grants read/update assimétricos, inputs de autoridade recusados, replay/conflito, concorrência entre duas sessões (200/409), revogação, rollback F7 sem idempotência persistida e COMMIT-ack perdido reconciliado. **Zero queries legacy**. Injeções de falha são explícitas nas fronteiras de append/ack, não substituem PostgreSQL/autorizações por doubles.
- Mesmo gate: **E2E headless Chrome PASS**, usando Vite/frontend real e cookie de sessão **sintético persistido no Central**, seleção A → lista → detalhe → edição → releitura da revisão 4 → seleção B sem oportunidade de A. Browser, servidor e bases pertencem à fixture. **Não executou login contra IdP externo**; o login/callback usa a integração OIDC existente, coberta pela suite mas sem prova operacional externa nesta ação.
- Gates `test/integration/f12/migration-gate.ps1`, `test/integration/f13p1/migration-gate.ps1` e `test/integration/f13/migration-gate.ps1`: **PASS**. F12 inclui manifest/runner Central e tenant cumulativo até 012, fencing/workload/rotação, F7 source-local e F9 PostgreSQL **3/3 PASS**; F13 inclui coordinator dedicado, 47 drifts ACL, authority races/recovery, F5/F7 reais e locks DAG. A primeira tentativa F12 perdeu conexão durante arranque; repetição completa passou, sem alteração ao gate para mascarar o erro.
- Nenhuma migration, manifest, checksum, fingerprint ou pin foi alterado nesta entrega. Mudanças anteriores do worktree preservadas; nenhuma migração real UBI ou alteração de dados legacy executada.
- `node --check`: **18 ficheiros JS PASS**; JSX validado pelos testes/build. `git diff --check`: **PASS** (avisos de conversão LF/CRLF existentes, sem erro de whitespace). Scan por padrões de chaves privadas/tokens/PII nos **33 ficheiros de âmbito**: zero ocorrências; não é certificação absoluta de ausência de segredos. Passwords/URLs de fixtures são geradas apenas em memória, sem serem registadas nos resultados.
- Repetição final do gate HTTP/browser: **PASS**, exit 0, incluindo sessão global sem organização ativa recusada (409). Cleanup `finally` confirmado: sem containers/volumes dos gates desta ação; recursos Docker preexistentes preservados. Comparação SHA-256 dos 147 paths anteriormente dirty preserva todos exceto os cinco paths sobrepostos intencionalmente nesta entrega (resourceAuthorization, productionComposition, tenantAuthorityRecovery, tenantLeaseExecutor e current-work). Index continua vazio; sem commit/stage.

### Bloqueador produtivo comprovado e limites de revisão

**A entrega permanece In Progress.** O probe com `session_user` tenant limitado, sem superuser/BYPASSRLS, é recusado pelo preflight completo existente com PostgreSQL **42501** na inspeção F13-P1 (`tenantMigrationPreflight.js`, resolução nominal de `organizational_scope.scope`/`idempotency_record`). O login F12 não tem USAGE nesse schema. A inspeção de ACLs por `information_schema.table_privileges` no preflight/fingerprint também depende da visibilidade do caller e precisa de validação no reparo. Não foi concedido acesso extra nem alterado preflight/migration para contornar esta fronteira.

As provas positivas usam o padrão de fixture F13 de **preparação administrativa** com SET LOCAL ROLE limitado para todo o SQL funcional. Provam o fluxo sintético/composição e as transações, **não a admissão produtiva limitada**. A configuração produtiva recusa logins administrativos e permanece fail-closed. É necessário um reparo limitado e aprovado desta inspeção F4, com prova física de login limitado e sem ampliar autoridade, antes de considerar rollout ou amostra UBI real.

Foi observada recusa `AUTHORITY_WRITE_PENDING`/`AUTHORITY_STALE` com requests concorrentes da mesma sessão durante touches coordenados. HTTP trata estes casos como 503, sem logout/retry cego ou bypass; UI oferece repetição explícita. A composição mantém todos os fences; não se declara garantia de disponibilidade para paralelismo irrestrito da mesma sessão. Nenhuma nova fundação de autoridade foi implementada.

Revisão read-only do código e da evidência sintética é possível; **fecho produtivo não está pronto**. Para uma amostra real ainda faltam resolver a admissão limitada F4, prova IdP/configuração/directory/pools reais e decisão explícita sobre mapeamento, proveniência, moeda, grants e validação dos dados UBI — sem copiar dados ou inventar equivalências. Dependências frontend existentes mantêm 13 advisories npm (0 critical; harness novo 0), a tratar antes de rollout sem upgrade silencioso do toolchain nesta ação. F13 continua In Progress; AC-13/15 PARTIAL e AC-14/16/17 PENDING; nenhum AC promovido.

Limites: sem migração de dados UBI reais, alterações a dados legacy, correspondências silenciosas, novas fundações/migrations, candidaturas ou matching. F13 e critérios conservam os estados atuais; fatia 9 permanece Draft — Deferred pending UBI migration evidence; tenant 013 não autorizada. Sem commit/stage.

## Fatia 9 — Draft — Deferred pending UBI migration evidence (2026-10-11)

**Estado atual: Draft — Deferred pending UBI migration evidence.** Decisão humana explícita suspende a preparação de implementação da fatia 9 até uma necessidade concreta demonstrada na migração da aplicação piloto UBI. Não iniciar implementação nem criar tenant `013_f13_constraints_and_epistemic_states`; não alterar código, migrations, outros documentos, critérios ou pins, nem criar commit/stage. Numeração apenas proposta/reservada, não migration autorizada. Os ajustes seguintes prevalecem sobre as propostas C1–C9 e aprovações parciais históricas abaixo.

- **C1:** limites de targets e documentos permanecem por decidir com dados reais; os candidatos 64/16 não são contratos aprovados.
- **C6:** leitura exige grant explícito, reason e purpose. MFA é determinado pela policy aplicável, não obrigatório universalmente; esta decisão não enfraquece policies sensíveis já aprovadas de outras fatias.
- **C7 — maker-checker:** considera autores da constraint e das decisões de verificação; não inclui autores de documentos ou targets por mera associação. Conjunto exato por transição deve ser validado com o fluxo UBI que justificar a implementação.
- **C7 — leitura/auditoria:** reutilizar o mecanismo de access audit existente; não criar novo evento funcional crítico por leitura sem requisito aprovado. As propostas anteriores de evento próprio/critical READ ficam sem efeito.
- **C9:** implementação depende de necessidade concreta encontrada na aplicação UBI, com fluxo, dados, lacuna nas fundações existentes e critério verificável identificados. Não aprovar novas abstrações por antecipação.

Próxima ação autorizada: inventário read-only do piloto UBI, com funcionalidades, modelos/serviços e frontend reutilizáveis, dependências single-tenant, cobertura das fundações F13, bloqueadores comprovados e primeiro fluxo end-to-end recomendado. O inventário é apresentado na conversa; não altera código, migrations ou outros documentos. F13 permanece In Progress; AC-13/15 PARTIAL; AC-14/16/17 PENDING; restantes critérios e fechos restritos inalterados. Não afirmar prova sobre dados reais ou rollout a partir de leitura estática.

## Fatia 9 — contratos detalhados v1 para aprovação final (2026-10-11)

**Proposta concreta, ainda não aprovada.** Prevalece como candidato de contrato sobre as perguntas históricas abaixo, sem substituir a aprovação humana do âmbito. Estado da fatia **Draft**; tenant 013 apenas reservado; implementação não iniciada. Estes são contratos técnicos/de produto propostos, não catálogos editoriais produtivos ou evidência de testes. A aprovação final deve confirmar os pontos C1–C9; nenhuma migration anterior ou Central 009 será alterada.

### C1 — Modelo, declarações e catálogos

- ORG-only. organization/tenant, identidade, scope, correlation e assurance vêm exclusivamente da composição confiável. organizational_scope_id opcional, canónico/ativo da organização, é metadata e não amplia autoridade.
- Modelo versionado de declaração institucional: head com CAS → revisões append-only → targets explícitos de revisões exatas → evidência e registo idempotente. Exclusão é uma constraint declarada, não entidade duplicada nem permission.
- Tipo fechado PROHIBITED ou UNAVAILABLE: PROHIBITED exige authority/provenance institucional normativa; UNAVAILABLE exige provenance de indisponibilidade factual e período. Não existem NOT_PREFERRED, operadores livres, prioridades numéricas, thresholds, scripts ou expressões de oportunidade.
- Slot de declaração contém definição de target/aplicability, tipo de constraint e período. Modo declarativo técnico proposto: ASSERTED, UNKNOWN, NONE ou NOT_APPLICABLE. Não é input de autoridade nem escolha livre de estado epistemológico: o servidor valida a declaração e deriva o envelope. ASSERTED declara a restrição; NONE declara ausência dessa restrição exclusivamente no slot/período selecionados, nunca ausência global de constraints; UNKNOWN não declara uma restrição conhecida; NOT_APPLICABLE exige reason específico admitido pela definição do slot. Nenhum dos três últimos modos neutraliza uma constraint ASSERTED existente.
- AuthorityRef, provenanceRef e reasonRef são obrigatórios em todos os modos; REFERENCES a entries/releases publicados exatos. NONE requer autoridade competente catalogada para declarar ausência; não se presume ORG_ADMIN competente. Método obrigatório somente em verify, permitido pelo catálogo para tipo/modo/target. Purpose obrigatório na leitura. Não há texto livre funcional neste recorte.
- Catálogo fechado/versionado define authority, targets, compatibilidade tipo/modo, methods, reasons e purposes operation-scoped. Entries globais são read-only e entries tenant exigem mesma organização; release publicada é imutável. Sem seeds produtivos ou administração editorial nesta fatia. Fixtures sintéticas explícitas aprovadas apenas para testes; catálogo vazio não habilita operações.
- Limites de targets/documentos por decidir com dados reais do fluxo UBI; os candidatos 64/16 foram retirados como contrato. Canonicalização e recusa de duplicados permanecem propostas técnicas, sem aprovar cardinalidades mínimas/máximas nesta ação.

### C2 — Targets, applicability e precedência

- Targets técnicos permitidos: COMPETENCY, EXPERIENCE, FINANCIAL, OPERATIONAL, TERRITORY, TARGET_GROUP e SERVED_POPULATION. São categorias de ligação aos modelos existentes, não novos tipos editoriais. Catálogo de target definitions delimita domain/assertion kind e combinações admitidas; nenhum código editorial de target é criado por esta proposta.
- Competency/experience: version_id exato + pertença ao draft/profile_scope ORG correspondente, cuja revisão é também preservada. Financeiro/operacional/populações: assertion_id + revision exatos, categoria confirmada na base. Não são aceites referências latest, wildcards, labels, campos de tabela, conceitos presumidos equivalentes ou targets de outro tenant. Relações many-to-many não significam produto cartesiano.
- Applicability identifica somente os targets declarados e o período da restrição. Não deriva território, ancestors, scopes subordinados, disponibilidade, autorizações positivas, exceções ou permissões de realizar uma ação. Cada revisão conserva target definitions/releases e relações exatas.
- Create/edit/submit/verify exigem target existente e ainda membro/corrente na fonte; alvos com workflow REJECTED/REVOKED ou verificação expirada são recusados para novas associações/verificação. UNKNOWN de competência é permitido apenas quando a definição catalogada o admite, nunca como evidência conhecida. Não exigir que todo alvo seja VERIFIED: uma restrição pode ser declarada sobre material ainda não verificado, sem o verificar.
- Read/replay/dispute/revoke preservam relações históricas mesmo se o head da fonte avançou, mas reautorizam acesso atual a cada alvo. Resposta inclui versão e estado efetivo da fonte sob autorização; não substitui o target histórico pelo corrente, nem revoga a constraint automaticamente.
- Não há precedência resolutiva: todas as declarações permanecem identificáveis, sem last-write-wins, pesos ou dominância PROHIBITED sobre UNAVAILABLE. Revisão posterior substitui somente o head da mesma declaração. NONE/NOT_APPLICABLE não anulam ASSERTED de outra declaração, mesmo em períodos sobrepostos. Conflitos explícitos não selecionam um vencedor.

### C3 — Conflitos explícitos, sem resolver ou executar

- Proposta: conflito é relação declarada entre a revisão desta declaração e duas ou mais revisões exatas, pertencentes à mesma organização, dos domínios catalogados ou de outras declarações 013, com períodos relevantes sobrepostos. Referências a outras declarações 013 são permitidas exclusivamente como CONFLICT_MEMBER, nunca como applicability recursiva; esta compatibilidade deve constar do catálogo fechado. Não inferir incompatibilidade por quantidade, label ou conteúdo.
- Registo do conflito ocorre exclusivamente em create/edit de DRAFT, como parte do conteúdo material sujeito a submit/verify. Requer reason catalogado de conflito, provenance, subjects autores dos membros e pelo menos uma referência F11 autorizada AVAILABLE/CLEAN; máximo 64 membros, sem self-reference/duplicados. Esses membros também contam como targets e requerem leitura autorizada.
- conflict_status é derivado CONFLICTED quando a revisão contém uma declaração de conflito válida; CLEAR significa apenas ausência de conflito explicitamente registado nessa revisão, não prova de consistência universal. Contestar uma assertion por dispute não cria automaticamente CONFLICTED.
- Verify valida autoria, evidência e declaração explícita, não resolve o conflito. Uma revisão pode ser VERIFIED e CONFLICTED; o envelope não a apresenta como evidência não contestada. Sem operação resolve, seleção de vencedor, clear automático ou alteração das sources.
- Depois de submit não se pode apagar/editar o conflito; correção requer nova declaração e preserva a anterior. Revogação/expiração do registo não demonstra resolução dos membros. Autorizações insuficientes impedem revelar membros ou estado sensível.

### C4 — Envelope epistemológico e adaptação não destrutiva

Envelope proposto: knowledge_status, verification_status, conflict_status, workflow_state, valid_from/valid_until, evaluated_at, policy_ref/policy_version e referências de origem autorizadas. Confidencialidade e projeção são separadas. Caller não fornece estados derivados.

| Declaração validada na 013 | Conhecimento derivado | Valor afirmado |
|---|---|---|
| ASSERTED com targets/authority/provenance válidos | KNOWN | restrição explícita |
| UNKNOWN admitido pelo slot | UNKNOWN | nenhum valor de restrição conhecido |
| NONE admitido pelo slot e autoridade competente | NONE | ausência explícita somente nesse slot/período |
| NOT_APPLICABLE admitido com reason próprio | NOT_APPLICABLE | nenhum valor de restrição |

- Todos os modos seguem o mesmo workflow e verificação explícita; nesta fatia **NOT_REQUIRED não é atribuível às declarações 013**, porque a proposta exige verificação. Código conserva significado normativo, mas uma policy não pode dispensar verificação por default. Nenhum modo é automaticamente VERIFIED.
- DRAFT/SUBMITTED/REJECTED → UNVERIFIED; VERIFIED → VERIFIED; DISPUTED → DISPUTED; REVOKED → REVOKED. Depois de valid_until, VERIFIED/DISPUTED → EXPIRED; REVOKED permanece REVOKED. workflow_state persistido permanece independente, incluindo REJECTED. Razão/método e histórico são preservados.
- Ausência não gera declaração nem slot materializado automaticamente; null/zero/false não representam UNKNOWN/NONE. Rejeição significa verificação não aceite, não prova de ausência. F11 anexado não muda conhecimento/verificação.
- Adaptação de domínios 009–012 é somente leitura/projeção de revisões autorizadas: competency preserva KNOWN/UNKNOWN e verificação explícita ligada à assertion version; experience mantém UNVERIFIED salvo evidência própria de verificação suportada, nunca VERIFIED por ligação a competência verificada; financeiro/operacional/populações preservam KNOWN e estados/validade reais. Zero continua KNOWN.
- Modos NONE/NOT_APPLICABLE da 013 descrevem apenas o slot de constraints; **não reclassificam uma capacidade financeira, operacional ou populacional existente** nem escrevem novo estado nas tabelas antigas. Source ausência não é sintetizada como UNKNOWN. Sources sem suporte de uma dimensão têm incapacidade explicitamente indicada pelo descriptor/version, não um estado inventado. NOT_REQUIRED não é inferido do facto de a fonte não ter verificação.
- conflict_status de domínios antigos só é projetado se existir evidência explícita suportada; não lhes atribuir CLEAR por ausência de mecanismo. A nova declaração 013 pode ter conflito próprio sem alterar o envelope intrínseco da fonte.
- WITHHELD não é knowledge_status. Não se implementam redaction/exports nesta fatia: acesso insuficiente falha uniformemente, sem confirmar existência. Policy desconhecida/incompatível ou combinações impossíveis falham fechado; nenhum envelope incompleto é apresentado como completo/READY.

### C5 — Workflow, tempo e validade

Transições únicas: create→DRAFT; edit DRAFT→nova DRAFT; submit DRAFT→SUBMITTED; verify SUBMITTED→VERIFIED; reject SUBMITTED→REJECTED; dispute VERIFIED→DISPUTED; revoke VERIFIED/DISPUTED→REVOKED. Não permitir dispute/revoke de verificação efetivamente EXPIRED; não permitir editar/ressubmeter REJECTED/REVOKED nesta fatia. Correção é nova declaração explícita, sem exclusão retroativa.

- applicability_start/end: DATE textual civil YYYY-MM-DD, ambos obrigatórios e inclusivos, start<=end; calculados sem conversão por timezone. Período aberto/infinito não é admitido no recorte proposto.
- valid_from: TIMESTAMPTZ UTC obrigatório em verify; valid_until opcional, estritamente posterior a valid_from. Catálogo de método pode impor prazo máximo aprovado; ausência de prazo catalogado não cria um prazo fictício.
- verified_at do servidor não é valid_from. Antes de valid_from, o resultado histórico VERIFIED/DISPUTED permanece, mas verificationCurrentlyValid=false; não criar novo estado epistemológico. No intervalo valid_from<=t<=valid_until é válido; depois de valid_until é EXPIRED no acesso. Relógio PostgreSQL confiável e evaluated_at obrigatório.
- Período da declaração e validade da verificação são distintos: periodContainsEvaluationDate informa somente inclusão civil do instante avaliado, sem executar a constraint. Nenhum booleano significa eligible/ineligible/applicableToOpportunity.
- Estado corrente usa clock_timestamp e data civil UTC documentada; reprodução histórica requer revision/policy e instante explícitos pelo caminho autorizado. Nesta fatia read funcional usa apenas o instante atual; não introduzir endpoint time-travel. Histórico nunca é reescrito por scheduler.
- Modificações materiais de conteúdo/targets/período só em DRAFT e invalidam qualquer evidência de verificação de outra revisão; submit/verify preservam o conteúdo exato.

### C6 — Confidencialidade, F11 e leitura de targets

- Mínimo proposto **RESTRICTED para todas as declarações**, incluindo knowledge/conflict/applicability, target IDs e evidência. Não criar classificação persistida F11 ou possibilidade de downgrade/reclassification nesta fatia. HIGHLY_RESTRICTED já existente na fonte continua protegida pela sua policy; associação não reduz proteção.
- Read exige grant explícito, reason e purpose operation-scoped; MFA é determinado pela policy aplicável, não obrigatório universalmente. Sem metadados sem grant ou erro que confirme existência inacessível. As restantes propostas de projeção/canais aguardam evidência UBI.
- Resolução/autorização cumulativa do alvo: FINANCIAL→F13_FINANCIAL_READ; OPERATIONAL→F13_OPERATIONAL_READ; TERRITORY/TARGET_GROUP/SERVED_POPULATION→F13_POPULATION_READ, recursos assertion exatos. COMPETENCY/EXPERIENCE→F13_PROFILE_READ, PROFILE_PROJECTION da profile_scope ORG resolvida server-side, mais validação de draft/revisão/membership do material; nenhuma permission de edit é usada como read.
- Esta autorização cumulativa integra todas as operações que utilizam/revelam targets, inclusive create/edit/submit/verify e replay. Os target loaders não devolvem valores financeiros, quantidades ou conteúdo documental: somente identidade/revisão/state autorizados indispensáveis. Descriptor/read policy do alvo deve ser fechado e compatível; acesso de perfil nunca substitui uma operação sensível específica. Se não existir contrato autorizado de leitura suficiente de um alvo, a associação falha fechado, não se cria fallback.
- F11: DOCUMENT_READ exato para cada referência devolvida/utilizada, inclusive authoring, verify e replay; mesma organização/resource binding da declaração e versão AVAILABLE/CLEAN. Revogação documental impede devolver referências/metadata históricas. Nenhuma cópia, reclassificação ou autorização documental implícita.
- Scope e target memberships são carregados/bloqueados server-side. A leitura alvo sensível aplica sua própria assurance/policy/reason/purpose; catálogo de requests cumulativos deve aprovar os códigos por operação, sem reaproveitar indiscriminadamente um reason de mutação. Não produzir eventos de acesso duplicados: a avaliação cumulativa usa F5 e um F7 source-local da operação 013 cobre as leituras internas aprovadas, sem chamar APIs funcionais que criem outra transação.

### C7 — F5, maker-checker e eventos F7 propostos

As oito operações são novas definições técnicas propostas, sujeitas a aprovação final, não conteúdo editorial. Scopes somente ORGANIZATION; bundles de perfis vazios; grants por operação/resource exato.

| Operation | Permission | Resource | Assurance | SoD e requisitos | Evento crítico |
|---|---|---|---|---|---|
| F13_CONSTRAINT_CREATE | profile_constraint.create | CONSTRAINT_SCOPE (organização) | NORMAL + cumulativa dos alvos/F11 | authority/provenance/reason | CONSTRAINT_DECLARATION_CREATED |
| F13_CONSTRAINT_EDIT | profile_constraint.edit | CONSTRAINT_ASSERTION | NORMAL + cumulativa | DRAFT/CAS/reason | CONSTRAINT_DECLARATION_EDITED |
| F13_CONSTRAINT_READ | profile_constraint.read | CONSTRAINT_ASSERTION | policy aplicável | reason + purpose | access audit existente; sem novo evento funcional crítico aprovado |
| F13_CONSTRAINT_SUBMIT | profile_constraint.submit | CONSTRAINT_ASSERTION | NORMAL + cumulativa | DRAFT/CAS/reason | CONSTRAINT_DECLARATION_SUBMITTED |
| F13_CONSTRAINT_VERIFY | profile_constraint.verify | CONSTRAINT_ASSERTION | RECENT_MFA | maker-checker; método | CONSTRAINT_DECLARATION_VERIFIED |
| F13_CONSTRAINT_REJECT | profile_constraint.reject | CONSTRAINT_ASSERTION | RECENT_MFA | maker-checker; reason | CONSTRAINT_DECLARATION_REJECTED |
| F13_CONSTRAINT_DISPUTE | profile_constraint.dispute | CONSTRAINT_ASSERTION | RECENT_MFA | reason; sem SoD adicional | CONSTRAINT_DECLARATION_DISPUTED |
| F13_CONSTRAINT_REVOKE | profile_constraint.revoke | CONSTRAINT_ASSERTION | RECENT_MFA | maker-checker; reason | CONSTRAINT_DECLARATION_REVOKED |

- Reason é obrigatório nas oito operações; purpose em read; verify acrescenta método/validade. Grants verify/edit nunca incluem reject/dispute/revoke. Verificação/rejeição/revogação humanas não disponíveis a service actors; nesta fatia propõe-se excluir service actors de todas as oito operações até contrato específico.
- SoD sobre stable human subject considera autores da constraint e das decisões de verificação; mera associação a documento ou target não inclui os respetivos autores. Múltiplas sessões/memberships da mesma pessoa não contornam a regra. Conjunto exato por transição aguarda evidência do fluxo UBI, sem aprovar requisitos adicionais por inferência.
- Papéis de associação não concedem autoridade nem verificam targets; as propostas de papéis fechados permanecem históricas e não são fundamento para incluir autores associados no maker-checker.
- Replay VERIFY usa material anterior à operação originalmente auditada, sem incluir o próprio checker posterior; revogações F3/F5/F11 e mudanças de policy continuam bloqueadoras. Dados internos de autorização não são fornecidos pelo caller.
- F7 persiste actor/membership, organização/tenant/scope, operação/resource da declaração, correlation, idempotency key, versões anterior/nova, decisão normalizada F5/assurance/policies efetivamente avaliadas, refs/releases/versões de reason/purpose/método e digest somente de metadata técnica. Não inclui constraint/target/authority/provenance/document IDs sensíveis, geografias, grupos, valores, conteúdo ou intention digest exposto. Identity/resource metadata seguem o schema F7 existente, sem PII textual.
- Mutação crítica exige evento atómico segundo contrato aprovado; leituras reutilizam o mecanismo de access audit existente, sem criar novo evento funcional crítico por leitura sem requisito aprovado. Replay não duplica efeitos/eventos. Falha de auditoria exigida faz rollback integral conforme o contrato existente. F10 permanece de baixa cardinalidade, sem valores/IDs sensíveis; assurance não pode ser sobredeclarada.

### C8 — Persistência, concorrência e autoridade

- Tenant 013 acrescenta somente estruturas próprias/catálogos/descriptors; sem reescrever 007–012 ou Central 009. FK/check/trigger valida organização, kind/version/release e matriz estrutural fechada; SQL não avalia restrição semântica ou oportunidade. Catálogos globais SELECT-only; FORCE RLS; owner NOLOGIN e runtime mínimo; sem UPDATE/DELETE/TRUNCATE em revisões/links/results.
- CAS por declaração exige expectedRevision em edit/submit/verify/reject/dispute/revoke; read seleciona revisão sob lock; idempotência por org/op/key e intenção funcional canonicalizada, sem identidade do caller. Key igual/intenção diferente gera conflito somente após autorização; key igual/intenção igual reautoriza e usa revisão original.
- Ordem candidata comum: client físico preparado F4 → mutex F13-P1 organização → intention org/op/key → head 013 → loaders de domínios em ordem técnica fixa COMPETENCY/EXPERIENCE/FINANCIAL/OPERATIONAL/POPULATION e IDs ordenados → scope/document locks conforme contratos existentes → guard Central → CAS/revision/links/F7/result → fencing/permit/COMMIT. Antes de implementar, validar a ordem real dos loaders existentes e usar a mesma disciplina nos caminhos SQL; se houver incompatibilidade não inverter locks ou adicionar retry cego.
- Material source versionado/append-only pode ser lido sem lock de escrita; membership corrente e lifecycle mutable relevantes são carregados sob lock apropriado. Identidades/grants/policy são revalidados pelo guard coordenado existente. Mesmo client durante toda a transação; client/capability/tenant/workload/fence/pool não podem ser trocados.
- Recovery de COMMIT incerto usa a idempotência tenant 013 e protocolo Central existente, confirmando término da transação original; nunca presume rollback por morte/deadline. Retry/recovery não devolve resultado antes de nova autorização, não duplica eventos e não expõe handles/permits privados. Mudança de autoridade lineariza conforme o contrato Central existente.

### C9 — Entrega, testes e fronteira futura

- Implementação adiada: depende de necessidade concreta demonstrada num fluxo da aplicação UBI e de aprovação do contrato ajustado. Não basta aprovação de suporte estrutural ou fixtures sintéticas para iniciar código/migration; conteúdo editorial produtivo permanece pendente.
- Testes PostgreSQL reais devem cobrir cada linha das matrizes knowledge/workflow/F5, modos NONE/UNKNOWN/NOT_APPLICABLE sem neutralização, papel/compatibilidade/targets exatos, conflitos declarados versus dispute, todos os limites de validade, fontes UNKNOWN/zero/históricas e ausência de auto-verify.
- Central + A/B: membership/tenant/target/F11 revogados ou incompatíveis, grants assimétricos, SoD em autores materiais/documentais, MFA ausente/stale, confidencialidade/erros uniformes, CAS concorrente, replay/digest e COMMIT incerto. F5/F11/F7 falhados deixam zero mutação/F7/result; eventos persistidos e F10 não contêm dados sensíveis.
- Runner 012→013→012→013 e caminhos suportados, up/down/checksums/fingerprint/manifest/preflight/ledger, protected down e rollback parcial; gates F13/Central/F13-P1/F12/F9 e domínios aplicáveis; suite backend/node/diff/scans/cleanup próprio. Sem antecipar pins ou PASS.
- F14 futuro recebe references/revisions, policy/provenance e envelope inequívocos exclusivamente quando houver snapshot READY; não se entrega consumer/evaluator ou READY nesta fatia.
- Critérios centrais AC-19/20 recebem somente evidência restrita; restantes estados preservados: F13 In Progress; AC-13/15 PARTIAL; AC-14/16/17 PENDING. Fecho requer revisão read-only e aprovação humana. Nenhum domínio/finding fechado é reaberto sem evidência concreta.

**Decisão solicitada:** confirmar C1–C9 integralmente ou indicar alterações por identificador. São especialmente novos para aprovação: modos declarativos do slot de constraints, conflitos registados em Draft, política mínima RESTRICTED, autoridade de leitura cumulativa dos targets e relação entre validade e verificação. Sem aprovação não passam a contrato produtivo; sem pedido de implementação não se inicia tenant 013.

## Fatia 9 — aprovação explícita do âmbito restrito (2026-10-11)

**Aprovação humana registada para o âmbito e os contratos concretamente descritos na proposta abaixo.** Recorte declarativo ORG-only, numeração reservada tenant `013_f13_constraints_and_epistemic_states`, tipos PROHIBITED/UNAVAILABLE, applicability explícita sem autorização positiva ou relaxamento, relações versionadas aos domínios existentes e envelope epistemológico multidimensional server-side. Sem evaluator, elegibilidade, scoring, matching, execução automática, IA/inferência, regras de oportunidades, resolução automática de conflitos, publicação/snapshots/activation ou frontend. A proposta abaixo é preservada como histórico do Draft.

São confirmados os contratos candidatos explícitos: create→DRAFT; edit DRAFT→nova DRAFT; submit→SUBMITTED; verify SUBMITTED→VERIFIED; reject SUBMITTED→REJECTED; dispute VERIFIED→DISPUTED; revoke VERIFIED/DISPUTED→REVOKED; EXPIRED derivado no acesso, sem scheduler ou estado persistido. Organização/recursos server-side, CAS, idempotência org/operação/key/digest, histórico append-only, replay reautorizado e maker-checker sobre material anterior à operação original; F11 cumulativo/exato sem acesso implícito; oito grants distintos sem bundles implícitos; verify/reject/revoke com MFA e maker-checker, dispute/read restrito com MFA/reason e read com purpose; runtime F3/F4/F5, guard/recovery Central existente, F7 atómico sanitizado e F10 de baixa cardinalidade. A definição operacional aprovada existente de PROHIBITED (restrição normativa/institucional) e UNAVAILABLE (indisponibilidade factual durante um período) mantém-se; não se cria outro tipo ou conteúdo editorial.

**Limite desta aprovação: não substitui definições ainda inexistentes. Estado de preparação continua Draft, âmbito aprovado mas contratos detalhados por fechar; não Ready nem In Progress da fatia.** A proposta continha perguntas, não valores concretos para todos os nove pontos. A mensagem de aprovação confirma os contratos acima, mas não permite inventar silenciosamente:

- catálogo de targets, relações/cardinalidades e compatibilidade por domínio/tipo/revisão, incluindo alvos expirados/revogados e precedência temporal;
- evidência mínima e autoria autorizada dos conflitos declarados, seu registo e efeito na projeção corrente;
- matriz de combinações epistemológicas por slot/domínio e adaptação não destrutiva dos domínios existentes, inclusive NONE/NOT_APPLICABLE/NOT_REQUIRED;
- regras exatas de período civil versus instante, valid_from/valid_until, inclusividade e estados antes do início da validade;
- policy mínima de confidencialidade e permissões cumulativas para ler os alvos, seus estados e metadata;
- nomenclatura final F5/resources/eventos, sujeitos materiais da SoD e independência específica do revoker face ao verifier;
- códigos/releases produtivos de authority, métodos, reasons e purposes. Não há autorização para seeds fictícios; suporte sem conteúdo produtivo e fixtures sintéticas deve ser explicitamente delimitado no contrato final.

O contrato futuro F14 conserva referências/versões/policy/provenance e estados inequívocos, sem decidir compatibilidade; consumption READY/snapshots permanece fora. **Implementação não iniciada nem autorizada nesta ação documental.** F13 In Progress; AC-13/15 PARTIAL, AC-14/16/17 PENDING e restantes critérios inalterados; fatias fechadas e seus pins preservados. Próxima preparação: apresentar matrizes e parâmetros concretos para confirmação humana, sem criar migration, código, commit/stage ou conteúdo editorial.

## Proposta da fatia 9 — constraints, exclusões e estados epistemológicos (2026-10-11)

**Estado histórico: Draft anterior à aprovação parcial documentada acima; implementação não autorizada.** Numeração proposta exclusivamente tenant: `013_f13_constraints_and_epistemic_states`. Não criar migration/pins, alterar código, migrations anteriores ou Central 009, nem fazer commit/stage. Fatia 8 permanece formalmente fechada no recorte aprovado. F13 In Progress; AC-13/15 PARTIAL, AC-14/16/17 PENDING e restantes estados preservados. Nenhum novo resultado de testes ou AC PASS é declarado.

### Objetivo e âmbito proposto

Conservar constraints/exclusões institucionais explicitamente declaradas, versionadas e verificáveis e expor estados epistemológicos coerentes, sem converter essas declarações em elegibilidade, compatibilidade, score ou efeito automático sobre outras assertions.

- Recorte recomendado **ORG-only**, sujeito a aprovação, com organização da autoridade F3 e eventual organizational_scope_id F13-P1 somente como metadata server-side. Overlays UNIT/TEAM, herança/materialização de coortes e relaxamento de constraints ficam fora deste recorte; as invariantes monotónicas aprovadas continuam a limitar extensões futuras.
- Constraints e exclusões explícitas usam os tipos **já aprovados PROHIBITED e UNAVAILABLE** na decisão `f13-exclusions-vs-f14-rules`, não novos tipos editoriais. NOT_PREFERRED continua fora. Targets, relações, authority/provenance, períodos e reasons são fechados/versionados; catálogo ausente ou incompatível falha fechado. Sem texto livre executável, operadores arbitrários, SQL/DSL/scripts ou referências específicas a oportunidades/candidaturas.
- Applicability explícita por domínio/tipo de assertion, com associações many-to-many a referências exatas e revisões de competências, experiência, capacidade financeira/operacional, territórios e populações servidas. Uma relação não modifica nem verifica o alvo, não concede leitura do alvo e não transforma ausência de capacidade em exclusão. Compatibilidade, pertença, estados e versões são carregados server-side; cardinalidades/targets finais dependem de aprovação.
- Envelope epistemológico multidimensional derivado server-side de declarações/provenance, evidência autorizada, verificação explícita, disputa/revogação e validade, segundo policy fechada/versionada do domínio/slot. Conhecimento KNOWN/UNKNOWN/NONE/NOT_APPLICABLE; verificação NOT_REQUIRED/UNVERIFIED/VERIFIED/DISPUTED/REVOKED/EXPIRED; conflito CLEAR/CONFLICTED permanecem dimensões distintas já aprovadas. A derivação não inventa declarações negativas, inaplicabilidade, conflitos sem suporte explícito ou verificação pela presença de documento.
- Ausência continua “não materializado”, não UNKNOWN/NONE/zero/false; NONE exige declaração negativa autorizada, período e provenance; NOT_APPLICABLE exige reason permitido pelo slot. WITHHELD é projeção autorizada, nunca conhecimento; não introduzir projeções/redaction novas ou confirmar existência sensível sem contrato. Workflow de authoring da assertion não equivale ao lifecycle editorial de publicação do perfil.
- Heads com CAS/expected revision; revisões, relações e evidência append-only; idempotência org/operação/key/digest; replay da revisão auditada com F3/F5/F11 atuais e maker-checker relativo ao material anterior à operação original. Correção não reescreve histórico ou versões de domínios fechados.
- Referências F11 exatas com binding/tenant/lifecycle server-side e DOCUMENT_READ cumulativo nas operações que devolvem ou utilizam referências/metadados; sem copiar/reclassificar documentos ou conceder acesso implícito. Autorizações também protegem valores/estados/metadata dos alvos relacionados.
- Oito operações próprias create/edit/read/submit/verify/reject/dispute/revoke, grants distintos, runtime tenant confiável, mesma conexão F4 preparada, authority coordinator Central existente, F7 crítico na mesma transação e F10 com labels fechadas de baixa cardinalidade. COMMIT incerto reconciliado pela evidência source-local, nunca por suposição de rollback.

### Exclusões

Avaliação automática de elegibilidade/compatibilidade, scoring, matching F14, execução automática de constraints, regras/thresholds de oportunidades, IA/inferência de constraints; resolução semântica automática de conflitos, alteração em cascata de assertions de outros domínios, backfill legacy inferido, administração editorial completa, publicação do perfil, completude/READY/snapshots/activation, exports/projeções novas e frontend. Sem expansão de scope/herança ou migração retroativa das fatias fechadas.

### Modelo e operações candidatos — não aprovados

Modelo lógico: constraint head → revisões imutáveis com tipo, authority/provenance, applicability e validade explícitas → associações a revisões exatas de alvos → evidência/verificação e eventuais conflitos declarados → registo idempotente source-local. A projeção epistemológica indica policy/version e fontes consideradas; não cria um estado único nem altera as fontes.

Workflow candidato: create→DRAFT; edit DRAFT→nova DRAFT; submit→SUBMITTED; verify SUBMITTED→VERIFIED; reject SUBMITTED→REJECTED; dispute VERIFIED→DISPUTED; revoke VERIFIED/DISPUTED→REVOKED. **Matriz final, estados admissíveis e efeitos epistemológicos exigem aprovação.** Recomenda-se EXPIRED derivado no acesso, sem scheduler/persistência, preservando valor histórico; regras de valid_from/valid_until e períodos permanecem por fechar. Não acrescentar operação de resolução de conflitos sem autorização própria.

Resources candidatos: create no âmbito ORG autenticado; demais operações na constraint/assertion exata carregada sob lock, incluindo a revisão original em replay. Permissions/nomenclatura finais e permissões cumulativas dos alvos serão aprovadas antes do código. Verify/reject/revoke com MFA recente e maker-checker material/documental; dispute e read restrito com MFA/reason e read com purpose, conforme a base normativa F5. Freshness vem da policy F5, nunca de input funcional; bundles vazios, sem capabilities implícitas de edit/verify para outras operações. Schemas F7 finais devem preservar identidade/versões/assurance efetivamente avaliadas e reason/purpose server-side, sem conteúdo/targets sensíveis, documentos ou digests suscetíveis de inferência.

### Contratos e decisões pendentes

1. **Tipos e catálogos:** delimitar operacionalmente PROHIBITED versus UNAVAILABLE, distinção entre constraint e exclusão (sem duplicar factos), targets/tipos de assertion permitidos, authority, métodos, reasons/purposes e releases. Nenhum conteúdo produtivo inventado; aprovar suporte estrutural sem seeds e fixtures sintéticas, se necessário.
2. **Âmbito positivo/negativo:** decidir se applicability delimita apenas onde uma restrição se aplica; não deve expressar autorização positiva, preferência, exceção permissiva ou neutralização de outra constraint. NONE não equivale a PROHIBITED/UNAVAILABLE. Confirmar recorte ORG-only e metadata de scope.
3. **Applicability/precedência:** fechar relações/domínios/cardinalidades, validação de revisões históricas e alvos revogados/expirados, períodos sobrepostos e ordem explícita. Não usar ordem de inserção/label ou “última escrita vence” para resolver semântica.
4. **Conflitos:** definir o que constitui conflito declarado, evidência mínima, associação às revisões envolvidas, tratamento corrente e quem pode registá-lo. Recomenda-se preservação explícita e fail-closed, sem inferência semântica nem resolução nesta fatia; qualquer resolução futura precisa de grant/SoD/reason/F7 próprios.
5. **Estados epistemológicos:** aprovar matriz de combinações por domínio/slot e mapeamento do workflow para cada dimensão; critérios de KNOWN/UNKNOWN/NONE/NOT_APPLICABLE/NOT_REQUIRED e efeitos de disputa/revogação. Definir adaptação não destrutiva dos domínios existentes; não atribuir ausência de evidence à negação ou à dispensa de verificação.
6. **Temporalidade:** fechar datas civis/instantes, inclusividade, período de referência versus validade, efeito antes de valid_from/depois de valid_until, relógio confiável e reprodução histórica da policy.
7. **Confidencialidade:** policy mínima por tipo/domínio, proteção da existência, applicability e metadata; leitura exata/estado/refs autorizados, erro uniforme, acesso F11 e alvos relacionados. Sem defaults permissivos, novas classificações F11, thresholds ou supressões inventadas.
8. **F5/MFA/maker-checker/F7:** aprovar oito permissions/resources/SoD, autores materiais incluídos e independência na revogação, service actors e schemas/eventos. A decisão antiga deixou a operação específica de verificação de constraints em aberto: a proposta não a considera automaticamente aprovada.
9. **Contrato futuro F14:** conservar IDs/revisões, policy, provenance, períodos e estados distinguíveis, sem produzir resultado de matching. Consumo futuro só por snapshot READY e regra F14 versionada; ambas as funcionalidades estão fora desta fatia.

### Critérios afetados e dependências

Critérios centrais: **F13-AC-19** (constraints fechadas/monotónicas e fronteira F14) e **AC-20** (dimensões epistemológicas sem colapso), apenas no recorte declarativo. Transversais AC-01/02/04/05/09/10/11/12/18/21/22/24/25/26/27/28/29/30/31; regressões dos domínios AC-14/15/16/17. Não comprova completude integral de AC-20, overlays de AC-19, nem AC-06/07/08/32 ligados a publicação/activation/READY. Todos os estados permanecem inalterados.

Dependências: decisões `f13-exclusions-vs-f14-rules`, `f13-knowledge-state-policy`, `f13-authorization-and-segregation`, `f13-confidentiality-projection-purpose` e fronteiras de scope/versioning/completion; tenant 007–012 e seus contratos/pins; F13-P1, F3/F4/F5/F7/F10/F11 e protocolo Central existente. Aprovação editorial concreta e integração IdP/rollout permanecem pendentes.

Riscos principais: negação inferida, precedência que relaxa restrições, falsos VERIFIED/NOT_REQUIRED, confusão DISPUTED/CONFLICTED/WITHHELD, exposição de targets/estados sensíveis, drift temporal/policy e replay que contorna SoD ou autorização documental. Mitigar com contratos fechados, autoridade server-side, leitura explícita e testes negativos, não com defaults ou scoring.

### Testes PostgreSQL exigidos — ainda não executados

- Central + tenants A/B reais: residência física/capabilities, RLS/FORCE RLS, leitura global read-only, IDOR e isolamento de alvos/catálogos/F11; contexto/organização forjados, releases/tipos/scopes incompatíveis recusados.
- CAS concorrente, mesma key/operação concorrente, conflito de digest, separação por tenant/operação; histórico/relações append-only e nenhuma alteração retroativa em 009–012.
- Matriz completa de applicability, transições e combinações epistemológicas aprovadas; ausência/null/zero/false/NONE distintos, documento não verifica, disputa não equivale a conflito, revogação/expiração preservam histórico; limites temporais e policy incompatível fail-closed.
- Grants unitários/assimétricos das oito operações, recursos exatos, maker-checker com stable subjects/autores documentais, MFA ausente/stale, revogações F3/F5/F11 e replay histórico; sem exposição de metadata inacessível.
- F7 realmente persistido e decisão F5 correspondente; rollback integral por F5/F7/F11, sem resultado idempotente parcial. F7/F10 sem conteúdo sensível/targets/documentos ou cardinalidade elevada.
- COMMIT PostgreSQL real com confirmação perdida, retry concorrente, reconciliação e recuperação repetida sem duplicar revisão/F7/resultado e sem bypass após revogação.
- Runner canónico 012→013→012→013, instalações/upgrades suportados, up/down checksums, manifest/preflight/fingerprint/ledger/capability, rollback SQL→ledger, down seguro com dados protegidos e concorrência do runner.
- Testes focados e suite backend; gates F13/Central/F13-P1/F12 e regressões aplicáveis dos domínios; node --check, git diff --check, scans e cleanup exclusivamente de recursos próprios.

### Definição de conclusão e recomendação

Antes da implementação: aprovação explícita do âmbito e dos nove contratos pendentes, policy/combinações admissíveis, matriz F5/F7 e tratamento de catálogos sem conteúdo produtivo. Entrega: somente suporte aprovado, pins/gates/evidência reproduzível, nenhum domínio fechado reescrito, invariantes e todos os testes relevantes comprovados; revisão formal read-only sem findings bloqueadores e decisão humana de fecho restrito. Não promover AC por aprovação do Draft ou testes sintéticos.

**Recomendação:** manter Draft e ajustar/fechar os contratos antes de avançar. O recorte declarativo ORG-only e a projeção epistemológica não destrutiva são adequados; não acrescentar evaluator, resolução automática de conflitos, completude, publication/activation ou matching para suprir decisões em falta.

## Fatia 8 — fecho formal restrito (2026-10-11)

**Fecho humano explícito: fatia 8 formalmente fechada no âmbito restrito aprovado.** Esta decisão sucede à correção de F13-S8-R1-001 e à revisão formal read-only repetida, com **sem findings bloqueadores** e sem novos problemas materiais. Fecha apenas territórios, beneficiários-alvo e populações servidas ORG-only; não fecha a feature F13, não aprova rollout nem inicia outra fatia. As secções Review abaixo passam a evidência histórica pré-fecho.

- **F13-S8-R1-001: corrigido, revalidado e encerrado.** Replay VERIFY mantém maker-checker sobre material anterior à operação originalmente auditada, nova autorização F3/F5/F11 e assurance atuais. Reprodução independente em PostgreSQL real confirmou fluxo normal e COMMIT incerto sem erro no replay, com três revisões totais (CREATE/SUBMIT/VERIFY), um F7 VERIFY e um registo idempotente por operação. Revogação de sessão, membership e grants/versões continua a impedir replay sem nova mutação/F7/idempotência; MFA e DOCUMENT_READ ausentes/stale/revogados permanecem recusados nas provas do gate.
- Evidência final já executada: testes da fatia **15/15**, focados **409/409**, backend **673/673**; gate de populações repetido **PASS**, gates F13/Central, F13-P1 e F12 **PASS**, F9 PostgreSQL **3/3**. Runner canónico **011→012→011→012 PASS**, down com dados protegidos recusado. Revisão read-only e prova independente não alteraram nenhum dos 147 ficheiros do snapshot. `node --check` nos 123 JS, `git diff --check` e scans passaram nos limites documentados; recursos descartáveis próprios removidos, recursos preexistentes preservados. Estes testes não são reexecutados nesta ação exclusivamente documental.
- Tenant `012_f13_territories_and_populations` mantém os pins canónicos: Up `4f3972e42a292678b45e86d690aca7410155f17dee7fedfc275a88837c984cd8`; Down `1ff268c9a0b0502c93858ff14e5314fc8075f25e670b909d3732e610ab5b0396`; Fingerprint `0558700553db2170ee60565b92339f5556f603d4108c9273d476b960cb1460c3`. Nenhuma alteração a migrations, manifests ou pins.
- **Estados preservados:** F13 **In Progress**; AC-13 e AC-15 **PARTIAL**; AC-14, AC-16 e AC-17 **PENDING**; restantes critérios inalterados, nenhum promovido. Catálogos editoriais/geográficos/taxonomias/fontes e governação produtiva, IdP externo/provider/diretório, rollout e SLO permanecem pendentes. Fixtures sintéticas não aprovam conteúdo editorial nem integração externa.
- **Limites preservados:** sem mapas/geocoding/inferência territorial, estimativas, pessoas/identificadores individuais, thresholds/supressão inventados, agregações/rollups, eligibility/matching, lifecycle/aprovação/publicação do perfil, snapshots/activation ou frontend. Não autoriza uma nova migration ou fatia. Esta ação altera exclusivamente os dois documentos de contexto; sem alterações funcionais, commit ou stage.

## Fatia 8 — correção F13-S8-R1-001 (2026-10-11)

**Estado histórico pré-fecho: Review, F13-S8-R1-001 corrigido e revalidado nas provas abaixo.** A revisão anterior identificou falha HIGH no replay VERIFY e na recuperação de COMMIT incerto: o checker era incluído no histórico material da sua própria operação. A prova específica desta correção substitui a ausência desse caso na evidência histórica abaixo, sem autorizar fecho automático. Correção restrita ao loader/service de populações e testes; nenhuma migration/pin alterada.

- Sob o lock do head e da intenção, o loader resolve organization/POPULATION_VERIFY/key no registo idempotente append-only, confirma assertion/revisão/operation VERIFY/state VERIFIED, carrega a revisão SUBMITTED anterior e limita a autoria material/documental a esse histórico. A fronteira não vem de expectedRevision do caller. O digest calculado pelo repository é confrontado com o registo; divergência falha após F5, sem devolver o resultado. F3/F5/F11, membership/policy/assurance atuais e guard Central continuam obrigatórios antes de qualquer replay/reconciliação. Não há exceção maker-checker: maker permanece recusado e documents originais mantêm DOCUMENT_READ cumulativo/exato mesmo após avanço do head.
- `node --test test/f13TerritoriesAndPopulations.test.js`: **15/15 PASS**. Focados `^f(3|4|5|7|13).*test.js`: **409/409 PASS**. Suite backend `npm test`: **673/673 PASS**, zero failures/skips.
- `test/integration/f13/population-gate.ps1`: **PASS**, PostgreSQL 17, Central e dois tenants reais, composição/engine F5 produtivos. VERIFY normal e concorrente com mesma key, COMMIT real seguido de confirmação perdida e duas confirmações perdidas: uma revisão VERIFY, um evento F7 e um resultado idempotente por operação; a segunda perda não retorna falso sucesso. Maker, digest/CAS divergente, grant revogado, handle stale após avanço F5, MFA ausente/stale e DOCUMENT_READ revogado continuam recusados sem nova escrita/F7/result. Retry histórico mantém referências F11 originais inclusive após REVOKE. Protocolo Central recupera o resultado COMMITTED; não foi criado mecanismo paralelo.
- Gates `test/integration/f13/migration-gate.ps1`, `test/integration/f13p1/migration-gate.ps1` e `test/integration/f12/migration-gate.ps1`: **PASS**. F13/Central: 47 drift cases, duas drifts warm, seis corridas nas duas ordens, crashes/recovery e downgrade 007. F12: vazio e upgrades 003/004/005/006→012; F9 PostgreSQL **3/3 PASS**. Runner de populações mantém **011→012→011→012**, protected down recusado e mesmos pins canónicos abaixo.
- `node --check`: **123 JS PASS**; `git diff --check`: **PASS**. Scan de private/provider keys, URLs PostgreSQL e emails: zero novos candidatos; 19 referências URL preexistentes são fixtures sintéticas/templates loopback com segredo aleatório runtime; zero candidatos de email. Não é garantia universal de ausência de PII. Snapshot de 147 ficheiros confirma apenas seis alterações desta correção (loader/service, dois testes/gate e estes dois documentos); migrations, manifests/pins e trabalho não relacionado preservados. Sem commit/stage; cleanup somente dos recursos próprios dos gates.

**Estados e limites inalterados:** F13 In Progress; AC-13/15 PARTIAL, AC-14/16/17 PENDING; nenhum AC promovido. Catálogos editoriais e integração IdP externa/rollout continuam pendentes; sem lifecycle/publicação, activation, frontend ou matching. A revisão formal read-only foi repetida e o fecho humano restrito está registado acima.

## Fatia 8 — aprovação formal e implementação (2026-10-11)

**Aprovação humana explícita; fatia 8 em Review, não fechada.** Autoriza exclusivamente tenant `012_f13_territories_and_populations`, assertions ORG-only de território, beneficiário-alvo e população servida, com create/edit/read/submit/verify/reject/dispute/revoke. A proposta Draft abaixo passa a histórico, substituída pelos contratos aprovados nesta secção. Fatia 7 fechada; F13 In Progress; AC-13/15 PARTIAL, AC-14/16/17 PENDING e restantes estados inalterados. Sem stage/commit, reescrita de migrations anteriores ou Central 009.

Contratos: catálogo geográfico fechado/versionado com níveis definidos pelo catálogo, pertença global/tenant e releases SQL; coverage FULL/PARTIAL/UNSPECIFIED, sem percentagens/geometria/estimativas. Grupos-alvo são intenção de servir, não serviço demonstrado ou pessoas individuais. População servida contém contagem agregada declarada inteira >=0, métrica/unidade/counting basis fechados, período civil inclusivo ordenado, território/grupo associados explicitamente. Sem rácios, percentagens, denominadores, agregação ou deduplicação.

Categorias técnicas distintas TERRITORY, TARGET_GROUP e SERVED_POPULATION; referências many-to-many a conceitos/releases exatos, não produto cartesiano nem geração automática de outras assertions. Contagens usam representação textual canónica inteira para não perder precisão JavaScript. Conhecimento KNOWN deriva exclusivamente do conteúdo explicitamente declarado, inclusive zero; caller não escolhe identidade, autoridade ou estado epistemológico. Scope F13-P1 opcional é metadata ativa da organização autenticada resolvida server-side, não autoridade UNIT/TEAM. Conteúdo editorial, fontes geográficas concretas/níveis/grupos/unidades/counting basis/métodos/reasons/purposes não são inventados; catálogo vazio falha fechado.

Workflow restrito mantém DRAFT/edit, SUBMITTED, VERIFIED, REJECTED, DISPUTED e REVOKED, com EXPIRED derivado de valid_until no acesso. Verify/reject/revoke exigem MFA recente e maker-checker sobre subjects estáveis materiais/documentais; revoker independente do verifier conforme padrão restrito existente. Dispute tem grant próprio, reason e F7; leitura confidencial exige grant explícito, MFA e reason/purpose catalogados. F11 exige cumulativamente DOCUMENT_READ exato em leitura/verificação/replay, sem acesso implícito. F7/F10 não contêm contagens, geografia, grupos, documentos ou digests sensíveis. CAS, idempotência, histórico append-only, client físico F4 e coordinator/recovery Central existentes são obrigatórios.

Fora: mapas/geocoding/inferências, estimativas, dados individuais, thresholds/supressão inventados, agregações/rollups, eligibility/matching, publicação do perfil, snapshots/activation e frontend. Implementação e provas restritas concluídas conforme a evidência abaixo; nenhum AC promovido e fecho sujeito a revisão independente.

### Implementação e evidência restrita — fatia 8 (2026-10-11)

**Estado histórico pré-fecho: Review, pronta para revisão formal read-only. F13 permanece In Progress.** A aprovação dos contratos não representa aprovação de rollout ou de conteúdo editorial; prevalece agora o fecho restrito registado acima.

- Tenant 012 acrescenta oito tabelas: catálogo de releases/entries; referências geográficas com nível catalogado e conceito/scheme/release exatos; heads/revisões; associações territoriais/grupos por revisão; registo idempotente source-local. FORCE RLS em todas, catálogos globais SELECT-only, INSERT funcional e UPDATE apenas do head, histórico e associações append-only. Não há seeds produtivos.
- `TERRITORY`, `TARGET_GROUP` e `SERVED_POPULATION` são declarações independentes. Territórios aceitam FULL/PARTIAL/UNSPECIFIED sem dados espaciais ou percentagens. Populações requerem contagem textual canónica inteira >=0, NUMERIC gerado para validação SQL, métrica COUNT/unidade/counting basis publicados compatíveis e associações explícitas. Zero e valores acima da precisão inteira JavaScript são preservados. DATE é texto civil no acesso; EXPIRED é derivado, nunca persistido.
- Oito operações próprias `F13_POPULATION_CREATE|EDIT|READ|SUBMIT|VERIFY|REJECT|DISPUTE|REVOKE`, permissions `profile_population.<operation>`, resources POPULATION_SCOPE na criação e POPULATION_ASSERTION exato nas restantes. Esta matriz funcional comum às três categorias substitui a matriz candidata por domínio da proposta histórica; grants de outras features não concedem estes acessos e bundles continuam vazios. Read confidencial exige grant/MFA/reason/purpose; verify/reject/revoke exigem MFA recente e maker-checker material/documental, incluindo verifier na revogação. Dispute tem grant/reason próprios.
- Root produtivo expõe `profilePopulations` através da composição autenticada existente, não o transaction service. F3, capability/client físico F4, loaders, decisão F5 normalizada, F7, links e idempotência partilham a conexão preparada; authority coordinator/recovery Central existentes são consumidos sem alteração da Central 009. Replay recarrega a revisão originalmente auditada e reautoriza F3/F5/F11; COMMIT incerto usa a evidência idempotente tenant e reconciliação durável.
- F11 exige DOCUMENT_READ cumulativo/exato, tenant/binding AVAILABLE/CLEAN e authors estáveis; associação não autoriza nem copia documentos. F7 tem oito códigos críticos, incluindo leitura restrita, revisions e reason/purpose versionados server-side; digest de evento cobre apenas metadata técnica, não conteúdo. F10 limita labels a operation/resultClass. Sem contagens, geografias, grupos ou documentos no payload F7/F10.

**Pins canónicos tenant 012:**

- Up: `4f3972e42a292678b45e86d690aca7410155f17dee7fedfc275a88837c984cd8`
- Down: `1ff268c9a0b0502c93858ff14e5314fc8075f25e670b909d3732e610ab5b0396`
- Fingerprint: `0558700553db2170ee60565b92339f5556f603d4108c9273d476b960cb1460c3`

**Provas executadas nesta implementação:**

- `node --test test/f13TerritoriesAndPopulations.test.js`: **14/14**. Foco F3/F4/F5/F7/F13 através dos ficheiros `^f(3|4|5|7|13).*test.js`: **408/408**. `npm test` backend: **672/672**, zero failures/skips.
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/population-gate.ps1`: **PASS**, PostgreSQL 17 real, Central persistido + dois tenants, policy engine F5 real. Referências globais/tenant locais, foreign organization/release e tipo incompatíveis recusados, dois territórios/dois grupos materializados many-to-many e links SQL não declarados recusados. Três categorias distintas; coverage inválido/percentagem, contagem negativa/não inteira, períodos/scopes inválidos e catálogos incompatíveis recusados.
- Mesmo gate: precisão inteira/zero, datas UTC/Lisboa, CAS concorrente com um vencedor, replay concorrente sem duplicação, conflito de intenção, isolamento A/B, oito grants assimétricos e resource exato, erros uniformes sem grant, maker-checker/MFA ausente/stale, matriz de transições e expiração derivada. F11 indisponível/foreign/sem grant e replay após revogação documental falham; F7 falhado em todas as oito operações faz rollback de heads/revisions/links/idempotência/eventos. Eventos persistidos correspondem à decisão F5 e reason/purpose catalogados; F7/F10 não contêm o conteúdo sensível testado.
- Runner canónico **011→012→011→012**, ledger e fingerprints em ambos os estados, reaplicação idempotente, falha entre SQL/ledger com rollback e recusa de salto de downgrade. Down com dados protegidos recusado integralmente. Não descrever o capture SQL usado para calcular o pin como runner: a prova canónica é a execução posterior pelo runner.
- Gates `test/integration/f13/migration-gate.ps1`, `test/integration/f13/operational-gate.ps1`, `test/integration/f13p1/migration-gate.ps1` e `test/integration/f12/migration-gate.ps1`: **PASS**. F13/Central cobre 47 drift cases, corridas/recovery/commit incerto e downgrade 007; regressão 011 mantém os seus pins. F12 cobre instalação vazia e upgrades 003/004/005/006→012, fencing/isolamento/CAS/replay e executa **3/3 testes F9 PostgreSQL reais**.
- `node --check` nos **123 ficheiros JS** dirty/untracked: PASS; `git diff --check`: PASS. Scan regex de credenciais/PII: zero novos candidatos; três URLs sintéticos de testes preexistentes, ficheiros inalterados, e zero candidatos de email. Isto não constitui auditoria de produção ou garantia universal de ausência de PII.
- Hashes confirmam migrations anteriores, incluindo Central 009, intactas. Sem commit/stage. Cleanup limitado aos containers/volumes criados pelos próprios gates; recursos preexistentes preservados.

**Critérios e limites:** evidência restrita para AC-15 e transversais AC-01/02/04/05/09/11/12/18/20/21/22/24/25/26/27/28/29/30/31, somente nas partes descritas. **Nenhum AC promovido:** AC-13/15 PARTIAL; AC-14/16/17 PENDING; restantes estados inalterados. Catálogos editoriais/geográficos/taxonomias/fontes efetivamente aprovadas e sua governação produtiva continuam pendentes; fixtures sintéticas não são conteúdo aprovado. Sessão OIDC/provider/diretório são fixtures com persistência Central e residência PostgreSQL reais, não integração IdP externo/rollout/SLO. Sem geocoding/mapas, dados individuais, supressão inventada, agregações/rollups, eligibility/matching, publicação, snapshots/activation ou frontend. Fecho exige revisão independente e decisão humana.

## Proposta da fatia 8 — territórios, beneficiários e populações servidas (2026-10-11)

**Estado histórico: Draft, substituído pela aprovação humana acima.** A proposta e suas pendências abaixo preservam o momento anterior à aprovação; prevalecem os contratos aprovados e a evidência futura de implementação, sem inferir resultados. Numeração exclusivamente tenant: `012_f13_territories_and_populations`. Fatia 7 fechada; F13 In Progress e todos os estados dos critérios preservados.

### Objetivo e âmbito incluído

Representar declarações institucionais ORG-only sobre atuação territorial, grupos-alvo e populações efetivamente servidas, com identidade, temporalidade, proveniência e evidência reproduzíveis, sem executar elegibilidade ou inferir alcance.

- Assertions distintas, versionadas e tenant-local para território de atuação, beneficiário-alvo e população efetivamente servida. Uma declaração não cria nem verifica outra. Grupo-alvo não equivale a pessoa atendida, classificação jurídica da organização ou papel numa candidatura; quantidade não significa beneficiários únicos.
- Referências exatas a conceitos/schemes/releases geográficos e taxonomias aprovadas, IDs internos estáveis, catálogos publicados imutáveis e leitura global read-only. Códigos externos/labels não são identidade nem equivalência. Não criar geografias, grupos, mappings por label ou seeds produtivos; catálogo ausente/incompatível falha fechado.
- População efetivamente servida com quantidade explicitamente declarada, métrica/unidade aprovadas, período observado, proveniência e knowledge/verification definidos por contrato fechado. Ausência, UNKNOWN, NONE, NOT_APPLICABLE e zero não colapsam; as combinações admissíveis por domínio permanecem por aprovar. Verificação nunca é inferida de uma quantidade ou documento.
- Relações many-to-many explícitas e versionadas entre assertions territoriais, grupos e observações populacionais, ligadas a revisões exatas e à mesma organização. Nenhum produto cartesiano, rateio, soma, deduplicação ou atribuição de uma contagem a cada território/grupo é inferido. O significado de cada associação e do denominador será aprovado antes do código.
- `organization_id` exclusivamente da autoridade F3; `organizational_scope_id`, quando permitido, é referência F13-P1 carregada server-side, validando pertença/lifecycle. Continua metadata organizacional, não autoridade UNIT/TEAM, geografia ou coverage. Obrigatoriedade, cardinalidade e leitura histórica de scopes arquivados pendentes.
- Create/edit/read/submit/verify/reject/dispute/revoke com CAS/expected revision, histórico append-only e resultado idempotente source-local por organização/operação/key/digest. Replay da revisão originalmente auditada volta a autorizar F3/F5/F11 e a avaliar validade/projeção correntes.
- Referências exatas F11 com binding/tenant/estado validados server-side e grant cumulativo DOCUMENT_READ sobre o documento exato. Associação nunca concede acesso, copia ou reclassifica conteúdo; revogação documental impede exposição da referência/metadata em leitura, verificação e replay.
- Mesma conexão tenant F4 preparada para loaders, F5, mutação, F7 e idempotência, consumindo o authority coordinator Central e recovery durável de COMMIT incerto existentes. Identidade/correlation/assurance não são autoridade fornecida pelo caller. RLS/FORCE RLS, grants mínimos, rollback integral e fencing preservados.

### Exclusões

Geocoding, mapas, polígonos/GPS/cálculo espacial e inferência de territórios; expansão automática para ancestors/descendants; estimativas, deduplicação de beneficiários, pessoas identificadas/listas ou dados individuais; agregações/rollups e contagens derivadas; eligibility/matching/scoring; gestão editorial/admin completa ou imports/backfill legacy automáticos; classificação institucional completa da organização; aprovação/publicação do perfil, snapshots/activation e frontend. Scopes UNIT/TEAM como autoridade funcional ficam fora do recorte ORG-only.

### Contratos necessários e decisões pendentes

As decisões aprovadas `f13-territory-vocabulary`, `f13-beneficiary-vocabulary`, `f13-knowledge-state-policy`, `f13-confidentiality-projection-purpose` e `f13-authorization-and-segregation` são a base, não autorização desta implementação. A tenant 007 já suporta estruturalmente os schemes territoriais e SERVED_POPULATION_GROUP; o serviço produtivo de taxonomia entregue governa sobretudo THEMATIC_AREA/STRATEGIC_PRIORITY. A reutilização/extensão necessária deve ser delimitada e aprovada sem reescrever migrations fechadas.

1. **Fonte/versionamento geográfico:** escolher authorities/releases efetivamente aceites, proveniência, licenças, validade, processo editorial de admissão e compatibilidade histórica. ISO 3166, NUTS, LAU e CAOP continuam authorities distintas já previstas, não fontes selecionadas por esta proposta. Referências preservam authority/version/code; substituições não reescrevem história nem assertions. Sem conteúdo produtivo: somente suporte estrutural fechado e fixtures sintéticas, se explicitamente autorizado.
2. **Níveis territoriais:** aprovar o subconjunto dos schemes já previstos COUNTRY_TERRITORY, ADMINISTRATIVE_AREA, STATISTICAL_REGION e TRANSNATIONAL_AREA, granularidades e relações de perfil admitidas neste recorte. CUSTOM_AREA e TEAM continuam excluídos. Não equiparar OPERATIONAL_PRESENCE, DELIVERY_CAPABILITY, DEMONSTRATED_EXPERIENCE ou STRATEGIC_PRIORITY; experiência demonstrada exige ExperienceEvidence conforme decisão existente. Não selecionar todos os tipos por default.
3. **Coverage parcial:** decidir representação declarativa explícita, significado, limites e evidência; não interpretar um conceito territorial como cobertura integral nem inventar percentagens/áreas customizadas. Recomenda-se referências exatas sem inferência espacial; se a coverage parcial não puder ser fechada sem geometria/estimativas, mantê-la indisponível neste recorte, sujeita a aprovação.
4. **Grupos e métricas populacionais:** confirmar taxonomias/releases para beneficiários-alvo e população servida, reutilização de SERVED_POPULATION_GROUP e relação entre targeting e SERVES/STRATEGIC_PRIORITY. Não equiparar targeting a prioridade nem inventar um novo código. Aprovar definição de quantidade (pessoas, atendimentos ou outra unidade editorial), tipo numérico/precisão/limites, denominador, observação exata versus outros formatos e compatibilidade métrica/unidade. Nenhuma promessa de pessoas únicas ou threshold universal.
5. **Períodos/validade e estados:** aprovar datas civis inclusivas, regras de start/end, períodos das associações, valid_from/valid_until, expiração efetiva no acesso e quais knowledge states admitem ou proíbem quantidade/referências. Separar período observado de validade da verificação e lifecycle da assertion; nada é persistido por scheduler sem decisão própria.
6. **Confidencialidade/contagens pequenas:** aprovar policy versionada por grupo/métrica/operação, classe mínima, acesso exato e proteção de existência/metadata. Grupos vulneráveis/pequenas contagens requerem avaliação explícita; não copiar a decisão de ausência de thresholds operacionais para populações. Não inventar limites, bandas, arredondamento ou supressão. Recomenda-se leitura exata estritamente autorizada e fail-closed quando faltar policy; redaction, se indispensável, necessita contrato próprio que não crie agregações nem valores enganosos.
7. **Compatibilidade território/grupo/população:** definir relações many-to-many, cardinalidades, pertença, lifecycle/release, períodos compatíveis e tuples fechadas admitidas. Não fundir território/grupo num conceito composto nem criar equivalência por mapping. Overlap não permite soma nem prova disjunção; mudanças editoriais não reinterpretam observações anteriores.
8. **Operações, MFA, maker-checker e evidência:** aprovar matriz F5 por domínio/operação/resource exato, nomes finais, estados/transições, authors materiais incluídos na SoD, métodos/reasons/purposes publicados e schemas F7 sanitizados. Proposta: create/edit/submit com sessão válida; verify/reject/dispute/revoke com RECENT_MFA segundo F5; maker-checker para verify/reject/revoke, sem assumir que dispute exige independência. Read restrito exige RECENT_MFA + reason/purpose. Freshness e a independência face ao verificador na revogação devem ser confirmadas, não herdadas silenciosamente da fatia 7.

### Modelo, operações e transições propostas

Modelo lógico: heads próprios de assertions ORG-only → revisões append-only por domínio → associações many-to-many entre revisões exatas → referências F11 autorizadas e evidência de verificação → registos idempotentes source-local. As três categorias não partilham um campo ambíguo «beneficiário»; scope organizacional, território e grupo são referências distintas. Catálogos/métodos/reasons/purposes permanecem fechados/versionados, sem conteúdo editorial fictício.

Workflow candidato, **não aprovado**: create→DRAFT; edit DRAFT→nova DRAFT; submit DRAFT→SUBMITTED; verify SUBMITTED→VERIFIED; reject SUBMITTED→REJECTED; dispute VERIFIED→DISPUTED; revoke VERIFIED/DISPUTED→REVOKED; EXPIRED derivado no acesso, caso aprovada validade temporal. Transições inválidas falham antes de mutar. Combinações com knowledge/verification são específicas do domínio e não automáticas.

Cada uma das oito operações terá permission explícita por domínio, sem capacidades implícitas de edit/verify para reject/dispute/revoke; bundles continuam vazios. Proposta de resources: create sobre âmbito ORG autenticado; restantes sobre assertion exata e revisão carregada/bloqueada, validando todas as associações e scopes server-side. Uma permission num domínio não autoriza outro; alterações many-to-many não contornam grants nos extremos. Nomes finais/resources específicos e possibilidade de comando composto ainda dependem da matriz aprovada.

F7 crítico para cada mutação e leitura restrita, no mesmo commit tenant, com identidade/versões/assurance efetivas, revisions e reason/purpose server-side. Sem quantidades, labels/grupos/geografias sensíveis, documentos/PII/conteúdo ou digests sensíveis nos eventos; F10 somente operação/resultClass fechadas. Novos códigos técnicos só serão fechados após aprovação, não são seeds editoriais.

### Critérios afetados, dependências e riscos

- Evidência principal futura para **F13-AC-15** (territórios/beneficiários versionados sem equivalência implícita), **AC-18** (refs F13-P1) e **AC-20** (quantidade/knowledge); transversais AC-01/02/04/05/09/10/11/12/21/22/24/25/26/27/28/29/30/31. AC-14 apenas se houver referência a ExperienceEvidence, sem declarar cobertura integral. Não implementar AC-06/07/08/32 de publicação/activation/consumo F14 nesta fatia; nenhum critério promovido.
- Dependências: F3/F4/F5/F7/F10/F11, F13-P1 canónica, governação/catálogos tenant 007 e runtime/authoring/recovery existentes; catálogos e policies aprovados antes de aceitar dados produtivos. F12/UBI permanecem preserved/unmapped. Numeração Central independente; nenhuma alteração Central presumida. Compatibilidade, manifest/pins/preflight/fingerprint/runner só serão atualizados na futura implementação autorizada.
- Riscos: fontes/licenças e substituições geográficas; targeting confundido com serviço real/classificação institucional; grupos vulneráveis e reidentificação por contagens/metadata; dupla contagem/overlap; associações incompatíveis ou redistribuição implícita; histórico reinterpretado por catálogo novo; replay sem F11 corrente; scope usado para elevar autoridade; locks/CAS ou COMMIT incerto com duplicação. Mitigação exige contratos fechados, ausência de inferência, autorização/recovery confiáveis e provas reais.

### Testes PostgreSQL exigidos na futura implementação

- Central + dois tenants reais: isolamento A/B, RLS/FORCE RLS sem WHERE, catálogo global read-only e rejeição de conceitos/scopes/documentos/associações estrangeiros ou incompatíveis; IDs do caller nunca são autoridade.
- Catálogos/releases/schemes/níveis e tuples compatíveis; depreciação/versionamento preserva história; many-to-many usa versões exatas sem produto cartesiano/contagem derivada; targeting nunca cria serviço efetivo e ausência/UNKNOWN/NONE/zero permanecem distintos.
- Precisão/limites/unidades conforme aprovação, períodos/validade inválidos e expiração derivada; coverage parcial não é convertida em total; contagens pequenas/projeções, erros, existência e metadata seguem a policy aprovada, sem PII.
- CAS determinístico entre sessões, revisão única, append-only, replay/key concorrente por tenant/operação e conflito de intenção, incluindo mudança de associações; replay devolve revisão auditada com nova F3/F5/F11.
- Oito grants assimétricos por domínio/resource, alvo autorizado distinto do solicitado, maker-checker sobre subjects estáveis e material associado, MFA ausente/stale, policy/membership/grants revogados; nenhuma recusa persiste mutação/F7/idempotência.
- DOCUMENT_READ ausente, exato/estrangeiro/revogado, evidência indisponível e replay histórico após retirada da referência do head; ausência de acesso documental implícito; falhas F5/F11/F7 revertem integralmente revisões, associações, heads, audit e resultado.
- COMMIT confirmado/perdido/incerto, interrupção antes/depois do commit, recovery repetido e fencing, sem evento/resultado duplicado ou bypass de reautorização; F7 realmente persistido e F10 sem valores/referências sensíveis.
- Runner canónico **011→012→011→012**, instalação vazia e upgrades suportados; checksums up/down, ledger/revisão, fingerprint/preflight, rollback SQL→ledger, concorrência do runner e down seguro recusando perda de dados protegidos. Suite backend, testes focados, gates de regressão aplicáveis, node/diff checks e scans, cleanup somente de recursos próprios.

### Definição de conclusão e recomendação

Primeiro aprovar explicitamente âmbito, oito decisões acima e matriz de contratos/transições/F5/F7; só então passar o Draft a Ready e autorizar implementação. Conclusão futura exige tenant 012 aditiva pelo runner, contratos e runtime integrados, testes PostgreSQL e regressões PASS comprovados, pins/evidências documentados, revisão formal read-only sem findings materiais e decisão humana de fecho restrito. Catálogos produtivos ausentes não podem ser mascarados com fixtures; eventual entrega estrutural sem seeds deve ser explicitamente aceite e não alegar rollout/IdP externo/SLO nem AC integral PASS.

**Recomendação:** manter o recorte ORG-only e as três categorias separadas, mas **não avançar para código ainda**. Fechar sobretudo unidade/denominador, semântica de targeting/coverage parcial e proteção de pequenas contagens antes de aprovar; ajustar a coverage ou projeção apenas por decisão explícita, sem alargar para geometria, estimativas ou agregações. Esta ação é exclusivamente documental, sem migration/código/commit/stage nem alteração da especificação ou dos critérios.

## Fatia 7 — fecho formal restrito operacional ORG-only (2026-10-11)

Fatia **formalmente fechada no âmbito restrito operacional ORG-only**, por decisão humana explícita após revisão formal read-only sem findings materiais e com parecer «sem findings bloqueadores». Tenant `011_f13_operational_capacity` aditiva; migrations tenant anteriores e Central 009 não são reescritas. Roadmap reserva lifecycle/activation para migration posterior. Não há seeds produtivos, FX/scoring/rollups, partitions/coverage, inventário/RH, frontend ou matching.

### Decisão de fecho e evidência da revisão

O fecho abrange assertions operacionais ORG-only versionadas, quantidade exata, TOTAL/AVAILABLE independentes, localização canónica server-side, authoring/transições explícitas, CAS/idempotência/histórico append-only, runtime tenant confiável, F3/F4/F5/F7/F10, maker-checker/MFA, referências F11 reautorizadas e recovery de COMMIT incerto. EXPIRED permanece derivado no acesso, sem persistência ou scheduler. Não equivale ao cumprimento integral de AC-17 ORG|UNIT/rollups.

A revisão independente anterior repetiu com sucesso: testes operacionais **14/14**, focados F13/F3/F4/F5/F7 **418/418**, backend **658/658**, zero skips; gates PostgreSQL 17 operacional, F13/Central, F13-P1 e F12 **PASS**, F9 PostgreSQL **3/3 PASS**; runner **010→011→010→011 PASS**; `node --check` **112 JS PASS** e `git diff --check` **PASS**. F13/Central confirmou 47 drifts ACL, concorrência e recovery. Checksum/fingerprint 011 correspondem aos pins abaixo. Scans não identificaram credenciais/PII reais nos padrões examinados; não são garantia universal. Os 133 ficheiros dirty/untracked ficaram inalterados durante a revisão, o index vazio e os recursos descartáveis próprios foram removidos, preservando recursos preexistentes. Gates authoring/competency/financial na secção de entrega abaixo são evidência da implementação anterior, não novas execuções desta revisão.

Mantêm-se **F13 In Progress; AC-13/AC-15 PARTIAL; AC-14/AC-16/AC-17 PENDING; restantes estados inalterados**, sem promoção de qualquer AC integral a PASS. Catálogos editoriais produtivos, IdP externo, provider/diretório externos, rollout e SLO continuam pendentes. Scoring/agregações, tempo real, reservas/planeamento, colaboradores, territórios/beneficiários, lifecycle/aprovação/publicação do perfil, snapshots/activation, frontend e matching permanecem fora do âmbito fechado. Esta decisão não autoriza nem inicia outra fatia. Esta ação altera somente os dois documentos F13; não repete testes funcionais, modifica pins/código/migrations, arquiva a feature integral ou cria stage/commit.

### Contratos implementados

- Cinco tabelas próprias: operational_catalog_release/entry, operational_assertion/revision e operational_idempotency_record. Revisões/resultados/catálogos append-only, head CAS, FK head diferida e correspondência com max(revision); RLS/FORCE RLS e grants mínimos. Quantidade textual canónica gera NUMERIC(24,6), sem arredondamento; zero é KNOWN, não ausência. TOTAL/AVAILABLE independentes, sem par/unicidade/AVAILABLE<=TOTAL inferidos.
- Métricas reutilizam metric_definition publicada, versionada, com value_kind DECIMAL/INTEGER/COUNT e unit_code igual à unidade fechada publicada; métricas INTEGER/COUNT recusam fração. São tipos técnicos existentes, não indicadores/unidades editoriais novos. Catálogos próprios UNIT/METHOD/REASON/PURPOSE vazios fail-closed; fixtures explicitamente sintéticas.
- DATE civil textual em create/edit/read/replay, período inclusivo ordenado. Verify exige método e valid_from, valid_until opcional posterior; EXPIRED derivado em acesso/replay somente VERIFIED/DISPUTED após valid_until, sem scheduler/persistência.
- Localização opcional é scope F13-P1 ACTIVE da organização autenticada, nunca autoridade UNIT/TEAM/territorial. Função fechada `organizational_scope.load_operational_location`, owner NOLOGIN existente, SECURITY DEFINER/search_path fixo, valida app.organization_id, mutex F13-P1 e SHARE lock, devolve apenas scope_id. Nenhum UPDATE adicional em scope concedido ao runtime de perfil. SQL trigger e loader usam o mesmo contrato.
- Create→DRAFT, edit DRAFT→nova DRAFT, submit→SUBMITTED, verify SUBMITTED→VERIFIED, reject SUBMITTED→REJECTED, dispute VERIFIED→DISPUTED, revoke VERIFIED/DISPUTED→REVOKED. Verify/reject/revoke exigem MFA recente e subjects independentes dos autores/submissores/autores documentais; revoke também do verificador. Read/dispute sensíveis mantêm MFA normativo F5; reasons obrigatórios em reject/dispute/revoke, reason/purpose em read.
- F11: função fechada `load_operational_reference` confirma organization + OPERATIONAL_ASSERTION/assertion exata + AVAILABLE/CLEAN sob SHARE; engine real exige simultaneamente permission operacional e DOCUMENT_READ exato, incluindo replay histórico. Não há acesso à storage locator/conteúdo, classificação/cópia ou grant documental implícito.
- Root `profileOperational` consome handles OIDC opacos/F3 e authorityCoordinator Central existente, com F5/resources server-side e client F4 preparado. Inputs não recebem autoridade, correlation ou assurance; transaction service interno requer capability privada física e guard. Recovery durável aponta apenas para idempotência operacional na conexão tenant admitida.
- Locks: preparação F4 → advisory F13-P1 organization (também BEFORE STATEMENT em SQL runtime de heads/revisões) → intention org/op/key → assertion head → localização SHARE → documentos SHARE → guard Central → CAS/revision/F7/idempotência → fencing/permit/commit. Sem retry cego.
- Replay reautoriza F3/F5/F11 e devolve a revisão originalmente auditada, rederivando EXPIRED. Intenção vincula org/op/key/digest, inclusive role/location; resultado source-local só assertionId/revision/state. COMMIT incerto reconcilia evidência tenant pelo protocolo Central, sem duplicar F7/revisão; duas confirmações perdidas recusam sucesso público/handles.
- F7 oito eventos críticos source-local (sete mutações e leitura restrita), mesmos actor/membership/versões/policy/assurance da decisão efetiva e reason/purpose versionados server-side. Semantic digest só metadata de operação/revisão; sem digest de quantidade, unidades, documentos, localização ou conteúdo. F10 apenas operation/resultClass fechadas, sem IDs/valores.

### Operações/resources F5

| Operação | Permission | Resource server-side |
|---|---|---|
| F13_OPERATIONAL_CREATE | profile_operational.create | OPERATIONAL_SCOPE, organização autenticada |
| F13_OPERATIONAL_EDIT | profile_operational.edit | OPERATIONAL_ASSERTION, assertion exata |
| F13_OPERATIONAL_READ | profile_operational.read | OPERATIONAL_ASSERTION, revisão original no replay |
| F13_OPERATIONAL_SUBMIT | profile_operational.submit | OPERATIONAL_ASSERTION, assertion exata |
| F13_OPERATIONAL_VERIFY | profile_operational.verify | OPERATIONAL_ASSERTION, assertion exata |
| F13_OPERATIONAL_REJECT | profile_operational.reject | OPERATIONAL_ASSERTION, assertion exata |
| F13_OPERATIONAL_DISPUTE | profile_operational.dispute | OPERATIONAL_ASSERTION, assertion exata |
| F13_OPERATIONAL_REVOKE | profile_operational.revoke | OPERATIONAL_ASSERTION, assertion exata |

Scopes exclusivamente ORGANIZATION, profile bundles vazios e nenhuma permission implícita. F11 acrescenta DOCUMENT_READ sobre documento exato; não troca o recurso operacional pelo scope de localização.

### Evidência executada da fatia 7 (2026-10-11)

- `node --test backend/test/f13OperationalCapacity.test.js`: **14/14 PASS**. Focados F13/F3/F4/F5/F7: **418/418 PASS** (seleção dos ficheiros f13*, f4*, f5*, f7AppendOnlyAudit e security/f3*). `npm test` em backend: **658/658 PASS**, zero skipped.
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/operational-gate.ps1`: **PASS**, PostgreSQL 17, Central e duas bases tenant reais. Precisão 0/micro/máximo, períodos UTC/Lisbon/inverno/verão, métrica/unidade incompatível inclusive por SQL runtime, fração em COUNT recusada, contagem 1 explícita autorizada sem threshold; localização própria/arquivada/estrangeira/inexistente, TOTAL 0 e AVAILABLE 99 independentes; CAS e key concorrentes, conflito de intenção, isolamento A/B, todas as transições e oito grants assimétricos; maker/checker/revoker distintos, MFA ausente/stale, EXPIRED derivado inclusive no replay.
- F11 real: grant operacional sem DOCUMENT_READ, grant de outro documento/tenant, documento quarantined e revogação de DOCUMENT_READ recusam acesso/replay histórico, mesmo após remoção do documento do head corrente. Revisões/results append-only, órfão inválido no COMMIT, ausência de SELECT em locator F11/UPDATE em scope F13-P1. Falhas nas oito chamadas F7 revertem heads/revisões/resultados/eventos; F5/F11 recusados não deixam escrita funcional.
- F7 realmente persistido corresponde às decisões F5/assurance/policy e às versões/reason/purpose; eventos/results têm correspondência uma-para-uma, sem quantidade, unidade, documentId/versionId/localização/conteúdo sensível. F10 só operation/resultClass. Sem grant, existência, CAS/lifecycle e documento/localização indisponível devolvem a mesma recusa pública; CAS detalhado só é validado após F5, sob os locks existentes. Esta prova não é garantia universal de timing side channels.
- COMMIT perdido depois de COMMIT PostgreSQL real é reconciliado pela evidência operacional source-local; leitura/replay mantêm a revisão auditada, sem duplicar F7. Duas confirmações perdidas recusam falso sucesso/handles e recuperam uma única revisão/result. Interrupções reais de processo e corridas de autoridade são provas do protocolo comum no gate F13/Central, não crashes independentes específicos do authoring operacional.
- Runner canónico **010→011→010→011 PASS**, em ambos os tenants, com ledger/preflight/fingerprints. Falha SQL→ledger reverte o schema; segunda aplicação idempotente; down para versão arbitrária e down com dados protegidos recusados. Depois do down: 11 entradas efetivas no ledger e fingerprint 010 `876e01b28fb3617b464a4a85c8e8cc5a1e4f405e7e8678e07f1d0ddb12820eac`. Captura SQL preliminar foi apenas cálculo do pin, nunca declarada como runner.
- Repetição final do gate operacional com todos os ficheiros finais: **PASS**, incluindo CREATE e READ com a mesma key, duas entradas source-local por operação e resultados distintos, sem bypass de F5/F11. Validações de lifecycle/CAS/replay são posteriores à autorização, sem libertar os locks.
- Gates `test/integration/f13/migration-gate.ps1`, `authoring-gate.ps1`, `competency-gate.ps1`, `financial-gate.ps1`, `test/integration/f13p1/migration-gate.ps1` e `test/integration/f12/migration-gate.ps1`: **PASS** nesta execução. F13/Central inclui 47 drifts ACL/login dedicado limitado, seis corridas nas duas ordens, recovery/crashes, commit incerto e rollback tenant 007. F12 prova vazio e upgrades 003/004/005/006→011, 12 versões, rollback/drift/concorrência, identidade runtime/fencing e F9 PostgreSQL **3/3 PASS**. Gates de slices fechadas conservam os seus prefixes/pins; não são apresentados como testes completos desses domínios em 011.
- `node --check`: **112 JS PASS**; `git diff --check` e scan de whitespace de todos os 133 ficheiros dirty/untracked PASS. Scans de private/provider keys, atribuições de segredo, URLs PostgreSQL e emails: 22 ocorrências revistas são canários/valores de teste ou URLs loopback com passwords aleatórias calculadas em runtime; nenhuma credencial/PII real identificada nos padrões usados. Não constituem garantia universal.
- Snapshot prévio de 119 ficheiros preservado fora dos 29 ficheiros existentes integrados nesta fatia; 14 novos ficheiros. Dez ficheiros SQL anteriores dirty/untracked, incluindo Central 009 e tenant 007–010, têm SHA256 intacto; migrations anteriores tracked sem alteração e .vscode preservado. Sem stage/commit. Cleanup somente dos recursos Docker descartáveis próprios; nenhum recurso pré-existente é removido.

Execuções preliminares falharam: down clonado com policy inexistente, fixture com unidade incoerente, SQL do teste órfão incompleto e SHARE de localização sem UPDATE. Foram corrigidos no âmbito da 011/testes, sem conceder UPDATE de scopes. Também ocorreram recusas genéricas durante execuções operacionais/F13 preliminares concorrentes; não se atribui uma causa não comprovada. Gate F13 passou na repetição isolada e operacional nas repetições finais; nenhuma migration fechada foi modificada. Fixture MFA simula nova autenticação OIDC sintética entre grupos quando o gate extenso se aproxima da janela real de 300s; não refresca durante testes stale/ausente/corridas e não aumenta a policy produtiva.

### Pins finais da tenant 011

- Up: `1f07a21b145d23500cd7928272ee0be816f90688e41a5ba5024566732d6cfdbd`.
- Down: `26e6cf72c5f166eaa496dc8dff9221f1fb859bb5a180e74d97a76b89f39b871b`.
- Fingerprint: `884396f0858205d0c3098dc5b44fcc366664ef0af4238e69628c2e57cdb453ff`.

**Fatia 7 formalmente fechada no âmbito restrito aprovado, após revisão read-only e decisão humana.** F13 In Progress; AC-13/15 PARTIAL, AC-14/16/17 PENDING e restantes estados inalterados. Contratos estruturais implementados, catálogos editoriais produtivos/IdP externo/rollout/SLO ainda pendentes. Não se autoriza qualquer próxima fatia.

### Critérios e limites

Evidência restrita para AC-17 e transversais AC-01/02/04/05/09/11/12/20/21/22/24/25/30/31; AC-18 apenas referências canónicas. **F13 In Progress, AC-13/15 PARTIAL, AC-14/16/17 PENDING; restantes estados inalterados.** ORG|UNIT/rollups do AC-17 integral não estão implementados. Catálogos editoriais produtivos, IdP externo, provider/diretório externos, rollout e SLO permanecem pendentes; fixtures não os comprovam.

## F13 — Perfil Organizacional

### Identificação e estado

- **Estado:** `In Progress` — fatias 2/3/4/5/6/7 formalmente fechadas nos respetivos âmbitos restritos. Fatia 7 operacional ORG-only fechada após revisão read-only sem findings materiais e decisão humana explícita. AC-13/AC-15 PARTIAL, AC-14/AC-16/AC-17 PENDING e restantes estados inalterados; F13 integral incompleta.
- **Especificação:** `context/features/f13-organizational-profile.md`.
- **Objetivo:** entregar um perfil institucional tenant-local, versionado, autorizado, auditável e historicamente reproduzível para consumo futuro determinístico.
- **Acceptance criteria:** exatamente `F13-AC-01` a `F13-AC-32`; a matriz abaixo regista evidência `PARTIAL` ou `PENDING`; nenhum AC integral é promovido a `PASS` por este núcleo editorial.
- **Prerequisite:** F13-P1 está `Complete` e arquivada em `context/history/f13-p1-organizational-scope-foundation.md`; não foi reaberta.
- **Consumidores futuros:** F14 e F15 permanecem fora desta implementação.

## Fatia 7 — aprovação formal e contratos antes do código (2026-10-11)

A aprovação humana autoriza implementar somente capacidade operacional ORG-only com tenant `011_f13_operational_capacity`. Substitui o Draft da proposta, sem fechar esta fatia ou a F13 integral. Migrations anteriores permanecem intactas e numerações Central/tenant independentes.

Contratos: quantidade decimal exata NUMERIC(24,6) >= 0; métricas/unidades por catálogos publicados fechados, compatibilidade SQL, sem seeds produtivos; período civil inclusivo ordenado e DATE textual; TOTAL/AVAILABLE independentes, sem agregação ou AVAILABLE<=TOTAL implícito. Quantidade explicitamente fornecida produz knowledge KNOWN server-side, inclusive zero, nunca NONE inferido. Localização opcional usa apenas referência F13-P1 canónica ativa da mesma organização, resolvida server-side; não altera o scope Organization nem cria overlay/coverage territorial.

Workflow do recorte: create DRAFT, edit apenas DRAFT com nova revisão, submit SUBMITTED, verify SUBMITTED→VERIFIED, reject SUBMITTED→REJECTED, dispute VERIFIED→DISPUTED, revoke VERIFIED/DISPUTED→REVOKED. Verify/reject/revoke exigem MFA recente e maker-checker sobre stable subject dos autores materiais/evidência (na revogação também o verificador); dispute/reject/revoke exigem reason próprio. Read restrito exige grant operacional, MFA recente e reason/purpose catalogados. valid_from obrigatório em verify, valid_until opcional posterior; EXPIRED derivado no acesso, sem scheduler/escrita.

Oito operações/resources F5 próprios, sem permissões implícitas; F11 exige cumulativamente DOCUMENT_READ exato em todas as referências devolvidas/verification/replay. CAS e histórico append-only, intenção organization/operation/key/digest, replay da revisão originalmente auditada com nova F3/F5/F11, mesma conexão tenant preparada e guard/recovery Central durável. F7 crítico atómico, versões/assurance efetivas e reason/purpose versionados server-side; F7/F10 sem quantidades, documentos/localização sensível ou conteúdo. Catálogos vazios falham fechado; fixtures sintéticas não são seeds.

F13 In Progress; AC-13/15 PARTIAL, AC-14/16/17 PENDING; restantes critérios inalterados. Sem scoring, rollups/agregações, tempo real/reservas/RH, territórios/beneficiários, lifecycle/publicação do perfil, snapshots/activation, frontend ou matching. Esta secção documenta aprovação/contratos, não antecipa pins ou resultados de testes.
- **Última fatia concluída:** 7 — capacidade operacional ORG-only; tenant `011_f13_operational_capacity`. Fecho formal restrito registado após validação, revisão read-only e decisão humana. Nenhuma nova fatia ativa/autorizada; o próximo âmbito depende de proposta e aprovação explícitas.

### Resultado de `feature load`

F13 foi carregada como o único trabalho ativo a partir do template “Nenhum trabalho ativo”. A especificação foi reconciliada e aprovada como `Ready`; a autorização explícita de 2026-10-10 iniciou apenas a fatia vertical 1, sem migrations e sem provar automaticamente qualquer AC.

## Decisões normativas

Aplicam-se integralmente:

- `f13-organizational-profile-scope-and-inheritance` e `organizational-scope-foundation`;
- `f13-thematic-taxonomy`, `f13-competencies-and-experience`, `f13-financial-capacity` e `f13-operational-capacity`;
- `f13-territory-vocabulary` e `f13-beneficiary-vocabulary`;
- `f13-knowledge-state-policy`, `f13-exclusions-vs-f14-rules` e `f13-completion-policy`;
- `f13-versioning-and-activation`, `f13-authorization-and-segregation` e `f13-confidentiality-projection-purpose`;
- `f13-schema-policy-compatibility`;
- decisões F13-P1 de foundation, archive leaf-first e `stable_code`, apenas como contrato da dependência entregue.

Seeds, authorities, slots concretos, métodos, reason/purpose codes e schemas finais de findings/F7/F10 são conteúdo fechado de release a definir na implementação; não podem contrariar as decisões nem introduzir defaults.

## Reconciliação da F13-P1 entregue

### Contratos físicos reutilizados

| Contrato | Implementação real a consumir pela F13 |
|---|---|
| Schema de scopes | `organizational_scope.scope` e `organizational_scope.idempotency_record` |
| Identidade | `scope_id uuid`; organização em `organization_id uuid`; raiz Organization permanece em F3/Central |
| Tipos/parent | `UNIT|TEAM`; parent `NULL` representa raiz Organization; parent não nulo só referencia `UNIT`; Team não tem filhos |
| Lifecycle | `ACTIVE|ARCHIVED`; archive terminal e leaf-first; leitura histórica aceita archived, uso corrente não |
| Stable code | ASCII canónico 1–64, collation `C`, opcional, imutável e único por organização incluindo archived |
| FK disponível | unique `(organization_id, scope_id)`; F13 usa FK composta, nunca label ou stable code |
| Segurança SQL | roles `c4g_organizational_scope_owner|migrator|runtime`, RLS e FORCE RLS, `app.organization_id` obrigatório |
| F5 | operações `ORGANIZATIONAL_SCOPE_READ|CREATE|RENAME|REPARENT|ARCHIVE`; resource loader server-side exato |
| Transação | serviço standalone é owner; prepared service/repository recebem o mesmo client; sem transação aninhada |
| Participant | registry interno exige capability `F13_ORGANIZATIONAL_PROFILE` e participant compatível; ausência da capability é legítima |
| Migration/capability | `006_f13_p1_organizational_scope`; capability `F13_P1_ORGANIZATIONAL_SCOPE` |
| Compatibilidade | reads tenant 005/006, writes 006 no contrato atual; versões posteriores terão matriz explícita |
| Startup | manifest, checksum, fingerprint, capability, policies RLS/roles/grants e evidence ligada à pool são fail-closed |

### Boundary F13-P1/F13

1. Um scope F13 é `(organization_id, scope_type, scope_id?)`: `ORGANIZATION` usa a organização F3 e `scope_id=NULL`; `UNIT|TEAM` exigem `scope_id` canónico.
2. Tabelas F13 que referenciam Unit/Team usam FK composta `(organization_id, scope_id)` para `organizational_scope.scope`; não existe FK para a raiz Organization nem duplicação da organização.
3. O loader F13 consulta o scope pela organização confiável, confirma tipo e exige `ACTIVE` para Draft, publicação, materialização e ativação. Leitura histórica pode resolver `ARCHIVED` sem o tornar operacional.
4. Toda permission F13 declara apenas scopes exatos `ORGANIZATION|UNIT|TEAM` permitidos pelo domínio; `UNIT_SUBTREE` e herança Team→Unit são recusados estruturalmente.
5. Baseline `ORGANIZATION` é obrigatória. Overlay é opcional, exato, ligado a uma baseline publicada específica e nunca relaxa constraints herdadas.
6. A composição raiz cria o participant F13 e passa-o internamente ao `bindTenant` F13-P1. Não há import F13 dentro do módulo F13-P1 nem participant vindo do caller HTTP.
7. O participant recebe o mesmo client preparado e, antes do archive, bloqueia o pointer do scope, desativa o overlay ativo, cria activation record/F7 F13 e retorna `READY`. Qualquer falha reverte scope, pointer, activation e ambos os eventos críticos.
8. A capability `F13_ORGANIZATIONAL_PROFILE` só aparece na migration final F13 e exige schema, catálogos, preflight e participant compatíveis. Tenant em 006 continua com F13-P1 e sem efeitos F13.
9. As migrations F13 não alteram a migration 006 nem criam triggers/FKs de 006 para tabelas futuras. A integração é aditiva na release F13.

## Arquitetura de dados planeada

O schema tenant proposto é `organization_profile`, com roles owner/migrator/runtime próprias, RLS/FORCE RLS em todas as tabelas tenant-scoped, grants mínimos e sem `PUBLIC`. UUID é identidade; códigos e labels nunca substituem FKs.

### Núcleo e catálogos

- `profile_scope` fixa organização/scope canónico e a FK F13-P1 quando aplicável.
- `catalog_release`, `scheme`, `concept`, `concept_label`, `concept_relation` e `external_mapping` suportam releases globais read-only e tenant-local em namespaces distintos. Relations de taxonomia são DAG; territory containment permanece intra-scheme/release.
- `metric_catalog_release`, `metric_definition`, `band_policy` e `derivation_policy` conservam os contratos financeiro/operacional sem aceitar métricas do caller.
- `completion_policy`, `completion_slot` e `completion_rule` materializam policies fechadas por schema/scope/domain.
- `projection_policy`, `purpose_catalog_entry`, `reason_catalog_entry`, `compatibility_manifest` e `release_bundle` guardam versões/digests publicados e imutáveis.

### Authoring e conteúdo

- `profile_draft` é o objeto lógico; `profile_draft_revision` é append-only e usa expected revision/CAS; `profile_revision_item` liga uma revisão a item versions imutáveis.
- `profile_item_version` guarda o envelope comum — domain, scope, knowledge, verification, conflict, lifecycle, confidentiality, período e provenance — sem valor genérico livre.
- Child tables tipadas preservam constraints estruturais: thematic/priority assertions; competency assertions; experience evidence e many-to-many; financial facts; operational assertions/coverage/partitions; territory assertions; organization classifications; served-population assertions; e constraints `PROHIBITED|UNAVAILABLE`.
- Valores numéricos usam `numeric`, representação exact/range/band mutuamente exclusiva e FKs para metric/policy release. Conteúdo documental permanece referência F11, nunca blob ou verificação implícita.

### Publication, completion e activation

- `profile_version` referencia exatamente a revision aprovada, digest e atores; approval e publication são transições distintas e imutáveis.
- `completion_evaluation` e `completion_finding` guardam `COMPLETE|INCOMPLETE`, policy/input/result digests e findings ordenados.
- `effective_snapshot` e tabelas de snapshot tipadas materializam conteúdo interno, versões de catálogo/policy, origem baseline/overlay, `semantic_digest` e estado `READY`.
- `activation_cohort`, `activation_cohort_member`, `activation_record` e `scope_activation_pointer` suportam materialização prévia e pointer swap atómico. Índices parciais separam a baseline Organization do overlay Unit/Team e garantem unicidade.
- `projection_record` guarda somente projeções persistidas necessárias, policy/version e `projection_digest`; redaction nunca altera `semantic_digest`.
- `idempotency_record` F13 é append-only por organização/operação/key e conserva intention digest/result projection. Não se reutiliza o storage F13-P1.

O envelope comum não se torna JSON genérico: estados/catálogos ficam em colunas/FKs/checks; cada domínio tem child table própria; JSON canónico só é admitido para provenance ou payloads fechados cuja forma é validada antes de persistir.

## Plano de migrations tenant

Plano atualizado pela aprovação explícita das fatias 5/6/7: migrations anteriores permanecem intactas; tenant 010 entrega capacidade financeira ORG-only e tenant 011 capacidade operacional ORG-only. Lifecycle/activation usa migration posterior ainda não numerada/autorizada. As numerações Central e tenant são independentes; Central 009 não é alterada.

| Ordinal planeado | Boundary | Conteúdo principal | Capability |
|---|---|---|---|
| `007_f13_profile_catalogs_and_policies` | identidade semântica | schema/roles/RLS, profile scopes, taxonomias, métricas, completion/projection/reason/purpose e compatibility bundles | capability interna de preparação, sem servir F13 |
| `008_f13_profile_authoring_and_assertions` | edição tipada | drafts/revisions/items, child tables dos domínios, evidence links, constraints e idempotência editorial | capability interna de authoring, ainda sem ativação |
| `009_f13_competencies_and_experience` | competência e experiência | catálogos sem seeds, assertions/experience/link/verification versions, revision members e resultado source-local | `F13_COMPETENCIES_AND_EXPERIENCE`, sem activation |
| `010_f13_financial_capacity` | financeiro ORG-only | catálogos sem seeds, assertions/head/revisões/idempotência, decimal exato e referências F11 protegidas | `F13_FINANCIAL_CAPACITY`, sem lifecycle do perfil |
| `011_f13_operational_capacity` | operacional ORG-only | catálogos sem seeds, assertions/head/revisões/idempotência, quantidade exata, localização F13-P1 e referências F11 protegidas | `F13_OPERATIONAL_CAPACITY`, sem lifecycle do perfil |
| Posterior, por aprovar | lifecycle/activation | approval/publication, completion results, snapshots, cohorts, pointers, activation, projections e participant F13-P1 | `F13_ORGANIZATIONAL_PROFILE` |

Cada migration é aditiva, não contém `BEGIN|COMMIT|ROLLBACK` nem settings transacionais, atualiza manifest/checksum/fingerprint/postflight e tem down conservador que recusa dados ou dependências. Não há backfill F12/UBI. O upgrade suportado é 006→007→008→009→010→011; instalações vazias e prefixes 003/004/005/006 convergem pelo runner. As operações anteriores têm matrizes explícitas até 011, evitando que o avanço do schema quebre features anteriores. `expand → migrate → contract` mantém qualquer remoção para feature posterior.

## Plano ordenado por fatias verticais

| # | Fatia | Dados e contratos | Services/F5/F7/F10 | Provas e AC |
|---:|---|---|---|---|
| 1 | Contratos e catálogo estrutural | enums fechados, envelope epistemológico, canonical JSON/digests, catálogo inicial F13 | adapters puros; zero persistence | unit/property/adversarial; AC-03,05,20,30 |
| 2 | Migration 007 e startup | roles, RLS, releases/policies/bundles, manifest/fingerprint/preflight | catálogos F5/F7 preparados; startup fail-closed | PG manifest/drift/N/N-1; AC-01,02,26–28 |
| 3 | Taxonomias/releases | schemes/concepts/labels/DAG/mappings | local concept create/approve/publish; F7/F10 fechados | graph, cycles, immutable release; AC-13,15 |
| 4 | Migration 008 e authoring core | profile_scope, draft/revision/item/idempotency | create/edit/submit, CAS e prepared client | unit+PG+commit uncertainty; AC-04,05,10–12,18 |
| 5 | Competências/experiência | competency/evidence/link child tables | attach/read/verify com SoD e F11 port | PG many-to-many e negative auto-verify; AC-14 |
| 6 | Capacidade financeira autorizada | tenant 010, montante exato NUMERIC(24,6), catálogos vazios, ORG-only | oito operações F5, CAS/replay, verificação/rejeição/disputa/revogação; sem bandas/derivações | decimal/period/security/PG/recovery; AC-16 e contratos transversais |
| 7 | Capacidade operacional autorizada | tenant 011, assertions ORG-only, quantidade exata, TOTAL/AVAILABLE independentes e localização F13-P1 | oito operações F5, CAS/replay/F11, sem coverage/partitions/rollup | precisão/scopes/security/PG/recovery; evidência restrita AC-17,18 |
| 8 | Territórios e beneficiários | territory/classification/served-population assertions | exact scope loaders e evidence rules | scheme/release/mapping tests; AC-15,18 |
| 9 | Constraints e estados | `PROHIBITED|UNAVAILABLE`, typed operands, conflict/versioning | dispute/resolve/revoke; sem evaluator F14 | structural source guards+PG; AC-19,20,30 |
| 10 | Approval e publication | profile_version, immutable approval digest | approve/reject/publish, stable human SoD/MFA | maker-checker/stale approval; AC-06,09,12,21,22 |
| 11 | Completion | evaluation/findings/digests | deterministic evaluator over internal content | fixed corpus/property/state matrix; AC-20,29,32 |
| 12 | Migration posterior e snapshots | effective snapshots tipados e release tuple | synchronous materializer, no F9 | replay/fault injection; AC-07,11,23,29,32 |
| 13 | Cohort activation | cohort/member/pointer/activation records | activate/deactivate/rollback/archive, atomic cutover | PG sessions/CAS/pointer faults; AC-07–11,29,32 |
| 14 | Confidentiality/projection/export | classifications/projection records/reclassification version | exact/derived/redacted/omitted, purpose/reason, full/redacted export | side-channel and authorization matrix; AC-02,21,24,25 |
| 15 | Participant F13-P1 | pointer deactivation + activation record in same transaction | participant `F13_ORGANIZATIONAL_PROFILE`, root composition only | archive rollback/same client/capability; AC-18,22,29 |
| 16 | Compatibility e gates integrados | final bundles/adapters/capability evidence | API workload, startup parity, cumulative regressions | PG17 full gate and all 32 AC; AC-26–32 |

Cada fatia inclui repository com client preparado, application service, contracts fechados, autorização antes do efeito, F7 crítico source-local, F10 de baixa cardinalidade e testes unitários/PG proporcionais. HTTP/UI não são inventados; a primeira entrega expõe services e tenant operations internas.

### Próxima fatia proposta — 5: competências, experiência e evidências (2026-10-11)

**Estado do plano: aprovado explicitamente pelo utilizador; fatia 5 In Progress (2026-10-11).** Autorizada tenant `009_f13_competencies_and_experience`, sem alterar tenant 008 ou Central 009; lifecycle/activation reservados para migration tenant posterior. F13 permanece In Progress, fatias 2/3/4 fechadas, todos os estados de AC inalterados e AC-13/AC-15 PARTIAL. Conteúdo editorial não aprovado não pode ser inventado.

**Objetivo:** implementar a linha 5 do plano, distinguindo CompetencyConcept, CompetencyAssertion e ExperienceEvidence, com relações many-to-many explícitas/versionadas, autoria institucional e verificação humana governada. Reutilizar o núcleo editorial fechado, sem antecipar approval/publication de perfis.

**Evidência e dependências:** decisão aprovada `f13-competencies-and-experience`, catálogo estrutural F13 e contratos F5 de `F13_EVIDENCE_ATTACH`, `F13_EVIDENCE_LINK_READ` e `F13_COMPETENCY_VERIFY`; authoring produtivo F3/F4/F5, coordinator Central, F7 e F10 das fatias fechadas. Atualmente authoring aceita somente THEMATIC_AREA/STRATEGIC_PRIORITY; tenant 008 tem cinco tabelas editoriais e não possui storage de competências/experiência/frameworks/métodos. O catálogo estrutural não é prova de integração produtiva dessas operações. Referências documentais reutilizam F11, sem dar acesso implícito a conteúdo.

**Incluído na proposta:**

- Storage tenant-local append-only para versões de assertions, experiências institucionais e ligações many-to-many; referências exatas a concept/catalog release/framework version e nível opcional validado no framework. ORG/UNIT/TEAM apenas nos scopes já admitidos, sempre resolvidos no servidor. Correções criam versões e preservam histórico.
- Authoring das declarações/experiências sobre draft DRAFT, expected revision/CAS e digest da intenção; integração explícita nos digests/revisions e submit, sem alterar revisions/resultados idempotentes antigos. A extensão deve ser versionada: comandos temáticos existentes não podem apagar silenciosamente material de outro domínio; substituição/remoção é explícita para o domínio autorizado.
- Attach e leitura autorizada de metadata das ligações; ligação fixa versões exatas de assertion/experiência e, quando documental, document version F11 do mesmo tenant com binding/estado CLEAN válidos. A leitura do conteúdo continua a exigir F11 separado; sem URLs, tokens, conteúdo documental ou dados pessoais copiados para F13/F7.
- Verificação explícita com F5 próprio, RECENT_MFA normalizado, stable human maker-checker sobre todos os sujeitos que criaram/submeteram/alteraram materialmente assertion/evidência, método fechado e provenance/verified_at/validade. Não mutar o item UNVERIFIED histórico: persistir evidência/resultado de verificação versionado. Documento/projeto/ligação nunca produz VERIFIED automaticamente; metadata de scan CLEAN não equivale a verificação institucional.
- Catálogos fechados/versionados para competências/frameworks/níveis, tipos de experiência e métodos de verificação; referencias ausentes, desconhecidas, incompatíveis ou não publicadas falham fechado. Esta proposta não escolhe seeds, códigos, licenças ou horizontes produtivos: fixtures sintéticos podem provar o mecanismo, não disponibilidade editorial produtiva. Escrita global/editorial, imports ESCO e APIs de administração destes catálogos ficam fora; entrada produtiva depende de conteúdo aprovado pela autoridade editorial própria.
- Composição confiável existente, mesma conexão tenant preparada, guard durável Central, fencing físico e ordem única de locks; F5 positivo por operação/recurso, bundles vazios, F7 crítico source-local para toda mutação, F10 fechado, idempotência/replay reautorizado e recovery de COMMIT incerto. Acesso a metadata F11 não pode usar pool própria, autoridade do caller ou bypass de F5.

**Fora:** aprovação/rejeição/publicação de perfis, snapshots/activation/cohort/pointers, completion integral, financeiro/operacional/territórios/beneficiários/constraints, dispute/resolve/revoke/expiration jobs completos, frontend/HTTP novo, matching/F14, imports/backfill UBI/F12, dados pessoais e conteúdo editorial produtivo não aprovado. Não habilitar a capability integral `F13_ORGANIZATIONAL_PROFILE` nem o participant F13-P1 completo só por esta fatia.

**Alteração de roadmap aprovada:** não reescrever migrations fechadas 007/008 nem Central 009. Usar `009_f13_competencies_and_experience` tenant, aditiva, para os novos objetos/constraints/ACLs/eventos e integração editorial; separar explicitamente da Central 009. A antiga reserva tenant `009_f13_profile_lifecycle_and_activation` passa a numeração posterior, a definir no plano dessa entrega. A tabela histórica de migrations acima permanece como plano original, não autorização para reaproveitar/reescrever 008. Down conservador não pode eliminar dados, e SQL direto não conta como runner canónico.

#### Contrato mínimo fechado antes da implementação

- Tipos estruturais: `COMPETENCY_ASSERTION` referencia concept de release de competências e nível opcional do mesmo framework; `EXPERIENCE_EVIDENCE` referencia tipo de experiência de catálogo publicado. Não são códigos editoriais nem tipos de projeto/contrato inventados. Catálogo de competências/frameworks/níveis, tipos de experiência e métodos de verificação usa identidades/versionamento próprios, separado dos schemes temáticos 007.
- Material editorial: versões imutáveis, membership exata por draft/revision e scope; knowledge KNOWN/UNKNOWN explícito, UNVERIFIED inicial, CLEAR/DRAFT/INTERNAL. Nova versão cria novo UUID; não altera uma versão anterior. Correção não herda VERIFIED. Submit preserva material e sela a revision; não aprova/publica perfil.
- Experiência e competência relacionam-se por links many-to-many versionados, com referências a versões exatas do mesmo tenant/scope/revision. Document version F11 opcional pertence ao mesmo tenant, AVAILABLE/CLEAN e binding atual autorizado; não concede download/read/content capability.
- Verificação é um registo append-only separado do material original, ligado a assertion e evidências exatas; UNVERIFIED→VERIFIED somente por operação explícita com método de catálogo publicado, provenance e tempo do servidor. Validade tem de obedecer ao método versionado, não a default livre. Dispute/revoke/expire completos ficam fora; os estados estruturais não autorizam transições não implementadas.
- F5: authoring usa permissões de draft create/edit/submit existentes, sem capacidades implícitas; attach=`F13_EVIDENCE_ATTACH`/ASSERTION, read=`F13_EVIDENCE_LINK_READ`/EVIDENCE_LINK, verify=`F13_COMPETENCY_VERIFY`/COMPETENCY_ASSERTION. ORG/UNIT/TEAM exatos; F11 document.read separado quando a referência documental for utilizada. Resource/tenant/scope/identidade/correlation/assurance são server-side.
- MFA normal nas edições/attach/read; RECENT_MFA de F5 real na verificação. Verificador distinto de todos os sujeitos humanos que criaram/submeteram/alteraram materialmente assertion ou evidência usada; múltiplas sessões não alteram a identidade estável. F3/F5 e todas as permissões utilizadas são protegidas pelo authority guard até commit/recovery.
- F7 crítico: revision editorial=`PROFILE_DRAFT_REVISION_CREATED`; attach=`EVIDENCE_ATTACHED`; verify=`COMPETENCY_ASSERTION_VERIFIED`; metadata read=`EVIDENCE_LINK_ACCESSED`. Mesma transação/client, evidence normalizada F5, versões/digests/correlation/key; sem conteúdo/PII/URL/token. F10 apenas códigos fechados.
- Catálogos produtivos começam vazios: nenhum seed, tipo de experiência, concept/framework/nível ou método/validade produtivo aprovado foi identificado. Ausência de catálogo publicado válido recusa o uso; fixtures sintéticos apenas em testes descartáveis, sem backfill/ESCO/import/editorial APIs. Suporte estrutural não é evidência de readiness editorial produtiva.
- Migration tenant 009 aditiva, RLS/FORCE RLS, ACLs mínimas/fingerprint exato, up/down pelo contrato do runner; down recusa conteúdo protegido e não é apresentado como downgrade canónico sem prova. Tenant 008 e Central 009 intactas. Critérios não promovidos antes das provas reais.

**Plano de execução após aprovação:** (1) fechar contratos versionados e esquema de catálogos/assertions/evidências/verification, com matriz de loaders/permissões/SoD/F11 e estados; (2) adicionar a migration aprovada via runner, manifest/checksums/fingerprint/preflight/RLS/ACLs e matrizes F12/F13-P1/taxonomia/authoring; (3) integrar authoring e metadata F11 na composição existente, fonte idempotente e recovery em mapa fechado; (4) implementar attach/read/verify produtivos, com auditoria e telemetria; (5) executar provas reais e atualizar apenas evidência demonstrada; (6) revisão formal read-only antes de qualquer fecho. Nenhum método/tipo inline ou catálogo vazio deve gerar um default permissivo.

**Provas de saída exigidas:** PostgreSQL 17 Central + dois tenants, engine F5 real e F7 persistido; many-to-many com versões exatas; ausência de auto-verificação; framework/nível/método/release incompatíveis recusados; referências F11 cross-tenant, não CLEAN, binding divergente ou não autorizadas recusadas; maker-checker multi-sessão e múltiplos autores; revogação/MFA stale/versões stale sem efeitos; CAS concorrente, replay/conflicto de intenção e COMMIT incerto; imutabilidade de histórico; rollback integral por falha F5/F7/guard/fence; zero mutação/F7/idempotência quando a autoridade vence a corrida. Exigir upgrades 008→nova migration e prefixes suportados, atomicidade schema/ledger, ACL drift fail-closed e down conservador conforme contrato do runner. Regressão dos gates F13/F13-P1/F12/Central/F9 PostgreSQL, focados F3/F4/F5/F7/F11/F13, suite backend, node --check, diff check e scans; cleanup apenas dos recursos próprios. Provas futuras, não resultados já obtidos.

**Rastreabilidade:** AC-14 é o alvo funcional; AC-01/02/04/05/09/10/11/12/18/20/21/22/24/25/26/27/28/29/30/31 recebem apenas a evidência efetivamente demonstrada. AC-13/AC-15 mantêm PARTIAL; nenhum AC muda de estado neste planeamento, e approval/snapshots/consumer READY não são demonstrados por esta fatia. Limites de IdP externo, rollout, SLO, recovery operacional, chaves e retention preservados. Nenhum commit/stage ou alteração de código/migration.

## Lifecycle, atomicidade e completion

- Cada edit cria revision imutável; expected revision e idempotency key+intent digest são obrigatórios. Replay reautoriza e devolve o resultado persistido; key divergente conflita.
- Approval congela uma revision e cria `profile_version`; o autor não aprova. Publish apenas torna a version elegível.
- Completion é avaliada sobre conteúdo interno com policies por schema/scope/domain e resultado binário. Findings são ordenados por `(domain, slot, rule_code, source_kind, source_id)` e digestados com policy/input/result.
- `WITHHELD` é projection, não knowledge. `DISPUTED|CONFLICTED|REVOKED|EXPIRED` não satisfazem slot corrente obrigatório; `VERIFIED` só é exigido por policy.
- Materialização síncrona cria todos os snapshots da coorte e só os marca `READY` depois de referências, completion e tuple integral passarem.
- O cutover bloqueia pointers em ordem canónica, troca baseline e overlays incluídos e desativa omitidos numa única transação. Falha F5/F7/completion/participant/pointer reverte tudo.
- Rollback é nova activation; archive é lógico; nenhuma tabela histórica aceita delete físico. Commit incerto reconcilia por idempotency/activation records e nunca repete automaticamente outcome duvidoso.

## Segurança e catálogo F5/F7

O catálogo F13 v1 contém as **29 operações-base** aprovadas, sem alteração de semântica: profile read/create/edit/submit/approve/reject/publish/activate/deactivate/rollback/archive/restore; taxonomy read/local-create/local-approve/release-publish; metric read/admin; evidence link-read/attach; competency/financial/operational verify; assertion dispute/resolve/revoke; restricted read; full/redacted export.

A 30.ª operação obrigatória é planeada como `F13_PROFILE_CONFIDENTIALITY_RECLASSIFY`, permission `organization_profile.confidentiality.reclassify`, resource `PROFILE_DATA_CLASSIFICATION`, WRITE, scopes exatos admitidos pelo item, sensitive, maker-checker, `RECENT_MFA`, reason obrigatório e evento `PROFILE_CONFIDENTIALITY_RECLASSIFIED`. O nome fica fixado no catálogo da primeira fatia e qualquer incompatibilidade descoberta antes de persistência volta a decisão; não pode ser fundida com edit/archive.

- Os quatro perfis F5 continuam bundles vazios por default; grants são positivos e explícitos.
- O loader resolve Organization pelo contexto F3 e Unit/Team por `organizational_scope.scope`; depois resolve o recurso F13 e a classificação efetiva. Caller não fornece authority, scope, ownership, state, policy ou classification confiáveis.
- `UNIT_SUBTREE` permanece no catálogo transversal legado F5, mas é proibido em todas as permissions/operations F13 e coberto por guard estrutural.
- Stable human subject, membership/auth versions, SoD e assurance são revalidados no comando e novamente no cutover. Service actors não executam atos humanos sensíveis.
- Eventos F7 F13 são adicionados ao catálogo/constraints pelas migrations que introduzem o respetivo efeito. Evento funcional crítico e mutação usam o mesmo client; eventos de decisão F5 permanecem separados. Payloads excluem conteúdo, valores, documentos, PII e digests sensíveis.
- F10 usa apenas operation/result/domain/error-class fechados; não inclui tenant, actor, resource, labels livres ou valores.

## Compatibility, F9 e upgrade

- `CompatibilityManifest` e `release_bundle` enumeram tuples exatas de profile schema, snapshot schema, policies, catalogs, operations, F7 schemas, adapters e future consumer contract. Não há produto cartesiano.
- Writer emite somente o bundle corrente. O primeiro release F13 contém apenas o bundle N; tenant 006 sem capability é reconhecido como “F13 não instalado”, não como snapshot N-1. O release F13 seguinte terá de declarar explicitamente N/N-1 e adapter puro em memória.
- Reads históricos nunca fazem write-on-read. N-2, versão futura, tuple ausente ou digest divergente falham fechado.
- API e eventual worker validam o mesmo manifest/capabilities. As tenant operations F13 v1 são API/síncronas; activation/materialization/export bounded não criam job.
- **F9 não é usado na v1.** Se um limite medido exigir async, uma decisão posterior define job/payload tuple, outbox, handler, retry/replay e estados intermédios; não se copia o registry F9 que valida versões independentemente.
- Startup valida ledger, fingerprints, policies RLS/roles/grants, catalogs, release bundles, adapters e participant. Software rollback só serve se o binário anterior suportar o schema instalado; não há downgrade destrutivo.

## Matriz F13-AC → implementação e prova

| AC | Implementação planeada | Prova principal | Estado |
|---|---|---|---|
| F13-AC-01 | schema/roles/RLS tenant `organization_profile` | PG residence/role probes | PARTIAL — schema/roles e 21 tabelas com RLS/FORCE RLS provados; domínios 008–009 ausentes |
| F13-AC-02 | RLS, exact loaders e projections | PG A/B read/write/activate/export/inference | PARTIAL — isolamento estrutural e ausência de grants provados; loaders/projections futuros |
| F13-AC-03 | catalogs sem professor/faculdade/UBI | structural/source guard | PARTIAL — catálogo estrutural da fatia 1 coberto por unit test; integração futura não provada |
| F13-AC-04 | draft revisions append-only | unit + PG history | PENDING |
| F13-AC-05 | contracts/enums/catalogs fechados | adversarial/property/startup | PARTIAL — contratos, SQL 007 e startup fail-closed provados; restantes domínios futuros |
| F13-AC-06 | approval/version/digest imutáveis | PG trigger/constraint | PENDING |
| F13-AC-07 | publish separado e pre-cutover READY | vertical PG fault injection | PENDING |
| F13-AC-08 | partial unique pointers e omit de overlays | PG concurrency/cohort | PENDING |
| F13-AC-09 | append-only history/activation | PG supersede/archive/rollback | PENDING |
| F13-AC-10 | CAS, advisory/row lock order | duas sessões PG | PENDING |
| F13-AC-11 | canonical digest/idempotency/commit uncertainty | PG post-COMMIT fault | PENDING |
| F13-AC-12 | trusted actor/provenance/versions | F3/F5/F7 integration | PENDING |
| F13-AC-13 | schemes/releases/DAG/mappings | graph property + PG cycle probes | PARTIAL — governação tenant-local, F5/F7/F10, DAG, ciclos, concorrência, publicação e imutabilidade provados; seeds/governação global editorial permanecem futuros |
| F13-AC-14 | competency/evidence/link/verification | unit + PG + F11 negative | PENDING |
| F13-AC-15 | territory/beneficiary typed schemes | contract + PG mappings | PARTIAL — storage versionado e mappings explícitos/fechados provados, incluindo recusa de `OVERLAPS` temático; assertions territoriais/beneficiários e mappings concretos permanecem pendentes |
| F13-AC-16 | ORG-only financial facts | numeric/period/RLS tests | PENDING |
| F13-AC-17 | ORG|UNIT operational rollup | disjointness property + PG | PENDING |
| F13-AC-18 | composite FK + active exact loader | F13-P1 integration/archive | PARTIAL — FK composta `profile_scope` provada; loader/participant futuros |
| F13-AC-19 | typed closed constraints, no DSL | contract/PG/source guard | PENDING |
| F13-AC-20 | state envelope + binary completion | state corpus/property/PG | PARTIAL — envelope estrutural corrigido e coberto; completion e integração persistente permanecem por provar noutras fatias |
| F13-AC-21 | 33 ops, grants, SoD, MFA | catalog/startup/decision matrix | PENDING |
| F13-AC-22 | mutation + F7 same transaction | PG rollback/payload scan | PENDING |
| F13-AC-23 | no F9 in synchronous lifecycle | import/catalog guard | PENDING |
| F13-AC-24 | low-cardinality telemetry | metric/span allowlist tests | PENDING |
| F13-AC-25 | uniform IDOR and RLS without caller filters | PG A/B + query spies | PARTIAL — RLS fail-closed e zero grants funcionais provados; paths IDOR futuros |
| F13-AC-26 | ordinals 007–009 via manifest/runner | structural + PG postflight | PARTIAL — ordinal 007/manifest/fingerprint/preflight provados; 008–009 pendentes |
| F13-AC-27 | prefixes upgrade without inferred backfill | PG 003/004/005/006→009 | PARTIAL — vazio/003/004/005/006→007 provados sem backfill; 008–009 pendentes |
| F13-AC-28 | canonical disposable PG17 gate | constraints/RLS/races/faults | PARTIAL — gate 007 real aprovado; gates dos domínios/lifecycle pendentes |
| F13-AC-29 | SQL→ledger and snapshot→cutover atomicity | fault injection/commit uncertainty | PARTIAL — runner rollback/retry/commit incerto provados; snapshot→cutover pendente |
| F13-AC-30 | no match/score/eligibility/lexical inference | source/import guard | PARTIAL — namespace novo sem esses conceitos; guard cumulativo futuro pendente |
| F13-AC-31 | cumulative F4–F13-P1 regressions | backend suite, F12/F13-P1 gates, checks | PARTIAL — 591/591 e gates F12/F13-P1 verdes nesta fatia; regressão final pendente |
| F13-AC-32 | READY snapshot + exact tuple for consumer | vertical replay/history corpus | PARTIAL — manifest/bundle storage e tuple estrutural fechados; READY/consumer futuro |

## Gates planeados

1. Unitários por fatia, fixed corpus e property tests de canonicalização, states, DAG, completion e digests.
2. PostgreSQL 17 descartável através do runner: vazio e prefixes 003/004/005/006→009, segunda execução, down vazio, drift/gap/fingerprint, SQL→ledger e commit incerto.
3. RLS A/B com LOGIN runtime real, IDOR uniforme, grants assimétricos, scope lifecycle e participant F13-P1 no mesmo client.
4. Concorrência real: draft CAS, DAG cycles, publication, completion, cohort cutover, pointers, retries e archive versus activation.
5. F5/SoD/MFA, F7 source-local/deny, F10 allowlists e scans de side channels/secrets/PII.
6. Compatibility corpus: N, N-1 quando existir, N-2/future/cross-tuple recusados, adapters puros e ausência de mutation-on-read.
7. Gates cumulativos F12 e F13-P1, suite backend completa sem `.env`, `DATABASE_URL` ou `DB_*`, `node --check` nos JavaScript alterados e `git diff --check`.
8. Benchmark local de materialização/coorte apenas como baseline, nunca SLO; exceder limite não autoriza async.

## Riscos, detalhes e itens deferred

### Riscos a controlar na implementação

- Volume transacional de materialização/coorte: medir e manter síncrono; qualquer mudança para F9 exige decisão.
- Crescimento do catálogo/event schema: migrations devem manter down conservador e compatibilidade cumulativa de F12/F13-P1.
- Side channels em counts, existence, ordering, digest e export: usar a mesma projection policy em todos os canais.
- Combinações inválidas do envelope comum: child tables/checks/policies devem impedir que flexibilidade vire JSON não governado.
- Root composition do participant: declarar capability apenas quando a composição puder instalar participant e todos os catalogs; sem fallback.

### Detalhes de implementação, não blockers

- nomes finais de índices/constraints e códigos públicos de erro;
- seeds, authorities, jurisdictions, methods, horizons, FTE, coverage/partitions e slots concretos;
- reason/purpose codes finais e schemas exatos de F7/F10/findings;
- limites medidos de materialização e tamanho de export;
- formato físico interno do manifest/bundle e adapters do próximo release.

### Deferred out of scope

F14/F15, matching/scoring/eligibility, UI final, imports/connectors, mapping UBI/F12 inferido, provisioning/rollout produtivo, retention/legal hold operativo, scheduling, materialização assíncrona, `CUSTOM_AREA`, `UNIT_SUBTREE`, FX, grupos empresariais e delete físico.

## Execução da fatia 1

- Snapshot inicial: branch local `feat/f13-organizational-profile`, criada de `71fdd56` (`docs(f13): consolidate organizational profile decisions and implementation plan`).
- Resultado committed localmente em `8c4b23c` (`feat(f13): add structural profile contracts and catalogs`), sem push, merge, rebase ou PR.
- A F13-P1 permanece **Complete** e committed localmente em `1521d8f`. Não existe alegação de push, merge, PR ou integração em `main`.
- A fatia 1 implementa apenas contratos/catálogos estruturais em `backend/src/organizationalProfile/`: vocabulários fechados, envelope epistemológico, referências tipadas, canonicalização, digests e tuple estrutural corrente.
- R1-002 substituiu policies aceites por shape por policies emitidas por boundary interno, congeladas e reconhecidas por identidade opaca em `WeakSet`. O envelope exige representação de valor declarada para `KNOWN`, assertions incompatíveis distintas para `CONFLICTED`, metadata governada para `DISPUTED|REVOKED|EXPIRED` e policy de projeção trusted para `WITHHELD`; não foram criados reason codes produtivos.
- R2-001 fechou a emissão de trust: `contracts.js` inicializa internamente um catálogo estático, versionado e não exportado e publica apenas resolução por tuple exata. As únicas tuples desta fatia são `EPISTEMIC_ENVELOPE/F13_DECLARED_FACT/f13-structural-v1` e `EPISTEMIC_PROJECTION/F13_DISCLOSED_ONLY/f13-structural-v1`; estados dependentes de reason codes finais ou uma policy `WITHHELD` continuam fail-closed, sem catálogo fictício.
- R3-001 tornou a projection policy obrigatória antes de qualquer branch por estado: `DISCLOSED` só é aceite com a policy catalogada e trusted da instância corrente, e ausência, clones, reconstruções, policy de envelope, outra instância ou estado não autorizado falham fechado sem executar propriedades do caller. Resolver a policy continua sem conceder autorização F5.
- R1-003 fechou os digests estruturais: `semanticDigest` e `projectionDigest` aceitam apenas envelopes F13 validados internamente contra bundle e policy tuples exatas. O digest semântico inclui o bundle integral e a policy do envelope, mas exclui metadata de projeção; o digest de projeção inclui bundle, policies, modo e a projeção `EXACT` validada. Modos sem policy aprovada continuam fail-closed.
- R1-004 endureceu os boundaries estruturais sem executar código do caller antes da recusa: proxies são detetados por identidade antes de reflection perigosa, accessors são inspecionados por descriptor sem invocação, compatibilidade opera sobre clone canónico e digests deixam de reler o objeto original depois da validação.
- R1-005 substituiu a allowlist global ambígua por uma matriz imutável por scheme: temas admitem `EXACT|CLOSE|BROADER|NARROWER`, territórios acrescentam `OVERLAPS` e todos os restantes schemes/domínios permanecem fail-closed até decisão normativa própria.
- R5-001 substituiu a reconstrução de objetos por atribuição sobre `{}` por encoding direto a partir de descriptors validados. Propriedades próprias `__proto__` são preservadas como dados, não alteram prototypes e não convergem com objetos vazios ou semanticamente distintos.
- As 29 operações-base e a operação de reclassificação estão definidas como catálogo estrutural fechado, sem grants implícitos e sem registo ainda no catálogo F5/F7 produtivo. A integração produtiva pertence a fatia posterior.
- Nenhuma migration, manifest, fingerprint, ledger, schema PostgreSQL, repository, job ou superfície HTTP foi criada ou alterada.
- `.vscode/settings.json` continua como alteração local preexistente, intocada e fora do âmbito.

## Validação executada da fatia 1

- Testes focados F13: `node --test test/f13StructuralContracts.test.js` — **27/27 PASS** após a correção R5-001.
- F13 + regressões F5/F7: `node --test test/f13StructuralContracts.test.js test/f5FunctionalAuthorization.test.js test/f7*.test.js` — **67/67 PASS**.
- Suite backend: `npm test` — **587/587 PASS**.
- `node --check` — **PASS** nos JavaScript alterados por R5-001.
- `git diff --check` — **PASS**; apenas avisos informativos de conversão LF→CRLF nos dois documentos alterados.
- Scan do diff — **PASS**, sem padrões de credenciais, connection URLs, tokens, e-mails ou dados pessoais.
- Confirmação estrutural — **PASS**, sem migrations, manifests, fingerprints, ledgers ou outros artefactos PostgreSQL no diff.
- Nenhum teste PostgreSQL foi executado ou necessário nesta fatia sem schema; os AC mantêm estado parcial enquanto as respetivas provas integradas não existirem.

## Ledger da revisão da fatia 1

| Finding | Estado | Evidência atual |
|---|---|---|
| `F13-S1-R1-001` — propriedades adicionais de arrays omitidas pela canonicalização | **CORRIGIDO — revalidado read-only** | arrays exigem exatamente `length` e índices canónicos densos; testes cobrem aliases numéricos, extras, symbols, descriptors, accessors, sparse/out-of-range e recusa nos dois digests |
| `F13-S1-R1-002` — estados epistemológicos semanticamente incompletos | **CORRIGIDO — revalidado read-only** | policies opacas e catalogadas governam valores e projeções; conflito, expiração e verificação usam estrutura fechada; estados dependentes de reason/projection policy ainda não catalogados falham fechado |
| `F13-S1-R2-001` — qualquer consumidor podia emitir policies arbitrárias como trusted | **CORRIGIDO — revalidado read-only** | issuers e validators de definitions deixaram a API pública; catálogo privado aceita apenas duas tuples estruturais exatas e resolvers recusam caller definitions, partial/cross/future/N-1 tuples e clones |
| `F13-S1-R3-001` — `DISCLOSED` ignorava a projection policy trusted | **CORRIGIDO — revalidado read-only** | validação trusted e allowlist do estado ocorrem antes de qualquer branch; corpus cobre ausência, null, clones, reconstruções, policy errada, outra instância, getters/proxy e estado não autorizado |
| `F13-S1-R4-001` — teste não isolava a aplicação de `allowedProjectionStatuses` | **CORRIGIDO — revalidado read-only** | prova comportamental força a allowlist trusted a recusar `DISCLOSED`, confirma que a consulta ocorreu e restaura o primitive em `finally`; remover apenas a consulta faz a regressão falhar |
| `F13-S1-R1-003` — digests aceitam conteúdo não validado/versionado | **CORRIGIDO — revalidado read-only** | digests resolvem bundle/policies exatos, validam o envelope internamente, rejeitam conteúdo arbitrário e modos sem policy e vinculam a representação canónica às versões normativas aplicáveis |
| `F13-S1-R1-004` — boundaries podem executar accessors/traps antes da recusa | **CORRIGIDO — revalidado read-only** | canonicalização recorre a descriptors, compatibilidade clona canonicamente antes de ler e digests consomem apenas o clone validado; testes hostis provam zero execução de getters e traps nos boundaries públicos |
| `F13-S1-R1-005` — relações de mapping sem restrição por domínio | **CORRIGIDO — revalidado read-only** | matriz fechada por scheme separa relações temáticas e territoriais; `OVERLAPS` é apenas territorial e schemes sem relações concretas aprovadas recusam todo mapping |
| `F13-S1-R5-001` — `__proto__` era omitido pela canonicalização de objetos | **CORRIGIDO — revalidado read-only** | encoder F13 preserva cada data property validada sem setters herdados; regressão cobre clone, envelope `KNOWN`, arrays, prototypes e digests semantic/projection distintos |

## Plano aprovado para a fatia 2 — migration 007 e startup

### Estado e boundary

- A fatia 2 foi revista e **explicitamente autorizada em 2026-10-11**. A revisão documental não criou SQL nem alterou manifest/persistência; a próxima ação de `feature start` pode implementar exclusivamente este boundary e executar os gates PostgreSQL previstos.
- O único ordinal admissível é `007_f13_profile_catalogs_and_policies`, imediatamente após `006_f13_p1_organizational_scope` no runner tenant canónico.
- A migration 007 é um boundary **expand-only**, aditivo e ainda não operacional: prepara identidade semântica e políticas, mas não declara `F13_ORGANIZATIONAL_PROFILE`, não serve operações F13 e não instala participant F13-P1.
- Tenants em 006 continuam válidos e funcionais para F12/F13-P1. Tenants em 007 continuam sem F13 operacional; ausência da capability final é intencional.
- Não entram nesta fatia drafts, revisions, assertions, authoring, approval, publication, completion evaluation, snapshots, activation, projections persistidas, participant F13-P1, F9 ou endpoints.
- Não entram seeds editoriais, mappings F12/UBI, authorities concretas, thresholds, reason/purpose codes finais ou policies de slot ainda não aprovadas. A estrutura pode armazenar releases futuros, mas não inventa conteúdo normativo.

### Contrato físico planeado

1. Criar o schema tenant `organization_profile` e roles `c4g_organization_profile_owner`, `c4g_organization_profile_migrator` e `c4g_organization_profile_runtime`, seguindo ownership/grants/search-path/RLS já usados por F13-P1.
2. Criar `profile_scope` como identidade F13 tenant-local para `ORGANIZATION|UNIT|TEAM`:
   - `organization_id` obrigatório e tenant-bound;
   - `scope_type` fechado;
   - `scope_id` nulo apenas para `ORGANIZATION` e obrigatório para `UNIT|TEAM`;
   - FK composta `(organization_id, scope_id)` para `organizational_scope.scope` apenas quando existe scope local;
   - unicidade de baseline Organization e de cada scope exato;
   - nenhuma herança, `UNIT_SUBTREE` ou duplicação da organização Central.
3. Criar o núcleo versionado de catálogos semânticos:
   - `catalog_release`;
   - `scheme`;
   - `concept`;
   - `concept_label`;
   - `concept_relation`;
   - `external_mapping`.
4. Preservar constraints estruturais aprovadas:
   - IDs UUID opacos; labels/códigos externos não são identidade;
   - conceito pertence a um único scheme/release;
   - namespaces globais e tenant-local são distintos;
   - release publicada é imutável;
   - relações são fechadas por scheme; DAG e containment são validados sem criar semântica de matching;
   - mappings são metadata versionada e não equivalência automática.
5. Criar storage estrutural, ainda sem conteúdo editorial, para:
   - `metric_catalog_release`, `metric_definition`, `band_policy`, `derivation_policy`;
   - `completion_policy`, `completion_slot`, `completion_rule`;
   - `projection_policy`, `purpose_catalog_entry`, `reason_catalog_entry`;
   - `compatibility_manifest`, `release_bundle`.
6. Usar colunas/FKs/checks para identidade, lifecycle, version e relações. JSON/JSONB só é admitido para definições fechadas já validadas pela aplicação e digestadas; nunca para SQL, JavaScript, JSON Logic, CEL, callbacks, predicates ou campos arbitrários do caller.
7. Todas as tabelas tenant-scoped recebem `organization_id`, RLS e `FORCE ROW LEVEL SECURITY`; catálogos globais somente podem ser materializados como releases read-only explicitamente identificadas, nunca como rows tenant mutáveis disfarçadas.
8. Não criar FK, trigger ou import para drafts/snapshots/tabelas 008–009 ainda inexistentes.

### Migration, manifest e compatibilidade

1. Adicionar apenas `007_f13_profile_catalogs_and_policies.up.sql` e down conservador correspondente; nenhum ficheiro controla `BEGIN`, `COMMIT`, `ROLLBACK`, savepoint ou transaction setting.
2. O down recusa execução quando existirem dados/referências incompatíveis e remove somente objetos pertencentes à 007 na ordem inversa segura; não altera 006 nem dados F12/F13-P1.
3. Integrar 007 exclusivamente em `backend/src/security/tenantMigrationManifest.js` e no runner/preflight canónicos, com checksum, fingerprint cumulativo, ordinal contínuo e postflight explícito.
4. A capability preparatória fica fixada como `F13_PROFILE_CATALOG_FOUNDATION`, distinta da capability final e sem autorização funcional. Deve integrar manifest/preflight/postflight apenas quando o schema 007 integral estiver presente; não pode ser usada por operation catalog F13.
5. A compatibilidade planeada para a entry 007 é:
   - read de contratos legados F12/F13-P1 preservado em 006 e 007 conforme as matrizes dos módulos existentes;
   - write corrente do schema tenant em 007 apenas para workloads já compatíveis;
   - nenhuma operação F13 disponível;
   - tuples exatas, sem produto cartesiano ou fallback.
6. Atualizar os operation catalogs F12/F13-P1 somente para declarar 007 como schema compatível quando a inspeção demonstrar que as respetivas queries e invariantes permanecem válidas; não alterar permissions ou comportamento.
7. Startup/preflight deve validar presença, ownership, roles, grants, RLS/FORCE RLS, constraints, índices, digests e catálogo de capability. Drift ou capability/schema incoerentes impedem servir o workload afetado e não são reparados automaticamente.

### Ordem de implementação proposta

1. **Contrato da migration:** fixar nomes físicos, enum/check strategy, ownership e dependency graph num teste estrutural que falhe antes do SQL existir.
2. **SQL 007:** schema, roles, `profile_scope`, catálogos/releases/policies e constraints; down conservador; nenhuma seed.
3. **Manifest e fingerprint:** entry 007, load/checksum, fingerprint cumulativo e regras N/N-1 exatas.
4. **Preflight/postflight:** probes de schema, roles, grants, RLS/FORCE RLS, constraints, índices, releases/policies e capability preparatória.
5. **Compatibility dos workloads existentes:** F12 e F13-P1 em 007 apenas após provas unitárias e PostgreSQL de não regressão.
6. **Catálogos F5/F7 estruturais:** preparar apenas códigos necessários à futura governance de catálogo; não criar grants produtivos, handlers ou operações HTTP. Se o catálogo transversal exigir registo que torne a operação alcançável, adiar para a fatia 3.
7. **Gate PostgreSQL 17:** usar runner canónico e LOGIN runtime não privilegiado; nunca carregar SQL diretamente nem fabricar ledger/fingerprint.
8. **Documentação/evidência:** atualizar matriz AC apenas com resultados executados; nenhum AC passa apenas pela existência da migration.

### Provas e gates da fatia 2

| Área | Prova requerida | AC afetados |
|---|---|---|
| Manifest/runner | vazio→007, 003/004/005/006→007, segunda execução, ordinal/checksum/fingerprint, ledger gap e drift | AC-26, AC-27 |
| Atomicidade | falha SQL→ledger, rollback integral, retry idempotente, commit incerto reconciliado pelo estado físico+ledger | AC-28, AC-29 |
| Segurança SQL | owner/migrator/runtime separados, ausência de `PUBLIC`, RLS+FORCE RLS, tenant context obrigatório, A/B com LOGIN runtime | AC-01, AC-02, AC-25, AC-28 |
| `profile_scope` | baseline única, FK composta Unit/Team, type/lifecycle mismatch recusado, archived apenas histórico | AC-01, AC-02, AC-18 |
| Catálogos | release imutável, scheme/concept ownership, relações fechadas, ciclos/containment recusados, mappings sem efeito semântico | AC-05, AC-13, AC-15, AC-30 |
| Policies/bundles | tuples exatas, versions/digests, unknown/future/N-2/cross-tuple recusados, sem DSL/callback | AC-05, AC-20, AC-26, AC-32 |
| Não regressão | F12 e F13-P1 em 006/007, suite backend, gates cumulativos F12/F13-P1 | AC-27, AC-31 |
| Hygiene | `node --check`, `git diff --check`, scan de secrets/PII, cleanup integral | AC-24, AC-31 |

### Critérios de entrada e saída

- **Entrada para implementação:** autorização explícita concedida em 2026-10-11 para alterar somente migration/persistência da fatia 2 e executar os respetivos gates; capability preparatória fixada; antes da primeira edição deve ser reconfirmado que o worktree não contém alterações alheias além de `.vscode/settings.json` excluída e deste plano documental.
- **Parar antes de SQL** se a implementação exigir escolher seeds, authority editorial global, reason/purpose codes finais, policy de slot concreta ou semântica de operações produtivas não aprovada.
- **Saída da fatia:** 007 aplicada apenas pelo runner, startup fail-closed, upgrades e regressões verdes, sem capability final F13 e sem operações funcionais F13 alcançáveis.
- AC-01/02/05/13/15/18/20/25–32 recebem apenas a evidência efetivamente produzida; nenhum é promovido automaticamente a PASS.
- A fatia 3 só pode iniciar depois de revisão read-only da 007 e autorização explícita; nela serão implementados governance e services de taxonomias/releases sobre este storage.

### Veredicto da revisão pré-start

**APPROVED TO START — fatia 2.** A migration 007 é planeável sobre o ordinal e runner atuais, não exige decisão de produto adicional e mantém separados schema preparatório, capability final e operações funcionais. A autorização cobre SQL up/down, manifest/checksum/fingerprint, preflight/postflight, compatibility dos workloads existentes, testes e gate PostgreSQL 17 descritos acima. Não cobre seeds, serviços de governance, endpoints, authoring, snapshots, activation, participant F13-P1 nem migrations 008–009.

## Execução e validação da fatia 2

- Implementada `007_f13_profile_catalogs_and_policies` como expansão aditiva, sem seeds e sem capability funcional `F13_ORGANIZATIONAL_PROFILE`.
- Criados schema/roles dedicados, `profile_scope`, 18 tabelas de catálogos/policies/bundles, constraints estruturais, RLS/FORCE RLS e down conservador que recusa perda de dados.
- `F13_PROFILE_CATALOG_FOUNDATION` foi integrada no manifest, fingerprint cumulativo, preflight e schema observation. A emissão da capability exige exatamente 19 tabelas, roles seguras, RLS forçada, grants mínimos e ausência de grants de tabela runtime/PUBLIC.
- F12 e F13-P1 passaram a declarar 007 como schema compatível sem alterar permissions, operações ou comportamento funcional.
- Nenhum grant funcional F13, handler, repository, endpoint, participant, draft, assertion, snapshot, activation ou job foi introduzido.

### Evidência executada

- Testes focados manifest/preflight/F12/F13-P1/F13: **45/45 PASS** na revalidação final.
- Suite backend: **591/591 PASS** na revalidação final.
- Gate PostgreSQL 17 F13 fatia 2: **PASS** — runner canónico, vazio→007, segunda execução idempotente, baseline única, FK F13-P1, 21/21 tabelas com RLS/FORCE RLS, zero grants funcionais, drift recusado e provas finais de `taxonomyRelationUpdatesEvaluateFutureGraph` e `accessCatalogDownDataLossDenied`.
- Gate PostgreSQL 17 F13-P1 cumulativo: **PASS**, incluindo autorização, concorrência, idempotência, commit incerto e participant rollback.
- Gate cumulativo F12: **PASS** — vazio/003/004/005/006→007, rollback SQL→ledger, retry, commit incerto, drift, gap, concorrência e segunda execução.
- `node --check`: **PASS** em todos os JavaScript alterados.
- `git diff --check`: **PASS**, apenas avisos informativos LF→CRLF.
- Scan de credenciais/PII: **PASS**, zero correspondências.
- Cleanup: **PASS**, sem containers F13/F13-P1/F12 remanescentes.

### Estado dos critérios após a fatia 2

- `F13-AC-01`, `F13-AC-02`, `F13-AC-05`, `F13-AC-13`, `F13-AC-15`, `F13-AC-18`, `F13-AC-20` e `F13-AC-25`–`F13-AC-32` recebem evidência **PARTIAL** desta fundação.
- A evidência não prova authoring, publication, completion runtime, snapshots, activation, projection ou consumo F14; esses critérios permanecem incompletos.
- Nenhum dos 32 F13-AC está marcado `PASS`.

### Ledger da revisão da fatia 2

| Finding | Estado | Evidência atual |
|---|---|---|
| `F13-S2-R1-001` — `profile_scope` não validava tipo/lifecycle do scope F13-P1 | **CORRIGIDO — revalidado read-only** | trigger sob o advisory lock organizacional F13-P1 valida server-side organização, UUID, tipo exato e lifecycle `ACTIVE`; PostgreSQL aceita Unit/Team corretos e recusa mismatch Unit/Team, archived, inexistente e cross-organization |
| `F13-S2-R1-002` — conteúdo de releases publicadas mutável | **CORRIGIDO — revalidado read-only** | R2-001 fechou atomicidade concorrente e R2-002 fechou imutabilidade integral das versões purpose/reason |
| `F13-S2-R2-001` — publicação concorrente não serializava com mutações dos membros | **CORRIGIDO — revalidado read-only** | member guards bloqueiam a row-raiz com `FOR UPDATE`, parents duplos são adquiridos por UUID em ordem canónica e labels bloqueiam primeiro concepts em ordem canónica; probes PostgreSQL provam publication-first nas quatro famílias e member-first em taxonomy |
| `F13-S2-R2-002` — purpose/reason imutáveis por row, não por versão | **CORRIGIDO — revalidado read-only** | purpose e reason possuem release roots com lifecycle/digest próprios; entries usam FK e o mesmo row lock da versão; publicação exige conjunto não vazio sem drafts e congela insert/update/delete de toda a versão |
| `F13-S2-R1-003` — relações taxonómicas sem domínio/DAG estrutural | **CORRIGIDO — revalidado read-only** | CHECK liga cada scheme ao domínio aprovado; trigger aceita apenas `PARENT` temático ou `CONTAINS` territorial, recusa domínio `NONE`, bloqueia o grafo por release+scheme e usa recursive CTE para impedir ciclos profundos e concorrentes; gate final preserva `taxonomyRelationDomainsAndDag` e `taxonomyRelationUpdatesEvaluateFutureGraph` |
| `F13-S2-R3-001` — UPDATE incluía a versão antiga da própria relação no grafo futuro | **CORRIGIDO — revalidado read-only** | recursive CTE exclui `OLD.relation_id` em UPDATE; probe PostgreSQL aceita inversão acíclica com novo UUID e continua a recusar ciclos reais em INSERT e UPDATE |
| `F13-S2-R1-004` — pertença tenant/global dos membros não vinculada à release | **CORRIGIDO — revalidado read-only** | `ownership_key` gerada distingue GLOBAL de TENANT por UUID; FKs compostas vinculam scheme à release e concept ao scheme, sem bypass por NULL e com proteção de alterações dos pais |
| `F13-S2-R1-005` — down pode eliminar purpose/reason catalogs | **CORRIGIDO — revalidado read-only** | down chama `assert_007_down_safe()` antes dos DROP; guard bloqueia e verifica oito roots, incluindo purpose/reason, sem aceitar ausência aparente causada por RLS; gate final confirma `accessCatalogDownDataLossDenied` |
| `F13-S2-R1-006` — texto final desatualizado sobre migrations no diff | **CORRIGIDO — revalidado read-only** | veredicto final reconhece que a migration 007 e os respetivos testes/gate estão presentes no worktree; apenas 008–009 permanecem fora do diff |

Validação da correção R1-001:

- testes focados manifest/F12/F13-P1/F13: **17/17 PASS**;
- suite backend: **590/590 PASS**;
- gate PostgreSQL 17 F13 fatia 2: **PASS**, incluindo `profileScopeTypeAndLifecycleBound: true`;
- gate PostgreSQL 17 F13-P1 cumulativo: **PASS**;
- gate cumulativo F12: **PASS**, incluindo vazio/003/004/005/006→007, rollback, retry, commit incerto, drift, gap e concorrência;
- `node --check`, `git diff --check`, scan de credenciais/PII e cleanup: **PASS**.
- `F13-AC-01`, `F13-AC-02` e `F13-AC-18` permanecem **PARTIAL**; esta correção não prova os loaders e lifecycle funcionais das fatias seguintes.

Validação da correção R1-002:

- testes focados de migration/manifest: **11/11 PASS**;
- suite backend: **591/591 PASS**;
- gate PostgreSQL 17 F13 fatia 2: **PASS**, incluindo `publishedMemberGraphsImmutable: true`;
- gate PostgreSQL 17 F13-P1 cumulativo: **PASS**;
- gate cumulativo F12: **PASS**, incluindo todos os upgrades até 007 e provas de rollback/retry/commit incerto/drift;
- `node --check`, `git diff --check`, scan de credenciais/PII e cleanup: **PASS**.
- `F13-AC-05`, `F13-AC-06`, `F13-AC-09`, `F13-AC-12`, `F13-AC-13` e `F13-AC-15` permanecem **PARTIAL**; publication services, snapshots e domínios 008–009 ainda não existem.

Validação da correção R2-001:

- testes focados de migration/manifest: **11/11 PASS**;
- suite backend: **591/591 PASS**;
- gate PostgreSQL 17 F13 fatia 2: **PASS**, incluindo `publicationMemberMutationsSerialized: true` e `publishedMemberGraphsImmutable: true`;
- publication-first foi exercitado com ligações reais e locks observados para taxonomy, metric, completion e compatibility manifest; member-first foi exercitado em taxonomy e confirmou publicação apenas depois do commit do membro;
- gate PostgreSQL 17 F13-P1 cumulativo: **PASS**;
- gate cumulativo F12: **PASS**, incluindo vazio/003/004/005/006→007, rollback, retry, commit incerto, drift, gap e concorrência;
- `F13-AC-05`, `F13-AC-06`, `F13-AC-09`, `F13-AC-13` e `F13-AC-15` permanecem **PARTIAL**; R2-002 aguarda revalidação e os findings R1-003–R1-006 continuam abertos.

Validação da correção R2-002:

- testes focados de migration/manifest: **11/11 PASS**;
- suite backend: **591/591 PASS**;
- gate PostgreSQL 17 F13 fatia 2: **PASS**, incluindo `accessCatalogVersionsImmutable: true`, `publicationMemberMutationsSerialized: true` e `publishedMemberGraphsImmutable: true`;
- PostgreSQL recusa publicação vazia, publicação com entries `DRAFT`, insert tardio na versão publicada, update, delete e truncate; a race publication-first também recusa o insert concorrente depois do commit da publicação;
- startup/preflight exige exatamente as 21 tabelas F13 esperadas, incluindo as roots purpose/reason, com RLS e `FORCE RLS` integrais;
- gate PostgreSQL 17 F13-P1 cumulativo: **PASS**;
- gate cumulativo F12: **PASS**, incluindo upgrades até 007 e provas de rollback/retry/commit incerto/drift;
- `F13-AC-05`, `F13-AC-06` e `F13-AC-12` permanecem **PARTIAL**; R1-003–R1-006 continuam abertos e nenhum AC foi promovido a `PASS`.

Validação da correção R1-003:

- testes focados de migration/manifest: **11/11 PASS**;
- suite backend: **591/591 PASS**;
- gate PostgreSQL 17 F13 fatia 2: **PASS**, incluindo `taxonomyRelationDomainsAndDag: true`;
- PostgreSQL aceita múltiplos parents temáticos e containment territorial, recusa relações cross-domain e schemes `NONE`, recusa ciclo profundo, recusa mudança de domínio com relações existentes e serializa arestas opostas concorrentes para exatamente um vencedor;
- gate PostgreSQL 17 F13-P1 cumulativo: **PASS**;
- gate cumulativo F12: **PASS**, incluindo upgrades até 007, rollback, retry, commit incerto, drift, gap e concorrência;
- `F13-AC-05`, `F13-AC-06`, `F13-AC-09`, `F13-AC-13` e `F13-AC-15` permanecem **PARTIAL**; R1-004–R1-006 continuam abertos e nenhum AC foi promovido a `PASS`.

Validação da correção R3-001:

- A regressão foi executada antes da correção e reproduziu `F13_PROFILE_RELATION_CYCLE` na inversão acíclica `A → B` para `B → A` com mudança simultânea do UUID.
- O trigger exclui a row anterior por `OLD.relation_id` nas duas partes da recursive CTE durante UPDATE; em INSERT mantém a exclusão por `NEW.relation_id`. A row proposta é avaliada pelos endpoints novos, sem incluir a versão substituída.
- O probe confirma o novo UUID/endpoints persistidos, recusa ciclo verdadeiro por INSERT, recusa UPDATE que introduza ciclo e confirma preservação da aresta anterior após a recusa.
- Testes focados de migration/manifest: **11/11 PASS**; suite backend: **591/591 PASS**.
- Gate PostgreSQL 17 F13 fatia 2: **PASS**, incluindo `taxonomyRelationUpdatesEvaluateFutureGraph: true` e as provas anteriores de domínio/DAG e concorrência.
- Gate PostgreSQL 17 F13-P1 cumulativo: **PASS**. A medição emitida pelo harness permanece baseline local, não SLO.
- Gate cumulativo F12: **PASS**, incluindo vazio/003/004/005/006→007, rollback SQL→ledger, retry, commit incerto, drift, gap e concorrência; testes F9 PostgreSQL integrados: **3/3 PASS**.
- `node --check` nos JavaScript alterados e `git diff --check`: **PASS**; scan de credenciais/PII nos quatro ficheiros da correção sem ocorrências; cleanup sem containers ou volumes dos gates F13/F13-P1/F12.
- Checksum e fingerprint da migration 007 reconciliados pelo runner canónico; nenhuma migration publicada anterior foi alterada.
- `F13-AC-05` e `F13-AC-13` permanecem **PARTIAL**; à data desta correção, R1-003/R3-001 aguardavam revalidação e R1-004–R1-006 permaneciam abertos. O estado final está consolidado na revalidação abaixo; nenhum AC foi promovido a `PASS`.

Validação da correção R1-004:

- Causa: as FKs anteriores vinculavam apenas UUIDs, permitindo `organization_id` divergente ou NULL nos membros de uma release tenant-local e organização num membro global.
- `ownership_key` é uma coluna gerada armazenada, com comparação `C`: `GLOBAL` para organização NULL e `TENANT:<UUID>` para organização identificada. Não é identidade editorial, seed, mapping ou atributo fornecido pelo caller.
- As FKs `(release_id,ownership_key)` e `(scheme_id,release_id,ownership_key)` impõem pertença exata transitiva. Labels, relações e mappings continuam vinculados aos concepts pelos seus UUIDs/FKs existentes. `ON UPDATE RESTRICT` impede alterar a pertença de um pai com membros incompatíveis.
- PostgreSQL aceita os graphs tenant e global válidos; recusa INSERT de schemes/concepts com NULL em release tenant, tenant diferente ou organização numa release global; recusa UPDATE de concept/scheme divergente e alteração de pertença de releases com membros; recusa escrita direta da coluna gerada.
- Testes focados migration/manifest: **11/11 PASS**; suite backend: **591/591 PASS**.
- Gate PostgreSQL 17 F13: **PASS**, com `catalogMemberOwnershipBound: true` e todos os marcadores anteriores de domínio/DAG, UPDATE e imutabilidade preservados.
- Gate PostgreSQL 17 F13-P1 cumulativo: **PASS**. Benchmark emitido pelo harness é apenas baseline local.
- Gate cumulativo F12: **PASS**, incluindo vazio/003/004/005/006→007, rollback, retry, commit incerto, drift, gap e concorrência; testes PostgreSQL F9 integrados: **3/3 PASS**.
- `node --check`, `git diff --check` e scan de credenciais/PII: **PASS**; cleanup confirmado sem containers ou volumes dos gates F13/F13-P1/F12. Sem commit ou stage; `.vscode/settings.json` não foi alterado nesta correção.
- Checksum/fingerprint da migration 007 reconciliados com o runner canónico; migrations anteriores e F13-P1 não foram alteradas nesta correção.
- F13 permanece **In Progress**; AC-01/02/05/13/15 permanecem **PARTIAL**, sem qualquer AC PASS. À data desta correção, R1-005 aguardava revalidação e R1-006 permanecia aberto; ambos são fechados na revalidação final abaixo.

Validação da correção R1-005:

- Causa: o guard anterior do down omitia `purpose_catalog_release` e `reason_catalog_release`, permitindo que `DROP SCHEMA ... CASCADE` eliminasse catálogos quando fossem os únicos dados existentes.
- O down chama `organization_profile.assert_007_down_safe()` antes de qualquer DROP. A função é instalada pelo runner na 007; verifica as oito roots e recusa qualquer row, inclusive versão DRAFT sem entries, com `F13_PROFILE_007_DOWN_REFUSES_DATA_LOSS`.
- A função adquire locks `ACCESS EXCLUSIVE` nas roots em ordem alfabética e mantém-nos na transação externa. `row_security=off` impede que uma leitura filtrada seja considerada prova de ausência; não existe SECURITY DEFINER ou grant runtime adicional.
- Provas PostgreSQL invocam apenas o guard instalado pelo runner, sem aplicar migrations diretamente, fabricar ledger ou executar downgrade. Confirmam sucesso no schema vazio e recusa/preservação de dados em quatro casos isolados: purpose DRAFT vazio, reason DRAFT vazio, purpose publicado com entry e reason publicado com entry.
- O teste estrutural verifica que o down começa pela chamada do guard e não controla a transação. Checksum/fingerprint da 007 reconciliados; migrations anteriores intactas.
- Testes focados migration/manifest: **11/11 PASS**; suite backend: **591/591 PASS**.
- Gate PostgreSQL 17 F13: **PASS**, incluindo `accessCatalogDownDataLossDenied: true` e os marcadores anteriores de imutabilidade, pertença, domínio e DAG.
- Gate PostgreSQL 17 F13-P1 cumulativo: **PASS**; benchmark é apenas baseline local.
- Gate cumulativo F12: **PASS**, incluindo upgrades vazio/003/004/005/006→007, rollback, retry, commit incerto, drift, gap e concorrência; testes PostgreSQL F9 integrados: **3/3 PASS**.
- `node --check` nos JavaScript alterados, `git diff --check` e scan de credenciais/PII: **PASS**; cleanup sem containers ou volumes dos gates F13/F13-P1/F12. Sem commit ou stage; `.vscode/settings.json` intocado nesta correção.
- F13 permanece **In Progress** e nenhum AC foi marcado PASS; o estado final dos findings é consolidado na revalidação seguinte.

### Revalidação read-only final da fatia 2

- Revisão estrutural confirmou `OLD.relation_id` excluída do grafo futuro em `UPDATE`; o gate PostgreSQL 17 confirmou `taxonomyRelationUpdatesEvaluateFutureGraph: true`, mantendo também domínio, DAG e serialização concorrente.
- Revisão estrutural confirmou que o down começa por `assert_007_down_safe()` e que o guard verifica oito roots com `row_security=off`; o gate confirmou `accessCatalogDownDataLossDenied: true` para purpose/reason vazios e publicados, preservando os dados após recusa.
- Testes focados F13/manifest/F12: **45/45 PASS**; suite backend: **591/591 PASS**; gates PostgreSQL 17 F13, F13-P1 e F12: **PASS**; testes PostgreSQL F9 integrados no gate F12: **3/3 PASS**.
- `node --check`, `git diff --check`, scan de credenciais/PII e cleanup dos recursos descartáveis: **PASS**.
- `R1-003`, `R1-005` e `R1-006` estão corrigidos e revalidados. Nenhum F13-AC foi promovido a `PASS`: a evidência desta fundação permanece `PARTIAL` até às fatias funcionais correspondentes.

## Fecho formal da fatia 2

**APROVADA E FECHADA em 2026-10-11.** A aprovação humana confirmou a evidência da revalidação read-only, aceitou o ledger de findings sem itens abertos e autorizou o início exclusivo da fatia 3. O fecho não marca a F13 como `Complete`, não promove automaticamente qualquer AC a `PASS` e não autoriza migrations 008–009, authoring de perfis ou matching.

## Execução e validação da fatia 3

- Implementados contratos fechados, service e repository transacional para releases tenant-local, conceitos, labels, relações DAG e mappings externos.
- Conceitos locais conservam creator e aprovação maker-checker em provenance governada; aprovação e publicação exigem operações F5 sensíveis e stable human subject distinto. A publicação bloqueia sob lock os autores da release, conceitos, relações e mappings materiais.
- O catálogo produtivo F5 contém sete operações de taxonomia com resources distintos para read, criação de release, conceito, relação, mapping, aprovação e publicação; os bundles dos quatro perfis continuam vazios por default.
- O catálogo F7 contém seis eventos críticos source-local, um por mutação governada. Falha de append reverte a mutação antes de commit.
- F10 usa exclusivamente `operation` e `resultClass`; não emite tenant, actor, resource, label ou valor.
- Runtime recebe `SELECT|INSERT|UPDATE` apenas nas seis tabelas de taxonomia; RLS permite leitura global, recusa escrita global e isola integralmente rows tenant-local.
- A 007 inclui idempotência source-local de taxonomias e estende cumulativamente os constraints F7; checksum `eed5f7ac3a8170650ed07f620bdc7e5cc572db8204f01756581d516683acee0b` e fingerprint PostgreSQL 17 `2b3e1fde15803415547a84e7c8cba60d7f1310a5a97a24344da96a9dab44445d`.

### Evidência executada da fatia 3

- Testes focados F13/F5/F7: **102/102 PASS** após as correções `R1-001`–`R1-007`, incluindo matriz assimétrica operation/permission/resource.
- Suite backend: **600/600 PASS**, zero falhas, skips ou TODOs.
- Gate PostgreSQL 17 F13: **PASS** — ciclos/DAG, updates sobre grafo futuro, concorrência de publication/member, releases imutáveis, ownership, grants exatos, catálogo global read-only e isolamento tenant.
- Gate PostgreSQL 17 F13-P1: **PASS**, incluindo autorização, concorrência, idempotência, commit incerto e participant rollback.
- Gate cumulativo F12: **PASS**, incluindo vazio/003/004/005/006→007, rollback, retry, commit incerto, drift, gap, concorrência e testes F9 PostgreSQL **3/3 PASS**.
- `node --check`, `git diff --check`, scan de credenciais/PII e cleanup: **PASS**.

### Correções da revisão F13-S3-R1 — registo histórico, reavaliado em R2

- `R1-001`: a rejeição nos comandos existia, mas a autoridade do contexto funcional não estava comprovada; a declaração de correção integral foi invalidada por R2-001.
- `R1-002`: os catálogos e eventos existiam, mas faltavam composição e loaders ligados ao F5 produtivo; a declaração de correção integral foi invalidada por R2-002.
- `R1-003`: `taxonomy_idempotency_record` source-local guarda operação/key/intention/result; replay, divergência, serialização e commit incerto convergem.
- `R1-004`: o evento persistido foi observado, mas a identidade e a normalização de assurance não eram provas produtivas suficientes; correção integral invalidada por R2-001/R2-004.
- `R1-005`: a autoria era bloqueada, mas o aprovador não era excluído da publicação; correção integral invalidada por R2-003.
- `R1-006`: down revoga ACLs de audit. A prova inicial 006→007→006 usava SQL direto e não era uma prova do runner/ledger; a prova canónica válida é a correção R3-003 abaixo.
- `R1-007`: os scheme UUIDs são independentes e validados no comando; o gate cria duas releases com o mesmo sufixo e confirma quatro IDs distintos.

### Estado após a fatia 3

- `F13-AC-13` permanece **PARTIAL**, mas passa a ter evidência funcional e PostgreSQL de governação tenant-local, DAG, concorrência, publication e imutabilidade; seeds e autoridade editorial global continuam fora desta fatia.
- `F13-AC-15` permanece **PARTIAL**: mappings explícitos e relações fechadas estão demonstrados, mas assertions territoriais/beneficiários e conteúdo editorial concreto pertencem às fatias posteriores.
- Nenhum dos 32 AC é promovido integralmente a `PASS`. Migrations 008–009, authoring de perfis, lifecycle de perfil e matching continuam fora do diff.

## Correção F13-S3-R2 — 2026-10-11

### Composição produtiva e limites de confiança

- O bootstrap real usa o catálogo `f13`: **34 permissions/operations**, incluindo sete de taxonomia; bundles de perfis vazios. O root OIDC cria `taxonomies.bindTenant`; legacy não cria autoridade de taxonomia. Não foram adicionadas rotas HTTP, UI, migration ou matching.
- `taxonomyComposition.js` mantém o repository/service transacional interno. O adapter root captura apenas requests autenticados F3; relê o session store, valida o registry F3, membership central e snapshot F5. O caller funcional recebe um handle opaco instance-local, não actor/membership/organização/resource/correlation/assurance.
- A binding valida capability opaca emitida pelo preflight, ligada à pool exata, tenant e versão write-compatible. A correlation UUIDv7 é criada internamente. Contextos internos não podem ser forjados ou clonados. A autoridade é revalidada antes do SQL e depois dos locks; versões stale e sessão/membership revogadas falham fechado.
- Fluxo: comando fechado → handle F3 revalidado → client preparado/BEGIN/RLS → lock de intenção source-local → loader/locks → nova revalidação F3/F5 → autorização real/exata → alteração + F7 + resultado idempotente → COMMIT. Replay e reconciliação após commit incerto repetem loader e F5 antes de devolver o resultado.
- Na versão R2, os locks usavam intenção → release → membros, incompatível com a entrada DAG por SQL direto; R3-002 substitui essa entrada pela ordem descrita abaixo. A publicação exclui creator da release, autores de conceitos/relações/mappings e **aprovadores**, usando stable subject IDs sob lock.
- Assurance normalizada só nasce após decisão ALLOW do engine F5 real. O F7 recebe policy, membershipVersion, authorizationVersion e versões dos catálogos efetivamente avaliados; não recebe evidência crua/truthiness, labels ou conteúdo funcional. F10 está ligado ao registry allowlisted e usa apenas operation/resultClass.

### Loaders por operação

| Operação F5 | Permission | Resource resolvido pelo servidor |
|---|---|---|
| F13_TAXONOMY_READ | profile_taxonomy.read | TAXONOMY_RELEASE: releaseId; tenant ou global read-only |
| F13_TAXONOMY_RELEASE_CREATE | profile_taxonomy.release.create | TAXONOMY_RELEASE_DRAFT: releaseId validado; existente só em replay |
| F13_TAXONOMY_LOCAL_CONCEPT_CREATE | profile_taxonomy.local_concept.create | LOCAL_CONCEPT_DRAFT: conceptId; release/scheme tenant sob lock |
| F13_TAXONOMY_LOCAL_CONCEPT_APPROVE | profile_taxonomy.local_concept.approve | LOCAL_CONCEPT_REVISION: conceptId; pertença e creator sob lock |
| F13_TAXONOMY_RELATION_CREATE | profile_taxonomy.relation.create | TAXONOMY_RELATION: relationId; release/scheme/endpoints exatos |
| F13_TAXONOMY_MAPPING_CREATE | profile_taxonomy.mapping.create | TAXONOMY_MAPPING: mappingId; release/scheme/concept exatos |
| F13_TAXONOMY_RELEASE_PUBLISH | profile_taxonomy.release.publish | TAXONOMY_RELEASE: releaseId e todos os autores/aprovadores materiais |

Recursos prospectivos são vinculados aos IDs do comando fechado e pais bloqueados; existentes são carregados da base. Nenhum `ctx.resourceId` externo é usado. Grants unitários e qualifiers de recurso não concedem outra operação/alvo. Lifecycle/ownership/RLS continuam aplicáveis a replay.

### Evidência nova

- Comando focado: `node --test backend/test/f13*.test.js backend/test/f5FunctionalAuthorization.test.js backend/test/f7*.test.js backend/test/f3CentralMigrationContract.test.js backend/test/security/f3*.test.js backend/test/productionCompositionParity.test.js`: **142/142 PASS**, sem skips/TODOs.
- `npm test` em backend: **602/602 PASS**, sem falhas/skips/TODOs. Dois ensaios intermédios falharam no novo fixture de root OIDC (Express mock sem Router/routes); o fixture foi corrigido, não o comportamento funcional, e ambas as suites repetidas passaram.
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/migration-gate.ps1`: **PASS**. O helper `taxonomy-production.js` usa a composição runtime, engine/catalog F5 reais e SQL/F7 PostgreSQL 17 reais; registry F3 in-memory canónico, session store e ports centrais F5 usam fixtures sintéticos, não um IdP externo/rollout.
- Recusas adversariais provam **zero ALLOW F5, zero SQL funcional (incluindo SELECT), zero F7** para comandos de autoridade forjada, handles clonados, membership de outra organização/user/revogada, versões stale, organização divergente, correlation injetada e sessão expirada/revogada. Bindings de capability forjada/outra pool/tenant falham antes do acesso funcional.
- As sete operações são exercitadas com grants unitários assimétricos, operação errada e alvo errado. Global read funciona; global write e recurso tenant B são recusados. Replay exige autorização atual e não passa após revogação/grant removido/avanço de versões; também recusa authors/aprovador mesmo após publicação.
- O ledger PostgreSQL contém nove eventos das seis mutações: identidade, tenant, operação, resource, correlation, key, policy/assurance e versões comparadas à decisão F5. Falha injetada no append F7 reverte estado e idempotência nas **seis** mutações. MFA malformada/stale/outra policy é recusada. Commit confirmado no servidor mas incerto no cliente reconcilia sem novo F7; se a versão avança, não devolve sucesso sem reautorização.
- Gate F13-P1: **PASS**; gate cumulativo F12: **PASS**; testes PostgreSQL F9 nesse gate: **3/3 PASS**. Mantêm-se provas de DAG/grafo futuro, concorrência, imutabilidade, RLS/FORCE RLS/grants e rollback 006→007→006 com ACLs/fingerprint.
- A migration 007 **não foi alterada nesta correção R2**: checksum `eed5f7ac3a8170650ed07f620bdc7e5cc572db8204f01756581d516683acee0b`; fingerprint `2b3e1fde15803415547a84e7c8cba60d7f1310a5a97a24344da96a9dab44445d` confirmado pelos gates.
- `node --check`: **37 JavaScript PASS**, incluindo todos os untracked do gate; `git diff --check`: **PASS** (avisos CRLF do Git não são erros). Scan heurístico em **43 ficheiros alterados/untracked**, sem imprimir valores: nenhuma credencial/PII real encontrada. Candidatos revistos eram UUIDs sintéticos/índice de array, URLs loopback com password gerada por execução (não literal) e SESSION_SECRET explicitamente sintético do fixture produtivo. O scan não substitui revisão de segurança.
- Cleanup verificado após gates: nenhum container/volume com nomes F13/F13-P1/F12 dos gates; nenhum recurso Docker alheio foi removido. Alterações anteriores preservadas, `.vscode/settings.json` intocado, sem commit/stage e sem migration 008. Nenhum AC promovido.

### Estado dos findings após novas provas (não substitui revisão independente)

| Finding | Estado nesta implementação | Prova |
|---|---|---|
| R1-001 / R2-001 | Corrigidos; aguardam revisão read-only | root runtime, authority opaca, recusas antes SQL/F5/F7 |
| R1-002 / R2-002 | Corrigidos; aguardam revisão read-only | catálogo produtivo 34, sete loaders/F5, matriz assimétrica/replays |
| R1-003 | Correção preservada e revalidada | source-local, concorrência, intenção distinta, reautorização/commit incerto |
| R1-004 / R2-004 | Corrigidos; aguardam revisão read-only | valores normalizados F5 comparados ao F7 persistido nas seis mutações |
| R1-005 / R2-003 | Corrigidos; aguardam revisão read-only | PG recusa creator/autores/aprovador; publisher independente permitido |
| R1-006 | SQL corrigido; prova canónica R2 invalidada por R3-003 | a prova inicial usava SQL direto, sem downgrade/ledger pelo runner |
| R1-007 | Correção preservada e revalidada | quatro scheme UUIDs independentes em duas releases |

F13 **In Progress**, fatia 3 em correção até nova revisão formal. AC-13/AC-15 **PARTIAL**; identidade/auditoria/autorizações/telemetria reforçam evidência parcial de AC-12/21/22/24/25/28/31, sem promover AC integral. Migrations 008–009 continuam suspensas; sem commit, matching ou authoring de perfis.

## Correções F13-S3-R3 — 2026-10-11

### R3-001 — residência física, capability e fencing

- `taxonomyComposition.bindTenant` exige dependências runtime F4, sem fallback para `pool.connect()` funcional. A evidência ligada à pool continua apenas como verificação de bootstrap; já não autoriza a execução por identidade do objeto pool.
- As sete operações são módulos internos de `taxonomyTenantOperations`, registados no catálogo autorizado F4/F5. Inputs de execução são handles opacos instance-local (`WeakMap`), não contextos construídos pelo caller. Adapters, leases e clients não são devolvidos pela superfície funcional.
- `createTenantRuntime` reutiliza resolver, credential provider, pool manager, binding verifier e lease executor F4. O resolver valida membership, diretório/workload, geração, versões, capabilities e fencing antes da aquisição. A binding fixa tenant/organização/geração/schema/fingerprint ao bootstrap autorizado.
- O binding verifier observa o **client realmente adquirido**; volta a verificar esse mesmo client após BEGIN e antes de COMMIT. O executor emite privadamente uma capability de transação em `WeakMap`, ligada ao allocation/client, snapshot físico, workload, capabilities, fence e deadline. Clones, outro client/tenant/workload/capability e reutilização após conclusão são recusados. O issuer não é exportado; só o validator é interno aos módulos.
- Loaders, F5, alteração, F7 e idempotência usam o mesmo wrapper preparado/conexão. Cada query verifica o fence. Antes do commit: revalidação F4 → revalidação da sessão/F3 e versões F5 → observação física → revalidação final membership/diretório/fence → COMMIT. Falha anterior ao commit faz ROLLBACK e descarte; falha de confirmação de COMMIT exige nova resolução F3/F4/F5 e reconciliação por resultado persistido, sem repetir a mutação.
- Provas PostgreSQL 17 com **duas bases migradas pelo runner**: mesmo objeto pool passa a adquirir B; capability A com adapter B; binding stale; geração stale; membership revogada durante a operação; destino/revisão alterados antes do commit; fence avançado; binding/geração/capability alterados durante a transação. Em todas: **zero mutações, zero eventos F7 e zero resultados idempotentes persistidos em A/B**. As quatro recusas iniciais também provam zero ALLOW F5/SQL de mutação/append F7.
- Limite da prova: sessão/registry/membership/diretório são fixtures sintéticos, observação física e SQL/F7 são reais. O harness físico usa login administrativo descartável para observação/preflight e `SET LOCAL ROLE` runtime não privilegiado para os efeitos. Não constitui IdP externo, ligação produtiva, provisioning ou rollout. O gate cumulativo F12 conserva as provas de LOGIN/workload/binding físico não privilegiado F4.

### R3-002 — ordem de entrada dos locks DAG

- Todas as mutações taxonómicas funcionais adquirem primeiro `F13-TAXONOMY-DAG` (`hashtextextended`, seed `43001304`), antes da intenção e de qualquer row lock de release/scheme/membro.
- Triggers **BEFORE STATEMENT** nas seis tabelas de taxonomia adquirem exatamente o mesmo advisory lock antes dos tuple locks de INSERT/UPDATE/DELETE. Isto cobre UPDATE: um trigger de row sozinho seria tarde demais para impedir tuple→advisory versus advisory→tuple.
- Dentro dessa secção exclusiva mantêm-se os locks específicos por release/scheme e rows ordenadas. O lock de entrada comum é sempre anterior aos locks de scheme nos caminhos funcionais e SQL runtime; o fine-grained graph guard continua a excluir `OLD.relation_id` e a avaliar o grafo futuro.
- Quatro interleavings com barriers/`pg_blocking_pids`: funcional primeiro/SQL runtime primeiro × INSERT/UPDATE. Todos terminam sem `40P01`, com DAG final `A→B→C`, replay autorizado e exatamente **um F7 e um resultado idempotente** por comando funcional. Ciclos profundos/opostos e UPDATE com substituição do UUID continuam cobertos pelo gate anterior.
- Não há retry transacional cego. Trade-off explícito: writes de taxonomia são serializados por base física tenant; advisory locks PostgreSQL são database-local, não bloqueiam outra base tenant. Não se promete paralelismo entre schemes na mesma base nem ausência de deadlock para SQL arbitrário que adquira locks manualmente fora do protocolo.

### R3-003 — downgrade no runner canónico

- `createTenantMigrationRunner.downgrade` suporta exclusivamente **007→006**, com target explícito. Reutiliza conexão bounded, transação, migration advisory lock, preflight físico, ledger/checksums/fingerprint, timeout, postflight, reconciliação de commit incerto e publicação de schema observation do runner existente; nenhum runner paralelo ou SQL up/down no gate.
- A allowlist `SUPPORTED_TENANT_DOWNGRADE` fixa origem, destino e checksum down. O guard down recusa dados. A exceção ao ledger append-only é owner-only: disable do trigger específico → DELETE apenas da row 007 validada (rowCount=1) → enable do mesmo trigger, tudo sob lock/transação; qualquer falha restaura schema, roles, ledger e trigger. Runtime continua SELECT-only no ledger. O source guard permite apenas os dois ALTER exatos no ficheiro canónico, não DDL funcional genérico.
- Gate real: runner prefix 006 → `migrate` 007 → `downgrade` 006 → `migrate` 007. Ledger **7→8→7→8**; roles/ACLs de audit removidos/recriados; três constraints F7 removem/reintroduzem códigos e versão da taxonomia; fingerprint 006 recuperado; preflight pós-down/up aprovado. Requests de schema observation com revisions esperadas **1/2/3/4** são observados; este publisher do gate é sintético, não uma prova de CAS Central externa.
- Falha PostgreSQL injetada na remoção do ledger depois do down comprova rollback integral e preflight 007 recuperado. Downgrade com dados é recusado sem remover row 007. Testes adicionais cobrem target inválido, source down adulterado, falha de ledger e reconciliação de commit incerto no destino 006.
- A antiga descrição de SQL direto como “runner canónico” fica explicitamente retirada. Evidência histórica R1/R2 não demonstrava downgrade canónico; a evidência desta secção substitui-a.

### Validação final e artefactos

- Focados F13/F4/F4.3/F4.4/F3/F5/F7/composição: `rg --files backend/test -g '*.test.js'`, seleção dos nomes `f13|f42|f43|f44|f5|f7|f3` e `productionCompositionParity`, seguida de `node --test` nos paths explícitos: **276/276 PASS**, zero skips/TODOs.
- `npm test` em `backend`: **607/607 PASS**, zero skips/TODOs.
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/migration-gate.ps1`: **PASS**, incluindo provas físicas de duas bases, quatro interleavings, ciclo/grafo futuro, auditoria/assurance persistidas, idempotência/replay/commit incerto e downgrade canónico.
- Gates `test/integration/f13p1/migration-gate.ps1` e `test/integration/f12/migration-gate.ps1`: **PASS**; F9 PostgreSQL dentro do executor canónico F12: **3/3 PASS**. Benchmarks emitidos são apenas baseline local, não SLO.
- `node --check`: **45 JavaScript PASS** (todos os alterados/untracked); `git diff --check`: **PASS**, incluindo scan separado de whitespace nos untracked, apenas avisos LF→CRLF. Scan heurístico final dos **52 ficheiros** alterados/untracked: zero candidatos PII; onze candidatos credential revistos como sentinelas de teste ou URLs loopback com password gerada, nenhuma credencial real/literal produtiva. Não substitui revisão de segurança.
- Ensaios intermédios: fingerprint 007 antigo foi recusado até repin do valor observado; o probe concorrente inicialmente usava uma coluna inexistente e releaseVersion maiúscula, corrigidas no fixture; o source guard inicialmente recusou ALTER do ledger, ajustado apenas para as duas instruções canónicas exatas. Nenhum teste foi enfraquecido para aceitar efeitos inseguros.
- Checksum **up 007**: `8483731bd1acd2d14001445e92964566322cc16df32d2c5c70f49246237f81da`.
- Checksum **down 007**: `958ae2d8ef4153fe3387b82706d66edff55ddf76199f853f67397f6da1a33eca` (SQL down intacto).
- Fingerprint **007 PG17**: `3fcd5e77abd9fefd1187b65db1a3b419bad5eebfa1a67d06b14eca5d0a090a22`; fingerprint **006**: `29a98501da147ab979043e156e290c7f625dcc442b6da593c1c6ff135bbea70f`.
- Alterações anteriores preservadas, `.vscode/settings.json` intocado; sem stage/commit, sem migration 008 e sem matching. Teardown F13/F13-P1 agora usa `docker rm --force --volumes` no container descartável exato; ambos os gates repetidos passaram. Removidos **29 volumes anónimos descartáveis** recentes, comprovados por leitura read-only de `pg_database` com os nomes sintéticos exatos F13/F13-P1 e ausência de containers attached; dados de teste não recuperáveis. Nenhum prune global nem remoção de recurso alheio/sem origem demonstrável. Sem containers/volumes de gate conhecidos remanescentes após verificação final.

Ficheiros desta correção: `taxonomyComposition.js`, `taxonomyService.js`, novo `taxonomyTenantOperations.js`; `tenantLeaseExecutor.js`, `tenantMigrationManifest.js`, `tenantMigrationRunner.js`; SQL **up** 007; testes `f42TenantLeaseExecutor.test.js`/`f43TenantRunner.test.js`; gate F13 `gate.js`, `taxonomy-production.js`, novos `runtime-fixture.js`/`dag-concurrency.js` e `migration-gate.ps1`; teardown `test/integration/f13p1/migration-gate.ps1`; allowlist exata `test/integration/f12/source-guard.js`; estes dois documentos de contexto. Não foram reescritas as restantes alterações preexistentes.

### Ledger atual dos findings

| Findings | Estado atual | Evidência |
|---|---|---|
| R1-001 / R2-001 / R3-001 | Correções implementadas e validadas; aguardam revisão read-only | autoridade F3, operação F4, capability preparada física/transaction-bound e fencing de duas bases |
| R1-002 / R2-002 | Correções preservadas/revalidadas | sete operações/resources, matriz grants, replay e seis rollbacks F7 |
| R1-003 | Correção preservada/revalidada | storage source-local, intenção/replay/concorrência e commit incerto pelo runtime F4 |
| R1-004 / R2-004 | Correções preservadas/revalidadas | F7 persistido corresponde à decisão F5 normalizada |
| R1-005 / R2-003 | Correções preservadas/revalidadas | creator/autores/aprovadores recusados, publisher independente permitido |
| R1-006 / R3-003 | Correções implementadas e validadas; aguardam revisão read-only | downgrade real do runner, ledger/ACLs/roles/F7/fingerprints e rollback de falha |
| R1-007 | Correção preservada/revalidada | quatro UUIDs de schemes independentes |
| R3-002 | Correção implementada e validada; aguarda revisão read-only | lock DAG BEFORE STATEMENT e funcional, quatro interleavings sem deadlock/duplicação |

AC-13/AC-15 continuam **PARTIAL**. AC-01/02/10/11/12/21/22/26/27/28/29/31 recebem apenas evidência parcial adicional. Nenhum AC promovido a PASS; fecho da fatia 3 exige revisão independente. Pendências fora desta correção: conteúdo editorial/seeds globais, assertions/authoring/lifecycle de perfis, IdP/rollout produtivo. Migration 008 permanece **suspensa e não autorizada**.

## Veredicto de readiness

**In Progress — correções R3 implementadas e validadas; pronta para nova revisão formal read-only, não para fecho automático.** A fatia 2 está formalmente fechada. Nenhum AC foi promovido a `PASS`; migrations 008–009 e matching permanecem não autorizados.

## Correção parcial após revisão F13-S3-R4 (2026-10-11)

Esta secção prevalece sobre os estados/checksums/readiness históricos R3 acima. F13 continua `In Progress`; fatia 3 não fechada, AC-13/AC-15 `PARTIAL`, migration 008 suspensa e matching fora de âmbito.

- **R4-002 MEDIUM — corrigido/validado:** `assert_007_down_safe` agora bloqueia e verifica `taxonomy_idempotency_record` nos dois loops. A tabela é uma raiz independente, sem FK para release. Down SQL permanece intacto e conservador. Manifest up/checksum/fingerprint atualizados coerentemente.
- Prova PostgreSQL 17 no gate canónico: inserir apenas um resultado de idempotência pela role runtime; tentar `runner.downgrade` para 006; recusa preserva o registo, snapshot integral de schema, ledger com oito entries, preflight/fingerprint 007 e ausência de nova publication. Remove-se exclusivamente o fixture criado na base descartável pelo teste; segue o percurso vazio 007→006→007 já existente. Teste estrutural exige a tabela tanto no loop de lock como no de leitura.
- **R4-001 HIGH — não corrigido:** a última validação F3 antecede observação física e revalidações assíncronas F4. A revisão anterior comprovou COMMIT após revogação de sessão ou avanço de autorização nesse intervalo, com release/F7/idempotência persistidos. Não se acrescentou uma leitura final para alegar eliminação de TOCTOU. O fence F4 atual protege allocation/diretório, não um intervalo de autoridade F3/F5.
- Bloqueio técnico/contratual: session registry e ports `membershipPort.revalidate`/`authorizationDataPort.load` não oferecem guard/lease de autoridade mantido até confirmação do commit. O registry PostgreSQL revoga por UPDATE; F5 recebe ports externos sem protocolo comum de exclusão com as alterações de grants/versões. Um guard apenas em memória não coordena API/worker/processos. Resolver exige definir a coordenação entre validação protegida, revogação e commit tenant, incluindo expiração, erro/commit incerto e ordem de locks; não foi inferida silenciosamente uma mudança nas fundações F3/F5.
- Validação executada da correção local: focados F13/F3/F4/F5/F7/composição **276/276 PASS**, backend **607/607 PASS**, gate PostgreSQL F13 **PASS**, F13-P1 **PASS**, `node --check` nos **45 JavaScript PASS**, `git diff --check PASS`. Primeiro ensaio F13 recusou o fingerprint antigo; o fingerprint observado foi pinned antes de repetir com sucesso. Gate F12/F9 e revisão final têm resultados reportados no handoff, sem antecipar PASS aqui.
- Up 007 checksum atual: `c327d759936b69df5f495e2454f209a6ddd34c94dc512933f700363a8cd5a900`; fingerprint 007 atual: `17df0837daf146752e94fc7c870e58b653e23dd1051ea31b697e37d1c477b909`. Down checksum intacto: `958ae2d8ef4153fe3387b82706d66edff55ddf76199f853f67397f6da1a33eca`; fingerprint 006 intacto: `29a98501da147ab979043e156e290c7f625dcc442b6da593c1c6ff135bbea70f`.
- Alterados nesta correção: SQL up 007, manifest, teste `f13CatalogFoundation.test.js`, gate `test/integration/f13/gate.js` e os dois documentos F13. Preservadas as restantes alterações; sem stage/commit ou migration 008.

**Readiness histórica desta tentativa parcial:** não pronta para fecho; substituída pela implementação autorizada documentada abaixo.

## Authority commit guard durável — implementação autorizada (2026-10-11)

Esta secção prevalece sobre as declarações históricas de R4-001 aberto e de migrations 008–009 não autorizadas: foi autorizada **apenas Central 009**, com numeração independente. Tenant 008 permanece suspensa/ausente. F13 mantém `In Progress`, AC-13/AC-15 `PARTIAL`; não há stage, commit, matching ou fecho automático.

- Ownership: `security/authorityCoordinator.js`, `security/authenticatedAuthority.js` e `authorization/resourceAuthorization.js`/`authorityDataRepository.js`. OrganizationalProfile consome o contrato; não gere revogações, epochs ou a persistência de autoridade. A composição root OIDC cria o coordenador e liga registry, membership repository, session store e fonte F5 Central. Não aceita ports F3/F5 arbitrários como autoridade produtiva da taxonomia.
- Central 009 acrescenta guard durável, requests de escrita, epochs monotónicos, permits transaction-local, fonte F5 versionada e role coordenadora sem privilégios administrativos. ACLs impedem runtime/PUBLIC de escrever estas tabelas; triggers obrigam os writes relevantes a passar pelo permit e a finalizar o request na mesma transação. Identificadores pseudónimos, digest da sessão, operações/resources, versões, assurance normalizada, nonce/correlation/idempotency/digest, binding físico resumido, deadline e resultado codificado; sem tokens, claims integrais, conteúdo funcional, strings de conexão ou credenciais.
- Caminho obrigatório: revogar/rotacionar/bind/expirar sessões, destruir/alterar/touch do session store, revogar sujeito, alterar status/versão de membership, alterar grants/versões/policy/requisitos de assurance. Alterações relevantes de status/session-revocation-version do sujeito e status/mfa-policy da organização também são protegidas em SQL. Criação inicial de entidades/sessões é distinta de revogação; heartbeats `last_seen_at` e transações OIDC não mudam a autoridade e estão excluídos. Não foram criadas APIs administrativas completas.
- Revalidação F3/F5 ocorre na mesma conexão Central, com mutex advisory transaction-local `(43001306,1)` adquirido antes dos row locks. O guard PREPARED é persistido antes de qualquer mutação funcional/F7/resultado tenant. A transação física tenant já tem BEGIN, nonce advisory e loaders/locks para resolver o recurso exato; esses passos anteriores ao PREPARED não escrevem dados funcionais. Capabilities e tokens são privados, ligados ao client/nonce/tenant/operacão e invalidados após conclusão.
- Linearização: COMMIT Central que persiste PREPARED vence um request de escrita posterior. Esse request regista WAITING, avança o epoch e impede novos guards/handles, mas aguarda todos os guards anteriores antes de aplicar a revogação. Request/epoch anterior vence um guard posterior: autoridade stale ou pending falha antes de ALLOW F5 e dos efeitos tenant. Writers sobrepostos usam ordem crescente de epoch, aguardando fora de qualquer transação Central; os writes efetivos e APPLIED são atómicos, incluindo constraint triggers deferred verificados antes de remover o permit.
- Ordem de locks: tenant nonce → advisory DAG quando aplicável → intenção idempotente → recurso/release/conteúdo → mutex Central curto de validação/PREPARED. Writers: mutex Central → request/epoch → rows F3/F5; nunca aguardam o fim tenant com o mutex Central adquirido. Recovery lê Central, liberta a conexão, adquire conexão operacional tenant/nonce, termina essa transação e só depois finaliza Central. Não há lock Central aberto enquanto se aguarda COMMIT/recovery tenant.
- Estados: PREPARED → TENANT_COMMITTED (acknowledgement real) ou ABORTED (rollback confirmado); COMMIT incerto → TENANT_COMMIT_UNKNOWN → RECOVERED com resultado COMMITTED/ROLLED_BACK/READ_TERMINAL. Um PREPARED abandonado também pode terminar RECOVERED. Replay/reconciliação reautorizam F3/F5 e recarregam o recurso antes de devolver qualquer resultado. F7 recebe exatamente a avaliação F5 guardada, uma única vez na transação tenant.
- Recovery: lease expirado não prova rollback. O port operacional branded verifica a identidade/binding físicos e adquire o advisory lock do nonce original; se necessário termina apenas o backend expirado cujo pid, backend_start completo, database e lock nonce coincidam. Só após demonstrar terminação consulta `(organization, operation, key, digest)` no storage idempotente source-local. Resultado divergente/drift/falha de acesso mantém o guard pendente e bloqueia a autoridade, fail-closed. Recovery repetido é idempotente. Request WAITING abandonado pode ser cancelado sob mutex após deadline: o trigger deferred garante que nenhum efeito de autoridade pode ter cometido sem APPLIED atómico; o pedido falhado exige retry pelo proprietário, não se aplica uma revogação inferida.
- Deadline limita aquisição, callbacks, SQL e leases; guard expirado não inicia novo COMMIT. COMMIT já enviado pode ter outcome incerto e conserva a exclusão durável até prova source-local; não é alegado atomic commit distribuído ou garantia de tempo real sobre fsync/rede. Recovery é função operacional privada `recoverExpired` mais invocação reativa dos writers; rollout de worker externo não foi comprovado.

### Evidência desta execução

- Focados F13/F3/F4/F5/F7/composição/Central: **305/305 PASS**. Suite backend final: **613/613 PASS**, sem skips/TODO. `node --check` em **62 JavaScript PASS** e `git diff --check PASS` (avisos Git LF/CRLF não são erros de whitespace).
- Gate F13 PostgreSQL 17 **PASS**, sem bypass do fingerprint: Central real + tenants A/B; seis mudanças (sessão, membership, grants, versão, policy, assurance) com ambas as ordens de linearização; pending writer recusa novo guard/capture; crashes reais via subprocesso antes/depois do commit tenant e durante write Central; COMMIT incerto; lease expirado; tokens forjados/reutilizados; recovery repetido; isolamento e F7 persistido igual à decisão F5.
- Repetição final F13 acrescenta grants unitários da fonte Central real: read-only recusa create e create-only não permite read, apesar da base role ORG_ADMIN; `centralUnitGrantsAsymmetric=true`. Nenhuma recusa persiste release/F7/idempotência.
- Central 009 canónica: 008→009→008→009 com preflight/fingerprints, remoção/recriação da role/ACLs e falha tardia de ledger que preserva schema e ledger. Gate F12 **PASS** com dez versões Central e oito tenant, instalação vazia/upgrades/concurrency; F9 PostgreSQL **3/3 PASS**, incluídos no gate. Gate F13-P1 **PASS**.
- R4-002 revalidado no gate F13: dados apenas em `taxonomy_idempotency_record` recusam down 007 sem perda; depois roundtrip vazio **006→007→006→007** pelo runner, com ACLs audit, roles, F7, ledger/preflight/fingerprints e rollback em falha de ledger. Tenant 007 não foi alterada nesta implementação.
- Central 009: up `c3bd5290766fcb6fe61c43f8e747fae6b233f1e72d82abc1e0b1301889faad87`; down `35a8fe74ac51b82d8fc730456dc5fdad2771456a85a624339a59f088b493126e`; fingerprint `d351e0142f4c73fa749e161bbfa8c007ff1d73d0d31993aa6418ef4e7e07e9f7`. Checksums up/down pinned; sem tolerância CRLF histórica nesta nova migration. Tenant 007 conserva os checksums/fingerprints R4-002 acima.
- R1-001–007, R2-001–004 e R3-001–003: correções anteriores preservadas/revalidadas pelos gates; R4-001/R4-002: implementação e provas concluídas, **aguardam revisão formal independente**, não aceitação automática.
- Scans em **70 ficheiros** alterados/untracked de código/SQL/PowerShell/contexto: private-key/provider tokens, literais de conexão, emails e campos NIF/passport/IBAN/telefone. Três candidatos são URLs-canário explícitas dos testes de sanitização `f42TenantLeaseExecutor`/`f43TenantRunner`; nenhum secret real ou PII encontrado pelos padrões usados. Não se alega deteção universal. Recursos descartáveis dos gates removidos pelo próprio finally; containers/volumes preexistentes preservados, sem prune global.
- Limitações: IdP externo, rollout e SLO produtivo não demonstrados; registos de coordenação requerem política futura de retenção (não se eliminam automaticamente); binding antigo indisponível/drift pode exigir intervenção operacional, mantendo o acesso fechado; config F5 deve corresponder à policy versionada Central; não há entrega automática de uma revogação cujo request foi cancelado. Superuser/owner de emergência fora do runtime continua autoridade administrativa e não é fronteira adversarial protegível por triggers comuns.

Comandos executados em `backend`: `npm test`; `node --test` com seleção de ficheiros F13/F3/F42/F43/F44/F5/F7/composição/Central (**305** testes); `node --test test/f5AuthorityCommitGuard.test.js` (ensaio inicial **5/5**, depois acrescentado teste dos dois checksums). Na raiz: `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/migration-gate.ps1`, equivalente para `f13p1` e `f12`; F9 real executado pelo gate F12. Ensaio inicial de captura do fingerprint 009 seguido de pin e repetições sem bypass; todos os gates finais PASS. `node --check` em todos os JS tracked alterados + untracked; `git diff --check`; scan read-only e inventário Docker. Uma tentativa de scan Node inline falhou por quoting PowerShell, substituída por scan PowerShell concluído; não foi contado como PASS.

**Readiness histórica R4:** substituída pela correção R5 abaixo; não constitui aprovação de fecho.

## Correção F13-S3-R5 — identidade dedicada e ACLs fail-closed (2026-10-11)

Esta secção prevalece sobre os pins e declarações de readiness R4 anteriores. F13 permanece **In Progress**, fatia 3 em correção até nova revisão read-only; **AC-13/AC-15 PARTIAL**, tenant 008 suspensa/ausente. Sem matching, APIs administrativas, stage ou commit. Alterações preexistentes preservadas.

### Modelo produtivo e matriz de privilégios

| Identidade | Login / atributos | Memberships | Privilégios do protocolo |
| --- | --- | --- | --- |
| `c4g_authority_owner` | NOLOGIN, NOINHERIT; sem SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE/REPLICATION | apenas `c4g_central_owner` recebe esta role para migração/emergência | owner das cinco tabelas, sequência, schema `authority_api` e cinco funções; SELECT F3, UPDATE de membership, UPDATE restrito de sujeito/organização e CRUD de session registry/store/OIDC; sem CREATE em `public` após instalação |
| `c4g_authority_coordinator` | NOLOGIN, NOINHERIT; sem atributos administrativos | não recebe owner nem outras roles | apenas USAGE em `authority_api` e EXECUTE em `authority_api.execute(text,text[],text)`; zero DML/SELECT de tabelas do protocolo e zero privilégios de sequência |
| `c4g_authority_runtime` | LOGIN, NOINHERIT; sem atributos administrativos | coordinator com INHERIT TRUE, SET FALSE, ADMIN FALSE | herda exclusivamente o acesso à função fechada; SELECT nos dois markers/ledger para admissão; zero DML direto no protocolo, zero USAGE de sequência; SET ROLE owner/coordinator/general recusado |
| `c4g_central_runtime` | atributos históricos mantidos/pinned | **não recebe coordinator nem owner** | zero acesso a `authority_api`, tabelas, sequência ou funções do protocolo |
| PUBLIC | sem grants no protocolo | — | zero ACL de tabelas, sequência, funções e schema privado; USAGE histórico no schema `public` não é acesso ao protocolo |

Ownership em `security/authorityCoordinator` / `authorization`; OrganizationalProfile só consome o contrato. `config/authorityDb.js` cria uma pool exclusiva com `AUTHORITY_DATABASE_URL` ou `AUTHORITY_DB_*`, sem fallback para credenciais gerais. A root OIDC exige objeto pool distinto, injeta-o explicitamente no coordinator e mantém identity/jobs/catalog na pool geral. A admissão verifica **session_user = current_user = c4g_authority_runtime** no client realmente adquirido, antes do protocolo; pool com credenciais gerais/owner é recusada. Nenhum SET ROLE é utilizado pelo coordinator. A pool dedicada não é devolvida na superfície funcional.

### SQL fechado, finalização e coordenação

- Uma única função SECURITY DEFINER, owner NOLOGIN, `search_path=pg_catalog,public,pg_temp`, SQL fully-qualified e parâmetros quotados em passagem única. Aceita **52 códigos SHA-256** de queries estáticas, incluindo os três SELECT F3 interpolados de membership e os quatro comandos do PgStore; não aceita SQL arbitrário. Valida código, aridade e tamanho dos parâmetros. Os quatro trigger functions também têm owner NOLOGIN/path fixo, sem EXECUTE runtime/PUBLIC. Teste liga cada código à SQL pinned e as três queries produzidas pelo repository ao catálogo.
- Transições autorizadas: request WAITING → APPLIED/CANCELLED, avanço monotónico de epoch, permit REGISTER/APPLY ligado a `txid_current`/backend/request, source writes F3/F5 com deferred APPLIED, guard PREPARED → TENANT_COMMITTED/ABORTED/TENANT_COMMIT_UNKNOWN → RECOVERED. Reads F3/F5 e callbacks do PgStore usam a mesma conexão da transação Central protegida, através da função fechada.
- Finalizar/alterar guard exige permit HMAC privado derivado de guard/nonce/tenant; Central guarda **só o digest**. O permit é gerado após acknowledgement físico F4 ou evidência tenant validada pelo recovery branded; não é exposto ao caller. SQL valida-o e o trigger verifica-o em UPDATE. DELETE de guards é recusado; não existe retenção automática. Um grant indevido SELECT/UPDATE/DELETE ao runtime geral não permite finalizar/apagar o guard nem desbloquear a autoridade.
- `AUTHORITY_COMMIT_PERMIT_SECRET` é uma chave privada estável fora do Central, mínimo 32 bytes, obrigatória e sem default produtivo. API e recovery/processos autorizados precisam da mesma chave; não rodar/perder a chave com guards pendentes. Rotação/escrow/provisionamento externo não foram implementados. Password do login dedicado é provisionada por canal operacional autorizado, nunca em SQL versionado. Credenciais de teste são aleatórias e distintas das de administração.
- Sem alteração da linearização R4: COMMIT Central de PREPARED vence writers posteriores; WAITING/epoch anterior recusa novos guards; autoridade efetiva só muda depois de todos os guards anteriores terem terminado/reconciliado. Mutex `(43001306,1)` antes dos row locks Central, nunca mantido enquanto se espera tenant/recovery. Mesma conexão física tenant para loaders/F5/mutação/F7/idempotência/commit. COMMIT incerto conserva exclusão até prova source-local, nunca assume rollback por deadline/crash.

### Preflight e provas desta execução

- Snapshot exato de atributos de roles (incluindo LOGIN, INHERIT, expiry/config e atributos administrativos), memberships e ADMIN/INHERIT/SET options, owners, ACLs/grant options de schemas public/privado, tabelas, colunas, sequência e funções; inclui privilégios adicionais das authority roles fora do protocolo e funções/trigger bodies. PUBLIC e runtime geral fazem parte da comparação. Excesso de privilégio falha, não apenas ausência.
- Snapshot ACL incorporado no fingerprint canónico Central e num security fingerprint independente. Admissão valida a segurança em cada aquisição e novamente sob mutex; primeiro uso do client executa também o preflight canónico completo. Nenhuma tolerância para ACL adicional. Não é declarada proteção contra superuser/owner de emergência que altere o próprio mecanismo.
- PostgreSQL 17 com **session_user real limitado**: fluxo completo; runtime geral/owner recusados como pool de coordinator; SELECT/INSERT/UPDATE/DELETE/TRUNCATE diretos, sequência, DDL/admin e SET ROLE indevido recusados. Código SQL desconhecido recusado; parâmetros que contêm `$1`, quotes e SQL continuam dados, não comandos.
- **25 cenários ACL PASS**: cinco DML/table grants, coluna UPDATE, sequence USAGE, EXECUTE geral, membership, ADMIN/SET options, owner, PUBLIC SELECT/EXECUTE/schema USAGE/CREATE public, SELECT direto do login, SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB/REPLICATION/INHERIT, executor LOGIN e role configuration. Cada drift recusa preflight e nova admissão; reparação administrativa explícita é seguida de preflight válido. Mesmo membership indevida não ultrapassa o check session_user da função.
- Cenário obrigatório **PASS**: guard PREPARED numa transação tenant real; drift SELECT/UPDATE/DELETE; nova admissão fail-closed; general runtime e permits forjados não finalizam, guard permanece PREPARED e efeitos tenant não visíveis; reparação autorizada; COMMIT incerto reconciliado em RECOVERED/COMMITTED, **uma mutação, um F7, um resultado idempotente**. A exclusão durável foi preservada.
- R4-001 revalidado: seis mudanças de autoridade × ambas as ordens, crashes de subprocesso antes/depois do COMMIT e de writer, lease expirado, recovery repetido, tokens stale/reutilizados, dois tenants, F7 real igual à F5. Central 008→009→008→009 pelo runner, rollback de falha de ledger, remoção/recriação das três roles/schema/ACLs; down com dados protegidos recusado e fingerprint/ledger preservados.
- R4-002 revalidado no gate F13: idempotência isolada impede downgrade; roundtrip vazio canónico 006→007→006→007, ACLs audit/roles/F7/ledger/preflight preservados. **Tenant 007 não foi alterada nesta correção.**
- Resultados finais: focados F13/F3/F4/F5/F7/composição/Central **308/308 PASS**; backend **616/616 PASS**, zero skips/TODO; gates F13, F13-P1 e F12/Central **PASS**; F9 PostgreSQL **3/3 PASS** no gate F12. Repetição F13 final **PASS**, incluindo UPDATE direto em todas as tabelas, parâmetros adversariais, membership indevida e o cenário ativo de drift/reconciliação. `node --check` **67 JS PASS**, `git diff --check PASS` e verificação adicional dos **35 untracked PASS**. Uma linha vazia no EOF de um módulo novo foi removida após esta última verificação.
- Scans finais em **75 ficheiros** JS/SQL/PowerShell/Markdown alterados/untracked: private-key/provider tokens, URLs de conexão, emails e identificadores NIF/passport/IBAN/telefone. Nove candidatos de URL revistos: três canários de sanitização, dois endpoints sintéticos sem credenciais e quatro URLs construídas com variáveis dos fixtures; nenhuma credencial real ou PII encontrada pelos padrões usados. Sem alegação de deteção universal. Containers/volumes descartáveis desta execução removidos pelos próprios finally; inventário final sem nomes dos gates/capturas desta execução, recursos preexistentes preservados, sem prune. Zero ficheiros tenant 008, zero stage/commit.
- Comandos: `npm test` em backend; `node --test` com ficheiros selecionados por `(f13|f3|f42|f43|f44|f5|f7|productionCompositionParity|centralMigration).*\.test\.js$`; na raiz `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/migration-gate.ps1`, equivalentes `f13p1` e `f12` (inclui F9 PostgreSQL/Central); `node --check` em todos os JS alterados/untracked; `git diff --check` e `git diff --no-index --check` em untracked; scan read-only e inventário Docker. Git emite avisos LF/CRLF, não erros de whitespace. O primeiro script de untracked interpretou incorretamente exit 1 de no-index como erro; foi repetido verificando efetivamente a saída de whitespace.
- Ensaios não contados como PASS: primeiro harness ACL ficou bloqueado e o seu container descartável foi interrompido; dois gates F13 seguintes recusaram as queries F3 ausentes, que foram explicitamente incluídas, mantendo o catálogo fail-closed. Um double do preflight de revisão antiga não modelava `pg_sequence`; foi corrigido sem enfraquecer o preflight. As repetições finais passam sem bypass de fingerprints; captura inicial dos novos pins não é admissão produtiva.

Pins finais Central 009: up `ac647889866689c44887df39db2b63393a1fcf600031a184729cf53ef46376ce`; down `5b0621f15506bfb301f9e76ef3f7f08c05925c4255ce0c849bfc3ff8f14b6e4f`; schema fingerprint `25f2be4aff92171756eef86d474882eb7208bfe829ff3f8f7cac269202029e26`; security fingerprint `43e9053ba4b6ae5f2c2163d4cc94946dc706f687971867c82040536b8bd75e6f`.

**Estado:** R5-001/R5-002 implementados e comprovados, aguardam nova revisão formal read-only; R4-001/R4-002 preservados/revalidados, não encerrados automaticamente. R1–R3 preservados pelos testes/gates. AC-13/AC-15 continuam PARTIAL. Limites: IdP externo, rollout/SLO e worker operacional externo não comprovados; recovery indisponível/drift/chave perdida mantém exclusão fail-closed; sem política automática de retenção. Não há autorização de tenant 008 ou de fecho da fatia 3 nesta correção.

## Correções R6 e preparação da revisão read-only (2026-10-11)

A revisão R6 invalidou a declaração histórica de cobertura integral R5-002: grants PUBLIC/terceiros em fontes F3 não entravam no snapshot e o preflight completo só corria no primeiro uso do client. Esta secção substitui esses estados e pins; preserva o histórico sem promover critérios. **F13 In Progress; AC-13/AC-15 PARTIAL; fatia 3 não fechada; tenant 008 ausente/suspensa.**

- **R6-001 HIGH corrigido/provado:** `authoritySecurityManifest.js` seleciona os objetos protegidos antes de expandir ACLs e inclui todas as entradas, incluindo PUBLIC, qualquer role externa, privilégios de coluna e grant options. Fontes explícitas: `global_user`, `organization`, `organization_membership`, `application_session`, `application_session_store`, `oidc_transaction`, marker e ledger, além dos objetos do protocolo. Relações/colunas, schemas e funções adicionais owned/granted às authority roles também incluem todas as suas ACLs, não apenas a entrada cujo destinatário é uma authority role. Não se alteraram os grants legítimos F3.
- **R6-002 MEDIUM corrigido/provado:** removido o WeakSet/cache por client. Toda admissão verifica o session_user limitado, security fingerprint e preflight canónico completo, na mesma conexão efetivamente adquirida, antes do BEGIN da transação de metadata. Inclui PostgreSQL major, marker, ledger/checksums e schema fingerprint; não cria transações aninhadas. O check ACL sob mutex Central permanece. Conexão já utilizada não constitui evidência permanente de schema válido.
- Gate PostgreSQL F13 **PASS**: **47 drifts ACL** (25 anteriores + 22 novos em fontes F3, PUBLIC/role externa, colunas `sess`/`primary_email` e grant option), preflight e admissão recusados antes do callback funcional; login externo real inicialmente sem leitura da session store. **Dois drifts no mesmo client físico aquecido PASS**: remoção da constraint deadline e adulteração do checksum do ledger; callback não executado e admissão volta a funcionar após reparação explícita. Não há mocks como única prova destas correções.
- Guard PREPARED real + drift simultâneo no protocolo e SELECT PUBLIC da session store: nova admissão recusada, runtime geral/permit forjado não finalizam o guard, zero mutação/F7/idempotência visíveis; reparação administrativa explícita, COMMIT incerto e recovery produzem exatamente uma mutação, um F7 e um resultado. O fingerprint deteta o grant indevido; **não revoga nem impede a leitura permitida por um administrador enquanto esse grant existir**. Administrador DDL/ACL não é fronteira de segurança protegida pelo coordinator.
- R4-001 revalidado em Central + dois tenants: seis alterações de autoridade × ambas as ordens, crash antes/depois do commit e de writer, lease/deadline, recovery repetido, commits incertos e evidência F7/F5. R4-002 revalidado: recusa down com só idempotência e percurso canónico vazio **006→007→006→007**. Central **008→009→008→009**, falha tardia de ledger e down com dados protegidos também PASS. Roles/ACLs/fingerprints após down/up confirmados pelos gates.
- Comandos/resultados: `node --test` com seleção recursiva `(f13|f3|f42|f43|f44|f5|f7|productionCompositionParity|centralMigration).*\.test\.js$`: **308/308 PASS**; `npm test` em backend: **616/616 PASS**, sem skips/TODO. Gates `test/integration/{f13,f13p1,f12}/migration-gate.ps1`: **PASS**; F12 inclui Central e **F9 PostgreSQL 3/3 PASS**. `node --check` nos **67 JS** alterados/untracked PASS; `git diff --check` e whitespace dos **35 untracked** PASS. Scan read-only em **75 ficheiros**: zero private-key/provider tokens/PII nos padrões usados; nove URLs sintéticas/dinâmicas revistas, sem credencial real. Não é uma garantia universal de deteção.
- Ensaios não contados como PASS: primeira execução F13 usou `email` em vez da coluna real `primary_email`; segunda execução recusou corretamente o checksum adulterado mas a asserção esperava texto diferente do runner. Corrigidos apenas os testes; terceira execução integral passou. Captura dos novos fingerprints correu em Central descartável pelo fixture canónico e não equivale a admissão produtiva.
- Alterados nesta correção: `authoritySecurityManifest.js`, `centralMigrationManifest.js`, `authority-acl-gate.js`, `authority-commit-gate.js` e os dois documentos F13. SQL up/down Central 009 e tenant 007 **não alterados**; nenhum mecanismo alternativo de migration. Trabalho anterior/unrelated preservado; zero commit/stage/matching/tenant 008. Só recursos descartáveis desta execução são removidos pelos seus finally, sem prune.

Pins correntes Central 009: up `ac647889866689c44887df39db2b63393a1fcf600031a184729cf53ef46376ce`; down `5b0621f15506bfb301f9e76ef3f7f08c05925c4255ce0c849bfc3ff8f14b6e4f`; schema `9e975a00c3f11a6a4b7995c954d3cb437407751b10d35789a597acd69b0e6581`; security/ACL `4da6e49668d6c8620951291c9a6fad558731cd2f5d10c2b2770086e6914f2fe0`.

**Estado para handoff:** R6-001/R6-002 corrigidos e comprovados, sujeitos à revisão read-only que se segue; R5-002 só recupera a cobertura declarada com estas provas, R4/R5-001 preservados/revalidados. Nenhum fecho formal ou autorização de tenant 008 inferido. Limites anteriores de IdP/rollout/SLO/recovery operacional externo/gestão de chave/retention permanecem. O resultado da revisão read-only será comunicado sem editar ficheiros durante essa fase.

## Estado corrente — fatias 3 e 4 formalmente fechadas (2026-10-11)

As secções anteriores preservam a sequência histórica de implementação/correções; não são o estado atual. **O utilizador aprovou explicitamente o fecho formal da fatia 3 e, após a revisão formal read-only da fatia 4 sem findings bloqueadores, o fecho desta última.** R1–R6 encerrados no âmbito revisto; não reabertos sem evidência concreta nova. Fatia 4 formalmente fechada apenas no âmbito de tenant 008 e criação/edição/submissão de drafts. F13 mantém **In Progress** e AC-13/AC-15 **PARTIAL**. Nenhum AC integral foi promovido, nem se inferiu autorização de approval/publication, snapshots/activation, F14, frontend ou assertions territoriais/beneficiários completas.

### Implementação e fronteira

- Tenant `008_f13_profile_authoring_and_assertions` up/down, manifest/capability/fingerprint/preflight e compatibilidade dos consumidores F12/F13-P1/taxonomia atualizados. ACLs de tabelas, colunas, schemas e funções usados pelo authoring entram na comparação exata do fingerprint (incluindo excessos). **007 e Central 009 não alteradas**, numerações distintas preservadas.
- Novos módulos `authoringContracts`, `authoringResources`, `authoringRepository`, `authoringService`, `authoringComposition`, `authoringTenantOperations`, `authoringAudit`, `authoringTelemetry`; exposição funcional root `profileAuthoring.bindTenant`, não transaction service. F3 OIDC/contexto server-side, membership/F5 produtivos, client F4 fisicamente preparado e guard durável Central reutilizados. Autoridade permanece em security/authorization, não OrganizationalProfile.
- Draft lógico mutable apenas em head/lifecycle; revisions, item versions, ligações revision→items e resultados source-local append-only. Edit substitui explicitamente a lista material e cria revision por CAS. Submit cria revision SUBMITTED e recusa edições posteriores; não aprova/publica/ativa. Guard deferred exige história contígua e head/lifecycle consistentes; o resultado sela o conjunto de items da revision.
- Primeira representação material é deliberadamente restrita: até 100 referências tipadas THEMATIC_AREA/STRATEGIC_PRIORITY, KNOWN com concept do scheme/release publicado ou UNKNOWN sem valor; item/version UUIDs explícitos, estados fixos documentados UNVERIFIED/CLEAR/DRAFT/INTERNAL. Nenhum payload livre, auto-verificação ou migration de dados legacy. Restantes domínios/assertions e completeness permanecem por implementar.
- Create resolve PROFILE_SCOPE por scope selector validado; edit/submit resolvem PROFILE_DRAFT bloqueado, scope e lifecycle atuais no servidor. ORG usa null selector, UNIT/TEAM requerem scopes F13-P1 ativos. F5 passa a ter três permissions/operations adicionais explícitas, resources exatos e grants positivos; bundles continuam vazios. ScopeId confiável é separado do resourceId do draft para grants UNIT/TEAM exatos.
- Ordem: preparação física/nonce F4 → mutex F13-P1 por organização → intenção org/op/key → row lock draft/resource → revalidação F3/F5 e guard → append/CAS → F7 → resultado → fencing físico → commit protegido. Mesma conexão em todos os passos tenant. Replay resolve e reautoriza antes de devolver o resultado; intenção divergente conflita. COMMIT incerto reconcilia o guard pela evidência source-local de PROFILE_DRAFT_CREATE/EDIT/SUBMIT, exige capability AUTHORING, depois resolve F3/F5 de novo. Reuso da recovery port só é permitido para a mesma dependência privada; fonte/operação não pertence a mapa fechado falha.
- F7 acrescenta três eventos críticos na mesma transação, identidade e versões/policy/assurance avaliadas, correlation/key, anterior/nova revision e digest; sem items, labels ou PII. F10 usa apenas operation/resultClass fechados.

### Provas executadas

1. `node --test` com seleção recursiva `(f13|f3|f42|f43|f44|f5|f7|productionCompositionParity|centralMigration).*\.test\.js$`: **315/315 PASS**; `npm test` em backend: **623/623 PASS**, sem skips/TODO.
2. `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/authoring-gate.ps1`: **PASS**. Central real + dois tenants; 007→008 canónico, rollback completo antes do ledger e segunda execução; duas sessões/CAS (um vencedor), mesma key concorrente (um resultado), conflito de intenção, segregação por operação/A/B, identidade injetada/handle forjado antes de SQL/F5 positivo, resources diferentes/grants assimétricos, versões stale/revogação impedindo replay, scopes UNIT/TEAM server-side, F7 persistido igual à decisão F5 e rollback das três mutações perante falha de append. COMMIT confirmado fisicamente mas resposta perdida produz RECOVERED/COMMITTED com um resultado/evento. Drift físico final reverte integralmente. SQL independente prova append-only, revision selada e orphan revision recusadas. Drifts UPDATE de items, CREATE do schema de scopes e EXECUTE de trigger para PUBLIC recusam preflight; reparação explícita recupera-o. KNOWN só aceita scheme correto de release governada publicada; taxonomia produtiva continua funcional sobre 008.
3. `test/integration/f13/migration-gate.ps1`: **PASS** na repetição integral, baseline 007/R1–R6 preservada, 47 ACL drifts, dois drifts no mesmo client, seis corridas de autoridade nas duas ordens, crashes/recovery, F7/F5, locks DAG e down canónico **006→007→006→007**, incluindo R4-002. Central **008→009→008→009**, rollback ledger, identidade dedicada limitada e guards protegidos continuam PASS.
4. `test/integration/f13p1/migration-gate.ps1`: **PASS**.
5. `test/integration/f12/migration-gate.ps1`: **PASS**, incluindo gate Central e manifest cumulativo tenant com instalações vazias e upgrades **003/004/005/006→008**. Inclui F9 PostgreSQL **3/3 PASS**, pg-boss/outbox/inbox/relay/fencing, replay e regressões F12/F11.
6. `node --check`: **78 JS PASS**. `git diff --check` e check whitespace dos **48 untracked PASS**. Scans read-only de private keys/provider tokens e NIF/IBAN em **90 ficheiros**: zero segredos conhecidos ou PII real identificados; nove URLs canary/dinâmicas e um falso positivo numérico (`c4g.document.bytes` bucket) revistos. Limite: scans por padrões, não garantia universal.
7. Docker: removidos somente containers/volumes descartáveis criados pelos gates/capturas desta execução, incluindo um ensaio interrompido explicitamente identificado. `docker ps` final mostra apenas `c4g-postgres17-dev` e `c4g-collabora-code` preexistentes; nenhum prune ou remoção de recursos alheios. Índice sem alterações; sem commit/stage.

Ensaios intermédios **não contados como PASS**: fixtures ainda esperavam total de catálogos/schema 007, uma asserção de TRUNCATE atingiu FK antes do trigger, cleanup usou nome de método inexistente (corrigido para closeAll), e gates lançados durante atualização dos pins recusaram corretamente a fonte temporariamente divergente. Um ensaio F13 teve recusa genérica de persistência ao repetir aprovação após F7 falhado; não se atribui causa não demonstrada nem se esconde o resultado — a repetição integral com pins estáveis passou. Capturas SQL para gerar fingerprint/down vazio não são provas de downgrade pelo runner.

### Pins e critérios

- 008 up checksum: `7a6921546c6902bb59f6b3f34adbde4266e7eb947370cf0e7390b67b07edb30c`.
- 008 down checksum: `47a908e9f1b30ffb4337f68af34c81cfed0aabd72aff9d2f4a74aee702a4995d`.
- 008 schema fingerprint: `7ee1e9277e39c0016985061fe0ddcd03980474680f9855ee50fc2aebe59f4b8f`.
- Captura transacional do down vazio devolveu exatamente fingerprint 007 `17df0837daf146752e94fc7c870e58b653e23dd1051ea31b697e37d1c477b909`; down com dados recusa e rollback preserva snapshot/ledger. **Não foi criado downgrade canónico 008→007**: runner mantém somente 007→006 autorizado. 008 não é aplicada a produção nesta execução.
- Evidência parcial reforçada para AC-01/02/04/05/09/10/11/12/13/18/20/21/22/25/29/31/32, exclusivamente para este núcleo. AC-13/AC-15 e todos os estados da matriz permanecem inalterados. A fatia não demonstra criteria integrais dependentes de approval/publication, activation/snapshots ou domains não implementados.
- Persistem limites de rollout/IdP externo/SLO/recovery operacional/gestão de chave/retention. Sem novas APIs HTTP administrativas ou frontend. O fecho documental abaixo não elimina estes limites nem representa rollout produtivo.

### Revisão independente e fecho formal da fatia 4 (2026-10-11)

- Veredicto da revisão formal read-only imediatamente anterior: **sem findings bloqueadores**; nenhum problema concreto classificado como BLOCKER, HIGH, MEDIUM ou LOW no âmbito entregue. Decisão humana subsequente: registar o fecho formal mantendo limites e estados dos critérios. Esta alteração é exclusivamente documental; não constitui nova execução dos testes.
- Provas repetidas nessa revisão: focados F13/F3/F4/F5/F7/composição/Central **315/315 PASS**, backend **623/623 PASS**; gates PostgreSQL authoring 008 (Central real + dois tenants), F13, F13-P1 e F12/Central **PASS**, F9 PostgreSQL **3/3 PASS**. Validados CAS, append-only, isolamento A/B, F5 real/grants assimétricos, replay reautorizado, F7 persistido/rollback e reconciliação de COMMIT incerto sem duplicação. R1–R6 da fatia 3 preservados, sem reabertura.
- Prova concorrente adicional em memória, sem editar o harness: sessão com role runtime tentou inserir material na revision ainda não confirmada pela transação funcional; PostgreSQL recusou por FK (`23503`), a revision 2 manteve zero items conforme o comando. Ensaios exploratórios preliminares inconclusivos/erro de harness não foram contabilizados como PASS nem convertidos em findings. Captura transacional adicional confirmou down 008 vazio com retorno exato ao fingerprint 007; down com dados protegidos recusado e rollback preservado. Estas capturas não são downgrade canónico 008→007.
- Verificações da revisão: `node --check` **78 JS PASS**, `git diff --check` e whitespace dos **48 untracked PASS**; scans por padrões em **90 ficheiros** sem credenciais/PII reais identificadas, sem garantia universal. Hashes do worktree e índice inalterados durante a revisão; recursos descartáveis próprios removidos e preexistentes preservados. Pins 008 acima confirmados, sem alterar migrations 007/Central 009.
- **Fecho restrito:** até 100 referências THEMATIC_AREA/STRATEGIC_PRIORITY, KNOWN/UNKNOWN e estados fixos já documentados; create/edit/submit apenas. Aprovação/publicação, snapshots/activation, restantes domínios/assertions, completude/projeções completas, frontend e matching continuam fora. Downgrade canónico 008→007 permanece não implementado; runner autoriza somente 007→006. IdP externo, rollout, SLO e limites operacionais de recovery/chaves/retention não são declarados comprovados.
- **F13 In Progress; matriz de AC inalterada; AC-13/AC-15 PARTIAL; nenhum AC promovido a PASS.** Não se arquiva nem se marca Complete a feature integral, pois apenas uma fatia foi fechada. Próxima fatia aguarda plano/âmbito e autorização explícita; nenhum desenvolvimento adicional iniciado. Alterações existentes preservadas, sem stage/commit.

## Fatia 5 — implementação e evidência (2026-10-11)

**Aprovação formal:** pedido humano explícito aprova competências/experiência/evidências e tenant `009_f13_competencies_and_experience`. Contratos mínimos foram registados na secção de planeamento acima antes do código; a matriz normativa detalhada consta da especificação. Fatia 5 pronta para **Review read-only**, não fechada. F13 **In Progress**; todos os AC mantêm os estados anteriores, AC-13/AC-15 **PARTIAL**, AC-14 mantém PENDING na matriz até avaliação formal do critério integral.

### Entrega e contratos

- Nove módulos `competencyContracts/Resources/Repository/Material/Service/Composition/TenantOperations/Audit/Telemetry`, expostos pelo root apenas em `profileCompetencies.bindTenant`. Cinco operações produtivas, 40 permissions/42 operations F5 no catálogo cumulativo, bundles vazios; dois edits reutilizam explicitamente draft.edit. Funções transacionais permanecem internas à composição preparada.
- Tenant 009 acrescenta oito tabelas RLS/FORCE RLS: catalog release/entry, assertion version, experience version, evidence link, verification result, revision member e source-local idempotency. Runtime lê catálogos globais/tenant e só SELECT/INSERT nos factos/history; UPDATE/DELETE/TRUNCATE são recusados. Catálogos produtivos vazios; nenhuma seed editorial. Tipos/métodos/frameworks/níveis produtivos e gestão editorial continuam pendentes.
- CAS e histórico append-only de draft revisions preservam as referências exatas. Edits temáticos/submit existentes copiam os membros novos; sets substituem somente o domínio explícito e removem links correntes incompatíveis. Verificação cria um resultado separado; factos permanecem UNVERIFIED e não há auto-verificação. Novo material invalida conservadoramente a verificação corrente sem apagar a história; lifecycle completo DISPUTED/REVOKED/EXPIRED permanece fora desta entrega.
- Guard Central existente passou a avaliar também DOCUMENT_READ exato quando necessário, sob a mesma coordenação/versões F3/F5. Não houve alteração à SQL Central 009. F11 metadata AVAILABLE/CLEAN/binding é carregada sob lock por função fechada owner NOLOGIN; o runtime F13 não recebe SELECT de document_version, object IDs/URLs nem acesso a conteúdo. Replay volta a resolver o recurso, estado/binding documental e autoridade antes de retornar.
- Idempotência org/op/key/digest/resultado, fontes fechadas de recovery e commit protegido F4/Central existentes; mesma conexão preparada, mutex organizacional → intenção → draft lock → F3/F5/guard → revision/CAS → F7 → resultado → fencing/commit. ReadEvidenceLink é READ no catálogo F5 e escreve somente F7/resultado pela exceção auditada fechada do executor, não uma licença READ genérica para mutação.
- Manifest/checksums/preflight/fingerprint e matrizes F12/F13-P1/taxonomia/authoring admitem 009. Runner suporta apenas o down adicional fechado **009→008**, com checksum down pinado, preflight/ledger/lock/fingerprint; contrato histórico **007→006** continua preservado no prefix correspondente. **008→007 não foi autorizado/implementado.** Roadmap lifecycle/activation renumerado para migration tenant posterior.
- SQL tenant 008 e Central 009 e `.vscode/settings.json` preservados byte a byte face ao início; nenhum stage/commit. Alterações nesta execução limitam-se aos módulos/migration novos, extensão de authoring/authority/recovery/runtime/manifests/compatibilidade, catálogos/eventos/telemetria, testes/gates e dois documentos F13.

### Provas e comandos executados

1. `node --test` com seleção recursiva `(f13|f3|f42|f43|f44|f5|f7|f11|productionCompositionParity|centralMigration).*\.test\.js$`: **345/345 PASS**. `npm test` em backend: **631/631 PASS**, sem skips/TODO. Oito testes novos de contratos, ausência de autoridade injetável, catálogo F5/resources/MFA/SoD, contextos/client não preparados com zero SQL/F5/F7, digest e F10.
2. `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/competency-gate.ps1`: **PASS**, Central real + dois tenants PostgreSQL 17, engine F5 produtivo e F7 persistido. Runner **008→009→008→009** nas duas bases, ledger/fingerprint exatos, down com dados 009 recusado, rollback SQL+ledger injetado e segunda execução idempotente. CAS entre sessões (um vencedor), mesma intenção concorrente (um resultado), conflito de intenção, key igual em A/B isolada, many-to-many **2 assertions × 2 experiências = 4 links**, factos UNVERIFIED e resultado explícito VERIFIED separado. Edit temático mantém os membros; criador é recusado como verificador, independente com MFA consegue; MFA ausente/stale e método/validade incompatível recusados. Replay após perda de grants/versões recusado. Falha F7 nas **cinco operações** preserva contagens de mutação/history/resultado/F7; F5 negativo também. COMMIT confirmado com resposta perdida reconcilia RECOVERED/COMMITTED, source-local e F7 sem duplicação.
3. No mesmo gate: catálogo vazio, concept/level de kind incorreto e referência desconhecida recusados. Referência F11 sem DOCUMENT_READ falha; positive guard contém DOCUMENT_READ/DOCUMENT exato. Raw SELECT object_id/document_version com role runtime recusado. Replay/read é recusado após drift de resource binding ou QUARANTINED/ERROR, sem efeitos. UPDATE/DELETE/TRUNCATE das seis tabelas materiais/históricas são recusados. Evento F7 realmente persistido igual à assurance/policy da decisão F5; eventos e source-local têm cardinalidade igual.
4. `test/integration/f13/authoring-gate.ps1`: **PASS** no prefix 008 original, fechado explicitamente para não reinterpretar evidência histórica como teste 009; regressão authoring, F11/F5/F7, CAS/idempotência, isolamento, física/commit incerto e ACLs preservados. `test/integration/f13/migration-gate.ps1`: **PASS** (007/R1–R6), 47 drifts ACL, duas ordens de corridas de autoridade, crashes/recovery, DAG concorrente, Central down/up e tenant **006→007→006→007**. Findings fechados não reabertos.
5. `test/integration/f13p1/migration-gate.ps1`: **PASS**. `test/integration/f12/migration-gate.ps1`: **PASS**, incluindo Central e instalações vazias/upgrades **003/004/005/006→009**, manifest cumulativo, rollback/retry/concorrência/fingerprint, F12/F11; F9 PostgreSQL **3/3 PASS**, pg-boss/outbox/inbox/relay/fencing.
6. `node --check` em **90 JS PASS**; `git diff --check` tracked e `git diff --no-index --check -- NUL <untracked>` nos **63 untracked PASS**. Scans por padrões em **105 ficheiros**: zero private keys/provider tokens/JWT reais; dois falsos positivos numéricos revistos (315360000, limite de validade do método; bucket F10 104857600), onze URLs sintéticas canary/dinâmicas de gates sem credenciais reais persistidas. Scan por padrões não é garantia universal de deteção.
7. Cleanup dos recursos próprios feito pelos finally dos gates: no fim só containers preexistentes `c4g-postgres17-dev` e `c4g-collabora-code` ativos; nenhum container/volume de gate criado nesta execução ficou. Não foram removidos recursos preexistentes. Índice vazio preservado, sem stage/commit.

### Pins finais tenant 009

- Up SHA-256: `67b77c264e4d73b5c1eaf81e6b9fe697c6274fd0fc1dfeff5d4a4dd420adbb68`.
- Down SHA-256: `f99fd63315880e38529e751c989b68828c0f71e2334fc632416b05869f0d90d7`.
- Schema/ACL fingerprint: `8303439f92fede45fc692c96ece5792e419b554e51ac92d3e2b49df1a14bbf7b`.
- Down vazio pelo runner recupera exatamente 008 `7ee1e9277e39c0016985061fe0ddcd03980474680f9855ee50fc2aebe59f4b8f`; reaplicação recupera 009. Checksums SQL 008/Central 009 inalterados.

### Falhas durante desenvolvimento e limites

Não contaram como PASS: gate clonada esperava inexistência de tabelas 008 após falha 009 e recusa down sem conteúdo 009; estas expectativas foram corrigidas para a boundary aditiva real. Suite inicial 617/623 falhou em expectativas de contagem/versionamento; segundo ensaio 630/631 revelou ramo READ F12 sem compatibilidade 009, corrigido; repetição 631/631 PASS. Ensaio F11 tentou AVAILABLE/ERROR e foi corretamente recusado pela própria constraint F11; fixture alterada para QUARANTINED/ERROR, repetição integral PASS. Nenhuma constraint/guard foi relaxada para passar testes.

Alvo **AC-14**; evidência parcial adicional para AC-01/02/04/05/09/10/11/12/18/20/21/22/24/25/26/27/28/29/30/31, apenas nas partes efetivamente implementadas. Sem promover AC-13/AC-15 nem qualquer AC integral. Aprovação/publicação de perfis, snapshots/activation, outros domínios, frontend e matching ausentes; IdP externo/rollout/SLO/chaves/recovery operacional/retention não sobredeclarados. Revisão independente read-only ainda obrigatória antes de fecho da fatia 5.

## Fatia 5 — correções F13-S5-R1-001–003 (2026-10-11)

A revisão read-only anterior recusou o fecho com três reproduções PostgreSQL reais. Esta secção substitui a prontidão e os pins anteriores; preserva a evidência histórica, sem a interpretar como cobertura destes casos. Correções implementadas no âmbito autorizado; fatia não formalmente fechada. **F13 In Progress; AC-13/AC-15 PARTIAL; AC-14 PENDING; restantes estados inalterados.**

- **R1-001:** triggers BEFORE INSERT na tenant 009 validam concept, level, experience type e verification method no SQL runtime. Exigem kind fechado, release publicada com ownership coerente, catálogo global ou da organização do facto; level exige o mesmo framework/version/release do concept. Função invoker, search_path fixo, sem novos grants/SECURITY DEFINER. As FKs continuam necessárias mas deixam de ser a única validação. Down existente elimina os triggers junto das tabelas e a função; nenhum objeto adicional fica. Tenant 008/Central 009 intactas. Não é autorizado reescrever uma migration já aplicada em produção; esta revisão trata a migration ainda em desenvolvimento, sem rollout.
- **R1-002:** verificar/reverificar substitui exclusivamente os membros VERIFICATION ligados à assertion alvo, na mesma transação/draft lock. Outros resultados correntes permanecem; o histórico não é apagado. A invalidação conservadora por alteração material mantém o contrato anterior.
- **R1-003:** se também se perder a confirmação do COMMIT da tentativa de reconciliação, reconcilia-se o segundo guard durável e devolve-se F13_PERSISTENCE_UNAVAILABLE, nunca `{uncertainCommit,guard}`. O erro não afirma rollback: a primeira operação pode estar confirmada; retry da mesma intenção reautoriza e devolve o resultado source-local sem duplicar F7. Recovery continua durável caso a própria reconciliação fique indisponível.

Provas de implementação executadas: `npm test` **631/631**, focados recursivos F13/F3/F4/F5/F7/F11/composição/Central **345/345**; gates `competency-gate.ps1`, `authoring-gate.ps1`, F13/007/Central, F13-P1 e F12 **PASS**, incluindo F9 PostgreSQL **3/3**. Novo gate 009 confirmou SQL runtime: catálogo B invisível e referência recusada, kinds inválidos e framework divergente recusados, own/global positivos, rollback sem alterações materiais/F7/resultados; duas assertions verificadas conservam dois resultados, reverificação substitui somente o alvo e submissão preserva ambos. Duas respostas COMMIT perdidas em mutação e read produzem erro controlado, seguido de replay reautorizado; um evento e um registo idempotente por intenção. Runner 008→009→008→009 e down com dados recusado continuam PASS. A capture transacional usada para obter o fingerprint não é descrita como prova do runner.

Syntax **90 JS** e whitespace tracked/**63 untracked** PASS. Scans em **105 ficheiros**: zero private keys/provider tokens/JWT reais nos padrões usados; duas ocorrências numéricas são o bucket F10 e a documentação do limite de validade, não PII. Um primeiro harness de whitespace confundiu aviso LF/CRLF com falha; inspeção e repetição com deteção de whitespace efetivo passaram, sem reformatar ficheiros. Recursos próprios removidos pelos finally; preexistentes preservados. Sem stage/commit.

Pins vigentes tenant 009: up `244282e6b87034d15600ab61df04a0fe77347c307132232509a300dbb184708e`; down inalterado `f99fd63315880e38529e751c989b68828c0f71e2334fc632416b05869f0d90d7`; fingerprint `5a23e5b95300e9af471d90ac4e1212c5e88c11b3735fa88445e7b6aae010f1f1`. Down recupera o fingerprint 008 já documentado. Nova revisão formal será read-only após congelar este snapshot; o veredicto será reportado sem editar ficheiros nessa fase. Catálogos editoriais, lifecycle completo, approval/publication, activation, matching, frontend e limites operacionais permanecem pendentes/fora de âmbito.

## Fecho formal restrito da fatia 5 (2026-10-11)

Por aprovação humana explícita, regista-se a fatia 5 — competências, experiência e evidências — como **formalmente fechada no âmbito restrito entregue**, após a revisão formal read-only subsequente às correções, com veredicto **sem findings bloqueadores**. Este registo substitui as declarações históricas de prontidão/revisão pendente acima; não fecha a feature F13 integral nem inicia outra fatia.

- **F13-S5-R1-001 corrigido e revalidado:** reprodução SQL independente com role runtime recusa a referência de outra organização e tipo incompatível; integridade de referências reforçada na persistência.
- **F13-S5-R1-002 corrigido e revalidado:** reprodução produtiva conserva duas verificações correntes e dois resultados históricos; reverificação seletiva e submissão preservam os resultados não substituídos.
- **F13-S5-R1-003 corrigido e revalidado:** duas respostas de COMMIT perdidas não exportam o guard; erro controlado seguido de retry reautorizado devolve apenas a projeção funcional, sem duplicação de F7/idempotência.

Tenant `009_f13_competencies_and_experience` validada com os pins vigentes:

- **Up:** `244282e6b87034d15600ab61df04a0fe77347c307132232509a300dbb184708e`.
- **Down:** `f99fd63315880e38529e751c989b68828c0f71e2334fc632416b05869f0d90d7`.
- **Fingerprint:** `5a23e5b95300e9af471d90ac4e1212c5e88c11b3735fa88445e7b6aae010f1f1`.

Evidência já executada e revalidada na ação anterior: backend **631/631**, focados **345/345**, gates PostgreSQL competências/authoring/F13/Central/F13-P1/F12 **PASS**, F9 **3/3**, runner **008→009→008→009**, provas independentes dos três findings, syntax/whitespace/scans. O snapshot de 105 ficheiros permaneceu inalterado durante a revisão read-only. Esta ação é exclusivamente documental: não repete esses testes nem implica rollout produtivo.

**F13 permanece In Progress; AC-13 e AC-15 permanecem PARTIAL; AC-14 permanece PENDING; nenhum critério ou estado adicional é alterado.** Catálogos editoriais produtivos e lifecycle permanecem pendentes. Aprovação/publicação de perfis, snapshots/activation, frontend, matching e demais domínios continuam fora do âmbito desta fatia. Limitações operacionais anteriores mantidas. Sem alterações funcionais, código/migrations, stage/commit, arquivo da feature integral ou início de outra fatia. A única validação desta ação é `git diff --check`, reportada após execução.

## Proposta da fatia 6 — capacidade financeira

**Estado da fatia: Draft — pendente de aprovação.** F13 integral permanece In Progress; fatia 5 permanece formalmente fechada. Numeração proposta exclusivamente tenant: `010_f13_financial_capacity`, ainda sem ficheiros, checksum, fingerprint ou capability implementados. Não altera tenant 007/008/009, Central 009 ou critérios. Esta proposta não autoriza implementação nem a fatia posterior de lifecycle/activation.

### Objetivo

Acrescentar ao draft organizacional assertions financeiras tenant-local, temporais e versionadas, preservando montante/moeda original, indicador aprovado, proveniência e estado epistemológico. Separar declaração, evidência e verificação humana explícita, sem produzir capacidade inferida, comparação entre moedas, elegibilidade ou score. Fontes normativas: decisões `f13-financial-capacity`, `f13-knowledge-state-policy` e `f13-authorization-and-segregation`; a estrutura existente da 007 é evidência de suporte, não aprovação de conteúdo editorial.

### Âmbito incluído proposto

- Apenas scope **ORGANIZATION**, resolvido server-side por F3/F13; UNIT/TEAM e grupos/entidades relacionadas recusados, sem agregação. Criar/corrigir material financeiro num draft existente, selecionando a versão exata do indicador de um catálogo fechado/publicado acessível à organização; caller não define metric code, semântica, unidade, moeda admissível ou policy.
- Assertions com identidade lógica e versão imutável; referência exata ao indicador/release, período de referência e observação, proveniência minimizada, autoria confiável e representação original. **Proposta preferida de restrição: montante monetário exato apenas**, decimal canónico no transporte e PostgreSQL numeric na persistência, sem floating point/rounding implícito. Incluir intervalos ou indicadores não monetários nesta fatia exige decisão explícita; a sua omissão inicial não altera a decisão financeira geral exact xor interval.
- Conhecimento separado da verificação: KNOWN exige representação válida; UNKNOWN não contém montante; NONE e NOT_APPLICABLE apenas se a definição aprovada admitir, com período/provenance e reason autorizado quando exigido. Ausência de assertion não vira zero/NONE/UNKNOWN. WITHHELD é dimensão de projeção, nunca um valor/estado interno escolhido pelo caller; projeções completas não são implementadas nesta fatia.
- Authoring CAS/expected revision, correções e ligações versionadas append-only, preservando membros temáticos/competências/experiência e submissão existente sem alterar os respetivos contratos. Mudança material financeira invalida apenas a verificação dependente nos termos aprovados, sem apagar histórico ou verificações não relacionadas.
- Referências opcionais F11 à versão documental exata, com organização, recurso/binding, estado disponível/CLEAN e autorização DOCUMENT_READ independente verificados server-side. Anexar documento nunca verifica o facto nem concede acesso a conteúdo/URL/object ID; sem download/upload/export novos.
- Resultado de verificação separado e append-only: ato explícito de verificador humano independente de todos os autores/submissores/editores materiais do facto e evidências, identificado por stable subject; método/validade/provenance aprovados. MFA recente normalizada por F5, sem freshness ou método inventados pela F13. A associação de documentos, por si só, mantém o facto UNVERIFIED.
- Idempotência source-local por organização/operação/key/digest de intenção/resultado, replay reautorizado e conflito de intenção. Tratamento durável de COMMIT incerto e perdas repetidas de confirmação, sem exposição de guards ou sucesso fictício.
- Composição produtiva F3/F4/F5/F7/F10 e coordinator Central existente: handles opacos, sessão/membership/versões e autoridade server-side, client físico tenant preparado único para loaders/locks/F5/material/F7/idempotência/commit, fencing e guard durável sem bypass. RLS/FORCE RLS e grants mínimos; catálogos globais read-only; F10 de baixa cardinalidade sem valores/IDs/documentos.

### Exclusões explícitas

Sem FX automático, fontes/taxas FX, conversão para reporting_currency, normalização/comparação entre moedas, scoring/thresholds/elegibilidade, bandas/derivações ou políticas comerciais. Sem aprovação/publicação do perfil, snapshots/completude/activation, lifecycle completo de disputa/revogação/conflito, frontend, matching/F14, outros domínios, contabilidade/demonstrações completas, movimentos/IBAN/pagamentos/salários/forecasting/orçamento de candidatura. Sem administração completa de catálogos, seeds produtivas não aprovadas, grants implícitos, backfill inferido ou novas APIs administrativas. Nenhuma alteração de autoridade F3/F5 fora do coordinator.

### Contratos e decisões necessários antes de implementação

| Contrato | Base já aprovada | Decisão ainda necessária |
|---|---|---|
| Indicadores e releases | Catálogo fechado/versionado; global read-only e ownership tenant | Quais indicadores monetários pertencem à primeira release; definição de unidade/semântica, periodicidade/validade, exato vs intervalo, admissibilidade de NONE/NOT_APPLICABLE; autoridade e distribuição editorial. Não escolher seeds por inferência. |
| Moeda original | Identidade ISO 4217 preservada, sem FX | Release/fonte/versionamento do catálogo de moedas admissíveis, tratamento de códigos históricos e período de validade, escala/precisão permitida e regras de sinal/zero por indicador. Nenhuma moeda concreta selecionada nesta proposta. |
| Períodos e proveniência | Factos temporais, declaração/verificação separadas | Contrato de período (exercício/intervalo e limites), fonte/observação e campos permitidos, confidencialidade das referências, razão de correção e regras para períodos sobrepostos. Não deduzir calendário fiscal universal. |
| Conhecimento/verificação | Estados normativos multidimensionais; sem auto-verify | Subconjunto inicial de combinações, reason codes, método(s) explícito(s), autoridade verificadora e validade; comportamento corrente perante expiração/supersession e re-verificação, preservando história. Full lifecycle permanece posterior. |
| F11 | Sem acesso documental implícito; versão/binding/autorização exatos | Resource/binding financeiro autorizado, cardinalidade dos links e autores materiais relevantes; classificação, retenção/legal hold compatíveis com F11. Nenhum resource type produtivo novo inventado. |
| F5 | Draft edit/create/submit, evidence attach/read, F13_FINANCIAL_VERIFY/profile_financial.verify/FINANCIAL_FACT já normativos; restricted value read distinto | Matriz produtiva exata de operações/resources/grants ORG-only: edição financeira e reutilização ou especialização de draft.edit; separação entre edição e leitura do montante, leitura de metadata/valor/evidência, reason/purpose e classes de confidencialidade. Verification/read sensível usam RECENT_MFA real; bundles vazios e sem capabilities implícitas. |
| F7/F10 e digests | Eventos críticos transacionais; FINANCIAL_FACT_VERIFIED, EVIDENCE_ATTACHED e eventos de revision existentes no contrato; labels fechados | Payloads fechados por operação e catálogo/versions; sem montantes/moedas/períodos sensíveis/documentos em eventos/logs. Digests de intenção/conteúdo ficam protegidos e não podem permitir inferir valores de baixa entropia; fechar projeção mínima das respostas e leituras restritas antes de expor conteúdo. |
| Authoring/runtime/migration | CAS, append-only, guard e recovery existentes | Comandos validados, fontes/resultados idempotentes e política de invalidação material; ordem de locks alinhada com as foundations; desenho aditivo tenant 010/manifest/capability/fingerprint e down seguro. Compatibilidade F12/F13-P1/F13 sobre 010 a provar. |

A aprovação do âmbito e a dos contratos são distintas. Sem catálogo produtivo aprovado, eventual autorização posterior pode limitar a entrega a contratos fechados/suporte estrutural com catálogo vazio fail-closed e fixtures explicitamente sintéticas; isso não prova uso produtivo nem o AC financeiro integral. Tal alternativa também precisa de aprovação explícita. Nenhum método, threshold, moeda, indicador ou política comercial é aprovado por este Draft.

### Critérios afetados e dependências

- Alvo principal **F13-AC-16** (ORG-only, decimal/temporal, sem FX/scoring). Evidência parcial planeada para AC-01/02/04/05/09/10/11/12/20/21/22/24/25/26/27/28/29/30/31 nas partes de residência, estados, histórico, concorrência, segurança e migrations efetivamente entregues. AC-06/07/08/32 dependentes de publication/snapshots/activation não são demonstrados por esta fatia. **Nenhum estado de AC muda: AC-13/AC-15 PARTIAL, AC-14 PENDING, AC-16 PENDING.**
- Dependências: F3 membership/sessão central; F4 client físico/preparação/fencing; F5 engine/assurance/stable subject e coordinator durável; F7 source-local; F10; F11; foundation F13-P1; tenant 007 catálogos e 008 authoring; preservação da fatia 5/tenant 009. F12 permanece regressão obrigatória. Nenhum job F9 novo; não há dependência de fornecedor FX, frontend ou F14.

### Riscos a controlar

Precisão/rounding/sinais e unidade monetária ambíguos; indicadores sem semântica editorial aprovada; calendário/períodos sobrepostos e dupla contagem; colapso ausência/UNKNOWN/zero/NONE; side channels por valores/digests/erros; leitura restrita concedida implicitamente por edição ou evidência; binding documental insuficiente; auto-verificação e maker-checker incompleto; verificação corrente sobrevivendo a mudança material/expiração; referências catalogadas válidas em JavaScript mas inválidas no SQL; TOCTOU entre F5 e commit, guard abandonado/commit incerto e lost updates; regressões ao copiar membros financeiros em edit/submit ou ao avançar o schema para 010. Não mitigar com seeds fictícias, defaults permissivos ou retries cegos.

### Testes exigidos (planeados, não executados nesta ação)

1. Unit/adversariais: comandos fechados, autoridade injetada recusada, decimal exato/precision e exact xor interval quando aprovado, moeda/indicador/release/período/estado inválidos, ausência vs zero/NONE/UNKNOWN/NOT_APPLICABLE, payloads/digests/F10 sem fuga de valores.
2. PostgreSQL 17 real, Central + tenants A/B, composição produtiva F3/F4/F5/F7 e session_user limitado: RLS/FORCE RLS, leitura global/escrita global recusada, IDOR uniforme, ORG-only/UNIT/TEAM recusados, pertença/tipo/release de catálogo e binding F11 validados também no SQL.
3. Duas sessões reais: CAS com um vencedor, idempotência concorrente, mesma key com digest divergente, replay reautorizado após revogação/versionamento F3/F5 e keys não reutilizadas entre tenants/operações; append-only e preservação dos domínios anteriores.
4. Verificação explícita: autor/editor/submissor material e service actor recusados; sessões distintas do mesmo stable subject não contornam SoD; independente autorizado com MFA recente permitido; MFA ausente/stale ou método/validade não aprovados recusados; verificações de múltiplos factos preservadas seletivamente.
5. Grants assimétricos no engine F5 real, resource diferente e documento sem grant independente; F5/F7 falhados revertem integralmente factos/history/head/links/resultados; eventos persistidos usam a decisão efetiva sem dados financeiros sensíveis.
6. Commit incerto, duas confirmações perdidas, crash/recovery, autoridade revogada nas duas ordens e drift físico/fence final: protocolo durável sem bypass, sem guards públicos, duplicação ou commit tardio; nenhuma falha vencida pela autoridade persiste mutação/F7/idempotência.
7. Runner canónico: 009→010 e prefixes suportados/instalação vazia; ledger/checksums/preflight/fingerprint, segunda aplicação, rollback SQL→ledger, schema/ACL drift e down vazio seguro com recuperação do fingerprint 009; down recusa dados protegidos. Nenhum downgrade arbitrário.
8. Suite backend/focados, gates competências/authoring/taxonomia/F13-P1/F12/Central aplicáveis, node --check, git diff --check, scans de credenciais/PII/valores financeiros e cleanup exclusivo dos recursos descartáveis criados pelos testes.

### Definição de conclusão e sequência proposta

1. Aprovar o âmbito restrito e fechar as decisões materiais acima; refletir os contratos aprovados na especificação F13 antes do código. Só então autorizar implementação e mover a fatia de Draft para Ready/In Progress, sem marcar a F13 integral Complete.
2. Entregar tenant 010 aditiva + composição/authoring/verification nos contratos aprovados, sem alterar migrations anteriores; preservar domínios/história/grants e resultados source-local.
3. Demonstrar os testes exigidos com provas reais, publicar pins/checksums/fingerprint e evidência exata, sem promover AC integrais sem prova completa.
4. Revisão formal read-only sem BLOCKER/HIGH ou MEDIUM que comprometa correção, segurança, isolamento ou rollback; fecho restrito apenas por aprovação humana explícita, com limitações e catálogos pendentes claramente registados.

**Recomendação:** manter esta proposta em Draft e aprovar primeiro o recorte ORG-only, monetário exato e sem bandas/FX; ajustar se forem necessários intervalos/indicadores não monetários. Não iniciar implementação antes de fechar catálogo/representação/período, verificação, F11 e matriz de acesso/confidencialidade, ou de autorizar explicitamente uma entrega estrutural sem conteúdo produtivo. Apenas current-work.md é alterado nesta ação; nenhum código, migration, seed, teste, commit ou stage criado.

## Fatia 6 — aprovação formal e contratos de execução (2026-10-11)

O pedido humano subsequente **aprova formalmente e autoriza implementar** a capacidade financeira ORG-only com tenant `010_f13_financial_capacity`. Substitui o estado Draft/pedido de aprovação do âmbito acima. A aprovação é registada; não se declara implementação concluída. Antes de código, a inspeção encontrou duas decisões materiais adicionais que precisam de confirmação, sem inferência silenciosa de regras de produto/F5. F13 permanece In Progress e todos os estados de critérios ficam inalterados.

### Contratos aprovados pelo pedido

- Montante exato PostgreSQL **NUMERIC(24,6), >= 0**, sem intervalos, FX, conversões, bandas, scoring ou derivados. Moeda obrigatória em catálogo fechado; indicador obrigatório catalogado e compatível com unidade monetária. Nenhum código de moeda/indicador ou seed produtivo selecionado por inferência.
- Período inclusivo `start_date`/`end_date`, com `start_date <= end_date`. Vocabulário de estados aprovado: **DRAFT, SUBMITTED, VERIFIED, REJECTED, DISPUTED, REVOKED, EXPIRED**; a enumeração, por si só, não define quem executa cada transição. Estado epistemológico permanece separado do editorial/verificação conforme decisão normativa F13; não inferir ausência/UNKNOWN/zero/NONE.
- Métodos/reasons por catálogos fechados sem seeds produtivos; fixtures exclusivamente sintéticas. Verificação exige `valid_from` e aceita `valid_until` opcional, maker-checker sobre stable subject e MFA recente avaliada por F5. Evidência F11 autorizada separadamente, sem acesso documental implícito e sem redução de confidencialidade.
- Permissões F5 distintas para create/edit/read/submit/verify; loaders server-side e ORG-only; nenhuma identidade/organização/assurance confiada ao caller. Assertions versionadas, CAS/expected revision, intenção idempotente, histórico append-only, integração tenant confiável e coordinator/recovery existentes. F5 antes da mutação, F7 na mesma transação sem valores financeiros/documentos, F10 de baixa cardinalidade.
- Testes PostgreSQL reais obrigatórios: limites/precisão/períodos/catálogos, A/B, concorrência/CAS/idempotência/replay, SoD/MFA, F11/confidencialidade, F7/F10 sanitizados, rollback F5/F7, COMMIT incerto, upgrade 009→010 e down seguro. Manifest/pins/gates só serão atualizados com schema implementado e prova real.
- Publicação do perfil, snapshots/activation, frontend e matching ficam fora. Migrations anteriores e alterações existentes devem permanecer intactas; sem stage/commit.

### Duas decisões materiais históricas — resolvidas pela aprovação seguinte

1. **Transições e autoridade:** confirmar se esta entrega executa somente DRAFT→SUBMITTED→VERIFIED, reservando REJECTED/DISPUTED/REVOKED a operações posteriores e EXPIRED a uma regra de validade, ou se deve incluir agora rejeição/disputa/revogação/expiração. No segundo caso, fechar origem/destino, quem pode agir, permission/resource F5 específico, reason obrigatório, MFA/SoD, terminalidade e eventual retorno por nova versão. Confirmar se EXPIRED é estado derivado da validade ou evento persistido, como `valid_from` futuro é tratado, e se a verificação pode rejeitar uma assertion submetida. Não atribuir essas capacidades a edit/verify implicitamente. A decisão normativa já distingue dispute/revoke/read restrito, mas a composição financeira e a matriz de transições ainda não existem.
2. **Confidencialidade F11:** `document_storage.document`/`document_version` na tenant 003 não persistem classe de confidencialidade; `storage_class` significa DOCUMENTS/QUARANTINE, não uma classificação de acesso. Confirmar se a não redução é garantida nesta fatia exclusivamente pela interseção dos grants financeiros com DOCUMENT_READ exato, reavaliado em toda leitura/verificação/replay, sem cópia/reclassificação/conteúdo documental; ou se se exige persistir/comparar uma classe. Esta última opção precisa de contrato aprovado para classes, fonte confiável, ordenação/policy e extensão aditiva de F11 em 010, sem alterar 003. Não inventar hierarquia comercial/classificação ou usar storage_class como confidencialidade.

**Estado de entrega:** nenhuma migration tenant 010 ou código funcional criado; não há checksum/fingerprint 010 nem resultados de testes novos. Esta ação apenas documenta aprovação/pendências e verifica preservação/diff. Não está pronta para revisão formal read-only de implementação. Próximo passo depende da confirmação humana destes contratos; não se inicia outra fatia nem se reabre a fatia 5.

## Fatia 6 — contratos finais autorizados antes da implementação

O pedido humano subsequente resolve as duas pendências e autoriza a implementação tenant `010_f13_financial_capacity`. Estados persistidos: create→DRAFT, edit apenas DRAFT→DRAFT (nova versão), submit DRAFT→SUBMITTED, verify SUBMITTED→VERIFIED, reject SUBMITTED→REJECTED, dispute VERIFIED→DISPUTED, revoke VERIFIED/DISPUTED→REVOKED. EXPIRED é exclusivamente efetivo quando valid_until foi ultrapassado, sem scheduler/escrita; nunca substitui estados REVOKED/REJECTED. Transições inválidas falham antes da mutação. Reject exige reason/maker-checker; verify maker-checker/MFA; revoke MFA/reason; dispute reason. Para ações humanas sensíveis aplicam-se também os requisitos normativos F5 de MFA/SoD já aprovados, não permissões implícitas.

O núcleo financeiro tem identidade/head próprios de assertion no scope Organization do perfil, revisões CAS append-only, sem aprovação/submissão do perfil integral. Comandos financeiros não alteram o head dos drafts temáticos/competências. Create/edit incluem montante exato conhecido, moeda/indicador, período, proveniência e referências documentais opcionais; não inventam ausência/UNKNOWN/zero. Scope Organization e identidade vêm exclusivamente da composição confiável. Cada uma das oito operações tem permission/resource explícitos; create autoriza scope Organization, restantes autorizações incidem no facto exato carregado server-side.

Evidência F11 não recebe classificação nova: grant financeiro **e** DOCUMENT_READ exato cumulativos em acesso/verification/replay com referências; nenhuma cópia/reclassificação/conteúdo. Referências históricas eventualmente devolvidas também exigem autorização documental atual. F7/F10 excluem montantes/moedas/períodos/provenance/documentIds e metadados sensíveis. Respostas de mutação são metadata não financeira; read é a única operação que devolve valores/ref autorizados, e replay read reavalia estado efetivo/validade. Métodos/reasons/moedas permanecem catálogos vazios fail-closed até aprovação editorial; fixtures sintéticas não são seeds.

Montante transportado como string decimal sem exponentes/rounding e guardado NUMERIC(24,6) >= 0; indicador MONEY e unidade compatível com a moeda catalogada; datas inclusivas válidas. Valid_from é timestamp obrigatório da verificação, valid_until opcional posterior; validade futura permanece registrada, sem scheduler nem alteração silenciosa do montante. Históricos/reasons/métodos/catalog releases conservam versões exatas. Nenhum critério promovido; feature integral In Progress. Esta secção autoriza o trabalho, não antecipa evidência PASS.

## Fatia 6 — implementação e evidências (2026-10-11)

As duas pendências históricas acima foram resolvidas por aprovação humana. O registo anterior de “010 ainda não criada” descreve apenas aquela ação documental, não o estado atual. Entrega atual: tenant `010_f13_financial_capacity`, oito operações produtivas e gate PostgreSQL real; **sem fecho automático, sem stage/commit**.

### Contratos e implementação

- Assertions financeiras com identidade/head próprios, sempre no baseline Organization resolvido server-side; não alteram o head dos drafts das fatias 4/5. Revisões append-only e CAS; montante conhecido como string decimal canónica convertida exatamente em NUMERIC(24,6), sem rounding silencioso, FX, bands, scoring ou valores derivados. Zero é um valor explícito, não uma inferência de ausência.
- Catálogos versionados fechados de moedas/métodos/reasons/purposes, sem seeds produtivos. Indicadores usam metric_definition MONEY publicada, com unidade monetária igual à unidade da moeda catalogada. A 010 acrescenta exclusivamente SELECT/RLS para esses indicadores; nenhuma migration anterior é reescrita.
- CREATE→DRAFT; EDIT DRAFT→DRAFT; SUBMIT DRAFT→SUBMITTED; VERIFY SUBMITTED→VERIFIED; REJECT SUBMITTED→REJECTED; DISPUTE VERIFIED→DISPUTED; REVOKE VERIFIED/DISPUTED→REVOKED. VERIFY e REJECT exigem checker distinto dos autores materiais/submissor e autores documentais; VERIFY/REJECT/REVOKE exigem MFA recente, tal como READ/DISPUTE pelo contrato normativo de acesso sensível F5. Reason obrigatório em reject/dispute/revoke; read exige reason/purpose catalogados. Cada operação usa exclusivamente a sua própria permission, bundles de perfis vazios.
- EXPIRED é derivado em leitura/replay quando valid_until < clock_timestamp(), exclusivamente sobre VERIFIED/DISPUTED, sem alteração histórica/scheduler. O instante valid_until ainda é inclusivo. valid_from é registado explicitamente e não cria activation nem outro estado editorial.
- F11 usa função metadata fechada com tenant, AVAILABLE/CLEAN e vínculo FINANCIAL_FACT exato sob SHARE lock. Toda referência exige simultaneamente a permission financeira e DOCUMENT_READ do documento exato na autorização real. Não se concede SELECT às tabelas F11, nem conteúdo/storage locator/classificação; sem cópia ou reclassificação. Replay read recarrega a revisão originalmente auditada e reautoriza as suas referências; revogação documental impede devolvê-las, mesmo que o head corrente já não tenha documentos.
- Composição `profileFinancial` no root produtivo: sessão OIDC/handles F3, membership e F5 atuais, capabilities/preparação/fencing F4; mesma conexão em loader, autorização, CAS, F7, idempotência e commit. Coordinator Central existente protege também DOCUMENT_READ, conserva exclusão durável e reconcilia pela tabela financeira tenant. Nenhuma alteração à Central 009.
- Ordem de locks: preparação/nonce F4 → mutex organizacional F13-P1 → intenção financeira organization/operation/key → assertion head → documentos SHARE → guard Central → mutação/F7/resultado → fencing/permit/commit. Sem retry cego.
- Idempotência source-local por organization, FINANCIAL_operation, key e digest da intenção normalizada. Replay reautoriza F3/F5/F11, sem guardar valores/documentos na tabela idempotente. O resultado guardado contém apenas assertionId/revision/state; read devolve a revisão originalmente auditada, com EXPIRED derivado no instante de acesso. Uma revisão posterior requer nova key e novo F7. COMMIT incerto usa o recovery durável; duas confirmações perdidas falham publicamente sem expor guard e conservam uma única versão.
- F7 crítico nas sete mutações e na leitura restrita, na mesma transação. Digest auditável inclui apenas metadata de operação/versionamento, não montante/digest de baixa entropia financeira/documentId/conteúdo. F10 tem somente oito operation labels e resultClass fechada.

### Operações/resources F5

| Operação | Permission | Resource server-side |
|---|---|---|
| F13_FINANCIAL_CREATE | profile_financial.create | FINANCIAL_SCOPE, Organization atual |
| F13_FINANCIAL_EDIT | profile_financial.edit | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_READ | profile_financial.read | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_SUBMIT | profile_financial.submit | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_VERIFY | profile_financial.verify | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_REJECT | profile_financial.reject | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_DISPUTE | profile_financial.dispute | FINANCIAL_FACT, assertion exata |
| F13_FINANCIAL_REVOKE | profile_financial.revoke | FINANCIAL_FACT, assertion exata |

### Pins e provas executadas

- Up: `ab3b92b001e90dbae4d38d42e1f61ed00ce2b94fb28797195e1324ac90ad1b93`.
- Down: `d97346b19c319c220459a62f01084dee7da78f48ed1a5d4da1b68355dcba093a`.
- Fingerprint: `876e01b28fb3617b464a4a85c8e8cc5a1e4f405e7e8678e07f1d0ddb12820eac`.
- `cd backend; npm test`: **642/642 PASS**, zero skipped. Focados `node --test test/f13*.test.js test/f3*.test.js test/f4*.test.js test/f5*.test.js test/f7*.test.js test/productionCompositionParity.test.js`: **385/385 PASS**.
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/financial-gate.ps1`: **PASS**, Central real + dois tenants PG17, catálogos inicialmente vazios/fixtures sintéticas explícitas, precisão/limites, períodos/indicadores incompatíveis, matriz de todas as transições válidas/inválidas, EXPIRED antes/depois e replay, CAS concorrente, replay simultâneo/conflito, A/B, oito grants assimétricos/resource errado, maker-checker/MFA ausente/stale, F11 ausente/revogado/outro tenant/quarentena, ausência de acesso documental implícito, oito falhas F7 com rollback integral, append-only/orphan head, COMMIT incerto e duas confirmações perdidas. Eventos realmente persistidos correspondem à assurance/policy F5 e à cardinalidade idempotente, sem valores/referências sensíveis.
- Runner canónico **009→010→009→010** com ledger/preflight/fingerprint; falha entre SQL e ledger reverte schema, reaplicação é idempotente; down recusa dados protegidos. Fingerprint 009 recuperado: `5a23e5b95300e9af471d90ac4e1212c5e88c11b3735fa88445e7b6aae010f1f1`. Captura SQL preliminar foi apenas cálculo de pin, não prova de runner.
- Gates `test/integration/f13/migration-gate.ps1`, `authoring-gate.ps1`, `competency-gate.ps1`, `test/integration/f13p1/migration-gate.ps1`, `test/integration/f12/migration-gate.ps1`: **PASS**. O gate F13 inclui Central/coordinator, 47 ACL drift cases, revogações/recovery/commit incerto e down tenant 007; F12 prova instalação vazia e upgrades 003/004/005/006→010, 11 versões, e F9 PostgreSQL **3/3 PASS**.
- `node --check`: **101 ficheiros JS dirty/untracked PASS**; `git diff --check` PASS. Scans de credenciais/tokens/connection strings, emails, IBAN e NIF/telefone explicitamente atribuídos no conjunto dirty/untracked: sem findings reais (fixtures example.invalid/com/test excluídas explicitamente). Migrations anteriores e .vscode preservadas por SHA256; índice vazio. Recursos Docker de execução eliminados exclusivamente pelos finally dos respetivos gates, sem limpar recursos preexistentes.

### Critérios e limitações

Evidência restrita para **AC-16** e contratos transversais AC-01/02/04/05/11/12/21/22/26/27/28/29/30/31/32. **Nenhum AC promovido:** AC-13/15 PARTIAL, AC-14/16 PENDING e restantes estados inalterados. Os testes usam diretório/provider físicos sintéticos, fixtures de sessão e grants explícitos com persistência Central real; não provam integração IdP externo, rollout/SLO produtivo ou conteúdo editorial aprovado.

Catálogos produtivos de moedas, indicadores monetários, métodos/reasons/purposes e respetivas políticas continuam pendentes de aprovação editorial; runtime vazio falha fechado. Sem APIs administrativas/catalog authoring, intervalos/bandas/derivações, outros domínios, aprovação/publicação do perfil, snapshots/activation, frontend ou matching. Fatia 6 pronta para **nova revisão formal read-only**, não declarada fechada.

## Fatia 6 — correções F13-S6-R1 e evidência de implementação (2026-10-11)

A revisão formal anterior encontrou três findings MEDIUM de correção/auditoria; o fecho não foi autorizado. As correções abaixo foram implementadas e verificadas. Segue-se revisão read-only sobre snapshot congelado; esta secção não antecipa o seu veredicto nem regista fecho automático.

- **F13-S6-R1-001:** DATE é carregado/devolvido como texto civil na query de revisão e no RETURNING, sem conversão local→UTC. Prova PostgreSQL pela composição real em UTC e Europe/Lisbon, inverno/verão, create/edit/read/replay: datas exatas preservadas.
- **F13-S6-R1-002:** F7 financeiro regista reasonRef/reasonReleaseRef/reasonCatalogVersion e, em leitura, purposeRef/purposeReleaseRef/purposeCatalogVersion, obtidos server-side dos catálogos publicados. Allowlist exclusiva dos eventos financeiros; UUIDs e versões validados, sem textos editoriais, montantes, documentId, metadados F11 ou valores financeiros. Prova sobre eventos efetivamente persistidos de read/reject/dispute/revoke; catálogos de kind errado e intenção divergente recusados. Nenhum evento histórico foi reescrito.
- **F13-S6-R1-003:** loader de replay READ resolve a revisão do registo idempotente organization/operation/key, confirma a assertion e carrega os documentos dessa revisão antes do guard/F5. Digest da intenção continua validado; replay devolve conteúdo originalmente auditado, não o head corrente. F3/F5/F11 atuais continuam obrigatórios; revogação DOCUMENT_READ impede replay histórico mesmo quando o head já não tem documentos. EXPIRED permanece derivado à hora do acesso. Nova key lê o head com novo evento. Uma e duas confirmações de COMMIT perdidas, reconciliação e retry preservam um único F7/resultado.

### Validação desta correção

- `cd backend; npm test`: **644/644 PASS**, zero skipped.
- `node --test test/f13*.test.js test/f3*.test.js test/f4*.test.js test/f5*.test.js test/f7*.test.js test/productionCompositionParity.test.js` em backend: **387/387 PASS**.
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/financial-gate.ps1`: **PASS**, Central + dois tenants PG17, novas regressões descritas acima e matriz financeira completa, F11/F7 fail-closed, CAS/concorrência/append-only, sem dados financeiros no F7/F10, down protegido e runner **009→010→009→010**.
- Gates `test/integration/f13/migration-gate.ps1`, `test/integration/f13p1/migration-gate.ps1` e `test/integration/f12/migration-gate.ps1`: **PASS** nesta execução. F13/Central prova 47 drifts ACL, revogações/recovery/COMMIT incerto e taxonomia; F12 prova instalação vazia e prefixes suportados→010. F9 PostgreSQL **3/3 PASS**.
- `node --check`: **101 JS PASS**; `git diff --check` e whitespace dos ficheiros de código/teste desta correção PASS. Scans de 119 ficheiros dirty/untracked: 13 ocorrências revistas são URLs dinâmicos descartáveis ou canários sintéticos já existentes; nenhuma credencial/PII real identificada nos padrões usados. Scans não constituem garantia universal.
- Apenas nove ficheiros de código/teste/documentação alterados nesta correção; SHA256 preserva os restantes ficheiros do snapshot inicial, incluindo todas as migrations e .vscode. Nenhuma migration, conteúdo editorial produtivo, funcionalidade fora da fatia, stage ou commit acrescentado.

Pins tenant 010 **inalterados**: up `ab3b92b001e90dbae4d38d42e1f61ed00ce2b94fb28797195e1324ac90ad1b93`; down `d97346b19c319c220459a62f01084dee7da78f48ed1a5d4da1b68355dcba093a`; fingerprint `876e01b28fb3617b464a4a85c8e8cc5a1e4f405e7e8678e07f1d0ddb12820eac`. Nenhum AC promovido: **F13 In Progress; AC-13/AC-15 PARTIAL; AC-14/AC-16 PENDING**. Mantêm-se catálogos editoriais pendentes, fixtures sintéticas de IdP/diretório/provider e ausência de rollout/SLO produtivo; lifecycle/activation/frontend/matching fora. Fecho restrito exige decisão humana após revisão sem findings materiais.

## Fecho formal restrito da fatia 6 — capacidade financeira (2026-10-11)

Por aprovação humana explícita, a **fatia 6 da F13 — capacidade financeira ORG-only está formalmente fechada no âmbito restrito entregue**, após correções e repetição da revisão formal read-only **sem findings bloqueadores**. Este registo substitui as declarações históricas de revisão/fecho pendentes acima; não fecha a F13 integral, não promove critérios nem autoriza outra fatia.

**F13-S6-R1-001, R1-002 e R1-003 corrigidos e revalidados:**

- **R1-001:** datas PostgreSQL DATE preservadas como texto civil, sem conversão local→UTC. Create/edit/read/replay comprovados em UTC e Europe/Lisbon, inverno/verão.
- **R1-002:** F7 financeiro com referências e versionamento de reason/purpose obtidos server-side dos catálogos publicados: reasonRef/reasonReleaseRef/reasonCatalogVersion e, em leitura, purposeRef/purposeReleaseRef/purposeCatalogVersion. Eventos reais persistidos confirmados, sem valores financeiros, conteúdo ou identificadores/metadados documentais; nenhuma reescrita do histórico.
- **R1-003:** replay ligado à revisão originalmente auditada, com nova autorização F3/F5/F11 e DOCUMENT_READ exato sobre as referências dessa revisão. Revogação documental impede replay mesmo quando o head corrente já não tem documentos. Nova revisão exige nova key/leitura auditada. **EXPIRED é derivado no acesso**, sem persistência/scheduler; replay mantém o conteúdo original e reavalia a validade.

### Evidência final já executada

- Backend **644/644 PASS**; focados F13/F3/F4/F5/F7/composição **387/387 PASS**; financeiro/F7 durante a revisão read-only **28/28 PASS**.
- Gates financeiro, F13/Central, F13-P1 e F12 **PASS**; F9 PostgreSQL **3/3 PASS**. Runner canónico **009→010→009→010 PASS**, com ledger/preflight/fingerprint, rollback SQL→ledger e down conservador.
- Reprodução independente pela composição real, Central + dois tenants PostgreSQL 17, Europe/Lisbon: período **2025-07-01–2025-07-31** preservado; leitura e replay da revisão **1**, apesar de avanço do head; **um único F7** referente à revisão 1, com reason/purpose versionados persistidos.
- `node --check` **101 ficheiros PASS**; `git diff --check`/whitespace PASS; scans sem credenciais/PII reais identificadas nos padrões usados, com ocorrências dinâmicas/sintéticas revistas. Snapshot de **119 ficheiros inalterado durante a revisão read-only**; apenas recursos Docker próprios removidos.

Estes resultados pertencem à implementação/revisão anterior; esta ação documental não constitui nova execução desses testes ou gates. Apenas `git diff --check` é executado para validar este registo.

### Pins atuais da tenant 010 — inalterados

- Migration: `010_f13_financial_capacity`.
- Up: `ab3b92b001e90dbae4d38d42e1f61ed00ce2b94fb28797195e1324ac90ad1b93`.
- Down: `d97346b19c319c220459a62f01084dee7da78f48ed1a5d4da1b68355dcba093a`.
- Fingerprint: `876e01b28fb3617b464a4a85c8e8cc5a1e4f405e7e8678e07f1d0ddb12820eac`.

**F13 In Progress; AC-13/AC-15 PARTIAL; AC-14/AC-16 PENDING; restantes critérios e estados inalterados.** Catálogos editoriais produtivos, integração com IdP externo e rollout produtivo permanecem pendentes. Lifecycle do perfil, aprovação/publicação, snapshots/activation, frontend e matching continuam fora do âmbito fechado. Não se inicia outra fatia, não se altera código/migrations/manifests/pins/critérios e não se cria commit/stage. Feature integral não arquivada nem marcada Complete.

## Proposta da fatia 7 — capacidade operacional ORG-only

**Estado histórico da proposta: Draft, substituído pela aprovação humana e implementação da fatia 7 registadas nesta ação.** A ausência de migration/pins descrevia somente o momento da proposta. As decisões pendentes abaixo são histórico, prevalecendo os contratos aprovados no início deste documento. F13 continua In Progress; fecho da fatia 6 e estados dos critérios preservados.

### Objetivo e boundary normativo

Representar declarações institucionais agregadas de recursos/capacidade operacional num período explícito, com versões, proveniência, autoridade e evidência verificáveis, sem gerir recursos em tempo real. A decisão `f13-operational-capacity` admite ORGANIZATION|UNIT na F13 integral; esta proposta entrega somente ORGANIZATION. UNIT/TEAM, rollups, partitions para agregação e lifecycle do perfil não são antecipados. AC-17 não pode ser integralmente demonstrado por este recorte.

### Âmbito incluído

- Assertions tenant-local, versionadas e ORG-only: identidade estável e head próprios, sem alterar os drafts/heads dos domínios fechados. Tipo/métrica de capacidade, unidade e compatibilidade por catálogos fechados e versionados; sem tipos livres, unidade universal ou seeds produtivos.
- Quantidade explicitamente declarada, decimal exato, unidade e período/horizonte de referência. Proposta inicial: apenas representação exata, sem intervalos/bandas/derivação; precisão, limites e semântica temporal ainda exigem aprovação. Datas civis, se adotadas, são texto DATE sem conversão UTC.
- Papéis TOTAL e AVAILABLE já existentes no contrato normativo, como assertions independentes e explícitas. Não calcular AVAILABLE a partir de TOTAL, nem exigir o par, preencher ausência, somar declarações ou interpretar competência/experiência como capacidade. COMMITTED/RESERVED e modos de acesso ficam fora deste recorte salvo aprovação explícita de suporte estrutural mínimo.
- Organização e scope Organization resolvidos no servidor a partir de F3 e baseline canónica. Localização, se aplicável, é uma referência canónica resolvida/validada server-side, nunca morada livre ou organização confiada ao caller; fonte, granularidade e necessidade são decisões pendentes. Uma localização não transforma a assertion em overlay UNIT, coverage territorial ou prova de disponibilidade.
- Proveniência estruturada mínima, autoria humana estável, versões dos catálogos/policy e estados epistemológicos explícitos, separados de workflow/verificação. Ausência, UNKNOWN, NONE, NOT_APPLICABLE e zero não colapsam; WITHHELD é projeção, não estado de conhecimento. Combinações suportadas e requisitos por métrica precisam de aprovação.
- Referências F11 opcionais com binding exato, estado autorizado/CLEAN e grants cumulativos: permission operacional mais DOCUMENT_READ exato. Associação não concede acesso, não copia/reclassifica conteúdo nem cria verificação automática. Leitura, verificação e replay que devolvam referências reautorizam F11.
- Create/edit/read/submit/verify/reject/dispute/revoke explícitos; CAS/expected revision, intenção normalizada, idempotência organization/operation/key/digest, conflito de intenção e histórico append-only. Replay de leitura ligado à revisão originalmente auditada, com autorização atual e validade efetiva; uma nova revisão exige nova leitura auditada.
- Runtime confiável F3/F4/F5, mesma conexão preparada em loaders/autorizações/mutação/F7/idempotência/commit; authority commit guard e recovery durável já existentes, incluindo COMMIT incerto, sem bypass por resultado persistido.

### Âmbito excluído

Scoring, elegibilidade, agregações/rollups/conversões ou disponibilidade derivada; disponibilidade em tempo real; reservas, agendamento, planeamento e gestão de recursos/colaboradores, pessoas individuais, horários, timesheets e inventário detalhado; territórios/beneficiários; assertions UNIT/TEAM; aprovação/publicação do perfil; snapshots/activation; frontend; matching/F14. Sem integração de fontes externas ou gestão editorial/admin completa dos catálogos nesta fatia.

### Modelo proposto e invariantes

Modelo conceptual, não DDL aprovado: assertion com organization/scope canónicos e head CAS; revisões imutáveis com tipo/métrica, papel declarado, quantidade/unidade quando KNOWN, período, referência de localização/coverage descritiva quando aprovada, proveniência, documentos, autoria e estado; registo source-local de intenção/resultado não sensível. Catálogos e métodos/reasons/purposes referenciam releases publicadas imutáveis; vazio falha fechado.

Coverage deve identificar o universo declarado sem duplicação implícita. A granularidade mínima e a identificação de assertions comparáveis são decisões obrigatórias, mesmo sem rollup. Não aplicar silenciosamente AVAILABLE<=TOTAL a assertions com métricas, unidades, períodos ou coverage diferentes. A regra, o tratamento de inconsistências e eventual ligação explícita TOTAL/AVAILABLE precisam de aprovação; nenhuma correção automática.

Não guardar identidades individuais, dados RH ou detalhes de ativos. Contagens pequenas podem permitir reidentificação: o contrato mínimo de confidencialidade deve decidir quais métricas podem ser declaradas/divulgadas e com que grants/projeção; sem thresholds/bandas inventados. F7/F10 não incluem quantidades, localização sensível, documentId, conteúdo documental ou digests que permitam reconstruir valores.

### Operações, transições e segurança — proposta para aprovação

| Operação proposta | Origem → destino da assertion | Autoridade/evidência proposta |
|---|---|---|
| create | inexistente → DRAFT | permission própria no scope Organization |
| edit | DRAFT → nova revisão DRAFT | permission própria, expected revision/CAS |
| read | sem transição | permission própria sobre assertion exata; reason/purpose catalogados e acesso F11 cumulativo |
| submit | DRAFT → SUBMITTED | permission própria, CAS e F7 |
| verify | SUBMITTED → VERIFIED | método/validade explícitos, checker independente, MFA recente e F7 |
| reject | SUBMITTED → REJECTED | permission própria, reason, maker-checker e F7 |
| dispute | VERIFIED → DISPUTED | permission própria, reason e F7 |
| revoke | VERIFIED/DISPUTED → REVOKED | permission própria, reason, MFA recente e F7 |

Esta matriz não está aprovada para implementação. Propõe-se validade com EXPIRED derivado no acesso, sem scheduler/persistência, separado de knowledge; limites inclusivos, valid_from/valid_until, validade futura, terminalidade e correção/reentrada após rejeição/revogação devem ser fechados. Não criar transições adicionais por inferência.

Nomes F5 propostos: oito operações `F13_OPERATIONAL_CREATE|EDIT|READ|SUBMIT|VERIFY|REJECT|DISPUTE|REVOKE`, permissions distintas `profile_operational.<op>`, resources `OPERATIONAL_SCOPE` para create e `OPERATIONAL_ASSERTION` para restantes, sempre Organization exata. Nenhuma capacidade implícita; bundles vazios. Loaders server-side confirmam tenant, scope, head/revisão e referências sob lock. Verificação/rejeição devem considerar todos os autores materiais/submissores e autores de evidências; confirmar matriz MFA/SoD integral, incluindo leitura/disputa sensíveis, antes de implementar.

F7 crítico para cada mutação e leitura restrita, na mesma transação: identidade confiável, operação/resource, decisão F5/assurance/policy/versões, revisão anterior/nova, correlação/idempotência e referências versionadas server-side de reason/purpose quando aplicáveis, sem dados operacionais sensíveis. Catálogo de eventos e payload fechado ainda por aprovar. F10 somente operation/resultClass fechadas, sem IDs, quantidades, units/labels editoriais ou localização. Não exportar transaction service, clients ou guards como API funcional.

### Catálogos e decisões necessárias antes da implementação

1. Tipos/métricas de recurso/capacidade admitidos, unidade e compatibilidade, scopes ORG-only e distinção de categorias. Confirmar reutilização compatível do catálogo de métricas existente ou extensão aditiva na 011; não alterar migrations fechadas. Nenhuma escolha de conteúdo produtivo por inferência.
2. Representação numérica exata: precisão/escala, limites, não negatividade e admissão de zero/fracionários por métrica; formato canónico e recusa de rounding silencioso. Confirmar exclusão de intervalos/bandas/FTE até metodologia explicitamente aprovada.
3. Período/horizonte, pontual versus recorrente, datas versus timestamps, inclusividade, validade e semântica de expiração. Não tornar períodos semanticamente diferentes comparáveis.
4. Identidade/coverage mínima e fonte canónica de localização: existência/ausência, ownership, estado ativo/histórico, granularidade e relação com Organization. Sem novo cadastro territorial/localizações por inferência.
5. Papel TOTAL/AVAILABLE, ligação opcional, unicidade e tratamento de duplicados/inconsistências; COMMITTED/RESERVED/access modes fora ou apenas estrutura fechada expressamente autorizada. Nenhuma disponibilidade derivada.
6. Estados epistemológicos e combinações válidas, admissão de NONE/NOT_APPLICABLE por métrica, reasons/proveniência obrigatórios e contrato mínimo de confidencialidade para contagens pequenas. Sem policy ou threshold comercial inventado.
7. Matriz de transições acima, métodos de verificação, reasons de ação/purposes de leitura, requisitos de validade, atores permitidos, MFA/maker-checker e terminalidade/reentrada. Confirmar oito permissions/resources e eventos F7 fechados.
8. F11: binding exato, permissões cumulativas e autorizações em referências históricas/replay; confirmar interseção de grants como boundary sem nova classificação F11. Catálogos inicialmente vazios e fixtures sintéticas explícitas são recomendados; conteúdo editorial e governança de seeds dependem de aprovação separada.

### Critérios afetados e dependências

- Principal: **F13-AC-17**, apenas núcleo ORG-only e não agregação; permanece PENDING até evidência/revisão integral do critério ORG|UNIT/rollup.
- Evidência futura restrita para AC-01/02/04/05/09/11/12/20/21/22/24/25/30/31; AC-18 somente validação de referências canónicas, sem implementar territórios. AC-06/32 relativos a publicação/snapshots não são satisfeitos por authoring operacional.
- F13 mantém In Progress; AC-13/15 PARTIAL, AC-14/16 PENDING e restantes estados inalterados. A proposta não promove nenhum AC.
- Dependências: decisões operational-capacity/knowledge-state/confidentiality/authorization/versioning; F3 e coordinator Central, runtime físico/fencing F4, policy engine F5, ledger F7, F10 e F11; fundação/catalogs F13 e F13-P1; tenant 010 como prefix fechado. Central e tenant mantêm numerações independentes. Nenhum job/scheduler F9 funcional novo.
- Riscos centrais: granularidade incompatível, dupla contagem ou falsa disponibilidade; precisão/temporalidade ambíguas; reidentificação por pequenas contagens; localização estrangeira/arquivada; replay que divulga nova revisão ou documento revogado; corrida de autoridade/COMMIT incerto e regressões em domínios fechados. Contratos e testes abaixo são condições de admissão, não riscos silenciosamente aceites.

### Testes PostgreSQL reais exigidos

1. Central + dois tenants: organização/scope/localização resolvidos server-side, identidade/correlation/assurance forjadas e referências estrangeiras/arquivadas recusadas; RLS/FORCE RLS/grants e acesso global read-only.
2. Catálogos vazios fail-closed, tipo/unidade/período/papel incompatíveis, precisão/limites/rounding e datas civis UTC/Lisbon; coverage e estados epistemológicos com ausência/zero/NONE/UNKNOWN distintos, sem inferências TOTAL/AVAILABLE ou rollup.
3. CAS concorrente e head coerente; revisões/results append-only; mesma key concorrente, digest divergente e separação por organização/operação; replay preso à revisão auditada após avanço do head, nova key com novo F7 e reautorização após revogação/versões stale.
4. Matriz de todas as transições válidas/inválidas; maker-checker sobre stable subjects e todos os autores materiais/documentais; grants unitários e assimétricos no engine F5 real, resource errado, MFA ausente/stale; validade antes/no/depois dos limites e EXPIRED derivado se aprovado.
5. F11 sem grant implícito: documento sem DOCUMENT_READ, de outro tenant, binding errado, não CLEAN/indisponível e grant revogado; replay histórico continua a exigir o documento original mesmo quando o head já não o referencia.
6. F5/F11/F7 falhados produzem rollback integral de assertion/head/history/idempotência/evento. Eventos realmente persistidos correspondem à decisão, versões e reason/purpose; F7/F10 sem quantidades, PII, documentos/localização sensível ou cardinalidade elevada.
7. Guard/fencing físico e revogações concorrentes nas duas ordens; COMMIT incerto, crash antes/depois e recovery repetido, duas confirmações perdidas, sem bypass/duplicação nem handles internos devolvidos.
8. Runner canónico: upgrade 010→011, instalações vazias/prefixes suportados, repetição/concorrência/ledger e falha SQL→ledger; down vazio seguro 011→010→011, recusando dados protegidos e recuperando fingerprint 010, sem downgrade arbitrário. Manifest/checksums/preflight/ACLs/pins novos somente após prova real.
9. Suite backend e focados F3/F4/F5/F7/F11/F13/composição, gates tenant/Central/F13-P1/F12 e F9 PostgreSQL aplicáveis, node --check, git diff --check, scans e cleanup somente dos recursos próprios. Testes com mocks não substituem a composição real.

### Definição de conclusão e recomendação

Primeiro aprovar o recorte e fechar as decisões materiais acima; só depois passar a Ready e autorizar implementação. A conclusão exige contratos documentados, tenant 011 aditiva sem alteração das migrations fechadas, runtime/authoring/verificação demonstrados por testes reais, pins e gates coerentes, regressões verdes e revisão formal read-only sem findings materiais; fecho restrito apenas por aprovação humana. Catálogos produtivos, IdP externo e rollout/SLO permanecem pendentes se não forem comprovados; não confundir fixtures com produção.

**Recomendação:** manter o recorte ORG-only, quantidades exatas e TOTAL/AVAILABLE independentes, sem ampliar para UNIT/rollups ou operação em tempo real. Avançar apenas após aprovação de representação/período/coverage/localização, estados/confidencialidade e matriz de autoridade; se esses contratos editoriais não puderem ser fechados, autorizar explicitamente apenas suporte estrutural fail-closed com catálogos vazios. Não implementar agora nem inventar conteúdo produtivo.

### Integração opcional de email na APP — 2026-10-25
Implementada e validada localmente; contrato e aceitação em context/features/optional-email-verification.md. PASS com botões da APP, IdP/SMTP/PostgreSQL reais e npm start, incluindo cancelamento e reinício. Sem prova de SMTP externo, múltiplos nós ou recuperação por perda do email.
Componente externo RC4 preservado; sem reabrir política documental ou outras features.
Evidência: C:\Users\Utilizador\c4g-evidence\optional-email-app-integration\20261025-223907.
# Trabalho ativo — remoção do runtime legacy UBI (26/10/2026)

Contrato e critérios em [remove-ubi-legacy-runtime.md](features/remove-ubi-legacy-runtime.md). O único runtime de produto suportado passa a ser C4G multi-instituição com OIDC, membership central e dados tenant isolados. Código, rotas, UI, scripts e testes exclusivos do piloto são removidos; migrations e registos históricos permanecem preservados e desligados de qualquer entrypoint. Nenhuma base ou dado é eliminado nesta ação.
