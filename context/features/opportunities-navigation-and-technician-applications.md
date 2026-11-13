# Oportunidades, Interesses e Candidaturas: navegação e Técnico

Estado: In Progress (12/11/2026). Pedido do utilizador em sessão, depois de analisar o staging. Respostas do utilizador às perguntas de produto registadas abaixo.

## Pedido

1. O **Catálogo C4G** passa a chamar-se **Oportunidades** (sem «C4G»). Na página Oportunidades há um botão **Interesses**, ao lado de **Candidaturas**. Na tabela há um botão para **iniciar a candidatura**.
2. O perfil **Técnico** pode iniciar candidatura a partir dos interesses, como o Admin Cliente.
3. **Interesses** passa a entrada própria da barra lateral, por baixo de Oportunidades, e deixa de ser separador dentro de Candidaturas. Cadeia: Oportunidades → Interesses → Candidaturas.
4. A página **Parceiros** deixa de existir para o perfil Técnico.

## Decisões do utilizador (12/11/2026)

- Técnico: **recebe as permissões** `opportunity_interest.manage`, `application.create` e `opportunity.read`. Reverte a decisão de [organizational-opportunity-interest.md](organizational-opportunity-interest.md) («não usar `application.create` para técnicos») e o teste `applicationInterestContracts.test.js` que a fixava.
- Navegação: barra lateral **e** botões nas páginas (Oportunidades e Interesses).
- Endereço: mantém-se `/catalogo`; só muda o texto visível.
- Botão **Iniciar candidatura** numa oportunidade sem interesse registado: abre o formulário de candidatura **diretamente, sem interesse associado** (o backend já aceita criação sem `sourceInterestId`). Com interesse ativo, a ação usa o interesse, como no percurso atual.

## Critérios de aceitação

- Texto «Catálogo C4G» substituído por «Oportunidades» na barra lateral, título de página, pesquisa de páginas e botões. O rótulo de origem «Catálogo C4G» nos resultados de Matching fica por decidir (não alterado).
- Barra lateral da entidade: Oportunidades, Interesses, Candidaturas. Sem Interesses para a Administração C4G sem entidade.
- `/interesses` abre a lista sem separadores de Candidaturas; `/candidaturas?ver=interesses` (ligações antigas) redireciona para `/interesses` conservando os filtros.
- Oportunidades: botões **Interesses** e **Candidaturas** no cabeçalho. Interesses: botão **Oportunidades**. Candidaturas: **Nova candidatura** leva às Oportunidades.
- Tabela de Oportunidades: **Iniciar candidatura** só com a capacidade `canCreateApplication` da organização e oportunidade não arquivada; consulta a revisão atual antes de abrir o formulário; sem gravação.
- Técnico: sem entrada Parceiros na barra lateral nem na pesquisa de páginas; `/parceiros` redireciona para o início. Outros perfis inalterados. **A decisão é do backend (ver «Decisão no backend»)**; o frontend só segue a lista de navegação.
- Permissões do Técnico concedidas por `grantsForProfile`. Os Técnicos **já existentes** só as recebem ao repetir a atribuição do perfil; fazê-lo em bases reais exige autorização própria.

## Validação prevista

Regressões frontend antes da implementação; teste backend atualizado; `npm run lint`, suites completas e build. Verificação visual em Chrome com API simulada a 1440/390 px. Nada aplicado a bases habituais nem à VPS.

## Resultado (12/11/2026)

Implementados os pontos 1, 3 e 4 no frontend e as permissões do ponto 2 no backend.

- Frontend: «Oportunidades» na barra lateral, título e pesquisa; entrada «Interesses» abaixo; botões Interesses/Candidaturas em Oportunidades e Oportunidades/Candidaturas em Interesses; `ApplicationAreaNav` deixou de ser usado; `/candidaturas?ver=interesses` redireciona para `/interesses`; «Nova candidatura» leva a `/catalogo`; «Iniciar candidatura» na tabela (consulta a revisão atual, sem interesse associado); Parceiros oculto ao Técnico (barra, pesquisa e `/parceiros` redireciona para o início).
- Backend: `grantsForProfile` dá ao Técnico `opportunity_interest.manage`, `opportunity.read` e `application.create`. Teste `applicationInterestContracts.test.js` atualizado (falhava antes da alteração).
- Validação: lint limpo; frontend 1007 aprovados e build; backend 3156 aprovados, 9 ignorados, 0 falhas. Sem browser, sem PostgreSQL real, nada aplicado a bases.

## Visibilidade do Técnico: criador entra na equipa (12/11/2026)

Decisão do utilizador: o criador de uma candidatura entra na equipa. Corrige a lacuna encontrada na primeira entrega (a leitura do Técnico é limitada às equipas em que participa).

- **Permissões do Técnico revistas:** `opportunity.read` deixou de ser concedido (daria leitura de oportunidades individuais a toda a organização). Ficam `opportunity_interest.manage` e `application.create`.
- **Leitura de oportunidades:** em `teamAccess.js`, `OPPORTUNITY_READ` ao nível da organização (lista e capacidades) passa a derivar-se também para o Técnico com `application.create` de âmbito organização. Oportunidades individuais continuam limitadas às equipas.
- **Criador na equipa:** `createApplicationRepository` recebe `creatorJoinsTeam`; a composição devolve verdadeiro quando o perfil atual é `CONTRIBUTOR`. Na criação, o criador é inserido como participante (`interestLink.addTeam`, revisões consecutivas a partir de 2), sem exigir `APPLICATION_WORK_EDIT` nem gerar evento de auditoria adicional (cobre-o `APPLICATION_CREATED` e a linha `PARTICIPANT_ADDED` com o autor). Se o responsável pedido explicitamente for outra pessoa, ambos entram; se for a mesma, entra uma vez. Outros perfis não mudam.
- **Provas:** testes novos em `applicationInterestLink.test.js` (4 cenários de equipa) e `applicationTeamAccess.test.js` (leitura ao nível da organização, sem abrir oportunidades individuais, âmbitos inválidos recusados); falharam antes e passam depois. Backend 3160 aprovados, 9 ignorados, 0 falhas; lint limpo.
- **Prova em PostgreSQL descartável (12/11/2026):** [proof.js](../../test/integration/application-creator-team/proof.js) em PostgreSQL 18.3 nativo, instância temporária em loopback (porta 5597, UTC, ICU `und`), removida no fim. Esquema tenant completo pelo runner registado, login limitado de runtime com `SET LOCAL ROLE` e RLS, repositório real de candidaturas. 5 controlos PASS: o Técnico criador entra na equipa (participante ativo, `application_work` revisão 2, `PARTICIPANT_ADDED` com o autor); responsável explícito mais criador com revisões 2 e 3 e a mesma pessoa uma só vez; criador não Técnico não adiciona ninguém; outra organização não vê nem escreve as linhas (RLS); falha depois das linhas da equipa reverte candidatura e equipa. Primeiras tentativas falharam por configuração do ambiente (fuso horário do Windows diferente de UTC; papel de runtime sem `SET ROLE`), corrigidas no harness. Autorização e auditoria simuladas: não prova o gate de autoridade, o HTTP nem a derivação em `teamAccess` (essa tem testes unitários). Bases habituais não tocadas.
- **Não provado:** o percurso Técnico → botão → formulário → candidatura visível de ponta a ponta (HTTP/browser com autoridade real). A lista de responsáveis do formulário para o Técnico também não foi verificada.
- **Por fazer em bases reais (com autorização):** os Técnicos existentes só recebem as permissões novas ao repetir a atribuição do perfil (staging: comando `person`).

## Correção após o ensaio em staging (12/11/2026)

No staging (release `6a8f6d6`), com a conta de Técnico e as permissões já gravadas (`application.create`, `opportunity_interest.manage`), nem a tabela de Oportunidades nem a lista de Interesses mostravam «Iniciar candidatura». Causa: `canCreateApplication` é calculado no módulo de interesses (`opportunityInterests/composition.js`), cujo autorizador não tinha a regra de equipa; `OPPORTUNITY_READ` ao nível da organização exigia `opportunity.read`, que o Técnico deliberadamente não tem. Os testes anteriores só cobriam o autorizador de candidaturas.

Correção: a derivação passou a uma função pura, `applicantOpportunityReadPolicy` (`applications/teamAccess.js`), usada pelo autorizador de candidaturas (sem alterar o comportamento) e agora também pelo de interesses. Só concede, por pedido, a leitura de `OPPORTUNITY_READ` na raiz da organização a um Técnico humano com `application.create` de âmbito organização. Testes novos em `applicationTeamAccess.test.js` (derivação e ligação); lint e backend verdes. Por validar em staging após nova implantação.

### Segunda correção (12/11/2026)

Após a primeira correção, a lista de Interesses passou a mostrar «Preparar candidatura» ao Técnico, mas a tabela de Oportunidades continuava sem «Iniciar candidatura». Causa: `summaries` devolvia só `capabilities.canRegister`, e a tabela lê `canCreateApplication` dessa mesma resposta. `summaries` passa a devolver as quatro capacidades (`capabilities()`), com teste em `opportunityInterestsRepository.test.js` e no catálogo. Também: botões do cabeçalho de Interesses/Candidaturas agrupados à direita (`.application-area-actions`) e «Catálogo» passa a «Oportunidades» no percurso (breadcrumb). Lint, frontend 1008 e backend 3163 aprovados; por validar em staging.

## Matching do Técnico só com o catálogo (13/11/2026)

Achado em staging: o Matching por pessoa dava 503 ao Técnico e funcionava ao Administrador da entidade. O Matching lê o catálogo e as oportunidades privadas da organização; a segunda leitura exige `opportunity.read`, que o Técnico não tem. Decisão do utilizador: o Técnico é comparado só com o catálogo; as privadas ficam de fora, sem alargar permissões; a página deixa de dar erro e avisa.

- `createOrganizationMatching` consulta `directory.canReadPrivateOpportunities(request)`. Falso: não lê as privadas e devolve `privateIncluded:false`; verdadeiro, ou serviço sem esse método: comportamento anterior (`privateIncluded:true`). Uma falha da consulta recusa o pedido (fecha em falha). Matching por oportunidade não muda.
- `organizationDirectory/composition.js` implementa-o com a sessão autenticada e o registo central de autoridade: só `CONTRIBUTOR` devolve falso.
- A página mostra, quando `privateIncluded===false`, a nota «Nesta consulta foram consideradas apenas as oportunidades do catálogo…».
- Provas: testes em `organizationMatching.test.js` e `MatchingWorkspace.test.jsx` (falharam antes). Lint, frontend 1009 e backend 3164 aprovados; build ok. **Não provado:** a implementação em `composition.js` com a autoridade real (só `node --check` e o uso do mesmo padrão de resolução do resto do módulo); por validar em staging com a conta de Técnico.

## Decisão no backend: Parceiros (13/11/2026)

Princípio do utilizador: as decisões de acesso ficam no backend; o frontend não leva regras por perfil. A primeira versão do ponto 4 escondia Parceiros no frontend por `profileCode`; foi substituída.

- `navigationFor(profileCode)` (`organizationDirectory/accessProfiles.js`) é a única política: `{partners:false}` para `CONTRIBUTOR`, `{partners:true}` para os outros perfis conhecidos, `null` para desconhecidos.
- A resposta de sessão da organização (`organizationAuthController.publicOrganization`) passa a incluir `navigation`, só de apresentação.
- A lista de parceiros entre candidaturas (`partnersBrowse`, `GET /api/applications/partners`) recusa com `NOT_AUTHORIZED` quando a política o nega, depois do guarda de autoridade e antes de qualquer leitura (`browseAllowed` em `partners.js`, ligado em `applications/composition.js` ao perfil atual do registo central). Os parceiros dentro de cada candidatura continuam a depender da equipa.
- Frontend (`Sidebar`, `Header`, `App`): esconde Parceiros e redireciona `/parceiros` apenas quando `organization.navigation.partners === false`; sem `profileCode`. Ausência da lista (sessão antiga) mostra a entrada.
- Provas: testes novos em `partnerBrowseBoundary`, `applicationInterestContracts` (política) e `f3MembershipContext` (sessão), todos falharam antes; teste de navegação do frontend. Lint, frontend 1009, backend 3166 aprovados, build ok. **Não provado em staging nem contra PostgreSQL**: a recusa na API e a leitura do perfil atual usam o mesmo padrão de `creatorJoinsTeam`.
- Não alterado, por não ter sido pedido: `profileCode` do Calendário (`ORG_ADMIN`) e do Dashboard do Técnico, que já existiam no frontend.

### Calendário e Dashboard no backend (13/11/2026)

A lista de navegação do backend passa a cobrir as duas regras por perfil que ainda estavam no frontend. `navigationFor(profileCode)` devolve `{ partners, calendar, dashboard }`: `partners` falso só para o Técnico; `calendar` verdadeiro só para `ORG_ADMIN`; `dashboard` `'TECHNICIAN'` para o Técnico e `'ORGANIZATION'` para os outros.

- Backend: o endpoint do calendário (`applications/composition.js`) usa a mesma política em vez de comparar o perfil, por isso o que o cliente oferece e o que o servidor aceita deixam de poder divergir.
- Frontend: Sidebar, pesquisa de páginas e rota `/calendario` seguem `organization.navigation.calendar === true` (ausente ou falso: sem Calendário); o Dashboard escolhe a variante por `organization.navigation.dashboard` (`utils/dashboardVariant.js`). Já não existe `profileCode` em nenhuma decisão de apresentação do frontend; só as telas de gestão de acessos (`OrganizationAccess`, `EntityUsers`) o mostram e escolhem, como dados.
- Provas: testes de política e de sessão atualizados (falhavam antes), teste da barra lateral e do auxiliar do Dashboard. Lint limpo, frontend 1011, backend 3177 aprovados, build ok. Por validar em staging: sessões abertas antes da implantação não têm a lista e deixam de mostrar o Calendário e o Dashboard do Técnico até ao novo login.
