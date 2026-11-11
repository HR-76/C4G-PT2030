# F13-PQ1-PUBLISH — implementação e evidência local

Estado: **Review — READY_FOR_HUMAN_REVIEW**, sem fecho humano. Implementação autorizada em tarefa própria em 2026-10-16. [Contrato](../../features/f13-pq1-publish.md), [matriz](acceptance-matrix.md), [snapshot](tested-snapshot.json) e [recorte revisto](change-scope.json).

## Resultado e fronteira

Interface `/publicacao-perfil`: criar/editar competências, experiências com proveniência, associar evidências, verificar/revogar, submeter, aprovar com segregação/MFA, publicar e consultar. Publicação multidomínio imutável **inativa**, namespace próprio, sem READY, ponteiro ativo, ativação ou F14. Conhecimento, verificação factual, completude e observação atual estão separados. Verificações históricas preservadas; mudança de estado entre submissão e aprovação/publicação exige nova decisão editorial.

Reutilizados os serviços de authoring/competências, F5/F7/F11 e o protocolo preparado de commit. Acrescentados extrator/bundle/policy PQ1, descriptor documental, proveniência resolvida, status stream, persistência própria, projeções, tokens opacos e recibos com binding sujeito/recurso. O schema temático anterior não foi ampliado com conteúdo multidomínio. A admissão cumulativa inclui tenant 018 e Central 012; a família de autoridade interna permanece F13_EDITORIAL_BASELINE porque é a família explicitamente admitida pelo executor preparado, com queryModule e capability PQ1 separados.

## Verificações desta tarefa

| Comando / prova | Resultado e artefacto |
| --- | --- |
| `npm test` em backend | **799/799 PASS**, [log](backend-tests.log). Inclui 8 testes do material PQ1 e 1 teste HTTP do parser da app real. |
| `npm test` em frontend | **48/48 PASS**, [log](frontend-tests.log). Inclui envelopes e painel real de pendências, suporte/UNKNOWN, recurso independente e dependências. |
| `npm run build` em frontend | PASS, [log](build.log). Aviso de bundle >500 kB, sem falha de build. |
| `node --check` no recorte JavaScript | PASS, [lista](syntax.log). JSX validado pelo build. |
| `pq1-gate.ps1 -Port 5574` sem flags | PASS, [HTTP PostgreSQL A/B](http-final.log): percurso, F11, autoria, F7 em proveniência/revogação/aprovação/publicação, replay, perda de ack de commit, consulta histórica e down ocupado. |
| `PQ1_CONSISTENCY=1`, gate em 5576 | PASS, [log](consistency.log): CAS entre sessões, submit/edit, expiração/revogação invalida aprovação, grants antes/depois do commit, UNKNOWN e draft independente. |
| `PQ1_RACES_ONLY=1`, gate em 5576 | PASS, [log](races.log): verify/attach nas duas ordens, revisão e efeitos persistidos conferidos. |
| `PQ1_STATUS_RACES=1`, gate em 5574 | PASS: approve/publish versus revogação nas duas ordens; resultado final em [log](status-races.log). |
| `PQ1_AUTHORIZATION_ONLY=1`, gate em 5574 | PASS executado nesta tarefa: replay divergente/entre sujeitos, grant de leitura de outro recurso, histórico e seletor F11, catálogos de outro owner na mesma base, lookup A/B e proibição de ler object_id F11. Resultado observado na execução dirigida; não existe log autónomo dessa execução. |
| `PQ1_BROWSER_ONLY=1`, gate em 5576 | PASS, [log](browser.log), [captura móvel](pq1-mobile.png): percurso completo Chrome, OIDC sintético assinado/MFA, maker/checker, A/B, 320px, logout, intenção persistida, 503 concorrente na mesma sessão, reload/lookup e nova ação explícita só após rollback comprovado. |
| `pq1-migration-probe.ps1 -Port 5578` | PASS A/B, [log final](migrations-final.log): runner canónico, admissão/runtime, up/down vazio 018→017, recusa de down ocupado e dados preservados; preflight F12 no schema 018. |
| `test/integration/f12/migration-gate.ps1` | PASS, gate cumulativo F12/F9, [log final](f12-gate-final.log); resultado conferido pelo exit code e marcadores. |

Os gates HTTP usam rotas reais, serviços e PostgreSQL 17 descartável com Central e dois tenants, não repositories simulados. O browser usa a composição produtiva local e um IdP sintético; os probes HTTP diretos usam sessões sintéticas autenticadas pelo harness. As falhas F7 e de transporte são injetadas deliberadamente. Asserções esperadas 403/404/409/503 nos logs não representam falha do gate. `F13_EDITORIAL_CENTRAL_AB: PASS` é o marcador final herdado pelo harness PQ1, não uma alegação de nova execução do browser temático antigo.

O teste browser integral precede duas correções finais delimitadas: rótulos de slot/EXPIRED/REVOKED da completude (cobertos por teste de componente e build finais) e parser/no-store/erros sanitizados do namespace PQ1 (teste HTTP na app real e suite backend finais). Não se declara nova execução integral do browser depois dessas correções. O snapshot final identifica os bytes finais; `browser-delta.json` identifica hashes canónicos LF reconstruídos dos ficheiros anteriores (não um arquivo capturado à hora do browser). Posteriormente foram também corrigidas duas admissões cumulativas F12 (`tenantOperations` e `preflight`) para 018, fora do percurso PQ1 browser; cobertas pela suite final, preflight real A/B e gate cumulativo F12/F9. Não houve repetição integral do browser por estas alterações delimitadas.

## Migrations e recuperação

Tenant 018: fingerprint `77b31fd6d07065e3798df1e285a1a39226778d06eaa21c260d90690d763ec9af`; Central 012: schema `d8ec4990c6c35b454725de1de7f78e7438e02dc0d3035313ffdb5b94770c9187`, catálogo fechado `2a3e17c8b67034cc6dd114982b7170f72671c98f18fd2f2ee1abc0d66a9dd67b`, authority security `3a9b36b8cae72bc1df7c343b64f5106fe697f8d7111e1ec51371797c78a7d268`. Hashes dos SQL/manifestos no snapshot. SQL normalizado LF pelo runner. As fixtures Central dos gates conferem fingerprints e up/down/reapply 012; não executar SQL cru CRLF como substituto do runner.

Runtime: dez tabelas PQ1 com RLS forçado e privilégios mínimos; oito SELECT/INSERT e duas SELECT-only, sem UPDATE/DELETE/TRUNCATE. Seletor F11 estreito com autorização adicional, sem object storage. Down recusa dados novos e restaura fingerprint anterior apenas em base vazia; não é uma ferramenta de apagar história. Não houve migration em base real.

503 não prova falha definitiva. No browser executado, a concorrência da mesma sessão invalidou o guard da primeira tentativa; só o lookup com prova terminal permitiu mostrar rollback. Nova publicação exigiu confirmação e nova intenção explícitas. Também se provou commit concluído com ack perdido e recuperação sem duplicar efeitos pelo caminho HTTP. UNKNOWN pode persistir sem garantia de resolução automática; bloqueia só recurso/dependências na UI, não a organização. sessionStorage e a fila por tab não são exclusão entre sessões. Suporte dispõe das referências de operação/recurso/intenção/correlação para correlacionar guardas, recibos e F7; ausência de prova mantém UNKNOWN.

## Revisão, histórico e limitações

Revisão read-only do recorte final: rotas/cliente, projeções sem digests, autoria, source revision, deadline, admissões, recuperação e efeitos de persistência. Corrigidas a omissão de parser/sanitização PQ1 e as duas admissões cumulativas F12 encontradas nessa revisão; provas HTTP e preflight/gate acrescentadas. Sem finding material conhecido pendente na implementação. A matriz explicita a cobertura que depende de mecanismos partilhados e os cenários não individualmente executados; isto não é uma decisão humana de aceitação.

Tentativas anteriores desta tarefa detetaram problemas e não contam como PASS: arrays congelados na autoria, admissão de família de autoridade, fingerprints SQL com CRLF, mapping da recuperação de recibos PQ1, seletor de organização no cabeçalho e proteção do down com RLS. Corrigidos antes das provas finais. Uma tentativa do gate completo passou os cenários mas falhou no down ocupado; o gate final passou também esse passo. [http.log](http.log) conserva uma tentativa interrompida pelo tratamento PowerShell de stderr esperado; o wrapper passou a respeitar o exit code de Node e `http-final.log` é a execução conclusiva. O primeiro gate F12 executou as fases iniciais e falhou na lista histórica de migrations esperadas: o teste ainda terminava em Central 011; foi acrescentada a 012 aprovada, preservando a asserção exata e repetindo o gate. A primeira suite após a extensão da admissão F12 também recusou a expectativa antiga de schemas; esta foi atualizada para 018 e a suite final passou. Não se apresentam essas tentativas como provas bem-sucedidas.

Evidência histórica de outros incrementos permanece intacta. Resultados antigos são reutilizados apenas onde a matriz identifica mecanismo/composição, sem afirmar reexecução. A suite atual executou novamente os testes existentes de authoring, competências, editorial, F5/F7/F11 e fronteiras; o gate cumulativo F12/F9 foi repetido por impacto da admissão, mas os browsers antigos e o gate UBI não foram repetidos. Não houve ensaio de produção, staging, IdP externo, dados reais, carga/SLO ou auditoria WCAG integral. Catálogos produtivos, métodos e durações requerem conteúdo governado; só existem fixtures sintéticas para esta prova. Mantém-se a limitação UNKNOWN aprovada.

HEAD e índice conferidos iguais ao início (`0cf519ea22de929d2e52d0b3edb4d72364aa6220`, índice SHA-256 `7cea2950b59c83a8a2fb3dd7eddd0d634518a77cecf9f3c6170cdf4c689b5d20`). Residual pré-existente não foi limpo nem incluído num commit. O diff contra HEAD contém trabalho anterior; `change-scope.json` identifica ficheiros tocados/revistos nesta tarefa, não reivindica todas as suas linhas como novas. Sem stage, commit, push ou deploy.

Próximo passo: revisão read-only deste incremento e da matriz para decisão humana de fecho restrito. F13 integral continua In Progress; F14 não foi iniciado.
