# F13-PQ1-ACTIVATE — evidência parcial de implementação

Data: 2026-10-17. **In Progress**, não revisão final nem decisão de fecho. [Contrato](../../features/f13-pq1-materialization-and-activation.md). Sem novo endpoint, snapshot persistido, ponteiro ativo ou avaliação pública. A publicação e critérios fechados não foram reabertos.

## Implementado neste bloco

`backend/src/prequalification/`: tuple exata e limites; materializador puro de revisão publicada; leitura da publicação/revisão exatas sem latest heads; leitura agrupada do ledger autoritativo com lock F13-P1 e recusa de autocommit/isolation incompatível; avaliadores competência/tema/prioridade sem score, global INDETERMINATE; freshness separada de resultado histórico. Estes módulos internos exigem futura composição autorizada: não são endpoints nem uma garantia de autorização autónoma.

A1: material íntegro expirado/revogado pode materializar; o suporte não sustenta SATISFIED atual. Resultado UNKNOWN não modifica estado persistido. Digest/tuple incompatíveis recusam. Expiração torna suporte positivo histórico UNAVAILABLE, com precedência sobre REVIEW_REQUIRED. Nova avaliação pode ser UNKNOWN/CURRENT.

## Verificações executadas

- `node --test backend/test/f13Pq1ActivationCore.test.js`: **15/15 PASS** (testes unitários; SQL simulado nos testes de leitura). Cobrem identidade/determinismo, A1, validade semiaberta e método sem expiração, motivos UNKNOWN, correspondência exata, observações inválidas, freshness e limites.
- `npm test` em backend: **814/814 PASS**, incluindo os 15 novos; output preservado em `backend-tests.txt`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/pq1-activation-core.ps1`: **PASS**, PostgreSQL 17 descartável destruído no finally. Aplicou as migrations existentes pelo runner real. Leitor novo executado sob role runtime/RLS: revogação posterior visível, ambos os ordenamentos do advisory lock, tentativa de tenant diferente recusada, histórico não alterado e autocommit recusado.
- Sintaxe JavaScript e whitespace do recorte: PASS no recorte novo/alterado; hashes em `tested-snapshot.json`.

O probe PostgreSQL usa fixtures SQL sintéticas e o ledger real. **Não** exerce escritor HTTP autorizado, F7 da revogação, activation commit, browser ou dois bancos A/B; não é prova desses critérios. Não há resultados frontend/build novos porque frontend não foi alterado.

Limites: preservados 100 items totais entre temas/prioridades e limites específicos das demais coleções. A inspeção revelou `MAX_CANONICAL_BYTES=262144`; esse limite prevalece sobre o envelope de 1048576. Testado excesso sem truncamento. Não foi medido throughput nem capacidade máxima do percurso transacional futuro.

## Matriz parcial e trabalho necessário

| Critérios | Prova deste bloco | Pendente para aceitação |
| --- | --- | --- |
| ACT-02/03 | Núcleo unitário: material exato, A1, conservação de histórico | Snapshot persistido/imutabilidade e integração autorizada |
| ACT-04/14 | Validade, regras/freshness unitárias; ledger real | F11/referências atuais, deadline no commit de avaliação e corridas de critérios/ponteiro |
| ACT-05/08 | RLS/tenant diferente e lock de revogação no leitor real | HTTP A/B, grants/sessão/MFA e todos os escritores relevantes |
| ACT-12 | Tuple unitária e migrations existentes para preparar banco | Novas migrations, privilégios, manifestos, fingerprints e gates up/down |
| ACT-01/06/07/09/10/11/13/15 | Não demonstrados como percurso novo | Persistência, SoD/MFA, CAS/idempotência/F7/recuperação e browser integrado/regressões |

Sequência pendente: (1) armazenamento tenant de snapshot/ativação/resultado, migrations/manifestos; (2) composição autorizada com references/F11, grants/MFA/SoD, CAS/F7/deadlines e recuperação existente; (3) HTTP e UI coordenados ativar → avaliar → consultar; (4) gates completos, capacidade, revisão read-only. Não disponibilizar ativação isolada. Sem nova decisão de produto identificada.

As evidências históricas de publicação/critério são preservadas, não reexecutadas nem apresentadas como prova do caminho novo. UNKNOWN pode persistir sem resolução automática; provas locais não validam staging, produção, IdP externo ou dados reais. Nenhum stage, commit, push ou deploy.
