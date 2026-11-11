# F13-PQ1-ACTIVATE — materialização e ativação para F14-PQ1

Estado técnico: **C-PQ1-01 resolvido — gate de capacidade pronto para revisão humana restrita**. A correção e as provas posteriores estão na [matriz de capacidade](../reviews/f13-pq1-capacity-fix/README.md), com [reconferência do código atual e limites da reutilização](../reviews/f13-pq1-capacity-fix/recheck-history-gate.md). A1 e D1–D7 permanecem aprovadas; os fechos restritos já registados são preservados, sem novo fecho nesta reconferência. F13 integral permanece In Progress. As secções de implementação abaixo conservam os estados históricos de cada entrega; a menção final a BLOCKED antecede esta resolução.

## Âmbito e contratos preservados

Origem: [F13-PQ1-PUBLISH](f13-pq1-publish.md), Complete com fecho humano restrito, publicação multidomínio imutável e inativa. Destino: [F14-PQ1](f14-first-partial-prequalification.md), três avaliadores para oportunidades privadas, sem score, competência SATISFIED/UNKNOWN e conclusão global INDETERMINATE. A publicação e o percurso de critérios já fechados não são reabertos. F13 integral continua In Progress.

Aplicam-se as decisões aprovadas de [versionamento/ativação](../decisions/f13-versioning-and-activation.md), [compatibilidade](../decisions/f13-schema-policy-compatibility.md), [completude](../decisions/f13-completion-policy.md), [autorização/segregação](../decisions/f13-authorization-and-segregation.md) e [projeção](../decisions/f13-confidentiality-projection-purpose.md). Esta proposta não aprova a [ativação temática isolada](f13-profile-activation-and-consumption.md).

Percurso pretendido: consultar publicação → pré-validar materialização → confirmar ativação com MFA → materializar e ativar atomicamente → consultar snapshot e origem → avaliar oportunidade e consultar explicação no consumidor. A implementação do consumidor é uma entrega coordenada separada; a ativação não é disponibilizada sem esse consumidor real e compatível. Não confundir prontidão técnica do produtor com autorização para implementar F14 nesta tarefa.

A primeira coorte contém apenas um baseline ORGANIZATION e zero overlays. Permite primeira ativação e substituição de baseline compatível, sem reduzir cobertura ou obrigações. Recusa overlays existentes e baseline mais amplo sem relação explícita de substituição. Não cria ponteiros por finalidade para contornar o baseline único. Rollback, desativação e overlays não ganham novas interfaces neste incremento; mantêm os contratos gerais e não são simulados por exclusão ou edição do histórico.

## 1. Origem, snapshot e tuple

| Elemento | Contrato proposto |
| --- | --- |
| Origem | ID exato da versão publicada, publicação, revisão de origem e bundle `F13_PQ1_PUBLISH_BUNDLE_V1`. Revalidar integridade, aprovação e admissibilidade; nunca juntar os heads atuais dos domínios. |
| Conteúdo | Temas, prioridades, competências, experiências, ligações, proveniência, verificações, métodos, validade e referências documentais do material publicado coerente. Preservar IDs e versões; não copiar documentos nem introduzir equivalências. |
| Snapshot | ID tenant-local, versão, origem, scope ORGANIZATION, cobertura, instante servidor de materialização, tuple, material normalizado e obrigações. Imutável e READY apenas após todas as validações. Digests e selos ficam no servidor. |
| Identidade semântica | Conceito + scheme + release exatos; métodos e proveniência identificados por versões admitidas. Catálogos governados existentes, fixtures sintéticas no desenvolvimento; sem inventar durações ou catálogos produtivos. |
| Conhecimento | Temas KNOWN com pelo menos um elemento; prioridades e competências KNOWN ou UNKNOWN explícito exclusivo por slot, conforme publicação. Coleção vazia/ausência não equivale a UNKNOWN. Competência declarada não equivale a verificada. |
| Cobertura | Domínios publicados explicitamente enumerados; constraints não avaliadas. READY significa conformidade com esta policy, não completude institucional nem elegibilidade. |
| Ativação | Registo append-only, snapshot exato, origem, autor da operação, motivo, instante e predecessor. Ponteiro único com activationId e geração monotónica. Não alterar flags da publicação histórica. |

### Tuple fechada proposta para esta integração

Esta é uma única tuple permitida, ainda não instalada. Identificadores novos são definições técnicas da proposta, não novos catálogos institucionais nem declarações de implementação.

| Camada | Identidades exatas |
| --- | --- |
| Produtor existente | schema `F13_ORG_PQ1_PUBLICATION` versão `1.0.0`; wire `F13_PQ1_PUBLICATION_V1`; extractor `F13_PQ1_MULTIDOMAIN_V1`; completion `F13_PQ1_PUBLICATION_COMPLETION_V1`; bundle `F13_PQ1_PUBLISH_BUNDLE_V1`; verification descriptor `F13_PQ1_VERIFICATION_DESCRIPTOR_V1`. |
| Snapshot novo | schema `F13_ORG_PQ1_EFFECTIVE_V1`; materializador `F13_PQ1_MATERIALIZER_V1`; readiness `F13_PQ1_READINESS_V1`; projeção `F13_PQ1_EFFECTIVE_READ_V1`; bundle `F13_PQ1_ACTIVATION_BUNDLE_V1`. |
| Consumidor novo | consumer `F14_PQ1_CONSUMER_V1`; regras `F14_PQ1_RULES_V1`; admissibilidade `F14_PQ1_EVIDENCE_ADMISSIBILITY_V1`; resultado `F14_PQ1_RESULT_V1`; projeção `F14_PQ1_RESULT_READ_V1`; reasons `F14_PQ1_REASONS_V1`. |
| Manifesto integrado | `F13_F14_PQ1_MANIFEST_V1` contém esta tuple inteira e digests canónicos restritos ao servidor, operações/eventos aprovados, políticas de projeção/finalidade e referências exatas de catálogos/métodos/releases admitidos. Os IDs de dados de catálogo são resolvidos dos registos governados da publicação, nunca gerados a partir de labels. |

A enumeração concreta de releases governados e os digests são artefactos de admissão produzidos na implementação a partir das fixtures/configuração aprovadas, não números inventados neste documento. Cada conjunto admitido é uma entrada exata do manifesto; não existe wildcard, fallback para latest ou produto cartesiano. Conteúdo institucional produtivo não é pré-requisito para implementar com fixtures governadas.

Policies exigidas, cumulativamente: completion da publicação; readiness estrutural/semântica do snapshot; projeção/confidencialidade/finalidade F13 e F11; admissibilidade temporal e factual para cada suporte usado por F14; regras determinísticas F14. Nenhuma pode ser omitida para obter READY. Cobertura exata: ORGANIZATION, THEMATIC_AREA, STRATEGIC_PRIORITY, COMPETENCY e EXPERIENCE, incluindo ligações, proveniência e verificações; `constraintsAssessed=false`, zero overlays. Temas KNOWN com mínimo um; prioridades e competências KNOWN ou UNKNOWN explícito exclusivo, sem verificação universal. Readiness não exige um suporte atual para cada competência; exige representação íntegra e interpretável de todos os estados transportados.

Reasons mínimos propostos para competência: `VERIFIED_AT_EVALUATION` (SATISFIED); `COMPETENCY_NOT_DECLARED`, `COMPETENCY_KNOWLEDGE_UNKNOWN`, `NO_VERIFICATION`, `VERIFICATION_NOT_YET_VALID`, `VERIFICATION_EXPIRED`, `VERIFICATION_REVOKED` (UNKNOWN quando não há outro suporte admissível). Método incompatível, acesso insuficiente e inconsistência são recusas, não resultados de competência. Afinidades mantêm os resultados D1–D3 e correspondência exata; conclusão global INDETERMINATE. A projeção de resultado contém apenas identidades autorizadas, evaluatedAt, cobertura, linhas/razões/evidência e freshness; nunca digests nem fonte oculta.

A fonte publicada mantém `effectiveSnapshot=false` e `f14Consumable=false`; a relação nova identifica o snapshot consumível pelo consumidor admitido. O bundle publicado anterior não é reinterpretado como snapshot. Manifesto enumera tuples completos, sem produto cartesiano. Novas ativações aceitam apenas N; leitura N-1 só mediante adapter explícito aprovado, inexistente nesta primeira entrega. Reuso de snapshot só com origem, policies, material e selos exatos, seguido de revalidação atual; nunca reescrever histórico. Materialização determinística para as mesmas entradas e instante de avaliação temporal, independentemente de IDs técnicos gerados.

## 2. A1 aprovada — integridade distinta de admissibilidade factual

**A1 aprovada em 2026-10-17:** permitir READY e ativação com histórico íntegro EXPIRED/REVOKED, sem exigir verificação universal. Preservar material, estados e eventos; calcular separadamente a admissibilidade da evidência no consumo. Uma verificação histórica não admissível não sustenta SATISFIED; na ausência de outro suporte admissível, a avaliação de competência produz UNKNOWN com motivo explícito. UNKNOWN é resultado novo, não conversão do estado persistido nem prova de incumprimento. Registo histórico: a proposta inicial bloqueava globalmente qualquer verificação expirada; o refinamento separou integridade e admissibilidade e ficou pendente até à aprovação humana expressa agora registada. A regra refinada substitui aquela recomendação, sem alterar artefactos históricos ou D1–D7.

Fundamento: D2 limita competência a SATISFIED/UNKNOWN; D3 fixa [verifiedAt, validUntil) e não exige verificação universal. A completion policy, regras 35–45, impede usar EXPIRED/REVOKED para satisfazer um slot corrente obrigatório, mas só exige VERIFIED quando a policy do slot o exigir. `pq1Release.js` declara `currentVerificationRequired:false` e preserva EXPIRED/REVOKED. A decisão nova é tornar explícito que a readiness desta tuple exige conhecimento representado e íntegro, não prova factual atual de cada competência. O requisito da oportunidade só pode ser demonstrado por prova atual admissível. D1–D7 não são reabertas.

Os “sim” da tabela pressupõem restantes gates de integridade, tuple, autorização, aprovação/SoD/MFA e cobertura satisfeitos. “Não sustenta” refere-se à verificação em causa: outra verificação independente, exata, válida e autorizada pode sustentar SATISFIED. O consumidor não pode selecionar suporte alternativo para contornar falta de acesso necessária à explicação ou esconder uma inconsistência.

| Caso | READY | Ativação | Pode sustentar SATISFIED? | UNKNOWN ou recusa no consumo | Fundamento / decisão |
| --- | --- | --- | --- | --- | --- |
| Competência declarada sem verificação | Sim | Sim | Não | UNKNOWN / NO_VERIFICATION, salvo outro suporte admissível; declaração preservada KNOWN | D2/D3, completion regra 40, policy publicada; sem decisão nova de verificação universal. |
| Verificação válida no instante avaliado | Sim | Sim | Sim, se corresponde exatamente ao requisito e método, referências, autorização e validade passam | SATISFIED só para requisito/instante avaliado; nenhuma conclusão de elegibilidade | D2/D3 aprovadas. |
| Verificação expirada | Sim; conservar histórico | Sim; expiração isolada não bloqueia | Não no instante fora do intervalo | UNKNOWN / VERIFICATION_EXPIRED quando falta suporte atual; sem alterar estado persistido. Avaliação histórica que a usou não fica atualmente utilizável | **A1 aprovada** para readiness e insuficiência probatória; intervalo D3 já aprovado. |
| Verificação revogada | Sim se revogação é evento válido e material continua íntegro | Sim nas mesmas condições | Não enquanto revogada; nunca avaliar hoje fingindo instante anterior | UNKNOWN / VERIFICATION_REVOKED sem suporte alternativo. Se motivo revela inconsistência do material, aplicar linha de integridade e recusar, não UNKNOWN | **A1 aprovada**, mesmo princípio de histórico; revogação não é mera expiração. Preservar evento/motivo, sem presumir falsidade da competência. |
| Método/release incompatível exigido pela tuple | Não | Não | Não | Recusa de consumo, mesmo que exista outro suporte; não interpretar estado de método não suportado | Compatibilidade exata aprovada; não introduzir adapter implícito. |
| Evidência inacessível ao consumidor | Não impede READY de um produtor autorizado; impede se o próprio materializador não tem acesso exigido | Não impede ativação por sujeito autorizado; não concede acesso futuro ao consumidor | Não para esse consumidor | Recusa da avaliação/consulta que exige essa fonte, sem revelar conteúdo ou converter WITHHELD em UNKNOWN | D5 e projeção cumulativa aprovadas; ausência de grant de um consumidor não corrompe globalmente snapshot. |
| Referências ou digests inconsistentes | Não | Não | Não | Recusa fail-closed; se descoberta depois, snapshot histórico preservado e consumo indisponível | Integridade/completion/compatibilidade aprovadas. A1 não relaxa este gate. |

Documento F11 só é exigido pelo método que o requer. Nesse caso a referência tem de ser exata, íntegra e AVAILABLE/CLEAN, com acesso autorizado; retirada/quarentena não é “verificação expirada” e recusa consumo. Erros de acesso não são razões UNKNOWN. `DISPUTED`/`CONFLICTED` não são estados transportados pelo descriptor publicado V1 observado; não inventar suporte: se surgirem fora da tuple admitida, recusar por incompatibilidade. Extensão futura exige policy/descriptor explícitos.

### Fonte autoritativa e revogação posterior à publicação

A fonte factual é `organization_profile.competency_verification_result` (identidade, material, método, verified_at e valid_until), com revogações append-only em `organization_profile.pq1_verification_status_event`, sempre filtradas por organization_id e verification_id. A migration 018 limita o evento a REVOKED, sequence=1, único por organização/verificação e ligado por FK à verificação. Não existe un-revoke nesta V1. O estado congelado na publicação/snapshot é histórico, não autoridade de estado corrente; evento posterior à publicação ou ativação prevalece na admissibilidade atual, sem alterar o material congelado.

O novo leitor de admissibilidade deve carregar em lote os IDs exatos referenciados no snapshot, conferir ligação à assertion/version/material/método esperados e consultar esse ledger na transação de consumo. Verificação ausente, relação divergente ou ledger inconsistente recusa, não equivale a “não revogada”. Não restringir consulta de revogação ao instante de publicação. Reutilizar a consulta agrupada observada em `pq1UiRepository.currentVerifications` e a semântica de `pq1Material.verificationState`, mas não confundir essa projeção de leitura com validação transacional completa do novo consumidor. Não compor o snapshot a partir de drafts atuais.

Verificação revogada e ausência de documento corrente são eixos distintos: A1 permite conservar a primeira como histórico, mas não elimina gates F11 de disponibilidade/scan/acesso para referências exigidas. F11 continua a ser consultado pela porta existente `document_storage.load_competency_reference`, cumulativamente com autorização DOCUMENT_READ. Catálogos, métodos e releases usam os resolvers governados existentes. Nenhuma cópia de ledger, novo protocolo de revogação ou estado UNKNOWN persistido é criado.

### Coordenação com o escritor existente

O escritor HTTP PQ1 (`pq1UiComposition.run`, ramo revoke) adquire o advisory lock transacional `pg_advisory_xact_lock(hashtextextended('F13-P1:' || organizationId,43001301))`, insere o evento no ledger e audita `ASSERTION_REVOKED`/recibo na mesma transação sob guardas de autoridade. A extensão mínima é fazer a materialização/ativação e a avaliação F14 adquirir **esse mesmo lock antes de ler o ledger**, mantendo-o até commit/rollback, com leitura do estado committed posterior à aquisição (READ COMMITTED; não reutilizar snapshot MVCC anterior ao lock). Uma segunda consulta sem coordenação não é suficiente; não criar um lock diferente que o escritor não conhece.

Ordem comum: lock F13-P1 antes dos locks tenant de oportunidade/critérios/ponteiro/referências, mantendo a ordem interna já exigida pelos seus escritores. As guardas centrais F2/F5 existentes mantêm a sua ordem de aquisição e validação; não abrir uma transação central inversa para inventar exclusão. Auditar a ordem nos novos adaptadores e testar ambos os ordenamentos/deadlocks. O lock é uma serialização transacional existente por organização, limitada pelo deadline; não é uma pendência UNKNOWN que bloqueia indefinidamente todos os recursos da organização.

- Se a revogação confirma antes de o avaliador adquirir o lock, a avaliação lê REVOKED e não pode emitir SATISFIED com esse suporte. Pode emitir UNKNOWN/VERIFICATION_REVOKED, com A1 e restantes gates satisfeitos; acesso/integridade inválidos continuam a recusar.
- Se a avaliação adquire o lock primeiro, a revogação espera. SATISFIED só pode confirmar com suporte ainda admissível no instante e deadline exigidos; depois a revogação pode confirmar e o resultado torna-se UNAVAILABLE para uso atual. Não se promete revogação retroativa.
- Timeout/conflito antes de decisão não permite presumir rollback; seguir guardas, F7, recibos e recuperação UNKNOWN existentes. Falha F7 da revogação não deixa evento parcial que o consumidor possa tratar como confirmado.

**Extensão técnica necessária, sem nova decisão de produto:** adaptador agrupado de admissibilidade no novo consumidor, aquisição do lock comum, privilégios mínimos de leitura do ledger/base, binding dessas dependências no resultado e revalidação de leitura. Ainda não implementados nem testados nesta feature. O mecanismo de revogação já existe; não falta inventar protocolo. F11, referências e autoridade continuam a usar os mecanismos próprios dos seus escritores: a inspeção do lock PQ1 não prova essas outras corridas, que permanecem gates ACT-04/08/14.

### Expiração depois da ativação e avaliação histórica

O snapshot e o ponteiro não mudam pela passagem do tempo; READY certifica o material segundo a policy no momento de materialização, não validade factual indefinida. A UI pode mostrar “Ativo — inclui verificações expiradas”; não declarar todo o snapshot indisponível por mera expiração. Pré-validação mostra avisos separados de bloqueios de integridade/acesso/compatibilidade.

Cada nova avaliação fixa e persiste evaluatedAt do servidor, IDs/versões dos suportes usados, métodos/releases, observação autoritativa de revogação (eventId/sequence ou ausência observada sob lock) e dependências da explicação; digests ficam no servidor. Usa esse instante, não um instante escolhido pelo cliente, e revalida estados atuais, [verifiedAt, validUntil), método/release, F11 e autorização. Se o suporte expirar antes do commit que emitiria SATISFIED, essa intenção não pode confirmar o resultado; recusa sem efeitos comprovada ou recuperação UNKNOWN se commit incerto. Uma nova avaliação explícita, já depois da expiração, pode emitir UNKNOWN com motivo. Não estender validade até ao final da sessão nem recalcular silenciosamente resultado pendente.

Uma avaliação que demonstrou SATISFIED antes da expiração mantém esse resultado histórico e evaluatedAt. Se o suporte usado expira/revoga, a leitura atualmente autorizada marca freshness UNAVAILABLE: “Resultado histórico — suporte já não admissível”. Não altera a linha histórica para UNKNOWN nem infere retroativamente que nunca foi válida. Uma nova avaliação pode legitimamente resultar UNKNOWN/CURRENT, mantendo global INDETERMINATE. UNKNOWN sem dependência de suporte positivo não fica UNAVAILABLE apenas por mencionar histórico expirado; essa condição foi a razão do resultado. Mudança posterior das entradas/observações relevantes exige nova avaliação e REVIEW_REQUIRED, salvo impedimento de acesso/integridade que prevalece como UNAVAILABLE. Revalidar também a autorização para ler o histórico.

Resultado automático, freshness e autorização de leitura são eixos separados: o resultado tipado persiste como foi calculado; freshness é calculada para as condições atuais e não recalcula as linhas; autorização é reavaliada por pedido e pode recusar a própria leitura, sem divulgar resultado nem atribuir UNKNOWN. Só um leitor autorizado recebe a classificação de freshness.

A dependência de uma avaliação identifica separadamente suporte positivo usado e histórico observado para explicar ausência de prova. Assim, não confundir admissibilidade da evidência usada para SATISFIED com integridade da referência histórica. A precedência UNAVAILABLE → REVIEW_REQUIRED → CURRENT permanece aprovada. Não há fallback, reativação ou avaliação automática.

## 3. Operações, HTTP e interface

Rotas especificadas sob `/api/organizational-profile/pq1-activation`, implementadas no terceiro bloco abaixo; exposição conjunta depende da configuração explícita indicada na evidência.

| Rota | Operação e resposta mínima |
| --- | --- |
| GET `/context` | Publicações autorizadas, baseline/geração atual, capacidades e bloqueios; projeção sem digests. |
| POST `/preview` | versionId exato; leitura autorizada, relatório de prontidão, cobertura e origem, token opaco vinculado a sujeito/sessão/tenant, entradas e geração. Não persiste snapshot nem intenção de escrita; auditoria de leitura conforme política. |
| POST `/activate` | versionId, token de preview, expectedActivationId/expectedGeneration, motivo e idempotencyKey. Operação aprovada `F13_PROFILE_COHORT_ACTIVATE`, grant `organization_profile.activate`, recurso PROFILE_ACTIVATION_COHORT, ORG, RECENT_MFA; devolve IDs de snapshot/ativação e geração. |
| GET `/active` e `/snapshots/:id` | `F13_PROFILE_READ`, grant organization_profile.read e políticas cumulativas das fontes; origem, material permitido, cobertura e admissibilidade atual separada da condição histórica READY. |
| GET `/activations` | Histórico paginado autorizado, predecessor e referências; não apresentar predecessores como atuais. |
| POST `/intentions/lookup` | Identidade exata da intenção, vinculada ao sujeito/tenant/recurso/operação; protocolo de recuperação com prova de commit ou não execução, sem lookup genérico por chave de outro sujeito. |

Ativar exige humano distinto de todos os autores materiais da coorte; aprovador pode ativar com grant e MFA, sem impor terceira pessoa. Service actor não ativa. Permissões de publicar/editar não concedem ativação; ADMIN não substitui grant. Preview/leitura respeitam redaction e assurance das fontes; se não for possível explicar entradas essenciais com acesso autorizado, recusar o consumo em vez de tratar WITHHELD como UNKNOWN. A leitura do consumidor não bypassa F13/F11 por possuir grant F14.

UI mostra publicação, revisão, cobertura, referência do baseline a substituir e motivo; confirmação explícita após preview e step-up necessário. Qualquer alteração relevante, incluindo nova seleção/preview/geração, invalida a confirmação. Servidor revalida tudo mesmo sem alteração visível. Rótulos: “Pré-validação”, “Ativar para análise parcial”, “Ativo”, “Indisponível para avaliação”, “Resultado por confirmar”. Nunca “Elegível”, “Aprovado para candidatura” ou score.

## 4. Transação, concorrência e recuperação

Materialização síncrona interna à ativação, sem job F9 ou endpoint de escrita independente. Uma transação tenant, sob guardas centrais existentes, carrega a publicação exata, valida tuple/policies/referências/aprovação/SoD/MFA, materializa, insere snapshot READY, insere ativação, troca ponteiro por CAS e grava F7/recibo. Tudo confirma ou nada confirma. Evento aprovado `PROFILE_COHORT_ACTIVATED` referencia snapshot e predecessor sem conteúdo restrito. Falha F7 reverte snapshot, ativação, ponteiro e recibo de sucesso. Conclusão central posterior usa recuperação existente, nunca prova de rollback baseada apenas em HTTP.

CAS inclui ID e geração; primeira ativação espera null/0, reativação não reutiliza geração. Repetição da mesma intenção e payload devolve o resultado original; mesma chave com payload diferente recusa. Concorrentes com mesma geração não vencem ambas. Não há janela com ponteiro para snapshot incompleto. Novos drafts não alteram a origem publicada nem invalidam automaticamente o baseline; mudanças nas referências, grants, membership, sessão, MFA ou aprovação são revalidadas.

Escritores das referências relevantes e leitor/ativador devem participar no mesmo protocolo de locks/versões/guardas até commit; uma consulta anterior ao commit não prova atomicidade. Ordenar locks consistentemente; verificar os dois ordenamentos das corridas. Limitar deadline pela lease, MFA/aprovação e fronteiras temporais dos suportes efetivamente exigidos pela operação; expiração de uma verificação histórica não bloqueia ativação pela A1 aprovada. Para avaliação SATISFIED, expiração do suporte usado impede confirmação tardia. Revalidar acesso e validade também no caminho real de avaliação. Nenhum segredo/digest no browser ou erro.

A avaliação F14 fixa snapshotId, activationId, geração, oportunidade/revisão, critérios confirmados exatos e regras. Commit da avaliação confirma essas identidades sob coordenação com os respetivos escritores. Troca do ponteiro ou alteração de critérios/oportunidade/regras torna resultados anteriores REVIEW_REQUIRED; referências inadmissíveis produzem UNAVAILABLE, com precedência UNAVAILABLE → REVIEW_REQUIRED → CURRENT. Mesmo reativando conteúdo equivalente, a geração nova não transforma avaliações anteriores em atuais.

503, timeout ou perda de resposta não demonstram recusa definitiva. UNKNOWN pode persistir sem resolução automática garantida. Na UX, bloquear nova intenção de ativação/substituição do mesmo ponteiro para o sujeito e ações dependentes da ativação desconhecida; continuar lookup e leitura. Como existe um único ponteiro organizacional, todas as substituições desse ponteiro conflitam, mas edição/publicação de perfis e outras operações independentes não ficam bloqueadas. sessionStorage não oferece exclusão entre sessões: idempotência, guardas, locks e CAS do servidor asseguram correção. Outros sujeitos/sessões não contornam conflitos de transação; após conclusão podem executar nova intenção com CAS atual.

Não repetir automaticamente com nova chave. Suporte recebe requestId/correlationId, IDs de intenção/operação/recurso, sem material sensível; reconcilia guardas, recibos e eventos autorizados. Só prova conclusiva permite apresentar committed/not-executed e desbloquear a intenção; sem prova permanece UNKNOWN. Reutilização desse comportamento é permitida por D6, com adaptação explícita do recurso ao ponteiro; não promete resolução automática nem introduz bloqueio global de organização.

## 5. Reutilização e extensões mínimas

| Base existente inspecionada | Reutilização e extensão necessária |
| --- | --- |
| `pq1Release.js`, `pq1Material.js`, `pq1Repository.js`, `pq1Source.js` | Origem publicada, identidade, completude e validação de evidências. Novo materializador consome o material congelado; não usar extração dos drafts atuais como origem. |
| `pq1UiComposition.js`, tokens e recovery; F2/F5/F7 | Padrões de autorização, assurance, CAS, guardas, auditoria e recuperação. Acrescentar operações/allowlists/manifestos exatos; existência do padrão não demonstra o novo caminho. |
| Catálogos de competências, experiências, proveniência, métodos e F11 | Reutilizar referências governadas e verificação existentes, sem equivalências ou novas durações. |
| Publicação temática e PQ1 fechadas | Preservar bundles, flags, HTTP e leitura anteriores; regressão obrigatória. |
| Lacuna atual | Não existe materializador/snapshot efetivo/ponteiro de ativação F13 nem consumidor F14-PQ1 implementado. Acrescentar armazenamento tenant, constraints, privilégios, operações, contratos HTTP e UI integrada. |

Novas migrations serão necessárias na implementação: snapshot/ativação append-only, ponteiro CAS e recuperação/admissão exatas. Definir up/down, recusa de downgrade ocupado, fingerprints, manifestos central/tenant e privilégios mínimos; não alterar migrations históricas. Não atribuir ordinal ou UUID antes de conferir o estado do repositório nessa tarefa.

### Limites síncronos e prova mínima de capacidade

Fixam-se como tetos conservadores desta V1 os limites já existentes, sem afirmar capacidade medida do materializador novo:

| Limite proposto | Fundamento inspecionado e aplicação |
| --- | --- |
| Limites de cardinalidade cumulativos | `authoringContracts.items` e `editorialMaterial` limitam **items a 100 no total**, somando temas e prioridades, não 100 por domínio. `competencyContracts.list` limita assertions/experiences a 100 por lista; `pq1Material.unique` limita cada coleção de assertions, experiences, links e verifications a 100. Aplicar também qualquer limite conjunto da revisão/bundle de origem: particionar ou reagrupar nunca aumenta a capacidade admitida. Não cortar links/verificações para caber. |
| Envelope até 1 048 576 bytes; material canónico até 262 144 bytes | `pq1UiComposition.js:105` limita o envelope; `canonicalization.MAX_CANONICAL_BYTES` já limita a representação canónica a 256 KiB. Prevalece o limite mais restritivo para snapshot/resultado, sem aumentar o canonicalizador. Descoberta de implementação: a redação inicial omitia este limite conjunto. São tetos operacionais, não capacidade comprovada. |
| 10 000 linhas e página até 100 | Mesmo catálogo de operações; maxRows limita resultado da operação, não deve ser apresentado como limite automático de todas as leituras SQL internas. Leitura interna deve ser agrupada e limitada pelas coleções; histórico externo paginado, sem paginação parcial da materialização. |
| 10 000 ms no máximo | timeoutMs existente; lease autoridade no máximo 10 000 ms (`authorityCoordinator.js:194–197`). Deadline efetivo é o menor entre orçamento remanescente da lease, timeout de operação, MFA/aprovação e validade de suportes obrigatórios. Não renovar lease para prolongar silenciosamente uma transação. |

Excesso conhecido de coleção/bytes/tuple recusa antes de persistir snapshot, ponteiro ou avaliação; não truncar, partir a coorte, ativar parcialmente, excluir histórico ou passar a assíncrono. Validar tamanho real serializado antes dos efeitos. Se o orçamento expirar durante a transação, rollback/recuperação conforme prova disponível; timeout/503 não demonstra ausência de commit. Publicação intacta pode exceder o envelope desta integração e continuar consultável; UI informa limite técnico, sem a declarar incompleta editorialmente.

Verificação mínima futura: fixture governada com combinações nos máximos simultaneamente admissíveis (incluindo 100 items totais entre temas/prioridades, não 100 de cada) e suporte documental/metadados representativos, casos abaixo/no/acima dos limites conjuntos e do teto de bytes, medição separada de extração/validação/locks/auditoria/commit no PostgreSQL descartável com guardas reais, mais corrida de duas ativações e deadlines reduzidos. Registar bytes, linhas e duração, incluindo bloqueios, sem inventar throughput/SLO. Se não couber no orçamento existente, não aumentar limites automaticamente: reduzir limites de admissão com evidência e rever o contrato, ou propor outra arquitetura separadamente. Essa medição é gate obrigatório de implementação/entrega, não uma medição executada nem motivo para deixar números por definir no contrato.

## 6. Aceitação e plano de prova

**Registo da especificação:** nenhum critério abaixo foi executado na tarefa documental. O primeiro bloco de implementação posterior e as suas provas parciais estão registados em [evidência do núcleo](../reviews/f13-pq1-activation/README.md); não equivalem a aceitação integral. As evidências do [publisher](../reviews/f13-pq1-publish/README.md) e da [correção de confirmação](../reviews/f13-pq1-confirmation/README.md) sustentam apenas os percursos já fechados. Os 14 testes da correção, incluídos nos 62 frontend, e build não constituem prova PostgreSQL/browser do novo incremento. Mecanismos partilhados são reutilizáveis, mas os probes abaixo têm de exercer o novo caminho real.

| ID | Critério obrigatório e prova mínima futura |
| --- | --- |
| ACT-01 | Browser completo: publicação existente → preview → MFA/confirmação → ativar → ler origem/snapshot → avaliar oportunidade → consultar explicação F14. Backend/PostgreSQL reais; mocks não substituem. |
| ACT-02 | Materialização determinística da revisão congelada; drafts mistos/novas edições não entram; preservação de todos os domínios/links/verificações e imutabilidade no banco. |
| ACT-03 | KNOWN não verificado e UNKNOWN explícito, temas obrigatórios, constraints não avaliadas; A1 exercitada: histórico expirado/revogado permite READY/ativação, nunca sustenta SATISFIED; UNKNOWN é resultado, sem conversão persistida. Estado fora do descriptor recusa. Integridade inválida bloqueia mesmo com outro suporte válido. |
| ACT-04 | Fronteiras verifiedAt/validUntil, null permitido/proibido pelo método; validade durante preview/commit e depois da ativação; resultado SATISFIED histórico torna-se UNAVAILABLE, nova avaliação pode ser UNKNOWN/CURRENT; consumidor sem acesso recusa sem alterar integridade do snapshot; F11 indisponível/retirado e referências incompatíveis. |
| ACT-05 | Isolamento A/B em preview, activate, active, snapshot, histórico e lookup; IDOR, referências cruzadas e projeções sem divulgação, incluindo digests. |
| ACT-06 | Grants explícitos, autor impedido, aprovador elegível, MFA ausente/expirado, service actor recusado; sem terceira pessoa implícita. |
| ACT-07 | Primeira ativação, substituição, duas sessões concorrentes, CAS/ABA e idempotência com payload igual/diferente; apenas um resultado por intenção. |
| ACT-08 | Revogação de grants/membership/sessão/MFA, aprovação e referências concorrentes: ambos os ordenamentos, caminho real HTTP/PostgreSQL e guardas até commit. |
| ACT-09 | Falha F7 após materialização e antes do commit não deixa snapshot/ponteiro/ativação parcial; falhas antes/depois do commit recuperadas por recibo e lookup. |
| ACT-10 | Browser → 503 concorrente na mesma sessão → lookup; preservar intenção, não duplicar efeitos; UNKNOWN persistente, bloqueio limitado e orientação de suporte. |
| ACT-11 | Alteração relevante invalida confirmação; preview antigo não autoriza commit; outras operações independentes continuam disponíveis durante UNKNOWN. |
| ACT-12 | Manifesto exato, tuple inválido/futuro/N-1 não autorizado, handler ausente e fingerprint errado falham fechados; migrations up/down e downgrade ocupado, privilégios e admissão. |
| ACT-13 | Overlays/baseline mais amplo recusados sem perda; snapshots anteriores continuam históricos; alteração do ponteiro não apresenta avaliações antigas como atuais. |
| ACT-14 | Avaliação fixa entradas exatas; corridas de critérios/oportunidade/ativação/regras e referências preservam consistência e precedência de freshness. Competência V1 não produz incumprimento sem fonte. |
| ACT-15 | Regressão da publicação temática/PQ1: continuam imutáveis e inativas; publicar não cria READY/ativação/avaliação. Nenhum score, candidatura, mensagem ou decisão automática. |

## 7. Sequência mínima e condições de início

1. Contrato Ready: A1 aprovada, sem decisões adicionais. Na tarefa própria de implementação, instalar a tuple/configuração governada e os adaptadores definidos, preservando todos os limites conjuntos. D1–D7 não voltam a aprovação. Testes e medição de capacidade são gates posteriores; esta tarefa não inicia implementação.
2. Implementar armazenamento/manifestos e materializador puro com testes determinísticos/temporais; novas migrations e gates descartáveis, preservando bundles anteriores.
3. Implementar preview, ativação transacional, leitura e recuperação com grants/SoD/MFA; executar ACT-02–09/12/13 no caminho real.
4. Implementar coordenadamente o consumidor F14-PQ1 mínimo avaliar/consultar sob a tuple e admissibilidade aqui especificadas e o contrato F14: entrada ativa exata, três avaliadores, resultado persistido e explicações autorizadas. Reutilizar as operações/grants avaliar/consultar definidos em F14, com CAS, F7 e recuperação no seu caminho real. Decisões humanas continuam separadas; não declarar o contrato F14 integral concluído por este recorte.
5. Entregar UI integrada e ACT-01/10/11/14/15; revisão read-only e decisão humana própria antes de fecho. Sem disponibilizar ativação isoladamente enquanto o consumidor estiver ausente.

Limitações anteriores permanecem: UNKNOWN sem resolução automática garantida; cobertura histórica partilhada não prova corridas novas; provas locais não validam staging, produção, IdP externo ou dados reais. Esta especificação não inicia implementação, migrations, ativação ou avaliação. Próximo incremento concreto proposto: F13-PQ1-ACTIVATE, coordenado com a entrega técnica de avaliação/consulta F14-PQ1 e condicionado aos pontos acima.

## Progresso de implementação — 2026-10-17

Pedido humano posterior ao Ready iniciou a tarefa própria. Primeiro bloco: tuple/limites, materializador puro da origem publicada exata, leitor de publicação histórica, leitor agrupado de revogações sob lock existente, três avaliadores determinísticos e freshness separados. Nenhum destes módulos está exposto em rotas ou ativado na composição de produção. Testes focados 15/15 e suite backend 814/814; probe PostgreSQL descartável do leitor com migrations existentes, runtime/RLS, dois ordenamentos do lock e recusa de autocommit. Ver [evidência e lacunas](../reviews/f13-pq1-activation/README.md).

Estado permanece In Progress, não Review: faltam persistência/novas migrations e admissão, ativação/CAS/recuperação, composição F2/F5/F7/F11 e validação de referências atuais, HTTP, UI integrada e gates ACT completos. Não houve fecho ou ativação isolada. A medição de capacidade síncrona máxima também permanece pendente.

### Segundo bloco — persistência e operações transacionais (2026-10-17)

Implementadas migration 019/admissão e operações internas `activate`, `active`, `evaluate`, `read`, com snapshots/avaliações append-only, ponteiro CAS, recibos, guard de autoridade, aprovação/SoD/MFA, referências atuais, auditoria transacional e recuperação existente. Focados 21/21 e backend 820/820; provas PostgreSQL descartáveis e lacunas discriminadas em [evidência transacional](../reviews/f13-pq1-transactions/README.md). Este registo atualiza as lacunas de persistência do primeiro bloco sem reescrever a sua evidência histórica.

Permanece **In Progress**: sem preview/HTTP/UI/lookup externo nem montagem produtiva. Faltam os gates integrais ACT, revogação/F11/deadlines específicos do consumidor, capacidade máxima e percurso browser coordenado. A publicação continua inativa por si; ativação exige a nova operação explícita, ainda interna. Nenhum fecho anterior é reaberto e não há fecho humano deste contrato.

### Terceiro bloco — preview, lookup e HTTP/UI integrada (2026-10-17)

Implementados preview autorizado/token opaco, lookup exato, contexto/histórico/snapshot e rotas avaliar/consultar, com UI `/pre-qualificacao`. Composição conjunta opt-in F13/F14, sem ativação isolada. Central 013 admite apenas lookup fechado; tenant 019 inalterada. [Evidência, hashes e matriz acumulada](../reviews/f13-pq1-http/README.md): focados 30/30, backend 837/837, frontend 70/70/build, migration Central descartável e HTTP/browser A/B. API simulada dos 8 testes frontend novos distingue-se do browser com PostgreSQL real e IdP sintético.

Browser cobre perda de resposta após commit → 503 → reload → lookup, não a causa concorrência na mesma sessão. UNKNOWN persistente e bloqueio limitado têm regressões de UI; sem resolução automática garantida. Gates de revogação/F11/deadlines específicos, capacidade conjunta e concorrência da mesma sessão permanecem pendentes. **In Progress**, sem fecho humano; os parágrafos dos blocos anteriores descrevem o estado histórico de cada entrega.


## Consolidação coordenada — 2026-10-17

Percurso HTTP/UI inclui agora decisões humanas locais vinculadas à avaliação exata e histórico append-only. Tenant 020/Central 014 acrescentam persistência/lookup de decisão, sem alterar 019/013 nem os fechos do produtor. [Matriz consolidada única](../reviews/f13-pq1-consolidated/README.md): provas específicas de revogação, F11, expiração exata, concorrência de critérios/ativação, CAS/F7 e recuperação. Focados 36/36, backend 844/844, frontend 75/75/build. Aprovação do fecho continua exclusivamente humana; estado não promovido enquanto faltarem os gates finais aí indicados. Sem score, candidaturas ou comunicação.

Resultado consolidado: **BLOCKED**, apenas C-PQ1-01 impede promover o marco. O percurso funcional e os gates de concorrência/segurança passaram; a capacidade do histórico de autoria continua por resolver sem contornar o teto canónico. Ver a matriz ativa para o diagnóstico e a prova mínima exigida. F13 integral In Progress; nenhum fecho humano deste marco.
