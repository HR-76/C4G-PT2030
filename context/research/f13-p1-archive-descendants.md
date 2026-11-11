# F13-P1 — Archive de scopes com descendentes ativos

## Decisão investigada

Quando uma `UNIT` ou `TEAM` é arquivada, como deve a F13-P1 tratar descendentes ativos de forma explícita, atómica, concorrente e compatível com a futura desativação de overlays F13?

Estado: **recomendação sujeita a aprovação humana**. Este documento não altera a decisão aprovada nem fecha o blocker de readiness.

## Evidência atual do repositório

### Contratos aprovados

- A fundação define árvore tenant-local, `UNIT|TEAM`, lifecycle `ACTIVE|ARCHIVED`, archive terminal, ausência de restore/delete e proíbe grants ou ativações novas em scope arquivado.
- `TEAM` não pode ter filhos. Uma `UNIT` pode conter `UNIT` e `TEAM`; hierarquia não concede permission ou profile inheritance e não existe `UNIT_SUBTREE`.
- Archive tem de preservar referências históricas e compor transacionalmente dependências ativas; um overlay F13 ativo deve ser desativado no mesmo efeito source-local.
- F13 usa coortes e pointers imutáveis, mas não pode criar dependência física na migration F13-P1 antes de o schema F13 existir.
- F5 carrega o resource server-side e falha fechado; F7 crítico aceita um transaction client explícito e deve preceder a observabilidade do efeito.
- A compatibilidade F13 usa tuples exatas, capabilities e startup validation, sem inferir compatibilidade N/N-1.

### Padrões implementados reutilizáveis

- F12 usa lifecycle explícito, expected row version/CAS, idempotency key+digest e transação tenant-local com audit+efeito no mesmo client.
- Os repositories F4 bloqueiam estado com `FOR UPDATE`, reconciliam retries por evento/intention digest e recusam intenção divergente.
- O tenant runtime entrega client preparado, ligado a tenant/workload/operação, e revalida fence/binding antes da query funcional.
- O runner tenant usa advisory transaction lock, rollback integral, ledger/fingerprint e reconciliação de commit incerto.
- Não existe hoje uma autoridade `UNIT|TEAM`; não há comportamento legacy que deva ser promovido a contrato.

## Opções viáveis

| Critério | A — Leaf-first | B — Subárvore atómica | C — Reparent automático |
|---|---|---|---|
| Intenção | Uma ação explícita por scope | Uma ação produz efeitos em N scopes | Altera scopes que o comando não nomeou |
| Autorização | Grant exato no scope | Exige autorização de toda a subárvore ou autoridade massiva | Exige autorização de archive e reparent de terceiros |
| Auditoria | Um evento lógico por archive | Muitos eventos ou payload agregado limitado | Archive e múltiplos reparents encadeados |
| Concorrência | Lock organizacional + scope; custo previsível | Locks de subárvore, limites e deadlocks materiais | Locks de origem/destino e alteração de paths |
| F13 futuro | Desativa no máximo um overlay | Desativa todos os overlays da subárvore | Pode mudar composição sem nova decisão de perfil |
| Falha/retry | CAS e intent digest simples | Corpus da subárvore precisa ficar fixado no digest | Novo parent e descendants integram a intenção |
| Risco operacional | Mais comandos explícitos | Archive massivo acidental | Mudança semântica silenciosa |
| Adequação v1 | Alta | Baixa sem requisito real de bulk archive | Incompatível com identidade/histórico aprovados |

### Opção A — Archive leaf-first

Preserva scope exato, least privilege, intenção explícita, F7 proporcional e efeitos limitados. O custo é operacional: uma árvore é arquivada da folha para a raiz, cada ação com grant, reason, CAS e idempotência próprios. Esse custo é coerente com archive terminal e ausência de restore.

### Opção B — Archive atómico da subárvore

Exigiria congelar o conjunto completo no intent digest, autorizar cada membro ou aprovar uma nova autoridade de subtree, definir limites, ordenar locks e desativar múltiplos overlays. Isso aproxima a feature de uma operação bulk/`UNIT_SUBTREE` que não possui requisito aprovado. A atomicidade é tecnicamente possível, mas amplia significativamente blast radius, timeout, deadlock e recuperação sem benefício v1 demonstrado.

### Opção C — Reparenting automático

Viola a clareza de intenção: muda parent, path, contexto de navegação e potenciais referências sem comando de reparent por cada scope. Também permite que archive altere significado histórico e futuras composições F13. Deve ser rejeitada na v1.

## Recomendação

Adotar **Opção A — archive estritamente leaf-first**:

1. `TEAM` pode ser arquivada diretamente porque não admite filhos.
2. `UNIT` só pode ser arquivada quando não existe qualquer descendente `ACTIVE` na sua subárvore.
3. Não existe cascade nem reparenting automático.
4. Cada descendente é arquivado por comando próprio, da folha para a raiz.
5. Cada comando possui resource loading, authorization, reason, assurance, CAS, idempotency e F7 próprios.
6. A verificação percorre toda a subárvore, não apenas filhos diretos, para falhar fechado perante drift ou estado histórico inconsistente.

## Semântica e state transition

```text
ACTIVE --ARCHIVE(expected_revision, idempotency_key, intent_digest)--> ARCHIVED

Preconditions:
  target exists in current tenant/organization
  target is ACTIVE
  expected_revision matches
  no ACTIVE descendant exists at any depth
  F5 grant + required assurance/reason accepted
  required capability participants are compatible
  F7 critical append and mutation commit together

ARCHIVED is terminal in v1.
```

“Descendente ativo” é qualquer row `ACTIVE` alcançável a partir do target por uma ou mais relações `parent_scope_id`, independentemente da profundidade. Descendentes já `ARCHIVED` não bloqueiam. Um estado impossível em que um descendente ativo esteja abaixo de um ancestor arquivado é tratado como integrity conflict e nunca corrigido silenciosamente.

Parent arquivado:

- não aceita criação de child;
- não aceita reparent de entidade ativa;
- não pode voltar a ativo;
- continua resolvível apenas por leitura histórica autorizada.

## Invariantes recomendados

1. Nenhum scope `ARCHIVED` possui descendente corrente `ACTIVE` depois de um commit válido.
2. Create e reparent exigem parent `ACTIVE` quando o parent não é a raiz Organization.
3. Archive não altera parent de nenhum scope.
4. Archive não muda descendants já arquivados.
5. Cada archive altera exatamente um scope e, quando aplicável, exatamente as dependências registadas desse scope.
6. A ausência de autorização sobre um descendente não é testada nem revelada pelo archive da raiz: a existência de qualquer descendente ativo bloqueia antes de efeitos, sem lista pública.
7. Historical loaders podem resolver `ARCHIVED`; functional loaders exigem `ACTIVE`.
8. Cache de recurso/hierarquia é invalidada apenas depois de commit confirmado ou reconciliação persistida.

## Locks e concorrência

### Estratégia v1

Todas as mutações da árvore — create, reparent e archive — devem adquirir primeiro o mesmo advisory transaction lock derivado internamente de `organization_id`. O lock é tenant-local, não vem do caller e dura até commit/rollback.

Ordem canónica:

1. iniciar transação no client tenant preparado;
2. estabelecer/revalidar contexto `app.organization_id`;
3. adquirir advisory xact lock da organização;
4. reconciliar/bloquear o registo de idempotência;
5. carregar target `FOR UPDATE` e validar revision/lifecycle;
6. quando aplicável, carregar parent `FOR KEY SHARE`/lock compatível;
7. executar recursive CTE tenant-bound sobre toda a subárvore;
8. autorizar e executar participantes capability-gated;
9. reservar/anexar F7 crítico no mesmo client;
10. alterar target e revision; commit.

O lock por organização é preferível ao lock apenas por parent na v1 porque create e reparent podem atravessar parents e produzir phantom child ou ciclo entre ramos. A serialização organizacional reduz concorrência de writes, mas o volume esperado de alterações de organograma é baixo e o comportamento é simples de provar. Leituras normais não adquirem esse lock.

Row locks e FK composta continuam necessários para forma, CAS e integridade referencial. O advisory lock não substitui constraints. A recursive query defensiva valida toda a subárvore depois do lock; assim, nenhum create/reparent concorrente pode inserir um descendant entre a verificação e o update.

## CAS, idempotência e retry

- O comando fixa `scope_id`, `expected_revision`, action `ARCHIVE`, reason code, actor/context relevante e versões/capabilities no canonical intention digest.
- A mesma idempotency key com o mesmo digest devolve o resultado persistido, sem novo update nem segundo evento lógico F7.
- A mesma key com digest diferente produz `IDEMPOTENCY_CONFLICT`.
- Uma key nova contra scope já arquivado produz conflito de estado fechado; não transforma archive terminal numa operação genérica idempotente.
- Revision divergente produz `STALE_REVISION` antes dos participantes e do efeito.
- Commit incerto é reconciliado pelo idempotency record, lifecycle/revision e evento F7 persistidos; nunca se assume sucesso pela resposta de rede.

## F5, assurance e F7

### F5

- Uma única operação `ORGANIZATIONAL_SCOPE_ARCHIVE` serve `UNIT|TEAM`; o tipo é atributo server-loaded do resource, não uma operação escolhida pelo caller.
- Permission proposta: `organizational_scope.archive`.
- Resource: `ORGANIZATIONAL_SCOPE`, scope exato.
- Não existe grant de subtree nem autoridade implícita na raiz.
- Por ser terminal e afetar consumidores, recomenda-se `RECENT_MFA` e `reason_code` fechado.
- Maker-checker não é recomendado por defeito na v1: leaf-first limita o efeito a um scope e já exige grant explícito, MFA, CAS e reason. Uma exigência de duas pessoas precisaria de risco/requisito adicional e lifecycle próprio; não deve ser inferida nesta decisão.

### F7

- Sucesso produz um evento crítico `ORGANIZATIONAL_SCOPE_ARCHIVED` na mesma transação, com scope ID, type, revision anterior/nova, reason code, operation, assurance, idempotency key e detail code seguro.
- Labels, path, descendants, PII e conteúdo F13 não entram no payload.
- F5 denial reutiliza o evento deny-preserving aprovado e não confirma existência.
- Descendentes ativos produzem recusa funcional; o audit sanitizado pode registar reason `ACTIVE_DESCENDANTS_PRESENT`, sem IDs nem contagem.
- Idempotent replay reconcilia o evento lógico existente; não cria um segundo archive event.

## Erros públicos e enumeração

- Descendentes ativos: `DEPENDENCY_CONFLICT`, mensagem sanitizada e sem lista, tipos, paths ou contagem.
- Target ausente, cross-tenant, sem grant ou invisível: resposta uniforme `RESOURCE_NOT_AVAILABLE`.
- Scope/revision avançado: `STALE_REVISION` ou `STATE_CONFLICT` conforme o contrato público já fechado.
- Participant/capability incompatível: `INCOMPATIBLE_VERSION` ou `PERSISTENCE_UNAVAILABLE`, sem revelar se existe overlay.

Mesmo uma contagem sanitizada pode revelar estrutura organizacional a um caller autorizado apenas para o parent; por isso a resposta pública não deve incluir contagem. Diagnóstico interno pode usar apenas buckets de baixa cardinalidade, não IDs.

## Integração futura com F13

- **Capability F13 ausente:** não existem tabelas/efeitos F13 aplicáveis; o registry vazio é válido e F13-P1 arquiva o scope após as suas próprias validações.
- **Capability F13 instalada:** a exact compatibility tuple exige um participante F13 registado. O participante recebe o mesmo client preparado, bloqueia o pointer relevante, valida scope/version e desativa o overlay ativo antes do update final.
- **Capability declarada sem participante compatível:** startup/readiness e o comando falham fechado antes da mutação.
- **Falha do participante:** rollback integral de overlay, F7 e scope; nenhum pointer ou lifecycle parcial permanece.

A introdução futura ocorre por nova migration/capability/release bundle. N-1 sem capability continua a operar apenas nas tuples explicitamente declaradas; N com capability nunca faz fallback para comportamento sem participante. Adapters não simulam a desativação nem escrevem em tabelas F13.

## Resource loaders, caches e histórico

- Loader funcional retorna apenas `ACTIVE` e valida organization/type/revision server-side.
- Loader administrativo de archive pode carregar `ACTIVE` sob a operação exata; nunca aceita `ARCHIVED` como novo alvo.
- Loader histórico separado pode resolver `ARCHIVED` para snapshots/audit sem conceder operações funcionais.
- Após commit, caches de target, parent/path e autorização associada são invalidados por referência segura. Em commit incerto, reconciliação antecede invalidação/publicação de sucesso.
- Erros e cache misses não distinguem cross-tenant de inexistente.

## Provas futuras obrigatórias

1. Archive de `TEAM` sem children.
2. Archive de leaf `UNIT`.
3. Child direto ativo bloqueia.
4. Descendente ativo apenas em profundidade maior bloqueia.
5. Descendentes todos arquivados não bloqueiam.
6. Create sob parent arquivado recusa.
7. Reparent para parent arquivado recusa.
8. Create concorrente com archive não produz phantom.
9. Reparent concorrente para dentro/fora da subárvore serializa e converge.
10. Archive concorrente de child/parent permite apenas ordem válida e nunca deixa ancestor arquivado com descendant ativo.
11. Revision stale recusa antes de F7/participant.
12. Retry igual devolve o resultado sem evento duplicado; digest divergente conflita.
13. Falha F7 reverte scope.
14. Capability ausente funciona sem schema F13.
15. Capability presente sem participant recusa.
16. Falha participant reverte scope, overlay e F7 no mesmo PID/XID.
17. Commit incerto reconcilia estado integral.
18. RLS/IDOR A↔B e ausência de contexto recusam.
19. Resposta não enumera descendants e telemetria não contém IDs/counts sensíveis.
20. Corpus N/N-1 cobre capability ausente/presente e combinações cruzadas recusadas.

## Impacto nos F13-P1-AC

- `AC-07/08`: o advisory lock organizacional e recursive CTE fecham races de hierarchy.
- `AC-10/11/12`: concretiza lifecycle terminal, loaders e leaf-first sem alterar IDs.
- `AC-13/14`: fixa CAS, idempotent replay, divergent intent e commit incerto.
- `AC-16–20`: fixa resposta uniforme, operação F5, reason/MFA e F7 source-local.
- `AC-21–23`: concretiza o participant capability-gated e rollback conjunto com F13.
- `AC-27–29`: adiciona fault injection, exact compatibility tuple e startup fail-closed.
- `AC-31/32`: acrescenta probes concorrentes PostgreSQL e regressões de F5/F7/F12.

Não é necessário criar nem renumerar critérios; a recomendação apenas concretiza os existentes. Nenhum critério fica `PASS`.

## Riscos e decisões humanas restantes

1. Aprovar ou corrigir a opção A leaf-first.
2. Confirmar `RECENT_MFA` e reason obrigatório para archive de ambos os tipos.
3. Confirmar que maker-checker não é exigido por defeito nesta operação v1.
4. Confirmar advisory transaction lock por organização, aceitando serialização de hierarchy writes.
5. A política de `stable_code` continua separada e integralmente aberta.

## Fontes internas

- `context/decisions/organizational-scope-foundation.md`
- `context/features/f13-p1-organizational-scope-foundation.md`
- `context/decisions/f13-versioning-and-activation.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-authorization-and-segregation.md`
- `context/decisions/f13-schema-policy-compatibility.md`
- `context/history/f4-tenant-runtime-access.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f12-opportunity-catalog.md`
- `backend/src/opportunities/repositorySupport.js`
- `backend/src/security/tenantLeaseExecutor.js`
- `backend/src/authorization/authorizationService.js`
- `backend/src/audit/appendService.js`

Não foram necessárias fontes externas: lifecycle, locks, autorização, auditoria e composição são contratos internos desta aplicação.

Next step: aprovar ou corrigir a política de archive com descendentes antes de resolver a canonicalização do stable_code.
