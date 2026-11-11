# F13 — Política transversal de dados desconhecidos e estados epistemológicos

**Estado:** Investigação; recomendação sujeita a aprovação humana
**Decisão:** Como representar ausência, desconhecimento, inaplicabilidade, retenção deliberada, falta de verificação, conflito e expiração de dados F13 sem converter ausência em falso, zero ou incompatibilidade?

## Âmbito e limites

A política deve aplicar-se ao perfil organizacional, taxonomias, competências, experiência, capacidades financeira e operacional, territórios, beneficiários, exclusões e snapshots efetivos. Não define scoring, pesos, elegibilidade por aviso, comportamento final da F14 ou qualificação humana F15.

## Factos estabelecidos pelo repositório

### Contratos aprovados

- F13 exige validação fechada, versões imutáveis, provenance e snapshots reproduzíveis; Draft pode existir incompleto, mas apenas snapshots que satisfaçam uma política de completude versionada ficam disponíveis à F14.
- Taxonomias preservam conceitos deprecated e mappings ausentes como `UNKNOWN`/unmapped, sem inferir equivalência.
- Competências distinguem `UNKNOWN`, `NONE`, `UNVERIFIED` e `VERIFIED`; também usam `DISPUTED`, `REVOKED` e `EXPIRED` no estado de verificação/lifecycle aprovado.
- Capacidade financeira aprovou availability mutuamente exclusiva (`KNOWN`, `UNKNOWN`, `NONE`, `NOT_APPLICABLE`, `WITHHELD`) separada de verification.
- Capacidade operacional preserva a mesma separação entre availability e verification e admite redaction/`WITHHELD` para agregados sensíveis.
- F5 autoriza por operação/recurso/scope e falha fechado. F7 preserva autoria e eventos sanitizados. F11 não converte documento em prova verificada.
- Snapshots e digests fixam o estado historicamente consumido; atualizações posteriores não reescrevem resultados anteriores.

### Inconsistências na implementação atual

Estas são evidências da implementação/piloto, não contratos aprovados para F13:

- Controllers e importadores legacy convertem alternadamente `undefined`, `null`, string vazia e valores falsy em `null`; noutros caminhos, string vazia é rejeitada. Não existe semântica transversal.
- O quality evaluator F12 usa presença booleana para alguns campos e mantém `conflictCodes` vazio. É uma projeção de qualidade F12, não um modelo epistemológico reutilizável.
- F12 admite `UNKNOWN` em catálogos e `NOT_APPLICABLE` na qualidade financeira, mas estes estados são específicos do respetivo contrato.
- F4/F9/F11 usam `UNKNOWN`, `UNCERTAIN`, `EXPIRED`, `REVOKED` ou estados semelhantes com significados operacionais próprios; reutilizar os nomes não torna as semânticas equivalentes.
- O piloto UBI contém campos opcionais `null`/vazios e defaults de apresentação sem provenance suficiente para distinguir desconhecido, inexistente ou inaplicável.

Conclusão factual: o repositório já exige distinções explícitas em novos contratos, mas ainda não tem uma política transversal que impeça interpretações diferentes de ausência e `null`.

## Opções viáveis

| Opção | Clareza/validação | Evolução e compatibilidade | Confidencialidade/completude | Consumo F14 | Complexidade |
|---|---|---|---|---|---|
| A. Ausência/`null` universal | Muito baixa; mistura desconhecido, negativo e inaplicável | Migração simples, história ambígua | Não distingue redaction | Produz falsos negativos e explicações frágeis | Baixa inicialmente, elevada depois |
| B. Estados independentes em cada domínio | Boa localmente | Risco de deriva semântica e mappings repetidos | Pode ser ajustada por domínio | Obriga F14 a interpretar contratos heterogéneos | Média/alta |
| C. Envelope transversal multidimensional, restringido por catálogo/domínio | Alta; combinações podem ser validadas | Vocabulário comum com extensões fechadas | Separa conhecimento, verificação, conflito, lifecycle e divulgação | Entrada determinística, sem decidir scoring | Maior desenho inicial, menor ambiguidade futura |

## Recomendação

Recomenda-se a **Opção C**, com um envelope transversal multidimensional e perfis de validação específicos por domínio/métrica. Não se recomenda uma enumeração única: `WITHHELD`, `UNVERIFIED`, `CONFLICTED` e `EXPIRED` respondem a perguntas diferentes e podem coexistir sem contradição quando colocados nas dimensões corretas.

### 1. Ausência de registo e Draft

- Ausência de registo significa apenas **não materializado**; não equivale automaticamente a `UNKNOWN`, `NONE`, `false`, zero ou `NOT_APPLICABLE`.
- Draft pode omitir campos permitidos pela sua schema version. A omissão é estado editorial, não facto epistemológico.
- Para cada slot exigido pela política de completude, um snapshot publicado materializa um valor ou um estado explícito permitido.
- `null`, string vazia, array vazio, zero e `false` não são atalhos de estado. O contrato de cada campo define se são valores válidos; caso contrário são recusados antes da persistência.

### 2. Dimensões propostas

| Dimensão | Estados candidatos | Pergunta respondida |
|---|---|---|
| Conhecimento/availability | `KNOWN`, `UNKNOWN`, `NONE`, `NOT_APPLICABLE` | Existe um facto e qual é a sua condição semântica? |
| Verificação | `UNVERIFIED`, `VERIFIED`, `DISPUTED`, `REVOKED`, `EXPIRED` quando o domínio aprovado o usar | Qual é o estatuto de confiança/validade da assertion? |
| Conflito | `CLEAR`, `CONFLICTED` | Há fontes/assertions incompatíveis ainda não reconciliadas? |
| Lifecycle editorial | `DRAFT`, `APPROVED`, `PUBLISHED`, `SUPERSEDED`, `ARCHIVED` | Em que fase está a versão/configuração? |
| Confidencialidade/projeção | classe de confidencialidade + `DISCLOSED` ou `WITHHELD` | O consumidor desta projeção pode ver o valor? |

`WITHHELD` é apresentado pelos contratos financeiros/operacionais como availability externo, mas semanticamente significa que o sistema conhece informação que esta projeção não divulga. A implementação futura deve conservar internamente o knowledge state real e materializar `WITHHELD` na projeção autorizada, sem enfraquecer os contratos já aprovados.

`DISPUTED` e `CONFLICTED` são distintos: `DISPUTED` regista contestação da validade de uma assertion; `CONFLICTED` regista que duas ou mais fontes/assertions ativas não podem ser simultaneamente aceites. Uma assertion pode ser disputada sem existir uma alternativa contraditória.

### 3. Envelope candidato

Quando aplicável ao domínio, o envelope pode conter:

- `knowledge_status`;
- `value` ou `value_ref` canónico opcional;
- `verification_status`;
- `lifecycle_status` da versão/assertion;
- `conflict_status`;
- `confidentiality_class` e estado da projeção;
- `reason_code` fechado;
- provenance;
- `observed_at` e `valid_until`;
- versão do facto e versões de catálogo/policy;
- digest.

O catálogo/métrica define quais dimensões se aplicam, estados e reason codes admitidos, valor obrigatório/proibido, transições, validade, política de completude e projeções autorizadas. O caller não envia enums, defaults ou regras fora dessas allowlists.

### 4. Valor parcial

- Um facto atómico não mistura `UNKNOWN` com um valor parcial.
- Informação composta é decomposta em subfactos/slots: componentes conhecidos usam `KNOWN`; componentes desconhecidos materializam `UNKNOWN` quando exigidos no snapshot.
- Intervalos e bandas aprovados são valores `KNOWN` com precisão declarada, não `UNKNOWN`.
- Se um domínio não puder decompor a informação sem perder semântica, precisa de um tipo explícito versionado; texto parcial livre não entra no caminho determinístico.

### 5. Autoridade, razão e temporalidade

- `NONE` exige declaração negativa explícita, ator autorizado, período/`observed_at`, provenance e permissão da definição do campo. Nunca é inferido de ausência.
- `NOT_APPLICABLE` exige `reason_code` permitido pelo catálogo e contexto que comprove a inaplicabilidade.
- `UNKNOWN` exige reason code quando necessário para distinguir `NOT_COLLECTED`, `INSUFFICIENT_EVIDENCE`, `STALE_SOURCE` ou outra razão fechada; não contém valor.
- Expiração preserva o último valor e a sua história, mas impede tratá-lo como atual. Um snapshot histórico mantém o estado observado à data; um novo snapshot representa `EXPIRED`/indisponibilidade segundo a policy.
- `REVOKED` não elimina a versão histórica; impede uso corrente conforme a policy e exige evento/autoria.

### 6. Conflito e publicação

- Fontes contraditórias são preservadas como assertions distintas, cada uma com provenance e digest; não se escolhe silenciosamente uma vencedora.
- `CONFLICTED` bloqueia a disponibilização do slot à F14 e a completude que dependa dele, salvo futura policy explícita que publique uma projeção não consumível marcada como conflito.
- `DISPUTED` preserva a assertion contestada e pode invalidar `VERIFIED` para uso corrente segundo transição aprovada; não equivale por si só a múltiplas fontes contraditórias.
- Reconciliação cria nova decisão/versionamento e F7; não reescreve assertions ou snapshots anteriores.

### 7. Completude

- Completude é resultado de uma policy versionada sobre slots e estados, não contagem de valores non-null.
- A policy distingue pelo menos: estado admissível para publicação, estado admissível para consumo F14 e estado que exige revisão.
- `WITHHELD` pode satisfazer que a informação existe, mas não satisfaz automaticamente que o consumidor F14 autorizado dispõe do valor necessário.
- `UNKNOWN`, `NONE` e `NOT_APPLICABLE` contribuem de forma diferente conforme o catálogo; nenhum recebe equivalência global.
- `UNVERIFIED` não significa ausência: pode satisfazer completude editorial, mas qualquer uso F14 depende de regra futura explícita.

### 8. Redaction e digests

- O snapshot canónico mantém um semantic digest sobre o conteúdo autorizado interno e as versões de policy.
- Cada projeção redigida tem `projection_digest` próprio sobre o conteúdo efetivamente entregue e referencia opacamente a identidade/version do snapshot; redaction não recalcula nem altera a identidade semântica do snapshot.
- O semantic digest não deve ser exposto a consumidores sem autorização quando a comparação permitir confirmar informação protegida.
- Logs, F7 e F10 usam códigos, classes e referências opacas; nunca valores, reason detail livre ou digests que criem side channels.
- Exports aplicam a mesma projeção F5 e registam purpose, policy e redaction sem revelar o conteúdo omitido.

### 9. Defaults e legacy

- Defaults só são válidos quando definidos pelo catálogo/schema versionado, materializados no snapshot e acompanhados pela provenance `POLICY_DEFAULT`; defaults implícitos de linguagem, base ou UI são proibidos.
- Dados legacy `null`, vazios ou ambíguos não são convertidos para `NONE`, `NOT_APPLICABLE` ou zero.
- Migração preserva o valor bruto/provenance quando permitido e marca a interpretação como `UNKNOWN`/`UNRESOLVED_LEGACY` por regra explícita, ou bloqueia publicação até revisão humana.
- Ausência de mapping taxonómico continua unmapped/`UNKNOWN`; inferência lexical não resolve a ambiguidade.

## Matriz de combinações e invariantes

| Combinação | Resultado recomendado |
|---|---|
| `KNOWN` sem valor/value_ref admitido | Inválida |
| `UNKNOWN`, `NONE` ou `NOT_APPLICABLE` com valor | Inválida |
| Valor exato + intervalo/banda incompatível | Inválida |
| `NONE` sem autoridade, período ou permissão do catálogo | Inválida |
| `NOT_APPLICABLE` sem reason code permitido | Inválida |
| `VERIFIED` sem método, verificador, provenance e `verified_at` | Inválida |
| `WITHHELD` sem facto interno conhecido ou regra de projeção | Inválida |
| `CONFLICTED` tratado como valor conhecido único | Inválida |
| Versão `REVOKED`/`SUPERSEDED` usada como corrente | Inválida |
| `EXPIRED` tratado como observação atual | Inválida |
| Campo obrigatório ausente num snapshot publicado | Inválida |
| Default implícito não materializado | Inválida |
| Projeção redigida com o mesmo digest do payload não redigido | Inválida |
| `UNVERIFIED` tratado como `VERIFIED` pela F13 | Inválida |

Estas regras devem combinar constraints declarativas, validação do contrato e transições no writer; nenhum nível isolado é suficiente para todos os invariantes.

## Fronteira F13/F14

### Responsabilidade F13

- preservar factos, estados, provenance, policies e versões;
- validar combinações e transições;
- avaliar completude versionada;
- materializar snapshots e projeções autorizadas;
- nunca inferir compatibilidade, elegibilidade ou ausência negativa.

### Responsabilidade futura F14

- interpretar estados em cada critério de oportunidade por regra versionada;
- distinguir `COMPATIBLE`, `INCOMPATIBLE` e `UNKNOWN` sem colapsar ausência em negativo;
- decidir o efeito de verification, expiração, conflito e redaction;
- explicar quais dados/estados impediram uma conclusão.

Esta investigação não define o resultado F14 para nenhum estado ou aviso concreto.

## Segurança e confidencialidade

- F5 controla leitura de valor, leitura de estado, verificação, resolução de conflito, publicação e exportação separadamente quando necessário.
- F7 regista transições e decisões com payload sanitizado; segredo comercial, dados pessoais, valores e evidência permanecem fora do evento.
- Correção cria nova versão; retenção/legal hold preservam história sem manter o dado visível a consumidores não autorizados.
- Projeções evitam diferenças de forma, erro, timing ou digest que revelem se `WITHHELD` contém certo valor.
- Dados pessoais e pequenos agregados seguem minimização e redaction; knowledge states não contornam as regras próprias da fonte F11.

## Riscos e decisões humanas restantes

1. Aprovar ou corrigir a Opção C e a separação exata das cinco dimensões.
2. Decidir se `WITHHELD` permanece exposto como availability por compatibilidade de domínio ou apenas como disclosure state projetado.
3. Fechar catálogos de reason codes e transições por domínio.
4. Definir a policy de completude: slots, estados admitidos e diferenças entre publicar e disponibilizar à F14.
5. Decidir o efeito corrente de `DISPUTED`, `CONFLICTED`, `EXPIRED` e `REVOKED` sem antecipar scoring.
6. Definir classes de confidencialidade, projeções, grants F5 e proteção contra side channels.
7. Aprovar semantic/projection digests e quais referências podem ser expostas.
8. Definir migração de dados legacy ambíguos e workflow de revisão humana.
9. Definir retenção, legal hold, exports e direito de correção por classe de dado.
10. Alinhar a terminologia histórica de verification/lifecycle das decisões já aprovadas sem reescrever snapshots.

## Implicações para F13 e F14

- **F13-AC-05 e AC-20:** validação fechada passa a distinguir ausência, conhecimento, negação, inaplicabilidade, confidencialidade, verificação e conflito.
- **F13-AC-06, AC-09, AC-12 e AC-32:** snapshots preservam valor/estado/provenance/policy e digests sem depender do estado atual.
- **F13-AC-16 e AC-17:** capacidades financeira e operacional partilham semântica transversal sem perder restrições específicas da métrica.
- **F13-AC-21, AC-22, AC-24 e AC-25:** field-level access, auditoria, redaction, IDOR/RLS e prevenção de side channels tornam-se requisitos da projeção.
- **F13-AC-30:** F13 materializa conhecimento e completude, mas não decide matching ou elegibilidade.
- A F14 terá uma entrada inequívoca para explicar desconhecimento, sem converter `UNKNOWN` em incompatibilidade.

## Fontes internas

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-thematic-taxonomy.md`
- `context/decisions/f13-competencies-and-experience.md`
- `context/decisions/f13-financial-capacity.md`
- `context/decisions/f13-operational-capacity.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f10-operational-observability.md`
- `context/history/f11-private-document-storage.md`
- `context/history/f12-opportunity-catalog.md`
- `backend/src/opportunities/quality.js`
- `backend/src/opportunities/contracts.js`
- `backend/src/controllers/importController.js`
- `backend/src/controllers/applicationController.js`

Não foram necessárias fontes externas: a decisão em investigação é de semântica interna e os contratos aprovados fornecem evidência suficiente.

Next step: aprovar ou corrigir a política de dados desconhecidos antes de investigar versionamento e ativação das configurações.
