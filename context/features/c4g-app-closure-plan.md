# Plano de fecho funcional da APP C4G

Data: 2026-10-17. **Estado: proposta de execução; planeamento apenas.** Pedido: conseguir ver e utilizar os quadros/painéis e a equipa, no ambiente habitual. O utilizador confirmou que «quadros» significa ambos. Este documento ajusta a sequência do [plano de recuperação](c4g-functional-recovery-plan.md) à instalação consolidada e à captura enviada. Não altera contratos, código, dados ou fechos históricos.

## 1. Diagnóstico que determina a ação

**A consolidação reuniu dados e serviços no ambiente local, mas não fechou os percursos da aplicação.** Há trabalho aproveitável; a prioridade é torná-lo acessível e completar as ligações em falta. A referência continua a ser o frontend do piloto, adaptado a C4G e a várias entidades, com a autenticação e o isolamento atuais.

| Facto observado | Consequência para o utilizador | Ação necessária |
|---|---|---|
| A captura mostra `admin` no catálogo. A consulta atual exige organização; esta conta tem papel de plataforma e nenhuma membership ativa. | Menu e seletor conduzem a um ecrã sem saída útil. | Corrigir entrada, navegação e consulta do catálogo comum pelo ADMIN, sem lhe conceder acesso privado às entidades. |
| O menu ocupa 264 px e só recolhe em larguras até 768 px. A janela da captura tem aproximadamente 1000 px de largura útil. | Pouco espaço para tabelas; várias entradas ficam escondidas no scroll do menu. | Menu recolhível também em larguras intermédias, navegação compacta e área de trabalho mais aproveitada. |
| Visão geral, Matching e Alertas estão substituídos por «Em integração» no modo ativo. | Os quadros esperados não estão disponíveis, apesar de existirem componentes antigos. | Recuperar cada página sobre serviços multi-entidade; retirar a indisponibilidade apenas quando o percurso funcionar. |
| A base contém uma ficha de organização, três unidades ativas e uma pessoa ativa. | A equipa está incompleta; não é apenas um problema de tamanho ou filtro. | Validar organograma e preencher as pessoas reais nos formulários existentes. |
| Há nove oportunidades centrais; quatro têm prazo atual nesta data. O coletor está limitado a uma página de cinco resultados por execução. | O catálogo é real, mas limitado. Não prova cobertura completa nem atualização automática. | Tornar cobertura/atualização explícitas e concluir a recolha da fonte prioritária dentro de um âmbito definido. |
| A candidatura atual tem intenção/preparação, equipa e tarefas; faltam estados de submissão/resultado e upload utilizável de documentos. | Não se consegue ainda demonstrar o acompanhamento integral do trabalho do cliente. | Completar esse percurso aproveitando domínio, componentes e proteção documental existentes. |

**Não há evidência suficiente para atribuir a captura a uma versão antiga ou a cache.** O código atual e os papéis da conta explicam o ecrã vazio. Trocar para `hugo` permite trabalhar no contexto C4G já existente, mas não corrige o percurso defeituoso do ADMIN.

Evidência técnica principal:

- `frontend/src/pages/Opportunities/CentralOpportunities.jsx:38` e `:51`: sem organização não consulta nem apresenta o catálogo; `backend/src/fundingTenders/http.js:21`: leitura exige contexto organizacional válido.
- `frontend/src/App.jsx:38` e `:53`: entrada F12 para oportunidades privadas; `frontend/src/components/Layout/Sidebar.jsx:37`: menu organizacional também apresentado ao administrador da plataforma; `frontend/src/components/OrganizationSelector.jsx:31`: seletor sem saída própria para ausência de memberships.
- `frontend/src/index.css:28`, `:50`, `:701`, `:1799` e `:2257`: largura, margens e comportamento do menu; `frontend/src/components/Layout/Layout.jsx:82` e `frontend/src/components/ProductAvailability.jsx:4`: páginas substituídas por indisponibilidade.
- `backend/scripts/localPlatform/runtime.js:72`: routers legacy vazios; `:74`: acesso legacy recusado. Remover um placeholder não liga o serviço em falta.
- `backend/src/config/fundingTendersWorker.js:13` e `:25`: autorização limitada e máximo de cinco resultados. Aumentar o limite exige adaptar o contrato/configuração do coletor, sem simplesmente ignorar a proteção atual.
- `backend/src/applications/contracts.js:3`, `:11` e `:25`: transições reduzidas, candidatura central manual sem avaliação obrigatória e listagem ainda sem os filtros completos do piloto.
- `frontend/src/pages/Applications/PrivateApplications.jsx:102`: equipa/tarefas já compostas; `ApplicationDocumentsReview.jsx:60`: upload produtivo indisponível; `backend/src/productionComposition.js:227`: porta documental dependente da composição.
- `backend/src/authorization/catalogs.js:259`: equipa/tarefas usam `application.read/edit`; decisão de revisão usa grant distinto em `:263`. Não atribuir a falta de equipa a supostas permissões de tarefas em falta.
- [Prova da consolidação e limites dos dados](../reviews/local-platform-consolidation/README.md); [comparação página a página](../reviews/2026-10-17-frontend-ubi-referencia-recuperacao.md), baseline `3a79b25539040c2024051cf9ab6295680b760277`.

## 2. Regra de trabalho e sequência

**Um ambiente de trabalho: `http://localhost:3000`, API 5000 e bases nativas já consolidadas.** A demonstração antiga continua arquivada. Cada incremento termina com um percurso visível nesse ambiente, preservação de dados e uma evidência curta. Código existente ou testes com fixtures não bastam para declarar a funcionalidade disponível.

Dimensão relativa: **M** = alteração delimitada com integração; **G** = vários componentes/serviços, com validação mais exigente. Não são estimativas de dias. A confiança refere-se à delimitação do trabalho, não à prontidão atual.

### Incremento 1 — Entrar e ver a aplicação corretamente

**Resultado visível:** ADMIN chega às fontes e ao catálogo comum; gestor chega à sua organização e às funcionalidades disponíveis. Tabelas têm espaço útil na janela mostrada pelo utilizador.

| Elemento | Plano |
|---|---|
| Reutilizar | `App`, `Sidebar`, `Header`, `Layout`, `OrganizationSelector`, tabela/detalhe do catálogo e autorização de plataforma existentes. |
| Alterações mínimas | Entrada/menu conforme autoridade; estado claro quando não há membership; leitura central autenticada para ADMIN com autoridade de plataforma explícita; seletor apenas onde se aplica; menu recolhível em larguras intermédias. Separar as ações privadas da ficha pública. |
| Dependências | Nenhuma nova base, fonte ou estrutura de organização. Ajuste do contrato HTTP de leitura central e respetivo cliente. Não conceder memberships fictícias ao ADMIN. |
| Conclusão | `admin` consulta lista/detalhe comum e fontes sem organização; continua sem acesso privado. `hugo` entra no contexto C4G e vê catálogo/perfil/candidaturas autorizados. Acesso direto e recarregamento funcionam. Navegação e tabelas verificadas aproximadamente a 1000×620, 1280/1440 e 390 px, com teclado. Nove registos preservados; filtro atual coerente com a data. |
| Dimensão/confiança | **M / alta**. Causa identificada no código e nas memberships. |

### Incremento 2 — Organização, pessoas e primeiros quadros reais

**Resultado visível:** perfil C4G reconhecível, unidades e pessoas consultáveis; Visão geral recuperada com os indicadores que já têm dados reais.

| Elemento | Plano |
|---|---|
| Reutilizar | `OrganizationProfile`, serviço de diretório/estrutura, memberships e cards/tabelas do `Dashboard.jsx`. |
| Alterações mínimas | Melhorar acesso aos separadores de unidades/pessoas e densidade da listagem; preencher dados confirmados; ligar indicadores existentes às consultas centrais e privadas autorizadas. Manter distinção entre pessoa do diretório e utilizador com acesso. |
| Dependências | Lista atual de pessoas/funções/unidades validada pela C4G para concluir o preenchimento. Adaptação das consultas do Dashboard; os routers locais antigos estão vazios. A implementação das consultas não depende de ter o organograma completo. |
| Conclusão | Pesquisar pessoa, filtrar unidade, consultar função/afetações e editar com permissões adequadas. Totais conferem com listas e base; zero só quando confirmado, indisponibilidade nunca disfarçada de zero. Dashboard abre os registos correspondentes. Sem importar equipa UBI nem criar pessoas/contas fictícias. |
| Dimensão/confiança | **M / média**. Diretório já funcional; agregação do Dashboard por integrar e preenchimento dependente de informação real. |

Esta é uma primeira disponibilização do Dashboard. Os indicadores de submissões/resultados e os alertas só são fechados depois dos incrementos 4 e 5; não se anuncia antecipadamente paridade integral.

### Incremento 3 — Catálogo com cobertura explícita e Matching recuperado

**Resultado visível:** oportunidades da fonte prioritária atualizadas pelo ADMIN, filtros preservados e lista de correspondências explicáveis para a entidade.

| Elemento | Plano |
|---|---|
| Reutilizar | Coletor/worker Funding & Tenders, catálogo central versionado, filtros por programa/prazo e interface do `Matching.jsx`; regras determinísticas existentes. |
| Alterações mínimas | Substituir limite de ensaio por paginação/recolha limitada ao âmbito aprovado, com continuidade e resultado claros. Adaptar os dados do perfil académico para os dados relevantes da organização. Ligar a lista de matching ao catálogo central e ao motor existente; mapping explícito dos temas. |
| Dependências | Campos da fonte, temas/competências reais e configuração da recolha. Nenhuma obrigação de preencher todos os domínios F13 ou de passar por publicação multidomínio. A compatibilidade do motor existente com esse recorte deve ser confirmada, não presumida. |
| Conclusão | ADMIN atualiza a fonte e vê data, âmbito, resultado e falhas; clientes consultam o mesmo catálogo. Pesquisa/programa/a encerrar continuam a funcionar. Matching apresenta motivos e trata dados ausentes sem inventar compatibilidade. O cliente mantém acesso a oportunidades sem match e pode criar candidatura manual. Repetição da recolha não duplica nem elimina correções. |
| Dimensão/confiança | **G / média**. Recolha base reutilizável; ligação perfil → oportunidades ainda exige adaptação. |

«Catálogo central» significa recolha comum e consulta partilhada, não promessa de que todas as fontes estão cobertas. Completar primeiro Funding & Tenders; não abrir já desenvolvimento de vários conectores. Matching faz parte da recuperação obrigatória, não é uma funcionalidade nova a adiar indefinidamente.

### Incremento 4 — Uma candidatura acompanhada até ao resultado

**Resultado visível:** lista/detalhe com a riqueza útil do piloto; criar candidatura, atribuir equipa, gerir tarefas/prazos, anexar documentos e registar submissão/resultado.

| Elemento | Plano |
|---|---|
| Reutilizar | `ApplicationsList`, `ApplicationDetail`, serviço atual, `PrivateApplications`, `ApplicationWork`, F11 e `ApplicationDocumentsReview`. |
| Alterações mínimas | Recuperar pesquisa, filtros/contagens e apresentação; completar apenas transições/campos do pipeline já contratado; tornar nomes, responsáveis e prazos legíveis; ligar upload/download e revisão existentes ao armazenamento/scanner autorizados. |
| Dependências | Memberships reais para participantes e permissão específica para revisor. Composição documental, armazenamento e scanner operacionais. Migrations aditivas apenas se necessárias aos campos/estados; nunca reset. |
| Conclusão | Criar manualmente sem perfil completo/matching; editar e acompanhar preparação, submissão e resultado; atribuir/concluir tarefa; enviar, abrir e rever um documento real autorizado. Lista e detalhe coerentes após reinício. Consulta não edita; revisor tem apenas a autoridade prevista; outra entidade não acede a candidatura/documento. |
| Dimensão/confiança | **G / média no pipeline e tarefas; menor na ativação documental**, por depender de serviços/configuração ainda não demonstrados. |

É o maior incremento. Validar por percurso dentro do mesmo âmbito: candidatura/tarefa primeiro, documento/revisão depois. Não confundir decisão interna sobre documentos com aprovação do financiamento, nem anunciar o incremento completo enquanto faltar uma dessas partes. Não substituir proteção documental por anexos públicos ou pastas sem autorização.

### Incremento 5 — Dashboard, alertas e demonstração de fecho

**Resultado visível:** quadros mostram o trabalho real, prazos próximos e estados das candidaturas; alertas abrem o assunto relevante; demonstração completa sem SQL ou manipulação técnica.

| Elemento | Plano |
|---|---|
| Reutilizar | Dashboard já ligado no incremento 2, `Notifications.jsx`, eventos/jobs existentes e consultas de candidaturas/tarefas/documentos. |
| Alterações mínimas | Completar indicadores dependentes do pipeline; ligar notificações e destinatários à entidade; recuperar leitura/navegação da lista de alertas. Corrigir a restrição visual legacy baseada apenas em ADMIN. |
| Dependências | Incrementos anteriores. Alertas dentro da app primeiro; envio por email só é dado como operacional após comprovar o serviço configurado. Não bloquear toda a caixa de alertas por causa do email. |
| Conclusão | Totais e prazos conferem com listas; alerta leva ao recurso autorizado; não duplica nem mistura entidades. Fazer o guião de fecho abaixo na instalação habitual, incluindo recarregamento e recuperação de erros. |
| Dimensão/confiança | **M / média**, dependente da disponibilidade real dos fluxos anteriores. |

## 3. O que fica fora deste fecho

- Novo frontend, novo sistema visual, reorganização geral da arquitetura ou nova instalação paralela.
- IA, scoring/ranking avançados, todos os domínios F13, overlays adicionais e publicação multidomínio como condição universal de utilização.
- Novos construtores genéricos de integrações, workflows, dashboards ou relatórios; novas fontes antes de fechar a primeira.
- Repetição extensiva de especificações e relatórios para ações já contratadas. Cada incremento usa critérios acima e acrescenta só o detalhe necessário à alteração concreta.
- Funcionalidades adicionais de RH, organigramas gráficos ou novos quadros Kanban. «Quadros» não autoriza inventar estes produtos; a melhor baseline identificada já tinha removido Kanban.

Ficam preservados: autenticação, autorização, membership central, isolamento por entidade, auditoria/integridade, proteção documental, histórico, catálogo e filtros recuperados. Contratos avançados podem ficar fora do percurso principal sem se apagar trabalho ou desligar dependências às cegas.

## 4. Critério único de fecho

Na instalação habitual, com dados reais autorizados e marca C4G: **ADMIN consulta/atualiza fonte → gestor encontra oportunidade e matching → cria candidatura manual → equipa gere tarefa e documento → regista submissão/resultado → Dashboard e alertas refletem o trabalho**. Nenhuma página necessária depende de SQL, UUID introduzido manualmente, fixture ou acesso à base arquivada.

Além de build/sintaxe e testes direcionados às alterações, cada incremento tem demonstração com as contas/papéis relevantes e teste de isolamento entre entidades. Incluir ausência de membership, consulta, gestão e revisão; não dar ao ADMIN acesso privado só para a demonstração. Contas/entidades de teste, quando necessárias, pertencem a provas isoladas, não a uma segunda fonte de verdade da operação C4G.

Não dar como concluído com base apenas numa captura larga, numa conta diferente da usada pelo utilizador ou num conjunto de testes verdes. As páginas que continuem indisponíveis são identificadas como pendentes. Nenhuma afirmação de produção decorre destas provas locais; operação produtiva continua a exigir os controlos e serviços previstos nos contratos existentes.

## 5. Dados/decisões pendentes, sem bloquear o início

| Pendência | Impacto |
|---|---|
| Confirmar organograma atual e nomes, funções e unidades das restantes pessoas | Necessário para completar a equipa. O site sustentou apenas uma pessoa e três designações de unidade; não demonstra que esse é o quadro atual completo. Não impede o incremento 1 nem a ligação dos painéis. |
| Indicar quais dessas pessoas precisam de conta e de que autoridade | Necessário antes de conceder acesso real. A existência no diretório não dá acesso automático. Manter `admin` para plataforma e `hugo` para gestão organizacional até existir instrução diferente. |
| Confirmar âmbito de recolha se for pretendido algo além da fonte já priorizada | Não abrir novas integrações por inferência. No âmbito atual, completar primeiro Funding & Tenders e explicitar a cobertura. |

Não é necessária nova decisão de marca, reescrita ou arquitetura para começar. Não atribuir datas/custos sem medir a primeira entrega. A próxima implementação recomendada é o incremento 1.

## 6. Verificações realizadas e limites deste plano

- Captura enviada pelo utilizador, código de rotas/menu/CSS, composição local, catálogo, coletor, candidaturas, documentos e autorização; confronto com referência frontend e prova de consolidação.
- Consultas PostgreSQL em transação somente de leitura: uma organização, três unidades ativas, uma pessoa ativa, nove oportunidades, quatro com prazo atual e quatro recolhas; ADMIN com papel de plataforma/sem membership, Hugo com uma membership ativa/sem papel de plataforma. Contagens relativas a 17/10/2026; prazo atual não prova elegibilidade nem cobertura da fonte.
- Health local: ambiente C4G local, fonte `live-local`, API pronta e worker pronto. Isto não prova uma recolha externa bem-sucedida neste destino nem que cada página funciona.
- Referência Git consultada apenas em leitura. Nenhum novo percurso autenticado de browser nesta revisão: a captura é evidência do utilizador; provas de browser anteriores estão no relatório de consolidação e não são apresentadas como repetidas agora.
- Não foram executados recolhas, migrations, seeds, resets, alterações de permissões, testes com escrita, deploy ou operações Git mutáveis. Nenhum segredo foi incluído. Apenas este documento novo foi criado; código, documentação anterior, dados e residual preservados.
