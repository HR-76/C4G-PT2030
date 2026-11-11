# Parceiros — protótipo isolado do portal SQL

Data: 27/10/2026. Estado: **Review; protótipo implementado, não integrado**. [Contrato deste incremento](../../features/partner-portal-prototype.md), [contrato de compatibilidade](../../features/partner-sql-pagination.md) e [desenho](../../research/partner-sql-adapter-design.md).

## Resultado e fronteiras

`backend/prototypes/partnerSqlPortal.js` implementa o candidato com DECLARE `NO SCROLL WITHOUT HOLD`, FETCH de 100, sentinela de um após 10000 e CLOSE antes de devolver resultado. Recebe client preparado e ports de autoridade existentes; não cria conexão, transação, role ou contexto organizacional. Nenhuma composição, rota, arranque ou dependência importa o protótipo.

Mantém projeção, pesquisa portuguesa, ordenação/desempate, países globais, digest canónico incremental e cursores v1. A duplicação provisória das funções privadas do leitor atual evita uma refatoração de runtime neste incremento; os testes comparam comportamentos e o vetor golden independente. Antes de integrar, rever essa duplicação numa alteração pequena e protegida pelos mesmos testes.

O executor não expõe `isUsable`/estado transacional. Por isso, após erro de query ou autoridade, o candidato deixa rollback/descarte ao owner exterior, sem outro comando especulativo. Após erro local tenta CLOSE pelo mesmo client preparado, preservando o erro primário. CLOSE falhado no sucesso recusa o resultado; sem retries, fallback ou bypass da lease. Falhas SQL próprias são sanitizadas; erros de runtime reconhecidos preservam identidade.

**Não é paginação SQL integral.** O scan, autorizações, projeções em memória e digest do conjunto filtrado permanecem globais. O protótipo não resolve o problema de capacidade nem foi ligado ao caminho público.

## Testes primeiro e validação

RED antes de criar o módulo: os dois ficheiros novos falharam a carregar com `MODULE_NOT_FOUND`, exit 1. Não foram 49 falhas de asserção: o módulo ainda não existia. Implementado o protótipo, passaram os primeiros 47 testes; a revisão reforçou dois casos de conteúdo capturado entre leituras, totalizando **49 novos testes**.

- 24 testes de equivalência: os mesmos 16 cenários independentes, três pares NFC com comparação zero/IDs inversos, países distintos empatados, duas precedências de erros, cursores nos dois sentidos e material canónico superior a 256 KiB.
- 25 testes de protocolo: lotes/sentinela, guard/schema, limites, falhas por fase, DECLARE ambíguo, CLOSE aguardado, erro primário, lease/autoridade, consultas intercaladas, nomes/parametrização e alterações simuladas depois de DECLARE e entre FETCHs.
- Os contraexemplos também passam no leitor anterior; os oracles e os testes antigos não foram alterados.
- Revisão independente concluída sem findings pendentes no âmbito deste protótipo.

| Verificação | Baseline anterior | Resultado deste incremento |
| --- | --- | --- |
| Foco parceiros | 31 PASS | **80 PASS / 0 FAIL** |
| Backend `npm test` | 1369 PASS / 0 FAIL / 7 SKIP | **1418 PASS / 0 FAIL / 7 SKIP**, total 1425 |
| Frontend `npm test` | 346 PASS, 55 ficheiros | **346 PASS**, 55 ficheiros |
| Frontend `npm run build` | PASS | **PASS** |
| `node --check` | — | **PASS**, quatro ficheiros novos |

A primeira tentativa da suite backend no sandbox terminou com `spawn EPERM`, antes de conseguir lançar os testes isolados. O mesmo `npm test` foi depois executado com a permissão de subprocessos e passou. Esta é uma limitação de execução do sandbox, não uma falha do produto. Os sete skips de integração PostgreSQL preexistentes mantêm-se. As mensagens de navegação não implementada do jsdom e `Synthetic chunk failure` também constavam no log frontend anterior; a suite passou sem ocultar essas mensagens.

Comandos: `npm test` em `backend/` e `frontend/`, `npm run build` em `frontend/`; foco abaixo em `backend/`. Não existe script de build backend: foi verificada a sintaxe dos quatro JavaScript novos.

```powershell
node --experimental-test-isolation=none --test test/applicationPartners.test.js test/partnerBrowseBoundary.test.js test/partnerPaginationContract.test.js test/partnerPaginationHttpContract.test.js test/partnerPortalProtocol.test.js test/partnerPortalEquivalence.test.js
```

Logs em `%TEMP%`: `c4g-partner-portal-prototype-red.log`, `-green.log`, `-focused.log`, `-backend.log` (EPERM), `-backend-full.log`, `-frontend.log` e `-build.log`. Resumo verificável em [verification.json](verification.json).

## Medições antes/depois

Mesmas fixtures sintéticas, clock/chave fixos, resultado completo ou erro igual. Contagens observadas com doubles; não representam tempos, bytes de rede, planos ou capacidade PostgreSQL. [Dados completos](measurements.json).

| Candidatos | Comandos atuais → candidato | Chamadas de autorização em ambos | Resultado |
| --- | --- | --- | --- |
| 0 | 2 → 4 | 0 | Igual |
| 25 | 2 → 4 | 50 | Igual |
| 26 | 2 → 4 | 52 | Igual |
| 100 | 3 → 5 | 200 | Igual |
| 101 | 3 → 5 | 202 | Igual |
| 10000 | 102 → 104 | 20000 | Igual |
| 10001 | 102 → 104 | 20000 | `LIMIT_EXCEEDED` em ambos |

Os comandos incluem schema/scan/portal; excluem o protocolo exterior e SQL de autoridade/auditoria. A resposta da primeira página com 10000 candidatos tem 11152 bytes JSON nos dois leitores. A transferência dos bodies e a retenção em memória não foram reduzidas nem medidas em PostgreSQL.

## Ficheiros e preservação

- `backend/prototypes/partnerSqlPortal.js`.
- `backend/test/partnerPortalProtocol.test.js`.
- `backend/test/partnerPortalEquivalence.test.js`.
- `backend/test/support/partnerBrowsePortalHarness.js`.
- `context/features/partner-portal-prototype.md`.
- `context/features/partner-sql-pagination.md`.
- `context/research/partner-sql-adapter-design.md`.
- `context/current-work.md`.
- Este relatório, `measurements.json` e `verification.json`.

Baseline anterior às edições: branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, **2560 entradas no worktree / 30934 ficheiros**. Conferência por metadados e oito hashes de fontes; sem alterações inesperadas. Build/cache frontend são artefactos de validação esperados. Branch, HEAD, runtime ativo e trabalho não relacionado preservados.

**Migrations, grants/permissões, dados/configuração Dev e dependências não foram alterados.** Sem acesso a bases, SQL real, infra nova, commit, merge, push ou deploy. O inventário local não constitui snapshot de bases externas.

## Riscos pendentes

Doubles não provam snapshots, execução dos joins, RLS, READ COMMITTED efetivo, cancelamento, rollback físico, ligação reutilizada entre organizações ou capacidade. O harness representa explicitamente o rollback exterior, sem o atribuir ao candidato. Continua necessário o gate PostgreSQL descartável, incluindo revogação e cache de autoridade, writers concorrentes e medição de memória/bytes/latência. Não ativar o protótipo antes dessas provas.

**Próximo passo:** preparar o gate PostgreSQL isolado para validar snapshot, RLS, revogação, cleanup e capacidade antes de integrar; executar infraestrutura apenas no âmbito isolado autorizado.
