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
