# F13-P1 — Política de `stable_code`

- **Estado:** Aprovada
- **Âmbito:** F13-P1 — Fundação de Âmbitos Organizacionais
- **Decisão:** alias institucional opcional, ASCII canónico, bytewise, imutável e único por organização

## Identidade e finalidade

1. UUID interno é a única identidade primária de Unit e Team.
2. `stable_code` é um alias institucional opcional.
3. `stable_code` não substitui UUID em FKs.
4. `stable_code` não é autoridade taxonómica.
5. `stable_code` não é external reference.
6. `stable_code` não é derivado de label.
7. Alterar label não altera código.
8. Ausência de código não reduz a validade da entidade.
9. APIs e imports futuros podem aceitar código apenas através de resolução tenant-bound explícita.
10. Resultados internos continuam a transportar UUID como identidade canónica.

## Grammar

11. O domínio é ASCII canónico.
12. O comprimento permitido é 1–64 caracteres.
13. A grammar exata é `^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*$`.
14. O primeiro carácter é sempre uma letra ASCII maiúscula.
15. Os restantes segmentos usam letras maiúsculas ou dígitos.
16. Hífen e underscore são apenas separadores entre segmentos não vazios.
17. Espaços não são permitidos.
18. Ponto não é permitido.
19. Caracteres Unicode não ASCII não são permitidos.
20. Separadores iniciais, finais ou consecutivos são recusados.
21. Input vazio é recusado; ausência deve ser representada por `NULL`.
22. Strings com mais de 64 caracteres são recusadas.
23. A mesma grammar é aplicada na aplicação e em PostgreSQL.

## Canonicalização

24. O valor fornecido deve já estar na forma canónica.
25. Não existe trim automático.
26. Não existe conversão automática para uppercase ou lowercase.
27. Não existe transliteração.
28. Não existe normalização por remoção de acentos.
29. Não existe substituição automática de whitespace ou pontuação.
30. Input não canónico é recusado, não transformado.
31. Não são mantidas formas display e normalized separadas.
32. A forma armazenada é a própria forma canónica.
33. Não é necessária normalização Unicode adicional porque apenas ASCII é aceite.
34. Idempotência compara a forma canónica exata.

## Comparação e collation

35. Comparação é bytewise.
36. Comparação não depende do locale do sistema, database ou sessão.
37. PostgreSQL usa collation `C` no boundary de comparação/indexação aplicável.
38. JavaScript compara a string ASCII canónica sem locale-sensitive transforms.
39. Não usar `citext`, `lower()`, `upper()` ou collations linguísticas para estabelecer identidade.
40. Startup/preflight deve recusar configuração física incompatível com o contrato.
41. A migration deve materializar constraint e índice coerentes com a comparação bytewise.

## Unicidade

42. Unicidade é por organização.
43. `UNIT` e `TEAM` partilham o mesmo namespace.
44. Unicidade não é limitada ao parent.
45. Unicidade não é limitada ao tipo.
46. Dois scopes da mesma organização não podem partilhar código.
47. Organizações distintas podem usar o mesmo código nas respetivas bases/contexts autorizados.
48. O índice inclui todas as entidades com código, independentemente do lifecycle.
49. Valores `NULL` múltiplos são permitidos.
50. Concorrência é resolvida pela constraint PostgreSQL, não apenas por pre-check.
51. Erro de colisão é sanitizado e não confirma qual entidade possui o código.
52. IDOR e colisão usam contratos públicos que não permitem enumeração.

## Lifecycle e archive

53. Código fornecido é definido exclusivamente na criação.
54. Uma entidade criada sem código permanece sem código na v1.
55. Não existe atribuição tardia `NULL → stable_code`.
56. Código não pode ser alterado.
57. Código não pode voltar a `NULL`.
58. Reparenting não altera código.
59. Alteração de label não altera código.
60. Archive não liberta código.
61. Scopes arquivados reservam o código permanentemente.
62. Não existe reutilização do código na v1.
63. Não existe operação F5 de rename ou late assignment na v1.
64. Tentativas de mutação falham fechado, inclusive através de SQL administrativo não autorizado.
65. Imutabilidade deve possuir proteção estrutural, não apenas application-side.

## Legacy e mappings

66. Códigos UBI e legacy não são promovidos automaticamente.
67. Labels legacy não são convertidas em códigos.
68. Não existe backfill inferido.
69. External references e mappings futuros usam modelo separado.
70. Mapping explícito conserva source, authority, provenance e versão.
71. Colisões legacy permanecem unmapped até decisão humana.
72. Stable codes não transportam automaticamente semântica de faculdade, centro, departamento ou equipa.

## Segurança e observabilidade

73. `stable_code` tem classificação mínima `INTERNAL`.
74. Código não deve conter secrets, credenciais ou dados pessoais.
75. A grammar reduz, mas não elimina, risco de conteúdo institucional sensível.
76. Erros públicos não devolvem o código conflitante.
77. Logs e traces não incluem o valor por defeito.
78. F7 referencia UUID interno; não necessita de incluir o código.
79. Leitura exata do código exige autorização normal sobre o resource.
80. Export segue a projection policy aplicável.
81. O caller nunca escolhe collation, comparação ou namespace.
82. Queries são tenant-bound e parametrizadas.

## Compatibilidade e provas

83. Grammar, comprimento e comparação pertencem ao contrato versionado.
84. Alterar qualquer dessas regras exige nova decisão e compatibilidade explícita.
85. Reader N/N-1 não transforma códigos históricos.
86. Writer emite apenas a forma corrente N.
87. Código inválido em estado persistido provoca incompatibilidade/startup failure; não é reparado silenciosamente.
88. Migration 006 não deve alterar dados legacy não pertencentes ao novo modelo.
89. Testes futuros devem cobrir todos os limites da grammar.
90. Devem cobrir lowercase, whitespace, Unicode, separadores e comprimento.
91. Devem provar unicidade Unit/Team e entre parents diferentes.
92. Devem provar concorrência de criação.
93. Devem provar reserva depois de archive.
94. Devem provar recusa de update, remoção e atribuição tardia.
95. Devem provar idempotência com valor exato e recusa de intenção divergente.
96. Devem provar comportamento bytewise independente do locale.
97. Devem provar erros sanitizados e ausência de enumeração.

## Consequências

- A forma persistida e a chave de comparação são a mesma string ASCII; não existe coluna normalizada paralela.
- A unique constraint `(organization_id, stable_code)` cobre ambos os tipos e lifecycles; `NULL` continua opcional.
- A proteção estrutural de imutabilidade cobre valor, remoção e atribuição tardia.
- A alteração futura da grammar exige nova decisão, schema/release bundle e compatibilidade explícita, sem reinterpretar histórico.
- A aprovação encerra o último blocker material conhecido antes do readiness audit da F13-P1; não autoriza implementação.

## Evidência e referências

- `context/research/f13-p1-stable-code.md`
- `context/decisions/organizational-scope-foundation.md`
- `context/decisions/f13-p1-organizational-scope-archive.md`
- `context/decisions/f13-schema-policy-compatibility.md`
- `backend/src/audit/canonicalJson.js`
- `backend/src/audit/event.js`
- `backend/src/authorization/catalogs.js`
- `backend/src/security/tenantMigrationManifest.js`
- `backend/src/security/tenantMigrationPreflight.js`

## Registo da aprovação humana

A aprovação confirmou UUID como identidade, ASCII canónico sem transformação, igualdade bytewise sob collation `C`, namespace único por organização, reserva após archive, imutabilidade total e ausência de atribuição tardia. Nenhum F13-P1-AC fica `PASS` por esta decisão documental.
