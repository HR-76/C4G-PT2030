# F13 — Confidencialidade, projection, reason e purpose

- Estado: **Aprovada**
- Feature: `F13 — Perfil organizacional para matching`
- Data de aprovação humana: 2026-10-10

## Contexto

A F13 contém informação institucional com sensibilidades diferentes. Classificação, autorização, finalidade, razão, projeção e exportação precisam de contratos separados para impedir acesso implícito, redaction inconsistente e side channels.

## Decisão

### Dimensões independentes

1. Confidencialidade classifica a sensibilidade do dado.
2. F5 decide se uma operação é autorizada.
3. Purpose declara a finalidade institucional autorizada.
4. Reason justifica uma ação ou acesso concreto.
5. Projection policy determina a representação devolvida.
6. Export é uma operação própria, não uma variante implícita de leitura.
7. Nenhuma dessas dimensões substitui outra.
8. Confidencialidade não concede acesso.
9. Possuir permission não permite escolher livremente uma projeção.
10. Purpose ou reason válidos não substituem permission, scope, assurance ou SoD.

### Classes v1

As classes aprovadas são:

- `INTERNAL`;
- `RESTRICTED`;
- `HIGHLY_RESTRICTED`.

11. Não existe classe `PUBLIC` na v1.
12. `INTERNAL` significa acesso tenant-local autorizado, não publicação pública.
13. `RESTRICTED` exige operação específica e controlos reforçados definidos pela policy.
14. `HIGHLY_RESTRICTED` exige o caminho mais restrito aprovado para a F13.
15. A classe mínima é definida pela policy fechada do slot ou domínio.
16. Uma assertion pode elevar a classificação quando a policy o permite.
17. Uma assertion ou overlay nunca reduz a classificação mínima.
18. Composição usa a classificação mais restritiva aplicável.
19. Ausência de classificação explícita não produz `INTERNAL` por default.
20. Estado desconhecido ou policy incompatível falha fechado.
21. Classificação publicada é imutável na respetiva versão.
22. Reclassificação produz nova versão e não altera histórico.
23. Downgrade de classificação exige operação própria, maker-checker, `RECENT_MFA`, reason e F7.
24. Upgrade de classificação também é auditado e versionado.
25. Service actors não executam reclassificação humana sensível.

### Localização da classificação

26. A policy do domínio define a classificação mínima do slot.
27. Assertion, valor derivado e evidência podem ter classificação mais restritiva.
28. Evidência documental continua sujeita ao contrato F11.
29. A classificação de uma referência F11 não reduz a classificação do documento.
30. O acesso ao perfil não concede automaticamente acesso ao documento referenciado.
31. Valores financeiros exatos e evidências são pelo menos `RESTRICTED`.
32. Informação com risco material de inferência pode ser `HIGHLY_RESTRICTED`.
33. Bandas derivadas não herdam automaticamente a possibilidade de divulgar o valor exato.
34. Pequenos grupos e populações vulneráveis exigem avaliação explícita de risco de inferência.
35. A classificação aplica-se também a metadata, cardinalidades e existência quando estas forem sensíveis.

### Projection modes

Os modos técnicos aprovados são:

- `EXACT`;
- `DERIVED`;
- `REDACTED`;
- `OMITTED`.

36. `EXACT` devolve a representação autorizada integral.
37. `DERIVED` devolve apenas um valor derivado autorizado por policy publicada.
38. `REDACTED` devolve uma representação sanitizada definida pela policy.
39. `OMITTED` não devolve o campo nem confirma necessariamente a sua existência.
40. O caller não escolhe livremente o projection mode.
41. A seleção é server-side e considera operação, permission, scope, purpose, classificação e policy version.
42. Valores não autorizados nunca são carregados para depois serem filtrados pelo caller.
43. API, ecrã e export usam a mesma projection policy para a mesma operação e finalidade.
44. Export completo e export redigido são operações F5 distintas.
45. Uma projeção mais permissiva nunca é inferida de outra permission.

### WITHHELD e omissão

46. `WITHHELD` é significado apresentado, não knowledge state interno.
47. `WITHHELD` pode ser mostrado apenas quando a projection policy autoriza confirmar a existência do dado.
48. Quando confirmar a existência cria side channel, usar `OMITTED`.
49. `WITHHELD` não substitui nem elimina o valor semântico interno.
50. Completion é avaliada antes da projeção.
51. Um valor conhecido e withheld continua semanticamente conhecido.
52. `REDACTED` não pode produzir um valor semanticamente enganador.
53. `DERIVED` deve identificar a policy e versão usadas.
54. Contagens, paginação, ordenação e metadata seguem a mesma política de projeção.

### Digests e histórico

55. `semantic_digest` representa o conteúdo semântico interno autorizado.
56. `projection_digest` representa a projeção concreta, policy e versão utilizadas.
57. O projection digest não contém secrets ou material sensível reversível.
58. Projeções diferentes do mesmo snapshot podem ter digests diferentes.
59. Uma projeção nunca altera o semantic digest.
60. Nova projection policy não reescreve projeções históricas persistidas.
61. Reproduzir uma projeção histórica exige as mesmas versões ou uma incompatibilidade explícita.
62. Divergência de digest falha fechado.

### Purpose catalog

63. Purpose codes são fechados, versionados e operation-scoped.
64. Purpose é selecionado entre valores autorizados server-side para a operação.
65. O cliente pode solicitar um purpose permitido, mas não criar códigos.
66. Purpose incompatível com a operação é recusado.
67. Um purpose não amplia scopes ou permissions.
68. O catálogo inicial deve ser mínimo e baseado em casos reais da F13.
69. Considerar como candidatos, sujeitos à nomenclatura final:
    - manutenção do perfil institucional;
    - verificação institucional;
    - análise interna autorizada;
    - preparação de matching futuro;
    - auditoria/compliance;
    - export institucional autorizado.
70. Não criar purposes genéricos como `OTHER` sem governance.
71. Purpose fica registado em acessos restritos e exports.
72. Purpose não entra em payloads públicos.

### Reason catalog

73. Reason codes são fechados, versionados e específicos da operação.
74. Reason justifica a ocorrência concreta da ação.
75. Reason não é texto livre usado como substituto de código.
76. Comentário complementar, quando permitido, é sanitizado e não altera semântica.
77. Reason é obrigatório para:
    - leitura restrita;
    - leitura altamente restrita;
    - export;
    - reclassificação;
    - disputa, revogação e resolução;
    - rollback e archive/restore sensíveis.
78. Reason codes de mutação são distintos de purposes de acesso.
79. Reason inválido ou ausente falha antes de carregar valores restritos.
80. Reason e purpose são auditados sem incluir o conteúdo acedido.

### F5, assurance e SoD

81. Leitura redigida, leitura exata, leitura de evidência, export redigido e export completo são permissions distintas.
82. Leituras `RESTRICTED` e `HIGHLY_RESTRICTED` exigem `RECENT_MFA`.
83. Todo export exige `RECENT_MFA`.
84. Reclassificação exige `RECENT_MFA` e maker-checker.
85. Acesso a evidência F11 exige também autorização F11 aplicável.
86. Service actors só usam operações explicitamente aprovadas para o seu tipo.
87. Não existe break-glass na v1.
88. Resources, classificação efetiva e projection policy são carregados server-side.
89. O caller não fornece atributos de autorização confiáveis.

### F7, F10 e side channels

90. Acessos restritos, exports, reclassificações e recusas relevantes produzem F7 sanitizado.
91. F7 inclui subject, operação, resource, purpose, reason, classification, projection mode, policy version e resultado seguro.
92. F7 não inclui valor, documento, PII ou conteúdo integral.
93. Recusas não confirmam a existência de recursos inacessíveis.
94. F10 usa atributos fechados e de baixa cardinalidade.
95. F10 não inclui tenant data, labels livres, valores ou IDs sensíveis.
96. Respostas equivalentes devem reduzir inferência por códigos, tamanhos e estrutura.
97. Queries de contagem e paginação aplicam autorização antes de produzir totais.
98. Ordenação não expõe chaves de campos omitidos.
99. Existence checks seguem a mesma decisão de autorização.
100. Diferenças de timing materialmente exploráveis devem ser mitigadas nos boundaries relevantes.
101. Ecrã, API e export não podem divergir na autorização efetiva.
102. Erros públicos são fechados e sanitizados.

### Compatibilidade

103. Classes, projection modes, purposes, reasons e policies possuem versões próprias.
104. Compatibilidade N/N-1 é declarada, nunca presumida.
105. Startup rejeita códigos desconhecidos, mappings incompletos ou digests divergentes.
106. Snapshots históricos preservam as versões usadas.
107. Novos catálogos não reinterpretam silenciosamente histórico.
108. Remoção ou depreciação de código exige caminho compatível explícito.
109. Alterações de policy não ampliam acesso a snapshots anteriores automaticamente.
110. Retenção e legal hold produtivos permanecem fora do âmbito, mas os identificadores necessários à futura aplicação não devem ser destruídos.

## Detalhes pendentes

- códigos e nomes finais de purpose e reason;
- policies concretas por domínio e operação;
- critérios para `HIGHLY_RESTRICTED`;
- schemas F7 finais;
- mitigação quantitativa de timing;
- retenção e legal hold produtivos.

## Consequências

- Classification nunca substitui F5 e projection nunca altera conteúdo semântico interno.
- Reclassification e exports permanecem ações próprias, versionadas, autorizadas e auditadas.
- Os detalhes pendentes não reabrem o modelo aprovado salvo incompatibilidade material demonstrada.

## Referências

- `context/research/f13-confidentiality-projection-purpose.md`
- `context/decisions/f13-authorization-and-segregation.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/decisions/f13-completion-policy.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f10-operational-observability.md`
- `context/history/f11-private-document-storage.md`
