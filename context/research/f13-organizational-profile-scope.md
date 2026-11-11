# F13 — Âmbito e herança do perfil organizacional

- Estado: **Proposta — requer aprovação humana**
- Decisão investigada: representação do perfil entre organização, unidade e equipa, incluindo herança, override, ativação e autoria, sem acoplar a F13 ao algoritmo F14
- Feature: `F13 — Perfil organizacional para matching`
- Data: 2026-10-10

## Decisão a suportar

Definir qual é o âmbito mínimo do perfil F13 e como perfis mais específicos se relacionam com o perfil da organização, preservando least privilege, histórico reproduzível e um input inequívoco para a futura F14.

Esta investigação não aprova taxonomias, scoring, elegibilidade, regras por critério, permissions finais ou schema físico.

## Factos estabelecidos pelo repositório

### Produto e arquitetura

- Cada cliente é uma organização isolada e possui uma base tenant para dados operacionais, incluindo unidades, perfis, competências, prioridades, equipas, matching e qualificação.
- Unidades são hierárquicas e configuráveis; podem representar faculdade, departamento, divisão, gabinete, unidade de negócio, equipa ou outro conceito local.
- O produto também prevê equipas como conceito próprio e admite acesso por organização, unidade, equipa ou recurso.
- “Professor” é função/atributo configurável, não perfil universal.
- No modo atual aprovado, uma organização possui no máximo um tenant e um tenant pertence exatamente a uma organização.

### Modelo lógico versus implementação física

- O dicionário lógico prevê `organizational_unit`, closure `organizational_unit_path`, `unit_membership`, `team`, `team_membership`, `competency`, `strategic_priority` e `organization_profile_version`.
- `competency` pode pertencer a organização, unidade, equipa ou membro, mas esse owner polimórfico tem de existir e pertencer ao tenant.
- `organization_profile_version` é descrita como snapshot imutável das capacidades/prioridades usadas num matching.
- As migrations tenant canónicas 000–005 ainda não criam unidades, equipas ou perfis organizacionais. Hoje, estes conceitos são contrato lógico futuro, não entidades persistentes disponíveis para F13 referenciar livremente.
- F12 implementa catálogo e relações de oportunidade, mas não materializa a futura atribuição a unidade/responsável descrita no dicionário lógico.

### Autorização F5

- Os scopes fechados são `ORGANIZATION`, `UNIT`, `UNIT_SUBTREE`, `TEAM` e `RESOURCE`.
- Herança de unidade é opt-in por permission; equipa não herda de unidade.
- Scope autorizativo não define herança de dados. Usar `UNIT_SUBTREE` para autorizar uma ação não implica que o perfil de uma unidade seja herdado pelos descendentes.
- O caller não escolhe permission, scope, organização, unidade, equipa ou ownership. O recurso e as relações são carregados internamente e qualquer desconhecido recusa.
- Perfis base continuam sem grants funcionais implícitos; F13 terá de publicar permissions/operations próprias numa versão aprovada.

### Histórico, jobs e observabilidade

- F7 exige eventos fechados, autoria confiável, correlation/causation e evidência source-local. Auditoria não substitui o estado/versionamento necessário à recuperação.
- F9 fornece execução pelo menos uma vez, idempotência e reconciliação. Não obriga a transformar uma ativação bounded e transacional num job.
- F10 exige códigos e labels de baixa cardinalidade; IDs de organização, unidade, equipa, perfil ou ator não devem tornar-se labels.
- F12 estabelece o padrão de versões/revisões imutáveis, digests, CAS, idempotência, RLS e consumo futuro por referência histórica.

### Piloto UBI

- O piloto usa `professor_profiles`, `professor_research_areas`, `opportunity_research_areas` e matching lexical.
- Faculdades, centros, investigadores e `PROFESSOR` estão fixos no schema, API e UI.
- Não existem elegibilidade, pesos versionados, explicação persistente ou isolamento multi-instituição.
- Estes elementos podem informar migração de dados, mas não constituem autoridade para o domínio F13.

## Inferências sustentadas

1. Um perfil apenas por unidade/equipa não é suficiente: toda organização precisa de uma baseline institucional que represente capacidades e restrições comuns.
2. Unidades e equipas não podem ser strings ou UUIDs fornecidos pelo caller. Antes de um overlay ser ativado, a entidade correspondente tem de existir numa fonte tenant-local autoritativa e estar ativa.
3. A hierarquia de autorização F5 e a composição do perfil são contratos diferentes. Copiar automaticamente `UNIT_SUBTREE` para herança de conteúdo criaria comportamento não aprovado.
4. Resolver herança em tempo real a partir de registos mutáveis tornaria resultados F14 dependentes do estado corrente e quebraria reprodutibilidade.
5. Equipas podem ser transversais; por isso uma eventual relação `team.unit_id` não deve implicar herança automática do perfil da unidade.
6. Uma alteração da baseline organizacional não pode reescrever silenciosamente overlays já publicados nem resultados históricos.

## Opções viáveis

| Critério | A. Apenas organização | B. Organização + overlays versionados | C. Perfis independentes por âmbito |
| --- | --- | --- | --- |
| Simplicidade | Maior; um único perfil ativo | Intermédia; baseline obrigatória e overlays opcionais | Menor; cada âmbito precisa de conteúdo completo |
| Consistência | Forte, mas não representa especializações | Forte se composição for fechada e materializada | Risco elevado de divergência e duplicação |
| Least privilege | Autorização simples, pouca delegação local | Permite administração limitada ao âmbito sem perder baseline | Delegação simples, mas pode omitir restrições institucionais |
| Auditabilidade | Simples | Boa: cada overlay e snapshot resolvido possuem versões/digests | Muitos perfis completos e difíceis de comparar |
| Reprodutibilidade | Boa | Boa se o resultado efetivo for materializado na publicação | Boa por perfil, fraca para coerência institucional |
| Conflitos | Quase inexistentes | Exigem regras explícitas de composição e incompatibilidade | Evita merge, mas cria contradições entre âmbitos |
| Migrations/queries | Menor custo | Custo moderado e índices por scope | Maior volume e duplicação de snapshots |
| Compatibilidade F5/F7 | Apenas scope organização | Alinha com scopes fechados e autoria por âmbito | Alinha com scopes, mas não com baseline comum |
| Consumo F14 | Um snapshot simples, pouco específico | Um snapshot efetivo inequívoco por contexto | F14 precisa escolher entre perfis contraditórios |
| Evolução F15 | Pouca capacidade de atribuição especializada | Permite decisões por organização/unidade/equipa | Qualificação fragmentada e difícil de agregar |

## Recomendação

Recomenda-se a **Opção B: perfil organizacional obrigatório com overlays opcionais, versionados, por unidade ou equipa**.

### Âmbitos

- `ORGANIZATION` é o âmbito mínimo e obrigatório.
- `UNIT` e `TEAM` são especializações opcionais.
- Não existe perfil apenas de membro/pessoa na F13.
- `UNIT_SUBTREE` permanece scope de autorização F5; não é um âmbito de perfil nem uma regra automática de herança.
- Um overlay `TEAM` herda apenas da organização. Não herda da unidade associada à equipa sem uma futura decisão explícita.
- Um overlay `UNIT` herda apenas da organização. Herança entre unidade ancestral e descendente fica fora da primeira versão, evitando conflitos com reorganizações da árvore.

### Modelo de composição

Cada versão publicada de overlay referencia explicitamente:

- a versão publicada do perfil organizacional usada como base;
- o tipo e ID do âmbito especializado;
- a versão/estado observado da entidade unit/team;
- o conteúdo próprio do overlay;
- versões das taxonomias utilizadas;
- autoria e aprovação aplicáveis;
- um snapshot efetivo materializado e o respetivo digest.

A composição ocorre antes da publicação/ativação e o resultado é persistido como snapshot imutável. A futura F14 recebe um único `effective_profile_version_id` e digest, não uma instrução para voltar a combinar dados mutáveis.

### Herança e override

- A baseline organizacional aplica-se sempre.
- Overlays não editam nem copiam silenciosamente a versão base; produzem nova versão própria.
- Exclusões herdadas são monotónicas: unidade/equipa pode acrescentar exclusões, mas não relaxar ou remover uma exclusão organizacional.
- Valores positivos podem ser acrescentados ou restringidos somente através de operações fechadas definidas pelo contrato da respetiva taxonomia.
- Não existe merge genérico de JSON, precedência “last write wins” ou remoção por ausência.
- A possibilidade de suprimir um valor positivo herdado deve ser decidida por dimensão durante a investigação das taxonomias; até lá, falha fechado.
- Capacidades escalares não recebem regra genérica de substituição nesta decisão. A representação financeira/operacional futura deve declarar se o valor especializado acrescenta, limita ou substitui a baseline.

### Ativação

- Existe no máximo uma versão ativa por chave `(organization_id, scope_type, scope_id)`; para organização, `scope_id` é a própria organização ou uma representação canónica equivalente.
- A ativação de cada overlay é independente, mas só é permitida quando a baseline referenciada continua publicada e o âmbito continua ativo.
- Ativar nova baseline organizacional não rebasa overlays silenciosamente.
- Overlays ligados à baseline anterior tornam-se `REQUIRES_REVIEW` para novas utilizações F14 até serem republicados contra a nova baseline ou incluídos num cutover composto validado.
- Resultados históricos e snapshots efetivos anteriores permanecem resolvíveis.
- Draft, publicação e ativação devem usar CAS e idempotency key; estados e transições exatos serão fechados na decisão de versionamento/lifecycle.

### Autoria e autorização

- O ator é sempre derivado da sessão/membership revalidada ou de service actor interno aprovado; nunca vem do payload funcional.
- Operações distintas devem existir para criar/editar draft, publicar, ativar, retirar e consultar histórico.
- A autorização usa scope F5 correspondente ao recurso carregado internamente. Permissão `UNIT_SUBTREE` pode autorizar gestão de unidades descendentes quando a futura permission o declarar, mas não altera a composição do perfil.
- A ativação deve ser tratada como ação sensível e auditada criticamente. A necessidade de aprovador distinto/SoD e MFA permanece decisão humana da F13.
- Jobs não são necessários por omissão para criação/publicação/ativação bounded. Se compilação ou reconciliação futura for assíncrona, a ativação só termina depois de o snapshot efetivo persistido ser validado.

### Estado das unidades/equipas

- Um overlay só pode ser criado/ativado para unidade ou equipa tenant-local existente e ativa.
- Arquivar uma unidade/equipa bloqueia novas ativações e retira o respetivo ponteiro de uso futuro de forma auditada; não elimina versões nem snapshots efetivos.
- Mover uma unidade na árvore não altera retroativamente o overlay porque não existe herança ancestral implícita nesta recomendação.
- Alterações de membership de pessoas não reescrevem autoria histórica.

### Informação incompleta

- A baseline organizacional pode ser publicada apenas quando o contrato mínimo futuro estiver presente.
- Dimensões opcionais incompletas usam estado explícito `UNKNOWN`/`NOT_PROVIDED` conforme a taxonomia aprovada; ausência não significa capacidade, incompatibilidade ou exclusão.
- Overlays são opcionais. A inexistência de overlay significa usar a baseline organizacional, não criar um perfil vazio implícito.

## Como a futura F14 recebe o perfil

A fronteira recomendada devolve internamente uma referência semelhante a:

```text
EffectiveOrganizationalProfileRef {
  organizationId,
  scopeType,
  scopeId,
  effectiveProfileVersionId,
  organizationProfileVersionId,
  overlayProfileVersionId?,
  taxonomyVersions,
  contentDigest
}
```

O scope é resolvido pelo serviço a partir do recurso/contexto autorizado. O caller não fornece um scope técnico arbitrário nem seleciona versões históricas para execução normal. F14 persiste esta referência na avaliação, permitindo reprodução sem consultar o perfil ativo atual.

## Riscos e mitigação

- **Complexidade de composição:** limitar v1 a organização + um overlay; sem cadeia de unidades ancestrais.
- **Overlay obsoleto após nova baseline:** marcar `REQUIRES_REVIEW` e bloquear novas avaliações, sem rebase automático.
- **Explosão de versões:** overlays são opcionais e versões são append-only; retenção não elimina evidência usada.
- **Delegação excessiva:** F5 carrega âmbito e recurso internamente; nenhum ID ou permission vem do caller.
- **Exclusões contraditórias:** overlays só acrescentam exclusões; relaxamento institucional não é permitido.
- **Unidades/equipas ainda não persistidas:** implementação de overlays fica bloqueada até existir entidade tenant-local autoritativa ou até F13 aprovar materializá-las no seu próprio recorte.
- **Acoplamento prematuro à F14:** snapshot contém factos e exclusões, nunca pesos, score, ranking ou decisão de elegibilidade.

## Decisões ainda humanas

1. Aprovar ou rejeitar a Opção B.
2. Confirmar que v1 não terá herança entre unidades ancestrais/descendentes.
3. Confirmar que equipa herda somente da organização, mesmo quando associada a uma unidade.
4. Confirmar que exclusões organizacionais não podem ser relaxadas por overlays.
5. Decidir se valores positivos herdados podem ser explicitamente suprimidos e em que dimensões.
6. Decidir se F13 materializa as entidades mínimas `organizational_unit`/`team` ou depende de uma feature estrutural anterior.
7. Aprovar lifecycle exato, incluindo `REQUIRES_REVIEW` e cutover composto.
8. Definir autoridades de draft/publicação/ativação e requisitos SoD/MFA.

## Implicações para a especificação F13

Se aprovada, a especificação deve:

- tornar obrigatório um perfil `ORGANIZATION` e opcionais os overlays `UNIT`/`TEAM`;
- separar scope de autorização de regras de composição;
- exigir snapshot efetivo imutável e digest por versão publicada;
- proibir herança ancestral e team→unit implícitas na v1;
- exigir exclusões monotónicas;
- definir uma versão ativa por âmbito e bloquear overlays obsoletos para novo consumo;
- exigir resolução interna e estado ativo de unidade/equipa;
- preservar versões após arquivo do âmbito;
- fornecer à F14 apenas referência efetiva inequívoca, sem pesos ou scoring.

## Fontes internas

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/coding-standards.md`
- `context/features/matching-and-qualification.md`
- `context/references/logical-data-dictionary.md`
- `context/references/current-implementation.md`
- `context/decisions/tenant-directory-and-lifecycle.md`
- `context/decisions/multi-tenant-identity-and-data.md`
- `context/history/f5-functional-authorization.md`
- `context/research/f5-authorization-policy-decisions.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f9-async-execution-foundation.md`
- `context/history/f10-operational-observability.md`
- `context/history/f11-private-document-storage.md`
- `context/history/f12-opportunity-catalog.md`
- `backend/src/authorization/catalogs.js`
- `backend/src/authorization/policyEngine.js`
- `backend/database/tenant/migrations/000_tenant_control_baseline.up.sql` a `005_f9_execution_lineage.up.sql`
- `backend/src/controllers/matchingController.js`
- `backend/src/utils/researchAreaMatcher.js`
- `frontend/src/pages/Matching.jsx`

Não foi necessária evidência externa para esta primeira decisão: os contratos internos já estabelecem as fronteiras relevantes. A recomendação não é uma decisão arquitetural aprovada e não autoriza implementação.
