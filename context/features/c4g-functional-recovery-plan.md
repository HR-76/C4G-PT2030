# Plano de ação — APP C4G funcional

Data: 2026-10-17. Estado: **Plano proposto; objetivo confirmado pelo utilizador.** Esta tarefa produz planeamento, não implementação, recolhas, migrations ou deploy. Não declara os contratos futuros integralmente entregues nem altera fechos anteriores.

## 1. Objetivo e critério de sucesso

**Entregar uma única APP C4G multi-entidade, com identidade visual C4G, que permita descobrir oportunidades no catálogo central, usar matching, gerir candidaturas e acompanhar equipa, tarefas, documentos e prazos.** Recuperar o valor funcional do piloto; não acrescentar novas funcionalidades nem prolongar a construção de infraestrutura sem um percurso utilizável como resultado.

Orientação expressamente confirmada nesta conversa:

- O produto é C4G. A UBI é referência do piloto e pode ser uma entidade cliente; não é a marca nem o modelo universal da plataforma.
- Catálogo central e matching são funcionalidades essenciais desta entrega, não melhorias adiáveis.
- Todas as entidades autorizadas consultam as oportunidades públicas do catálogo comum; o matching destaca relevância sem limitar o acesso às restantes.
- Candidaturas, equipa, tarefas, documentos, avaliações e decisões permanecem privados de cada entidade.
- O gestor pode criar candidatura diretamente, sem perfil completo nem resultado de matching obrigatório.
- A prioridade é ter a app a funcionar; ampliações funcionais ficam para depois.

**Demonstração de conclusão:** ADMIN C4G atualiza uma fonte → duas entidades consultam a mesma oportunidade → veem correspondências explicáveis adequadas ao respetivo contexto → uma delas cria candidatura, atribui responsável, gere tarefa e documento e regista submissão/resultado → o Dashboard e os alertas mostram esse trabalho → a outra entidade não consegue aceder ao trabalho privado. O mesmo percurso continua disponível após reinício, sem manipular IDs, SQL ou fixtures para o fazer funcionar.

## 2. Leitura do contexto e reconciliação de prioridades

A análise abrangeu a estrutura de `context/`: visão/arquitetura/standards, referências, contratos de features, decisões, pesquisas, histórico, reviews e runbooks. Leitura aprofundada dos documentos que determinam produto, visual, catálogo, matching, candidaturas e operação; inventário de estados/títulos dos restantes para localizar dependências. Não se afirma releitura linha a linha de todos os logs, hashes e artefactos históricos, nem nova certificação das suas provas.

| Fonte | O que determina neste plano |
|---|---|
| `project-overview.md` | Quatro pilares: descoberta, matching, candidaturas e reporting; entidades genéricas; UBI apenas como origem histórica |
| `architecture.md`; decisões de identidade/dados, hosting, diretório e pools | Manter central + bases por organização, membership central, API/worker separados, Keycloak, proteção documental e ausência de fallback inseguro |
| `references/ui-foundations.md` | Direção C4G já aprovada provisoriamente: branco/cinza, navegação verde-petróleo, ações verdes, tokens semânticos e WCAG 2.2 AA |
| `references/product-language-and-navigation.md` | Português europeu, navegação por tarefa, separar organização de plataforma, organização ativa visível, erros recuperáveis |
| `features/opportunity-catalog.md`; `funding-tenders-central-first-slice.md` | Catálogo comum + privado; atualização central pelo ADMIN; proveniência/correções/histórico; fonte Funding & Tenders já em curso |
| `features/matching-and-qualification.md`; decisões F13 e contratos F14/PQ1 | Matching determinístico/explicável; dados ausentes não são compatibilidade; taxonomias/mappings explícitos; não confundir correspondência com elegibilidade |
| `features/application-first-slice.md`, `application-team-tasks.md`, `application-documents-internal-review.md`, `application-pipeline.md` | Reutilizar candidatura manual, equipa/tarefas e revisão existentes; completar submissão/resultado e documentos reais |
| `features/reporting.md` | Dashboard operacional sobre dados reais; indicadores com definição; universo e permissões iguais nas listas/exportações |
| `references/current-implementation.md`; diagnóstico de 17/10 | Legado é evidência/migração, não modelo a ligar indiscriminadamente ao novo runtime |
| Históricos F2–F12, reviews e `research/f12-local-integration-boundaries.md` | Fechos locais admitem doubles e composição não produtiva; não equivalem à entrega da app ao cliente |
| `coding-standards.md`, `ai-interaction.md`, runbooks | Preservar dados/residual, testes por risco, contratos curtos, nenhuma cerimónia sem benefício |

### Conflitos a resolver sem novo ciclo geral de especificação

1. **Âmbito antigo do MVP mais vasto que esta entrega.** Pesos configuráveis, todos os domínios F13, pipeline genérico, reporting completo e várias fontes continuam documentados como produto futuro. Não são todos gates desta recuperação. A direção atual do utilizador limita o que desenvolver agora; não elimina histórico nem altera silenciosamente regras do que já está implementado.
2. **Matching do piloto não é a pré-qualificação PQ1 atual.** A página ainda usa professores/áreas UBI. PQ1 avalia critérios e versões, mas não substitui automaticamente uma lista útil de oportunidades recomendadas. É necessário fechar essa ligação como entrega própria.
3. **Visual já tem orientação suficiente.** `ui-foundations.md` fixa provisoriamente verde-petróleo e WCAG AA, apesar de outros documentos ainda listarem essas escolhas como perguntas. Aplicar essa direção; não esperar por novo manual de marca para avançar. Cores continuam provisórias, nunca anunciadas como oficiais.
4. **Complete local não é “utilizável nesta instalação”.** O próximo fecho deve indicar URL/ambiente, composição, papéis, dados e percurso demonstrado, além dos testes. Não reabrir fechos históricos para os rebatizar.
5. **Estado ativo contém história extensa.** Este plano orienta a sequência funcional; não reorganiza o residual. Registar apenas o incremento ativo e a prova correspondente, sem copiar narrativas em vários documentos.

## 3. Âmbito fechado desta recuperação

| Fazer agora | Não desenvolver agora |
|---|---|
| Identidade C4G e navegação coerente | Novo produto, novo framework frontend ou sistema de design independente |
| Catálogo comum consultável por todas as entidades autorizadas, pesquisa/filtros/detalhe | Garantia de cobertura de todas as fontes do mundo; conectores sobrepostos |
| Atualização de fonte prioritária pelo ADMIN e acesso à importação privada existente | Novo construtor genérico de integrações ou formatos de importação |
| Matching útil, explicável e adaptado a entidades, preservando criação manual | IA, ranking sofisticado e expansão universal de domínios F13 |
| Candidaturas até submissão/resultado; equipa/tarefas/documentos/revisão simples | Submissão automática aos financiadores, múltiplos níveis de aprovação ou construtor livre de pipelines |
| Dashboard operacional e alertas; indicadores básicos verificáveis | Reporting livre, benchmarking, previsão ou novos painéis sem dados |
| Acesso e administração organizacional mínimos utilizáveis | Nova plataforma de RH, CRM, gestão de recursos ou parceiros |
| Segurança, arquivo, auditoria, idempotência e isolamento existentes | Remover garantias para simplificar ou ligar controladores UBI globais aos clientes |

“Todas as oportunidades” significa todas as oportunidades públicas efetivamente existentes no catálogo comum, independentemente do matching. Uma recolha limitada de 5/100 registos deve dizer que é limitada; não apresentar a fonte como integralmente sincronizada. Oportunidades privadas mantêm acesso restrito.

## 4. Visual e navegação C4G: alteração concreta

### Identidade

- Usar **C4G Funding Platform**, nome já presente no contexto, com “Gestão de financiamento” como descrição funcional, sem inventar outra marca.
- Reutilizar `source-docs/brand/c4g-logo.png` e conferir o asset `frontend/public/logo-c4g.png` antes de o aplicar. Preservar proporção e legibilidade; não redesenhar ou recolorir o logótipo. A referência observada é raster pequena: limitar o tamanho; não bloquear trabalho funcional à espera de vetor, nem ampliar com perda de qualidade.
- Substituir identidade global UBI no login, sidebar, cabeçalhos, título do browser, manifest e ícones de aplicação que forem confirmados como UBI. Incluir textos globais de notificações/exportações que pertençam ao produto. Não alterar nomes de entidades, documentos ou história UBI legítima.
- Trocar “Professor”, “Investigador”, “Centro” e “Faculdade” como conceitos universais por utilizador, equipa/unidade e organização, apenas onde a semântica corresponda. Não fazer substituição cega de palavras nem renomear tabelas por cosmética.
- Reutilizar tipografia de sistema e iconografia linear existentes. Sem compra de fontes, imagens promocionais ou novas dependências.

### Aplicação da direção visual existente

| Elemento | Direção |
|---|---|
| Sidebar | Verde-petróleo `#075B59`, logo legível e seleção clara |
| Conteúdo | Fundo `#F6F8F8`, cartões/tabelas brancos, grelha e espaçamento consistentes |
| Ação primária | Verde `#5FAD2F`; usar variante de maior contraste `#39751F` quando necessária |
| Texto e dados | Texto `#20262B`, secundário `#4B5560`, dados `#123247` |
| Estados | Sucesso/aviso/erro/informação com texto e ícone; verde de marca não significa aprovação |
| Interação | Um botão primário dominante por vista; foco visível, teclado e layout móvel; contraste AA verificado por combinação |
| Estados de página | Carregamento, vazio, sem resultados, indisponível e sem autorização distintos; próximo passo prático |

Centralizar tokens semânticos em CSS. O atual `frontend/src/index.css:3` chama `--green` a um azul: corrigir a semântica progressivamente com compatibilidade nos componentes existentes, sem reescrever toda a folha. Login e áreas de trabalho devem ser sóbrios; os moods de campanha não são layouts de Dashboard.

### Navegação proposta para os percursos existentes

| Grupo | Destino | Regra |
|---|---|---|
| Trabalho diário | Visão geral | Dashboard real, sem estrutura UBI global |
| Trabalho diário | Oportunidades | Entradas claras “Catálogo C4G” e “Da organização”; conservar rotas existentes inicialmente |
| Trabalho diário | Matching | Correspondências e explicação; acesso a todas as oportunidades continua disponível |
| Trabalho diário | Candidaturas | Listagem/detalhe; equipa, tarefas, documentos e revisão no processo, sem novas apps separadas |
| Trabalho diário | Alertas | Visíveis conforme autorização, não reservados globalmente ao antigo ADMIN |
| Organização | Perfil e equipa / Acessos | Apenas dados necessários e ações autorizadas; capacidades editoriais avançadas como área secundária para quem as usa |
| Plataforma C4G | Fontes e catálogo / Gestão autorizada de entidades | Só ADMIN C4G; não confundir com administrador organizacional |

Reporting avançado não ganha uma página vazia para cumprir um menu. Nesta entrega, os indicadores básicos entram em Visão geral; relatórios existentes só se expõem quando funcionarem com as mesmas permissões. Não apagar módulos avançados: retirar do percurso diário e manter acessos autorizados necessários.

## 5. Plano ordenado de execução

Uma entrega funcional ativa de cada vez. Antes de editar, reconferir o residual e o trabalho concorrente. Nenhuma etapa é concluída apenas por build verde ou alteração de estado documental.

### Entrega 1 — A app abre como C4G num ambiente identificável

**Execução 2026-10-17: Review.** Implementação solicitada pelo utilizador e realizada; [evidência, capturas e limites do ambiente](../reviews/c4g-delivery-1/README.md). Build/96 testes e regressões Chrome PASS. Identidade visual validada com API sintética; frontend/API ativos identificados, sem prova autenticada ou worker real. Não representa fecho humano nem conclusão das restantes entregas.

**Resultado:** entrar na APP C4G, identificar organização ativa, papel e navegação, sem branding global UBI nem menus técnicos a dominar o trabalho.

**Reutilizar:** App/Layout/Header/Sidebar, AuthContext, seletor de organização, componentes/rotas existentes e assets C4G.

**Trabalho mínimo:** aplicar a direção visual acima; ajustar nome/ícones/textos globais; separar áreas organizacionais/plataforma por capacidades; distinguir páginas ainda indisponíveis; identificar uma configuração de demonstração persistente com frontend/API/worker/central/tenants e versões compatíveis. Não criar outro stack nem substituir runtime ativo sem coordenação. Preparar contas/grants por procedimento autorizado, sem credenciais no documento.

**Dependências:** nenhuma nova decisão de paleta ou framework. Resolver apenas configuração concreta que faltar; preservar autenticação/MFA e grants. A estabilidade do ambiente não exige terminar todos os domínios.

**Conclusão:** login e shell C4G legíveis em desktop/móvel; teclado/foco/contraste verificados; identidade da organização visível; ADMIN C4G e gestor não recebem o mesmo menu por uma role global; rotas atuais continuam funcionais; configuração e limites conhecidos registados; build e testes de navegação/sessão afetados passam. Screenshot/browser comprovam aparência, não apenas CSS.

**Dimensão:** M. **Confiança:** alta no visual; média na configuração. **Artefactos afetados:** frontend/layout/login/CSS/index/manifest; configuração apenas se indispensável e dentro do âmbito autorizado. Sem migration cosmética.

### Entrega 2 — Catálogo comum e atualização pelo ADMIN funcionam

**Resultado:** ADMIN atualiza Funding & Tenders; duas entidades consultam a mesma oportunidade com pesquisa/filtros/detalhe; gestor cria candidatura privada a partir dela ou de uma oportunidade privada.

**Reutilizar:** fatia em curso `fundingTenders/*`, repositório F12 central, worker, páginas FundingTenders/CentralOpportunities, origem CENTRAL em candidaturas e migrations central 015/tenant 024. Importação XLSX privada mantém o contrato existente; não a converter em publicação central silenciosa.

**Trabalho mínimo:** reconferir o que a tarefa concorrente já entregou; terminar apenas lacunas FT-01–10; ligar transporte e worker reais em ambiente autorizado; pesquisa/filtros essenciais sem omitir oportunidades por matching; tornar origens explícitas. Preservar correções manuais, histórico e revisão de origem da candidatura.

**Dependências:** entrega 1 para demonstração; schema/grants compatíveis, fonte e destino de ensaio identificados. O contrato atual exige autorização específica para a recolha real: preparar pedido concreto com limite/destino quando o código estiver pronto; esta tarefa de plano não a concede.

**Conclusão:** ADMIN atualiza e acompanha estado; ORG_ADMIN não pode atualizar o comum; recolha repetida não duplica; falha parcial é recuperável; consulta e candidatura persistem após reinício; A/B veem o mesmo público e apenas o respetivo privado; uma prova real é distinguida das fixtures. Filtros não apresentam a amostra recolhida como fonte completa.

**Dimensão:** M–G. **Confiança:** média. **Validação:** testes de fonte/merge, PostgreSQL Central+A/B, worker/retry, browser e ensaio externo limitado autorizado. Não voltar a implementar a ponte central já em curso.

### Entrega 3 — Recuperar o matching como ferramenta diária

**Resultado:** a entidade encontra oportunidades relevantes, vê por que correspondem e pode criar candidatura ou consultar o catálogo completo. Ausência de dados não aparece como ausência de oportunidades nem como aprovação de elegibilidade.

**Reutilizar:** experiência de `pages/Matching.jsx` e lógica determinística do piloto como referência; taxonomias/perfil temático e componentes explicativos F13/F14 já implementados; F12 central/privado e autorização atual. Não reutilizar consultas a `professor_profiles` como backend universal.

**Recorte recomendado, a fechar num contrato curto antes do código:** correspondência temática com os dados institucionais disponíveis, explicação dos temas coincidentes e dos dados não mapeados, sem obrigatoriedade de dados financeiros/operacionais/experiência para a descoberta temática. Não inventar pesos, percentagens, equivalências de labels nem ordenar por “elegibilidade” não avaliada. Um resultado de descoberta temática não substitui PQ1 nem uma decisão humana.

**Dependência material que não deve ficar escondida:** a taxonomia aprovada proíbe converter automaticamente `thematicCodes` F12 e áreas UBI por igualdade de texto. Fixar o mapping inicial e a regra determinística de correspondência. O perfil publicado/ativado tem contratos de maker-checker e snapshots: se o recorte temático exigir mudança de contrato de consumo/completude, aprovar apenas esse delta explícito, preservando regras/histórico existentes. Não contornar controlos nem exigir completar todos os outros domínios como solução automática.

**Escolha de produto remanescente:** matching institucional é base C4G documentada; confirmar se a primeira recuperação também precisa da vista individual que existia para o investigador. Não universalizar “Professor” nem eliminar silenciosamente essa utilidade. Esta escolha afeta só a entrega 3; não bloqueia visual/catálogo.

**Conclusão:** dois contextos com temas diferentes recebem resultados explicáveis diferentes sobre o mesmo catálogo; sem mapping/dados há mensagem específica; resultados são reproduzíveis com versões identificadas; acesso ao catálogo completo e candidatura manual permanece; atualização do perfil/oportunidade não reescreve decisões históricas; teste A/B, determinismo, desconhecidos, autorização e browser passam. Matching incluído é obrigatório para fechar esta recuperação.

**Dimensão:** M–G. **Confiança:** média-baixa até confirmar mappings/consumo. Nenhuma nova camada genérica de scoring ou motor paralelo de qualificação.

### Entrega 4 — Candidaturas completas, equipa e documentos utilizáveis

**Resultado:** gerir candidatura da preparação à submissão e ao resultado; atribuir e concluir tarefas; carregar/consultar documentos; solicitar e decidir revisão simples.

**Reutilizar:** candidaturas manuais, participants/work, receipts/histórico, F11, documentos/revisão e UI existentes. Parceiros preservados, sem expandir para CRM; portar apenas o necessário ao percurso do primeiro cliente.

**Trabalho mínimo:** ampliar estados restritos atuais com categorias já previstas em `application-pipeline.md`: submetida/aguardar decisão/aprovada ou rejeitada pelo financiador; distinguir aprovação interna. Acordar apenas transições/campos indispensáveis, sem construtor genérico. Ligar upload, scanner e download privados reais; corrigir recuperação de recusas definitivas/resultado incerto; adaptar controlos às capacidades do papel. Gestão de participantes não concede grants automaticamente; acesso dos colaboradores tem de ser configurável por procedimento/UI autorizado.

**Dependências:** origem de oportunidade e membership/grants; armazenamento/scanner reais e políticas aplicáveis. Há dois gates internos: 4A ciclo/equipa e 4B documentos/revisão. A prova de 4A não deve esperar pela configuração externa de 4B; a entrega global só fecha com ambos.

**Conclusão:** criação manual e via matching, atribuição, tarefa, upload/scan/download, revisão por pessoa distinta com MFA, submissão e resultado, histórico após reload/restart; documento em quarentena não é descarregado; acesso revogado não funciona; falha de resposta não duplica; erro definitivo não obriga a limpar storage ou usar SQL; A/B isolados. Não basta o adapter documental de teste.

**Dimensão:** G. **Confiança:** média; documentos externos são a maior incerteza. **Validação:** migrations aditivas apenas se necessárias, testes de transições, concorrência/recuperação/F11, PostgreSQL A/B e browser por papel.

### Entrega 5 — Dashboard, alertas e demonstração de ponta a ponta

**Resultado:** ao abrir a app, a entidade sabe o que tem em curso, o que está atrasado e o que deve fazer a seguir.

**Reutilizar:** componentes visuais do Dashboard, candidaturas/tarefas novas, padrões de alertas e infraestrutura async existente. Não consultar tabelas UBI globais para preencher indicadores C4G.

**Trabalho mínimo:** contagens de candidaturas por estado, tarefas pendentes/atrasadas, próximos prazos e alertas da entidade; ligações dos indicadores para os registos. Usar métricas já definidas, sem inventar montantes ou taxa de sucesso com dados ausentes. Alertas in-app e envio de email para os casos existentes que forem assumidos no piloto, com Resend conforme arquitetura e entrega real validada. Indicar claramente canais ainda não configurados, sem os anunciar como operacionais.

**Dependências:** dados dos incrementos anteriores; fonte autorizada e worker; definições e destinatários existentes, ajustando apenas o que falta para o primeiro cliente.

**Conclusão:** totais conferem com listas e permissões; alteração de prazo reflete-se no painel; alertas não duplicam nem cruzam tenants; papéis ADMIN C4G, administrador/gestor organizacional, colaborador, revisor e consulta completam as suas ações; não há acesso cliente aos caminhos legacy globais; prova após reinício e recuperação; cenário integral aprovado com dados identificados, sem mocks escondidos.

**Dimensão:** M–G. **Confiança:** alta para agregados; média para notificações/serviços. Testes críticos e documentação operacional mínima encerram a recuperação; rollout/produção exigem os gates próprios.

## 6. Regras para avançar com propósito

1. **Cada tarefa termina numa melhoria observável da app.** Infraestrutura adicional só entra se desbloquear um critério destas cinco entregas.
2. **Reutilizar primeiro.** Inspecionar código e trabalho concorrente antes de abrir outro módulo, adapter ou migration para o mesmo fluxo.
3. **Contrato curto do delta.** Resultado, campos/regras alterados, critérios e testes; não reespecificar a plataforma inteira.
4. **Não confundir visual com funcionamento.** Um menu ou gráfico novo só fecha quando usa dados e permissões corretos. Não preencher demonstrações com números fictícios sem indicação.
5. **Testar o risco afetado.** Frontend: build e componentes/navegação pertinentes; backend: sintaxe e testes direcionados; tenancy/autorização/jobs/documentos/migrations/reporting: prova automatizada obrigatória e integração A/B. Repetir provas amplas apenas quando alterações/dependências o justifiquem.
6. **Concluir e demonstrar antes de expandir.** Matching faz parte desta sequência; sofisticação adicional não entra por arrasto. Nenhuma funcionalidade já usada é retirada silenciosamente.
7. **Preservar integralmente o residual.** Sem eliminar código/dados/documentação legacy, sem commit/merge/push/deploy implícitos. Segregar acesso e menus não é apagar história.
8. **Fecho único por entrega:** o que o utilizador consegue fazer, ambiente/snapshot, prova executada, dependências reais e pendências. Estado proposto, implementado, demonstrado e produtivo permanecem distintos.

## 7. Pontos de partida no código e limites desta tarefa

| Área | Evidência lida / alteração prevista |
|---|---|
| Marca ainda UBI | `frontend/index.html:6`; `frontend/public/manifest.json:2`; `pages/Login.jsx:58` e `:184`; `components/Layout/Sidebar.jsx:42` |
| Tokens ainda da apresentação antiga | `frontend/src/index.css:3`; migrar para direção semântica de `ui-foundations.md` |
| Menus misturam domínios | `Sidebar.jsx:8` e `:21`; `Layout.jsx:6`; navegação C4G e disponibilidade por capacidade |
| Matching antigo depende de investigadores | `frontend/src/pages/Matching.jsx:28` e `:42`; não confundir restyling com integração multi-tenant |
| Catálogo/origem central já em curso | `backend/src/fundingTenders/`, `frontend/src/pages/Opportunities/CentralOpportunities.jsx`, `pages/FundingTenders.jsx`, migrations central 015/tenant 024 |
| Candidaturas reutilizáveis | `backend/src/applications/`, `frontend/src/pages/Applications/`; estados restritos em `contracts.js:3` |
| Proteção documental a ligar | `backend/src/documents/productionDocuments.js`; port em `productionComposition.js`; UI documental existente |
| Dashboard/alertas a adaptar | `backend/src/controllers/dashboardController.js`, `notificationService.js`, rotas e composição; UI não prova residência dos dados |

O repositório conserva alterações extensas de outras tarefas; linhas e estado podem mudar. Este plano é orientado por contratos e percursos, não por um patch congelado. Foram lidos código/contexto e inspecionados visualmente o logótipo e mood institucional locais. Não se executaram testes, build, SQL, recolhas, configurações ou inspeção de browser nesta tarefa; os resultados do diagnóstico anterior mantêm a respetiva data e limites. Nenhuma prontidão nova é declarada.

**Próximo passo:** executar a entrega 1 — identidade e navegação C4G num ambiente identificado — preservando a fatia Funding & Tenders já em curso e os respetivos contratos.
