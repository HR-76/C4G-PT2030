# Decisão: diretório e ciclo de vida de tenants

## Estado

Aprovada como contrato lógico para F4.1. As políticas estruturais estão aprovadas, mas valores e fornecedores operacionais permanecem sujeitos aos gates de F4.2/F4.4. Não autoriza rollout, provisionamento real, migrations externas ou acesso a ambientes externos.

## Contexto

A F3 valida identidade, organização e membership na Central e produz um contexto organizacional interno. A arquitetura aprovada prevê uma base PostgreSQL por organização, mas ainda não define um contrato executável que transforme esse contexto numa ligação tenant. A base Legacy representa o piloto UBI e não pode funcionar como fallback nem como modelo universal.

Esta decisão separa identidade de produto, localização física, lifecycle e observação operacional para impedir fuga entre organizações e permitir evolução sem forks.

## Decisão

### Identidades e cardinalidade

- `organization_id` identifica o cliente e a fronteira de autorização na Central.
- `tenant_id` é a primary key global, imutável e não reutilizável do domínio operacional de dados. É criado pela Central como UUID e não é fornecido pelo cliente.
- `database_ref` é uma referência opaca, substituível e específica do adaptador de infraestrutura. Não é identidade de negócio, nome público de base nem connection string.
- `tenant.organization_id` é FK para `organization`, é `UNIQUE` e participa também na chave candidata `UNIQUE (tenant_id, organization_id)`.
- No modo inicial, uma organização pode ter zero tenants durante onboarding e no máximo um tenant; um tenant pertence exatamente a uma organização.
- Restore, failover, reprovisionamento ou rotação podem alterar `database_ref` sem alterar `tenant_id`.
- Transferência de um tenant entre organizações não é suportada. Consolidação ou divisão exigirão uma operação de migração futura explícita.

### Modos de deployment

`DATABASE_PER_ORGANIZATION` é o único modo inicialmente suportado no MVP. Esta decisão não garante que outros modos nunca existirão. Um modo futuro exige decisão, threat model, isolamento comprovado, migrations e testes próprios antes de se tornar um valor válido para resolução.

O modo é interpretado apenas pelo adaptador de infraestrutura. Serviços de negócio recebem uma lease tenant e não escolhem host, base ou credencial.

### Diretório Central

O diretório Central é a única fonte de verdade de resolução e contém, no mínimo:

- `tenant_id` e `organization_id`;
- `deployment_mode`;
- `database_ref` e `credential_ref` opacos;
- `region_code` e versão da política de residência aplicada;
- `connection_version` monotónica;
- estado operacional e revisão de concorrência;
- timestamps e motivo/código sanitizado da última transição.

Não contém passwords, certificados privados, connection strings nem configuração devolvida ao frontend. A referência de credencial é resolvida apenas dentro do adaptador autorizado da API ou worker.

`organization_connection` referencia exclusivamente `tenant_id`; esse campo é simultaneamente PK e FK para `tenant`, e `organization_id` é sempre derivado. A linha contém apenas o controlo corrente: `current_connection_version`, `operational_state`, `revision` monotónica e metadados da última transição. O ponteiro `(tenant_id, current_connection_version)` referencia uma versão pertencente ao mesmo tenant.

`tenant_database_generation` é o registo imutável de ownership físico. A sua PK é `database_generation_id`; conserva `tenant_id` e `database_ref`, com `UNIQUE (database_ref)` e chave candidata `UNIQUE (tenant_id, database_generation_id, database_ref)`. Assim, uma geração/referência pertence a exatamente um tenant, mas pode ser referida por várias versões desse mesmo tenant quando apenas a credencial roda. Restore ou reprovisionamento cria nova geração e nova referência; nunca transfere a existente.

`organization_connection_version` preserva cada binding recuperável por PK `(tenant_id, connection_version)`, com FK composta imediata `(tenant_id, database_generation_id, database_ref)` para o ownership físico, `credential_ref`, região, versão de residência, binding digest, estado da versão e timestamps. `connection_version > 0` é monotónica e nunca reutilizada. Tenant, geração, referências e identidade esperada são imutáveis desde a criação; `observed_system_identifier` e binding digest começam nulos em `CANDIDATE`, são preenchidos exatamente uma vez pela validação e ficam imutáveis a partir de `VALIDATED`. A versão progride apenas pela allowlist `CANDIDATE → VALIDATED → DRAINING → REVOKED` ou `CANDIDATE/VALIDATED → FAILED`. A versão `VALIDATED` referida por `organization_connection.current_connection_version` é a única corrente; podem existir outras `VALIDATED` ainda não publicadas, mas não obtêm leases. `REVOKED` e `FAILED` são terminais. `credential_ref` é única e não pode ser reutilizada para outro tenant, base ou versão. A auditoria regista eventos, mas não substitui este histórico operacional necessário à recuperação.

O adaptador de infraestrutura valida o binding esperado antes de qualquer query funcional. O marker prova `tenant_id` e um `database_generation_id` imutável criado para cada instanciação/restauração física; o fingerprint prova a forma do schema; `system_identifier` é evidência observada do cluster PostgreSQL, nunca autoridade de identidade tenant; `connection_version` identifica a versão do binding aprovada na Central; e o binding digest fixa tenant, geração, referências opacas, identidade observada e versão. Destino ausente, ambíguo ou divergente falha fechado.

`organization_provisioning` conserva `organization_id`, porque o workflow pode existir antes do tenant. Existe no máximo um workflow corrente por organização e cada comando possui idempotency key única. `tenant_assignment_state` admite apenas `UNASSIGNED` ou `ASSIGNED` e é a fonte estrutural da atribuição; `current_step_code` continua operacional e não decide integridade relacional. O `CHECK` é fechado: `(UNASSIGNED, tenant_id NULL)` só é permitido em `NOT_STARTED`, `QUEUED`, `RUNNING`, `FAILED` ou `CANCELLED`; `(ASSIGNED, tenant_id NOT NULL)` só é permitido em `QUEUED`, `RUNNING`, `VERIFYING`, `READY`, `FAILED` ou `CANCELLED`; qualquer outra combinação falha. Assim, `VERIFYING` e `READY` exigem atribuição, enquanto falha/cancelamento preservam se a atribuição já ocorreu. A FK composta `(tenant_id, organization_id)` referencia `tenant (tenant_id, organization_id)` como `MATCH SIMPLE NOT DEFERRABLE INITIALLY IMMEDIATE`, com `ON UPDATE RESTRICT` e `ON DELETE RESTRICT`. Uma trigger futura permite exatamente uma transição conjunta `(UNASSIGNED, NULL) → (ASSIGNED, valor)` e rejeita retorno, remoção ou substituição posterior; transições de workflow validam o `CHECK` na mesma transação. Idempotency key, revisão, unicidade da organização e lock impedem workflows concorrentes incompatíveis. `READY` é proibido enquanto o binding composto não estiver validado. Unicidades isoladas nunca substituem esta integridade composta.

As FKs de `tenant`, `tenant_database_generation`, `organization_connection`, `organization_connection_version`, `tenant_schema_state`, `tenant_health_observation` e `organization_provisioning` usam ações `ON UPDATE RESTRICT` e `ON DELETE RESTRICT` e são, salvo decisão específica futura, `NOT DEFERRABLE INITIALLY IMMEDIATE`. Organização, tenant, gerações físicas, provisioning, ligação e versões não são eliminados fisicamente fora de workflow de eliminação aprovado, auditado e sujeito a retenção, legal hold e ownership verificado.

### Entrada do futuro `TenantResolver`

```text
resolveTenant({
  organizationContext: {
    organizationId,
    membershipId,
    membershipVersion
  },
  operation: {
    operationCode,
    correlationId
  }
})
```

O contexto é produzido e revalidado no servidor. `operationCode` é escolhido pelo código interno através de um adaptador registado e nunca deriva diretamente de header, query, body, cookie, claim livre ou outro valor do cliente. Nenhum campo de infraestrutura é aceite de parâmetros funcionais. Jobs usam um contexto interno assinado/equivalente, criado a partir de registos centrais e não de payload externo.

O catálogo versionado da release resolve `operationCode` para modo de acesso, schema mínimo, capacidades físicas necessárias, elegibilidade em `READ_ONLY`, query module autorizado e testes obrigatórios. Cada adaptador registado possui um `operationCode` constante e não aceita um código fornecido pelo endpoint ou consumidor. No startup, a aplicação valida atomicamente unicidade/imutabilidade dos códigos por release, presença do módulo, completude da entrada e coerência entre módulo e modo; duplicação, ausência ou incompatibilidade impede o arranque. Modo e requisitos nunca são classificados livremente pelo consumidor.

### Saída interna do futuro `TenantResolver`

```text
TenantResolution {
  organizationId,
  tenantId,
  deploymentMode,
  databaseRef,
  credentialRef,
  regionCode,
  connectionVersion,
  operationalState,
  operationContract: {
    operationCode,
    accessMode,
    authorizedQueryModule
  },
  schemaContract: {
    currentVersion,
    minimumReadVersion,
    minimumWriteVersion,
    compatibilityState
  }
}
```

A saída é interna, imutável e de vida curta. O futuro gestor de pools transforma-a numa lease vinculada a `tenantId`, `connectionVersion`, `revision`, binding digest, `operationCode`, query module e access mode. O executor recusa qualquer mismatch entre lease, adaptador, módulo, código ou modo. Controllers e serviços de domínio não recebem `credentialRef`, material de ligação ou API de SQL genérico. Respostas, sessões, logs e eventos funcionais nunca incluem estes campos.

### Precondições de resolução

Uma resolução só tem sucesso quando, na mesma avaliação lógica:

1. o contexto organizacional F3 continua válido;
2. `organization_id` corresponde exatamente ao diretório encontrado;
3. a ligação está operacionalmente `AVAILABLE`;
4. provisioning está `READY`;
5. o catálogo da release reconhece a operação e o schema/capacidades físicas satisfazem o contrato derivado;
6. a região respeita a política aplicável;
7. a referência de credencial e a versão de ligação podem ser resolvidas;
8. marker e fingerprint confirmam o tenant físico esperado;
9. o circuit breaker não proíbe a tentativa atual.

Não existe fallback para Central, Legacy, última organização usada ou outro tenant. Um health check recente não dispensa nenhuma precondição e não garante o sucesso da query atual.

## Quatro dimensões de estado

### Estado operacional da ligação

| Estado | Significado | Novas operações |
| --- | --- | --- |
| `PENDING` | Registo criado, ligação ainda não validada | bloqueadas |
| `AVAILABLE` | Ligação operacionalmente permitida | sujeito às restantes dimensões |
| `BLOCKED` | Ligação operacionalmente bloqueada | bloqueadas |
| `DRAINING` | Leases e workloads em drenagem | bloqueadas, salvo operação operacional explicitamente autorizada |
| `ARCHIVED` | Registo histórico terminal | bloqueadas |

`organization.status` permanece a única fonte de verdade da elegibilidade contratual/organizacional usada por F3. `organization_connection.operational_state` descreve apenas disponibilidade da infraestrutura e nunca ativa ou reativa uma organização.

### Progresso de provisioning

| Estado | Significado |
| --- | --- |
| `NOT_STARTED` | Nenhum workflow iniciado |
| `QUEUED` | Pedido persistido e aguardando execução |
| `RUNNING` | Passos idempotentes em execução |
| `VERIFYING` | Marker, schema, ligação, backup inicial e invariantes em validação |
| `READY` | Verificações concluídas; não ativa automaticamente a ligação |
| `FAILED` | Falha recuperável ou terminal registada por código sanitizado |
| `CANCELLED` | Cancelamento autorizado com compensações concluídas ou registadas |

### Compatibilidade de schema

| Estado | Leitura | Escrita |
| --- | --- | --- |
| `UNKNOWN` | bloqueada | bloqueada |
| `COMPATIBLE` | permitida conforme autorização | permitida conforme autorização |
| `READ_ONLY` | apenas operações declaradas compatíveis | bloqueada |
| `MIGRATION_REQUIRED` | apenas se o contrato de leitura o declarar | bloqueada |
| `MIGRATING` | apenas operações explicitamente compatíveis | bloqueada por omissão |
| `INCOMPATIBLE` | bloqueada | bloqueada |
| `FAILED` | bloqueada | bloqueada |

`READ_ONLY` é deny-by-default e permite exclusivamente `operationCode` presente no catálogo versionado da release e associado a adaptador/query module registado. Uma operação segura não pode executar DDL/DML, criar projeções ou estado local, disparar jobs ou efeitos assíncronos, adquirir locks de escrita, atualizar timestamps funcionais, depender de side effects ou aceitar SQL arbitrário não classificado; funções com qualquer destes comportamentos são escrita. Cada operação segura possui testes obrigatórios. O executor abre `BEGIN READ ONLY` antes de qualquer SQL do módulo e rejeita módulo de escrita numa lease read-only ou módulo de leitura numa lease de modo divergente. Operação, catálogo, release, versão, capacidade ou compatibilidade desconhecida falha antes da lease/query. Apenas `COMPATIBLE` permite operações normais de leitura e escrita.

O contrato de release declara versões mínimas de leitura e escrita. Não se infere compatibilidade apenas por proximidade numérica. Marker, ledger, checksums, fingerprint e versão física são verificados na base tenant; o diretório guarda a última observação para orquestração, não como substituto da verificação exigida.

### Saúde operacional observada

| Estado | Significado |
| --- | --- |
| `UNKNOWN` | sem observação válida |
| `HEALTHY` | probe recente passou |
| `DEGRADED` | disponível com erros ou latência acima do limite |
| `UNREACHABLE` | probe recente não estabeleceu ligação válida |

A Central mantém no máximo um snapshot corrente por `(tenant_id, connection_version)`, atualizado apenas por probes controlados ou transições operacionais. Requests normais nunca escrevem sincronamente health na Central. A série temporal pertence ao sistema de observabilidade, com labels limitadas e retenção própria. O circuit breaker limita novas tentativas, admite half-open controlado e vive por tenant em cada processo ou num store operacional posteriormente aprovado; nunca é global nem redireciona tráfego.

Cada snapshot tem instante, expiração, tipo de probe e código sanitizado. Saúde não concede autorização, não altera estado operacional/contratual ou compatibilidade e não substitui validação no momento da operação. Ausência ou antiguidade não provoca fallback. Respostas e logs públicos não expõem host, base, região ou fornecedor.

## Lifecycle e transições

- Transições são uma allowlist; qualquer transição não declarada falha fechado.
- Alterações usam compare-and-set sobre uma revisão monotónica e produzem auditoria.
- Operações longas usam lock com proprietário, finalidade e expiração; locks expirados são reconciliados, não assumidos como sucesso.
- Cada comando recebe uma chave de idempotência estável. Repetição devolve o resultado anterior ou retoma o workflow compatível.
- A ligação só passa a `AVAILABLE` após provisioning `READY`, schema `COMPATIBLE` e validação do binding físico.
- `BLOCKED` impede novas resoluções, fecha circuitos, impede jobs funcionais e inicia drenagem de leases/pools. Retomar disponibilidade exige nova verificação e incrementa revisão/versão.
- A suspensão contratual usa exclusivamente `organization.status = SUSPENDED` e bloqueia F3 antes da resolução tenant.
- Offboarding coloca `organization.status = TERMINATING` e a ligação em `DRAINING`; não equivale a eliminação.
- `ARCHIVED` preserva identidade, evidência e obrigações. É terminal no MVP.

### Transições contratuais da organização

| Origem → destino | Precondições | Efeito |
| --- | --- | --- |
| `PROVISIONING → ACTIVE` | tenant atribuído; provisioning `READY`; schema `COMPATIBLE`; binding físico validado; ligação `AVAILABLE` | permite que F3 avalie seleção e memberships; não concede autorização funcional |
| `PROVISIONING → ARCHIVED` | onboarding cancelado antes de `TERMINATING`; compensações e retenção registadas | encerra onboarding sem eliminar identidade ou histórico |
| `ACTIVE → SUSPENDED` | decisão administrativa autorizada | incrementa o fence/revisão, bloqueia novas seleções e leases e inicia drenagem |
| `SUSPENDED → ACTIVE` | decisão autorizada; contrato elegível; binding e restantes gates novamente verificados | incrementa revisão e exige nova resolução; nunca é reconciliação automática |
| `ACTIVE/SUSPENDED → TERMINATING` | offboarding aprovado | transição irreversível no MVP; incrementa fence antes de drenar |
| `TERMINATING → ARCHIVED` | leases/jobs drenados; exportação, retenção, legal hold e evidência avaliados; passos irreversíveis autorizados | conclui offboarding lógico sem implicar eliminação física |

Transições não listadas são proibidas. O cancelamento do onboarding/offboarding só pode ocorrer antes de entrar em `TERMINATING`. `TERMINATING`, `ARCHIVED` e offboarding concluído não regressam a `ACTIVE`, `SUSPENDED` ou `PROVISIONING` no MVP.

### Matriz normativa de transições

| Dimensão | Origem → destino | Precondições | Efeitos obrigatórios |
| --- | --- | --- | --- |
| Operacional | `PENDING → AVAILABLE` | provisioning `READY`; schema `COMPATIBLE`; binding/marker/fingerprint verificados | permite resolução apenas se organização e membership também forem elegíveis |
| Operacional | `AVAILABLE → BLOCKED` | falha operacional ou ação autorizada | bloqueia novas leases e inicia drenagem sem mudar `organization.status` |
| Operacional | `BLOCKED → AVAILABLE` | causa resolvida; credencial, binding e schema verificados | incrementa revisão/versão e exige nova resolução; nunca reativa organização |
| Operacional | `PENDING/AVAILABLE/BLOCKED → DRAINING` | offboarding aprovado e organização em transição contratual | bloqueia novas leases/jobs e inicia drenagem |
| Operacional | `DRAINING → ARCHIVED` | drenagem concluída; retenção e legal hold avaliados | preserva catálogo e auditoria; não elimina fisicamente |
| Provisioning | `NOT_STARTED → QUEUED` | comando idempotente válido | persiste intenção sem criar recurso duplicado |
| Provisioning | `QUEUED → RUNNING` | lock adquirido | inicia ou retoma passos confirmados |
| Provisioning | `RUNNING → VERIFYING` | recursos requeridos provisionados | inicia validação integral |
| Provisioning | `VERIFYING → READY` | todos os gates passam | regista prontidão sem ativar administrativamente |
| Provisioning | `QUEUED/RUNNING/VERIFYING → FAILED` | erro classificado | preserva passos e causa sanitizada |
| Provisioning | `FAILED → QUEUED` | retry autorizado, mesma intenção e lock livre | retoma sem duplicar identidade ou infraestrutura confirmada |
| Provisioning | `QUEUED/RUNNING/VERIFYING → CANCELLED` | cancelamento seguro autorizado | compensa apenas recursos com ownership confirmado |
| Compatibilidade | `UNKNOWN → COMPATIBLE/READ_ONLY/MIGRATION_REQUIRED/INCOMPATIBLE` | preflight completo | regista resultado observado sem autorizar por si só |
| Compatibilidade | `COMPATIBLE/READ_ONLY → MIGRATION_REQUIRED` | release exige alvo posterior | bloqueia writes incompatíveis e agenda migration |
| Compatibilidade | `MIGRATION_REQUIRED → MIGRATING` | lock e preflight válidos | bloqueia writes por omissão |
| Compatibilidade | `MIGRATING → COMPATIBLE` | migration e post-check completos | publica nova compatibilidade |
| Compatibilidade | `MIGRATING → FAILED` | migration ou cleanup falha | mantém acesso bloqueado e exige recuperação |
| Compatibilidade | qualquer não terminal → `INCOMPATIBLE` | drift ou versão não suportada | bloqueia operações não declaradas seguras |
| Saúde | qualquer → `UNKNOWN/HEALTHY/DEGRADED/UNREACHABLE` | probe autenticado e limitado | atualiza observação e circuit breaker, nunca autorização |

Transições não listadas são recusadas. `ARCHIVED` e `CANCELLED` são terminais no MVP. Esta matriz é a única fonte normativa e deve originar testes de contrato nas fases executáveis.

Suspensão contratual e offboarding que alterem organização, ligação e provisioning usam uma única transação Central quando os registos coexistem: primeiro tornam `organization.status` inelegível, depois bloqueiam/drenam a ligação e cancelam trabalho incompatível. `organization.status` continua a fonte de verdade contratual; os estados operacionais não a substituem. Divergência entre dimensões falha fechado, gera auditoria/reconciliação e nunca provoca reativação automática.

## Pools, credenciais e concorrência

- O pool é identificado internamente por `tenant_id + connection_version`, nunca apenas por organização ou host.
- Criação concorrente usa single-flight; limites globais e por tenant impedem exaustão de recursos.
- Leases têm timeout e libertação obrigatória. Um client com erro de protocolo/transação é descartado.
- A rotação cria primeiro uma versão `CANDIDATE`, valida credencial/binding/marker/fingerprint e transita-a para `VALIDATED`. O cutover, numa transação Central, troca `current_connection_version`, incrementa `revision` e move a versão anterior para `DRAINING`; novas leases passam apenas para a versão apontada. Depois da drenagem até ao timeout, a anterior passa a `REVOKED`. Falha pré-cutover preserva a corrente e termina a candidata em `FAILED`; falha pós-cutover retoma drenagem/revogação a partir do ponteiro e estados persistidos. Resultado incerto nunca é assumido como sucesso: a reconciliação relê ponteiro, `revision` e versões antes de decidir o passo idempotente seguinte.
- Revogação urgente bloqueia novas leases e descarta a versão anterior sem fallback.
- Aquisição compara versão/revisão antes e depois de obter material/pool; se alguma mudar, descarta o resultado e reinicia toda a resolução. Antes da primeira query funcional, a lease confirma novamente versão corrente e binding digest.
- Suspensão, offboarding ou revogação incrementam o fence antes de bloquear novas leases. Leases emitidas deixam de ser renováveis e têm timeout obrigatório; leituras e escritas já iniciadas podem concluir dentro desse limite, sem promessa de revogação instantânea de transações PostgreSQL em curso. Offboarding aguarda drenagem antes de passos irreversíveis e qualquer retry resolve novamente contexto, membership, diretório, versão, revisão e binding.
- Segredos são obtidos just-in-time, mantidos pelo menor tempo possível e redigidos em erros, tracing e métricas.
- O contrato de segredos é vendor-neutral e depende apenas de `credential_ref` opaca, versão, rotação, revogação e auditoria; Neon não determina o secret manager.
- A política de orçamento de pools exige limite por tenant, limite global por processo, reserva operacional, timeouts, idle expiration, single-flight, drenagem por `connection_version`, backoff com jitter, circuit breaker por tenant, métricas de saturação e testes sob carga.
- Valores locais podem ser pequenos e determinísticos. Valores de produção dependem de capacidade e carga comprovadas e são gate de F4.2 operacional.

## Onboarding e memberships antecipadas

O onboarding é uma saga central idempotente:

1. criar organização e tenant em estado não utilizável;
2. validar contrato, região e política de residência;
3. reservar referências de infraestrutura e credencial;
4. provisionar a base;
5. aplicar baseline/migrations tenant;
6. validar marker, ledger, fingerprint, saúde e backup inicial;
7. criar projeções locais obrigatórias;
8. marcar provisioning `READY`;
9. tornar a ligação `AVAILABLE` após aprovação, mantendo `organization.status` como decisão contratual independente;
10. reconciliar memberships antecipadas.

Memberships podem ser criadas antecipadamente em estado inelegível, como `PENDING_PROJECTION`. Só passam a acesso funcional quando organização/membership estão elegíveis, contexto F3 válido, tenant associado, ligação `AVAILABLE`, schema compatível, operação admitida pelo catálogo e perfil local obrigatório confirmado. Identidade global e login não implicam acesso tenant.

## Suspensão, offboarding e dados

- Suspensão contratual da organização é reversível, usa `organization.status` e bloqueia imediatamente novas seleções/resoluções; não altera automaticamente retenção ou dados.
- Bloqueio operacional da ligação é independente, não reativa nem altera o contrato da organização.
- Offboarding coordena bloqueio, drenagem de sessões/jobs/pools, exportação autorizada, faturação final, retenção e evidência.
- Retenção calcula elegibilidade por política versionada. `REVIEW_MANUAL` permanece o padrão MVP.
- Legal hold tem precedência e impede anonimização ou eliminação abrangida.
- Backups expiram segundo a sua própria política; offboarding ou eliminação da base ativa não altera silenciosamente essa retenção.
- Arquivo lógico preserva o tenant e referências para auditoria; não significa eliminação física.
- Eliminação física exige decisão humana separada, segregação de funções, confirmação de backups/réplicas/objetos abrangidos e prova auditável. Não é automática na F4.
- Exportações são temporárias, autorizadas, cifradas e com expiração; a Central não conserva cópia operacional permanente.
- Prazos, SLAs e autoridades finais exigem validação jurídica/DPO antes da F4.4 real.

## Região, backup e recuperação

- A residência na União Europeia é a política inicial por defeito.
- `region_code` concreto é escolhido de uma allowlist aprovada antes do provisioning e validado contra política/contrato. Nenhum tenant real pode ser provisionado enquanto essa região não estiver definida.
- Exceção à residência UE exige aprovação documentada de segurança, privacidade/DPO e produto/contrato antes do provisioning.
- Mudança de região é migração explícita, não edição de diretório.
- Backup e restore pertencem ao lifecycle operacional do tenant; sucesso de backup não é inferido do fornecedor.
- Cada classe contratual terá RPO, RTO, frequência e retenção aprovados antes de staging/produção.
- Restore é ensaiado, cria infraestrutura isolada, valida fingerprint e só substitui `database_ref` por cutover versionado e auditado.
- Restore testado é requisito de ativação operacional, não apenas a existência declarada de backup.

F4.1 pode avançar sem estes valores e F4.2 pode desenvolver abstrações/testes locais. F4.4 e qualquer provisioning real permanecem bloqueados até à sua aprovação. Os valores de região, RPO/RTO e calendários não são inventados nesta decisão; dependem de aprovação comercial, jurídica e operacional.

## Fornecedores e portabilidade

Neon permanece o fornecedor PostgreSQL atualmente aprovado/previsto pelas decisões existentes. O contrato de domínio, diretório, `database_ref`, `credential_ref` e `TenantResolver` permanece vendor-neutral: substituir o fornecedor no futuro não altera identidades ou interfaces de domínio.

Neon não seleciona implicitamente secret manager nem provisioning orchestrator. Estas duas escolhas continuam pendentes e independentes; qualquer substituição do fornecedor PostgreSQL exige ADR próprio, sem reescrever esta fronteira de domínio.

## Administração e suporte

- Administrador C4G gere catálogo, lifecycle e operação, mas o papel global não concede leitura silenciosa dos dados do cliente.
- Administrador da entidade gere configuração e membros apenas dentro da sua organização, sujeito à futura autorização F5.
- Suporte temporário exige grant explícito, organização, finalidade, âmbito, início/fim, MFA, aprovação e auditoria por uso.
- Acesso de emergência exige política posterior; não é criado implicitamente por esta decisão.

## Taxonomia de falhas

### Códigos públicos

| Código | HTTP recomendado | Semântica pública |
| --- | --- | --- |
| `ORGANIZATION_SELECTION_REQUIRED` | 409 | falta contexto organizacional selecionado; preserva o contrato F3 |
| `TENANT_NOT_AVAILABLE` | 503 | tenant não está disponível para a operação |
| `TENANT_READ_ONLY` | 503 | escrita temporariamente indisponível |
| `TENANT_OPERATION_UNAVAILABLE` | 503 | operação não pode ser concluída com segurança |

Os códigos públicos não distinguem inexistência, suspensão, região, credencial, base ou schema e não permitem enumeração.

### Códigos internos mínimos

`DIRECTORY_NOT_FOUND`, `DIRECTORY_AMBIGUOUS`, `ORGANIZATION_MISMATCH`, `CONNECTION_NOT_AVAILABLE`, `PROVISIONING_NOT_READY`, `SCHEMA_UNKNOWN`, `SCHEMA_INCOMPATIBLE`, `OPERATION_NOT_REGISTERED`, `READ_CATALOG_INCOMPATIBLE`, `CREDENTIAL_UNAVAILABLE`, `PHYSICAL_TENANT_MISMATCH`, `REGION_POLICY_MISMATCH`, `CIRCUIT_OPEN`, `POOL_EXHAUSTED`, `TENANT_UNREACHABLE`, `TRANSITION_CONFLICT`, `LOCK_CONFLICT` e `RECONCILIATION_REQUIRED`.

Erros internos incluem correlação e IDs técnicos mínimos, nunca segredos, connection strings ou dados funcionais. Falhas de cleanup são agregadas ao erro principal e impedem mensagem de sucesso.

## Auditoria e observabilidade

- Auditoria regista ator, organização, tenant, ação, transição anterior/nova, motivo, correlação e resultado, com minimização de PII.
- Logs usam IDs internos e códigos sanitizados; não incluem payloads de cliente, referências de credencial ou nomes físicos de base.
- Métricas de pools, resolução, saúde, migrations e circuit breaker usam identificadores controlados para evitar cardinalidade ilimitada.
- Traces propagam `correlation_id` e contexto interno verificado, nunca aceitando atributos tenant do cliente como fonte de verdade.
- Alertas distinguem falha central, falha de tenant isolado e falha sistémica. Um tenant indisponível não torna outro saudável nem causa redirecionamento.

## Reconciliação

Reconciliação compara diretório, infraestrutura observada, marker/ledger/fingerprint, pools ativos, provisioning e projeções. Divergência nunca é reparada por adoção automática de recurso desconhecido. Ações destrutivas exigem ownership verificável, allowlist e aprovação. Resultados são idempotentes e auditados.

## Readiness por fase

| Gate | Estado |
| --- | --- |
| Diretório, constraints e repositórios sem conexões tenant | `Ready for F4.1` |
| Abstrações e testes locais do resolver/pools | permitidos com adaptadores sintéticos e configuração determinística |
| Integração operacional/produção F4.2 | `Blocked for production F4.2` até secret manager, sizing e parâmetros operacionais |
| Migrations/compatibilidade sintéticas F4.3 | planeáveis após F4.1; catálogo `READ_ONLY` deve ser explícito e testado |
| Provisioning/operação reais F4.4 | `Blocked for production F4.4` até provisioning orchestrator, regiões, recuperação e políticas de dados aprovados |
| Rollout de tenant em produção | não autorizado |

## Alternativas consideradas

### Usar `organization_id` como `tenant_id`

Rejeitada. Acopla identidade comercial à infraestrutura e dificulta restore, migração, instalações dedicadas e futuras topologias.

### Guardar connection strings na Central

Rejeitada. Aumenta exposição e mistura diretório com secret manager. A Central conserva apenas referência opaca.

### Aceitar tenant ou base enviados pelo frontend

Rejeitada. Cria uma fronteira de autorização controlada pelo cliente e permite enumeração ou acesso cruzado.

### Reutilizar `DATABASE_URL`/Legacy como fallback

Rejeitada. Pode encaminhar organizações para a UBI ou para dados errados e mascara falhas do diretório.

### Usar health como autorização

Rejeitada. É observação potencialmente obsoleta e não prova estado contratual/operacional, membership ou compatibilidade atual.

### Partilhar base desde o MVP

Rejeitada. Contradiz a arquitetura aprovada e aumenta risco de isolamento antes de existir policy engine tenant.

### Eliminar fisicamente no fim do offboarding

Rejeitada como automatismo. Retenção, legal hold, arquivo e eliminação possuem autoridades e evidências distintas.

## Fronteiras de features

- F4.0 decide contratos e não implementa recursos.
- F4.1 materializa diretório e estados na Central.
- F4.2 implementa resolução, segredos, pools e isolamento local.
- F4.3 implementa schema, migrations, compatibilidade e preflight tenant.
- F4.4 implementa onboarding/offboarding, health e reconciliação.
- F4.5 adapta o piloto UBI pelo mesmo contrato.
- F5 implementa autorização funcional; não é inferida de estado tenant ou papel global.
- Branding, federação organizacional, SCIM, quotas, licenciamento e medição ficam em features posteriores.

## Consequências

- O acesso exige mais verificações e componentes, mas falha fechado e mantém isolamento explícito.
- A operação deve gerir pools dinâmicos, versões de ligação e compatibilidade por tenant.
- Valores comerciais e operacionais precisam de aprovação antes de ambientes reais.
- A UBI deixa de ser caminho implícito e terá de ser integrada como tenant explícito na F4.5.

## Valores e seleções adiados

- Região/cloud concretas na UE: bloqueiam provisioning real F4.4; exceções têm a aprovação tripla definida acima.
- RPO, RTO, frequência/retenção de backups e cadência de restore por tier: bloqueiam ativação operacional F4.4.
- Prazos/SLAs de retenção, exportação e offboarding e autoridades segregadas de legal hold/eliminação: bloqueiam workflow real F4.4.
- Secret manager: não bloqueia F4.1; bloqueia integração real F4.2 e provisioning real F4.4.
- Provisioning orchestrator: não bloqueia F4.1; bloqueia provisioning real F4.4. Neon permanece o fornecedor PostgreSQL previsto até eventual ADR substitutivo.
- Valores de pools, probes e circuit breaker: não bloqueiam F4.1 nem testes locais; bloqueiam F4.2 operacional.
- Catálogo inicial de operações `READ_ONLY`: bloqueia qualquer uso desse estado em F4.3; ausência implica recusa.
- Modos de deployment posteriores: exigem ADR próprio e não bloqueiam o MVP.

## Critérios para aprovação

- Os conceitos, `DATABASE_PER_ORGANIZATION` e as quatro dimensões de estado estão aprovados para F4.1.
- As políticas de `READ_ONLY`, residência UE, recuperação, dados, segredos e orçamento operacional estão aprovadas; os valores adiados bloqueiam apenas as fases identificadas.
- A revisão confirma coerência com a arquitetura multi-instituição e ausência de conceitos UBI.
- Nenhuma parte deste documento é interpretada como autorização de deploy ou eliminação.
