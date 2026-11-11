# F13→F14-PQ1 — revisão consolidada do marco

2026-10-17. Implementação do percurso **ativar → avaliar → consultar explicação → registar decisão → consultar histórico**. Não constitui fecho humano, F13/F14 integrais Complete, candidatura, comunicação ou score. D1–D7 e A1 mantidas. **Veredicto: BLOCKED por capacidade conjunta/histórico de autoria.** Esta é a matriz ativa única; os registos anteriores permanecem históricos.

## Delta implementado

Decisões locais REQUEST_INFORMATION, KEEP_UNDER_REVIEW e DISCARD_FROM_ANALYSIS, com motivo/justificação e avaliação exata. Solicitar informação seleciona critérios dessa avaliação e não envia mensagens. Escrita exige HUMAN, grant `prequalification.decide`, leitura autorizada das fontes e resultado CURRENT. Histórico usa `prequalification.read`; resultado automático não é alterado. CAS sobre decisão/generation, idempotência, F7 crítico, recibo e histórico append-only na mesma transação. HTTP POST/GET `/api/opportunities/prequalifications/:id/decisions`. UI exige confirmação explícita e invalida-a quando mudam os dados relevantes.

Tenant 020 e Central 014 são aditivas; migrations anteriores intactas. 020 contém apenas histórico/recibo de decisão e evento F7. 014 admite o lookup fechado PQ1_DECIDE. Listas de compatibilidade dos domínios existentes admitem explicitamente 020; sem wildcard nem redução de ACL. Digests permanecem no servidor.

Uma intenção de decisão guarda identificadores de sujeito/organização/avaliação/oportunidade/chave, nunca justificação, fontes ou tokens. Bloqueia a decisão dependente e a nova avaliação dessa oportunidade na UI; não todas as organizações/recursos. `sessionStorage` não assegura exclusão entre sessões. O servidor mantém CAS, locks e protocolo de autoridade existentes. 503 não prova rollback; UNKNOWN preserva a intenção e encaminha para suporte, sem garantia de resolução automática.

## Provas deste marco

- Backend: **844/844 PASS**; frontend **75/75 PASS**, build PASS. Frontend unitário usa API simulada, não prova PostgreSQL/browser. Bundle >500 kB é aviso não bloqueador.
- Tenant 020 e Central 014: PostgreSQL 17 descartável, up/down vazio, runner cumulativo, preflight, ACL/RLS e fingerprints PASS. Downgrade tenant com decisões recusa; runtime não altera histórico. Os logs ainda usam os rótulos 019/013 herdados do harness; os ficheiros SQL e fingerprints exercitados são 020/014, respetivamente.
- HTTP real: três decisões, A/B, replay, conflito de payload, CAS obsoleto e concorrente (dois atores; um vencedor), F7 tardio sem decisão parcial, lookup e histórico imutável. Sem alteração do digest do resultado automático.
- Consumidor real: F11 retirado ao ator recusa evaluate/read/decide sem efeitos; F11 QUARANTINED serializa com o leitor nos dois ordenamentos. Documento efetivamente referenciado pelo suporte usado. Metadados F11 são fixtures governadas AVAILABLE/CLEAN; não se exercita armazenamento/antivírus externo.
- Activate, evaluate e decide: revogação de grant, membership e sessão, **ambos os ordenamentos**, com barreiras no protocolo real; escritor WAITING/locks PostgreSQL observados. Operação ganha e conclui antes da revogação, ou revogação ganha e escrita recusa sem efeito parcial.
- Validade: commit em validUntil−1 ms passa; no instante exato e +1 ms recusa sem efeitos, para evaluate e decide. Clock injetado comum a runtime/autoridade e aplicação; não se alteram deadlines/proteções produtivos. SATISFIED histórico permanece histórico/UNAVAILABLE após expiração; avaliação nova dá UNKNOWN/CURRENT. Revogação factual usa o serviço real e lock F13-P1; decisão obsoleta recusa.
- Browser inicial: Chrome/Vite/composição de produção/Central+A/B reais; preview, MFA OIDC assinado sintético, confirmação invalidada, ativação com resposta perdida após commit → reload → lookup sem duplicar; avaliação, explicação INDETERMINATE, três decisões e histórico, recusa B, mobile sem overflow. **503 concorrente real na mesma sessão → lookup UNKNOWN** executado: chave original preservada, nenhuma avaliação persistida e novas gravações dependentes bloqueadas. Este 503 não é a falha de resposta injetada.

Findings resolvidos: (1) rotação A/B concorrente com leituras PQ1 podia terminar em perda da sessão; a seleção de organização usa agora a fila já existente, com regressão unitária e browser real. (2) F7 classificava o recurso como avaliação mas recebia o ID da decisão; corrigido para o ID da avaliação, comprovado pelo gate PostgreSQL final. (3) decisão sobre UNKNOWN/CURRENT citando verificação expirada recebia indevidamente o deadline dessa referência explicativa; deadline limitado ao suporte SATISFIED, com prova HTTP/PostgreSQL de decisão, histórico e lookup no instante exato da expiração (`unknown-current-decision.txt`). (4) o harness browser esperava texto que podia existir no textarea antes do commit; agora exige cada entrada no histórico e exatamente três registos PostgreSQL. Esta falha da prova não é apresentada como resultado válido.

Delta do snapshot carregado no browser: as correções finais do ID de recurso F7 e do deadline de decisão UNKNOWN foram aplicadas após iniciar esse processo; o percurso UI não foi declarado reexecutado por esse delta. O gate de decisão PostgreSQL e a suite backend foram reexecutados sobre o código final, incluindo asserção do recurso F7 exato; um gate PostgreSQL específico comprovou UNKNOWN/CURRENT → decisão → histórico → lookup. O deadline SATISFIED permanece igual ao já exercitado; as verificações citadas apenas como explicação de UNKNOWN deixam de impor um prazo indevido. Avaliação automática, freshness, autorização e recuperação não mudaram. `post-load-deltas.json` regista estes deltas e uma limpeza de whitespace no harness de capacidade.

O log consumer contém PASS individuais de todas as provas acima e termina em FAIL numa fase de capacidade então acoplada. Essa falha foi de harness (não aplicava a validação HTTP antes da composição interna), corrigida e separada. Não se declara esse processo globalmente PASS nem se reexecutam os consumidores já comprovados. Asserções intermédias e falhas de sincronização/seleção de texto do browser não são provas PASS.

## Matriz acumulada

E = executado neste marco; R = evidência anterior reutilizada; I = inspeção. Reutilização não significa reexecução.

| Critério | Prova e conclusão | Limite |
| --- | --- | --- |
| ACT-01 / PQ1-16 | E browser-final.txt: percurso completo, três decisões contadas no PostgreSQL, histórico e seletor A→B→A; E HTTP A/B | IdP sintético, local |
| ACT-02/03 / PQ1-02/15 | E publicação real → snapshot/ativação; R publisher fechado PUB-01–15 e imutabilidade 019; E admissão 020 | Publisher não foi reexecutado integralmente; composição usada cria/publica material real |
| ACT-04 / PQ1-03/05 | E suporte verificado SATISFIED, expiração exata/commit, nova avaliação UNKNOWN e revogação; R corpus determinístico de três avaliadores | Sem produtor de prova negativa; competência V1 não emite incumprimento |
| ACT-05/06 / PQ1-08 | E A/B decisões/histórico/lookup/resultados, F11 efetivo, grants distintos, browser MFA; R SoD/autor recusado e aprovação exata | Não valida IdP externo nem enumera toda combinação de grants por rota |
| ACT-07/09 / PQ1-10/11/12 | E CAS concorrente de decisões, F7 tardio/replay/lookup; R CAS concorrente de ativação e ACK SQL perdido de ativação/avaliação | Perda de ACK SQL específica de decisão não executada; protocolo/recibo novos exercitados por F7, replay e lookup |
| ACT-08 / PQ1-09 | E activate/evaluate/decide × sessão/membership/grant × dois ordenamentos; E documento nos dois ordenamentos e revogação factual sob lock real | Combinações adicionais critérios/ponteiro/referências distinguem-se abaixo; não inferir cobertura exaustiva |
| ACT-10 / PQ1-13 | E browser: concorrência real mesma sessão → 503 → reload → lookup UNKNOWN, intenção original e ausência de efeito | UNKNOWN pode persistir; suporte não promete resolução automática |
| ACT-11 | E motivo/justificação invalidam confirmação; R testes de seleção/foco/sessão e token obsoleto | Não constitui auditoria de acessibilidade integral |
| ACT-12 / PQ1-17 | E migrations 014/020, down vazio/ocupado, manifests/fingerprints e runtime limitado | Alterações maliciosas de cada ACL individual não enumeradas |
| ACT-13 / PQ1-01/06 | R identidades/tuple/freshness exatas; E leitura atual/histórica após expiração/revogação; R troca de geração e critérios fechados | E adicional: alteração real de critérios e ativação durante evaluate nos dois ordenamentos; entradas antigas recusadas sem efeitos, histórico REVIEW_REQUIRED e decisão obsoleta recusada |
| ACT-14 / PQ1-04/07 | E UI parcial/limitações; R corpus de afinidade/prioridade por identidade, sem equivalências; I ausência de score/candidatura | Temas não provam elegibilidade; constraints não avaliadas |
| ACT-15 / PQ1-15 | R publisher/temático fechados; E publicação PQ1 permanece inativa até ativação explícita; suite backend/frontend/build | Não repetir browser publisher integral por rotina |
| PQ1-14 | E três decisões HTTP/browser, avaliação exata, CAS, justificações, histórico e F7; I nenhuma chamada a transportes/jobs | Sem comunicação ou candidatura |
| Capacidade | E 100 items **totais** + 100 assertions, snapshot 117 144 bytes, ativação ~1,5 s; 101 items/assertions recusados sem efeitos. E boundary puro 262 144 bytes/+1 | 100 experiências/ligações/verificações criadas, mas conjunto completo recusado por canonicalização antes de publicação. **Blocker C-PQ1-01**: fronteira admissível do histórico não demonstrada; ver diagnóstico abaixo |

## Reutilização e correspondência

[HTTP/UI anterior](../f13-pq1-http/README.md), [transações](../f13-pq1-transactions/README.md), [núcleo](../f13-pq1-activation/README.md), [publisher fechado](../f13-pq1-publish/README.md) e [confirmação corrigida](../f13-pq1-confirmation/README.md). Comparação SHA256 em `reuse-comparison.json`: nenhum ficheiro histórico ausente. Materializer/evaluator/admissibility/reader e migrations anteriores não mudaram neste marco; repository/composition/recovery receberam a decisão nova e admissão 020, com branches anteriores preservados e percursos HTTP/browser reexercitados. Autoridade recebeu operação adicional explícita, sem alterar o algoritmo de guarda. Testes unitários e mecanismos partilhados são identificados como tal.

Hashes do snapshot em `tested-snapshot.json`; recorte relativo ao estado inicial em `changed-scope.json`. Histórico de evidência preservado; residual anterior, HEAD e índice mantidos. Sem stage/commit/push/deploy.

## Limitações e decisão

**BLOCKED — não pronto para decisão humana de fecho restrito.** Não foi marcado Complete.

| Finding restante | Severidade e evidência | Impacto e mínimo necessário |
| --- | --- | --- |
| C-PQ1-01 — capacidade conjunta do histórico de autoria | **HIGH / blocker**. `backend/src/organizationalProfile/editorialMaterial.js:123` aplica `canonicalClone` ao histórico inteiro, chamado por `pq1Material.deriveAuthors`. Diagnóstico read-only com PostgreSQL real: revisão 38, 2 items, 100 assertions, 1 experiência, 35 links, 0 verificações; material **71 975 bytes**, histórico **355 037 bytes**, teto canónico **262 144**; `deriveAuthors` lança `F13 canonical value exceeds the structural limit`. `capacity-history-diagnostic.txt`. | Material final abaixo do teto não basta para publicar/ativar: o histórico também limita o percurso. Falta fechar a admissão conjunta e demonstrar uma combinação documental admissível no limite → publicação → ativação → avaliação/consulta, mais excesso sem efeitos. A solução deve preservar histórico, segregação, canonicalização e deadlines; não aumentar o teto, cortar histórico ou particionar apenas para contornar a proteção. Delimitar esta correção do produtor antes de a implementar, preservando o fecho anterior. |

A combinação 100/100/100/100/100 foi efetivamente construída e a submissão recusou sem alterações nas contagens observadas. O diagnóstico subsequente confirmou excesso canónico do material; reduzir apenas items para 2 ainda terminou em TypeError, sem chegar à ativação. Esse processo é **FAIL**, não PASS. A tentativa seguinte, com uma experiência e 100 competências/ligações/verificações previstas, foi interrompida após o diagnóstico acima identificar o limite de histórico já na revisão 38; não se declara a preparação ou o gate completos. Não foi simulada capacidade por reduzir proteções.

Não bloqueadores: aviso de bundle; UI mobile inspecionada sem overflow, sem auditoria WCAG integral; mecanismo de ACK SQL perdido de ativação/avaliação reutilizado, sem ensaio de ACK SQL perdido específico de decisão (perda de resposta HTTP da decisão foi executada). A cobertura de mecanismos partilhados está separada da execução específica na matriz. O produtor fechado não foi reaberto nem o seu fecho documental revogado nesta tarefa; o finding limita a conclusão do marco atual.


Sem staging, produção, IdP externo, dados reais, armazenamento/antivírus externo ou SLO. 503 não é prova de rollback. UNKNOWN pode persistir com bloqueio limitado e suporte. A análise global permanece INDETERMINATE; decisão humana é local e separada.

## Reprodução local

Docker, Node/dependências instaladas e Chrome local. `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/pq1-consolidated-gate.ps1` cria e remove Central/A/B PostgreSQL descartáveis; executa harness HTTP/browser real em localhost:5173. `PQ1_PHASE=decisions|consumer|inputs|activation-revocations|capacity|browser` seleciona prova focada; `PQ1_CAPACITY_EXTENDED=1` acrescenta a combinação documental máxima; `PQ1_CAPACITY_DOCUMENT_MAX=1` seleciona a variante com uma experiência. Estes gates de capacidade ainda não passam integralmente. Portas PostgreSQL permitidas 5589–5591. Os serviços destes ensaios foram efetivamente encerrados e os containers descartáveis removidos; não há frontend/backend deste marco deixados ativos por esta tarefa. Serviços/containers preexistentes foram preservados. Não usar credenciais/dados reais. Para repetir apenas o percurso demonstrado: `$env:PQ1_PHASE="browser"; powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/pq1-consolidated-gate.ps1` (execução automatizada temporária, não ambiente manual persistente).
