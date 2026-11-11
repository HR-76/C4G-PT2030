# F13-PQ1 — persistência e operações transacionais

2026-10-17. Bloco interno implementado; contrato integral **In Progress**, sem fecho humano ou exposição em produção. Pedido: persistência e operações transacionais de ativação/consumo. Evidência anterior do [núcleo](../f13-pq1-activation/README.md) e dos incrementos fechados preservada.

## Entrega

Migration tenant 019 aditiva: release efetiva congelada, snapshot imutável, histórico de ativações, ponteiro CAS, avaliações imutáveis e recibos de intenção. RLS forçado, ACL restrita, guardas de imutabilidade e cadeia de gerações; downgrade só vazio, sem apagar histórico funcional ou F7. Fingerprint `addaa7024066f87b767415bc0880b3e0f4473839f9c3aa457b1ebc4908eeb856`; checksums canónicos LF no manifesto. Migrations anteriores não alteradas.

`prequalification/composition.js` integra operações internas `activate`, `active`, `evaluate`, `read` com autoridade F2/F5, executor F4 e F7 real. Sem rotas HTTP, UI ou montagem na composição de produção. Autoridade não vem do payload. Grants distintos, ativação sensível/MFA e autor impedido; aprovação revalidada. Referências exatas e documentos autorizados, ledger atual de revogação e validade observados sob lock existente. Ativação, snapshot, ponteiro, auditoria e recibo pertencem à mesma transação; avaliação, F7 e recibo também. Leituras históricas mantêm resultado e recalculam freshness; mudança da ativação exige revisão. Digests ficam no servidor.

A recuperação reutiliza nonce transacional, guard Central e recibo, com replay autorizado; uma falha de comunicação não prova rollback. Sem prova conclusiva devolve UNKNOWN, sem garantia de resolução automática. O endpoint de lookup e a experiência de pendência/suporte por operação/recurso ainda pertencem ao bloco HTTP/UI. Não existe bloqueio organizacional persistido novo; o lock F13-P1 já existente serializa apenas as transações em curso. `sessionStorage` não constitui exclusão entre sessões.

## Execução deste bloco

- Focados: **21/21 PASS** (15 do núcleo reexecutados + 6 novos), `focused-tests.txt`.
- Backend: **820/820 PASS**, `backend-tests.txt`.
- PostgreSQL 17 descartável: migration 019 up/down vazio restaura fingerprint 018; runner cumulativo, manifesto, preflight/ACL/RLS e fingerprint 019 PASS, `migration-gate.txt`.
- Composição Central + tenants A/B: resultado final em `transaction-gate.txt`. Preparação real de publicação, ativação/consulta, critérios confirmados, avaliação/consulta; oportunidade sintética inserida diretamente em SQL. Não é prova de criação HTTP da oportunidade nem browser.
- Sintaxe/whitespace e invariantes: `validation.json`; hashes do código/testes/SQL em `tested-snapshot.json`.

O probe verifica autor recusado; referência a publicação/avaliação de B recusada; primeira ativação e substituição; replay idêntico sem duplicação e payload divergente recusado; CAS obsoleto; duas sessões com MFA válido e uma só ativação; F7 falhando depois dos INSERTs de ativação e avaliação com contagens/ponteiro inalterados; perda de ACK após COMMIT recuperada por recibo; resultado antigo REVIEW_REQUIRED; runtime não reescreve snapshot e downgrade ocupado recusa.

Diagnóstico preservado: os primeiros ensaios detetaram listas fechadas de permissões/eventos/SoD e a necessidade de admitir explicitamente leituras auditadas. A primeira corrida aceitava uma recusa genérica e não provava CAS; passou a exigir `STALE_ACTIVATION`. Renovar MFA da fixture não eliminou a recusa: a reserva F7 antes do lock F13 causava contenção na autorização inicial. A composição nova adquire F13-P1 antes de F5/F7; a prova final exige o resultado específico. A revisão também corrigiu o tipo de recurso da auditoria de leitura da baseline, comprovado por regressão unitária. Ensaios intermédios não são apresentados como PASS final.

## Cobertura e lacunas

| Critérios | Evidência efetivamente exercitada | Limite / pendente |
| --- | --- | --- |
| ACT-02/03 | Núcleo reexecutado; publicação real → snapshot persistido; UNKNOWN explícito; imutabilidade SQL | Combinações verificadas/expiradas/revogadas no caminho composto completo ainda não exercitadas |
| ACT-04/14 | Validade e freshness unitárias; critérios confirmados reais; avaliação/consulta e troca da ativação | F11 real no novo consumidor, deadlines de evidência no commit e corridas de critérios/referências pendentes |
| ACT-05/06 | Duas bases reais, publicação/resultado estrangeiros recusados, grants explícitos, autoria/SoD e MFA válido no caminho novo | Matriz de ausência/expiração MFA, service actor e todas as rotas/lookup pendente |
| ACT-07/09 | CAS, replay, concorrência, F7 tardio e ACK perdido no caminho transacional | UNKNOWN persistente e lookup externo ainda não exercitados; sem garantia automática |
| ACT-08 | Guard e validação final existentes efetivamente chamados pelo novo caminho | Ordenamentos concorrentes de grants/membership/sessão/referências não executados especificamente aqui |
| ACT-12 | 019 up/down vazio/ocupado, runner e admissão exatos; checksums unitários | Mutação maliciosa de todos os novos privilégios/fingerprints no caminho HTTP não executada |
| ACT-13 | Histórico imutável; geração substituída torna avaliação antiga REVIEW_REQUIRED | Rejeição de baselines mais amplas sustentada por tuple exata/inspeção, sem fixture integrada adicional |
| ACT-15 | Suite backend completa; publisher PQ1 real continua inativo antes da ativação explícita | Regressão browser temática/PQ1 não repetida; nenhum frontend alterado |
| ACT-01/10/11 | Não executados | Preview, confirmação, HTTP/browser integrado e lookup pendentes |

Reutilização: leitor autoritativo PostgreSQL e dois ordenamentos do lock do bloco anterior são evidência histórica, não reexecução neste gate. Os testes partilhados de autoridade/deadline/auditoria pertencem à suite backend reexecutada; não substituem corridas específicas do consumidor. A inspeção confirma as ligações a esses mecanismos, não demonstra todas as combinações.

Sem validação de capacidade máxima/SLO, staging, produção, IdP externo ou dados reais. Tetos operacionais não são capacidade comprovada. Sem ranking, score, candidatura, comunicação ou decisões humanas automáticas. F13 integral permanece In Progress. Frontend/build não repetidos por ausência de alterações frontend. Sem stage, commit, push ou deploy.
