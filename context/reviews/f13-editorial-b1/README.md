# F13 — continuação B1 / interface editorial

Evidência local de 2026-10-15. Estado: **READY_FOR_HUMAN_REVIEW**, sem fecho humano. F13/016 permanece Complete; F13 integral In Progress. HEAD: `0cf519ea22de929d2e52d0b3edb4d72364aa6220`. O registo anterior em `../f13-minimal-editorial-ui/` é histórico e não foi reescrito.

## B1 e composição

A consulta nova era recusada por `authorityProtocolQueries.js` com AUTHORITY_QUERY_DENIED/42501. Central `010_editorial_intention_lookup` acrescenta exatamente um código de consulta à função fechada, com parâmetros organização/sujeito/key/operação/recurso. Organizações e sujeitos vêm da autoridade autenticada; READ é revalidado. O resultado interno contém apenas sete colunas necessárias e até 101 tentativas; nada disso é devolvido diretamente ao browser. Não há tabela, serviço ou grant direto novo. Down restaura a definição e ACLs exatas de 009. Ausência de receipt continua UNKNOWN; rollback só é terminal com prova do protocolo existente.

A composição de produção monta U com `PROFILE_EDITORIAL_RUNTIME=f13-editorial`, OIDC, dependências F4 e chave dedicada válidas. `PROFILE_EDITORIAL_UI_KEY_ID` seleciona uma entrada de `PROFILE_EDITORIAL_UI_KEYS_JSON` (mapa kid→segredo de pelo menos 32 bytes). Configuração incompleta/ilegível falha com EDITORIAL_UI_KEY_NOT_CONFIGURED, sem ecoar valores. A admissão exige Central 010 e tenant 016. Não há fallback para acesso Central livre.

## Resultados registados

| Verificação | Resultado |
|---|---|
| Central 010 instalação, 010→009→010, admissão e ACL | PASS, `central-migration.log`; acesso direto a guard recusado, código novo recusado em 009, aplicação atual recusa fingerprint antigo |
| Consumidores Central/F3/F5/F7/F13 | PASS, `central-consumers-gate.log`; 47 casos de drift ACL, 2 de schema quente, fencing/revogação, crash/commit incerto/recovery, duas bases e downgrade com dados protegido |
| HTTP editorial A/B e recuperação | PASS, `http-recovery-final.log`; criar/editar/submeter/aprovar/publicar inativo, token renovado com mesma key, IDOR, quatro Outcomes, revogação e bindings incorretos |
| Falha F7 | 503; contagens de versão e evento funcional de aprovação inalteradas; protocolo existente prova rollback, lookup FAILED_FINAL |
| Transação de publicação em curso | Barreira determinística depois do evento e antes do COMMIT; lookup RESOLVING; libertação permite conclusão |
| Commit acknowledgement perdido | COMMIT efetivo seguido de exceção injetada; reconciliação existente devolve receipt, sem nova intenção |
| Backend | 775/775 PASS, `backend-test.log` |
| Frontend | 37/37 PASS, `frontend-test.log`; inclui isolamento de resposta tardia e MFA sem aprovação automática |
| Browser Chrome | PASS, `browser-final.log`: authoring/edição/submissão, SoD, step-up assinado, nova confirmação, aprovação por teclado, publicação inativa, perda da resposta, reload/recovery, A/B, mobile 320 px e logout |
| Build frontend | PASS, `frontend-build.log`; aviso de chunk >500 kB mantém-se |
| Regressão editorial fechado | PASS, `editorial-regression.log`: CAS/F7/recovery, expiração exata/antes/depois com epochs invariantes, HTTP A/B |
| F12/UBI cumulativo e Chrome | PASS, `ubi-gate.log`: cadeia 012→014→015→016→012→014→015→016, ACL/RLS, CAS, revogação, commit incerto e fluxo UBI com dois utilizadores |

As iterações diagnósticas `browser-focused*.log` e `editorial-ui-browser-gate.log` registam falhas intermédias. São preservadas como diagnóstico, não como prova final. Corrigidos: consultas iniciais sobrepostas e geração desmontada, entrada de MFA no índice, overflow do cabeçalho editorial, tempo limitado de revalidação de sessão, sanitização de erros de parsing/middleware e limite JSON de 256 KiB. Os fixtures também corrigiram um locator com encoding inválido e uma chamada recursiva ao adapter OIDC; não foram alteradas garantias do domínio para fazer testes passar.

## Fingerprints e preservação

- Central 010 schema: `b8ee050f52c1cb905d2afc6f5c1404220c76d9e1351f9b98bdf9efbeeabcab7d`.
- Central 010 segurança: `06520d7967c1663e369a67c87b6b3c5af060c425a714b63953514552c2e176cf`.
- Down 009 schema: `9e975a00c3f11a6a4b7995c954d3cb437407751b10d35789a597acd69b0e6581`; segurança: `4da6e49668d6c8620951291c9a6fad558731cd2f5d10c2b2770086e6914f2fe0`.
- Tenant 016 A/B: `bc47c3c859f9790136b70dc40d1159978f2f30ce80ffb124ec6522b546a6ea5a`.

`baseline.json` regista hashes do estado inicial, incluindo residual. `tested-snapshot.json` identifica o código testado; `changed-files.json` delimita esta continuação relativamente à baseline; `verification.json` regista comandos e verificações finais; `artifact-hashes.json` identifica os artefactos. 009, 016 e evidência histórica não são reescritas. Nenhum stage, commit, push ou deploy.

## Reprodução local

1. Docker disponível, Node/dependências backend e frontend/test-harness, Chrome no path usado pelo harness. Executar `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/editorial-ui-gate.ps1`. Usa PostgreSQL 17 descartável, Central/A/B, sessões sintéticas, chaves efémeras e IdP de teste com ID tokens assinados; limpa o container próprio no finally. Reservar portas 5574 e 5173. Não executar o gate UBI ao mesmo tempo, pois também usa Vite 5173.
2. Gates separados: `editorial-central-migration-probe.ps1` (5575), `migration-gate.ps1` (5562), `test/integration/ubi/private-opportunity-gate.ps1` (5582/5173). Para HTTP isolado: definir F13_UI_HTTP_ONLY=1 e executar editorial-ui-gate.ps1 -Port 5576. Para browser isolado: F13_UI_BROWSER_ONLY=1 no mesmo gate. Remover essas variáveis depois da prova.
3. Num ambiente local próprio já provisionado: aplicar Central pelo runner canónico (`npm --prefix backend run db:central:up`), manter tenant 016 admitido, configurar OIDC/F4/chave dedicada, memberships/grants e conceitos/labels publicados. Não usar dados ou credenciais de produção. Iniciar backend e frontend com `npm run dev` nos diretórios respetivos e abrir `/perfil-organizacao`.
4. Maker cria/edita/submete; checker humano distinto relê, faz MFA quando pedido, confirma aprovação e publicação com grants separados. A versão mostra “Publicada — inativa”, nunca disponibilidade para matching. Configuração/catalogação ausentes não são preenchidas automaticamente.

Limites permanentes: staging, produção, IdP externo, dados institucionais reais, SLO e fornecedores externos não validados. Sem ativação, READY, F14, matching, overlays ou migração UBI. Nenhum fecho humano desta UI.

## Revisão final

Sem blocker remanescente no recorte implementado. A revisão corrigiu também revalidação final em RESOLVING, respostas tardias de sessão após troca/logout, preservação do formulário ao recuperar foco e a ação redundante numa versão já publicada. Testes afetados repetidos; 37 testes frontend incluem os limites de sessão reais. Configuração válida disponibiliza a composição completa, comprovada no browser sobre a composição de produção e PostgreSQL descartável. O IdP do harness usa transporte local e tokens assinados com validação criptográfica real; não constitui validação de um IdP externo ou de um dispositivo MFA real.

A captura `editorial-mobile.png` foi inspecionada: organização identificável, publicação inativa, UNKNOWN explícito e conteúdo dentro de 320 px. Não foi feita auditoria WCAG integral nem ensaio separado de zoom 200%; teclado, foco, labels, estados e viewport móvel foram exercitados. Estas limitações não são apresentadas como provas realizadas. Containers descartáveis removidos; serviços locais preexistentes preservados.
