# Critérios evidenciados da oportunidade — implementação e validação local

Estado: **Review — READY_FOR_HUMAN_REVIEW**, 2026-10-16. Percurso completo validado localmente; sem blockers materiais conhecidos após a revisão do incremento. Não representa fecho humano. Contrato: [F13→F14](../../features/f13-f14-minimal-qualification-contract.md), apenas o incremento aprovado de critérios privados.

## Percurso entregue

No detalhe F12 de uma oportunidade privada: **Interpretação privada dos critérios** → adicionar critério e fonte → guardar nova revisão → rever → confirmar interpretação editorial → consultar head/histórico. São três tipos fixos, sem DSL. A mesma pessoa pode editar e confirmar quando possui ambos os grants. Confirmar não significa satisfazer requisitos, comprovar elegibilidade ou criar candidatura.

Cada gravação preserva a revisão anterior. Mudança da oportunidade sinaliza revisão necessária; a UI exige recarregar a oportunidade e reconhecer a nova referência antes de a adotar. Confirmação relê head e detalhe, usa IDs exatos/CAS e reautoriza no servidor. Fontes sintéticas e transcrições têm identificação explícita; nunca são evidência organizacional de competência.

## Composição e execução local

- Runtime OIDC existente; `OPPORTUNITIES_RUNTIME=f12` e `PROFILE_EDITORIAL_RUNTIME=f13-editorial`.
- Central migrada até **011**, tenant até **017**, com directory/admissão/credenciais locais existentes. 013 mantém a reserva. Não aplicar scripts isolados numa base existente: usar os runners governados.
- Chave `PROFILE_EDITORIAL_UI_KEY_ID` / `PROFILE_EDITORIAL_UI_KEYS_JSON` configurada fora do código; configuração incompleta recusa o arranque editorial. Cursor reutiliza o mecanismo autenticado existente, sem digests internos.
- Conceitos de releases publicadas dos catálogos F13; grants explícitos `opportunity.read`, `opportunity.criteria.read`, `opportunity.criteria.edit` e `opportunity.criteria.confirm`. Criar a oportunidade exige também `opportunity.private.create`. Nenhum grant implícito nem requisito adicional de MFA/SoD.
- Com a configuração local existente: backend `npm run dev`, frontend `npm run dev`; selecionar a organização, abrir **Oportunidades** e o detalhe privado. A UI legacy não serve de fallback.
- Demonstração automatizada isolada: `powershell -NoProfile -File test/integration/criteria/run.ps1`. Requer Docker, PostgreSQL 17 Alpine, Chrome e dependências já instaladas; usa PostgreSQL descartável em loopback 5576, Vite 5173 e identidades sintéticas. Limpa o ambiente no fim. Não usa produção nem credenciais persistidas.

## Persistência, segurança e recuperação

Tenant 017 acrescenta `criteria_set`, `criteria_revision`, `criteria_confirmation` e `criteria_receipt`; revisões/confirmations/receipts são imutáveis. RLS forçada, SELECT/INSERT limitados ao runtime de oportunidades e UPDATE somente do ponteiro do conjunto. A migration admite os três eventos F7 e capability específica. O downgrade recusa dados; o runner admite explicitamente 017→016 sem apagar histórico.

Central 011 substitui apenas a função de protocolo com um caso adicional fechado. Lookup parametrizado por organização, sujeito, chave idempotente, operação CRITERIA_SAVE/CRITERIA_CONFIRM e recurso protegido exato. Sem acesso direto a tabelas Central nem allowlist genérica; 009/010 e 016 preservadas.

Recuperação reutiliza o reconciliador existente e o binding físico. `CONFIRMED` exige receipt correlacionado com digest interno e prova de commit; `FAILED_FINAL` exige intenção única vinculada e rollback terminal comprovado; `RESOLVING` exige transação identificada pendente; ausência de prova é `UNKNOWN`. A observação read-only não prepara uma segunda operação nem espera na auditoria da transação observada. Respostas são projeções sanitizadas.

Envelope em sessionStorage: utilizador, organização, oportunidade, operação, recurso e requestId; sem conteúdo, digests ou tokens. Reload recupera a intenção; troca de organização suspende ações anteriores e descarta respostas tardias; logout/401 limpa envelopes. Polling limitado a três tentativas/30 segundos, consulta manual e referência de suporte. Resultado incerto impede nova gravação conflitante; ausência de receipt nunca é tratada como rollback.

## Evidência e recorte

`baseline.json` regista HEAD e hashes anteriores à implementação; `changed-files.json` identifica alterações deste incremento relativamente a essa baseline, incluindo adições sobre ficheiros com residual. Os logs desta pasta são provas locais; não substituem validação externa.

Comandos executados e artefactos:

| Verificação | Artefacto |
|---|---|
| Migration probe: up/down, runner upgrade/downgrade e admissão | `migration.log` |
| API real e Chrome, duas organizações, falhas e recuperação | `integration.log` |
| Suite backend (`npm --prefix backend test`) | `backend-test.log` |
| Suite frontend (`npm --prefix frontend test`) | `frontend-test.log` |
| Teste dirigido intermédio; repetido na suite frontend final | `criteria-component.log` |
| Build frontend | `frontend-build.log` |
| Gate F12 cumulativo | `f12-gate.log` |
| Regressão editorial/temporal F13 | `editorial-regression.log` |
| Gate UBI cumulativo e browser F12 | `ubi-gate.log` |
| Sintaxe/whitespace do recorte | `syntax-whitespace.json` |

Resultados finais: **782/782 backend**, **41/41 frontend**, build e todos os gates da tabela **PASS**. O gate de migrations cobre instalação, upgrade/downgrade pelo runner e admissão. F12 e UBI cobrem a cadeia cumulativa até 017; UBI inclui 29 casos de deriva de metadata, privilégios limitados, A/B, edição e arquivo no browser. A regressão editorial preserva as provas de guard temporal, MFA/SoD e publicação inativa.

O browser de critérios percorreu criação desde vazio, fonte/referência publicada, gravação, revisão com nova consulta, confirmação por teclado e leitura histórica. Probes reais confirmaram: A/B/IDOR e revogação; checker sem grant de confirmação recusado; replay idempotente; commit sem ACK reconciliado; quatro resultados do lookup; concorrência com um sucesso e um CAS 409; perda de resposta + duplo clique + reload com uma única nova revisão; troca A/B e limpeza no logout. Falha F7 deixou **zero confirmações e zero eventos funcionais de confirmação** para a revisão recusada, e a recuperação devolveu FAILED_FINAL com prova terminal. A ausência de guard/receipt permanece UNKNOWN. A captura `criteria-mobile.png` foi inspecionada após estabilizar a navegação a 360 px; sem overflow horizontal no probe.

Comandos e resultados estão em `commands-results.json`. `tested-snapshot.json` fixa HEAD de referência e SHA-256 do código, testes e contrato; `artifact-hashes.json` fixa os artefactos. `preservation.json` confronta a baseline, identifica o recorte e verifica migrations fechadas/evidência histórica. Gates não afetados por alterações posteriores foram reutilizados apenas com os respetivos ficheiros de implementação inalterados.

Fingerprints observados: tenant 017 `e72833f1a24a515dccd5cedf306408cc12098f6531f06eb50cb1c8ab7411376f`; Central 011 schema `d1dea2dc3d1ec3ee81fd876036ab2caca826853f8bc4325ccb645205ce187d2c`; Central security `bc726a44faf8de5cd4602c9caa6f586601d5a544373b958ae6da8640e1fb81bb`.

## Revisão e limites

Corrigidos durante a implementação: admissão do schema cumulativo, owner/privilégios da nova persistência, integração F7, projeção fechada de receipts, leitura não bloqueante da intenção, identificação estável do critério através do histórico, reconsulta antes de confirmar e adoção explícita de revisão nova da oportunidade. A concorrência revelou que o timeout observacional F5 não cancela o append SQL: a composição dos critérios serializa e aguarda os pares de append antes de continuar e antes de terminar a transação. A projeção de auditoria partilhada aceita a referência nula prevista para recusas sem recurso; teste dirigido cobre essa construção. Texto não canónico é recusado como entrada inválida antes de preparar uma intenção. Limpar a fonte mantém evidência ausente em rascunho e a orientação de recuperação apresenta também o requestId, sem conteúdo ou tokens. O GET F12 anuncia a capacidade técnica do painel apenas quando a composição existe; a UI não inicia consultas/refresh desse painel no runtime UBI sem editorial. Um teste de componente verifica ambos os casos. A reconsulta fica desativada durante o carregamento para evitar leituras sobrepostas; os probes aguardam estados da interface e usam reconsulta explícita nos erros transitórios, sem trocar falhas por sucesso. Os gates antigos foram atualizados onde assumiam que 009/016 eram as últimas migrations; mantêm a prova de rollback e proteção de dados.

F13 integral permanece **In Progress**. F13/016 e interface/Central 010 mantêm os fechos anteriores. Excluídos: oportunidades Central operacionais, avaliação F14, scoring, ranking, decisões sobre avaliações, candidatura, ativação e snapshot READY. Publicações editoriais continuam inativas.

Validação exclusivamente local com PostgreSQL descartável e IdP simulado; staging, produção, IdP externo, dados reais e SLO não validados. Verificações de teclado, foco e largura móvel não constituem auditoria WCAG integral nem ensaio de zoom 200%. O build conserva o aviso de bundle superior a 500 kB. A concorrência de atualizações de sessão pode causar recusa transitória da leitura F12; a UI oferece reconsulta explícita e não declara sucesso nesses casos.
