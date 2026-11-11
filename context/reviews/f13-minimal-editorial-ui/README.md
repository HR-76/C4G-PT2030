# F13 — execução da interface editorial mínima

Data: 2026-10-15. Veredicto: **BLOCKED**. D1–D3 aprovadas; implementação parcial, sem fecho humano. F13/016 permanece Complete; F13 integral In Progress. HEAD observado: `0cf519ea22de929d2e52d0b3edb4d72364aa6220`.

## Resultado disponível

Foram escritos adapters/contratos/projeções, helper HMAC stateless, composição sobre authoring/editorial existentes, observação de intenções, frontend de índice/draft/detalhe, seletor organizacional, ligação a step-up e envelope mínimo. A composição **não está ligada a productionComposition**: `/api/organization-profile/editorial-ui` responde 503 seguro na aplicação. Não há percurso editorial completo disponibilizado nem prova browser maker/checker desta entrega.

Para inspecionar a interface no ambiente local existente: `npm --prefix frontend run dev`, autenticar no backend local configurado e abrir `/perfil-organizacao`. O menu/seletor e indisponibilidade são visíveis; não esperar gravações enquanto B1 não for resolvido. Para reproduzir a prova PostgreSQL/HTTP parcial: `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/f13/editorial-ui-gate.ps1`. O script exige Docker, cria PostgreSQL 17 descartável em localhost:5574, usa fixtures exclusivamente sintéticas e chave aleatória em memória e remove o seu container no finally. O resultado esperado atual é FAIL em lookup, não PASS. Não utilizar produção nem colocar uma chave fixa no código.

## B1 — protocolo Central

O contrato UI pressupunha uma nova consulta root-composta de intenções sem confirmar a sua admissão no protocolo Central. `backend/src/security/authorityProtocolQueries.js` só aceita queries enumeradas, depois encaminha para `authority_api.execute`; a migration Central `009_authority_commit_guard` fecha a função e as ACLs. A nova consulta em `editorialUiRecovery.js` por organização/sujeito/operação/key não está enumerada. Prova isolada: `central-protocol-probe.log` registra `AUTHORITY_QUERY_DENIED / 42501`; a prova HTTP chega a lookup e devolve 503.

Impacto: não é possível confirmar/recuperar uma intenção pelo envelope depois de reload com o protocolo atual. As queries já disponíveis permitem observar guards pendentes por scope e depois por guardId; não permitem descobrir guards terminais pela key sem conhecer o guardId. Não basta o receipt tenant-local: é necessário provar o binding original ao sujeito e recurso. Não contornar por SELECT livre, grants amplos, memorização em processo ou ausência de receipt interpretada como rollback.

Correção mínima recomendada: contrato técnico e migration Central **aditivos**, posteriores a 009, para uma consulta root-only limitada a 100 tentativas (+ sentinela), parametrizada e vinculada a organização/sujeito/sourceOperation/key. Preservar queries anteriores; down restaura função anterior; publicar checksums/fingerprints calculados em PostgreSQL, testes de ACL/transitividade/admissão/cadeia cumulativa. Não modificar 009 ou tenant 016. Depois ligar a composição ao bootstrap apenas sob capability/configuração admitidas. Desenho registado também no final da especificação; nenhuma migration foi escrita nesta entrega.

Na criação o guard existente protege PROFILE_SCOPE/organizationId; o draftId não está em protected_operations. Receipt correlacionado prova a criação; sem ele não se inventa uma associação draft/revisão a partir do hash. O lookup parcial conserva UNKNOWN quando não pode provar essa associação. Isto é distinto do bloqueio de admissão B1.

## Verificações efetivas

| Comando / prova | Resultado |
|---|---|
| `docker info --format '{{.ServerVersion}}'` | Disponível, 29.7.2 |
| `npm --prefix backend test` | 768/768 PASS; inclui tokens, contratos e adaptação HTTP GET novos |
| `npm --prefix frontend test -- --reporter=dot` | 31/31 PASS, 4 ficheiros; cobertura editorial ainda limitada a organização ausente, indisponibilidade e envelope |
| `npm --prefix frontend run build` | PASS; aviso de chunk superior a 500 kB, sem erro de build |
| `editorial-ui-gate.ps1` | FAIL em POST intentions/lookup 503; fases anteriores A/B comprovadas no log |
| Fases HTTP UI antes de B1 | Criar 201, ler 200, editar 200, catálogo/listagem 200, submeter 201, maker bloqueado na projeção, checker aprovar 201, token renovado + mesma key devolvem mesma versão, publicar 200/active=false; leitura cruzada 404 em A/B; respostas verificadas sem campos de digests/autoria/policy/evidência |
| Fingerprint tenant 016 em A/B | `bc47c3c859f9790136b70dc40d1159978f2f30ce80ffb124ec6522b546a6ea5a`; up/down vazio retorna 015 em ambas as bases |
| Primeira execução exploratória com probes do domínio fechado | Probes SECURITY_MIXED_CAS_F7_RECOVERY e TEMPORAL exact/after/already-expired/valid PASS; execução global não passou a fase UI. Não confundir com gate completo PASS |
| `test/integration/ubi/private-opportunity-gate.ps1` | PASS: Central/A/B, Chrome, consulta/edição/criação/arquivo, CAS, idempotência, rollback F7, reconciliação, revogação, ACLs e cadeia 012→014→015→016→012→014→015→016; OIDC externo não exercitado |
| Sintaxe e whitespace do recorte | node --check em 17 ficheiros JS alterados PASS; build valida JSX; git diff --check do recorte PASS; verification.json lista ficheiros |

Falhas intermediárias corrigidas: GET Express fornecia query de prototype null à canonicalização estrita (agora o adapter constrói objeto simples); contexto/pending usavam consultas Central novas evitáveis (pending agora usa o protocolo existente; nome vem do contexto organizacional autenticado). O teste F2 antigo proibia qualquer sessionStorage; foi atualizado apenas para a exceção D3 aprovada, mantendo proibição global de localStorage, sessionStorage fora do módulo dedicado e teste comportamental que recusa tokens, MFA, conteúdo, digests, roles e grants no envelope. Não foi relaxado o protocolo Central para fazer o gate passar.

Revisão local adicional: limite de três reconsultas/30 s e timeout, limpeza de storage sem impedir logout, receipt confirmado separado de falha da releitura e erro de step-up apresentado à pessoa. Componentes/build repetidos após essas correções.

## Limites e trabalho restante

- B1 impede recuperação completa e ligação segura ao bootstrap; chave dedicada/configuração multi-réplica ainda não ligada a env de produção.
- Browser editorial real maker/checker A/B, step-up OIDC, negativos completos de MFA/SoD/revogação, referências cruzadas, rollback/commit incerto via novos adapters, preservação de material misto pela nova UI e acessibilidade completa **não comprovados**. Os testes existentes do domínio não substituem estas provas.
- A matriz integral UI-01–UI-13 não está concluída. Nenhum claim READY_FOR_HUMAN_REVIEW.
- Staging, produção, IdP externo, dados institucionais reais e SLO fora da validação. Sem ativação, READY, matching/F14, overlays ou migração UBI.

## Snapshot e preservação

`baseline-hashes.json` contém hashes antes desta tarefa, incluindo residual. `tested-snapshot.json` identifica ficheiros atuais de código/testes e respetivos SHA-256; `verification.json` contém recorte alterado, checks e comparação com baseline. Logs são locais e não contêm credenciais; os segredos dos fixtures foram gerados em memória. Artefactos de F13/016 não foram reescritos. Nenhum stage, commit, push ou deploy; HEAD preservado e índice sem alterações staged.
