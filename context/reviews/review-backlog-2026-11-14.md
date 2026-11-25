# Triagem das funcionalidades em Review (14/11/2026)

Gerado por leitura automática de `context/features/`. Serve para o utilizador fechar, reabrir ou arquivar em lotes. Não altera nenhum estado.

Critério: uma funcionalidade está em Review quando a linha `Estado:` o diz. "Pendência explícita" quer dizer que o texto contém expressões como "por validar", "não provado", "aguarda", "pendente" ou "por decidir". É uma heurística: uma pendência pode estar descrita por outras palavras, e uma expressão destas pode referir algo já resolvido.

Totais: 71 em Review; 16 sem pendência explícita; 55 com pendência explícita.

## Grupo A: sem pendência explícita (16)

Candidatas a fecho em lote, depois de uma confirmação rápida no ecrã ou nos testes.

| Funcionalidade | Última data no documento |
|---|---|
| [GCNI — custo de execução das verificações PostgreSQL](../features/catalog-query-plans.md) | 2026-11-01 |
| [GCNI — custo por fase e correção da carga durável](../features/catalog-read-performance-phases.md) | 2026-11-01 |
| [Qualidade, manutenção e fronteiras de segurança — novembro 2026](../features/code-quality-hardening-2026-11.md) | 2026-11-01 |
| [Migração controlada do React Router e acompanhamento nodemon](../features/react-router-7-migration.md) | 2026-11-01 |
| [GCNI — C1/C2 isolados](../features/catalog-c1c2.md) | 2026-11-02 |
| [Importação central — disponibilidade e experiência inicial](../features/central-import-availability-experience.md) | 2026-11-02 |
| [Apresentação das correspondências de Matching](../features/matching-results-presentation.md) | 2026-11-10 |
| [Superfícies comuns inspiradas no Metronic](../features/metronic-shared-surfaces.md) | 2026-11-10 |
| [Segurança da conta por método](../features/account-security-methods.md) | 2026-11-11 |
| [Lista documental da candidatura](../features/application-document-list.md) | 2026-11-11 |
| [Filtros de tarefas da candidatura](../features/application-task-filters.md) | 2026-11-11 |
| [Páginas reabrem com os dados já confirmados](../features/confirmed-reads-page-reuse.md) | 2026-11-11 |
| [Prioridades por prazo no Dashboard](../features/dashboard-deadline-priorities.md) | 2026-11-11 |
| [Página de resultado da saída](../features/logout-result-page.md) | 2026-11-11 |
| [O meu trabalho](../features/my-work.md) | 2026-11-11 |
| [Admissão Central por pedido](../features/request-scoped-central-admission.md) | 2026-11-11 |

## Grupo B: com pendência explícita (55)

Ordenadas pelo número de linhas com pendências. O excerto é a primeira ocorrência.

| Funcionalidade | Última data | Linhas | Primeira pendência |
|---|---|---|---|
| [Normalização comum de oportunidades e fontes](../features/opportunity-data-standardization.md) | 2026-10-31 | 19 | Review —11145 aceite no ambiente habitual; restantes fontes pendentes. Pedido do utilizador: uniformizar a recolha com uma estrutura fixa, adaptando APIs/fontes e o Excel Portugal2030. S |
| [Parceiros — preparação do gate PostgreSQL isolado](../features/partner-postgres-gate.md) | 2026-10-28 | 16 | e auditoria. Não exigir commit de writer bloqueado enquanto o reader aguarda no teste. A cache conserva decisões já tomadas e verifica o guard; não inventar revogação de equipa instantânea |
| [Plano técnico — convite e ficha de entidade portuguesa](../features/platform-entity-invited-registration-plan.md) | sem data | 8 | Uma identidade pode ter vários vínculos. Adesão pendente não é membership ativa; não permite catálogo nem funcionalidades operacionais a uma conta nova sem outro acesso legítimo. Outros vínc |
| [Interesse organizacional e abertura de candidatura](../features/organizational-opportunity-interest.md) | 2026-10-30 | 8 | as posteriores continuam exatos. O preflight mantém a verificação independente do schema físico canónico, ownership e ACL/RLS. Nenhum SQL histórico ou ledger habitual é reescrito. |
| [F14-PQ1 — primeira pré-qualificação parcial F13→F14](../features/f14-first-partial-prequalification.md) | 2026-11-10 | 7 | ortunidade para o sujeito; leitura, outras oportunidades e perfis independentes não ficam bloqueados. sessionStorage é proteção de UX, não exclusão entre sessões; CAS/idempotência/guardas as |
| [Concorrência de pedidos — fase 1](../features/request-concurrency-phase-1.md) | 2026-10-26 | 6 | - Leituras independentes e pedidos dirigidos a uma organização explícita podem decorrer em paralelo. |
| [Entrada no dashboard da organização](../features/organization-dashboard-loading-performance.md) | 2026-10-29 | 6 | ao entrar no dashboard da organização cliente. A implementação atual aguarda um agregado autorizado com relatório, oportunidades privadas, catálogo central e validação final. Preservar os i |
| [Correção GET/POST e desempenho](../features/http-flows-performance.md) | 2026-10-27 | 5 | iores, usa drenagem limitada e serializa apenas rotações. Pedidos independentes continuam concorrentes. Escritas já admitidas nunca são repetidas por timeout ou erro de rede. |
| [F12 — Criação e arquivo privados pela APP existente](../features/f12-private-opportunity-authoring.md) | 2026-10-29 | 5 | tente, expectedRowVersion e requestId, OPPORTUNITY_PRIVATE_UPDATE independente. |
| [GCNI — aceitação OIDC e carga com controlos duráveis](../features/catalog-read-durable-acceptance.md) | 2026-11-01 | 5 | 5. Evidências sem tokens/credenciais, recomputação independente dos resultados, estado final OFF e limpeza dos recursos próprios. Autorrevisão e limitações explícitas; autenticação instituci |
| [Apresentação da segurança da conta](../features/account-security-presentation.md) | 2026-11-11 | 5 | nic-account/. Suite frontend com 944 testes e build concluídos. Fica pendente aplicar o CSS no Keycloak local e recarregar o Nginx. |
| [Hierarquia e cores dos botões](../features/button-color-hierarchy.md) | 2026-11-11 | 5 | o: build PASS; 922 testes frontend PASS. Validação visual autenticada pendente. Por rever: ecrãs com mais de uma ação principal visível (Entidades e utilizadores) e rótulos dinâmicos que o l |
| [Interesses → Nova candidatura](../features/interest-application-shortcut.md) | sem data | 4 | - Envios pendentes ou ilegíveis bloqueiam nova preparação sem apagar a intenção. Duplo clique não inicia consultas duplicadas. Troca de utilizador, organização, página ou filtros invalida a |
| [Faturação do cliente](../features/customer-billing.md) | 2026-11-10 | 4 | 1-06. Primeira versão de consulta implementada; componente documental pendente. Construção autorizada pelo utilizador. |
| [Dados de faturação: pré-preenchimento e secção do cliente](../features/billing-account-prefill-and-customer-section.md) | 2026-11-12 | 4 | ão identificados como vindos da ficha. Ficha incompleta: os campos em falta ficam vazios. |
| [Revisões documentais atribuídas](../features/assigned-document-reviews.md) | sem data | 3 | al, escolher um revisor. O dashboard do Técnico apresenta as revisões pendentes atribuídas à sua membership em todas as candidaturas acessíveis, com paginação. |
| [Consolidação da instalação local C4G](../features/local-platform-consolidation.md) | 2026-10-17 | 3 | a tarefa. Confirmar prontidão da API/worker. Não migrar sessões, jobs pendentes nem a candidatura sintética do ambiente de demonstração. |
| [Acesso dos técnicos pela equipa da candidatura](../features/application-technician-team-access.md) | 2026-10-18 | 3 | ação OIDC habitual PASS. O fecho humano/global da entrega 5 permanece pendente. |
| [Recuperação do piloto — entrega 4 / Alertas](../features/c4g-pilot-parity-delivery-4-alerts.md) | 2026-10-18 | 3 | de utilizador, membership ou organização descarta resultados e ações pendentes. Contagem não lida vem do servidor, não do tamanho de uma página. |
| [Entrega 4 — importação Portugal 2030](../features/c4g-pilot-parity-delivery-4-portugal2030.md) | 2026-10-18 | 3 | iew · 18/10/2026. Preparação implementada e validada; importação real pendente por decisão do utilizador de manter a configuração para o final. [Revisão e evidência](../reviews/c4g-pilot-par |
| [Ficha portuguesa — rascunho e formulário](../features/platform-entity-registration-draft.md) | 2026-10-18 | 3 | lidar e guardar ficha: não simula a conclusão/provisionamento ainda pendentes. |
| [Paginação SQL de parceiros — contrato de compatibilidade e provas](../features/partner-sql-pagination.md) | 2026-10-27 | 3 | / Suite reutilizável de comportamento do leitor com expectativas independentes, dados sintéticos e adapter atual; sem alegar equivalência SQL antes de existir candidato / |
| [Dashboard da organização — compatibilidade com tenant 034](../features/organization-dashboard-schema-compatibility.md) | 2026-10-31 | 3 | reção e testes concluídos; confirmação visual na sessão do utilizador pendente. |
| [Retenção do chat da candidatura](../features/application-chat-retention.md) | 2026-11-11 | 3 | ## Pendentes |
| [Cópias de segurança do staging para o R2](../features/staging-backups.md) | 2026-11-13 | 3 | Review (13/11/2026), por validar na VPS. Pedido do utilizador: agendamento e teste de restauro, com as cópias numa pasta do R2 já ligado. Ambiente: [staging na VPS](staging-vps-deployment.md |
| [Entrega 5 — Dashboard, indicadores e relatório de candidaturas](../features/c4g-pilot-parity-delivery-5-dashboard.md) | 2026-10-18 | 2 | ganização ou perda de acesso descarta resultados antigos e exportação pendente. |
| [Desempenho interno e data civil do Matching](../features/matching-backend-performance.md) | 2026-10-26 | 2 | tral e catálogo privado em paralelo, porque residem em fronteiras independentes. |
| [Uma conta de entidade, uma entidade](../features/single-organization-membership.md) | 2026-10-26 | 2 | ltaneamente mais de uma membership não removida, mesmo que uma esteja pendente ou suspensa. |
| [Auditoria de qualidade — incremento 2](../features/code-quality-audit-increment-2.md) | 2026-10-27 | 2 | ancelamento antes/depois de connect e enquanto a fonte abre/transmite/aguarda resposta. A promise termina com código de cancelamento, nunca CLEAN; não abre storage depois de abort observado; |
| [Parceiros — protótipo isolado do portal SQL](../features/partner-portal-prototype.md) | 2026-10-27 | 2 | dos, a captura simulada entre lotes, falhas em cada fase, expiração e falta de resposta parcial. Não apresentar doubles como prova de snapshot/RLS/cleanup PostgreSQL real. |
| [Apresentação das fontes de oportunidades](../features/opportunity-sources-presentation.md) | 2026-10-29 | 2 | Histórico preservado. Erros, cobertura parcial, limitações e pedidos por confirmar continuam visíveis. |
| [Dashboard — leituras de autoridade do relatório](../features/dashboard-report-authority-read-group.md) | 2026-10-31 | 2 | ados, suites completas backend/frontend, build, sintaxe e revisão independente. Registar falhas preexistentes separadamente. |
| [Dashboard — custo das três operações tenant](../features/dashboard-tenant-read-cost.md) | 2026-10-31 | 2 | nto, regressões e comparação real do coletor concluídos; medição HTTP pendente por indisponibilidade da aplicação. [Resultados e limites](../reviews/dashboard-tenant-read-cost.md). |
| [Ficha de candidatura — separadores e modais](../features/application-detail-workspace.md) | 2026-11-10 | 2 | nos históricos. Mantidas mensagens necessárias para permissões, envio pendente, carregamento/associação e revisão interna. Sem alteração de contratos, permissões ou operações. |
| [Faturação: apresentação Enterprise e histórico](../features/billing-enterprise-history.md) | 2026-11-10 | 2 | validação visual em navegador e a revisão global da paleta permanecem pendentes. O histórico reutiliza os filtros e paginação existentes; o resumo não é filtrado. |
| [Paleta petróleo C4G](../features/c4g-petrol-palette.md) | 2026-11-10 | 2 | car build e testes focados; validação visual e contraste no navegador pendentes. Não reformular outras páginas. |
| [Prioridades na lista de candidaturas](../features/application-list-priorities.md) | 2026-11-11 | 2 | ado. Prioridade de ação: alterações pedidas, tarefas abertas, revisão pendente, consultar candidatura. |
| [Feedback dos separadores do Dashboard](../features/dashboard-tab-feedback.md) | sem data | 1 | . Build e 25 testes Dashboard aprovados. Inspeção visual em navegador pendente. |
| [Limites locais de observabilidade](../features/observability-local-bounds.md) | sem data | 1 | . O limite de 2048 segue o contrato F10; a auditoria F7 permanece independente. |
| [Entrega 4 — comunicação administrativa na aplicação](../features/c4g-pilot-parity-delivery-4-communication.md) | 2026-10-18 | 1 | fonte de verdade. Permissão própria de leitura da caixa pessoal, independente de acesso às candidaturas; autorização de candidatura/oportunidade continua necessária para revelar os respetiv |
| [Perfis internos no ecrã Acessos](../features/organization-internal-access-profiles.md) | 2026-10-18 | 1 | Access.jsx apresenta nome, email e estado, com suspensão/reativação; falta o perfil. |
| [Entidades e utilizadores — consulta no ambiente habitual](../features/platform-directory-screen.md) | 2026-10-18 | 1 | reais; contas/dados/acessos preservados. Criação e ativação continuam pendentes. |
| [Adesão de entidades — integração local](../features/platform-entity-registration-local.md) | 2026-10-18 | 1 | natário autentica no Keycloak, preenche a ficha portuguesa, submete e aguarda preparação automática. Sem registo público, email ou alteração de contas existentes. A ficha integra o perfil ca |
| [Correções da auditoria de qualidade](../features/code-quality-audit-corrections.md) | 2026-10-27 | 1 | aginação integral, capacidade Matching e contrato RFC 9457 permanecem pendentes. |
| [Apresentação do Dashboard C4G](../features/platform-dashboard-presentation.md) | 2026-10-29 | 1 | - Sem alterações de backend, contratos, dados reais ou deploy. Aguarda apreciação visual do utilizador. |
| [Revisão do conteúdo dos tooltips](../features/tooltip-content-review.md) | 2026-10-29 | 1 | sárias para interpretar agregados e orçamento, sem repetir valores em falta já indicados nas células. Preservar limites funcionais de matching, critérios e análise parcial. Substituir jargão |
| [GCNI — consultas de admissão do esquema e permissões](../features/catalog-admission-queries.md) | 2026-11-01 | 1 | , limpeza própria e exposição OFF. Desempenho acima da meta permanece por aprovar. |
| [GCNI — esperas e renovação de sessões](../features/catalog-session-contention.md) | 2026-11-01 | 1 | o temporal de cache e sem guardar resultado concluído. Limitar grupos pendentes a256; saturação, anónimo, legado ou auth diferente usam o percurso original. Propagar falhas a todos os partic |
| [Lista e resumo lateral de candidaturas](../features/application-list-preview.md) | 2026-11-10 | 1 | star dessa projeção. Teste visual em navegador e responsividade reais pendentes. |
| [Barra superior e pesquisa de páginas](../features/header-navigation-search.md) | 2026-11-10 | 1 | passaram em 10/11/2026. Validação visual em navegador e teclado real pendente. A pesquisa não inclui faturação de cliente, cuja visibilidade depende de uma verificação de acesso própria. |
| [Apresentação de convites e ativações](../features/invitation-presentation.md) | 2026-11-10 | 1 | ntend passaram em 10/11/2026. Validação visual no navegador permanece pendente; nenhum convite ou email real foi enviado. |
| [Atualização visual do dashboard da entidade](../features/organization-dashboard-visual-refresh.md) | 2026-11-10 | 1 | nd passaram. Validação visual em navegador e contraste real permanece pendente. |
| [Apresentação do perfil pessoal](../features/personal-profile-presentation.md) | 2026-11-10 | 1 | perfil e build frontend passaram. Validação visual no navegador ainda pendente; estilos de cartões aplicam-se apenas ao perfil pessoal. |
| [Alertas e leitura do calendário](../features/alerts-and-calendar-readability.md) | 2026-11-11 | 1 | de leitura. Identificar não lidos em texto; não confundir com tarefa pendente. |
| [Lista e resumo lateral do catálogo](../features/catalog-list-preview.md) | 2026-11-11 | 1 | resumo, passaram; build frontend PASS. Validação visual no navegador pendente. |

## Fechadas em 14/11/2026 (lote 1: grupo A de outubro)

Fechadas por decisão do utilizador, depois de verificar que o código e os testes descritos existem e que as suítes passam (backend 3193, frontend 1014, build e lint). Em cada documento, a linha `Estado:` diz o que não foi repetido: provas em navegador, gates PostgreSQL isolados e instalações locais.

- [Plataforma local — PostgreSQL nativo e dois acessos](../features/local-postgres-platform.md)
- [MFA opcional por utilizador](../features/optional-user-mfa.md)
- [Dashboard da administração C4G](../features/platform-admin-dashboard.md)
- [Conclusão da ficha e preparação da entidade](../features/platform-entity-registration-completion.md)
- [Adaptadores reais de onboarding em composição isolada](../features/platform-onboarding-real-adapters.md)
- [Serviço central de criação e ativação](../features/platform-onboarding-service.md)
- [Logs simples da plataforma](../features/platform-simple-logs.md)
- [Pesquisa nos filtros de faturação](../features/billing-search-style.md), absorvida pelo `SearchInput`
- [Loader orbital C4G](../features/orbital-loading-indicator.md)
- [Entidades e utilizadores — apresentação](../features/directory-visual-presentation.md)
- [Login em português de Portugal](../features/login-portuguese-portugal.md)
- [Apresentação das fichas de oportunidades](../features/opportunity-detail-visual.md)
- [Barras de filtro partilhadas](../features/shared-filter-bars.md)
- [Registar interesse na tabela do catálogo](../features/catalog-table-interest.md), substituída pelo interesse organizacional
- [Campos de pesquisa homogéneos](../features/homogeneous-search-bars.md)
