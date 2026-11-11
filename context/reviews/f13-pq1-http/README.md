# F13-PQ1 — preview, lookup e percurso HTTP/UI

2026-10-17. Integração implementada; contrato integral **In Progress**, sem fecho humano. O recorte entrega preview → confirmação/MFA → ativar → avaliar → consultar, com recuperação explícita da intenção. Evidência histórica do [núcleo](../f13-pq1-activation/README.md) e das [transações](../f13-pq1-transactions/README.md) preservada.

## Implementação

Rotas de ativação em `/api/organizational-profile/pq1-activation`: context, preview, activate, active, snapshots/:id, activations e intentions/lookup. Consumidor: POST `/api/opportunities/:opportunityId/prequalifications` e GET `/api/opportunities/prequalifications/:id`. UI `/pre-qualificacao`, ligada aos critérios da oportunidade e à publicação exata. Preview não persiste snapshot; token opaco vincula sujeito/sessão/tenant/publicação/geração/observações. Mudança de seleção, motivo, foco ou atualização invalida a confirmação. O servidor verifica novamente o token e as condições sob lock, com CAS e autorização até commit.

Montagem conjunta explícita: `PQ1_ACTIVATION_RUNTIME=f13-f14-pq1`, exigindo `PROFILE_EDITORIAL_RUNTIME=f13-editorial`, `OPPORTUNITIES_RUNTIME=f12` e OIDC. Reutiliza configuração de chaves da UI editorial, diretório e credenciais existentes. Não foi alterado ambiente implantado. Publicar continua a criar publicação inativa; apenas a operação explícita de ativação cria snapshot/ponteiro. Sem score, candidatura, comunicação ou decisões humanas implementadas neste recorte.

Lookup exige sujeito/tenant/operação/recurso/chave exatos. Central 013 acrescenta apenas a consulta fechada PQ1_ACTIVATE/PQ1_EVALUATE; tenant 019 permanece intacta. Recibo só é divulgado com autorização atual e prova de commit; leitura do resultado reautoriza as fontes. Recusa de autorização após commit incerto não é transformada em falha definitiva: recuperação mantém UNKNOWN sem divulgar recibo. `sessionStorage` guarda apenas cinco identificadores, não payload/token/digest; não constitui exclusão entre sessões. A pendência de ativação bloqueia o mesmo ponteiro e avaliações dependentes; uma avaliação pendente bloqueia nova avaliação da mesma oportunidade, não operações independentes. Suporte recebe intenção/correlação; não há resolução automática garantida.

A integração com login PostgreSQL NOINHERIT revelou que `information_schema.column_privileges` não expõe todos os ACL do papel assumido. O preflight 019 passou a inspecionar `pg_attribute.attacl`/`aclexplode`, mantendo a exigência exata de UPDATE apenas em activation_id/generation. Não foram alargados privilégios nem alterada migration tenant. Datas de publicação são projetadas como ISO antes de canonicalização/auditoria. Digests são removidos das projeções públicas.

## Verificações executadas

| Prova | Resultado e âmbito |
| --- | --- |
| Focados backend | **30/30 PASS**: 15 núcleo + 6 transações + 9 HTTP/tokens/recovery; `focused-tests.txt`. |
| Suite backend | **837/837 PASS**, `backend-tests.txt`. Inclui trabalho F12 concorrente; não atribuir todo o delta a esta tarefa. |
| Frontend | **70/70 PASS**, incluindo 8 regressões novas com API simulada; `frontend-tests.txt`. Não prova PostgreSQL nem browser integral. |
| Build | PASS, `frontend-build.txt`; aviso de bundle >500 kB mantido. |
| Central 013 | PostgreSQL descartável: up/down vazio, runner cumulativo, downgrade/reapply e preflight/fingerprints PASS; `migration-gate.txt`. |
| HTTP real A/B | Preview, token de outro sujeito, token obsoleto, ativação/replay, snapshot, avaliação/consulta e lookup; projeções sem digests/no-store. Runtime com logins tenant limitados e Central protegida. Sessões iniciais sintéticas; não substitui a prova browser da composição de produção. |
| Browser integrado | Chrome + Vite + composição de produção + Central/A/B PostgreSQL: preview, MFA com token OIDC assinado sintético, invalidação da confirmação, ativação, resposta substituída por 503 **após commit real**, reload, lookup, avaliação, reload/consulta e recusa B. `http-browser-gate.txt`. |
| Sintaxe e whitespace | Ficheiros do recorte, incluindo não rastreados; detalhes e hashes em `validation.json` e `tested-snapshot.json`. |

O browser usa ativador diferente do autor e do aprovador para executar step-up sem invalidar o epoch do aprovador já congelado. Não é exigência de terceira pessoa: o teste HTTP ativa com o próprio aprovador elegível. Uma renovação que invalida a evidência da aprovação exige nova aprovação, conforme mecanismo existente. IdP externo não foi utilizado.

Delta final após carregamento do processo integrado: a sanitização de erro passou também a cobrir `/api/opportunities/prequalifications/:id`; suites backend e focada reexecutadas sobre o código final. Não altera os percursos de sucesso exercitados no gate. Hash normalizado da versão carregada e hash final em `validation.json`; não se declara o gate reexecutado por este delta exclusivo de erro.

Ensaios intermédios detetaram a admissão ACL acima, canonicalização de Date e sincronização do harness após callback MFA; não são apresentados como resultados PASS. A captura mobile espera pelo fim da transição da sidebar e verifica ausência de overflow horizontal; não constitui auditoria WCAG nem prova integral mobile/zoom.

## Matriz acumulada — execução, reutilização e lacunas

| Critério | Evidência deste recorte e reutilização explícita | Lacuna restante |
| --- | --- | --- |
| ACT-01 | Browser integrado real sobre publicação existente; origem/snapshot lidos pelo servidor e apresentação da explicação | Percurso local com IdP sintético; não staging. |
| ACT-02/03 | Testes puros reexecutados; publicação real materializada. Imutabilidade SQL e drafts do bloco transacional são **evidência histórica reutilizada** | Combinações completas de verificações válidas/expiradas/revogadas no novo HTTP ainda pendentes. |
| ACT-04 | Validade/freshness unitárias reexecutadas; consumidor real e consulta histórica | F11 retirado/inacessível, expiração no commit e pós-ativação em prova integrada dedicada. |
| ACT-05/06 | HTTP A/B publicação/snapshot/resultado/lookup; token de outro sujeito; aprovador ativa; browser MFA e B sem divulgação | Matriz exaustiva por rota/grant, service actor e revogações concorrentes não executada neste recorte. SoD/F7 anteriores reutilizados. |
| ACT-07/09 | Replay HTTP; token obsoleto; lookup real; browser perde resposta após commit e recupera | CAS concorrente, F7 tardio e perda de ACK SQL são provas **anteriores**, não reexecutadas integralmente aqui. |
| ACT-08 | Composição chama guard, epoch, lock e revalidação existentes; suite partilhada reexecutada | Inspeção/reutilização não substitui ambos os ordenamentos de todas as revogações no novo consumidor. |
| ACT-10 | Browser 503 após commit → reload → lookup; UI simulada mantém UNKNOWN e âmbito limitado, sem replay | **503 por concorrência na mesma sessão** e UNKNOWN persistente no caminho integrado ainda não demonstrados. |
| ACT-11 | Browser motivo invalida confirmação; HTTP token antigo recusado; testes de seleção/sessão e pendência independente | Confirmação exercitada neste recorte, sem declarar todas as corridas ACT-08 cobertas. |
| ACT-12 | Central 013 real up/down, runner, fingerprints; admissão tenant 019 com login limitado | Tenant 019 up/down/ocupado reutilizado do bloco anterior; não houve nova alteração da migration. |
| ACT-13/14 | Leitura real da avaliação exata; testes freshness reexecutados; explicação por critério | Corridas de critérios/referências e baseline mais amplo continuam pendentes; histórico/CAS anterior reutilizado. |
| ACT-15 | Suites completas; publisher real usado na preparação; inspeção confirma ativação só explícita | Browser editorial temático/PQ1 histórico não reexecutado nesta tarefa. |

A medição de capacidade máxima conjunta/bytes/tempo permanece gate obrigatório pendente. Limites operacionais não são capacidade comprovada. F13 integral In Progress; F14 integral não está concluído (lista de avaliações/decisões humanas continuam fora deste recorte). Sem validação de staging, produção, IdP externo, dados reais ou SLO. Sem stage, commit, push ou deploy. Há trabalho F12 concorrente no workspace, preservado; os hashes identificam o snapshot efetivamente presente, não autoria de todo o residual.

## Migração e rastreabilidade

Central 013 schema fingerprint: `b23695fb8c588208bea29e421656625f6922ee1a71f0b713356ab2ec57b8ead8`.
Authority fingerprint: `2065bfc28e43042a9d8e5d0da32b9de111f8b99942935890c8a68694b660b9fc`.
Checksums canónicos LF no manifesto; hashes brutos dos ficheiros no snapshot. Reserva tenant 013 preservada. HEAD/índice conferidos em validation.json, sem operação Git mutável.

Próximo passo: completar os gates integrados de revogação/F11/deadlines, concorrência da mesma sessão e capacidade antes da revisão de fecho do contrato integral.
