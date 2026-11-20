# Estratégia da organização e contributos dos departamentos

**Fase 1 em Review e ativa no ambiente habitual desde 11/11/2026.** As restantes fases continuam em proposta.

## Fase 1 — Perfil da organização e Pessoas

- No perfil existente, consultar e editar áreas estratégicas, interesses institucionais e objetivos com meta e prazo opcionais. A edição segue a capacidade de edição do diretório da organização. Os objetivos referenciam as áreas estratégicas selecionadas.
- Disponibilizar uma consulta de áreas temáticas a partir de Pessoas, reunindo as competências e os interesses declarados. Os filtros por área e departamento podem ser combinados, com paginação no servidor. A ficha da pessoa e o perfil pessoal usam um único seletor de áreas temáticas.
- Guardar a estratégia e os interesses pessoais no tenant, com controlo de revisão e idempotência do diretório. A migração é aditiva e os tenants anteriores continuam a funcionar durante a transição.
- A edição por departamento, a ligação de objetivos a oportunidades e o consumo da estratégia e dos interesses pelo Matching serão incrementos próprios.

### Entrega e validação da fase 1

- A estratégia usa a taxonomia temática do diretório para as áreas e os vínculos de cada objetivo. Os interesses institucionais são registados em texto. Os interesses das pessoas usam a mesma taxonomia e têm uma seleção própria na ficha pessoal.
- A migração aditiva `037_organization_strategy` tem instalação explícita pelo `createOrganizationStrategyMigrationRunner`, a partir do tenant `036_application_team_chat`. Com a versão anterior, o diretório continua disponível e já pode apresentar as competências existentes. A edição de estratégia e de interesses fica disponível nos tenants admitidos com a versão 037.
- PostgreSQL 18 descartável confirmou a migração canónica e o preflight, a gravação, a repetição idempotente, o conflito de revisão, a filtragem e a preservação dos interesses numa edição pelo contrato anterior. Foram verificadas consultas isoladas por organização.
- Chrome a 1440 e 390 px com API simulada confirmou a gravação da estratégia, o filtro por interesse e a atualização da tabela ao regressar da ficha da pessoa. Build, 944 testes frontend e 61 testes focados backend aprovados.
- Suite backend completa com 2917 aprovados, 7 ignorados e 8 falhas em `authoritySecuritySqlOptimization.test.js`, cuja simulação de dependências recusou `requestAdmissionScope`. A admissão de autoridade está fora do âmbito desta fase.

### Ativação no ambiente habitual

- Em 11/11/2026, o runner canónico aplicou `037_organization_strategy` sobre 036, após verificar a leitura integral da cópia de segurança. O preflight confirmou o fingerprint e o diretório Central publicou a revisão 8. Os ficheiros locais de runtime e de membros receberam o mesmo esquema.
- A API em execução reconhecia o novo contrato antes da migração. A aquisição imediata dos locks permitiu usar os processos já ativos. O endpoint de saúde confirmou a aplicação disponível antes e depois. As impressões digitais dos dados preexistentes da ficha da organização, pessoas, afiliações, perfis pessoais e unidades coincidiram antes e depois.
- Chrome com sessão OIDC real de **Administrador do cliente**, a 1440 e 390 px, confirmou o editor da estratégia, a adição e o cancelamento de um objetivo em edição, as colunas **Competências** e **Áreas de interesse**, a filtragem por interesse e o acesso à edição na ficha da pessoa. A verificação de interface foi em leitura e cancelamento, com zero gravações de dados de negócio.

### Consulta de competências e interesses

- A tabela principal de Pessoas apresenta pessoa, função, departamentos / unidades, estado e ações. O botão **Áreas temáticas** abre uma janela ampla com uma linha por pessoa, identificada pelo nome e email. A coluna **Áreas temáticas** reúne competências e interesses e apresenta uma única vez cada área da taxonomia por pessoa.
- A janela usa a seleção e a paginação da lista de Pessoas, incluindo **Mais pessoas** quando há outra página. Apresenta **Por indicar** para áreas por preencher e mantém disponíveis as competências nos tenants cujo contrato ainda não inclui interesses. A consulta segue as permissões do diretório.
- Em ecrãs estreitos, a lista de áreas aparece abaixo do nome e email. A janela permite deslocar os resultados sem perder acesso ao botão de fecho, fecha com Escape e devolve o foco ao botão que a abriu.
- Validação da janela: build Vite e 947 testes frontend aprovados. Chrome com API simulada a 1440, 820, 390 e 320 px confirmou a coluna única sem duplicados, listas de 30 áreas sem overflow horizontal, deslocamento interno, fecho com retorno do foco e paginação com o filtro de interesse aplicado.

### Seleção de áreas temáticas na ficha

- Mostrar cada opção da taxonomia uma única vez. As áreas já registadas como competências ou interesses aparecem selecionadas.
- Ao guardar, preservar a classificação das áreas mantidas, remover as áreas desmarcadas dos campos em que estavam registadas e guardar as novas seleções no campo de áreas usado pelo Matching.
- A mesma edição está disponível na ficha da pessoa e no perfil pessoal, conforme as permissões existentes. Tenants com a versão anterior continuam a guardar as áreas pelo contrato que suportam.
- Build Vite e 947 testes frontend aprovados. Chrome com API simulada confirmou a grelha única de 30 opções, o estado inicial das seleções e a gravação na ficha da pessoa. O perfil pessoal mostrou as alterações após nova leitura. A ficha foi verificada a 1440, 390 e 320 px.

### Editor de estratégia em janela modal

- **Editar estratégia** abre uma janela modal no Perfil da organização. As áreas, os interesses e os objetivos permanecem no mesmo formulário e são guardados em conjunto.
- O administrador pode adicionar e remover objetivos, consultar mensagens de validação e guardar a estratégia na janela. Cancelar ou fechar descarta o rascunho local e devolve o foco ao botão **Editar estratégia**. Em ecrãs estreitos, o formulário desloca-se dentro da janela.

### Alinhamento das candidaturas em preparação

- O separador **Gráficos** do Dashboard do Admin da entidade mostra quantas candidaturas **Em preparação** correspondem a cada objetivo. A correspondência é automática: o classificador temático do Matching compara os dados da oportunidade com as áreas configuradas no objetivo. Usa a revisão congelada para candidaturas do Catálogo e a revisão atual para oportunidades privadas.
- O **Índice de alinhamento** divide o número de candidaturas em preparação que correspondem a pelo menos um objetivo pelo total acessível em preparação. Uma candidatura pode aparecer em vários objetivos e entra no numerador uma única vez. O índice mede alinhamento temático. A taxa de aprovação e o cumprimento das metas têm critérios próprios.
- O gráfico apresenta também as candidaturas sem correspondência. Cada resultado abre a lista de candidaturas com ligação à respetiva ficha e as áreas que justificam a correspondência. Objetivos sem áreas são identificados. Com zero candidaturas ou sem objetivos com áreas, o índice fica por calcular. A leitura avalia até 1.000 candidaturas, tal como o Matching, e indica indisponibilidade se exceder o limite de contagem ou de tamanho da resposta.
- A API entrega o gráfico apenas a um Admin da entidade com leitura autorizada da estratégia e das candidaturas. Tenants sem a estratégia continuam a receber os restantes indicadores.

#### Validação do editor modal e do alinhamento

- Chromium com API simulada a 1440, 390 e 320 px. Confirmados o deslocamento interno, o foco no novo objetivo, o fecho com Escape e retorno ao botão, a gravação e a abertura das candidaturas de um objetivo com a respetiva área temática.
- PostgreSQL 18 descartável com dados fictícios confirmou a seleção por entidade, autorização de candidatura e estado, a revisão privada atual, a revisão congelada do Catálogo e a contagem única de uma candidatura ligada a dois objetivos.
- Build Vite aprovado. Suite frontend com 953 testes aprovados. Suite backend com 2930 aprovados e 7 ignorados, seguida de verificação focada do relatório e da consulta SQL.
- Em 11/11/2026, confirmação no ambiente habitual com sessão OIDC de Admin da entidade (`ORG_ADMIN`), em Chromium a 1440 e 390 px. O modal abriu, a adição em rascunho focou o novo objetivo e Escape devolveu o foco ao botão. O Dashboard devolveu HTTP 200 e o total de 1 candidatura em preparação coincidiu com a lista filtrada. A organização tinha zero objetivos configurados, pelo que o painel apresentou o estado de configuração em falta. A distribuição por objetivo foi validada com os dados fictícios descritos acima. A verificação habitual foi feita em consulta.

### Ligação da candidatura a objetivos (18/11/2026, em Review)

Decisões do utilizador em 18/11/2026: guardar a ligação na estratégia já existente, sem migração nova; a ligação manual soma-se à correspondência automática; uma candidatura pode apoiar vários objetivos.

- No **Resumo** da ficha da candidatura, a secção **Objetivos estratégicos** lista os objetivos da organização. Quem pode editar a estratégia (edição do diretório, hoje o Admin da entidade) marca os que a candidatura apoia e guarda. Quem só consulta o diretório vê os objetivos já ligados. Sem acesso ao diretório, sem estratégia no tenant ou sem nada para mostrar, a secção fica oculta.
- Cada objetivo da estratégia guarda `applicationIds` (até 200 candidaturas). A gravação usa `PUT /organization-directory/strategy`, com a revisão esperada e idempotência do diretório. Um pedido que omita `applicationIds` num objetivo conserva as ligações já guardadas, pelo que o editor da estratégia e clientes anteriores continuam a funcionar.
- No Dashboard, uma candidatura em preparação conta para um objetivo quando há correspondência temática ou ligação manual, e entra uma única vez no índice. A lista de cada objetivo identifica a **Ligação manual**. Um objetivo sem áreas mas com candidaturas ligadas passa a ter contagem. Identificadores de candidaturas fora da população autorizada em preparação ficam sem efeito.
- Limites conhecidos: a ligação segue a permissão de edição da estratégia e não a de edição da candidatura; remover um objetivo remove as suas ligações; o histórico da candidatura não regista a ligação (fica a auditoria `ORGANIZATION_CARD_CHANGED`).

Critérios de aceitação:

1. Um Admin da entidade liga uma candidatura a dois objetivos na ficha e, ao reabrir, encontra ambos marcados.
2. A candidatura ligada aparece em cada um desses objetivos no painel, com **Ligação manual**, e conta uma vez no índice, mesmo sem correspondência temática.
3. Desmarcar um objetivo retira apenas essa candidatura e mantém as restantes ligações do objetivo.
4. Editar a estratégia no Perfil da organização preserva as ligações existentes.
5. Um utilizador sem edição do diretório não vê controlos de ligação e o servidor recusa o pedido.
6. Se a estratégia mudar entretanto, a gravação é recusada por revisão e a secção relê os dados.

Validação: 23 testes backend focados e 59 frontend focados aprovados; lint e build aprovados; suite frontend com 1159 aprovados; suite backend com 3540 aprovados, 9 ignorados e 1 falha alheia (SEC-AC-01 recusa o `sessionStorage` em `DirectLogin.jsx`, ficheiro não alterado aqui). O gate isolado `test/integration/partner-portal` fixa o hash de `strategyAlignment.js` em `sources.json` e precisa de o atualizar antes de voltar a correr. Sem PostgreSQL real, sem browser e sem alteração no staging.

### Perfil do departamento (18/11/2026, em Review)

Decisões do utilizador em 18/11/2026: a entidade tem a estratégia; cada departamento tem o seu perfil de interesses e pode ter objetivos e metas próprios, ligados aos objetivos estratégicos; o Técnico insere-se no departamento. O departamento tem de estar nas áreas estratégicas mas pode escolher outras, e a entidade adapta-se depois. A ligação a um objetivo estratégico é opcional ao criar. Nesta versão editam o Administrador e o Gestor. Sem migração: o perfil fica na estratégia existente.

Entrega 1, implementada:

- Em **Departamentos / Unidades**, a ação **Perfil** abre o perfil do departamento: áreas de interesse, escolhidas na taxonomia temática, e objetivos com nome, meta ou indicador, prazo, áreas (entre as do departamento) e objetivos estratégicos da entidade que apoia.
- Quando a entidade tem áreas estratégicas, um departamento com áreas tem de incluir pelo menos uma delas. As restantes ficam assinaladas como fora da estratégia da entidade e são conservadas.
- Um objetivo de departamento sem objetivo estratégico associado é aceite e identificado como sem ligação.
- `PUT /organization-directory/units/:id/profile` recebe `areaIds`, `objectives`, `expectedRevision` (revisão da ficha da organização) e `idempotencyKey`. Exige edição do diretório e um departamento ativo da organização da sessão. O perfil é guardado em `strategy.units[<id do departamento>]`, até 20 objetivos por departamento.
- Editar a estratégia da entidade conserva os perfis dos departamentos. Retirar um objetivo estratégico retira as ligações que lhe apontavam; retirar uma área estratégica não altera as áreas dos departamentos.
- Quem só consulta o diretório abre o perfil em leitura.

Entregas seguintes, por implementar: vista da entidade com os contributos por objetivo, os objetivos de departamento sem ligação e as áreas propostas pelos departamentos; contexto do departamento no dashboard e no perfil pessoal do Técnico. Fora de âmbito por agora: responsável de departamento com edição própria, restrição de acesso por departamento e medição de progresso das metas.

Critérios de aceitação da entrega 1:

1. Um Administrador ou Gestor guarda áreas e objetivos de um departamento e encontra-os ao reabrir.
2. Com áreas estratégicas definidas, guardar um departamento só com áreas fora da estratégia é recusado com explicação; com pelo menos uma estratégica é aceite e as outras ficam assinaladas.
3. Um objetivo de departamento pode ficar sem ligação ou ligado a vários objetivos estratégicos; ligações a objetivos inexistentes são recusadas.
4. Editar a estratégia da entidade não apaga perfis de departamento e limpa apenas ligações a objetivos removidos.
5. Um departamento arquivado ou de outra organização é recusado; um utilizador sem edição do diretório não consegue gravar.
6. Uma gravação sobre uma revisão antiga é recusada e pede nova leitura.

Validação da entrega 1: backend focado 14 aprovados; suite backend 3543 aprovados, 9 ignorados e 1 falha alheia (SEC-AC-01, `DirectLogin.jsx`); frontend 1164 aprovados em 130 ficheiros; lint e build aprovados. Sem PostgreSQL real, sem browser e sem alteração no staging.

Entregas 2 e 3 (18/11/2026, em Review), a pedido do utilizador:

- **Vista da entidade.** No Perfil da organização, a secção **Contributos dos departamentos** mostra, por objetivo estratégico, os objetivos dos departamentos ativos que o apoiam; lista os objetivos de departamento sem ligação; e apresenta as áreas escolhidas por departamentos que a entidade ainda não tem, com os departamentos de cada uma. Quem edita a estratégia pode **adotar** uma dessas áreas, o que a acrescenta às áreas estratégicas pela edição normal da estratégia. A secção só aparece quando algum departamento ativo tem perfil e o utilizador pode consultar os departamentos.
- **Contexto do Técnico.** A leitura do perfil pessoal (`GET /organization-directory/me`) e a da ficha da pessoa acrescentam `departments`: para cada departamento ativo da pessoa, as áreas do departamento e os seus objetivos, com o título dos objetivos estratégicos que cada um apoia. O Dashboard do Técnico mostra **Os objetivos dos meus departamentos** e o Perfil pessoal mostra a mesma informação. Sem pessoa associada à conta, sem departamento ou sem perfil preenchido, a secção fica oculta.
- A leitura pessoal passa a expor ao próprio os títulos dos objetivos estratégicos apoiados pelos seus departamentos; os restantes dados da estratégia continuam reservados a quem consulta o diretório. No dashboard é um pedido adicional, feito depois do pedido principal.

Critérios de aceitação das entregas 2 e 3:

1. Um objetivo de departamento ligado a dois objetivos estratégicos aparece em ambos; sem ligação, aparece na lista própria.
2. Uma área escolhida por dois departamentos e ausente da estratégia aparece uma vez, com os dois departamentos; depois de adotada, deixa de aparecer como proposta.
3. Perfis de departamentos arquivados não entram na vista da entidade nem no contexto do Técnico.
4. O Técnico vê os objetivos, metas e áreas dos seus departamentos no dashboard e no perfil pessoal, sem controlos de edição.
5. Uma falha na leitura do contexto não afeta o resto do dashboard.

Validação das entregas 2 e 3: suite backend 3544 aprovados, 9 ignorados e 1 falha alheia (SEC-AC-01, `DirectLogin.jsx`); frontend 1167 aprovados em 131 ficheiros; lint e build aprovados. Sem PostgreSQL real, sem browser e sem alteração no staging.

## Objetivo

Dar à organização uma base para decidir que oportunidades de financiamento procurar, que departamentos mobilizar e que pessoas envolver. A organização define a estratégia. Os departamentos contribuem para a executar e reúnem pessoas com competências e interesses próprios.

A funcionalidade é uma evolução incremental do produto. O desenvolvimento em curso pode avançar em paralelo. Cada organização pode preencher a estratégia e os objetivos departamentais ao seu ritmo. O diretório, o Matching e os fluxos de candidatura continuam disponíveis com os dados existentes enquanto a informação adicional estiver por preencher.

## Modelo funcional

| Conceito | Informação a gerir |
| --- | --- |
| Área estratégica | Tema de atuação prioritário da organização. |
| Interesse institucional | Tema ou linha de trabalho que a organização quer explorar, ligado às áreas estratégicas relevantes quando aplicável. |
| Objetivo da organização | Resultado pretendido, áreas relevantes, meta ou indicador e prazo quando definidos. É registado uma vez ao nível da organização. |
| Objetivo do departamento | Resultado ou trabalho esperado do departamento, mantido pelo respetivo responsável e associado ao objetivo da organização para o qual contribui. |
| Pessoa | Afiliações ao diretório e duas informações temáticas distintas. As competências descrevem o que a pessoa sabe fazer. Os interesses descrevem onde quer participar ou desenvolver-se. |

Um objetivo pode ter contributos de vários departamentos. Cada departamento pode contribuir para vários objetivos. Uma pessoa pode integrar vários departamentos, com uma unidade principal conforme o diretório atual. A associação de uma pessoa a um departamento permite encontrá-la na respetiva equipa. A participação num objetivo ou numa candidatura requer uma atribuição explícita.

## Experiência do Admin Cliente

- **Perfil da organização.** Consultar e gerir áreas, interesses institucionais e objetivos. Abrir um objetivo para ver os departamentos associados e o contributo de cada um. O Perfil pessoal continua acessível no menu da conta.
- **Departamentos / Unidades.** Consultar os objetivos departamentais, os objetivos da organização a que estão ligados e a respetiva lista de pessoas. O responsável pode atualizar os objetivos do seu departamento e os respetivos contributos. Usar as unidades existentes, incluindo a designação adequada a cada organização.
- **Pessoas.** Apresentar as afiliações autorizadas na tabela do diretório e disponibilizar numa janela ampla uma coluna **Áreas temáticas** com as competências e os interesses de cada pessoa. Permitir pesquisar e filtrar por departamento, área e tipo de associação à área. Mostrar uma linha por pessoa e indicar quando a pessoa não tem áreas registadas.
- **Da oportunidade à candidatura.** Quando a organização regista interesse numa oportunidade, permitir associá-la explicitamente ao objetivo que pode apoiar. Se avançar para candidatura, a ligação permite consultar a oportunidade e a candidatura a partir do objetivo.

## Utilização pelo Matching

1. **Alinhamento institucional.** Indicar que áreas, interesses institucionais e objetivos em vigor correspondem à oportunidade. Um objetivo é apresentado como potencialmente apoiado quando a relação é temática. O cumprimento depende dos resultados registados pela organização.
2. **Mobilização interna.** Mostrar os departamentos com contributos para os objetivos identificados. Para cada pessoa sugerida, indicar a área que corresponde, o departamento relevante e se a sugestão se baseia numa competência, num interesse ou em ambos. Pessoas diretamente afetas à organização podem aparecer na vista institucional. Pessoas com várias afiliações surgem uma vez por resultado, com o contexto das unidades relevantes.
3. **Pré-qualificação.** Avaliar os critérios e as evidências pelo contrato aplicável. A correspondência temática, um interesse declarado ou a mera afiliação a um departamento são sinais para seleção e mobilização. Uma competência verificada exige a validação aplicável.

O alinhamento estratégico e a mobilização interna enriquecem as sugestões quando houver dados. Se faltarem objetivos, contributos ou interesses, o Matching apresenta as correspondências que consegue explicar a partir dos dados disponíveis.

Por exemplo, o objetivo «Lançar dois pilotos de saúde digital até 2027» recebe um contributo de Informática para a integração de dados e outro de Saúde para a validação clínica. Numa oportunidade de telemonitorização, o Admin vê o objetivo, os dois contributos e pessoas sugeridas pela experiência relevante ou pelo interesse declarado. A atribuição é feita por uma pessoa autorizada.

## Reutilização e decisões abertas

- Reutilizar os IDs das unidades, as afiliações, o filtro temático paginado e as permissões existentes. O perfil de Admin Cliente na interface é um rótulo. Consulta, edição e atribuição requerem as capacidades correspondentes no servidor e ficam limitadas à organização atual.
- A autorização para atualizar objetivos departamentais está limitada ao responsável designado para o departamento em causa. O servidor confirma a designação no departamento e na organização da sessão. A edição da estratégia institucional segue as permissões próprias da organização.
- Reutilizar o contrato F13 para áreas e prioridades institucionais onde a semântica coincide. Confirmar o mapeamento entre as referências editoriais F13 e a taxonomia usada pelo diretório e pelo Matching atual. Manter o significado e as referências das áreas pessoais existentes. Um interesse pessoal tem de ser registado como tal.
- A ligação a um objetivo referencia uma unidade existente. O consumo de perfis pela F14 continua a seguir o contrato aprovado de versões e ativação, incluindo a composição explícita por âmbito quando aplicável.
- Definir, na entrega que incluir a edição departamental, como é registada a designação do responsável. O acompanhamento detalhado do progresso pode ser acrescentado numa entrega posterior.

## Critérios de aceitação propostos

1. Um Admin autorizado consegue consultar e gerir a estratégia institucional e consultar os contributos de dois departamentos ligados ao mesmo objetivo. O objetivo e cada departamento apresentam a relação coerentemente.
2. O filtro por departamento e área distingue competências de interesses. Uma pessoa com duas afiliações aparece uma vez na lista geral e pode ser encontrada por ambas as unidades. A filtragem é aplicada antes da paginação.
3. As áreas pessoais já registadas continuam disponíveis. A edição de um interesse pessoal só altera o respetivo sinal. Um utilizador sem capacidade de edição pode apenas consultar os dados para os quais tem permissão.
4. Um resultado de Matching identifica as referências que justificam o alinhamento, os departamentos associados e o motivo de sugestão das pessoas. A decisão de atribuir alguém ou avançar com uma candidatura permanece explícita.
5. Uma oportunidade associada a um objetivo é consultável a partir deste, incluindo a candidatura quando existir. Referências entre organizações são recusadas e o histórico permanece consultável após arquivo, conforme as permissões.
6. O responsável designado consegue atualizar os objetivos e contributos do seu departamento. Pedidos de edição de outros utilizadores ou relativos a outro departamento são recusados, salvo se o utilizador for também responsável por esse departamento.
7. Uma organização sem estratégia preenchida continua a consultar Pessoas, obter correspondências do Matching com os dados já existentes e seguir o fluxo de candidatura habitual.

## Referências

- [Diretório de departamentos e unidades](organization-units-client-root.md) e [filtro temático de Pessoas](organization-people-area-filter.md).
- [Perfil organizacional F13](f13-organizational-profile.md) e [âmbito e composição do perfil](../decisions/f13-organizational-profile-scope-and-inheritance.md).
- [Matching e Qualificação](matching-and-qualification.md) e [interesse da organização numa oportunidade](organizational-opportunity-interest.md).
