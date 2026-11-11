# Plano de ação — recuperar a aplicação do piloto com identidade C4G

Atualização: 18/10/2026. **Entregas 1 e 2 concluídas; entrega 3 com anexos reais pendentes; entrega 4 em curso, com fontes/alertas/comunicação recuperados e importação real Portugal 2030/email pendentes; entrega 5 iniciada, Dashboard/indicadores/relatório em Review.** Estado corrente e provas em [trabalho atual](../current-work.md) e [revisão do Dashboard](../reviews/c4g-pilot-parity-delivery-5-dashboard.md). Este documento nasceu como plano de análise; o inventário e registos seguintes conservam o estado observado antes das implementações. Não autoriza operações destrutivas, publicação ou Git mutável.

## 1. Objetivo e critério de decisão

**Recuperar a aplicação UBI reconhecível e funcional, com marca C4G e Organização → Departamentos/Unidades → Pessoas.** A referência é a aplicação existente: páginas, informação, ações, pesquisa, formulários e percursos. As melhorias funcionais novas ficam para depois da recuperação.

«Começar pelo zero» significa corrigir a direção do trabalho. Não significa apagar código, dados ou histórico, regressar à autenticação antiga ou criar outra instalação. Preservam-se o catálogo central, a autenticação atual, as memberships, o isolamento das organizações e os dados já consolidados.

A instrução atual prevalece sobre a sequência dos planos anteriores e sobre extensões propostas que não sejam necessárias à equivalência com o piloto. Mantêm-se os contratos de segurança e os comportamentos já construídos que não perturbem esta recuperação. Não se alteram retroativamente os documentos ou fechos históricos.

**Regra prática:** antes de criar uma página ou uma regra, localizar a equivalente no piloto e reutilizá-la. Alterar apenas marca, linguagem institucional e ligações necessárias aos dados/permissões da plataforma. Um módulo não está recuperado só porque tem uma rota, um componente ou testes aprovados.

## 2. O que a análise confirmou

**Referência:** commit `3a79b25539040c2024051cf9ab6295680b760277`, igual à referência local `legacy-origin/main`, de 12/05/2026. É a melhor versão local identificada; não existe prova de que corresponda exatamente à última instalação utilizada na UBI. É suficiente para começar a recuperação, mantendo explícita esta limitação.

| Facto verificado | Implicação para o plano |
|---|---|
| `Dashboard.jsx` e `Matching.jsx` diferem da referência apenas numa ligação; `ApplicationsList.jsx` e `ApplicationDetail.jsx` estão preservados nessa comparação. | Reutilizar as páginas originais. Não há motivo para voltar a desenhar esses módulos. |
| O runtime atual substitui páginas por indisponibilidade e escolhe uma interface reduzida para candidaturas. | Ligar componentes aos serviços é trabalho real ainda necessário; retirar a mensagem «Em integração» não resolve o problema. |
| O Matching original cruza áreas das pessoas com áreas das oportunidades, apresenta as coincidências e ordena os resultados. | Recuperar este Matching determinístico e explicável; não esperar por um motor novo de qualificação. |
| O piloto tinha sete estados de candidatura, orçamentos, equipa, parceiros, anexos e histórico. O modelo ativo só permite intenção/preparação, cancelamento e arquivo. | A recuperação exige completar persistência e operações, além de repor a interface. |
| O diretório atual já contém organização, unidades, pessoas e várias afetações com unidade principal. | Aproveitar esse trabalho; completar competências e ligação explícita pessoa–conta para os percursos que o exijam. |
| O menu atual recolhe automaticamente até 1100 px e a lista/detalhe foram recompostos. | A adaptação mudou a experiência que o utilizador queria preservar. Recuperar a composição original e verificar a densidade real do ecrã. |
| Os controllers antigos usam uma base e privilégios globais. O runtime local recusa essas consultas. | Reutilizar regras e apresentação dentro das fronteiras atuais. Reativar a aplicação antiga inteira criaria outra fonte de verdade e não resolveria a adaptação multi-entidade. |

Referências atuais: `frontend/src/App.jsx:72`; `frontend/src/components/ProductAvailability.jsx:4`; `frontend/src/components/Layout/Layout.jsx:29`; `frontend/src/pages/Opportunities/OpportunityPresentation.jsx:42`; `backend/src/controllers/matchingController.js:24`; `backend/src/applications/contracts.js:3`; `backend/src/organizationDirectory/contracts.js:18`; `backend/scripts/localPlatform/runtime.js:72`.

**Conclusão:** há uma base de produto substancial para recuperar. Não é necessário reinventar a aplicação, mas também não seria honesto prometer que basta trocar o logótipo para todos os percursos voltarem a funcionar na infraestrutura atual.

## 3. Inventário de recuperação — nenhuma área original fica esquecida

As referências com **[piloto]** reportam ao commit indicado acima. As restantes reportam ao worktree analisado. «Recuperar» descreve trabalho proposto, não funcionalidade já demonstrada.

| Página / percurso | Recuperar diretamente | Adaptação C4G indispensável | Entrega |
|---|---|---|---|
| Entrada, menu e cabeçalho | Estrutura, ordem, densidade, ícones e ligações familiares. | Marca C4G, organização ativa, sessão atual e opções conforme autoridade. | 1 |
| Dashboard e reporting | Indicadores, histogramas, prazos, tabelas, orçamentos e exportação existentes. | Leituras centrais públicas e agregações privadas autorizadas; faculdades/centros passam a unidades. Fecho dos indicadores dependentes do ciclo completo na entrega 5. | 1 e 5 |
| Oportunidades / catálogo | Lista, nove colunas, pesquisa, detalhe, fonte oficial, áreas, registar interesse e ligação à candidatura. | Catálogo central já construído; filtros melhorados; contagens/candidaturas só da organização ativa. Preservar oportunidades privadas existentes. | 1 |
| Organização e unidades | Fichas, tabelas, pesquisa e afetações aproveitáveis. | Diretório atual Organização → Departamentos/Unidades → Pessoas; sem estruturas fixas de universidade. | 2 |
| Pessoas e perfil pessoal | Lista/detalhe, competências/áreas, unidades e participação em candidaturas. | Pessoa independente da conta de acesso; associação explícita quando existe conta. Não perder o perfil pessoal ao introduzir o perfil da organização. | 2 |
| Matching | Quadro de resultados, áreas coincidentes, ordenação, oportunidades da pessoa e pessoas relevantes para a oportunidade. | Ler competências privadas autorizadas e oportunidades centrais/privadas elegíveis. Manter a regra original. | 2 |
| Áreas temáticas | Cadastro e associação de áreas; classificação determinística por palavras-chave existente. | Taxonomia comum sob administração da plataforma; competências das pessoas na organização. Reaproveitar os identificadores/serviços existentes com correspondência explícita. | 2 e 4 |
| Candidaturas | Lista, filtros, formulário, detalhe, próximo passo, sete estados, prazo interno, notas, dois orçamentos e histórico. | Completar domínio tenant, preservar estados/histórico atuais e adaptar «orçamento UBI» para «orçamento da organização». | 3 |
| Equipa e parceiros | Coordenação, membros, papéis, contactos e secção de parceiros; página agregada de Parceiros. | Membros autorizados da organização; parceiros/contactos privados. Parceiro não é automaticamente outro cliente da plataforma. | 3 |
| Documentos / anexos | Adicionar, listar, descarregar e remover da candidatura com interação simples. | Transporte, armazenamento e acesso protegidos existentes; remoção lógica compatível com retenção/histórico. Não exigir IDs ou operações técnicas ao utilizador. | 3 |
| Utilizadores e acessos | Lista/detalhe e consulta das participações existentes. | Contas centrais e memberships; gestor administra apenas o âmbito autorizado da organização. Não recuperar passwords/JWT legacy. | 2 |
| Importação | Template Excel, validação, pré-visualização, confirmação, resultado e histórico Portugal 2030. | ADMIN pode alimentar o catálogo comum; importações privadas existentes continuam privadas. | 4 |
| Integrações / fontes | Cartões, configuração, atualização e histórico de Funding & Tenders, CORDIS, Erasmus, Interreg Europe e POCTEP. | Recolha pública única para a central; validar e adaptar cada conector existente. Não executar uma recolha pública por cliente. | 4 |
| Alertas e notificações | Lista, leitura, ligações, prazos, alterações de candidatura, entrada na equipa e comunicação administrativa existente. | Destinatários e conteúdo com âmbito correto; worker e envio configurados, sem divulgar informação de outra entidade. | 4 |

Evidência do inventário: **[piloto]** `frontend/src/pages/Dashboard.jsx:156`, `:380`; `frontend/src/pages/Opportunities/OpportunitiesList.jsx:166`; `frontend/src/pages/Opportunities/OpportunityDetail.jsx:325`; `frontend/src/pages/Matching.jsx:16`; `backend/src/controllers/applicationController.js:8`, `:290`, `:648`, `:713`, `:857`, `:987`; `backend/src/controllers/partnerController.js:3`; `backend/src/controllers/importController.js:30`; `backend/src/routes/integrationRoutes.js:8`; `backend/src/services/notificationService.js:153`.

**Precisões que evitam aumentar o âmbito:** não foi encontrado um módulo autónomo de tarefas, Kanban ou aprovação documental nesta referência. O estado «Aprovado» referia-se à candidatura. As tarefas e a revisão interna construídas posteriormente são preservadas; não se desenvolvem novas extensões desses mecanismos como condição para recuperar o piloto. O trabalho de equipa/tarefas já aceite continua acessível na candidatura recuperada.

## 4. Aplicação da skill frontend-design

**Direção visual:** aplicação de trabalho institucional, com a composição do piloto e identidade C4G. O briefing de fidelidade prevalece sobre a introdução de novidades estéticas. Não há necessidade de outro sistema de design, biblioteca, fonte externa ou redesenho do Dashboard.

| Papel | Valor a reutilizar |
|---|---|
| Superfície principal | Branco `#FFFFFF` |
| Fundo da aplicação | Cinza claro `#F6F8F8` |
| Texto | Carvão `#20262B` |
| Navegação | Verde petróleo `#075B59` |
| Identidade / destaque | Verde C4G `#5FAD2F` |
| Ações com maior contraste | Verde escuro `#39751F` |

Usar o logótipo existente em `frontend/public/logo-c4g.png`. Manter a tipografia de sistema/Segoe UI, escala, pesos e densidade do piloto; corpo base de 14 px, títulos e tabelas com os papéis existentes. As cores já estão em `frontend/src/index.css:3`; a largura de menu de 240 px é confirmada por `frontend/src/c4g-shell.css:2`.

Composição de referência, não um novo desenho:

```text
+----------------------+-----------------------------------------------+
| Logótipo C4G          | Página | Organização ativa | Alertas / Conta |
|                      +-----------------------------------------------+
| Dashboard            | Título e ações da página original            |
| Oportunidades        | Indicadores / filtros originais, compactos   |
| Candidaturas         |                                               |
| Parceiros            | Tabela, gráfico ou formulário do piloto      |
| Matching             |                                               |
| Organização / Pessoas| Mesmas secções, campos e ações principais    |
| Perfil pessoal       |                                               |
| Administração*       | Paginação / ações secundárias                |
+----------------------+-----------------------------------------------+
  * Opções distintas de plataforma e de organização, por permissão.
```

Princípios de execução:

1. Preservar a ordem familiar e a navegação descoberta pelo utilizador. Em larguras de trabalho como a captura enviada, o menu começa visível; recolha voluntária e comportamento móvel acessível mantêm-se.
2. Preservar colunas e ações: Ref., Título, Programa/Call, Fonte, Estado, Abertura, Fecho, Dotação e Candidatura. Não fundir informação para obter artificialmente uma tabela mais pequena. No móvel, adaptar a apresentação sem perder conteúdo.
3. Recuperar a hierarquia do detalhe original, incluindo prazo, candidaturas, dotação e informação de registo quando existente. Valores desconhecidos ficam identificados; não são inventados nem substituídos por zero.
4. Identificar o ambiente de forma discreta e permanente; reduzir blocos explicativos repetidos para que os dados apareçam cedo. Estados técnicos não ocupam a hierarquia principal.
5. Usar foco visível, contraste, teclado, mensagens úteis e datas legíveis. Não acrescentar imagens decorativas, animações ou cartões promocionais.
6. A marca UBI deixa de aparecer na interface ativa e nas exportações produzidas pela C4G. Código e arquivos históricos permanecem preservados.

**Validação visual obrigatória:** comparar piloto e C4G lado a lado, com a mesma largura e dados de referência equivalentes. Aceitar diferenças apenas por marca, vocabulário organizacional, âmbito de acesso, catálogo central/filtros já autorizados e tratamento honesto de dados indisponíveis. Testar 1008×620, 1280, 1440 e 390 px, incluindo quantidade de informação visível e facilidade de encontrar as ações. Capturas com fixtures provam apresentação, não funcionamento real.

## 5. Cinco entregas, com resultados verificáveis

Dimensão relativa: **M** = alteração delimitada com integração; **G** = vários percursos e persistência; **G+** = integração ampla ou dependências externas. Não são estimativas de dias. Confiança refere-se à delimitação técnica, não à prontidão atual. Cada entrega termina com uma demonstração no ambiente habitual e uma evidência curta; não abre outro ciclo extenso de especificações.

### Entrega 1 — Voltar a reconhecer e utilizar a aplicação

Correção autorizada em 17/10/2026 após comparação: recuperar linhas compactas (sem remover colunas, filtros ou conteúdo do detalhe), ajuda de catálogo discreta, faixa Prazo/Candidaturas/Dotação/Registo e ação “Registar interesse” ligada à criação existente em `INTENTION`. O detalhe central expõe adicionalmente `createdAt` já persistido; `observedAt` continua a significar recolha. Contagem de candidaturas usa o resumo autorizado da organização, com falha distinta de zero e descarte de respostas antigas. Nenhuma regra nova de Matching ou candidatura; entrega 2 não iniciada.

**Resultado visível:** entrar na C4G, encontrar o menu do piloto, consultar o Dashboard com dados efetivos disponíveis e usar a lista/detalhe de oportunidades com a riqueza e as ações originais.

- **Reutilizar:** `Layout`, `Sidebar`, `Header`, `Dashboard.jsx`, `OpportunitiesList.jsx`, `OpportunityDetail.jsx`; catálogo central, filtros, resumos de candidaturas e autorização já construídos.
- **Alterações mínimas:** repor a composição original, aplicar os tokens/logótipo C4G, ligar as consultas do Dashboard às bases certas e as ações das oportunidades aos comandos atuais. Preservar o acesso do ADMIN ao catálogo sem membership e o contexto privado do gestor. Voltar da ficha mantém pesquisa/filtros.
- **Dependências:** adaptação das agregações antigas; não exige outra base nem outra autenticação. Indicadores de etapas ainda não suportadas ficam explicitamente pendentes até à entrega 3, sem dados fictícios. A paridade completa do Dashboard só fecha na entrega 5.
- **Conclusão:** comparação visual lado a lado; navegação reconhecível e visível; nove colunas e ações originais recuperadas; quatro detalhes anteriormente revistos preservam condições/fontes; totais disponíveis conferem com as listas autorizadas; candidatura manual direta funciona. Uma maqueta de Dashboard não fecha esta entrega. ADMIN não vê dados privados por ter papel de plataforma.
- **Dimensão/confiança:** **G / média-alta**. Reutilização visual comprovada; agregações ainda precisam de integração.

### Entrega 2 — Organização, pessoas, acessos e Matching do piloto

**Resultado visível:** gerir organização, departamentos/unidades e pessoas; consultar o perfil pessoal e competências; obter oportunidades correspondentes e perceber porquê, como no piloto.

- **Reutilizar:** `OrganizationProfile`, diretório existente, páginas de pessoas/perfil/utilizadores/áreas e `Matching.jsx`; consultas e regra determinística de correspondência originais.
- **Alterações mínimas:** completar relações de competências e associação explícita pessoa–conta, reaproveitando identidades/taxonomia existentes. Adaptar nomes, filtros e permissões; não criar outra estrutura de recursos humanos. Manter os percursos «minhas oportunidades», «oportunidades desta pessoa» e «pessoas para esta oportunidade» conforme autorização.
- **Dependências:** correspondência documentada entre áreas antigas e identificadores atuais; membership e contexto organizacional. O desenvolvimento não depende de ter já toda a equipa real registada. O preenchimento completo depende de uma lista atual validada pela C4G.
- **Conclusão:** criar/editar unidades e pessoas nos formulários, pesquisar e filtrar; conservar várias afetações/unidade principal; guardar competências; Matching apresenta resultados e áreas explicativas coerentes; acesso limitado à entidade. Pessoa criada não recebe acesso implícito. Alterações de acesso pelo gestor afetam apenas a membership da sua organização: ativação/desativação comprovada com duas entidades, sem alterar a identidade global nem eliminar a pessoa do diretório. Gestor pode criar candidatura sem perfil completo, Matching ou publicação prévia.
- **Dimensão/confiança:** **G / média**. Diretório e regra existem; a ligação pessoa–conta–competências precisa de adaptação.

### Entrega 3 — Candidaturas completas, equipa, parceiros e anexos

**Resultado visível:** acompanhar uma candidatura desde a identificação/interesse até à submissão e resultado, com orçamento, prazo, pessoas, parceiros e ficheiros no mesmo detalhe.

- **Reutilizar:** `ApplicationsList`, `ApplicationForm`, `ApplicationDetail`, `Partners`; serviços tenant atuais de candidaturas, participantes, tarefas, histórico e documentos.
- **Alterações mínimas:** completar os estados `IDENTIFICADO`, `INTERESSE`, `PREPARACAO`, `SUBMISSAO`, `APROVADO`, `REJEITADO`, `CANCELADO` em termos funcionais; campos de orçamento/notas e parceiros em falta; ligar upload/download à interface simples original. Manter arquivo e histórico atuais. Usar migrações aditivas apenas onde o esquema realmente não suporta o comportamento.
- **Dependências:** correspondência explícita com os estados atuais, sem reclassificação silenciosa de dados; responsáveis elegíveis; armazenamento/transferência documental protegidos disponíveis na composição ativa. O caminho produtivo de download precisa de ligação própria, não apenas da porta limitada a desenvolvimento.
- **Conclusão:** criação manual, pesquisa, edição, etapas, histórico, dois orçamentos, equipa, tarefas já aceites, parceiros/contactos e anexos funcionam na mesma candidatura. Recarregar conserva dados; outra entidade não lê nem altera registos ou ficheiros. Não exige qualificação avançada nem um construtor de pipelines.
- **Dimensão/confiança:** **G+ / média**. Maior lacuna funcional; depende de extensão de persistência e ligação documental efetiva.

### Entrega 4 — Administração, importações, fontes e alertas

**Resultado visível:** ADMIN mantém oportunidades comuns por fontes/importação; clientes consultam a mesma atualização; utilizadores recebem os alertas de acompanhamento do piloto.

- **Reutilizar:** `Integrations`, `Import`, `Notifications`, regras de classificação/notificação, parsers e conectores existentes; worker, catálogo, revisões, idempotência e histórico atuais.
- **Alterações mínimas:** recuperar os controlos originais sobre a recolha central, concluir paginação/cobertura da fonte prioritária e integrar as restantes fontes identificadas; importação Portugal 2030 para o catálogo comum pela autoridade de plataforma. Adaptar notificações à membership/participação e configurar o transporte já escolhido.
- **Dependências:** disponibilidade e configuração real de cada fornecedor. Funding & Tenders está atualmente limitado a cinco resultados/uma página; CORDIS/Erasmus reutilizam a mesma API com filtros; Interreg/POCTEP exigem reconferência dos endpoints/parsers. Nenhuma recolha ou chamada paga foi feita nesta análise.
- **Conclusão:** atualização central idempotente, resultado/histórico compreensíveis, importação com preview/erros, consulta pelos clientes sem duplicação por tenant; alertas privados com leitura e ligação útil; envio por email comprovado quando se declara esse canal operacional. Todas as fontes do inventário têm prova ou bloqueio individual explícito. Uma fonte ativa permite demonstrações intermédias, mas não prova recuperação de todas.
- **Dimensão/confiança:** **G+ / média-baixa** para o conjunto de conectores; **média** para a composição central e notificações. Dependências externas impedem prometer prazo sem verificação.

### Entrega 5 — Fechar a equivalência e demonstrar a aplicação completa

**Resultado visível:** abrir uma única aplicação C4G e percorrer o trabalho inteiro, com Dashboard, listagens e relatórios consistentes, sem áreas originais substituídas por «Em integração».

- **Reutilizar:** Dashboard/CSV e páginas recuperadas; testes de autoridade/isolamento e provas existentes, acrescentando apenas cobertura das alterações e lacunas.
- **Alterações mínimas:** concluir indicadores dependentes de estados/resultados, corrigir divergências demonstradas e afinar legibilidade/uso dentro da composição original. Sem funcionalidades novas.
- **Dependências:** entregas 1–4 e dados/configurações necessários para demonstrar cada percurso. Registos de ensaio ficam numa organização de teste identificada dentro da mesma plataforma, sem inventar equipa ou trabalho real da C4G.
- **Conclusão:** administrador de plataforma atualiza/consulta o catálogo; gestor gere a organização e o ciclo completo; pessoa com acesso usa o perfil/Matching; revisor e consulta respeitam as permissões existentes. Teste com duas organizações prova isolamento de listas, contagens, relatórios e documentos. Totais/exportações conferem com as candidaturas. Revisão lado a lado cobre todas as linhas do inventário, incluindo funcionalidades menos visíveis. Reinício e novo login mantêm dados e percursos. Falhas de configuração têm uma explicação e saída prática.
- **Dimensão/confiança:** **M / média**, dependente da evidência acumulada. A conclusão é paridade demonstrada no ambiente validado; não equivale automaticamente a validação em produção.

## 6. Limites técnicos e de âmbito

**Uma aplicação e uma fonte de verdade operacional:** continuar em `localhost:3000`, API 5000 e bases nativas já consolidadas, conforme a última prova existente. Não reativar a demonstração antiga como ambiente de trabalho. O commit do piloto serve de referência de código/capturas, não de instalação concorrente para introduzir dados.

**Fronteiras a preservar:** identidade/membership central; catálogo público recolhido uma vez; organização, pessoas, candidaturas, parceiros, tarefas e documentos no âmbito privado correto; credenciais nos serviços previstos; decisões de autorização no servidor. ADMIN da plataforma não se torna gestor de todas as entidades. Não voltar a consultas globais, eliminação em cascata ou uploads desprotegidos para acelerar a recuperação.

A ativação/desativação antiga em `backend/src/controllers/userController.js:114` e `:133` altera o utilizador global. Recuperar a gestão de acessos exige adaptar essa operação à membership da entidade; o gestor de uma organização não pode desativar a conta noutras.

**Evitar trabalho sem benefício imediato:** não criar outra API genérica de migração, outro framework de Dashboard, outro motor de Matching, pipelines configuráveis, scoring/ranking avançado, IA, novos domínios de perfil, overlays ou bundles editoriais. A publicação multidomínio e a qualificação avançada existentes não são condições para o Matching original nem para uma candidatura manual. Preservar os seus contratos; não contornar os seus controlos nem obrigar o utilizador a passar por esses percursos.

**Preservar sem ampliar:** tarefas, revisão documental, oportunidades privadas, filtros, correções de fontes, autenticação e restantes melhorias já construídas. A sua existência não justifica alargar a recuperação. Não apagar funcionalidades ou estruturas sem análise de dependências; retirar ferramentas avançadas do percurso principal é distinto de eliminar os seus dados/código.

Referências para estas fronteiras e lacunas: `backend/src/applications/contracts.js:11` e `backend/src/applications/repository.js:15` permitem candidatura manual sem avaliação; `backend/src/fundingTenders/http.js:30` separa leitura de plataforma; `backend/src/config/fundingTendersWorker.js:25` limita a recolha; `backend/src/routes/applicationSliceRoutes.js:8` e `backend/src/productionComposition.js:227` mostram a dependência documental; `backend/src/organizationDirectory/repository.js:63` delimita pessoas por organização. A composição genérica ainda importa rotas legacy em `backend/src/productionComposition.js:52`; a composição efetivamente disponibilizada deve continuar a impedir o seu uso indevido.

## 7. Como impedir novo desvio

- Uma matriz de equivalência, este plano e evidência curta por entrega. Aproveitar contratos existentes; registar apenas diferenças e critérios específicos necessários antes de implementar. Não abrir documentação extensa por componente reutilizado.
- Avaliar três coisas separadamente: **parece o piloto**, **faz o mesmo trabalho**, **respeita a organização e os acessos**. Nenhuma substitui as outras.
- Não declarar equivalência pela contagem de testes. Cada entrega exige o percurso no browser habitual, além de build, sintaxe e testes direcionados proporcionais às alterações. Alterações de tenancy, permissões, dados e documentos exigem verificação automatizada apropriada.
- Mostrar a comparação visual da primeira entrega antes de continuar a transformar páginas. As revisões são demonstrações do resultado concreto, não novos ciclos de definição do produto.
- Se uma fonte, email ou armazenamento não funcionar, registar o bloqueio específico e continuar o trabalho independente. Não mascarar indisponibilidade com dados sintéticos nem declarar a recuperação integral concluída.

## 8. Informação pendente e verificações realizadas

Não é necessária outra decisão sobre o produto para começar: a referência e a alteração desejada estão claras. A sequência acima é a proposta de execução. Para completar os dados reais, falta confirmar o organograma/pessoas/funções e quem deve ter conta/permissões. Um nome encontrado no site não autoriza inventar afetações ou criar acesso.

Na entrega das fontes, só será necessária decisão de negócio se uma integração original deixar de estar disponível ou exigir condições/custos diferentes: recuperar com essas condições, substituir por importação existente, ou aceitar explicitamente a diferença. Não se reduz silenciosamente o inventário. Eventual material de marca adicional é opcional; os ativos C4G existentes permitem começar.

**Verificado nesta análise:** instruções/contexto do projeto; skill `frontend-design` e ação de planeamento `code-hacks-ai:feature`; histórico/referência Git e diferenças de componentes; rotas/composição, controllers, contratos e esquema lógico implicado; configuração do coletor; três capturas já guardadas da navegação/perfil atuais. Revisão paralela da paridade funcional, visual e da reutilização segura.

**Não executado nesta análise:** aplicação histórica, nova sessão autenticada no browser, consultas à base, testes/build, recolhas externas, envio de notificações, migrations, seeds, alterações de dados, processos ou Git mutável. Os resultados anteriores de testes e demonstração são evidência histórica, não verificações repetidas nesta tarefa. A disponibilidade externa atual dos conectores e a configuração produtiva de documentos/email permanecem por provar.

Documentos existentes consultados: [comparação frontend UBI](../reviews/2026-10-17-frontend-ubi-referencia-recuperacao.md), [prova de acesso/navegação](../reviews/c4g-access-navigation/README.md), [consolidação local](../reviews/local-platform-consolidation/README.md), [diretório da organização](organization-directory-recovery.md), [plano de fecho anterior](c4g-app-closure-plan.md). O último descrevia o menu como 264 px; a folha `c4g-shell.css` sobrepõe 240 px. O problema visual observado é a recolha automática/reorganização e a densidade do conteúdo, não essa largura isolada.

**Próximo passo:** executar a entrega 1 a partir dos componentes originais e rever a comparação lado a lado no ambiente habitual antes de prosseguir para Organização/Pessoas/Matching.
