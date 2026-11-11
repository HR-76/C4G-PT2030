# Correções da auditoria de qualidade — incremento 2

Estado: Review — 27/10/2026. [Contrato e critérios](../../features/code-quality-audit-increment-2.md).

Reduzido o conteúdo carregado nos alertas, corrigido o cancelamento ClamAV e preservado o timeout R2 quando existe sinal externo. Reconciliadas as duas fixtures desatualizadas. As três falhas anteriores do backend estão resolvidas; a auditoria global permanece aberta.

Branch inicial/final `feat/f13-organizational-profile`; HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`. Worktree inicial com 2540 entradas; inventário de metadados de 30915 ficheiros em `%TEMP%/c4g-audit-increment2-baseline.json`. O primeiro incremento e as restantes alterações anteriores foram preservados.

## Problemas e correções

| Prioridade | Localização atual | Evidência, causa e impacto | Correção e regressão |
| --- | --- | --- | --- |
| P2 | `backend/src/applications/alerts.js:45`, `:67` | `visible` carregava títulos/mensagens de todos os candidatos antes do limite do GET, inclusive no PATCH. Conteúdo volumoso materializado sem necessidade. | Projeção de metadados; conteúdo apenas dos IDs da página, em até duas consultas parametrizadas por organização e membership. PATCH sem leitura de conteúdo. Dez testes cobrem seleção, contagens, recusas, limites, snapshot, colisões e falhas de hidratação. |
| P2 | `backend/src/documents/clamavScanner.js:12`, `:54`, `:105` | HEAD/readRange pendentes não terminavam por cancelamento; abort de socket antes de connect ou após upload podia esperar pelo timeout inteiro. Destruir a fonte não garantia o seu fecho antes do retorno. | Espera cancelável, observação de rejeição tardia, descarte de fonte tardia, proteção após awaits e cleanup limitado ao deadline existente. Oito testes por fase; nenhum resultado CLEAN após abort observado. |
| P2 | `backend/src/documents/r2Storage.js:38` | A revisão encontrou `signal || AbortSignal.timeout(30000)`: passar o novo sinal ao HEAD eliminava o timeout de 30 s. | Sinal composto conserva deadline e cancelamento. Seis testes de HEAD/readRange com SDK simulado: expiração com caller ativo, cancelamento antecipado e default sem caller; erro público sanitizado. |
| P3 | `backend/test/f12Composition.test.js:20` | Fixture não tinha `abortMultipartSession`, exigido pelo contrato fechado atual. Produzia uma das falhas anteriores. | Double F11 completo e rejeição de ports incompletos/abertos; dois testes novos de recusas de autorização e documentos de outra organização/indisponíveis. Runtime de autorização intacto. |
| P3 | `backend/test/f5AuthorityCommitGuard.test.js:18` | Mapeamento antigo não associava queries às extensões 030/031 já existentes. Produzia outra falha anterior. | Mapeamento explícito por função/migration, contagens e pares exatos hash/SQL; um teste novo recusa SQL desconhecido/alterado antes de Central. Sem alterar catálogo, funções SQL ou checksums. |

Não se alteraram contratos HTTP, cliente frontend, políticas de acesso ou limites de 10000/10001 candidatos. A comparação de catálogo cobre 209 queries únicas, incluindo a observação partilhada entre executor base e billing. Não procura permissivamente um hash em qualquer migration.

Nos alertas, ordem de autorização e auditoria, contagens globais, filtro de prazos, reconhecimento monotónico e replay permanecem iguais. Hidratação distingue as duas origens mesmo com IDs coincidentes; linhas ausentes, duplicadas, inesperadas ou malformadas falham com `SERVICE_UNAVAILABLE`, sem resultado parcial. Só `title`/`message` são fundidos: `read_at`, título da candidatura, tipo e datas mantêm os valores selecionados inicialmente sob READ COMMITTED. A imutabilidade do conteúdo é suportada pelos contratos existentes de 029/030, apenas lidos.

A composição de sinais R2 aplica os 30 segundos por chamada SDK também a operações que já forneciam sinal externo. Esta correção de deadline foi documentada no critério 11 antes de implementar; não altera retries, configuração, credenciais, limites de bytes ou classificação pública dos erros.

## Testes e validação

**27 testes novos**, todos backend: 10 alertas, 8 ClamAV, 6 R2, 2 F12 e 1 F5. O teste antigo de cancelamento passou a esperar confirmação de fonte ativa em vez de supor que 10 ms bastariam; mantém a asserção de fecho.

- Alertas: antes do runtime, 1 PASS/9 FAIL; depois 13/13 com os três testes existentes.
- ClamAV: primeiro recorte RED 20 PASS/4 FAIL; depois 26/26, incluindo duas provas adicionais de rejeição tardia e fonte não cooperante.
- R2: 2 PASS/4 FAIL antes; depois recorte combinado R2/ClamAV/F11 32/32.
- Fixtures: baseline 14 PASS/2 FAIL; depois 19/19 com três novas regressões. Recorte conjunto alertas/fixtures 32/32.

| Verificação | Antes deste incremento | Resultado final |
| --- | --- | --- |
| Backend `npm test` | 1314 PASS / 3 FAIL / 7 SKIP, evidência final do incremento 1 | **1344 PASS / 0 FAIL / 7 SKIP**; total 1351 |
| Frontend `npm test` | 346 PASS | **346 PASS**, 55 ficheiros |
| Frontend `npm run build` | PASS no incremento 1 | **PASS** |
| Backend `node --check` | — | **PASS**, 10 ficheiros de código/testes |
| Whitespace Git dos ficheiros do incremento | — | PASS; aviso de normalização LF/CRLF num teste existente |

As três falhas anteriores — ClamAV, fixture F12 e mapeamento F5 — foram reproduzidas antes das respetivas correções e deixaram de ocorrer. Nenhuma falha nova permanece. Uma primeira suite completa passou 1338 testes antes do ajuste R2; repetiu-se a suite após esse ajuste, obtendo o resultado final acima. Os sete skips continuam explícitos: nenhum gate PostgreSQL/Keycloak ou serviço real foi ativado para os contornar.

Revisão independente de alertas não identificou regressões. A revisão ClamAV encontrou a interação com o deadline R2, corrigida e novamente revista. Provas com doubles e TCP efémero local não equivalem a teste com ClamAV real, R2 ou transações PostgreSQL reais.

Evidência local: `%TEMP%/c4g-increment2-{backend,frontend}-after.log`, `%TEMP%/c4g-increment2-build-after.log`, `%TEMP%/c4g-alert-payload-red.log`, `%TEMP%/c4g-clamav-cancellation-{red,green}.log`, `%TEMP%/c4g-r2-cancellation-deadline-{red,green}.log` e `%TEMP%/c4g-increment2-fixtures-focused-green.log`. Resumo preservado em [verification.json](verification.json).

## Medição antes/depois

Mesma fixture: 1000 alertas com mensagens de 2000 caracteres e 1000 comunicações com 5000 caracteres. Fonte anterior carregada separadamente do módulo atual; comparação exata de resposta e trace completo de autorização/update/auditoria em cada operação. [Resultados](alert-payload-measurement.json).

| Operação | Bytes JSON antes → depois | Conteúdos lidos antes → depois | Consultas do repositório antes → depois |
| --- | --- | --- | --- |
| GET limite 1 | 7 807 713 → 559 070 (−92,84%) | 2000 → 1 | 4 → 5 |
| GET limite 100 | 7 807 713 → 915 281 (−88,28%) | 2000 → 100 | 4 → 6 |
| PATCH individual | 7 807 713 → 553 927 (−92,91%) | 2000 → 0 | 5 → 5 |
| PATCH todos | 7 807 713 → 553 927 (−92,91%) | 2000 → 0 | 2004 → 2004 |

São bytes da serialização JSON das linhas retornadas pelo **double**, não tráfego PostgreSQL, memória medida ou latência produtiva. O GET acrescenta uma ou duas consultas em troca da redução de conteúdo. As 2000 chamadas de autorização permanecem; auditorias 0/0/1/2000 nas quatro operações, respetivamente. Contagem do repositório não inclui SQL interno dos ports simulados.

Script e fonte anterior: `%TEMP%/c4g-alert-payload-measurement.cjs` e `%TEMP%/c4g-audit-increment2-sources/alerts-before.cjs`; executar o script com a raiz do repositório como diretório corrente. Os tempos dos testes ClamAV não são benchmark: os casos pré-connect/espera de resposta deixaram de esperar pelo timeout artificial de 1000 ms; fonte não cooperante continua limitada pelo restante deadline, comprovado com 100 ms configurados.

## Ficheiros alterados neste incremento

- Runtime: `backend/src/applications/alerts.js`, `backend/src/documents/clamavScanner.js`, `backend/src/documents/r2Storage.js`.
- Testes novos: `backend/test/alertReadPayload.test.js`, `backend/test/clamavCancellation.test.js`, `backend/test/r2CancellationDeadline.test.js`; suporte `backend/test/support/alertReadFixture.js`.
- Testes existentes: `backend/test/f11RealTransportAdapters.test.js`, `backend/test/f12Composition.test.js`, `backend/test/f5AuthorityCommitGuard.test.js`.
- Contexto: `context/current-work.md`, `context/features/code-quality-audit-increment-2.md`, este relatório, `verification.json` e `alert-payload-measurement.json`.
- Artefactos esperados: `frontend/dist/` regenerado e cache local do Vitest. Sem instalações ou alterações de lockfiles.

## Riscos e trabalho restante

- Alertas continuam a ler metadados O(N) e a autorizar cada recurso; paginação SQL integral não foi implementada. A medição não demonstra capacidade produtiva ou melhoria de latência.
- Parceiros também mantêm seleção/digest globais. Já existe reutilização de decisões por recurso dentro do pedido: não confundir número de chamadas de autorização com número de queries SQL. Paginação futura deve preservar collation, países disponíveis e validade do cursor.
- Provider/iterador não cooperante não pode ser fisicamente interrompido por uma promise. ClamAV limita a espera de cleanup ao deadline existente, até 120 segundos configurados; observa rejeições tardias e descarta fontes devolvidas depois. O timeout R2 pressupõe que o SDK respeita `AbortSignal` e não constitui um deadline global de scan. Sem prova com infraestrutura real.
- RFC 9457 global, capacidade/contrato de Matching, cancelamento físico de probes, prova WCAG com navegador/leitor de ecrã e gates de desempenho C6 anteriores continuam pendentes. Este incremento não altera nem aprova esses gates.

Nenhuma migration, grant/permissão, configuração ou dado Dev foi alterado. Sem acesso a bases Dev, pausa de serviços, deploy, commit, merge ou push. Conferência final por metadados e estado Git, sem snapshot de dados externos ou hash integral do repositório; detalhes em `verification.json`.

**Próximo passo:** preparar o contrato e os testes de equivalência para paginação SQL de parceiros, preservando ordenação, cursor, filtros e autorização.
