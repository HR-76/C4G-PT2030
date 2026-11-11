# Decisão: política transversal de estados de conhecimento F13

## Estado

**Aprovada.**

## Contexto

A F13 reúne domínios com ausência, confidencialidade, verificação, conflito e validade diferentes. Uma enumeração única ou o uso indiscriminado de `null` confundiria desconhecimento com negação, inaplicabilidade, expiração ou redaction e produziria falsos negativos no futuro matching.

## Decisão

1. A ausência de registo significa apenas “não materializado”.
2. Ausência não equivale a:
   - `UNKNOWN`;
   - `NONE`;
   - `NOT_APPLICABLE`;
   - zero;
   - `false`;
   - string vazia.
3. Drafts podem omitir slots quando o schema permitir.
4. Snapshots publicados devem materializar explicitamente valor ou estado para todos os slots exigidos pela política de completude.
5. O envelope epistemológico é multidimensional.
6. Dimensão de conhecimento:
   - `KNOWN`;
   - `UNKNOWN`;
   - `NONE`;
   - `NOT_APPLICABLE`.
7. Dimensão de verificação:
   - `NOT_REQUIRED`;
   - `UNVERIFIED`;
   - `VERIFIED`;
   - `DISPUTED`;
   - `REVOKED`;
   - `EXPIRED`.
8. Dimensão de conflito:
   - `CLEAR`;
   - `CONFLICTED`.
9. Lifecycle editorial:
   - `DRAFT`;
   - `APPROVED`;
   - `PUBLISHED`;
   - `SUPERSEDED`;
   - `ARCHIVED`.
10. Dimensão de projeção:
    - `DISCLOSED`;
    - `WITHHELD`.
11. Confidencialidade é dimensão própria, com catálogo fechado e política F5.
12. `WITHHELD` não altera `knowledge_status`.
13. `WITHHELD` exige:
    - facto interno existente;
    - regra de projeção;
    - autorização;
    - provenance da redaction.
14. `KNOWN` exige valor ou referência válida.
15. `UNKNOWN` proíbe valor afirmado como conhecido.
16. `NONE`:
    - é declaração negativa explícita;
    - exige autoridade;
    - período;
    - provenance;
    - só é permitido quando o slot admite `NONE`.
17. `NOT_APPLICABLE` exige `reason_code` permitido pela definição do slot.
18. `NOT_REQUIRED` aplica-se apenas à dimensão de verificação quando a política do slot não exige verificação.
19. `VERIFIED` exige:
    - método;
    - verificador;
    - `verified_at`;
    - provenance;
    - validade quando aplicável.
20. `DISPUTED` representa contestação de uma assertion identificada.
21. `CONFLICTED` representa fontes/asserções incompatíveis que ainda não foram resolvidas.
22. `DISPUTED` e `CONFLICTED` não são equivalentes.
23. `CONFLICTED` não pode ser reduzido silenciosamente a um valor único.
24. `EXPIRED` preserva o valor histórico, mas impede uso como corrente.
25. `REVOKED` preserva o histórico e a razão, mas impede uso corrente.
26. `SUPERSEDED` preserva a versão e aponta para a substituição quando existente.
27. Slots obrigatórios em estado:
    - `CONFLICTED`;
    - `DISPUTED`;
    - `EXPIRED`;
    - `REVOKED`
    não tornam o snapshot consumível pela F14.
28. A política de completude é:
    - fechada;
    - versionada;
    - associada ao schema/profile release;
    - independente de scoring.
29. A completude avalia dimensões explicitamente; não usa truthiness.
30. `WITHHELD` não equivale a `UNKNOWN` para completude.
31. Um snapshot pode preservar valor interno `WITHHELD` e publicar apenas uma projeção redigida.
32. Existem dois digests:
    - `semantic_digest` sobre o conteúdo canónico interno;
    - `projection_digest` sobre a projeção autorizada e respetiva policy version.
33. Clientes sem autorização para o conteúdo interno não recebem `semantic_digest` quando isso criar side channel.
34. Redaction não altera o histórico semântico.
35. Cada projeção identifica a policy version usada.
36. `null`, vazio, zero e `false` só são aceites quando o schema específico lhes atribui significado explícito.
37. Defaults implícitos são proibidos.
38. Dados legacy ambíguos migram para `UNKNOWN` com:
    - migration provenance;
    - `reason_code`;
    - source reference;
    - sem inferência de `NONE`, zero ou `false`.
39. Migração não cria verificação fictícia.
40. F13 preserva estados, provenance e snapshots.
41. F13 não determina compatibilidade, elegibilidade ou score.
42. F14 interpretará estados apenas por regras próprias e versionadas.
43. Logs, exports e respostas respeitam confidentiality/projection policy.
44. Correção cria nova versão; não reescreve snapshots anteriores.

## Invariantes

- Cada domínio declara quais dimensões e combinações admite; o caller não escolhe estados, reasons ou defaults fora do catálogo.
- Um slot atómico possui valor conhecido ou um estado sem valor; informação composta é decomposta em slots explícitos.
- Completeness, verification, conflict, lifecycle e projection são avaliados separadamente.
- Estado corrente e história são distintos: expiração, revogação, supersession e correção nunca eliminam a evidência anterior.
- Redaction produz uma projeção própria sem alterar a identidade semântica do snapshot interno.
- Nenhum estado F13 é convertido em compatibilidade ou incompatibilidade sem regra F14 futura.

## Segurança, autorização e auditoria

- F5 controla leitura do valor, leitura do estado, verificação, disputa, resolução de conflito, publicação e exportação conforme a classificação.
- F7 regista transições e decisões com códigos fechados e payload sanitizado, sem valores protegidos, evidência integral ou digests que criem side channels.
- RLS/IDOR, retenção, legal hold e direito de correção aplicam-se à fonte e às projeções; o envelope não amplia acesso.
- Exports, logs e respostas usam a mesma policy de projeção e registam a policy version aplicada.

## Impacto nos critérios F13

- **F13-AC-05 e AC-20:** ausência, conhecimento, negação, inaplicabilidade, verificação, conflito e redaction passam a ter validação fechada.
- **F13-AC-06, AC-09, AC-12 e AC-32:** versões e snapshots preservam valor/estado, provenance, policies e digests historicamente reproduzíveis.
- **F13-AC-16 e AC-17:** capacidades financeira e operacional partilham semântica transversal sem perder restrições específicas.
- **F13-AC-21, AC-22, AC-24 e AC-25:** autorização, auditoria, projeções, logs, exports e isolamento respeitam confidencialidade e side channels.
- **F13-AC-30:** completude e estados epistemológicos não constituem matching, scoring ou elegibilidade.

## Decisões ainda pendentes

- catálogo final de reason codes;
- classes de confidencialidade;
- policy de completude concreta;
- grants F5;
- retenção/legal hold;
- export/redaction;
- migração detalhada de dados legacy;
- semântica F14 por tipo de critério.

## Consequências

- O modelo é mais explícito que campos nullable, mas impede falsos zeros, negações inferidas e equivalências indevidas.
- Snapshots terão uma representação interna e projeções autorizadas distintas, cada uma com digest apropriado.
- Dados legacy ambíguos exigirão provenance de migração e poderão bloquear completude até revisão.
- F14 receberá estados inequívocos, mas continuará responsável pela interpretação por critério.

## Fontes

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
- `context/research/f13-knowledge-state-policy.md`

## Registo da aprovação humana

A aprovação humana confirmou o envelope multidimensional, `NOT_REQUIRED`, separação entre `DISPUTED` e `CONFLICTED`, `WITHHELD` como projeção sem alteração do conhecimento, dualidade de digests, completude sem truthiness e migração legacy conservadora. Esta decisão não fecha reason codes, classes, policies, grants ou semântica F14 e não autoriza implementação enquanto a F13 permanecer em `Draft`.
