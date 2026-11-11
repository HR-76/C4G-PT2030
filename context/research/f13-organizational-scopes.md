# F13 — Autoridade canónica de unidades e equipas

- Estado: **Proposta — requer aprovação humana**
- Feature: `F13 — Perfil organizacional para matching`
- Decisão: autoridade canónica para `organization`, `organizational_unit` e `team`, e dependência necessária antes de overlays, scopes F5 e resource loaders `UNIT|TEAM`
- Data: 2026-10-10

## Decisão a suportar

Determinar se a F13 deve criar e governar unidades/equipas, depender de uma fundação transversal, limitar a v1 a `ORGANIZATION` ou guardar referências externas opacas. A decisão tem de preservar isolamento tenant, integridade referencial, lifecycle, autorização fail-closed e história reproduzível sem universalizar o piloto UBI.

Esta investigação não aprova nem carrega outra feature e não define diretório de pessoas, RH, organograma completo, reporting lines, cargos, grupos IdP ou sincronização externa.

## Factos do repositório

### Inventário de autoridades e estruturas

| Estrutura | Autoridade e residência | Identidade / organização | Lifecycle e hierarquia | Consumidores | Estatuto |
|---|---|---|---|---|---|
| `organization` | Central C4G, criada pela F3 | UUID; fronteira contratual e `organization_id` canónico | `PROVISIONING/ACTIVE/SUSPENDED/TERMINATING/ARCHIVED`; sem árvore local | F3/F4, memberships e resolução tenant | **Contrato aprovado e persistido** |
| `organization_membership` | Central C4G, F3 | UUID próprio, `global_user_id` e `organization_id` | temporal; `PENDING_PROJECTION/ACTIVE/SUSPENDED/REMOVED` | acesso base; a Central prevalece sobre projeções locais | **Contrato aprovado e persistido** |
| `organizational_unit` | base tenant segundo arquitetura/dicionário lógico | UUID lógico; `code`, label, tipo e parent previstos | árvore sem ciclos e archive lógico previstos | F5, F13, F15, candidaturas e reporting futuros | **Contrato lógico aprovado; não persistido nas migrations tenant 000–005** |
| `organizational_unit_path` | derivada tenant-local | ancestor/descendant/depth | closure reconstruível prevista | consultas hierárquicas e eventual scope | **Modelo lógico, sem implementação canónica** |
| `team` | base tenant segundo dicionário lógico | UUID lógico; nome e `unit_id` opcional previstos | archive lógico; equipa potencialmente transversal | F5, F13, F15 e pipeline futuros | **Modelo lógico, sem implementação canónica** |
| `unit_membership` / `team_membership` | tenant-local, projeção subordinada à membership Central | associa membro local a unit/team | temporal no modelo lógico | atribuição futura de pessoas e autorização | **Modelo lógico; desnecessário para a primeira fundação de scopes F13** |
| Scope F5 `UNIT`, `UNIT_SUBTREE`, `TEAM` | catálogo/aplicação F5 | scope ID fornecido por grant; resource carregado server-side | policy engine compara `unitId`, `ancestorUnitIds`, `teamIds` | autorização | **Semântica aprovada; fixtures/doubles, sem autoridade ou loader persistente unit/team** |
| Referências F7 | ledger tenant | `organization_id`, actor e resource/event data | append-only | auditoria transversal | **F7 não governa lifecycle nem valida existência de unit/team** |
| F12 | catálogo Central/tenant | oportunidades e revisões UUID; snapshots têm códigos temáticos/territoriais | versionamento próprio | catálogo e futura F14 | **Não possui unidade, equipa ou responsável canónicos** |
| `faculties` UBI | base legacy única | `SERIAL`; label única; sem `organization_id` | sem archive; sem parent; seed UBI | dashboard/reporting do piloto | **Dado de migração específico UBI** |
| `research_centers` UBI | base legacy única | `SERIAL`, FK com cascade para faculty; nome/short name/area | sem archive; exatamente uma faculty | perfis de professor e reporting UBI | **Dado provisório do piloto** |
| `professor_profiles.department` | base legacy única | texto livre, sem FK nem identidade estável | nenhum lifecycle/hierarquia | perfil UBI | **Label ambígua, não autoridade** |
| `professor_research_centers` | base legacy única | associação professor↔centro, primary opcional | delete em cascade; sem validade temporal | afiliação UBI | **Dado de migração; não membership universal** |
| `application_members` / responsáveis legacy | base legacy única | utilizador ou texto no contexto de candidatura | papel local à candidatura | pipeline UBI | **Responsabilidade de recurso, não estrutura organizacional** |

As migrations tenant canónicas `000–005` criam controlo do tenant, F9, F7, F11, F12 e lineage. Nenhuma cria unidade, equipa, closure ou membership local. O manifesto e as capabilities atuais também não publicam uma capacidade de diretório organizacional.

### O que F5 e F7 estabelecem — e o que não estabelecem

- F5 fecha os tipos de scope e exige resource loading server-side. O policy engine sabe avaliar uma projeção já carregada, mas não prova de onde vêm `unitId`, `ancestorUnitIds` ou `teamIds`.
- `UNIT_SUBTREE` existe no catálogo F5 atual, porém a decisão F13 exclui-o da v1. A sua existência não cria uma árvore nem autoriza herança de conteúdo.
- Os resource ports concretos observados pertencem a recursos F11/F12 ou são doubles sintéticos. Não existe loader persistente para `ORGANIZATIONAL_SCOPE`.
- F7 consegue preservar referências e eventos, mas não é source of truth da entidade referenciada.

### F12, F15 e reporting

- F12 preserva oportunidades, provenance e relações privadas, mas a atribuição futura a unidade/responsável não foi materializada.
- F15 prevê atribuir unidade/responsável durante a qualificação; precisa dos mesmos IDs estáveis e lifecycle, não de entidades próprias duplicadas.
- Reporting institucional precisa agregar por unidade ao longo de renames e archives. Labels ou IDs externos mutáveis não garantem isso.

## Separação dos conceitos

| Conceito | Responsabilidade |
|---|---|
| Organization | Cliente, fronteira de isolamento e raiz conceptual; autoridade Central F3. |
| Organizational unit | Scope tenant-local estável para estrutura configurável e agregação; não representa pessoa nem grant. |
| Team | Agrupamento tenant-local reutilizável e opcional; pode associar-se a uma unit, sem adquirir herança de perfil ou autorização. |
| User/person membership | Direito Central de acesso e, futuramente, projeções/associações locais temporais; não é requisito para existir um scope. |
| Responsibility assignment | Relação de uma pessoa/equipa/unidade com oportunidade, qualificação, candidatura ou tarefa; pertence ao recurso consumidor. |
| Authorization scope | Restrição de um grant F5 aplicada a recurso carregado server-side; não governa a entidade organizacional. |
| Profile overlay scope | Referência F13 a uma unit/team canónica e ativa; determina composição explícita do snapshot, não grants nem hierarquia. |

Para F13 são necessárias apenas a existência, identidade, organização, tipo, parent relevante, lifecycle, revision e provenance do scope. Memberships pessoais, cargos e linhas de reporting pertencem a capacidades futuras.

## Opções viáveis

| Critério | A. F13 governa unit/team | B. Fundação transversal | C. F13 v1 ORG-only | D. IDs externos opacos |
|---|---|---|---|---|
| Ownership de domínio | Incorreto: mistura perfil e estrutura | Claro e reutilizável | Adia ownership | Fica fora da plataforma |
| F5/F15/reporting | Acoplados a F13 | Uma autoridade comum | Continuam bloqueados em UNIT/TEAM | Validação fragmentada |
| Integridade/lifecycle | Possível, mas no owner errado | FK/lifecycle tenant-local canónicos | Simples apenas para ORG | Sem FK/lifecycle local confiável |
| Isolamento/IDOR | Exige F13 em todos os loaders | RLS e loader comum | Menor superfície inicial | Depende de integração externa |
| Rename/archive | F13 teria efeitos transversais | Identidade estável; eventos próprios | Não resolve futura adoção | Pode mudar fora do controlo local |
| Estabilidade histórica | Possível com custo duplicado | UUID e snapshots preservados | Boa para ORG | Fraca sem snapshot do diretório |
| Compatibilidade | Obriga F13 a migrar estrutura | ETL explícita para uma fundação própria | Evita migração agora | Incentiva backfill/inferência |
| Custo imediato | Médio | Médio e pré-requisito explícito | Baixo | Baixo aparente, alto operacional |
| Risco principal | Bounded context errado | Dependência adicional | Reduz o contrato F13 aprovado | Fail-open, drift e enumeração |

### Avaliação

- **A é rejeitada:** F13 deve consumir scopes, não governar entidades reutilizadas por F5, F15, candidaturas e reporting.
- **C é tecnicamente segura, mas não recomendada para o contrato atual:** permitiria uma F13 reduzida, porém exigiria decisão humana para remover/adicionar a uma versão futura todos os overlays `UNIT|TEAM`, operações, AC-17/18 e coortes já aprovados. Não “resolve” o blocker sem alterar o âmbito.
- **D é rejeitada:** referências opacas externas não asseguram FK, archive, pertença ao tenant, prevenção de ciclos nem loader fail-closed. Pode existir mapping externo como metadata, nunca como identidade canónica.
- **B satisfaz o contrato transversal:** concentra identidade/lifecycle mínimo sem trazer RH ou organograma completo para F13.

## Recomendação

Recomenda-se a **Saída 1 — dependência transversal obrigatória**.

Criar posteriormente uma feature própria, anterior à implementação de F13, dona de uma **fundação organizacional tenant-local mínima**. Nome e ordinal da feature ficam por decidir; esta investigação não a cria nem a carrega. F13 permanece `Draft` até o contrato dessa fundação ser aprovado.

Responsabilidades propostas:

- **F3/Central:** continua autoridade de `organization` e membership de acesso.
- **Fundação organizacional tenant-local:** autoridade de `organizational_unit` e `team`, identidade, parent, lifecycle, CAS, provenance, RLS, F5 resource loading e eventos estruturais F7.
- **F13:** referencia apenas IDs canónicos ativos, mantém overlays/versões/snapshots e reage ao archive sem governar o scope.
- **F5:** usa loaders da fundação para validar organização, tipo, estado e relações; grants permanecem separados.
- **F15/reporting:** reutilizam os mesmos IDs e snapshots históricos.

Não se recomenda declarar F13 “organization-only” implicitamente. Essa saída é possível apenas por alteração explícita do contrato F13 e dos seus critérios; na decisão atualmente aprovada, a fundação é pré-requisito de Ready.

## Modelo mínimo candidato

```text
OrganizationalScope {
  scope_id: UUID imutável
  organization_id: UUID obrigatório
  scope_type: UNIT | TEAM
  stable_code: código tenant-local opcional
  label: texto apresentacional
  parent_scope_id: UUID opcional
  lifecycle_status: ACTIVE | ARCHIVED
  revision: inteiro monotónico
  provenance: referência governada
  created_at / created_by
  archived_at / archived_by / archive_reason
}
```

O modelo é mínimo e sujeito a aprovação. `DRAFT` não é necessário para a entidade estrutural na v1: criação é atómica em `ACTIVE`, e alterações usam CAS. Se criação editorial/aprovação for exigida, isso necessita decisão própria; não deve ser inferido do lifecycle de perfis F13.

### Invariantes mínimas

- residência tenant-local; `organization_id` coincide com a identidade imutável do tenant;
- `scope_id` é UUID interno imutável e nunca reutilizado;
- label não é identidade; rename preserva `scope_id` e incrementa revision;
- `stable_code`, se adotado, é único por organização/tipo, não é reutilizado depois de archive e qualquer mudança exige política explícita;
- parent pertence à mesma organização, está ativo e obedece à matriz de tipos;
- ciclos e self-parent são recusados transacionalmente;
- archive é lógico; não elimina referências nem snapshots históricos;
- scope arquivado não recebe novos Drafts, versões, ativações, grants ou assignments operacionais;
- resource loader é server-side e devolve not-found uniforme para inexistente, cross-tenant ou não autorizado;
- RLS/IDOR e F7 aplicam-se às mutações e leituras conforme catálogo fechado;
- referências históricas preservam `scope_id`, tipo, label/código observado e revision/digest necessários à reprodução.

## Hierarquia recomendada

Adotar uma árvore mínima:

- `Organization` é raiz conceptual proveniente do contexto F3, não uma row duplicada no tenant;
- `UNIT` pode ter parent `UNIT` ou a raiz conceptual;
- `TEAM` pode ter parent `UNIT` ou a raiz conceptual;
- `TEAM` não tem children na v1;
- uma associação `TEAM → UNIT` serve integridade e navegação; não implica herança F13, grant F5 ou rollup;
- não existe parent múltiplo/DAG;
- não existe `UNIT_SUBTREE` nas operações F13 v1;
- a hierarquia não concede autorização implicitamente.

Uma estrutura plana não representa unidades hierárquicas já aprovadas nem reporting previsível. Um DAG introduziria múltiplos paths, conflitos de archive e scopes ambíguos sem requisito atual. A árvore multinível restrita oferece o mínimo necessário; a closure table pode ser implementação derivada, não identidade de domínio.

## Lifecycle e efeito sobre overlays

### Autoridade estrutural

- Criação, rename, move e archive pertencem à futura fundação e exigem operações/grants F5 próprios, CAS e F7.
- `ACTIVE → ARCHIVED` é a transição v1 recomendada. Archive não equivale a archive de perfil nem a desativação de overlay.
- Restauração fica fora até existir uma política aprovada; archive deve ser tratado como irreversível operacionalmente na v1.

### Archive de scope

O archive deve ocorrer numa fronteira source-local que:

1. bloqueia novas mutações/ativações/assignments para o scope;
2. desativa atomicamente qualquer ponteiro de overlay F13 ativo;
3. preserva Drafts e versões existentes, marcando-os inelegíveis para publicação/ativação enquanto o scope estiver arquivado;
4. preserva snapshots e referências históricas para F14/reporting;
5. produz eventos F7 da entidade e da desativação associada;
6. não apaga grants ou memberships históricos; novos usos falham pela revalidação do lifecycle.

A coordenação exata entre owner estrutural e F13 precisa de contrato transacional tenant-local antes da implementação. Não deve depender de evento assíncrono para impedir uso imediato de overlay arquivado.

## Impacto em F5 e resource loaders

- Grants `UNIT|TEAM` só podem ser criados contra scopes canónicos `ACTIVE` da mesma organização.
- O loader recebe `(organization_id, resource_type, resource_id)` de contexto confiável, resolve o recurso e o scope na base tenant e nunca aceita atributos de autorização do caller.
- F13 continua com scope exato. `UNIT_SUBTREE` permanece fora mesmo que a fundação mantenha ancestry para navegação/reporting.
- Membership pessoal não é necessária para criar ou referenciar um overlay. O direito de agir deriva da membership Central ativa e grants F5; futuras associações de pessoas não são fonte alternativa de acesso.
- Archive invalida uso corrente de grants associados por estado do resource, sem apagar a evidência do grant.

## Compatibilidade UBI

| Fonte UBI | Classificação | Tratamento recomendado |
|---|---|---|
| `faculties.id/name` | mapeável apenas com aprovação; ID local legacy | criar mapping explícito para nova `UNIT`; nunca preservar `SERIAL` como identidade universal |
| `research_centers` | ambígua entre unit e team; parent UBI rígido | decisão registro a registro; pode mapear para `UNIT` ou `TEAM`, ou permanecer unmapped |
| `professor_profiles.department` | apenas label livre | não fazer backfill por igualdade lexical |
| `professor_research_centers` | afiliação pessoal do piloto | fora da fundação mínima; preservar legacy/provenance até feature própria de memberships |
| `application_members` e responsável textual | responsabilidade de recurso | não converter em unit/team ou membership estrutural |
| seeds de faculdades/centros | conteúdo UBI | nunca seed global C4G |

Não existe `organization_id`, UUID estável, archive lógico ou provenance suficiente para migração automática. ETL futura deve criar mappings auditáveis e permitir `legacy/unmapped`; ambiguidade não é convertida por labels, short names ou relações cascade.

## Respostas às questões obrigatórias

- **Entidade canónica hoje:** organization sim (Central F3); unit/team não, apenas contrato lógico futuro.
- **Autoridade de criação/archive:** futura fundação tenant-local, não F13 nem diretório externo.
- **Residência:** unit/team tenant-local; organization continua Central e raiz conceptual.
- **Hierarquia:** árvore restrita; units aninháveis; team liga à raiz ou unit e não tem children.
- **Team→Unit:** permitida sem herança F13.
- **IDs/códigos:** UUID interno imutável; código estável opcional separado do label; rename preserva identidade.
- **Archive:** lógico, preserva história, recusa novas mutações e desativa overlay ativo atomicamente; restauração não presumida.
- **F5:** scope exato para F13; descendência não concede nada; loaders consultam a fundação tenant-local.
- **Membership:** não é necessária à F13; membership Central + grants F5 autorizam, associações locais futuras não substituem isso.
- **Cross-tenant:** RLS, organização derivada do contexto e resposta uniforme impedem enumeração.
- **Owner:** feature transversal própria anterior à implementação F13.
- **Readiness:** bloqueia Ready no contrato atual; organization-only só seria possível após alterar explicitamente o âmbito aprovado.

## Riscos e decisões humanas ainda necessárias

1. Aprovar a Saída 1 e a criação futura de uma fundação organizacional transversal como pré-requisito.
2. Aprovar a árvore mínima e a matriz `UNIT→UNIT|Organization`, `TEAM→UNIT|Organization`, sem children de TEAM.
3. Confirmar `ACTIVE|ARCHIVED`, archive sem restore v1 e stable code opcional/não reutilizável.
4. Confirmar que archive estrutural desativa o overlay F13 na mesma transação tenant-local.
5. Definir posteriormente o catálogo F5/F7 próprio da fundação e a fronteira exata de ownership das tabelas.
6. Decidir mappings UBI explicitamente durante migração; nenhum backfill inferido é autorizado.

Até esta aprovação, F13 permanece `Draft` e `F13-AC-18` não tem contrato implementável completo.

## Implicações para F13/F15/reporting

- F13 conserva o contrato aprovado de baseline + overlays, mas não pode implementar `UNIT|TEAM` antes da dependência.
- F5 ganha uma única autoridade para scopes e resource loaders, sem transformar hierarchy em autorização implícita.
- F15 referencia os mesmos scopes ao atribuir unidade/responsável; responsibility assignment continua entidade do processo.
- Reporting agrega por IDs estáveis e snapshots, preservando renames/archives e evitando labels como chaves.
- A especificação F13 não deve ser alterada antes da aprovação humana desta recomendação.

## Fontes internas

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/coding-standards.md`
- `context/decisions/future-data-model.md`
- `context/references/logical-data-dictionary.md`
- `context/references/current-implementation.md`
- `context/features/f13-organizational-profile.md`
- `context/features/matching-and-qualification.md`
- `context/features/reporting.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-authorization-and-segregation.md`
- `context/history/f3-membership-session-context.md`
- `context/history/f4-tenant-contract-lifecycle.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f12-opportunity-catalog.md`
- `backend/database/central/migrations/002_f3_organization_memberships.up.sql`
- `backend/database/tenant/migrations/000_tenant_control_baseline.up.sql` a `005_f9_execution_lineage.up.sql`
- `backend/src/security/tenantMigrationManifest.js`
- `backend/src/authorization/catalogs.js`
- `backend/src/authorization/policyEngine.js`
- `backend/src/authorization/authorizationService.js`
- `backend/database/migrations.sql`
- `backend/database/migrations_v17.sql`
- `backend/database/migrations_v20.sql`
- `backend/database/migrations_v22.sql`

Não foi necessária pesquisa externa: a decisão é de ownership e compatibilidade do produto, e as fontes internas estabelecem os factos necessários. Esta recomendação não é arquitetura aprovada nem autoriza implementação.
