# Diagnóstico temporal do gate de parceiros

**Review — 28/10/2026.** Preparação offline concluída; nenhuma execução PostgreSQL/Docker. [Contrato](../../features/partner-postgres-gate.md), [runbook](../../../test/integration/partner-portal/README.md), [verificação](verification.json), [microbenchmark](microbenchmark.json).

## Alteração e contratos preservados

O collector passa a guardar diagnóstico temporal nas 18 operações dos três cenários que falharam: volume-10000, volume-10001 e profile-distinct-origins. Mantêm-se 13 cenários, 52 medições, 26 aquecimentos, pares AB/BA, fixtures, limites de 10 s/5 s/1 MiB, sentinela 10001, ordenação, filtros, cursor/digest e autoridade server-side. Não foi corrigido nem ocultado o LEASE_TIMEOUT observado na quarta tentativa.

- `temporalDiagnostic.js`: relógio monotónico, contexto AsyncLocalStorage por amostra, 16 agregados fixos e máximo de 1024 spans pendentes. Não guarda SQL, parâmetros, identificadores, credenciais ou texto de erros.
- `environment.js`: observação privada das fases resolve/lease/protect/reader e das dependências membership/dados/política/auditoria de autorização; queries físicas Central/tenant, sem consultas adicionais.
- `capacityProbe.js`: snapshots no settlement e após cleanup, incluindo erros e trabalho pendente; diagnóstico inválido/incompleto entra nos erros do observador e impede PASS.

O coordenador e os ports de autoridade continuam a ser os objetos originais, com as identidades privadas verificadas pelas implementações reais. O observador envolve dependências, não substitui essas identidades nem enfraquece os validadores. As duas composições instrumentadas foram construídas offline com factories reais; um coordenador copiado continua recusado.

Miss exige chamada à revalidação de membership do autorizador. Hit exige o percurso de binding/guard da cache e retorno normal sem essa chamada. Recusa antecipada sem esse percurso ou falha do guard fica como UNRESOLVED. Não há segunda cache; o guard original continua obrigatório. O teste da composição real confirma cache por pedido, recusa e nova decisão no pedido seguinte, usando infraestrutura controlada.

## Interpretação e limites

Os tempos são inclusivos e sobrepostos: não somar como decomposição exclusiva. OPERATION mede entrada até settlement; a métrica anterior BEGIN→settlement mantém-se. LEASE inclui preflight, execução e finalização; PROTECT inclui o port e a drenagem de auditoria. AUTHORIZATION_MEMBERSHIP mede apenas essa dependência; o port inclusivo mede o percurso total por autorização. A duração de hit inclui o guard. Queries Central incluem o protocolo transacional, mas não a espera de aquisição anterior; queries tenant excluem hooks exteriores.

Cada snapshot distingue started/completed/failed/inflight, totalMs/maxMs e pendingMs. Um span pendente ainda não tem duração final; a conclusão tardia pertence à amostra original e não contamina a seguinte. VALID indica recolha válida, não sucesso da operação. Sobrecarga do limite de spans ou relógio inválido invalida a observação, preservando o resultado/erro original.

A fase mais cara nos três cenários reais permanece desconhecida. Falta medir o overhead no percurso PostgreSQL completo e considerar o host partilhado. Não existe nova prova RLS, revogação, snapshot ou capacidade neste incremento; as provas anteriores conservam os seus resultados e limitações.

## Regressões e validação

**14 testes novos.** As regressões iniciais precederam a implementação: módulo temporal começou RED por ausência; ligação ao collector começou com dois RED por diagnóstico ausente; factories observadas começaram RED por função ausente. A revisão acrescentou controlos de integração, concorrência e identidade privada, incluindo regressão da marca do autorizador antes da solução final.

Cobertura: os três timeouts mantêm a recusa; cache negativa e guard; composição real com cache por pedido; identidade privada; isolamento assíncrono e atividade tardia; relógio inválido; ausência de coleta fora do contexto; queries Promise/callback/erro síncrono; interfaces frozen; 18 diagnósticos e preservação dos pares/aquecimentos. São provas offline, sem simular que PostgreSQL foi executado.

| Verificação | Resultado |
| --- | --- |
| Foco `node --test backend/test/partner*.test.js` | 207 PASS / 0 FAIL / 0 SKIP |
| Backend `npm test` | 1547 PASS / 0 FAIL / 7 SKIP; total 1554 |
| Frontend `npm test` | 346 PASS, 55 ficheiros |
| Frontend `npm run build` | PASS |
| `node --check` | PASS nos cinco ficheiros JavaScript alterados/adicionados |
| Manifest | 1014 fontes, apenas os três módulos do harness revistos |

Os sete SKIP PostgreSQL e avisos jsdom de navegação/chunk sintético são preexistentes. Não houve novas falhas nas suites finais. Sem lint/type checking geral configurado. Revisão local concluída, sem subagentes.

## Medição offline do observador

Quatro pares alternados, dois aquecimentos separados, 20000 callbacks sintéticos por amostra. Mesmos wrappers sem contexto de coleta: média **1,507 ms**; coleta ativa: **13,378 ms**. Acréscimo médio **11,871 ms**, ou **0,594 µs por chamada**. Resultados e contagens iguais, zero SQL. Todas as amostras constam do microbenchmark.

Este ensaio mede apenas o custo do collector no percurso sintético de hit, sem executar o guard real, SQL ou a aplicação. É sensível a JIT/host e não pode ser extrapolado para a latência PostgreSQL, capacidade produtiva ou melhoria do adaptador.

## Ficheiros e preservação

- Harness: `test/integration/partner-portal/temporalDiagnostic.js` (novo), `environment.js`, `capacityProbe.js`, `sources.json` e `README.md`.
- Testes: `backend/test/partnerTemporalDiagnostic.test.js` (novo) e `partnerPortalCapacityProbe.test.js`.
- Contexto: `context/features/partner-postgres-gate.md`, `context/current-work.md` e este diretório de evidência (README, verification e microbenchmark).

Branch feat/f13-organizational-profile; HEAD 0cf519ea22de929d2e52d0b3edb4d72364aa6220; baseline 2620 entradas no worktree e 30994 ficheiros. O manifest atual foi atualizado conscientemente apenas para environment, capacityProbe e o novo módulo. Os manifests/evidências das quatro tentativas mantêm os seus hashes; nenhuma evidência antiga foi reavaliada com fontes novas para reescrever o resultado.

**Runtime, protótipo, migrations, grants/permissões e dados Dev preservados.** Sem SQL externo, contentores, commit, merge, push, deploy ou integração. Build/cache frontend regenerados pela validação; restantes alterações conferidas contra a baseline.

**Próximo passo:** executar nova tentativa isolada com este diagnóstico, preservando as quatro falhas anteriores e os limites atuais, para localizar o custo antes de propor uma correção.
