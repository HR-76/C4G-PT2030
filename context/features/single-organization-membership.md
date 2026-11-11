# Uma conta de entidade, uma entidade

Estado: **Review — implementação e validação local concluídas em 26/10/2026**.

## Objetivo

Alinhar o acesso com o modelo comercial da C4G: a C4G é proprietária e administradora da plataforma; cada cliente é uma entidade isolada; uma conta operacional de entidade pertence a uma única entidade e recebe nessa entidade um perfil interno.

## Regras confirmadas

- Uma identidade C4G pode ter atribuições de administração da plataforma sem membership de entidade.
- Uma conta de entidade pode conservar memberships `REMOVED` como histórico, mas não pode ter simultaneamente mais de uma membership não removida, mesmo que uma esteja pendente ou suspensa.
- Os perfis `ORG_ADMIN`, `FUNDING_MANAGER` e `CONTRIBUTOR` só definem autoridade dentro da única entidade da conta.
- A Administração C4G gere os clientes na área de plataforma; não escolhe nem assume uma entidade através do cabeçalho operacional.
- A entidade da sessão é resolvida pelo servidor a partir da única membership elegível. O cliente não escolhe entre entidades.
- Uma mudança de entidade exige terminar explicitamente o vínculo anterior e criar o novo, preservando o histórico; não existe transferência implícita.

## Alterações

1. Substituir no cabeçalho o seletor por um contexto textual da entidade atual.
2. Manter o contexto de Administração C4G quando a conta tem apenas papel de plataforma e nenhuma entidade.
3. Impedir na Central mais de uma membership não removida por `global_user_id`, incluindo `PENDING_PROJECTION`, `ACTIVE` e `SUSPENDED`.
4. Recusar a preparação de um utilizador para outra entidade com um conflito funcional explícito antes de efeitos externos sempre que a identidade já seja conhecida.
5. Atualizar a visão do produto e a arquitetura, retirando a seleção de organização e os contratos que apresentam múltiplas memberships simultâneas como comportamento suportado.

## Plano

1. Corrigir `project-overview.md` e `architecture.md`: identidade global não significa acesso multi-entidade; o servidor resolve a única membership elegível.
2. Converter `OrganizationSelector` num contexto de entidade somente de leitura e adaptar os testes do cabeçalho.
3. Adicionar uma migration Central incremental com verificação de conflitos existentes e índice único parcial sobre memberships não removidas.
4. Fazer o onboarding de utilizadores detetar uma membership não removida em qualquer entidade e devolver `MEMBERSHIP_ALREADY_EXISTS`; manter a restrição final na base para concorrência.
5. Atualizar os testes unitários e de integração diretamente afetados, sem reescrever provas históricas.
6. Executar testes direcionados, sintaxe dos JavaScript alterados e build frontend. A migration será validada em base descartável se a infraestrutura local do gate estiver disponível; não será aplicada ao ambiente habitual.

## Critérios de aceitação

1. Hugo vê `C4G` no cabeçalho como contexto fixo e não vê uma caixa de seleção.
2. Uma conta apenas de Administração C4G vê `Administração da plataforma C4G` e não recebe acesso de entidade.
3. Uma conta sem membership nem papel de plataforma vê a indisponibilidade de acesso, sem seletor vazio.
4. A base recusa duas memberships não removidas da mesma identidade, inclusive entre entidades diferentes e sob concorrência; memberships `REMOVED` permanecem preservadas.
5. O onboarding de entidade e de utilizador devolve conflito quando tenta associar uma identidade já vinculada a outra entidade, sem criar uma segunda membership.
6. O login continua a resolver automaticamente a única membership elegível e a ativação inicial continua a conseguir fixar esse contexto na sessão.
7. Testes frontend direcionados, testes backend/migração direcionados, `node --check` dos JavaScript alterados e `npm run build` no frontend passam.

## Fora do âmbito

- Eliminar memberships ou dados históricos.
- Criar transferência automática entre entidades.
- Alterar os perfis internos ou as respetivas permissões.
- Aplicar migrations no ambiente habitual, fazer deploy ou alterar contas reais.

## Implementação e validação

- O cabeçalho apresenta a entidade resolvida como contexto fixo. Sem entidade, distingue a Administração C4G de uma conta sem acesso; deixou de consultar a lista de organizações ou oferecer seleção.
- O onboarding de entidade, de utilizador e de adesão verifica qualquer membership `PENDING_PROJECTION`, `ACTIVE` ou `SUSPENDED` da identidade e devolve `MEMBERSHIP_ALREADY_EXISTS`. O conflito concorrente do índice é convertido no mesmo erro funcional.
- A migration Central `032_single_organization_membership` recusa dados existentes incompatíveis antes de criar um índice único parcial por `global_user_id`. É irreversível porque preserva memberships removidas e não apaga histórico.
- PostgreSQL 17 descartável: PASS para preflight com conflito, índice único, histórico `REMOVED`, corrida entre inserções, aplicação pelo runner canónico e fingerprints Central. Nenhuma base habitual foi alterada.
- Backend direcionado: **24/24 PASS**; `node --check` nos 15 JavaScript alterados: PASS.
- Frontend direcionado: **37/37 PASS**; suite frontend completa: **325/325 PASS**; `npm run build`: PASS, 1719 módulos.
- Suite backend completa: **1226/1229 PASS**. Permanecem exatamente as três falhas anteriores e fora deste recorte já registadas em `request-concurrency-phase-1`: cancelamento ClamAV, fixture F12/F11 e catálogo SQL incompleto da migration 031. A query nova da migration 032 ficou coberta pelo teste próprio e pelo gate PostgreSQL.

## Limites e seguimento

- A migration não foi aplicada ao ambiente habitual; antes dessa aplicação é obrigatório resolver qualquer conflito que o preflight `SINGLE_MEMBERSHIP_EXISTING_CONFLICT` encontre, por decisão administrativa explícita e sem eliminar histórico.
- As rotas internas de fixação de contexto continuam disponíveis para o login e a ativação inicial; deixaram de constituir uma escolha do utilizador no cabeçalho.
- Aguarda revisão funcional/visual final e decisão separada de rollout.

