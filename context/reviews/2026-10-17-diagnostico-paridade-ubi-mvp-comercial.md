# Diagnóstico crítico: piloto UBI, aplicação atual e MVP comercial

Data: 17 de outubro de 2026, Europe/Lisbon. Diagnóstico read-only; não autoriza implementação. Referências relativas à raiz do repositório, com linhas observadas nesta análise.

**Âmbito temporal:** branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, com alterações e ficheiros não versionados preexistentes. O worktree e os serviços mudaram durante a inspeção por atividade alheia a esta análise. A última reconferência de composição, candidatura central e interface foi feita aproximadamente às 15:59. Não existe um snapshot imutável de todo o sistema. A nova fatia Funding & Tenders é tratada como trabalho em curso, incluindo o código que surgiu durante a inspeção, e não como ausência definitiva de implementação.

Convenções: **facto** = observado no código, Git, resposta HTTP ou SQL; **evidência anterior** = execução registada por outro trabalho, não repetida aqui; **inferência** = consequência fundamentada, ainda sem reprodução integral; **recomendação** = proposta, não requisito aprovado. “Produtivo” designa composição destinada a produção, não validação efetiva em produção.

## 1. Diagnóstico executivo: o que temos, o que falta e o que está a complicar

**Estamos mais próximos de uma plataforma segura para várias entidades, mas ainda não de uma demonstração comercial completa e coerente dos percursos do piloto.** A aplicação atual tem identidade central, memberships, resolução de tenant, autorização por recurso, isolamento, histórico, idempotência e testes muito superiores ao piloto. Tem também candidaturas manuais e tarefas implementadas, com provas locais anteriores. Porém, o Dashboard, notificações e vários menus continuam ligados ao modelo UBI; o novo ciclo de candidatura não chega a submissão/resultado; o acesso documental produtivo está fechado; a recolha central de oportunidades ainda não tem transporte real operacional comprovado.

O principal problema já não é falta de todos os domínios: é **composição incompleta entre capacidades existentes, configuração demonstrável e percursos reconhecíveis pelo utilizador**. Não recomendo reescrever. Recomendo concluir a paridade funcional segura, aproveitando candidaturas, tarefas, catálogo e infraestrutura já construídos, e suspender a expansão de F13/F14 que não seja necessária a esses percursos.

### O ponto de partida realmente encontrado

A melhor referência do piloto é `3a79b25`, de 12/05/2026, último commit antes da transição de outubro. Não foram encontradas tags que identifiquem uma versão comercial ou implantada. O histórico começa em maio; esta referência é uma baseline de código, não certificação de produção. Nesse commit, `frontend/src/App.jsx:54` e `backend/src/server.js:113` ligavam os módulos principais. Muitos controladores legacy atuais são praticamente iguais aos dessa baseline, permitindo referências atuais legíveis.

O piloto não era apenas um mock: existiam cadeias UI → API → SQL, anexos em disco e conectores HTTP. Tinha Dashboard, pesquisa/filtros/detalhe de oportunidades, importação Excel, candidaturas, coordenador/equipa/parceiros, histórico, prazos e notificações. Tinha limitações estruturais importantes: uma base, papéis ADMIN/PROFESSOR, conceitos UBI embutidos e jobs/bootstrap na API.

**Duas correções à expectativa de paridade:** não foi encontrado domínio autónomo de tarefas no piloto; havia prazos de oportunidade e candidatura. Também não foi encontrado workflow formal de aprovação documental: `APROVADO` era estado/resultado de candidatura. Tarefas e revisão documental atuais são capacidades novas, embora façam parte do objetivo comercial agora pedido.

### O que a observação atual permite afirmar

- Frontend Vite em `localhost:3100` respondeu 200 com título HTML “UBI Research”; API em `localhost:5000` respondeu 200 e anunciou OIDC, oportunidades F12, candidaturas e importação XLSX. `health/live`, `health/db` e `health/ready` responderam positivamente.
- Sem sessão, `/api/auth/session`, `/api/opportunities` e `/api/dashboard` devolveram 401 `SESSION_REQUIRED`. Isto confirma proteção de entrada, não funcionamento autenticado nem isolamento entre organizações.
- Não havia browser acessível pela ferramenta. Não foram feitos login, criação de sessão, seleção de organização, cliques de mutação ou contorno da autenticação.
- Na base central local de integração em 5441, uma transação READ ONLY encontrou migrações 000–014, uma membership e zero oportunidades centrais. Não estava aplicada a nova migration central 015 nesse momento. Na base legacy local em 5442, existiam sete tabelas públicas e zero oportunidades; não existia `applications`.
- Estas bases foram identificadas por contentores de integração. Não foi possível ler a configuração do processo ativo; **não está provado que sejam exatamente todas as bases utilizadas pela API em 5000**. O health não fornece essa associação.
- Dezassete testes unitários direcionados passaram nesta análise. Não equivalem a teste integrado da composição ativa, nem a aprovação de produção.

**Conclusão operacional:** há implementação suficiente para recuperar valor rapidamente, mas não há evidência atual bastante para declarar “abrir a app e demonstrar todo o MVP”. O processo tem confundido, em alguns pontos, conclusão de uma fatia técnica com entrega de um percurso disponível num ambiente persistente.

## 2. Matriz piloto versus aplicação atual

### Escala de prova

| Nível | Significado | Situação encontrada |
|---|---|---|
| Código existente | Módulos, schemas ou UI no worktree | Amplo; inclui trabalho ainda não commitado |
| Código ligado | Router/componente/composição seleciona o módulo | Confirmado estaticamente para vários fluxos; condicionado por flags e dependências |
| Demonstrado localmente | Execução concreta, identificando doubles e fixtures | Provas anteriores para F12, candidaturas, tarefas, PQ1 e revisão documental; HTTP anónimo e testes puros executados nesta análise |
| Pronto para piloto | Percurso utilizável por papéis reais num ambiente estável, com dados adequados e integrações necessárias | Não demonstrado globalmente |
| Validado em produção | Operação real, integrações, isolamento, recuperação e suporte comprovados | Não estabelecido por esta análise |

As duas tabelas seguintes constituem uma única matriz, ligadas pelo ID. O esforço é relativo: **P** pequeno, **M** médio, **G** grande; não representa horas. Integração de serviços externos reduz a confiança da estimativa.

### Comportamento, composição e disponibilidade

| ID / funcionalidade | Piloto UBI | Implementação atual e interface | Runtime atual / persistência / integrações | Classificação |
|---|---|---|---|---|
| M1 Dashboard | Indicadores SQL de oportunidades, candidaturas, estados, orçamento UBI, centros e prazos | Componente conservado; chama `/dashboard`; não agrega o novo domínio tenant | Rota anunciada; autenticada não testada. Controlador continua no pool legacy; não demonstra trabalho novo | Reutilizada, mas desligada dos dados novos |
| M2 Oportunidades privadas | CRUD, pesquisa, filtros, paginação e detalhe ligados à BD | F12, UUIDs, arquivo, revisões, autoria e importação privada; UI própria | Rota F12 anunciada; provas locais anteriores. Persistência tenant existente; disponibilidade autenticada não verificada agora | Reescrita/adaptada |
| M3 Catálogo público comum | Oportunidades comuns de facto na única base UBI, sem separação comercial | Repositório central F12; nova página `/catalogo`, detalhe e origem pública | Novo wiring opt-in observado. Base central inspecionada vazia e só até 014; não provada disponibilidade no processo ativo | Nova |
| M4 ADMIN e fontes API | Botões e endpoints ADMIN, histórico de execuções; HTTP/SQL reais | Legacy persiste; nova UI Funding Tenders, administração C4G, fila e repositório central | Worker novo só admite fixture local; não comprovada recolha real. OIDC ADMIN não equivale ao ADMIN legacy | Adaptada/reescrita, parcial |
| M5 Importações | XLSX Portugal 2030, preview, processamento síncrono, template e histórico | F12 XLSX com infraestrutura privada, job, preview/confirmação e relatório | Endpoint anunciado; provas anteriores restritas. Composição exige infraestrutura explícita F4/F5/F11; CSV universal não demonstrado | Adaptada/reescrita |
| M6 Matching | Correspondência por áreas de professor e oportunidade, contagem e ordenação | Legacy continua; F13/PQ1/F14 introduzem perfil, publicação, ativação, critérios e avaliação parcial | Provas locais anteriores do novo percurso; catálogos/configuração condicionam uso. Não equivale a ranking comercial completo | Reescrita e muito ampliada |
| M7 Candidatura manual | Oportunidade + título; coordenador, equipa, prazos, orçamento, estados e histórico | Nova candidatura com responsável central, prazo, edição e histórico; avaliação opcional | Persistência tenant e provas locais A/B anteriores; rota ativa anunciada. Novo vínculo central entrou durante análise e ainda não foi demonstrado aqui | Reescrita, parcial |
| M8 Etapas/resultado | Estados fixos incluindo submissão e resultados; sem pipeline livre | Novo contrato só INTENTION, PREPARATION, CANCELLED, ARCHIVED | Teste exige rejeitar SUBMITTED. Não é falha de configuração: é recorte funcional deliberado | Adaptada com perda temporária de alcance |
| M9 Equipa/parceiros | Coordenador, membros, parceiros e pessoas associadas | Participantes por membership e tarefas; parceiros continuam página/rotas legacy | Equipa nova com persistência tenant e provas anteriores. Parceria do piloto não foi portada integralmente para candidatura nova | Equipa reescrita; parceiros desligados do novo fluxo |
| M10 Tarefas e prazos | Prazos de candidatura/oportunidade; sem tarefas autónomas encontradas | Tarefas atribuídas, prazo, edição, conclusão/cancelamento e histórico | Persistência tenant 022; provas locais anteriores. Falta visão transversal de tarefas/prazos no Dashboard | Tarefas novas; prazos adaptados |
| M11 Documentos | Upload/download de anexos em disco, autorização legacy; sem versões/revisão formal | F11, versões, associação exata, estados CLEAN/AVAILABLE e download por port; UI seleciona versões existentes | Domínio e prova anterior com storage/scanner doubles. Sem upload normal na UI; port documental indisponível em produção | Reescrita, entrega produtiva desligada |
| M12 Revisão/aprovação | APROVADO como estado, não circuito documental | Pedido fixa conjunto de versões; decisão separada, MFA, comentário, histórico, conjunto obsoleto | Migration 023 e prova local anterior; disponibilidade depende de F11 e grants. Não altera automaticamente candidatura | Nova |
| M13 Alertas/notificações | Prazos, abertura, mudanças de estado, registos e SMTP implementados | Scheduler/controladores legacy mantidos; fundação async nova não é produto de alertas tenant | Sem prova de alerta sobre nova tarefa/candidatura nem entrega real; SMTP legacy não comprova Resend | Reutilizada, desligada do domínio novo |
| M14 Utilizadores/permissões | ADMIN/PROFESSOR, JWT, utilizadores ativos; sem tenants | OIDC, membership central, organização selecionada, permissões detalhadas; gestão visual de utilizadores ainda legacy | 401 observado; testes de segurança existem. Onboarding/administração da organização sem percurso completo demonstrado | Reescrita em segurança; UI parcial |

### Isolamento, testes, lacunas e esforço

| ID | Isolamento multi-tenant | Evidência de testes | Lacuna principal para primeiro cliente | Esforço / confiança |
|---|---|---|---|---|
| M1 | Controlador legacy não resolve tenant | SQL inspecionado; não executado autenticado | Dashboard deve ler candidaturas/tarefas reais da organização | M / alta |
| M2 | Resolver/autoridade/repositório tenant; sem fallback UUID→legacy | Suites F12 e gates anteriores; não repetidos | Composição persistente, grants e pesquisa adequada aos dados reais | M / média |
| M3 | Leitura comum com membership; trabalho privado separado | Código novo inspecionado; nenhuma prova integrada atual | Aplicar/validar em ambiente autorizado a fatia nova e preencher com fonte real | M–G / média-baixa |
| M4 | Novo ADMIN central separado; legacy usa role global | 10 testes puros de fonte/merge passaram | Transporte real, execução worker, estado visível e ensaio externo autorizado | M–G / média |
| M5 | Contratos privados F4/F5/F11 e execução por organização | Fecho XLSX restrito anterior | Operação sem configuração ad hoc; não exigir importação para usar candidatura | M / média |
| M6 | Novo domínio usa tenant/autoridade; matching legacy não é modelo universal | Provas PQ1 anteriores; não repetidas | Não bloquear MVP pelo perfil completo; retirar centralidade da navegação | P para adiar / alta |
| M7 | Organização server-side, grants, recibos, responsável central | 4 testes puros da primeira fatia passaram; PostgreSQL/browser anteriores | Demonstração persistente e reconferência do novo caminho central | M / média |
| M8 | Extensão deve conservar os controlos atuais | Rejeição de submissão explicitamente testada | Submetida e resultado com histórico; não exige pipeline genérico | P–M / alta |
| M9 | Participação não concede grants; membership validada | 3 testes puros work passaram; gates anteriores | UX por papel; decidir necessidade inicial de parceiros externos | P–M / média |
| M10 | Tenant, responsável autorizado e histórico | Mesmo recorte work; testes de paginação existentes | Lista transversal de prazos, alertas e recuperação acessível | M / alta |
| M11 | F11 por recurso/versão, storage privado e scan | Prova anterior com doubles; não comprova R2 real | Upload/scan/download reais e fluxo de falha/quarentena | G / média-baixa |
| M12 | Decisor distinto, grant próprio, MFA, versão exata | Gate local anterior A/B/concorrência; não repetido | Serviços documentais reais e UX clara para revisor | M, dependente de M11 / média |
| M13 | Legacy sem ligação aos eventos privados novos | Implementação antiga e fundações; sem E2E tenant atual | Alertas in-app tenant e entrega de email quando prometida | M / média |
| M14 | Grande progresso estrutural, mas rotas legacy paralelas | Suites novas de segurança; não certificadas aqui em conjunto | Papéis demonstráveis e administração de membros praticável | M / média |

### Referências de suporte à matriz

| Área | Evidência técnica principal |
|---|---|
| Dashboard | `frontend/src/pages/Dashboard.jsx:390`; `backend/src/controllers/dashboardController.js:217` e `:370`; ligação legacy no frontend `:618` |
| Oportunidades UBI | `backend/src/controllers/opportunityController.js:90`, `:214`, `:251` |
| Fontes UBI | `backend/src/routes/integrationRoutes.js:6`; `backend/src/services/euFundingSyncService.js:107`, `:182`; `externalOpportunitySyncService.js:15`, `:21`, `:83` |
| Importação UBI | `backend/src/controllers/importController.js:30`, `:64`, `:109`, `:199`, `:235` |
| Matching UBI | `backend/src/controllers/matchingController.js:4`, `:13`, `:21` |
| Candidaturas UBI | `backend/src/controllers/applicationController.js:290`, `:347`, `:482`, `:648`, `:713`; estados `:8` |
| Anexos UBI | `backend/src/routes/applicationRoutes.js:9`, `:35`, `:44`; metadados `applicationController.js:578` |
| Alertas/email | `backend/src/services/notificationService.js:119`, `:242`; `emailService.js:127`, `:189`, `:208` |
| Candidaturas novas | `backend/src/applications/contracts.js:3`, `:11`; `repository.js:14`, `:23`; `composition.js:40`; `backend/src/routes/applicationSliceRoutes.js:10` |
| Equipa/documentos | `frontend/src/pages/Applications/ApplicationWork.jsx:59`; `ApplicationDocumentsReview.jsx:49`; migrations tenant 022 e 023 |
| Catálogo novo | `backend/src/fundingTenders/http.js:10`, `:16`; `config/fundingTendersWorker.js:7`; `frontend/src/pages/Opportunities/CentralOpportunities.jsx:18`; migration tenant 024 |

## 3. Estado dos percursos por papel de utilizador

**Limite da observação:** a ferramenta devolveu inventário de browsers vazio e `Browser is not available: iab`. Não houve percurso autenticado presencial. A avaliação abaixo combina navegação/guardas no código, HTTP anónimo efetivamente observado e provas integradas anteriores claramente identificadas. Não atribuo a falha da ferramenta à aplicação.

| Papel | Percurso esperado | O que encontra no código ligado | Obstáculos concretos / prova pendente |
|---|---|---|---|
| Administrador da plataforma | Entrar, gerir fonte comum, atualizar, ver resultado e disponibilizar oportunidades | `isAdmin` reconhece C4G_ADMIN; nova página Funding Tenders em `/integracoes`; router central verifica assignment e MFA | Worker fixture-only; ausência de recolha real. Menus de utilizadores/áreas/investigadores ainda UBI. Demonstrar atualização real e consulta por duas organizações |
| Gestor da organização | Escolher organização, consultar oportunidade, criar candidatura, gerir equipa/prazos/documentos | Seletor, F12, candidatura manual e work; criação central adicionada durante análise | Perfil/PQ1 não é obrigatório. Falta ciclo submetida/resultado, Dashboard tenant e upload real. O menu mistura ferramentas UBI e editoriais; permissões recusadas só após tentativa em vários formulários |
| Revisor | Encontrar pedidos, consultar versões e decidir | Secção documental no detalhe, grant próprio, decisor distinto/MFA, comentário e histórico | Não foi encontrada caixa transversal de pedidos atribuídos; depende de descobrir candidatura e ter grants F11. Download produtivo fechado; 403/404 pode deixar intenção pendente |
| Consulta | Ver dados autorizados, prazos e documentos, sem edição | Backend pode recusar escrita por grants; rotas partilhadas | UI não adapta consistentemente formulários ao papel; Dashboard legado não é vista tenant; notificações estão sob guarda admin. Não foi provada experiência de consulta completa |

`frontend/src/components/Layout/Sidebar.jsx:8` apresenta os módulos editoriais e de qualificação junto dos percursos diários. Mantém logótipo UBI. `AuthContext.jsx:73` calcula administração global por role legacy ou `platformRoles`; isso não transforma automaticamente um administrador da organização em administrador da plataforma. `App.jsx` conserva guardas admin para utilizadores, integrações e notificações. A importação F12 pode ser admitida pela rota sem admin, mas o link continua dentro do grupo admin do menu: descobrir uma capacidade pode exigir URL direta.

A UI expõe termos como “ID da avaliação F14”, “Versão F11”, membership e revisão. São identificadores de implementação úteis para diagnóstico, mas tornam o percurso dependente de conhecimento técnico. Recomenda-se seleção por nomes/estado e textos de ação do negócio, mantendo identificadores nas ferramentas de suporte. A lista documental nova já apresenta versões por nome/estado: aproveitar essa melhoria, não regredir para UUID manual.

Não observei páginas vazias autenticadas no browser. Observei **condições que as produzem**: catálogo central vazio na base inspecionada; lista sem organização; F11 sem serviços; endpoints não configurados devolvendo 503; dados e componentes legacy sem correspondência com candidaturas tenant. O frontend 200 sozinho não prova renderização React, login, chunks ou conteúdo funcional.

## 4. Arquitetura e fronteiras multi-tenant

### Onde ficam os dados e quem tem autoridade

| Domínio | Destino aprovado / código atual | Distinção crítica |
|---|---|---|
| Identidade e sessões | Keycloak/OIDC; `global_user`, identidade referenciada, sessões e assignments na central; `security/identityRepository.js:5`, `sessionAuth.js:34` | Identidade global não concede acesso a todas as organizações |
| Membership | `organization_membership` central; verificação server-side e revogação; `applications/composition.js:48` | Projeção local e participação em candidatura não substituem membership/grants |
| Catálogo público | Base central, `opportunity_catalog`; repositório F12 e nova fonte Funding Tenders | Recolher uma vez para todos; cliente consulta, não altera silenciosamente o comum |
| Oportunidades privadas | Base tenant, contexto da organização e operações F12 | Importar/criar privadamente não publica automaticamente na central |
| Candidaturas/tarefas/revisões | Schema `opportunity_catalog` da base tenant, migrations 021–023; 024 acrescenta origem central | Nome igual de schema não implica base partilhada; origem comum não torna o trabalho privado comum |
| Perfil/avaliações/decisões | `organization_profile` tenant, F13/PQ1/F14 | Referência opcional de avaliação não deve ser condição universal de candidatura |
| Documentos | Metadados/versionamento/grants tenant; objetos R2 privados previstos; scanner e acesso por versão | Fundação existe; handlers produtivos ainda vazios em `documents/productionDocuments.js:4` |
| Credenciais | Diretório com referências opacas; provider server-side; configuração explícita API/worker | `config/opportunityRuntime.js:14` exige configuração de bindings; não aceitar destino/segredo do browser. Secret manager produtivo não comprovado |
| Jobs | Fundação async/pg-boss, worker independente, import XLSX e novo loader Funding Tenders | Registry genérico vazio não significa que não haja jobs: existem loaders específicos. Alertas legacy continuam na API |
| Notificações/email | Implementação legacy na base única/SMTP; destino futuro tenant + serviço de envio | Não encontrada integração funcional Resend nos módulos revistos; entrega sobre dados novos não demonstrada |

### ADMIN plataforma versus administração organizacional

A nova administração Funding Tenders verifica `platform_admin_assignment` C4G_ADMIN (`fundingTenders/repository.js:23`) e MFA (`http.js:12`). A consulta do catálogo exige sessão/membership (`http.js:16`). É a separação correta. Não se deve conceder ADMIN global aos gestores para contornar menus ou endpoints inacessíveis.

No legado, `authorizeRoles` compara `req.user.role` (`middlewares/authMiddleware.js:79`), enquanto a identidade OIDC entrega `platformRoles`, sem esse `role` (`security/identityRepository.js:16`). Isto explica por que ADMIN autenticado na plataforma não recupera automaticamente as ações antigas. A solução é adaptar fluxos necessários à autorização nova, não forjar uma role legacy global.

### Fronteiras ainda abertas ou incompletas

1. `app.js:102` e `:106` mantêm `/api/legacy/opportunities` e `/api/legacy/imports`; a leitura de oportunidades legacy exige autenticação, mas não membership tenant (`routes/opportunityRoutes.js:11`, `:35`). Consulta pool global. É um caminho paralelo a segregar/desativar na composição comercial. **Não foi demonstrada fuga concreta de dados**, mas a fronteira organizacional não está nesse percurso.
2. `productionComposition.js:123` exige `legacyPool`; `:304` executa `ensureNotificationSchema` no arranque. Mesmo o novo runtime mantém dependência operacional e efeito de bootstrap legado. Não se iniciou servidor nesta auditoria por esse motivo, entre outros.
3. Dashboard, matching e notificações conservam routers antigos (`app.js:85`, `:110`, `:111`). Não basta a página estar sob login OIDC para ler dados tenant.
4. O vínculo candidatura → catálogo central **já começou a ser implementado durante esta análise**: `contracts.js:11`, `repository.js:26`, `productionComposition.js:216`, migration 024 e link no detalhe central. A conclusão inicial “só origem privada” deixou de descrever todo o worktree. Continua válida para o percurso anteriormente comprovado; o caminho central é código novo a validar, não uma lacuna a reimplementar do zero.

São necessárias para vender a várias entidades: identidade/membership, resolução de tenant no servidor, separação central/privado, autorização, proteção documental, arquivo/histórico e integridade de operações. Não são indispensáveis ao primeiro cliente todos os domínios de perfil, overlays, materializações multidomínio, ranking, regras de capacidade ou generalização de pipelines. A complexidade de isolamento tem justificação; a expansão funcional não deve ser confundida com ela.

## 5. Findings priorizados, com referências concretas

Nenhum finding crítico de exploração foi comprovado nesta análise. Há blockers funcionais e riscos de fronteira de prioridade alta. “Alta” abaixo significa resolver antes de apresentar o percurso como comercialmente utilizável, não exploração de segurança demonstrada.

| ID / severidade | Evidência e facto | Impacto observado ou inferido | Direção mínima |
|---|---|---|---|
| F1 Alta | `productionComposition.js:61`; `app.js:85`; `dashboardController.js:1`, `:217`; `Dashboard.jsx:390` | Dashboard novo continua a consultar domínio antigo; não representa candidaturas/tarefas tenant. SQL legacy na base inspecionada falhou por ausência de `applications`, sem provar que seja a base da API | Agregados tenant para contagens e prazos; conservar componente visual útil |
| F2 Alta | `applications/contracts.js:3`; `applicationFirstSlice.test.js:15` | Não se pode registar submissão/resultado no novo ciclo. Perda funcional face ao piloto, por contrato restrito | Acrescentar estados e transições mínimos com histórico e autorização |
| F3 Alta | `productionComposition.js:219`; `applicationSliceRoutes.js:10`; `documents/productionDocuments.js:4` | Download produtivo fechado; UI associa versões, sem upload normal. Prova com double não entrega documentos ao cliente | Completar wiring F11 real e fluxo upload/scan/download |
| F4 Alta | `config/fundingTendersWorker.js:7`, `:11`, `:18` | Novo ADMIN/worker funciona apenas com fixture local; promessa de oportunidades reais ainda sem prova | Concluir recorte atual e ensaio real limitado autorizado; não ligar cron legacy à central |
| F5 Alta, fronteira | `app.js:102`, `:106`; `opportunityRoutes.js:11`; `opportunityController.js:1` | Caminhos legacy autenticados sem contexto organizacional. Risco de leitura do arquivo global por clientes, não explorado | Segregar runtime/acesso legacy e testar ausência de bypass |
| F6 Média | `identityRepository.js:16`; `authMiddleware.js:79`; `Sidebar.jsx:20`; `App.jsx` guardas admin | ADMIN plataforma, admin organização e ADMIN UBI não são equivalentes; menus e endpoints divergem | Navegação por capacidades e administração organizacional mínima |
| F7 Média | `ApplicationWork.jsx:9`, `:16`, `:26`, `:38`, `:54`; `intentions.js:7` | Após 403/404 persistente, intenção mantém-se e bloqueia novas mutações; chave work cobre utilizador+organização, podendo afetar outra candidatura. Inferido do código, não reproduzido | Consultar estado/recibo e oferecer saída segura para recusa definitiva; distinguir de commit incerto |
| F8 Média | `ApplicationDocumentsReview.jsx:8`, `:27`, `:34`; `intentions.js:8` | Revisão documental também retém intenção em 403/404; usuário pode ficar sem saída prática. A chave documental já foi corrigida para incluir candidatura; não reportar a antiga propagação entre candidaturas como atual | Recuperação específica de autorização/MFA com prova de estado, sem apagar pedidos incertos |
| F9 Média | `applications/composition.js:40`, `:44`, `:66`; `tenantLeaseExecutor.js:100` | Consultas auditadas tomam lock por organização e exigem escrita; modo READ_ONLY não permite este percurso. Serialização estrutural, sem medição de latência | Medir no piloto; só estreitar locks/adapters se necessário, preservando auditoria e revogação |
| F10 Média | `dev/local/check.js:36` exige exatamente 3 migrations; central real inspecionada tem 15 entradas; `loadEnvironment.js:7` fixa portas 5541/5542 | Ferramentas de “local” pertencem a fases distintas. Não existe uma receita única comprovada para o produto atual; correr setup/check errado gera diagnóstico enganador | Uma configuração de demonstração nomeada e verificação read-only de capacidades efetivas |
| F11 Média | `AGENTS.md` e `coding-standards.md` dizem não existir suite geral; `backend/package.json:7` e frontend `:9` já definem testes. `current-work.md` tinha 1980 linhas | Instruções de validação desfasadas e estado ativo misturado com histórico. Aumenta leitura, reconferência e risco de aplicar critério antigo | Em tarefa futura, estado ativo curto e evidência por incremento; não reorganizado aqui |
| F12 Média | `current-work.md:19` diz tarefas Complete; `reviews/application-team-tasks/README.md:3` ainda READY_FOR_HUMAN_REVIEW | Fontes de estado divergem; não usar um fecho como prova do runtime | Uma fonte para estado e ligação à prova, sem repetir narrativa em vários documentos |

### Custo, motivo e simplificação dos problemas de complexidade

| Problema material | Motivo original identificável | Custo/risco atual | Simplificação e garantias preservadas | Custo/risco de simplificar agora |
|---|---|---|---|---|
| Runtimes legacy/F12 e caminhos de API paralelos | Migração gradual e preservação do piloto | Duas semânticas de IDs, roles, dados e UI; manutenção e risco F5 | Isolar o legacy do runtime comercial, mantendo arquivo e acesso autorizado | M; regressão de rotas dependentes se não inventariadas |
| Perfil/publicação/ativação antes de valor básico | Qualificação determinística, explicação e histórico | Muitos passos e módulos visíveis para quem só quer acompanhar candidatura | Tornar opcional e parar expansão; não apagar dados nem resultados históricos | P para priorização/menu; M para alterar dependências técnicas |
| Reutilização de utilitários F13 em candidaturas | Aproveitar auditoria/tokens/canonicalização existentes | Dependência nominal e mudanças transversais no executor para cada domínio | Futuro adapter comum de leitura auditada/intenção; agora reutilizar, não reescrever | M–G e risco alto no núcleo; adiar refactor amplo |
| Recuperação conservadora sem saída prática | Evitar duplicação após confirmação perdida | Bloqueio persistente em recusas e suporte técnico recorrente | Estado de intenção consultável, erro definitivo comprovado e ação segura | M; exige testes de perda de resposta/revogação, sem relaxar idempotência |
| Admissão de schemas/bundles estrita | Impedir execução incompatível e grants indevidos | Novo domínio exige atualizar manifesto, capacidades e gates; configuração antiga falha fechada | Automatizar verificação operacional e restringir escopo de versões suportadas | M; não remover fingerprints, ACL ou compatibilidade |
| Leituras com transação de escrita e lock organizacional | Auditoria e consistência de autoridade | Modo degradado pouco útil; concorrência serializada | Medir antes de refatorar; concentrar locks onde necessário | G no núcleo; não é primeira entrega de valor |
| Preparação repetida de gates e fixtures acopladas | Provas fortes PostgreSQL A/B e recuperação | Um gate funcional depende de estado/schema de outros domínios; houve falha histórica de TRUNCATE contra append-only | Fixtures próprias não destrutivas, runner canónico e seleção de provas afetadas | M; preservar provas de isolamento e recuperação |
| Documentação extensa e estados replicados | Preservar decisões e evidência | Leitura e reconciliação repetidas; contradição F12 | Fecho de incremento com resultado utilizável, prova e pendências, sem novo ciclo documental extenso | P–M em tarefa própria; nada alterado nesta auditoria |

Não classifico pools, quotas, RLS, autorização ou outbox como desperdício por terem muitos módulos. O custo demonstrável está no **alcance funcional e operacional que ainda falta apesar dessas fundações**, e nas dependências/convenções que obrigam a editar mecanismos transversais para ações comuns.

## 6. Complexidade necessária versus adiável

### Onde está o atraso: o que a evidência permite separar

| Categoria | Evidência | Interpretação com limites |
|---|---|---|
| Correção necessária do piloto | Git outubro: OIDC, memberships, diretório tenant, autorização, auditoria, armazenamento privado; desativação de retenção destrutiva em `47ed7cf` | Trabalho com valor comercial real; não eliminar para recuperar velocidade |
| Funcionalidade nova | F13 competências/experiência/financeiro/operacional/populações/territórios, publicação/ativação; revisão documental e tarefas | Ultrapassa a paridade histórica. Algumas capacidades são agora desejadas, mas não todas bloqueiam primeiro piloto |
| Crescimento de requisitos | `project-overview.md:38` inclui matching ponderado/configurável, pipeline configurável e reporting; `f13-organizational-profile.md:174` em diante detalha muitos domínios | Produto documentado é mais amplo que recuperar Dashboard → oportunidade → candidatura → equipa/documentos/prazos |
| Retrabalho | Histórico de maio alternou kanban/fontes; evidência F13-PQ1 documenta problema de capacidade conjunta do histórico e correção posterior | Houve correções de integração e limites; não é legítimo converter commits em horas ou concluir que toda correção foi evitável |
| Integração em falta | Dashboard/alertas legacy, F11 sem port produtivo, fonte central fixture-only, estados de candidatura curtos | É o atraso mais diretamente ligado à experiência do cliente e a prioridade de recuperação |
| Preparação/testes/documentação | Gates descartáveis com PostgreSQL/Chrome, versões/pins, centenas de testes; current-work muito extenso | Testes críticos são necessários. Repetição integral sem mudança relevante e fechos duplicados devem ser evitados; não foi medido tempo gasto |
| Configuração/serviços | Bases/portas locais diferentes, IdP simulado em várias provas, R2/scanner não validados, transporte externo fechado | Não confundir implementação com serviço operacional nem externalizar toda a falta para “configuração” |

Cronologia verificável: 04/10 contexto/arquivo seguro; 05/10 identidade e memberships; 07–08/10 runtime, autoridade, async, auditoria, documentos e observabilidade; 10–14/10 F12/F13/importação; 17/10 candidaturas/tarefas/documentos e nova fonte no worktree. O último commit é de 14/10: não mede o trabalho posterior. Não existem dados suficientes para estimar horas, custos, produtividade pessoal ou causalidade exclusiva.

### A cadeia oportunidade → perfil completo → matching → candidatura é obrigatória?

**Não, no código atual revisto.** `evaluationId:null` é aceite; `applications/repository.js:15` não consulta avaliação nesse caso. O formulário explicita avaliação opcional. `pq1Api.session` na UI é uma fila de operações da sessão, não um teste de completude do perfil.

O percurso previamente demonstrado exige oportunidade privada acessível, título, responsável elegível e prazo. Durante esta análise foi acrescentada origem CENTRAL com revisão exata e avaliação nula; exige nova migration 024 e port central configurado. Não foi validado aqui. **Criar candidatura sem qualquer oportunidade continua fora do contrato observado.** Isto pode ser decisão comercial real; não é razão para tornar matching obrigatório.

A dependência de produto foi removida para candidatura manual, mas persistem dependências técnicas: canonicalização/tokens/auditoria importados de módulos F13, catálogo de permissões, capabilities e manifesto. Não se recomenda desmontá-las antes de entregar os percursos.

### Classificação do restante

| Classe | Conteúdo |
|---|---|
| Necessário antes do primeiro piloto | Autenticação/membership e isolamento comprovados; papéis reais; uma fonte prioritária ou conjunto autorizado de oportunidades reais; candidatura manual até submissão/resultado; equipa/tarefas; documentos seguros utilizáveis; Dashboard/prazos; alertas básicos; ambiente persistente reproduzível |
| Necessário antes de produção | IdP/MFA efetivos, backups/restauro, gestão de segredos e acessos, R2/scanner/reconciliação reais, monitorização acionável, limites/carga, recuperação operacional, privacidade/retenção acordadas, ausência de bypass legacy e provas A/B para todos os caminhos expostos |
| Melhoria posterior | Matching/ranking mais completo, domínios adicionais F13, overlays, materializações avançadas, reporting livre, múltiplas fontes simultâneas, pipeline genérico, aprovações múltiplas, IA |
| Candidato a simplificação/desativação após dependências | Menus editoriais para utilizador comum; rotas legacy no runtime comercial; jobs legacy duplicados; bootstrap legacy obrigatório; estados/documentos replicados; exceções nominais do executor quando houver adapter comum comprovado |

“Antes de produção” não permite usar documentos desprotegidos num piloto com dados reais. Os controlos proporcionais aos dados e às pessoas presentes têm de existir desde o primeiro ensaio real.

## 7. MVP comercial recomendado

O menor produto com valor semelhante ao piloto deve permitir a demonstração contínua seguinte:

1. C4G_ADMIN atualiza uma fonte prioritária; vê estado, limites, falhas e contagens. A recolha pública grava uma vez na central, preservando proveniência, revisões e correções manuais.
2. Uma organização consulta catálogo comum e oportunidades privadas, pesquisa/filtra e abre detalhe com prazo e ligação oficial.
3. Um gestor cria candidatura manualmente, escolhe responsável e prazo, acompanha preparação, submissão e resultado. Perfil completo e avaliação automática são opcionais.
4. Equipa gere tarefas e prazos; carrega e consulta documentos seguros. Revisão interna simples reutiliza o trabalho já feito, quando necessária, sem virar motor genérico de workflow.
5. Dashboard mostra candidaturas por estado, tarefas abertas/atrasadas e próximos prazos da organização. Alertas in-app apoiam o acompanhamento; email entra no compromisso inicial apenas quando a entrega real estiver validada.
6. Consulta e revisão têm interfaces adequadas às permissões; revogação e troca de organização não expõem dados anteriores. Administração da organização consegue gerir acesso através de um procedimento utilizável e auditado.

O MVP não precisa de todos os domínios F13 para reconhecer uma oportunidade e abrir uma candidatura. Pode conservar a avaliação parcial como ferramenta opcional. Não precisa de submissão automática ao financiador: registar data/estado/referência de submissão já recupera grande parte do valor do piloto. Não precisa de pipeline universal configurável se um fluxo mínimo aprovado satisfizer o primeiro cliente.

O piloto comercial não deve usar fixtures apresentadas como fontes reais. Dados sintéticos são adequados para demonstração técnica identificada como tal; uma demonstração comercial de recolha precisa de uma execução externa autorizada e prova de persistência/reconsulta.

## 8. Plano de recuperação em até cinco incrementos

### Comparação das opções

| Opção | Vantagem | Custo/risco | Avaliação |
|---|---|---|---|
| A. Continuar o plano atual em toda a sua extensão | Preserva sequência de contratos e abrangência F13/F14; aproveita investimento em qualificação | Pode continuar a fechar domínios sem resolver Dashboard, documentos, alertas e ciclo de candidatura; configuração/testes transversais continuam a crescer | Aceitável apenas se o primeiro cliente exigir essas capacidades concretas |
| B. Recuperar primeiro paridade funcional multi-tenant | Concentra trabalho no percurso que o utilizador reconhece; reaproveita fundações e módulos já entregues | Requer limitar backlog e rever alguns critérios funcionais, sobretudo estados e exposição de módulos; não evita testes críticos | Melhor relação valor/risco para o objetivo declarado |

**Recomendação: B, preservando as fundações de A.** Terminar a fatia de catálogo central já em curso e integrar o trabalho existente; congelar expansões F13/F14 sem dependência demonstrada. Não reabrir uma especificação geral do produto. Para cada incremento, basta contrato curto do delta, critérios observáveis e testes de risco correspondentes.

| Incremento | Resultado visível | Reutilizar | Alterações mínimas e dependências | Critério de conclusão | Dimensão / confiança |
|---|---|---|---|---|---|
| 1. Catálogo real → candidatura manual numa demonstração estável | ADMIN atualiza fonte; gestor de A e B consulta os mesmos dados públicos e cria trabalho privado | `fundingTenders/*`, source/merge, repositório F12, UI central/ADMIN e origem CENTRAL/migration 024 já iniciadas; candidatura existente | Concluir transporte/worker do recorte, validar schemas/grants/configuração numa instalação nomeada; caminho privado continua disponível. Dependência: fonte/ensaio externo autorizado e identidade real ou claramente simulada | Após reinício, oportunidade real mantém proveniência e revisão; candidatura de A não aparece em B; nenhum perfil/PQ1 obrigatório; falhas de fonte visíveis; runtime/código identificados | M–G / média; não estimar como novo desenvolvimento completo |
| 2. Candidatura até submissão/resultado, com equipa e tarefas | Gestor acompanha processo completo e vê ações adequadas ao papel | Contratos/repositório/receipts/histórico, PrivateApplications, ApplicationWork | Acrescentar estados mínimos e campos estritamente necessários; corrigir recuperação persistente; melhorar seleção/labels. Decisão curta sobre estados, não pipeline genérico | Criar, preparar, atribuir tarefa, concluir tarefa, registar submissão/resultado, reler histórico; consulta não apresenta ações impossíveis; perda de resposta e recusa definitiva têm saída segura | M / alta |
| 3. Documentos reais e revisão simples | Utilizador carrega, aguarda scan, consulta versão e revisor decide | F11, R2 adapter, versionamento, grants, documentsReview, UI e testes locais | Ligar serviços reais/port produtivo e upload na candidatura; configurar scanner e tratamento de indisponibilidade. Preservar revisão aprovada, sem novos níveis | Ficheiro limpo disponível, suspeito bloqueado, versão exata revista; decisor distinto/MFA; revogação/A/B sem conteúdo exposto; histórico e recuperação após reinício | G / média-baixa, dependências externas |
| 4. Dashboard operacional e alertas sobre trabalho privado | Página inicial mostra o trabalho e prazos reais; alertas ajudam a agir | Layout/gráficos úteis do Dashboard, tabelas de candidaturas/tarefas, infraestrutura async e padrões de notificações | Queries tenant autorizadas; lista de próximos prazos/atrasos; eventos/alertas in-app. Email só com adapter validado; remover dependência funcional do dashboard UBI | Números conferem com listas; tarefa/prazo alterado reflete-se após releitura; alertas não duplicam nem atravessam organizações; consulta respeita grants | M / alta para in-app; média para email |
| 5. Fecho da demonstração comercial por papéis e fronteiras | Entidade percorre a app sem IDs técnicos, menus enganosos ou intervenção de programador | OIDC, membership, seletor, navegação, suites A/B e evidência já produzida | Curadoria de menus/branding configurável, procedimento de onboarding/grants, segregação legacy, verificação read-only de readiness funcional e ensaio integrado | ADMIN, gestor, revisor e consulta completam cenário; duas organizações isoladas; sem mocks ocultos, sem rotas legacy acessíveis por cliente; reinício/restauro e suporte mínimo documentados | M / média |

Os incrementos são resultados de produto, não autorização de deploy. O quinto consolida um ambiente que começa no primeiro; não se deve esperar até ao fim para ter uma aplicação acessível. Testes devem acompanhar cada fronteira alterada; repetir suites integrais apenas quando dependências/riscos justifiquem.

## 9. Decisões de negócio pendentes

Não é necessário decidir novamente se matching deve bloquear candidaturas: o objetivo expresso e o código manual apontam para **não**.

| Decisão real | Proposta para reduzir demora | Quando é necessária |
|---|---|---|
| Primeiro cliente e fonte prioritária | Concluir Funding & Tenders já em curso; confirmar se serve as oportunidades desse cliente antes de adicionar outras fontes | Antes do ensaio real e do compromisso comercial |
| Estados mínimos após preparação | Submetida + resultado registado, mantendo cancelamento/arquivo; decidir nomes e campos de resultado necessários | Incremento 2 |
| Candidatura sem oportunidade | Manter requisito atual para primeira entrega, salvo necessidade concreta do cliente; alternativa é oportunidade privada manual simples | Só se o cliente trabalhar processos sem aviso/oportunidade |
| Revisão interna e parceiros no primeiro cliente | Reutilizar revisão simples existente; confirmar quando é obrigatória e se parceiros externos têm de ser geridos na app | Antes de prometer esse percurso |
| Canal e frequência de alertas | In-app como mínimo; email com destinatários/frequência definidos e entrega validada | Incremento 4 |
| Condições de operação com dados reais | Responsáveis de acesso, retenção, residência, suporte e recuperação acordados para o piloto/contrato | Antes de introduzir dados reais |

Escolhas de nomes de adapters, bundles, número de documentos de especificação e organização interna dos módulos não são decisões de negócio a devolver ao utilizador. Podem ser resolvidas tecnicamente dentro dos controlos existentes.

## 10. Limitações e verificações efetivamente realizadas

### Registo de execução

| Verificação | Resultado | Limite |
|---|---|---|
| Git status, branch, HEAD, log, tags e diff legacy | Baseline piloto `3a79b25`; HEAD atual 0cf519e; extenso residual preservado | Sem checkout, commit, merge, push, reset ou outras mutações Git |
| Documentação e código | AGENTS, standards, visão/arquitetura, contratos relevantes, evidência anterior, composição, rotas, controladores, UI, manifests, serviços e testes | Não se auditou integralmente cada módulo nem todas as migrações |
| HTTP loopback | Frontend 3100 200; API 5000 200; live/db/ready 200; sessão/oportunidades/dashboard anónimos 401 | Não houve sessão autenticada nem teste de negócio; portas 3000/5173 recusaram ligação |
| Browser | Inventário vazio; criação de tab IAB indisponível | Falha da ferramenta, não falha da aplicação; sem inspeção visual nova |
| Processos/portas | netstat identificou listeners; processos Node confirmados | CIM e Get-NetTCPConnection negados; não lidas command lines/env ativos |
| Configuração local | Leitura filtrada só de flags não sensíveis e loopback/portas; `.env.local` indica legacy/local | Não prova o modo do processo ativo, que anuncia OIDC/F12 |
| Docker/SQL | Inventário read-only; consultas explícitas BEGIN READ ONLY nas bases locais de integração | Escalação de acesso à ferramenta permitiu leitura; nenhum comando de criação/remoção/restart |
| Central local 5441 | Ledger 000–014, catálogo central zero, uma membership | Sem prova de que seja toda a central do processo ativo; dados pessoais e segredos não foram consultados |
| Legacy local 5442 | Sete tabelas públicas; oportunidades zero; `applications` ausente | A consulta agregada inicial falhou por tabela ausente; transação não escreveu. Não é prova de falha autenticada da API |
| Contentor documental descartável 5596 | Existia com central sintética e duas bases sintéticas tenant; catálogo público de tabelas inspecionado parcialmente | Desapareceu por atividade externa antes de completar consultas. Consulta em `public` não cobre schemas tenant; não se conclui ausência das suas tabelas |
| Testes direcionados | `node --test --test-isolation=none test/applicationFirstSlice.test.js test/applicationWork.test.js test/fundingTendersSource.test.js`: **17/17 PASS** | Validação/transições/paginação/merge/transportes simulados; não prova DB/R2/API externa ou origem central nova E2E |
| Provas anteriores | READMEs e scripts de candidaturas, tarefas, docs, F12/PQ1 confrontados | Relatos de PostgreSQL/browser anteriores, com IdP/doubles identificados; não reexecutados nem promovidos a prova de produção |

Não foram executados build, gates de integração que criam/apagam fixtures, script UBI que escreve candidaturas, recolhas externas, migrations, seeds, resets, deploys ou chamadas pagas. O build normal escreve artefactos no worktree e esta tarefa só autoriza guardar o relatório. Não foram alterados estados funcionais para obter prova. Não foram expostos segredos, tokens, strings de ligação ou conteúdo documental.

### Alterações concorrentes e precisão das conclusões

Durante a análise surgiram ou mudaram: composição Funding Tenders, worker, páginas de catálogo/ADMIN, criação de candidatura de origem central e migration 024. O contentor documental observado também desapareceu. As conclusões foram corrigidas para reconhecer esse progresso. **Não se afirma que o código final de outra tarefa seja idêntico ao inspecionado**, nem se atribuem essas alterações a esta auditoria.

Âncoras SHA-256 da última leitura de três ficheiros particularmente relevantes:

- `backend/src/productionComposition.js`: `0FFB3278FAC41EE15A05316AAE05E9539EA38F53BA34341C3140E88DCAED4028`.
- `backend/src/applications/contracts.js`: `1D4A8C1C19B8EBE9B3DD420E028CC73D25FBD7DC2A02A73C5383B5682D7D5374`.
- `backend/src/config/fundingTendersWorker.js`: `FA19EB7B383DF3DEB316A0E0FB8005B5C26461744130FF9100A0B4CBF2C97140`.

A limitação principal não invalida os blockers estruturais encontrados, mas impede dar um veredicto de prontidão sobre o novo conector central. Para essa fatia é necessária revisão do snapshot terminado e do ambiente correspondente. Não foi feita uma auditoria de termos/limites atuais dos fornecedores, porque não houve pesquisa externa nem execução de integrações nesta tarefa.

### Respostas diretas

**Estamos mais próximos de uma aplicação vendável do que no piloto? Em quê?** Sim, em segurança multi-tenant, identidade/membership, autorização, integridade, histórico, testes e capacidade de servir organizações separadas. Também em tarefas e revisão estruturada. Ainda não está demonstrada maior prontidão global para uso diário: a integração funcional permanece incompleta.

**Que funcionalidades do piloto continuam menos acessíveis ou indisponíveis?** Dashboard com dados do trabalho atual; atualização efetiva de fontes pelo ADMIN no novo runtime; submissão/resultado de candidaturas; anexos através de upload/download reais; alertas sobre novos processos; gestão integrada de parceiros e administração visual coerente de utilizadores. Pesquisa/filtros do catálogo comum ainda são mais limitados que a experiência legacy. Tarefas e revisão formal não devem ser chamadas funcionalidades perdidas: não foram encontradas no piloto de referência.

**O que podemos deixar de desenvolver agora?** Expansão dos domínios F13, overlays, scoring/ranking, IA, publicação/ativação adicional sem consumidor necessário, pipeline genérico, múltiplos níveis de aprovação e novas fontes antes de uma funcionar ponta a ponta. Preservar o que existe; adiar exposição/expansão, sem apagar dados ou enfraquecer segurança. Adiar também um refactor geral da infraestrutura.

**Qual é a próxima entrega com maior valor para o primeiro cliente?** Concluir o incremento já iniciado **ADMIN atualiza uma fonte real → organização consulta → gestor cria candidatura manual privada**, num ambiente persistente demonstrável. Aproveitar a nova origem central, sem reimplementar essa ponte e sem impor perfil ou matching.

**Que condições mínimas faltam para abrir a app e demonstrá-la a uma entidade?** Uma configuração identificada e estável, contas/grants para os papéis, fonte e dados adequados sem mocks ocultos, catálogo e candidatura integrados, estados até submissão/resultado, documentos reais protegidos, Dashboard/prazos/alertas tenant e menus coerentes. Demonstrar troca A/B, releitura após reinício e recuperação de falha, com legacy segregado. Para uma demonstração parcial imediata, seria possível limitar explicitamente o âmbito a candidaturas/tarefas sobre fixtures, mas isso não satisfaz a demonstração comercial completa solicitada.

**Próximo passo recomendado:** concluir e verificar o incremento 1 sobre um snapshot estável, mantendo este diagnóstico como referência e sem executar as recomendações nesta tarefa.
