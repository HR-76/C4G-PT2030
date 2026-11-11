# F13 — Ativação do perfil e contrato de consumo

Estado: **Draft — proposta para aprovação**, 2026-10-15. Sem autorização de implementação. F13 integral permanece **In Progress**; interface editorial/Central 010 e F13/016 permanecem **Complete**, sem alteração dos fechos.

## Base contratual e distinções

Fontes aprovadas: [versionamento/ativação](../decisions/f13-versioning-and-activation.md), [scope/herança](../decisions/f13-organizational-profile-scope-and-inheritance.md), [completion](../decisions/f13-completion-policy.md), [conhecimento](../decisions/f13-knowledge-state-policy.md), [compatibilidade](../decisions/f13-schema-policy-compatibility.md), [autorização](../decisions/f13-authorization-and-segregation.md), [confidencialidade](../decisions/f13-confidentiality-projection-purpose.md) e [fronteira F14](../decisions/f13-exclusions-vs-f14-rules.md). Contratos fechados: [editorial 016](f13-editorial-baseline-publication.md) e [interface/Central 010](f13-minimal-editorial-interface.md).

| Conceito existente | Garantia e limite |
|---|---|
| Versão PUBLISHED | Conteúdo aprovado imutável, publicado e candidato a ativação; não é snapshot efetivo nem ponteiro ativo. |
| Snapshot READY | Materialização imutável que passou todas as policies aplicáveis ao schema/scope/domínios e tuple exata. Readiness é contratual, não verdade factual nem elegibilidade. |
| Versão ativa | Versão componente identificada pelo snapshot READY apontado pelo ponteiro ativo ORGANIZATION. Atividade é relação do ponteiro, não novo estado editorial. |
| Consumo F14 | Exige READY, autorização, tuple/consumer contract compatíveis e dados suficientes para os requisitos da regra concreta; READY isolado não basta. |

O código atual confirma o limite: editorialRelease.js fixa F13_EDITORIAL_READ_V1 e f14Consumable=false; editorialMaterial.js define recorte temático; migration 016 cria candidatura/versão/publicação/idempotência, não snapshot efetivo ou ponteiro ativo. O catálogo de operações aprovado não equivale a serviço implementado.

**Conclusão:** a baseline atual não pode ser ativada diretamente pelo contrato fechado. As decisões permitem policies por schema/scope/domínio; não obrigam todos os domínios para qualquer finalidade. Uma finalidade limitada de consulta temática institucional exigiria aprovação própria e um novo bundle de ativação que aceite explicitamente a versão editorial como origem. A análise de utilidade abaixo recomenda adiar essa implementação, por falta de consumidor imediato demonstrado. Isto é escolha nova, não autorização já existente. Para consumo geral por F14 será necessária cobertura mais ampla, definida pelos consumidores e pelas policies aplicáveis, incluindo constraints. Nunca omitir uma policy aplicável para conseguir READY.

## Utilidade imediata e recomendação revista

**Recomendação: adiar ativação até existir cobertura multidomínio necessária a um consumidor concreto. D1–D2 continuam propostas, não aprovadas.** Esta recomendação substitui a recomendação inicial de implementar já a ativação temática; o desenho técnico abaixo permanece uma opção condicionada.

Evidência: [visão do produto](../project-overview.md) identifica gestor de financiamento e utilizador de consulta, mas não uma decisão autónoma baseada no perfil temático ativo. [Matching e qualificação](matching-and-qualification.md) exige elegibilidade, competências, geografia, capacidade financeira/operacional e explicações, além de temas. No código, EditorialProfile.jsx já lista versões e apresenta o seu conteúdo/completude; editorialRelease.js limita o consumidor a F13_EDITORIAL_READ_V1, com f14Consumable=false. Não foi identificado nestas fontes um consumidor aprovado que precise agora de resolver “a versão temática atual”. A existência de roles e de uma decisão arquitetural de ativação não prova essa necessidade de negócio.

**Quem consultaria e para quê?** Na opção de implementação imediata, um gestor de financiamento ou utilizador de consulta com READ poderia abrir “Perfil da organização” e consultar “Perfil temático atual”; um checker com grant de ativação escolheria a versão de referência. A única decisão suportada seria qual versão temática a organização designa como atual. Não há evidência de um processo aprovado que dependa dessa escolha; não se pressupõe que ela qualifique oportunidades ou autorize candidaturas. Os nomes de perfis não concedem permissões.

**Benefício incremental concreto:** seleção inequívoca de uma referência corrente, resolvida no servidor, e histórico auditado das substituições. A leitura publicada inativa já oferece conteúdo, completude editorial e identidade exata reproduzível; ativação não acrescenta factos, verificação ou cobertura. O benefício técnico é demonstrável pela ausência de ponteiro ativo no contrato 016, mas o seu valor operacional imediato não está demonstrado. Um novo botão de consulta não constitui, por si só, um consumidor justificado.

| Opção | Entrega e custo mínimo | Avaliação |
|---|---|---|
| Implementar agora consulta temática ativa | Snapshot/bundle/policy próprios, ponteiro, cutover/CAS, F7, recuperação e percurso UI completo; F14 continua recusada | Tecnicamente coerente, mas acrescenta infraestrutura e uma escolha editorial sem utilização operacional comprovada. |
| Adiar até cobertura multidomínio necessária a um consumidor concreto | Manter leitura editorial existente; fechar primeiro requisitos de dados/constraints e contrato do primeiro consumidor | Recomendada: liga materialização/ativação à finalidade de matching já prevista, sem antecipar infraestrutura nem exigir todos os domínios por princípio. |

### Percurso mínimo, apenas se a opção imediata for aprovada

1. No índice existente, selecionar uma versão publicada e abrir o detalhe já disponível.
2. Acionar “Definir como perfil temático atual”; mostrar organização, versão escolhida, referência atual (ou ausência), finalidade limitada e reason. Reutilizar MFA, releitura e confirmação explícita; sem execução automática no retorno.
3. Após receipt confirmado, o índice apresenta um bloco “Perfil temático atual”, com identidade da versão/snapshot e acesso ao detalhe. Sem ativo, mostrar ausência explicitamente; não escolher a última versão publicada.
4. Selecionar outra versão publicada, comparar referência atual e candidata e confirmar substituição com revisão esperada do ponteiro. Em conflito, reler e pedir nova confirmação. Preservar acesso ao histórico.

**UI adicional necessária:** bloco do perfil atual no índice, ação/confirmador de ativação-substituição no detalhe de versão e identificação de referência atual/histórica. Reutilizar os três modelos de ecrã, seletor de organização, mensagens, foco e recuperação; não é necessário um quarto ecrã. Backend mínimo: snapshot imutável, bundle/policies, resolução do ativo/leitura por ID, ativação transacional, CAS, auditoria e recuperação autorizada; os endpoints editoriais existentes não oferecem estas operações. Uma entrega só de backend não satisfaz esta opção.

Texto permanente proposto: **“Perfil temático atual — apenas temas e prioridades. Não disponível para matching; constraints não avaliadas.”** READY continua propriedade técnica do snapshot para o contrato limitado, não um selo “apto para matching”. Uma aptidão futura só pode ser determinada para um contrato consumidor e finalidade concretos, nunca pelo ponteiro ativo ou por um badge global.

### Próximo incremento recomendado para aproximar o produto do matching

Especificar o **contrato mínimo de dados F13→F14 para a qualificação de uma oportunidade concreta**, apoiado no processo de elegibilidade/explicação já aprovado. Entregáveis: matriz requisito do consumidor → domínio/slot → origem governada → estado admissível/validade/verificação → cobertura disponível ou lacuna; tratamento explícito de constraints PROHIBITED/UNAVAILABLE e de desconhecimento; identidade de oportunidade/revisão, snapshot e versões contratuais. Não definir pesos, scoring ou regras de matching nesta tarefa.

A matriz deve identificar o menor conjunto multidomínio necessário, sem presumir que todo o perfil é obrigatório, e ordenar as lacunas de authoring/publicação/constraints que impedem esse consumo. Só depois propor implementação da primeira lacuna necessária e materialização/ativação para esse contrato. Nem esse próximo incremento nem D1–D2 ficam aprovados aqui.

## Âmbito técnico da opção temática, condicionado a aprovação

Materialização síncrona, primeira ativação e substituição manual imediata de uma baseline ORGANIZATION, numa coorte explícita sem overlays; leitura exata por snapshot e resolução autorizada do ativo. Uma baseline ativa por tenant, sem ponteiros paralelos por finalidade. O contrato de consumo deste incremento serve apenas consulta temática institucional; F14 fica recusada.

Incluir substituição evita uma entrega utilizável só uma vez: CAS, preservação histórica e cutover são o mesmo mecanismo da primeira ativação. Sem scheduling, jobs, overlays, arquivo, restore, export ou rollback funcional nesta entrega. Se existirem overlays ativos ou uma baseline ativa de contrato mais abrangente, recusar este comando limitado: não os desativar implicitamente nem reduzir cobertura. A futura coorte ampla terá de concretizar omissão/desativação atómica. Org suspensa/arquivada é recusada pelos gates existentes; não exige implementar arquivo de versões agora.

Interface mínima adicional: ação de ativação em versão publicada, mostrando finalidade/cobertura, versão atual e substituta, reason fechado, MFA, releitura e confirmação; indicador do snapshot ativo e acesso histórico. Reutilizar navegação, seletor, tokens e recuperação da interface fechada, sem redesenho.

## Contrato proposto do snapshot

- Identidade própria effective_profile_version_id, tenant e scope ORGANIZATION resolvidos no servidor; referência exata à versão editorial publicada, candidatura/revisão de origem e respetivos seals. Não extrair novamente do draft corrente.
- Schema de snapshot e materializador versionados; bundle/manifest, completion policies, projection policy, purpose/reason catalogs e releases/concept IDs exatos. Novo bundle declara a compatibilidade da origem 016 sem reescrever o seu bundle nem alterar os seus flags.
- Conteúdo mínimo: THEMATIC_AREA e STRATEGIC_PRIORITY, referências e estados preservados. Cobertura explícita: estes domínios incluídos; competências, financeiro, operacional, território, beneficiários e constraints não cobertos. constraintsAssessed=false; nenhuma lista vazia interpretada como ausência institucional de constraints; f14Consumable=false neste contrato. Metadados de cobertura não constituem novos estados de conhecimento/lifecycle.
- Completion recalculada sobre conteúdo interno, com resultado COMPLETE/INCOMPLETE e findings ordenados, policy e digest próprios. Proposta de slots: temas KNOWN; prioridades KNOWN ou UNKNOWN explícito exclusivo; manter limites da origem, até 100 itens. UNVERIFIED permanece explícito e só é admitido por policy; aprovação editorial não verifica factos.
- Ausência é não materializado, nunca UNKNOWN/NONE/zero por default. NONE e NOT_APPLICABLE não são introduzidos na origem temática; WITHHELD é projeção de conhecimento interno, não substituto de UNKNOWN. Estados revogados, expirados, disputados ou conflituosos em slots obrigatórios impedem readiness corrente.
- Separar digest da origem, digest editorial, semantic_digest do snapshot interno, completion digest e projection_digest ligado à policy/projeção autorizada. Snapshot e referências são imutáveis; apenas ponteiro muda. Browser recebe IDs, contexto sanitizado e token opaco, não digests internos ou dados excluídos. Referências F11 nunca concedem leitura de documentos.

## Ativação e transições

| Origem | Operação/resultado |
|---|---|
| PUBLISHED inativa, sem ponteiro | Validar/materializar READY e criar ponteiro; activation record ACTIVATED. |
| PUBLISHED inativa, ponteiro esperado existente | Validar/materializar READY e trocar ponteiro atomicamente; registar substituição REPLACED e ativação ACTIVATED em evidência append-only ligada, sem reescrever registos anteriores. |
| Falha estrutural/completion/referência/autoridade/CAS | Recusa sem snapshot ou ponteiro parcial; versão publicada e ponteiro anterior preservados. |
| Commit incerto | Reconciliação existente; resultado desconhecido não é estado novo do perfil nem prova de rollback. |

Usar F13_PROFILE_COHORT_ACTIVATE / organization_profile.activate / PROFILE_ACTIVATION_COHORT, reason catalog fechado, RECENT_MFA e stable human subject. Autor de qualquer membro não ativa; preservar também impedimento do submissor da candidatura editorial. Checker pode ativar com grant próprio; nenhuma terceira pessoa obrigatória; service actor não ativa. READ não concede ativação.

Comando proposto, não endpoint existente: versão exata, token opaco de confirmação vinculado ao recurso e ao ponteiro esperado, idempotencyKey e reason autorizado. Organização, coorte, policy, autoria e digests são server-loaded. Primeira ativação compara ausência; substituição compara identidade e geração do ponteiro para impedir ABA. Renovar token não muda intenção; intenção fixa versão, ponteiro esperado e reason, não bytes do token.

Na mesma transação tenant: revalidar autoridade/aprovação e respetivos limites temporais, compatibilidade corrente N, referências e completion; materializar ou reutilizar apenas snapshot rigorosamente idêntico; persistir activation records, F7 PROFILE_COHORT_ACTIVATED, receipt e CAS do ponteiro. Guard inicial/final e auditoria crítica existentes permanecem obrigatórios. Duas ativações concorrentes: uma vence, outra recusa; falha F7 reverte tudo. Reconciliação source-local existente trata commit incerto, sem retry com intenção nova enquanto pendente.

Referência revogada/incompatível antes do commit impede cutover. Alteração posterior não reescreve snapshot nem aponta automaticamente para versão anterior: consumo corrente revalida admissibilidade e recusa, preservando ponteiro/histórico para ação humana. Leitura histórica autorizada distingue conteúdo então válido de autorização de uso corrente; não é fallback operacional.

## Regra verificável de substituição proposta

A substituição exige **compatibilidade governada e não redução de cobertura contratual**, não contagem de domínios. O servidor carrega a tuple atual, a candidata e uma relação de substituição explicitamente publicada/versionada no manifest ou catálogo governado associado. Essa relação fixa schemas, bundles, policies, consumer contracts/finalidades suportados e obrigações de cobertura. Relação ausente, ambígua ou incompatível: recusar; o caller não declara equivalência.

A candidata deve manter cada obrigação de cobertura do contrato atual: slots, representação semântica e unidades, scope, constraints aplicáveis, estados de conhecimento/verificação admissíveis e requisitos de validade, segundo a relação autorizada. Um slot conhecido passar a UNKNOWN não é automaticamente perda de cobertura se ambos forem admitidos pelo mesmo contrato; falha se uma obrigação preservada exigir KNOWN. Ter mais domínios não compensa retirar uma constraint ou mudar o significado de um slot. Não se exige conservar os mesmos valores temáticos: isso impediria uma atualização legítima.

Condições cumulativas: candidata publicada e elegível, READY pela tuple corrente N, relação de substituição aprovada sem redução de obrigações, completude/referências/autoridade válidas e CAS sobre **identidade + revisão monotónica esperada do ponteiro ativo**. Primeira ativação exige ausência esperada; revisão não é reutilizada quando um snapshot antigo volta a ser selecionado. Se outra operação vencer, recusar a intenção obsoleta; nunca trocar silenciosamente a expectativa durante retry. Token renovado conserva essa intenção.

Cutover, novo registo append-only, F7 e receipt são atómicos. Snapshots, versões e registos anteriores permanecem imutáveis e acessíveis apenas sob autorização; falha preserva o ponteiro anterior. O contrato temático continua a recusar F14, mesmo após substituição válida; nenhum alargamento de cobertura altera automaticamente a capacidade de consumo. Um contrato F14 futuro tem de ser explicitamente satisfeito e autorizado.

Casos mínimos: mesma contagem com slot incompatível → recusa; mais domínios com constraint omitida → recusa; tuple desconhecida sem relação governada → recusa; mudança temática sob o mesmo contrato completo → permitida; UNKNOWN num slot que exige KNOWN → recusa; duas substituições com a mesma revisão esperada → apenas uma vence; replay confirmado não cria segundo cutover; histórico conserva digests.

## Consumo autorizado e fronteira F14

Ports propostos, ainda não existentes: resolver ativo autorizado e ler snapshot por identidade exata. Resolver devolve identidade do snapshot/activation record e contrato; leitura nunca segue um novo ponteiro em lugar do ID pedido. Repetição histórica usa a mesma identidade e versões. Um consumidor exige finalidade e contrato registados no servidor, cobertura, estados admissíveis e tuple completa; caller não escolhe policy permissiva.

Para integração confiável futura, o handle referencia effective_profile_version_id, digest apropriado à autorização e versões exatas de schema/bundle/consumer contract. F14 fixa também oportunidade/revisão e rule version; não reconstrói conteúdo a partir de heads. Projeção redigida identifica projection policy/digest; não entrega semantic_digest restrito para contornar confidencialidade. READ normal reutiliza F13_PROFILE_READ; valores restritos exigem grants, purpose/reason e MFA próprios. Consumidor técnico só opera sob identidade/grants explicitamente aprovados, sem credencial ampla.

Recusar explicitamente ausência de ativo, finalidade não suportada, cobertura insuficiente, estado de conhecimento inadequado, referência revogada, digest divergente ou tuple incompatível. Estes são motivos de recusa, não estados editoriais novos. Erros públicos não revelam existência cross-tenant. Sem fallback para outra versão, policy, release, label, schema ou organização. N/N-1 apenas por tuple e adapter explícitos; novas ativações só em N.

Disponível: dados temáticos, completude editorial, identidade/autoria, publicações imutáveis, F5/F7/guard e recuperação. Existem módulos de competências, financeiro, operacional e populações; isso não comprova uma baseline integrada, aprovada e consumível. Faltam snapshot/ponteiro/materializador e contrato consumidor; para F14 faltam agregação governada dos domínios necessários, constraints representadas e aprovadas, policies de suficiência e contrato de regras F14.

Constraints futuras PROHIBITED e UNAVAILABLE são assertions explícitas com authority, período, scope, provenance e verificação; não são decisões de elegibilidade. UNKNOWN é desconhecimento declarado; incompatibilidade de schema/policy recusa o consumo; impedimento explícito é uma assertion que só uma regra F14 aplicável pode interpretar. Constraints não representadas não significam “sem impedimentos”. Não definir pesos, scoring, regras de matching ou exclusões por oportunidade neste incremento.

## Aceitação e testes após aprovação

1. Primeira ativação e substituição A/B: apenas scope autorizado; IDs/token/receipt/referências de B recusados em A com identidades distintas. Uma tentativa de atribuir à mesma identidade uma segunda membership não removida é recusada. RLS, grants mínimos e admissão reais em PostgreSQL descartável.
2. READY só com todas as policies da tuple satisfeitas; corpus determinístico de KNOWN/UNKNOWN, ausência, UNVERIFIED e estados inválidos; constraints não cobertas recusam consumidor que as exige. A origem 016 nunca ganha READY por alteração retroativa.
3. Maker/submissor recusados, checker autorizado, grant próprio, MFA e revogação/expiração exata entre validações; sem efeito parcial.
4. Corrida CAS e ABA, replay com token renovado, chave divergente, falha F7, crash/commit incerto e quatro outcomes de recuperação; uma só ativação efetiva, sem sucesso falso. Erro preserva ponteiro anterior; snapshot anterior permanece legível sob autorização.
5. Pins de schema/policy/catalog/bundle; tuple cruzada, N-2/futura e adapter ausente recusados; N-1 apenas quando declarado. Revogação após ativação bloqueia uso corrente, não altera história.
6. Projeções e erros sem material excluído, digests restritos ou secrets; listas autorizadas. Browser: nova confirmação após MFA, troca A/B, respostas tardias, reload/recovery, teclado/foco/mobile e distinção visível entre publicada, ativa e aptidão limitada.
7. Migrations aditivas com up/down seguro, manifestos/checksums/fingerprints e regressões dos consumidores afetados, preservando Central 009/010 e tenant 016. Nenhum teste executado nesta proposta documental.

## Escolhas novas e sequência mínima

Já aprovados: separação publicação/ativação, READY por policies, coorte atómica, snapshot imutável, CAS/idempotência/F7, maker-checker/MFA, confidencialidade e compatibilidade explícita; F13 não decide matching.

**D1 proposta, não aprovada — recomendação: adiar:** ativação limitada à consulta temática institucional, com novo schema/bundle/consumer contract e F14 recusada. Alternativa relevante: adiar ativação até baseline multidomínio/constraints; aumenta âmbito e dependências. Não promover a policy editorial 016 a policy geral por inferência.

**D2 proposta, não aprovada — manter condicionada ao consumidor que justificar ativação:** primeira ativação e substituição no mesmo incremento, coorte ORGANIZATION sem overlays; recusa perante overlays ativos ou substituição que reduza cobertura de contrato mais amplo. Arquivo/rollback/overlays ficam para contratos próprios.

Dependências técnicas reais antes de implementar: fechar tuple/schema de snapshot e policy concreta do recorte, purpose/reason de ativação e consumo, projection/consumer contract, schemas de eventos e limites síncronos; verificar bindings de guard/recovery e admissão para nova operação. Central 010 admite lookup apenas das cinco operações editoriais atuais: recuperação de ativação requer extensão aditiva específica se reutilizar esse lookup, nunca edição de 010 ou allowlist genérica. Não presumir número de migration disponível.

Sequência técnica da opção temática, apenas após aprovação explícita; não é o trabalho seguinte recomendado: (1) fechar contratos técnicos e corpus; (2) persistência/materializador, RLS e migração aditiva; (3) ativação transacional/CAS/F7/recovery e ports de consumo; (4) ligação mínima à interface e leitura do ativo/histórico; (5) gates PostgreSQL/browser A/B, regressões, revisão e decisão humana. Sem serviços/jobs novos por rotina.
