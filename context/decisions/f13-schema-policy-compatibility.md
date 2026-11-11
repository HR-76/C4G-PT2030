# F13 — Compatibilidade schema/policy N/N-1

- Estado: **Aprovada**
- Âmbito: evolução compatível de schemas, policies, catálogos, snapshots, jobs e consumidores F13
- Data: 2026-10-10

## Contexto

A F13 combina versões independentes de schema, snapshots, policies, catálogos, eventos, jobs e contratos consumidores. A compatibilidade não pode resultar da combinação implícita de versões isoladamente conhecidas: deve ser declarada como uma tuple integral, testada e reproduzível. Esta decisão aprova uma janela estrita N/N-1 sem reinterpretar histórico nem exigir upgrade atómico de API, worker e dados.

## Decisão

### CompatibilityManifest e release bundles

1. A compatibilidade é declarada por `CompatibilityManifest` fechado, publicado, imutável e digestado.
2. O manifest contém tuples exatas de versões compatíveis.
3. Não são permitidos produtos cartesianos implícitos entre versões individualmente suportadas.
4. Cada tuple pertence a um release bundle identificado e versionado.
5. O bundle referencia explicitamente profile schema, snapshot schema, completion policies, projection policies, taxonomias e catálogos, purpose e reason catalogs, operations e permissions, event schemas, job type e payload versions, adapters autorizados e consumer contract.
6. Uma versão ausente, desconhecida ou futura falha fechado.
7. N-2 não é suportada na v1.
8. Alterar o manifest produz nova versão; não reescreve bundles publicados.
9. Startup valida digest, unicidade e coerência integral do manifest.

### Writers e readers

10. Writers emitem exclusivamente o bundle corrente N.
11. Writers não produzem N-1 para facilitar rollback.
12. Readers aceitam N e N-1 apenas quando a tuple exata está declarada.
13. Suporte individual a versões não implica suporte à combinação.
14. N-1 é convertido apenas por adapter explícito e versionado.
15. Adapter N-1 é puro, determinístico e conservador.
16. Adapter opera apenas em memória.
17. Leitura N-1 não persiste upgrade automático.
18. Adapter não inventa valores, estados, provenance, digests ou mappings.
19. Informação sem representação segura permanece explicitamente desconhecida ou incompatível.
20. Divergência de digest falha fechado.
21. Snapshots históricos nunca são reinterpretados ou mutados silenciosamente.

### Ativação e histórico

22. Novas versões e snapshots são criados apenas em N.
23. Nova ativação exige bundle corrente N.
24. Snapshot N-1 pode permanecer ativo apenas durante a janela transitória explicitamente autorizada.
25. Snapshot N-1 continua disponível para leitura histórica quando a tuple estiver suportada.
26. Ativação não converte N-1 automaticamente.
27. Rollback funcional cria nova ativação e preserva histórico.
28. Rollback não reabre ou modifica snapshots antigos.
29. Pointer ativo só referencia snapshot `READY` e bundle autorizado.
30. Pointer swap valida a tuple completa antes do commit.
31. Incompatibilidade impede materialização e ativação parciais.

### Policies e catálogos

32. Completion policy declara os profile/snapshot schemas que suporta.
33. Completion policy N não avalia schema N-1 salvo tuple explícita.
34. Projection policy declara os schemas e classes que suporta.
35. Projection policy N não amplia acesso a snapshots N-1.
36. Purpose, reason, operation e permission catalogs fazem parte da tuple.
37. Código deprecated permanece interpretável nos bundles históricos autorizados.
38. Código removido não é remapeado automaticamente.
39. Mappings externos mudam por nova release e não alteram histórico.
40. Taxonomia nova não reclassifica snapshots anteriores.
41. Nenhum catálogo usa fallback por label.
42. Compatibility adapters não substituem migrations nem mappings governados.

### Jobs F9

43. Jobs F13 declaram `job_type_version` e `payload_version`.
44. Compatibilidade é definida pela tuple exata, não por intervalos independentes.
45. Handler anuncia capabilities explícitas.
46. Job só entra no handler quando a tuple for compatível.
47. Job incompatível não é acknowledged como concluído.
48. Payload incompatível é preservado para retry ou reconciliação após deploy compatível.
49. Recusa não produz efeito parcial.
50. Retry preserva idempotency key, digest, lineage e attempt.
51. Redelivery não permite selecionar handler incompatível.
52. Replay usa a tuple histórica autorizada ou é recusado.
53. A limitação atual do registry F9 — versões de job e payload aceites independentemente — não deve ser copiada pelos jobs F13.
54. Uma correção transversal do registry F9 só entra no âmbito F13 se necessária para os jobs F13 e após plano explícito.

### API, worker e fencing

55. API e worker validam o mesmo `CompatibilityManifest`.
56. API N/worker N-1 e API N-1/worker N são permitidos apenas quando a tuple está declarada.
57. Capabilities são publicadas separadamente por workload.
58. Fencing impede novas operações através de workload incompatível.
59. Lease iniciada antes de mudança de fence segue o contrato já aprovado ou falha sem efeito parcial.
60. Restart reconstrói versões, capabilities e fences a partir de estado persistido.
61. Divergência entre workloads falha fechado.
62. Rollout não presume atualização atómica de API e worker.

### Startup e integridade

63. Startup valida manifests, migration ledgers, fingerprints, capabilities, compatibility matrix, policy e catalog digests, handlers, adapters e release bundles.
64. Drift impede servir operações F13.
65. Falha de startup é sanitizada e observável.
66. Manifest incompleto ou ambíguo é incompatível.
67. Adapter declarado mas ausente é incompatível.
68. Adapter não declarado mas presente não é usado.
69. Uma capability publicada só é válida para a tuple exata.
70. Startup não repara schema, ledger ou manifest automaticamente.

### Upgrade e rollback

71. Upgrades seguem `expand → migrate → contract`.
72. Expand é aditivo e compatível com o binário anterior quando declarado.
73. Migrate cria dados novos apenas com provenance e regras explícitas.
74. Estados epistemológicos não recebem backfill inferido.
75. Contract só ocorre numa feature posterior, após remoção formal do suporte N-1.
76. Migrations publicadas não são alteradas sem compatibilidade histórica restrita e explícita.
77. Upgrade de instalações existentes usa runners, manifests, ledgers e fingerprints canónicos.
78. Falha entre SQL e ledger faz rollback integral.
79. Commit incerto é reconciliado por estado físico e ledger.
80. Retry converge idempotentemente.
81. Rollback de software só é permitido se o binário anterior declarar suporte ao schema instalado.
82. Não existe downgrade destrutivo de dados.
83. Rollback incompatível é recusado antes de servir tráfego.
84. Remoção de N-1 exige decisão, evidência de drenagem e nova release.

### F14 e consumo futuro

85. F14 referencia exatamente o bundle, snapshot, policies, catálogos e rule version utilizados.
86. F14 não reavalia um resultado histórico com versões correntes de forma silenciosa.
87. Consumer contract F14 possui versão própria.
88. Snapshot N-1 só é consumido pela F14 quando a tuple estiver declarada.
89. Falta de adapter ou regra compatível produz resultado fechado, não aproximação.
90. Suporte N/N-1 local não representa prontidão produtiva.

### Auditoria e testes futuros

91. Incompatibilidades relevantes produzem F7 sanitizado.
92. F10 usa códigos fechados e sem conteúdo do perfil.
93. Erros públicos não revelam estrutura interna ou existência de dados inacessíveis.
94. Testes futuros devem cobrir N, N-1, N-2, versão futura e tuple cruzada.
95. Devem existir provas API/worker em versões mistas autorizadas e recusadas.
96. Corpus histórico deve provar ausência de mutação on-read.
97. PostgreSQL deve provar upgrade incremental, retry e commit incerto.
98. Fault injection deve cobrir schema, ledger, snapshot e pointer swap.
99. Jobs incompatíveis devem provar preservação sem acknowledgement.
100. Remoção futura de N-1 exige evidência própria e não faz parte desta decisão.

## Detalhes de implementação pendentes

- formato físico do manifest e release bundle;
- numeração inicial das versões;
- schemas concretos de adapters;
- códigos finais de erro, F7 e F10;
- duração operacional da janela N/N-1;
- implementação futura dos jobs F13.

Estes detalhes não autorizam combinações implícitas nem reabrem a janela N/N-1 aprovada sem incompatibilidade material demonstrada.

## Consequências

- A F13 pode fechar o contrato de compatibilidade sem implementar rollout produtivo.
- O comportamento atual do registry F9 é evidência de uma limitação a não reproduzir, não arquitetura normativa F13.
- O runner canónico, o estado persistido e a tuple integral são a única evidência de compatibilidade; não existem reparações ou defaults em startup.
- Nenhum critério F13 fica `PASS` por esta decisão documental.

## Fontes

- `context/research/f13-schema-policy-compatibility.md`
- `context/features/f13-organizational-profile.md`
- `context/decisions/f13-completion-policy.md`
- `context/decisions/f13-confidentiality-projection-purpose.md`
- `context/decisions/f13-versioning-and-activation.md`
- `context/history/f4-tenant-runtime-access.md`
- `context/history/f9-async-execution-foundation.md`
- `context/history/f12-opportunity-catalog.md`

## Registo da aprovação humana

A aprovação confirmou manifests e bundles por tuple exata, writer apenas N, readers N/N-1 declarados, adapters conservadores em memória, novas ativações apenas N, jobs e workloads fenced por tuple, startup fail-closed e upgrade `expand → migrate → contract`. Não autoriza implementação, rollout ou F14.
