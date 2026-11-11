# F13 — Fronteira entre exclusions e regras F14

- Estado: **Aprovada**
- Feature: `F13 — Perfil organizacional para matching`
- Data de aprovação humana: 2026-10-10

## Contexto

A F13 precisa de conservar constraints institucionais legítimas sem avaliar oportunidades nem duplicar o futuro motor determinístico F14. A fronteira separa assertions declarativas do perfil de regras executáveis que produzem compatibilidade, elegibilidade, ranking ou score.

## Decisão

### Fronteira de responsabilidade

1. A F13 conserva factos, capacidades, assertions, constraints e respetivo estado epistemológico.
2. A F13 não avalia oportunidades.
3. A F13 não determina elegibilidade, compatibilidade, ranking ou score.
4. A F14 contém as regras executáveis que comparam uma oportunidade com um snapshot F13.
5. Uma assertion F13 nunca produz isoladamente um resultado de matching.
6. Um resultado F14 deve referenciar a oportunidade, respetiva revisão, snapshot F13, assertion relevante e versão da regra aplicada.
7. Alterar regras F14 não altera snapshots ou assertions F13 históricos.
8. Alterar o perfil F13 não reescreve resultados F14 históricos.

### Modelo de constraints F13

9. Adotar assertions declarativas, fechadas, versionadas e governadas.
10. Aprovar os tipos v1 `PROHIBITED` e `UNAVAILABLE`.
11. `PROHIBITED` representa uma restrição normativa, legal, estatutária, de governance ou política institucional explícita.
12. `UNAVAILABLE` representa indisponibilidade factual de capacidade, território, recurso, competência ou condição institucional durante um período.
13. `NOT_PREFERRED` fica fora da F13 v1.
14. Preferências negativas, pesos e penalizações pertencem à futura política F14.
15. `UNKNOWN`, `WITHHELD`, ausência e incompletude nunca são convertidos em `PROHIBITED` ou `UNAVAILABLE`.
16. Uma constraint deve identificar authority, reason code, período, scope, provenance, lifecycle e estado de verificação.
17. Constraints publicadas são imutáveis; correção, revogação, disputa ou expiração criam nova evidência/versionamento sem reescrever histórico.
18. Constraints disputadas, revogadas ou expiradas não podem ser silenciosamente tratadas como constraints correntes.
19. O comportamento perante conflito ou disputa deve ser explícito e fail-closed.

### Operandos permitidos

20. Operandos referenciam exclusivamente schemes, conceitos, relações e releases governados.
21. A F13 não aceita texto livre como operando executável.
22. A F13 não aceita nomes de tabelas, colunas ou campos fornecidos pelo caller.
23. Não são permitidos SQL, JavaScript, JSON Logic, CEL, scripts, templates executáveis ou DSL livre.
24. Não são permitidos operadores arbitrários fornecidos pelo caller.
25. Não são permitidas referências a IDs de oportunidades, avisos ou candidaturas.
26. Uma constraint não pode codificar indiretamente a lógica de um aviso específico.
27. O catálogo de tipos de constraint, targets, reason codes e relações é fechado e versionado.
28. Comparações quantitativas ou thresholds de oportunidades pertencem às regras F14, não às assertions F13.
29. A F13 pode registar indisponibilidade de um facto ou capacidade, mas não a expressão “não elegível quando o aviso exigir X”.

### Scope, overlays e composição

30. Constraints usam apenas scopes F13 canónicos e permitidos pelo domínio.
31. Baseline organizacional pode declarar constraints aplicáveis à organização.
32. Overlays podem acrescentar constraints ao respetivo scope.
33. Overlays nunca removem, neutralizam ou relaxam constraints herdadas.
34. Não existe herança implícita `TEAM → UNIT`.
35. Não existe `UNIT_SUBTREE`.
36. A composição efetiva materializa todas as constraints aplicáveis no snapshot.
37. A origem de cada constraint deve permanecer identificável depois da composição.
38. Duplicados semanticamente idênticos podem ser normalizados sem perder provenance.
39. Constraints contraditórias devem impedir a materialização ou marcar conflito explícito; nunca devem ser resolvidas por ordem incidental.
40. Archive de scope segue a decisão da fundação organizacional e impede novas operações no respetivo overlay.

### Execução pela F14

41. A F14 aplica exclusivamente regras próprias, fechadas e versionadas.
42. A F14 decide se uma constraint é relevante para um requisito concreto da oportunidade.
43. `PROHIBITED` não equivale automaticamente a “incompatível” sem uma regra F14 aplicável.
44. `UNAVAILABLE` não equivale automaticamente a “incompatível” sem considerar período, scope e regra F14.
45. A F14 deve distinguir incompatibilidade, compatibilidade e resultado indeterminado.
46. Dados `UNKNOWN`, `WITHHELD`, `CONFLICTED` ou incompletos devem permanecer distinguíveis no resultado.
47. A F14 não pode modificar a assertion ou snapshot F13 durante a avaliação.
48. A explicação F14 cita tanto a assertion F13 como a regra F14 responsável pela conclusão.
49. Reprocessamento usa as mesmas versões ou cria novo resultado histórico; nunca atualiza silenciosamente o anterior.

### Segurança, autorização e auditoria

50. Criação e alteração editorial reutilizam inicialmente as operações F5 de perfil já aprovadas.
51. Aprovação, publicação e ativação continuam sujeitas a maker-checker e `RECENT_MFA`.
52. A investigação não aprova ainda uma operação F5 exclusiva para verificar constraints.
53. A necessidade de uma operação específica de verificação permanece detalhe a resolver antes da implementação.
54. Toda mutação crítica produz evento F7 source-local na mesma transação.
55. Payloads F7 não incluem valores restritos, documentos, PII ou conteúdo integral.
56. O snapshot inclui digests e versões suficientes para reprodução.
57. A projeção redigida não pode alterar a semântica interna da constraint.
58. A leitura pública ou redigida não pode criar side channels sobre constraints confidenciais.

### Compatibilidade

59. Nenhum campo F12, UBI ou legacy é convertido automaticamente em constraint.
60. Exclusões textuais antigas permanecem preservadas e `unmapped` até decisão explícita.
61. Não existe backfill inferido por labels.
62. A introdução de constraints não altera snapshots históricos já publicados.
63. Mappings futuros exigem método, versão, provenance e aprovação próprios.

## Detalhes pendentes

- catálogo inicial de targets e reason codes;
- regras de confidencialidade e projeção;
- métodos de verificação;
- operação F5 específica de verificação, se necessária;
- schemas finais dos eventos F7;
- tratamento operacional de conflitos durante materialização.

Estes pontos não reabrem a fronteira F13/F14 aprovada, salvo incompatibilidade material demonstrada.

## Consequências

- `NOT_PREFERRED` deixa de ser dado F13 e só poderá ter significado numa política F14 futura.
- O schema F13 futuro deve impedir código executável, operadores livres e referências específicas a oportunidades.
- A F14 terá de conservar referências exatas ao snapshot, assertion, oportunidade/revisão e rule version usados.

## Referências

- `context/research/f13-exclusions-vs-f14-rules.md`
- `context/features/matching-and-qualification.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/f13-versioning-and-activation.md`
- `context/decisions/f13-authorization-and-segregation.md`
