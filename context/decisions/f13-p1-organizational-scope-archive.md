# F13-P1 — Archive de âmbitos organizacionais

- **Estado:** Aprovada
- **Âmbito:** F13-P1 — Fundação de Âmbitos Organizacionais
- **Decisão:** archive lógico leaf-first, concorrente e extensível por participante F13 source-local

## Política leaf-first

1. Archive é estritamente leaf-first na v1.
2. `TEAM` pode ser arquivada quando não possui descendentes ativos.
3. `UNIT` pode ser arquivada quando não possui descendentes ativos.
4. Qualquer descendente `ACTIVE`, em qualquer profundidade, bloqueia o archive.
5. Descendentes `ARCHIVED` não bloqueiam.
6. Não existe cascade de archive.
7. Não existe reparenting automático.
8. Não existe archive parcial da subárvore.
9. O caller deve arquivar explicitamente cada scope, da folha para a raiz.
10. Cada archive possui autorização, reason, CAS, idempotência e auditoria próprios.
11. Archive é terminal na v1.
12. Não existe restore.
13. Não existe delete físico.

## Integridade da árvore

14. Parent `ARCHIVED` não aceita novos children.
15. Scope ativo não pode ser reparented para parent arquivado.
16. Scope arquivado não pode ser usado como parent.
17. A verificação defensiva percorre toda a subárvore, não apenas children diretos.
18. Estado estrutural impossível ou contraditório falha fechado.
19. Leitores históricos podem resolver scopes arquivados.
20. Operações funcionais correntes recusam scopes arquivados.
21. Resource loaders distinguem leitura histórica de uso operacional corrente.

## Concorrência e locks

22. Toda mutação estrutural da árvore adquire advisory transaction lock por organização.
23. A chave do lock é determinística, tenant-bound e collision-safe segundo o padrão aprovado do projeto.
24. Depois do advisory lock, são adquiridos row locks numa ordem determinística.
25. A ordem de locks é consistente entre create, reparent e archive.
26. A verificação de descendentes ocorre dentro da mesma transação.
27. É usada recursive CTE ou mecanismo PostgreSQL equivalente sobre o estado bloqueado.
28. Create concorrente sob parent em archive não pode produzir child ativo após a verificação.
29. Reparent concorrente não pode introduzir descendente depois da verificação.
30. Dois archives concorrentes convergem sem estado parcial.
31. A operação não depende apenas de uma verificação application-side.
32. Deadlocks previsíveis são evitados por ordem canónica de locks.
33. Serialization/deadlock retry mantém a mesma intenção e idempotency key.

## CAS e idempotência

34. Archive exige revision esperada.
35. Revision divergente falha com erro fechado de conflito.
36. Archive persiste intenção e digest idempotente.
37. Repetir a mesma intenção depois do commit converge para o mesmo resultado.
38. Repetir a mesma key com intenção divergente é recusado.
39. Repetir archive sobre scope já arquivado só é idempotente quando corresponde à intenção persistida.
40. A operação não altera revision ou audit novamente num replay idempotente.
41. Commit incerto é reconciliado por estado persistido e intenção.

## F5, assurance e erros

42. Archive exige grant F5 específico para o resource e scope exatos.
43. Archive exige `RECENT_MFA`.
44. Archive exige reason code fechado.
45. O resource é carregado server-side.
46. O caller não fornece organização, lifecycle ou descendência confiáveis.
47. IDOR e scope inexistente usam resposta pública uniforme.
48. Descendentes ativos produzem erro público fechado.
49. O erro não enumera IDs, labels, tipos ou paths.
50. O erro não devolve contagem de descendentes.
51. Logs e traces não incluem labels ou estrutura integral da árvore.
52. Não existe autorização implícita por ser owner do parent.
53. Não existe `UNIT_SUBTREE`.

## F7 e transação source-local

54. Archive bem-sucedido produz evento F7 crítico.
55. O evento é persistido na mesma transação tenant-local.
56. O evento contém apenas IDs internos, tipo, revision, reason seguro, actor e resultado.
57. O evento não contém labels, códigos livres ou enumeração de descendentes.
58. Recusas sensíveis preservam o contrato deny-preserving já aprovado.
59. Falha F7 provoca rollback do archive.
60. Não existe publicação observacional que substitua o evento crítico source-local.

## Participante futuro F13

61. A integração futura F13 usa o mesmo client e transação.
62. O participant é capability-gated e registado internamente.
63. Antes de F13 existir, ausência legítima da capability significa ausência de efeitos F13.
64. Quando a capability F13 estiver declarada, o participant compatível é obrigatório.
65. Capability declarada sem participant compatível falha fechado.
66. O participant desativa o overlay ativo do scope antes do commit.
67. Falha na desativação do overlay provoca rollback integral.
68. Scope, overlay, pointer aplicável e F7 não podem divergir.
69. O participant não abre ligação ou transação independente.
70. O caller HTTP não injeta o participant nem o client.
71. Compatibilidade N/N-1 declara exatamente quando o participant é suportado.
72. Upgrade futuro adiciona a integração sem modificar migrations históricas F13-P1.

## Provas futuras

73. PostgreSQL deve provar archive de leaf.
74. Deve provar recusa com child ativo direto.
75. Deve provar recusa com descendente ativo profundo.
76. Deve provar que descendentes arquivados não bloqueiam.
77. Deve provar races create/archive e reparent/archive.
78. Deve provar CAS, retry, idempotência e intenção divergente.
79. Deve provar rollback quando F7 falha.
80. Deve provar rollback quando o participant F13 falha.
81. Deve provar funcionamento antes da instalação F13.
82. Deve provar recusa quando capability F13 é declarada sem participant.
83. Deve provar ausência de enumeração no erro público.
84. Benchmark permanece apenas baseline local, nunca SLO.

## Consequências

- O archive de uma subárvore é uma sequência explícita de comandos autorizados e auditados, da folha para a raiz.
- A serialização por organização é o boundary comum de create, reparent e archive; a implementação não pode introduzir ordens de lock divergentes.
- A fundação permanece instalável e utilizável sem F13. A capability futura torna obrigatório o participante compatível, sem fallback permissivo.
- A política de `stable_code` permanece a única decisão material aberta para readiness da F13-P1.

## Evidência e referências

- `context/decisions/organizational-scope-foundation.md`
- `context/research/f13-p1-archive-descendants.md`
- `context/features/f13-p1-organizational-scope-foundation.md`
- `context/decisions/f13-versioning-and-activation.md`
- `context/decisions/f13-authorization-and-segregation.md`
- `context/decisions/f13-schema-policy-compatibility.md`
