# F14-PQ1 — primeira pré-qualificação parcial F13→F14

Estado técnico: **percurso integrado implementado; gate C-PQ1-01 resolvido e pronto para revisão humana restrita**. D1–D7 aprovadas e A1 preservada. O marco integra ativação, avaliação parcial, consulta e decisões humanas locais; não representa F14 integral Complete. [Matriz ativa de capacidade e pendências](../reviews/f13-pq1-capacity-fix/README.md), [reconferência do código atual e limites da reutilização](../reviews/f13-pq1-capacity-fix/recheck-history-gate.md) e [matriz consolidada histórica](../reviews/f13-pq1-consolidated/README.md). Os fechos restritos já registados, incluindo F13-PQ1-PUBLISH, permanecem preservados; esta reconferência não declara novo fecho.

Registo histórico da proposta anterior à autorização de implementação: Estado: **Contrato proposto do consumidor — escolhas novas D1–D7 aprovadas em 2026-10-16**. Aprovação não autoriza implementar F14 nesta entrega. Os nomes de operações, resultados e políticas abaixo não representam capacidades instaladas. O incremento separado [F13-PQ1-PUBLISH](f13-pq1-publish.md) está **Complete — fecho humano restrito**, limitado à publicação multidomínio imutável e inativa.

## Registo de aprovação humana — 2026-10-16

O utilizador aprovou as escolhas novas D1–D7 apresentadas para decisão. Não se reabrem regras aprovadas de isolamento, identidade, READY, lifecycle, imutabilidade, segregação/MFA F13 ou ausência de prova negativa por omissão. As recomendações abaixo ficam adotadas apenas no âmbito novo correspondente; o quadro da secção 8 preserva o texto das escolhas.

- D1: oportunidades privadas, baseline sem overlays, três avaliadores e global INDETERMINATE; UI «Análise parcial — elegibilidade não determinada».
- D2: competência V1 apenas SATISFIED/UNKNOWN; NOT_SATISFIED_WITH_EVIDENCE não é saída executável. Correspondência temática não é elegibilidade e ausência de correspondência não é impedimento obrigatório.
- D3: temas KNOWN e prioridades KNOWN/UNKNOWN mantidos; slot de competências admite UNKNOWN explícito. Validade [verifiedAt, validUntil); ausência de expiração só quando o método permitir. Publicação não exige verificação universal nem produz admissibilidade F14.
- D4: decisões locais separadas, ligadas à avaliação CURRENT exata, append-only e com motivos/justificação propostos; solicitar informação apenas regista necessidade, sem comunicação.
- D5: grants distintos avaliar/consultar/decidir; explicação autorizada cumulativa, sem segregação adicional entre avaliar e decidir e respeitando assurance das fontes.
- D6: UNKNOWN limitado à intenção e gravações conflitantes da mesma análise/oportunidade para o sujeito; leitura, outras oportunidades e perfis independentes não ficam bloqueados. sessionStorage é proteção de UX, não exclusão entre sessões; CAS/idempotência/guardas asseguram correção no servidor. Suporte correlaciona requestId/correlationId, guardas e recibos; sem prova conclusiva mantém UNKNOWN, sem garantia automática.
- D7: primeiro publicação multidomínio imutável **inativa**; materialização/ativação só posteriormente integradas com o consumidor. Não implementar ativação temática isolada.

Apenas [F13-PQ1-PUBLISH](f13-pq1-publish.md) tem contrato técnico agora fechado. Aprovação de D1–D7 não significa F14 Ready/implementado/Complete. F13 integral permanece In Progress e o incremento de critérios permanece fechado. Registo anterior: este documento estava Draft com D1–D7 pendentes; os critérios de aceitação F14 continuam por executar.

## Fronteira e fontes de verdade

Fatia vertical mínima: selecionar uma oportunidade privada F12 e critérios confirmados atuais, consumir um snapshot organizacional F13 READY compatível e ativo, avaliar três tipos de critérios, consultar explicações e registar uma decisão humana separada. Sem score, ranking, elegibilidade integral, recomendação automática, candidatura, comunicação externa ou IA.

O [incremento de critérios evidenciados](f13-f14-minimal-qualification-contract.md) está **Complete, com fecho humano restrito**, exclusivamente criar → rever → confirmar → consultar. Não é reaberto. Confirmação continua exclusivamente editorial. F13 integral permanece **In Progress**; este documento não fecha F13→F14. Evidência histórica: [incremento](../reviews/opportunity-evidenced-criteria/README.md) e [freshness/matriz](../reviews/opportunity-criteria-freshness/README.md). Resultados desses registos não foram reexecutados nesta proposta.

Aplicam-se os contratos [F13](f13-organizational-profile.md), [F14](matching-and-qualification.md) e as decisões aprovadas de [versionamento/ativação](../decisions/f13-versioning-and-activation.md), [compatibilidade](../decisions/f13-schema-policy-compatibility.md), [competências](../decisions/f13-competencies-and-experience.md), [completude](../decisions/f13-completion-policy.md), [projeção/finalidade](../decisions/f13-confidentiality-projection-purpose.md) e [autorização/segregação](../decisions/f13-authorization-and-segregation.md). A [ativação temática limitada](f13-profile-activation-and-consumption.md) continua adiada; as suas decisões não são implicitamente aprovadas aqui.

Recomendação D1: começar apenas com oportunidade privada e baseline organizacional sem overlays. Central, perfis por unidade/coorte e migração de baselines mais amplos exigem extensão explícita. A presença de overlays ou de obrigações não preservadas bloqueia esta via mínima, sem os ignorar ou substituir.

### Integração técnica — A1 aprovada em 2026-10-17

A [proposta F13-PQ1-ACTIVATE](f13-pq1-materialization-and-activation.md) fixa a tuple produtor → snapshot → `F14_PQ1_CONSUMER_V1`, policies, reasons, cobertura e limites. A1 aprovada permite READY com histórico íntegro expirado/revogado e revalidação factual no consumo: sem prova atual, competência UNKNOWN com motivo, nunca conversão do estado persistido. Incompatibilidade, integridade inválida e acesso insuficiente recusam. Uma avaliação histórica SATISFIED perde utilização atual (UNAVAILABLE) quando o seu suporte expira/revoga, sem ser reescrita; nova avaliação pode ser UNKNOWN/CURRENT. Esta precisão de readiness e dependências foi aprovada; F13-PQ1-ACTIVATE passou de Ready a In Progress por pedido humano posterior; núcleo implementado e ainda não exposto, com evidência parcial no contrato. O consumo consulta o ledger autoritativo de revogação sob o lock comum ao escritor, sem confiar apenas no snapshot. Resultado automático, freshness e autorização de leitura são separados. Não altera D1–D7 nem inicia implementação. A cláusula abaixo «quando exigida pela política» mantém-se: prova atual é exigida para SATISFIED, não para cada competência num snapshot estruturalmente completo.

## 1. Entradas, identidade e atualidade

| Entrada | Identidade e admissibilidade propostas |
| --- | --- |
| Organização e sujeito | Resolvidos pelo servidor e membership central atual; nunca pelo corpo do pedido como autoridade. |
| Oportunidade | ID tenant-local e revisão exata atual, acessível; sem resolver silenciosamente outra revisão. |
| Critérios | ID e digest da revisão exata, **head CONFIRMED** e freshness **CURRENT**. Um novo head Draft impede usar a confirmação anterior como atual. |
| Perfil | Snapshot ID/versão imutável **READY**, revisão publicada de origem, activation ID e geração do ponteiro ativo. Um bundle editorial publicado não satisfaz este requisito. |
| Cobertura | Temas, prioridades e competências; experiências, verificações e documentos necessários como suporte versionado. Slots e estado de conhecimento explícitos. Constraints não avaliadas declaradas como tal. |
| Compatibilidade | Tuple exato admitido por manifesto: contrato de critérios, schema de perfil/snapshot, materializador, completion/verification/projection policies, releases taxonómicos e métodos, purpose/reason, consumidor, regras e schema de resultado. Não aceitar combinações cartesianas de versões isoladamente conhecidas. |
| Regras | Bundle determinístico imutável, versionado e selecionado pelo servidor. Sem código livre, DSL ou regras fornecidas pelo cliente. |
| Tempo | `evaluatedAt` UTC atribuído no servidor e persistido; não é uma data retroativa escolhida pelo utilizador. |

IDs conceptuais com `conceptId + schemeId + releaseId` devem coincidir exatamente. Sem equivalência por rótulo, tradução, hierarquia, proximidade, threshold de nível ou período inventado. O único requisito temporal suportado inicialmente para competência é o `EVALUATION_INSTANT` já expresso pelo template; afinidades não recebem requisitos temporais adicionais.

Política proposta de atualidade do resultado: guardar entradas e resultado imutáveis; calcular a classificação de apresentação sobre condições **atuais**, sem reescrever nem recalcular resultados históricos. Reutilizar os nomes **UNAVAILABLE → REVIEW_REQUIRED → CURRENT**, com essa precedência, mas implementar e testar a validação própria deste consumidor:

- **UNAVAILABLE**: referências inacessíveis/inadmissíveis, tuple sem leitor autorizado ou impossibilidade de validar as condições necessárias. A resposta pode ter de ser negada por autorização, sem revelar sequer a existência do resultado.
- **REVIEW_REQUIRED**: oportunidade, head de critérios, snapshot ativo/geração ou regras aplicáveis mudaram, mantendo-se as referências históricas admissíveis. Nova revisão de perfil ainda em authoring não muda o baseline ativo por si só.
- **CURRENT**: todas as identidades permanecem atuais e referências, verificação e validade continuam admissíveis. A expiração/revogação de suporte que torna a referência inadmissível prevalece como UNAVAILABLE, mesmo com outras mudanças.

A lista, detalhe e head devem aplicar a mesma função de validação, com leituras agrupadas. Uma nova avaliação cria novo ID; não atualiza a anterior. Leitura histórica é identificada como histórica e reautoriza acesso às fontes atuais. Adaptação N/N-1 só se explicitamente admitida; nunca presumir compatibilidade de bundle ou de taxonomia.

## 2. Primeiro conjunto de avaliadores

### Competência verificada obrigatória

| Entradas | Evidência exigida | Resultado por critério |
| --- | --- | --- |
| Requisito C exato; assertion KNOWN C no snapshot | Verificação VERIFIED por método admitido, autoria/autoridade e segregação válidas; versões de experiências, links e documentos admissíveis; validade no instante avaliado | **SATISFIED** apenas para C e esse instante. |
| Não existe assertion C; existem apenas outras competências; slot UNKNOWN; C sem verificação suficiente | Estado e cobertura explícitos do snapshot; distinguir ausência, desconhecimento e prova insuficiente na explicação | **UNKNOWN**. Ausência de competência verificada não demonstra incumprimento. |
| Declaração negativa explícita sobre C, com autoridade, evidência e período | Exigiria produtor e contrato próprios para declaração negativa verificada | **NOT_SATISFIED_WITH_EVIDENCE**, apenas conceptualmente; **não emitido na V1**, porque esse produtor não existe. |

Recomendação D2: o avaliador de competência V1 só emite SATISFIED ou UNKNOWN. Não criar uma condição artificial para preencher o terceiro resultado. Um futuro incumprimento comprovado deverá ficar limitado ao requisito e período efetivamente demonstrados, nunca equivaler automaticamente a inelegibilidade global. Alternativa: alargar primeiro F13 com declarações negativas governadas; acrescenta âmbito e requer aprovação própria.

Recomendação D3: validade de verificação no intervalo `[verifiedAt, validUntil)`; `validUntil=null` apenas se o método aprovado permitir ausência de expiração. Este limite exato foi aprovado em D3; não é um requisito temporal novo da oportunidade. Não inventar métodos, durações ou níveis. Verificação expirada, revogada, disputada ou em conflito quando exigida pela política não é convertida silenciosamente em UNKNOWN: recusar consumo/READY e exigir correção ou novo snapshot conforme política.

### Afinidade temática

| Entradas | Evidência exigida | Resultado por critério |
| --- | --- | --- |
| Tema T exato presente numa declaração KNOWN | Declaração publicada/materializada, release e proveniência editorial autorizadas | **AFFINITY_OBSERVED**: afinidade satisfeita no conjunto declarado; não comprova competência. |
| T não consta de um conjunto KNOWN explícito e comparável | Conjunto efetivamente declarado e sua cobertura | **AFFINITY_NOT_OBSERVED**: não satisfeita nesse conjunto com essa evidência; não prova ausência de atividade institucional nem incumprimento obrigatório. |
| Conhecimento explicitamente UNKNOWN admitido pela política | Slot UNKNOWN e motivo/proveniência | **UNKNOWN**; nunca inferir de slot ausente ou de dado ocultado. |

V1 mantém a obrigação de temas KNOWN do perfil mínimo; a terceira linha define a semântica defensiva do avaliador e não autoriza mudar essa completion policy. Não há correspondência por tema pai, sinónimo ou afinidade calculada.

### Prioridade estratégica complementar

| Entradas | Evidência exigida | Resultado por critério |
| --- | --- | --- |
| Prioridade P exata num conjunto KNOWN | Declaração organizacional publicada, referência taxonómica e proveniência | **AFFINITY_OBSERVED**: alinhamento complementar observado. |
| P ausente do conjunto KNOWN explícito e comparável | Conjunto declarado e cobertura | **AFFINITY_NOT_OBSERVED** relativamente à declaração; sem exclusão ou penalização. |
| Slot UNKNOWN explicitamente permitido | Estado de conhecimento e proveniência | **UNKNOWN**, sem penalização. |

Recomendação D3 para completude: temas KNOWN; prioridades e competências podem ter UNKNOWN explícito quando a política o admitir, sem tratar omissões como UNKNOWN. Conhecimento KNOWN não significa VERIFIED. O produtor tem de preservar ambos os eixos e as obrigações de validade aplicáveis.

## 3. Resultado parcial e explicação

Cada avaliação contém organização, oportunidade/revisão, revisão/digest de critérios, snapshot/versão/origem/ativação/geração, tuple e bundle de regras, instante, cobertura avaliada e não avaliada. Cada linha contém ID do critério, resultado tipado, reason code versionado, explicação determinística, referências exatas usadas e limites da inferência.

Manter separados: **fonte da oportunidade**, **interpretação editorial confirmada** e **evidência organizacional da avaliação**. Uma citação da oportunidade não verifica competência; a confirmação da interpretação não satisfaz o requisito.

A conclusão global desta fatia é sempre **INDETERMINATE**. Cobertura incompleta não permite conclusão global positiva; constraints ausentes significam **não avaliadas**, não ausência de impedimentos. Mesmo todos os requisitos de competência satisfeitos e afinidades observadas não produzem elegibilidade integral. Sem média, score, ranking, semáforo de candidatura ou recomendação automática.

Recomendação D5: exigir projeção e acesso cumulativos suficientes para explicar cada evidência utilizada. Dado WITHHELD não vira UNKNOWN nem é usado para calcular um resultado revelador. Se não for possível uma explicação autorizada, recusar esta via mínima; projeções parciais exigem extensão explícita. Classificação de confidencialidade do resultado deve proteger as fontes; acesso F11 a documentos permanece independente, sem copiar conteúdo para respostas, auditoria ou envelopes de recuperação.

## 4. Capacidades existentes e lacunas F13

Atualização de 2026-10-17: F13-PQ1-PUBLISH está fechado; interface de competências/evidências/verificação e publicação multidomínio estão disponíveis no âmbito e limitações do seu contrato/evidência. A lacuna seguinte está concretizada em [F13-PQ1-ACTIVATE](f13-pq1-materialization-and-activation.md): contrato de materialização e ativação integrada, A1 aprovada; implementação coordenada In Progress, sem percurso público novo disponível. A integração utilizável do consumidor continua pendente; o núcleo de avaliadores já tem implementação/testes focados, sem equivaler a percurso HTTP/browser. A tabela seguinte preserva a inspeção **histórica anterior à entrega do publisher**, não descreve essas duas lacunas como ainda abertas.


Esta tabela resulta de **inspeção de código e contratos**, não de execução nesta tarefa. Módulo composto no backend não equivale a percurso HTTP/browser utilizável.

| Camada | Existente observado | Lacuna para F14-PQ1 |
| --- | --- | --- |
| Critérios | [repository](../../backend/src/opportunityCriteria/repository.js), contrato e evidência fechados: revisões, confirmação e freshness | Consumir identidade exata, sem alterar o authoring fechado. |
| Authoring de temas/prioridades | [editorialUiContracts](../../backend/src/organizationalProfile/editorialUiContracts.js): criar/editar/submeter/aprovar/publicar e catálogos desses domínios | Preservar proveniência e releases no novo produto multidomínio. |
| Authoring de competências/experiências | [competencyContracts](../../backend/src/organizationalProfile/competencyContracts.js) e [repository](../../backend/src/organizationalProfile/competencyRepository.js): assertions KNOWN/UNKNOWN, versões de experiências, links e verifyCompetency | Não há representação executável de declaração negativa. Não inferir NONE de coleção vazia. |
| Verificação/evidência | [competencyResources](../../backend/src/organizationalProfile/competencyResources.js): autorização, documentos AVAILABLE/CLEAN ligados a experiência; repository mantém método, instante, validade e digest de material | Transportar versões e obrigações para publicação/snapshot e revalidar admissibilidade no consumidor. Documento anexado sozinho não verifica assertion. |
| Interface de competências | [productionComposition](../../backend/src/productionComposition.js) compõe o domínio interno; UI editorial só expõe temas/prioridades | HTTP e UI para declarar competência/UNKNOWN, experiência, ligar evidência e verificar com permissões, segregação e MFA aprovadas; consulta de validade/motivos. |
| Publicação multidomínio | [editorialMaterial](../../backend/src/organizationalProfile/editorialMaterial.js) corta temas/prioridades; exclui competências/experiências e declara effectiveSnapshot=false/f14Consumable=false | Novo bundle imutável com material de competências, links, experiências e verificações de uma revisão de origem coerente. Não fazer join do último head de cada domínio nem alterar bundles históricos. |
| Materialização/ativação | [editorialRelease](../../backend/src/organizationalProfile/editorialRelease.js) destina-se a F13_EDITORIAL_READ_V1, não F14; contratos definem READY/ativação | Implementar materialização síncrona validada, snapshot READY e ativação manual atómica. Catálogo de operação ou snapshot de diretório/autorização não prova snapshot efetivo F13. |
| Consumidor | Critérios e guardas comuns existem; não há este avaliador | Manifesto de tuple, regras, armazenamento, freshness, projeção, operações, recuperação e UI deste consumidor. |

Recomendação D7: publicar **todo o material necessário a esta avaliação**, preservando autoria, verificação, validade e proveniência; materializar com completion policy explícita; ativar um único baseline organizacional. Autor não aprova/ativa; verificador não é autor material, com MFA onde já exigida. Não criar uma exigência adicional de terceira pessoa.

Ativação proposta: primeiro baseline ou substituição compatível, com CAS do ID e geração do ponteiro para evitar ABA; snapshot já READY e tuple aceite pelo consumidor. Não reduzir obrigações/cobertura através de substituição. Se houver overlays ou baseline mais amplo sem relação explícita de substituição, recusar. Publicação não ativa automaticamente. A ativação só é disponibilizada no percurso integrado com este consumidor, sem lançamento de ativação temática isolada.

## 5. Operações, interface e decisão humana

Recomendação D5: grants explícitos e cumulativos, nunca derivados de título de administrador nem de permissão de editar/confirmar critérios. IDs abaixo são propostas a registar nos catálogos, admissão e manifestos antes da implementação.

| Operação proposta | Grant/recurso | Condições |
| --- | --- | --- |
| F14_PREQUALIFICATION_EVALUATE | prequalification.evaluate / OPPORTUNITY | Membership/grant atuais e leitura autorizada da oportunidade, critérios, perfil e evidências. |
| F14_PREQUALIFICATION_READ | prequalification.read / PREQUALIFICATION_EVALUATION | Reautorizar organização, resultado e projeção das fontes; histórico não contorna revogação. |
| F14_PREQUALIFICATION_DECIDE | prequalification.decide / PREQUALIFICATION_EVALUATION | Ler avaliação atual e escrever decisão separada, com motivo obrigatório. |
| Lookup de intenção | Operação fechada específica, ligada ao sujeito/organização/pedido | Guardas de recuperação atuais; não é pesquisa livre de IDs de outra organização. |

Sessão normal é a recomendação para avaliar/decidir, respeitando requisitos superiores das fontes e políticas. Não impor segregação entre avaliador e decisor humano; não transportar a segregação de aprovação F13 para F14 por analogia.

Recomendação D4: decisões append-only, ligadas ao evaluation ID, com autor, instante, motivo e sequência. CAS de `expectedDecisionId`/geração; nenhuma decisão herdada automaticamente por nova avaliação. A decisão mais recente é a vigente dessa avaliação; as anteriores permanecem consultáveis. Para decidir, exigir avaliação CURRENT; uma avaliação histórica continua consultável.

| Decisão | Registo mínimo | Efeito |
| --- | --- | --- |
| REQUEST_INFORMATION — solicitar informação | Critérios em dúvida e descrição da informação necessária; motivo INFORMATION_MISSING | **Regista apenas uma necessidade**. Não envia mensagem, email, notificação, tarefa ou pedido a terceiros. UI diz explicitamente «necessidade registada; nenhuma comunicação enviada». |
| KEEP_UNDER_REVIEW — manter em análise | Motivo FURTHER_REVIEW e justificação | Mantém a análise humana aberta; não altera resultados automáticos. |
| DISCARD_FROM_ANALYSIS — descartar com motivo | OUT_OF_SCOPE_FOR_ORGANIZATION ou OTHER_JUSTIFIED e justificação | Descarta desta análise, sem eliminar/arquivar oportunidade, perfil ou avaliação e sem declarar inelegibilidade. |

Catálogo de motivos e justificação textual de 1–2000 caracteres são propostas D4. Evitar dados sensíveis desnecessários; não copiar justificações livres para logs técnicos.

Contrato HTTP a detalhar no incremento técnico: POST `/opportunities/:id/prequalifications` com requestId e identidades esperadas de oportunidade, head de critérios, snapshot/ativação/geração e bundle; GET de lista/detalhe; POST de decisão com CAS; GET de decisões; lookup fechado de intenção. O servidor resolve autoridade e bundle aplicável. Conflitos de entrada devolvem 409 com atualização segura das precondições; 403/404 não divulgam referências de outra organização; 503 não é tratado como prova de rollback.

Percurso utilizável: completar/verificar perfil → submeter/aprovar/publicar → materializar READY e ativar → abrir oportunidade com critérios confirmados atuais → avaliar → consultar explicações/cobertura → registar decisão. A UI deve explicar pré-requisitos em falta, desatualização, referência indisponível, recusa comprovada e resultado incerto distintamente. Este painel consome o percurso de critérios fechado, sem o redesenhar. Histórico é visivelmente histórico, sem botão de decisão sobre uma avaliação desatualizada.

## 6. Consistência, recuperação e isolamento

Avaliação e decisão são gravações tenant-local em transação, com intenção idempotente, recibo, F7 crítico e guardas de autoridade efetivas. A intenção é ligada a sujeito, organização, operação, recurso e digest canónico das entradas/CAS; reutilizar a chave com conteúdo diferente é conflito. Repetição após commit devolve o mesmo resultado, inclusive `evaluatedAt`; não recalcula sob o mesmo recibo. Após rollback **comprovado**, uma execução posterior pode avaliar novo instante, com precondições novamente verificadas.

Revalidar sob proteção transacional as revisões de oportunidade/critérios, snapshot ativo/geração, regras, grants e referências; não basta fazer dois SELECT sem coordenação com os escritores. Definir ordem de locks compatível com os produtores (gate de scope/F13-P1 comum ao escritor de revogação → oportunidade/critérios → ativação → referências ordenadas) no desenho técnico e testar deadlocks/ABA. Mudança do perfil em authoring não invalida automaticamente snapshot ativo; publicação/ativação ou alteração de admissibilidade do suporte pode invalidar consumo. Validade temporal precisa de deadline de commit que impeça aceitar verificação já expirada no ponto de linearização.

Revogação de sessão/membership/grant, documento, referência ou verificação deve partilhar guard/epoch/locks efetivamente usados pelo escritor correspondente. Se a avaliação linearizar primeiro, pode persistir legitimamente e tornar-se indisponível/desatualizada depois; se a revogação linearizar primeiro, a operação é recusada sem efeitos. Não prometer revogação retroativa instantânea. Snapshot e resultado históricos não são reescritos.

Falha de F7 crítico aborta conjuntamente avaliação/decisão e recibo de sucesso. Leitura também obedece à política de auditoria aplicável. Auditoria guarda IDs/revisões, operação, resultado e reason codes autorizados; sem conteúdo documental, tokens ou dados sensíveis em métricas. Novos eventos, permissões, recursos e operações fechadas devem ser admitidos explicitamente; lookup Central 011 dos critérios não autoriza automaticamente operações F14.

Recomendação D6: **reutilizar explicitamente o comportamento conservador de UNKNOWN**, porque esta fatia não dispara efeitos externos. 503 pode acontecer antes da entrada no repositório ou após resultado de commit incerto; o código HTTP sozinho não prova falha definitiva. Preservar envelope mínimo da intenção na sessão, sem conteúdo sensível; lookup/replay autorizado só quando o protocolo permitir. UNKNOWN mantém bloqueadas novas gravações conflitantes da mesma oportunidade e encaminha para suporte, podendo persistir **sem garantia de resolução automática**. Não criar nova intenção para contornar a pendência nem reenviar decisão por adivinhação.

Uma melhoria futura além de D6, agora aceite, exigiria âmbito **separadamente aprovado**: recibo terminal de recusa antes da execução, vinculado às mesmas identidades e demonstrando ausência de entrada/efeitos, com protocolo de recuperação e provas próprias. Esta proposta não afirma que esse recibo existe nem o inclui silenciosamente. Nenhuma recuperação pode duplicar avaliação, decisão ou F7 de sucesso.

O mesmo isolamento A/B aplica-se a GET/listas, escrita, lookup, referências cruzadas, evidências e erros. IDs válidos de B em pedidos de A não podem revelar existência ou estado, mesmo se o utilizador possuir outra sessão/grant em B.

## 7. Critérios de aceitação e prova exigida

Todos os critérios abaixo estão **PENDING — não executados para F14-PQ1**. Nomes de cenários são identificadores propostos para a futura suite, não testes existentes. Provas de domínio puro não substituem o caminho PostgreSQL/HTTP; browser é exigido onde indicado.

| ID / cenário | Critério e prova mínima |
| --- | --- |
| PQ1-01 exact-inputs | HTTP+PostgreSQL: aceitar identidades atuais; recusar oportunidade/revisão diferente, head Draft e critérios não CURRENT. Demonstrar nenhuma seleção silenciosa de versão. |
| PQ1-02 ready-tuple | Recusar publicação editorial, snapshot não READY/inativo, tuple cruzado, leitor não admitido e redução de cobertura. Aceitar apenas tuple completo registado. |
| PQ1-03 competency | Testes de regras e HTTP com snapshot real: C verificada satisfaz; C ausente, outra competência, UNKNOWN e prova insuficiente dão UNKNOWN com razões distintas. Nenhuma entrada V1 produz incumprimento negativo inventado. Corpus fixo demonstra resultado/digest e ordenação determinísticos para inputs e instante fixos. |
| PQ1-04 affinities | KNOWN com/sem conceito e UNKNOWN permitido; rótulo igual com ID/release diferente não corresponde. Tema e prioridade nunca satisfazem competência. Slot ausente não se transforma em UNKNOWN/READY. |
| PQ1-05 validity | Instantes antes/no limite/depois de validUntil, método sem expiração permitido e proibido, verificação revogada/disputada/conflituante; deadline no commit real. Sem requisito temporal acrescentado ao critério. |
| PQ1-06 history | Mudar head de critérios, oportunidade, ativação/geração, regra e referência. Lista/head/detalhe coerentes, UNAVAILABLE precede REVIEW_REQUIRED; histórico imutável e nunca apresentado como atual. Draft de perfil sem ativação não muda baseline. |
| PQ1-07 partial | Todas as linhas positivas continuam globalmente INDETERMINATE; constraints não avaliadas explícitas. Asserções sobre resposta e UI: sem score/ranking/elegibilidade/recomendação. |
| PQ1-08 isolation | HTTP A/B: IDOR em avaliação, decisão, histórico, lookup e evidência; grants separados e F11/projeção; acesso revogado não expõe resultado ou fonte. WITHHELD não vira UNKNOWN. |
| PQ1-09 concurrent-revocation | Caminho real de evaluate e decide: ambas as ordenações de sessão, membership e grant revogados; referências/documentos/verificação tornados inadmissíveis e ativação trocada. Mostrar guardas partilhadas efetivamente chamadas, resultado e ausência de efeitos parciais. |
| PQ1-10 cas-idempotency | Duas sessões, critérios/perfil ativo alterados durante avaliação, concorrência entre decisões, ABA do ponteiro; mesmo pedido repete resultado, conteúdo divergente conflita, CAS perdedor não grava. |
| PQ1-11 audit-atomicity | Injetar falha F7 após gravação de avaliação e após decisão, antes do commit, em PostgreSQL descartável; ausência de linhas/recibos de sucesso parciais. Testar rollback da ativação e publicação nos seus próprios caminhos. |
| PQ1-12 uncertain-commit | Perder resposta após commit e interromper antes de commit; lookup autorizado recupera recibo ou mantém estado protocolar, sem duplicar efeitos. Exercitar dependências indisponíveis e intenção sem resultado conhecido. |
| PQ1-13 session-503 | **Browser → concorrência na mesma sessão → 503 → lookup** completo, incluindo distinção recusa comprovada/UNKNOWN, bloqueio de novas gravações, preservação da intenção e encaminhamento para suporte. Não presumir resolução automática. |
| PQ1-14 human-decisions | HTTP/browser: três decisões, motivo obrigatório, CAS, histórico append-only e nenhuma herança para nova avaliação. REQUEST_INFORMATION não chama transportes/jobs de mensagens. DISCARD não arquiva oportunidade. |
| PQ1-15 f13-producer | HTTP+PostgreSQL: authoring/links/verificação, segregação/MFA já aprovadas, publicação multidomínio coerente, materialização e cutover atómicos. Perfil sem obrigações satisfeitas não chega a READY. |
| PQ1-16 usable-path | Browser A/B: percurso completo da secção 5 sem scripts manuais como interface; estados de erro/desatualização/UNKNOWN; consulta explicável e decisão separada. |
| PQ1-17 admission | Quando existirem migrations: up/down seguro, privilégios mínimos, admissão, manifestos e fingerprints; composição real do consumidor e lookup específico. Validar sintaxe, suites afetadas e build conforme o recorte implementado. |

Evidência reutilizável: os registos fechados de critérios sustentam **o produtor de critérios** e a sua correção de freshness. Guardas partilhadas já exercitadas são candidatas a reutilização se a composição exata deste consumidor demonstrar o mesmo mecanismo e parâmetros. Inspeção por semelhança não prova PQ1-09, PQ1-11 ou PQ1-13; estes cenários requerem execução específica do novo caminho. Não atribuir resultados anteriores a testes novos.

Limitações históricas preservadas: algumas combinações de revogação concorrente e falha F7 de gravação dos critérios foram sustentadas por mecanismos partilhados e inspeção, não por execução específica; o percurso browser/503/lookup da mesma sessão não foi integralmente executado. Aceitação humana dessas limitações no incremento fechado não é aprovação automática para F14. Provas locais não validam staging, produção, IdP externo ou dados reais.

## 8. Decisões de produto — escolhas novas aprovadas

| Decisão | Opção recomendada | Alternativa e consequência |
| --- | --- | --- |
| D1 — fatia e conclusão | Privada F12, baseline organizacional sem overlays, três avaliadores e global INDETERMINATE | Central/coortes/qualificação integral exigem contratos e produtores adicionais. |
| D2 — incumprimento comprovado | Competência V1 só SATISFIED/UNKNOWN; sem produtor negativo, não emitir NOT_SATISFIED_WITH_EVIDENCE | Criar declaração negativa governada primeiro; maior âmbito F13. |
| D3 — conhecimento e validade | Temas KNOWN; prioridades/competências UNKNOWN explícito apenas permitido por política; validade de verificação em intervalo semiaberto, sem novos thresholds | Alterar completude ou fronteira temporal requer rever políticas e testes; não escolher valores de métodos por inferência. |
| D4 — decisões humanas | Registo local separado, três ações/motivos acima, avaliação CURRENT, justificação 1–2000 caracteres; sem comunicação | Comunicação externa ou decisão sobre histórico exige contrato próprio e recuperação de efeitos externos. |
| D5 — acesso e projeção | Três grants explícitos; acesso cumulativo suficiente para explicação; sem segregação adicional avaliar/decidir | Projeção parcial ou MFA adicional em F14 exige definição expressa de comportamento e risco. |
| D6 — resultado incerto | Aceitar UNKNOWN duradouro, bloqueio conflitante e suporte, sem resolução automática garantida | Aprovar incremento próprio para recibo de recusa anterior à execução e recuperação demonstrável. |
| D7 — ativação necessária | Publicação multidomínio e um baseline READY ativo para este consumidor, sem redução de cobertura | Adiar consumidor; não lançar ativação temática limitada sem ele. |

D1–D7 estão aprovadas conforme o registo acima. Antes de declarar o consumidor F14 **Ready**, fechar o respetivo contrato técnico: IDs reais de políticas, métodos/releases e fixtures sintéticas; tuple/manifestos exatos; reason codes, eventos e projeções; esquema de resultado e protocolo de recuperação; coordenação com escritores de referências. Limites operacionais de materialização síncrona devem ser medidos/definidos, não inventados nesta proposta. A aprovação humana está registada; os detalhes técnicos futuros não autorizam implementação F14 nesta entrega.

## 9. Sequência mínima e próximo incremento

1. D1–D7 aprovadas; recorte técnico e fixtures de publicação definidos em [F13-PQ1-PUBLISH](f13-pq1-publish.md), preservando contratos aprovados e o incremento fechado de critérios.
2. **Registo histórico da sequência proposta — F13-PQ1-PUBLISH (entretanto Complete):** interface HTTP/browser mínima de competências, experiências, evidências e verificação, reutilizando authoring existente; submeter/aprovar/publicar material multidomínio imutável de uma revisão coerente. Contrato técnico próprio e critérios focados fechados em [F13-PQ1-PUBLISH](f13-pq1-publish.md); implementação não iniciada nesta tarefa. Entrega é publicação ainda **inativa**, não snapshot READY nem F14 consumível. Reutilizar UI editorial onde possível, sem alterar artefactos históricos.
3. Materialização síncrona desse bundle, completion/compatibility policies e ativação manual atómica para o consumidor F14-PQ1. Implementar com o consumidor em integração; não disponibilizar ativação temática isolada. Provar segregação, MFA, CAS de geração, cobertura e rollback.
4. Avaliadores determinísticos, avaliação imutável, freshness, F7, grants, rotas de consulta/escrita e lookup com o comportamento D6 aprovado. Exercitar PostgreSQL/HTTP reais e concorrência específica.
5. Integrar UI do percurso completo, decisões humanas e estados de recuperação; executar PQ1-01–17, revisão read-only e decisão humana restrita desta fatia. Só então considerar o percurso utilizável, sem declarar F13 integral ou F14 integral Complete.

Esta tarefa apenas especifica e referencia a proposta. Nenhum código, migration, ativação, teste funcional ou operação Git mutável foi executado para a implementar. A revisão documental verifica links, diff, whitespace e preservação do residual; não constitui evidência comportamental de F14-PQ1.

### Integração técnica parcial de avaliação/consulta — 2026-10-17

No bloco coordenado F13-PQ1-ACTIVATE foram implementados POST `/api/opportunities/:opportunityId/prequalifications` e GET `/api/opportunities/prequalifications/:id`. Escrita recebe `opportunityRevisionId`, `criteriaRevisionId`, `activationId`, `generation`, `idempotencyKey`; snapshot e tuple/bundle são resolvidos exatamente no servidor. Lookup em POST `/api/organizational-profile/pq1-activation/intentions/lookup`, com `operation`, `resourceId`, `idempotencyKey`, sujeito/tenant da sessão. UI `/pre-qualificacao` recebe `opportunityId` ou `evaluationId` apenas como seleção, nunca autoridade. Resultado global INDETERMINATE, explicação/evidência por critério, resultado histórico separado da freshness e autorização atual.

[Evidência e matriz](../reviews/f13-pq1-http/README.md): HTTP e browser com PostgreSQL real/IdP sintético, preview/MFA/ativação/lookup/avaliação/consulta A/B. Decisões humanas e lista de avaliações não implementadas neste recorte; D1–D7 preservadas. Contrato integral não concluído. 503 após commit exercitado não equivale a prova de 503 concorrente na mesma sessão; UNKNOWN sem garantia automática e demais lacunas ACT permanecem explícitas.

### Marco consolidado autorizado — 2026-10-17

Pedido humano posterior autoriza concluir decisão/histórico e gates no mesmo marco, sem reabrir D1–D7. Estado In Progress. POST `/api/opportunities/prequalifications/:id/decisions`: corpo fechado `{decision, reasonCode, justification, criterionIds, expectedDecisionId, expectedGeneration, idempotencyKey}`; evaluationId exclusivamente no path. GET no mesmo caminho devolve histórico paginado (`cursor`) e head, sob leitura cumulativa da avaliação. REQUEST_INFORMATION exige criterionIds não vazios da avaliação e INFORMATION_MISSING; KEEP_UNDER_REVIEW exige FURTHER_REVIEW; DISCARD_FROM_ANALYSIS exige OUT_OF_SCOPE_FOR_ORGANIZATION ou OTHER_JUSTIFIED. Justificação 1–2000 caracteres, sem cópia para logs; as outras duas opções usam criterionIds vazio. Sujeito humano, avaliação CURRENT, grant decidir e leitura cumulativa; nenhuma segregação nova. CAS do head/geração por avaliação; primeira decisão null/0. Histórico e recibo imutáveis na mesma linha/transação com F7. Lookup PQ1_DECIDE com resourceId=evaluationId. Pendência bloqueia decisões conflitantes e nova avaliação dependente da mesma oportunidade na UI, não a organização inteira. Sem transporte de mensagens/candidaturas.

Extensão mínima: tenant 020 aditiva para decisões/F7; Central 014 para lookup fechado, preservando migrations históricas. Provas: três decisões/browser, CURRENT/confirmação, CAS/replay, F7/commit incerto/lookup, isolamento e imutabilidade. Matriz consolidada discrimina execução/reutilização e lacunas; não marcar Complete.

## Apresentação dos resultados por critério

Estado: Review. Melhoria visual pedida em 10/11/2026.

- Mostrar o critério, o resultado e o motivo na consulta da avaliação parcial.
- Recolher excerto, fonte, justificação e referências já disponíveis num controlo «Ver evidência» por critério, fechado inicialmente e acessível por teclado e toque.
- Manter explícita a natureza parcial da análise e preservar a consulta, os dados de origem, os estados históricos e o percurso de decisão humana.
- Validar critérios extensos e estados distintos em computador e telemóvel, incluindo abertura e fecho independentes.

Validação. Build e 14 testes focados aprovados. Chromium com API simulada confirmou os quatro resultados, abertura e fecho independentes por teclado e toque, referências longas e ausência de transbordo a 1440, 390 e 320 px. A instância local habitual estava indisponível. Na suite frontend passaram 878 de 879 testes; repetiu-se a falha conhecida do diálogo «Adicionar membro» em ApplicationWork.
