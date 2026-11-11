# F13 — Completion policy

- Estado: **Aprovada**
- Feature: `F13 — Perfil organizacional para matching`
- Data de aprovação humana: 2026-10-10

## Contexto

A F13 precisa de distinguir validade estrutural, completude editorial e readiness sem exigir falsa certeza nem prometer elegibilidade. A policy deve produzir snapshots reproduzíveis, admitir estados epistemológicos legítimos e preservar coortes atómicas.

## Decisão

### Conceitos separados

1. Validade estrutural, completude, verificação, qualidade, readiness e elegibilidade são conceitos distintos.
2. Completude não representa verdade, exatidão, qualidade ou verificação universal.
3. Completude não determina elegibilidade ou compatibilidade com oportunidades.
4. A F14 pode considerar insuficiente um snapshot `READY` para uma regra concreta.
5. A ausência de registo significa apenas “não materializado”.
6. Completion nunca usa truthiness.
7. Zero, `false`, conjunto vazio, `NONE`, `UNKNOWN`, `NOT_APPLICABLE` e `WITHHELD` não são semanticamente equivalentes.
8. Não existe percentagem nem score de completude.
9. O resultado é exclusivamente `COMPLETE|INCOMPLETE`.
10. Um resultado inclui findings estruturados, determinísticos e ordenados.

### CompletionPolicy

11. `CompletionPolicy` é publicada, versionada e imutável.
12. A policy é identificada por versão própria e pelas versões de schema às quais se aplica.
13. A policy é específica por `profile_schema_version`, `scope_type` e domínio.
14. A policy possui uma lista fechada de slots.
15. Cada slot define estados epistemológicos admissíveis.
16. Cada slot pode exigir `KNOWN` quando isso for indispensável ao contrato.
17. `UNKNOWN`, `NONE` e `NOT_APPLICABLE` só são admissíveis quando explicitamente autorizados para o slot.
18. Estados autorizados podem exigir reason codes fechados.
19. A policy pode definir constraints inter-slot fechadas e versionadas.
20. A policy não aceita SQL, JavaScript, JSON Logic ou DSL fornecida pelo caller.
21. A policy não contém regras de matching ou requisitos específicos de oportunidades.
22. Policies publicadas não são alteradas in-place.
23. Nova policy não invalida retroativamente versões e snapshots históricos.

### Avaliação

24. Completion é avaliada sobre o conteúdo semântico interno integral.
25. Completion nunca é avaliada sobre uma projeção redigida.
26. `WITHHELD` não altera o knowledge state interno.
27. Um valor conhecido mas ocultado por projeção continua semanticamente materializado.
28. A avaliação identifica policy, slot, requisito, estado observado, resultado e reason code.
29. Findings são ordenados por regra canónica, sem depender da ordem de inserção.
30. Inputs, policy, findings e resultado possuem digests reproduzíveis.
31. A mesma intenção e os mesmos inputs produzem o mesmo resultado.
32. Divergência de digest falha fechado.
33. A avaliação suporta CAS e idempotência por intenção.
34. Completion é recalculada para a versão candidata; não muta versões anteriores.

### Estados correntes

35. `DISPUTED` não satisfaz um slot corrente obrigatório.
36. `CONFLICTED` não satisfaz um slot corrente obrigatório.
37. `REVOKED` não satisfaz um slot corrente obrigatório.
38. `EXPIRED` não satisfaz um slot corrente obrigatório.
39. Esses estados não são convertidos automaticamente em `UNKNOWN`.
40. `VERIFIED` só é obrigatório quando a policy do slot o exige.
41. `UNVERIFIED` pode ser admissível apenas por regra explícita.
42. `NOT_REQUIRED` é admissível somente quando a policy de verificação o permite.
43. `NONE` exige authority e período quando já exigidos pela política epistemológica.
44. `NOT_APPLICABLE` exige reason code.
45. `UNKNOWN` não pode ser usado para contornar um slot que exige `KNOWN`.

### Lifecycle e gates

46. Validade estrutural é exigida antes de submissão.
47. Completion é obrigatoriamente avaliada antes da aprovação.
48. Aprovação referencia a policy e o resultado usados.
49. Publicação não remove a necessidade de revalidar compatibilidade de versões.
50. Materialização aplica todas as policies relevantes à versão e ao scope.
51. Um snapshot só recebe estado `READY` quando todas as policies aplicáveis passam.
52. `READY` não significa adequação para todas as oportunidades.
53. O pointer ativo só pode referenciar snapshot `READY`.
54. Policies ou referências incompatíveis falham antes do pointer swap.
55. Falha de completion não produz ativação parcial.
56. Mutações críticas e recusas são auditadas por F7 na transação source-local aplicável.

### Baselines, overlays e coortes

57. A baseline organizacional é obrigatória.
58. Overlays são opcionais, mas um overlay incluído na coorte deve estar completo.
59. Um overlay incompleto incluído bloqueia atomicamente toda a coorte.
60. Não existe ativação parcial dos membros de uma coorte.
61. Um overlay pode ser explicitamente omitido da nova coorte.
62. Overlay anterior omitido é desativado conforme a decisão de lifecycle aprovada.
63. Overlay omitido não permanece implicitamente ligado à nova baseline.
64. A decisão de omissão é explícita, autorizada, auditada e protegida por CAS.
65. Overlays não relaxam constraints herdadas.
66. A origem dos findings distingue baseline e overlay.

### Compatibilidade

67. O snapshot regista:
    - profile schema version;
    - completion policy versions;
    - taxonomy/catalog releases;
    - semantic digest;
    - completion result digest.
68. Compatibilidade N/N-1 é declarada, nunca presumida.
69. Um consumidor recusa schema ou policy incompatível.
70. Referências a conceitos inexistentes, deprecated de forma incompatível ou pertencentes à release errada falham fechado.
71. Depreciação posterior não altera snapshots históricos.
72. Mudança de policy exige nova versão e novo snapshot para produzir efeito corrente.
73. Não existe reavaliação retroativa silenciosa.
74. Dados legacy ambíguos seguem a política conservadora já aprovada.

### Segurança e observabilidade

75. Completion usa dados internos mesmo quando a projeção externa é redigida.
76. Findings públicos não expõem valores confidenciais.
77. Erros públicos usam códigos fechados e mensagens sanitizadas.
78. F7 regista policy, versão, resultado, digest e reason codes seguros.
79. F10 pode observar duração, contagens por resultado e códigos fechados.
80. Métricas não incluem valores, documentos, labels sensíveis ou PII.
81. Logs não incluem conteúdo integral do perfil.
82. Completion reports exatos exigem autorização adequada.
83. Exportar findings é distinto de ler valores restritos.

### Testabilidade

84. A policy deve possuir corpus fixo de casos válidos e inválidos.
85. Testes devem cobrir cada knowledge, verification e conflict state.
86. Property tests devem provar determinismo, ordenação e ausência de defaults.
87. PostgreSQL deve provar constraints, CAS, concorrência e atomicidade de coorte.
88. Testes N/N-1 devem cobrir schema, policy e catálogo.
89. Fault injection deve provar ausência de snapshot ou pointer parcial.
90. A evidência deve distinguir completion interna de projeção externa.

## Detalhes pendentes

- slots e policies concretas por domínio;
- reason codes finais;
- schemas finais dos findings;
- limites síncronos de materialização;
- códigos F7 e métricas F10 finais.

Estes detalhes não reabrem o modelo aprovado sem incompatibilidade material.

## Consequências

- Drafts podem permanecer incompletos; approval e materialização usam evaluation determinística.
- Um snapshot `READY` cumpre o contrato F13 aplicável, mas não promete utilidade ou elegibilidade F14.
- Mudanças futuras de policy produzem novas versões/snapshots e preservam todo o histórico.

## Referências

- `context/research/f13-completion-policy.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/f13-versioning-and-activation.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-exclusions-vs-f14-rules.md`
