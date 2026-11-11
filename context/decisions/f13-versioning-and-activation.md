# Decisão: versionamento, aprovação, publicação e ativação F13

## Estado

**Aprovada.**

## Contexto

A F13 precisa permitir edição colaborativa sem tornar conteúdo publicado mutável, ativar baseline e overlays sem gaps ou composições incoerentes e entregar à F14 apenas snapshots completos e reproduzíveis. A decisão adota versões imutáveis, cutover por coorte e registos de ativação append-only.

## Decisão

1. Draft é um objeto lógico editado por revisões imutáveis.
2. Cada edição cria nova revision.
3. CAS usa revision esperada.
4. Idempotência usa command/idempotency key e digest da intenção.
5. Aprovação congela uma revisão específica e cria versão imutável.
6. Conteúdo aprovado não pode ser alterado.
7. Alteração exige novo Draft/revision/version.
8. `APPROVED` e `PUBLISHED` são estados distintos.
9. `APPROVED` significa revisão aprovada.
10. `PUBLISHED` significa versão elegível para ativação.
11. Publicação não ativa automaticamente.
12. Pode existir versão publicada e inativa.
13. Scheduling automático fica fora da v1.
14. Ativação é manual e imediata.
15. Reautorização ocorre no momento da ativação.
16. F13 mantém:
    - versões imutáveis;
    - ponteiros ativos;
    - activation records append-only;
    - snapshots efetivos materializados.
17. F14 consome exclusivamente snapshots `READY`.
18. F14 não recompõe perfis dinamicamente.
19. Existe uma baseline organizacional ativa por tenant.
20. Existe no máximo um overlay ativo por scope canónico.
21. Overlay referencia baseline exata.
22. Nova baseline não rebasa overlays.
23. Ativação de baseline é operação por coorte.
24. Uma coorte pode conter:
    - nova baseline;
    - zero ou mais overlays previamente revistos e publicados contra essa baseline.
25. Todos os snapshots da coorte são materializados e validados antes do cutover.
26. O cutover troca atomicamente:
    - ponteiro da baseline;
    - ponteiros dos overlays incluídos;
    - desativação dos overlays não incluídos.
27. Overlay ligado à baseline anterior não permanece ativo depois do cutover.
28. Overlay não incluído é desativado, não apagado.
29. Snapshot anterior permanece histórico e imutável.
30. Na ausência de overlay ativo, o scope usa a baseline organizacional ativa.
31. Exclusões novas da baseline não podem ser contornadas por overlay antigo.
32. Cutover falha integralmente se qualquer membro da coorte estiver inválido.
33. Materialização v1 é síncrona.
34. F9 não é usado apenas para introduzir assincronia desnecessária.
35. Se a materialização ultrapassar limites futuros, uma decisão própria definirá jobs e estados intermédios.
36. Snapshot deve estar `READY` antes do pointer swap.
37. Snapshot preserva:
    - profile/base/overlay versions;
    - schema version;
    - taxonomy/catalog versions;
    - completion policy version;
    - semantic digest;
    - projection policy/digest quando aplicável.
38. Ativação valida novamente:
    - digest aprovado;
    - schema;
    - completude;
    - references;
    - F5;
    - assurance;
    - stale approval.
39. TOCTOU entre aprovação e ativação falha fechado.
40. Duas ativações concorrentes usam CAS/lock e somente uma vence.
41. Activation record é append-only.
42. Estados de activation record:
    - `ACTIVATED`;
    - `REPLACED`;
    - `ROLLED_BACK`;
    - `DEACTIVATED`.
43. Rollback é nova ativação auditada.
44. Rollback não reabre nem altera registos históricos.
45. Uma versão antiga só pode ser reativada se continuar compatível com schema/policy atuais.
46. Reutilização de snapshot `READY` só é permitida quando versões, policy e digests coincidem exatamente.
47. Caso contrário, materializa novo snapshot.
48. Não existe delete físico.
49. Archive remove elegibilidade operacional, preservando histórico.
50. Autor não aprova a própria revisão.
51. Ações sensíveis usam F5, F7 e assurance aprovados.
52. Eventos críticos de aprovação, publicação, ativação, desativação, rollback e archive pertencem à transação source-local.
53. Sem versão ativa inicial, ativação cria o primeiro ponteiro atomicamente.
54. Não se permite gap durante substituição de baseline.
55. Erro no cutover preserva todos os ponteiros anteriores.

## Invariantes

- Revision editorial, profile version, schema/policy version, snapshot e activation record têm identidades distintas.
- Versões aprovadas/publicadas e snapshots são imutáveis; ponteiros são mutados apenas por CAS e cutover transacional.
- Uma coorte fixa baseline e todos os overlays incluídos; nenhum membro pode vir de outra baseline ou tenant.
- O ponteiro antigo permanece válido até todos os novos snapshots estarem `READY` e a transação efetuar o cutover.
- Idempotency key reutilizada com intenção divergente falha fechado; commit incerto reconcilia pelo registo persistido.
- Archive, supersession, desativação e rollback nunca eliminam versões, snapshots, activation records, provenance ou F7.

## Segurança, autorização e auditoria

- Aprovação exige maker-checker e liga approver, membership/revocation version, assurance, revision e digest exatos.
- Publicação, ativação por coorte, desativação, rollback e archive usam operações/grants F5 próprios e reautorização no instante do efeito.
- Aprovação stale, mudança de grant/membership/assurance, incompatibilidade ou referência cross-scope/tenant recusam o comando.
- Eventos F7 críticos são aceites na mesma transação source-local antes do efeito se tornar observável.
- F10 usa códigos/labels fechados e não expõe tenant, scope, versões, digests ou atores.

## Impacto nos critérios F13

- **F13-AC-04, AC-06 e AC-09:** drafts revisionados originam versões e snapshots imutáveis, preservando história.
- **F13-AC-07 e AC-08:** coortes, snapshots `READY` e pointer swap atómico controlam ativação e unicidade por scope.
- **F13-AC-10 e AC-11:** CAS, locks, idempotency/intent digests e activation records resolvem concorrência e retry.
- **F13-AC-12, AC-21 e AC-22:** autoria, maker-checker, F5, assurance e F7 ficam vinculados ao lifecycle.
- **F13-AC-23:** a v1 não introduz F9 no caminho crítico sem necessidade.
- **F13-AC-24 e AC-25:** observabilidade sanitizada, resource loading, IDOR/RLS e scope fazem parte do cutover.
- **F13-AC-29 e AC-32:** falha reverte a coorte integralmente e a F14 consome apenas snapshots reproduzíveis `READY`.

## Decisões ainda pendentes

- grants F5 concretos;
- SoD por ação;
- MFA/assurance;
- eventos F7 exatos;
- limites de materialização síncrona;
- archive/retention;
- compatibilidade futura de schema/policy;
- UX e operação de coortes.

## Consequências

- A ativação de baseline torna-se uma operação explícita de coorte e pode desativar overlays omitidos, evitando que exclusões novas sejam contornadas.
- O custo transacional é maior que uma troca simples de ponteiro, mas elimina gaps e composições parciais.
- Scheduling e materialização assíncrona precisam de nova decisão se surgirem requisitos/custos reais.
- Rollback restaura operacionalmente uma composição por nova ativação, mantendo toda a cadeia histórica.

## Fontes

- `context/project-overview.md`
- `context/architecture.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-knowledge-state-policy.md`
- `context/history/f4-tenant-central-directory.md`
- `context/history/f4-tenant-contract-lifecycle.md`
- `context/history/f4-tenant-runtime-access.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f9-async-execution-foundation.md`
- `context/history/f12-opportunity-catalog.md`
- `context/research/f13-versioning-and-activation.md`

## Registo da aprovação humana

A aprovação humana confirmou revisions imutáveis, versões criadas na aprovação, publicação distinta, ativação manual por coorte, desativação atómica de overlays antigos, snapshots síncronos `READY`, rollback como nova ativação e ausência de delete físico. Esta decisão não fecha grants, SoD, assurance, eventos, limites, retenção ou UX e não autoriza implementação enquanto a F13 permanecer em `Draft`.
