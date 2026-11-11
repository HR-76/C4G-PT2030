# F13→F14 — capacidade, histórico e reinício F12

**Complete — fecho humano restrito aprovado em 2026-10-17.** Percurso restrito concluído e demonstrado; F13/F14 integrais não são declarados Complete. Pedido de 2026-10-17. Âmbito: ativar → avaliar → explicar → decidir → consultar histórico. D1–D7/A1, material de 256 KiB, envelope de 1 MiB e deadline efetivo mais restritivo preservados. Sem novos domínios, score, candidaturas ou migrations.

## Causas e correções

- A autoria tratava todas as revisões como um único material canónico. Agora verifica a sequência inteira por lotes de 25, preservando continuidade, digests, autores e segregação. Consultas exatas carregam só a revisão solicitada. A identidade final mantém o limite; não corta nem elimina histórico.
- Um snapshot de exatamente 262144 bytes ativava, mas a consulta falhava ao acrescentar metadados. Apenas a projeção de leitura usa o envelope de 1048576 bytes já aprovado. Clones, snapshots e resultados automáticos mantêm 262144 bytes. Auditoria preserva SHA256 dos mesmos bytes canónicos. Excesso de bytes/cardinalidade recebe recusa controlada; nenhum prazo foi prolongado.
- Ativações usam geração descendente e cursor exclusivo vinculado ao ator/organização/operação. Inserções novas não deslocam páginas antigas; decisões já usavam esse modelo.
- F12 deixa de limpar catálogo por TRUNCATE CASCADE. Usa cluster descartável e repete o restart duas vezes com registos preservados. Asserções de upgrade incluem Central 013/014; contagens de documentos restringem-se à fixture própria. O harness temático usa downgrades adjacentes de tabelas posteriores vazias, preservando o histórico 016 ocupado. Não foram alteradas proteções produtivas.

## Provas

| Prova | Resultado e evidência |
| --- | --- |
| Reprodução | `capacity-before.txt`: 100 ligações/verificações construídas; submissão falha com TypeError/503. Teste focado reproduz o teto indevido do histórico agregado. |
| Variante documental | `capacity-after.txt` PASS: 2 items, 100 competências, 1 experiência e 100 ligações/verificações; snapshot 166710 bytes; ativação 1781 ms, avaliação 1697 ms, leitura 1776 ms. |
| Coleções conjuntas | `capacity-full-final.txt` PASS: excesso 100/100/100/100/100 recusado sem publicação. Edição explícita da fixture preserva as revisões anteriores e seleciona 2 items; 100 experiências, competências, ligações e verificações. Autoria: **205 revisões, 11722539 bytes, 9 lotes**, revisão 1 consultável. Snapshot **242841 bytes**, ativação **1840 ms**, avaliação **1809 ms**, leitura **1833 ms**, decisão e histórico PASS. |
| Fronteira exata | `bytes-browser-final.txt`: PostgreSQL comprova snapshot de exatamente 262144 bytes, ativação, avaliação, explicação, decisão, histórico e A/B. Mais um byte recebe HTTP 409/LIMIT_EXCEEDED sem snapshot/ativação adicionais; publicação continua consultável. Metadados sintéticos calibrados, não benchmark de dados reais. |
| Paginação | `history.txt` PASS: 53 decisões em 3 páginas com inserção entre páginas, sem omissões/duplicações. Ativações paginadas com inserção concorrente; snapshot antigo consultável, avaliação antiga REVIEW_REQUIRED; isolamento A/B e cursores vinculados. |
| Browser | `bytes-browser-final.txt` PASS: snapshot no limite, ativar → avaliar → explicar → três tipos de decisão; **30 decisões em 2 páginas**, ordem igual ao PostgreSQL, sem omissões/duplicações; A→B→A; perda de resposta de ativação/decisão → reload/lookup sem duplicar. 503 concorrente real da mesma sessão → intenção original UNKNOWN, sem avaliação persistida e dependências bloqueadas. `browser-limit-final.txt` PASS: excesso recusado também na UI (409). `result-mobile.png` inspecionado, sem overflow horizontal. |
| F12/F9 | `f12-final-pass.txt` PASS: dois restarts consecutivos, runner/preflight, isolamento, jobs/replay/retry, F7 atómico e F11/documentos. |
| Temático | `editorial-final.txt` PASS: publicação imutável/inativa, segregação, CAS/F7/recuperação, fronteiras temporais e HTTP A/B. |
| Suites | `backend-final.txt`: **851/851 PASS**. `frontend-tests.txt`: **75/75 PASS**. Build PASS com aviso de bundle. Sintaxe dos 26 ficheiros JS do recorte PASS; testes unitários não substituem PostgreSQL/browser. |

Medições locais, sem SLO. Revogações, F11, corridas de entradas e deadlines SATISFIED reutilizam a [matriz histórica](../f13-pq1-consolidated/README.md): algoritmos não alterados. Reutilização não significa reexecução. O mapeamento de excesso de cardinalidade para LIMIT_EXCEEDED tem regressão unitária específica, sem alterar casos admissíveis exercitados em processos já iniciados.

## Lista única de pendências

**Blockers do percurso:** nenhum identificado. C-PQ1-01 e a fixture F12-E2-R2-001 resolvidos. Revisão técnica favorável; aprovação humana explícita recebida em 2026-10-17, exclusivamente para este percurso.

**Melhorias adiáveis:** carregamento de páginas a pedido concluído após o fecho restrito (frontend 80/80, build sem aviso de bundle e Chrome de navegação/guarda PASS); auditoria WCAG integral, limpeza de estado sem leitura e desempenho transversal continuam pendentes. Staging, IdP/armazenamento externos, dados reais e SLO fora desta prova. UNKNOWN pode persistir com intenção original, bloqueio limitado e suporte; não há promessa de resolução automática.

## Experimentar localmente

Docker ativo, Node/dependências instaladas e Chrome em `C:/Program Files/Google/Chrome/Application/chrome.exe`. Na raiz:

```powershell
Remove-Item Env:PQ1_BROWSER_BOUNDARY_ONLY -ErrorAction SilentlyContinue
$env:PQ1_PHASE='bytes-browser'
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/pq1-consolidated-gate.ps1 -Port 5591
```

Demonstração automatizada temporária em localhost:5173, encerrada no fim. `PQ1_PHASE=history` testa paginação. `PQ1_PHASE=capacity` e `PQ1_CAPACITY_EXTENDED=1` testam coleções conjuntas. `PQ1_BROWSER_BOUNDARY_ONLY=1` limita o browser à recusa de excesso em localhost:5174. Para F12: `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f12/migration-gate.ps1`. Os harnesses criam/removem apenas os próprios clusters descartáveis; não deixam instalação manual autenticada nem exigem terminar serviços preexistentes.

Sem stage, commit, push ou deploy. HEAD/índice, residual e evidência histórica preservados. Recorte: `tested-scope.json`.

## Correspondência e limites da evidência

As tentativas falhadas foram mantidas como diagnóstico, não contadas como PASS: `capacity-full.txt` omitia cursor nulo na última consulta da fixture; `bytes-browser.txt` expôs o erro real de envelope; `browser-limit.txt` tinha seletores com codificação incorreta, corrigidos e repetidos. O gate temático Node completou todas as assertions e emitiu PASS em `editorial-final.txt`; a captura PowerShell externa marcou saída 1 por stderr de recusas esperadas. O invólucro foi alinhado com o gate PQ1; `powershell-exit-check.txt` comprova preservação de stderr e dos códigos 0/7. Reutiliza-se a prova PostgreSQL temática concluída, sem repetir o domínio por alteração apenas de captura de saída.

O browser integral exercitou localhost:5173; o suplemento de recusa exercitou localhost:5174. A separação de porta é apenas de harness. O último delta produtivo de cardinalidade muda a recusa de coleção >100 para LIMIT_EXCEEDED, com teste dedicado e suite final 851/851; não altera os casos admissíveis já executados. Os limites de material, grants, isolamento, idempotência, F7, locks, freshness e deadlines não foram reduzidos para obter PASS.

Containers/serviços de prova encerrados; PostgreSQL de desenvolvimento e Collabora preexistentes preservados. HEAD mantém `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; índice sem alterações staged, como no início. Não há revisão de produção, IdP externo, dados reais ou garantia de resolução automática de UNKNOWN. Fecho humano restrito registado em 2026-10-17. F13/F14 integrais permanecem fora deste fecho.
