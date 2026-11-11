# Aprovação autenticada e suspensão dos escritores EU

31/10/2026 — Review; implementação e validação concluídas no âmbito isolado. [Contrato](../../references/opportunity-v2/authenticated-approval-eu-contract.md).

## Resultado e fronteira operacional

Integrado o percurso administrativo autenticado para preparar, consultar, aprovar e revogar planos v2, e para suspender/quiescer/retomar a família EU. O controlo abrange `EU_FUNDING_TENDERS`, `CORDIS` e `ERASMUS`, que partilham identidades. A aceitação futura da 11145 exige uma aprovação válida **e** o fence atual de uma fonte efetivamente quiescente.

Esta entrega prepara código e SQL candidatos. Não acede, suspende ou migra o ambiente habitual, não altera flags nem manifestos ativos e não publica a 11145. O preview habitual anterior continua a ser evidência histórica: a revisão v1 então observada ainda não tinha a dotação estruturada `120000`. Não houve nova recolha oficial neste incremento.

## HTTP e autoridade

Base: `/api/admin/opportunity-activation`. O cliente comum `opportunityActivationApi` usa a sessão e o interceptor CSRF existentes. Não foi acrescentado um ecrã administrativo nem um endpoint de aceitação/publicação.

| Método e percurso relativo | Efeito |
| --- | --- |
| GET `/plans?cursor=…` | Lista até 25 planos, com cursor explícito |
| POST `/plans` | Prepara plano a partir de `requestId`, `archive` e `expected` |
| GET `/plans/:planId` | Mostra candidato rederivado, revisão aceite histórica, cabeça atual e possibilidade de aprovação |
| POST `/plans/:planId/approve` | Aprova o digest exato com chave idempotente |
| POST `/plans/:planId/revoke` | Revoga o plano com chave idempotente |
| GET `/sources/eu` | Estado/fence e contagens de trabalho, leases e impedimentos à retoma |
| POST `/sources/eu/suspend` | Pede suspensão com `requestId` e `expectedFence` |
| POST `/sources/eu/quiesce` | Confirma quiescência quando já não há leases ativos |
| POST `/sources/eu/resume` | Retoma apenas se todas as condições atuais forem satisfeitas |

Ator e sessão derivam exclusivamente do servidor. Membership/perfil de organização, IDs de ator, assurance ou autorização enviados no corpo não concedem acesso. Sessão persistida, atribuição C4G_ADMIN e autenticação recente são revalidadas na transação; MFA segue a política opcional existente. Origem, CSRF e DTO fechado são obrigatórios. Respostas usam `no-store`, códigos fechados e limites explícitos; o preview excedente dá 413, sem truncar factos.

A leitura distingue o snapshot da revisão efetivamente aprovada da revisão corrente. Drift de revisão/arquivo/mapping invalida o preview; TTL de uma hora, CAS, replay e auditoria mantêm-se. `fence` do plano e `sourceFence` são valores independentes; ambos vinculam a aceitação e o respetivo recibo. A auditoria regista IDs, códigos e digests, sem cookies, SID ou credenciais.

Runtime: `OPPORTUNITY_ACTIVATION_RUNTIME=authenticated-v2`, explicitamente opt-in. O valor predefinido é `disabled`. API e worker usam a mesma seleção e exigem capacidade SQL; as verificações normais de admissão, ledger e fingerprints continuam obrigatórias. A mera existência das tabelas não substitui o registo do futuro pacote.

## Suspensão, fila e retoma

O estado durável evolui `ACTIVE → SUSPEND_REQUESTED → QUIESCED`. Cada transição incrementa o fence e produz recibo/auditoria na mesma transação. Pedir suspensão impede novas admissões/escritas; não declara que um pedido de rede em curso já terminou. Quiescência exige zero leases ativos de runs, outbox e inbox. Um escritor com lease/epoch obsoleto fica impedido de concluir ou gravar efeitos.

O SQL protege também os caminhos legados que não conhecem a flag, incluindo catálogo, identidades, observações, ciclos e execução assíncrona. Os writers atualizados verificam o controlo na admissão e no trabalho. A transferência do único lugar de execução é serializada; `eu_source_held` é metadado operacional e não altera estado histórico, prazo, tentativa ou lease do run. Permite que Interreg/POCTEP avancem enquanto EU está suspenso, mantendo no máximo um escritor ativo. A retoma espera pelo fim de trabalho oficial concorrente quando há EU pendente.

A fila PgBoss é partilhada. Uma entrega EU suspensa só recebe ACK de transporte depois de se provar a existência do envelope original exato e do seu digest no outbox durável. O trabalho lógico e o inbox permanecem pendentes; não há nova tentativa, alteração de deadline ou conclusão fictícia. A retoma rearma o último outbox publicado na mesma transação do estado da fonte. Falha da prova não produz ACK. Jobs em voo que perdem o fence propagam o erro sem terminalizar o trabalho nem fabricar uma tentativa nova.

A projeção da execução usa a transação do relay, evitando um checkout aninhado bloqueado atrás da suspensão. Se a entrega chegar antes do commit, ou se a publicação sobreviver ao rollback, o consumidor valida a intenção imutável do outbox: identidade, organização, três digests e metadados exatos de tentativa/replay. Ausência, ambiguidade ou corrupção falham explicitamente; não se assume tentativa 1.

Retoma de `SUSPEND_REQUESTED` também é possível como cancelamento da pausa, mas exige a mesma quiescência efetiva. É recusada perante leases ativos, prazo já expirado, intenção durável irrecuperável, slot ocupado ou qualquer oportunidade EU já aceite em v2. Se o prazo expirar depois da retoma, o reconciliador só pode registar expiração sob condições SQL estritas e novo fence; não prolonga o prazo.

**Após a primeira aceitação EU v2, os escritores legados EU permanecem suspensos.** Uma flag desligada não remove a barreira SQL. A retoma posterior requer um escritor v2 compatível e um incremento próprio; não existe autorização implícita para voltar ao writer v1.

## Validação

[Resumo](../../../output/opportunity-v2-authenticated-eu/validation-summary.json), [prova integrada](../../../output/opportunity-v2-s6-1eded55be0d347c8863381757120c58b/verification.json) e [integridade](../../../output/opportunity-v2-authenticated-eu/integrity.json).

- **16 checks PASS** em PostgreSQL 18.6 e PgBoss 12.37.0/schema 45, com 33 eventos, cadeia de auditoria válida e limpeza do contentor confirmada. Os 386 hashes de entrada permaneceram iguais durante e após o gate.
- Sessão persistida/cookie assinado, middleware real, CSRF/origem, recusa de perfil organizacional e sessão revogada, preview factual da 11145 e aprovação auditada. Aceitação exercitada apenas pela composição interna isolada, exigindo o fence atual da fonte.
- Jobs anteriores à instalação, suspensão das três seleções EU, ACK de transporte com intenção preservada, retoma exata e execução Interreg/POCTEP durante a pausa. Concorrência de admissão, claim e projeção do relay serializada com a suspensão; writer SQL antigo e handler com lease expirado impedidos de gravar.
- Falha de auditoria desfaz controlo e recibo. Claim com alteração indevida de campos, claim de run terminal e manipulação de `eu_source_held` são recusados. Expiração após retoma regista ERROR/EXPIRED sem prolongar o prazo ou criar tentativa. Após aceitação v2, retoma legada recusada.
- No exemplo 11145, preview e aceitação isolada conservam o valor canónico `120000` e os sete cut-offs. O contrato normativo mantém a moeda da dotação como NOT_FOUND; EUR no apoio mensal não preenche essa ausência.
- Backend **2108 PASS / 0 FAIL / 7 SKIP**, frontend **491 PASS**, build PASS e sintaxe de 21 ficheiros PASS. Os skips existentes não são apresentados como testes executados.
- S0: 16 artefactos intactos; Excel original e fixture com SHA-256 `f5d81e3a2fcf31fac5b4545a4e7625c9f0c22333f28cc301ad4b61a7845f5869`. Conferidos 121 ficheiros de migrações/manifestos ativos contra a baseline S6, todos intactos.

As regressões RED→GREEN e a revisão independente corrigiram o índice global que bloqueava fontes oficiais durante a pausa, a ordem dos locks, a conclusão incorreta por handler obsoleto, a expiração após retoma e a projeção em transação aninhada. A suite completa identificou ainda a extensão indevida do catálogo fechado F12: os três eventos operacionais foram separados, mantendo os 11 eventos F12 e residência exclusivamente Central. As tentativas falhadas do gate e a primeira suite backend permanecem como evidência histórica; os resultados finais acima correspondem aos bytes conferidos. Revisão final sem bloqueantes conhecidos no âmbito.

A prova usa PostgreSQL e PgBoss descartáveis, HTTP real, cookies assinados e sessões persistidas de ensaio. Não certifica um novo login OIDC no fornecedor, nem representa aprovação por uma pessoa real. O modo histórico `--activation-only` foi substituído por `--activation-http-only` e recusa execução antes de criar infraestrutura; os resultados históricos permanecem intactos.

## Pacote e janela da 11145

A sequência central cumulativa acrescenta `opportunity_eu_source_control_v2.up.sql` aos seis candidatos da [preparação anterior](../../references/opportunity-v2/activation-preparation-candidate.json). O [novo descritor medido](../../references/opportunity-v2/authenticated-approval-eu-candidate.json) permanece não executável, não registado, não aprovado e não ativado. Inclui a ordem dos sete SQL e fingerprints após cada etapa. A capacidade tenant para snapshots v2 conserva a prova S6 separada; este incremento não a instala no ambiente habitual.

| Resultado medido | SHA-256/fingerprint |
| --- | --- |
| SQL de controlo EU | `c4b371d8a75f89567645c08f83e244ffa49fb386639175c8c2a53e526288b747` |
| Schema central final | `0cb6ef8f6e00cc8e9209864addab966c9772a9bb5d886b0165d49a67e1d21e82` |
| Autoridade final | `acb6daf8d58e240e14b5ce57e2228eb857ac37229b4700b735385576c0521286` |
| Catálogo de segurança final | `b981504c0b991748fc33f2c073c5a4d9538f7038da821dbc8bd5fe906ee0574e` |
| Tenant033 preservado | `d3526c7287fade9a1009ce223be8d36769c38b9345f89e9c72180cb940c793bc` |

Estes fingerprints não são os da baseline 035 habitual. Alterar a sequência ou os bytes exige nova medição; a existência deste descritor não autoriza uma migração.

1. Fixar os bytes finais e registar o pacote/ordinais/fingerprints pelo fluxo de migração aprovado. Não executar os candidatos diretamente nem contornar o preflight.
2. Na primeira instalação, bloquear admissões e drenar/substituir **todos** os processos EU legados antes de aplicar SQL. O endpoint de pausa depende do pacote já instalado; não pode proteger retroativamente essa instalação. Renovar backups na janela e provar o restauro isolado, incluindo Central, tenants consumidores e configuração.
3. Confirmar binários e flag coerentes na API e em todos os workers. O heartbeat atual, isoladamente, não prova ausência de um processo antigo. Validar capacidade SQL e admitir o pacote pelo coordenador normal antes de disponibilizar as novas rotas.
4. Arquivar uma observação oficial atual da 11145, concluir a recolha e conferir a revisão corrente. Suspender a família EU por HTTP autenticado, esperar pelos leases e confirmar `QUIESCED` com o fence atual. Manter leitores compatíveis disponíveis.
5. Recalcular o preview sobre esse arquivo e revisão: `120000`, moeda explicitamente ausente se a evidência continuar sem a publicar, SUSA/acordo 101190010, sete cut-offs, UUID e histórico. Aprovar o digest exato, dentro do TTL. Uma aprovação histórica não serve para dados novos.
6. A futura execução de migração/aceitação usa plano/fence/sourceFence atuais e CAS, com autoridade e auditoria revalidadas. Este incremento não expõe a aceitação por HTTP nem executa essa operação habitual. Verificar SQL, leitores comuns e vínculos privados após a aceitação autorizada.

## Recuperação e limites

Falha de autoridade, auditoria, CAS, prazo, digest ou fence faz rollback. Antes de aceitar v2, pode cancelar-se a pausa/retomar somente quando o endpoint confirmar todas as condições. Trabalho expirado ou sem intenção recuperável exige investigação e recuperação explícita; não se altera o deadline para o tornar elegível.

Depois de aceitar v2, manter a família EU quiescente, revogar planos afetados e corrigir por nova revisão auditada. Não apagar histórico, remover as novas estruturas ou reabrir o writer v1. Um restauro integral deve usar uma nova base/generation validada, reconciliando escritas posteriores antes da troca de bindings. RPO/RTO dependem do backup/restauro da futura janela e não foram medidos nesta entrega.

Interreg/POCTEP mantêm admissão e processamento próprios. POCTEP 10 continua bloqueada por divergência documental; Portugal2030 depende da cadeia documental central e a API PT2030 continua por certificar. O Excel normativo de 177 linhas não foi importado novamente nem alterado.

Próximo passo: registar e rever o pacote final para preparar a janela autorizada da 11145, com preview atualizado e backup/restauro próprios.
