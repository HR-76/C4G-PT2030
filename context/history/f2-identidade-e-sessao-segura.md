# Trabalho Atual

## Feature e estado

- Feature-mãe: Fundação de Segurança, Privacidade e Auditoria.
- Fase ativa: F2 — Identidade e sessão segura.
- Tipo: implementação de identidade e sessão segura; migrations criadas mas não executadas.
- Estado: Complete — fecho documental aprovado em 2026-10-05. Os oito findings da ronda coordenada foram implementados, o gate descartável versionado concluiu 10/10 e a revisão final paralela não encontrou findings bloqueantes, altos ou médios. `SEC-AC-01`–`SEC-AC-04` permanecem `partial` por dependerem ainda do rollout no ambiente alvo e das integrações futuras F3/F5.
- Especificação: `context/features/security-privacy-and-audit-foundation.md`.

## Fecho confirmado de F1

F1 — Fundação de testes está concluída e integrada em `main` pelo merge commit `d3359e7`.

Evidência registada:

- existe um comando canónico `npm test` no backend, baseado em `node:test`;
- a aplicação Express pode ser construída sem efeitos de arranque;
- o entrypoint de produção mantém listener, bootstrap e schedulers por composição explícita;
- existem fixtures sintéticas de duas organizações e doubles para identidade, base central, tenant, R2, Resend e relógio;
- a matriz versionada contém exatamente `SEC-AC-01`–`SEC-AC-23` e atribui cada critério a uma fase;
- o baseline limitado de `SEC-AC-20` permanece corretamente marcado como `partial`;
- os 12 testes automatizados do backend e as verificações sintáticas dos ficheiros JavaScript alterados passaram antes do merge.

Este fecho não declara conformidade dos critérios atribuídos a F2–F10.

## Registo de implementação F2

- `openid-client` executa discovery, Authorization Code Flow, PKCE e validações OIDC; a aplicação não implementa criptografia nem validação de protocolo próprias.
- `express-session` e `connect-pg-simple` mantêm sessão server-side; o cookie contém apenas o identificador assinado da sessão e usa a política aprovada em produção.
- `csrf-sync` implementa synchronizer token ligado à sessão; origem e `Referer` são validados antes de mutações.
- OIDC, sessão, CSRF, logout e step-up foram isolados em adaptadores/controllers injetáveis e compostos apenas quando `AUTH_MODE` é `oidc` ou `transition`.
- A compatibilidade JWT permanece apenas nos modos explícitos `legacy` e `transition`; no modo `oidc` o middleware não aceita fallback Bearer.
- O frontend usa cookie same-origin e token CSRF mantido apenas em memória; `localStorage`, `sessionStorage` e headers Bearer foram removidos do código frontend.
- Tokens Keycloak não são persistidos na sessão, cookie, frontend, URL, logs ou migration; apenas claims validadas e metadados mínimos de assurance entram na sessão.
- A baseline durável de identidade central está separada em `000_central_identity_baseline.up.sql`; as migrations `001_f2_oidc_sessions.up.sql` e `.down.sql` tratam exclusivamente sessões e nunca eliminam utilizadores, identidades ou privilégios. Foram executadas apenas contra PostgreSQL central descartável pelo runner versionado; nenhuma migration foi executada contra a base UBI ou qualquer ambiente real.
- A matriz SEC marca `SEC-AC-01`–`SEC-AC-04` como `partial`: existe cobertura automatizada e integração descartável real com Keycloak/PostgreSQL/Chrome/nginx, mas a revisão final e as condições de rollout continuam obrigatórias antes de qualquer promoção.
- Não houve configuração ou alteração de Keycloak, VPS, reverse proxy, bases reais ou outros fornecedores.

## Correções após revisão F2

- Step-up conserva `issuer` e `subject` validados na sessão e exige correspondência exata antes de elevar assurance.
- Transações OIDC têm registo central efémero e consumo atómico por `sid`/`state`, impedindo replay e consumo concorrente duplicado.
- A política de assurance tem schema estrito, categorias canónicas, limites de recência, tipos obrigatórios e allowlists exatas de `acr`/`amr`; configuração ausente ou inválida impede o arranque OIDC.
- Login privilegiado exige `auth_time` válido e recente segundo a categoria versionada configurada.
- `oidc` publica apenas endpoints OIDC; `legacy` publica apenas autenticação local; `transition` publica OIDC e aceita somente Bearers legados já emitidos nas rotas de negócio.
- No modo `transition`, o Bearer é validado antes da decisão CSRF, nunca dispensa CSRF quando existe sessão cookie e credenciais simultâneas são recusadas.
- A migration foi removida do namespace UBI e movida para `backend/database/central/migrations/`, com precondição técnica `c4g_database_identity`, criação estrita sem `IF NOT EXISTS` e rollback explícito.
- Sessões têm metadados normalizados por `sid`, `global_user_id`, estado e versão de revogação; existe revogação individual, por utilizador e limpeza de expiradas sem pesquisar JSON.
- Logout limpa sempre o cookie, tenta revogar metadados e destruir o store e devolve `503 LOGOUT_INCOMPLETE` com evento de reconciliação quando a persistência falha.
- `Origin` malformado é recusado sem fallback; `Referer` só é considerado quando `Origin` está ausente.
- Return paths rejeitam URLs absolutas, backslashes, control characters, separators codificados e normalizações ambíguas.
- `PUBLIC_APP_URL` não HTTPS impede o arranque de produção.
- A comparação interna de tokens em `csrf-sync@4.2.1` usa igualdade JavaScript e permanece registada como risco residual baixo; esta correção não cria criptografia nem protocolo CSRF próprios.
- Permanecem documentados e fora de F2: tradução final de `platformRoles` para autorização em F5, revogação por membership em F3 e catálogo definitivo de ações sensíveis em F5/D11.

## Correções após segunda revisão F2

- A rotação associa o SID novo e revoga o SID anterior numa única transação do registry; falha da associação destrói compensatoriamente a sessão já gravada no store e devolve `503`.
- A expiração absoluta atualiza o registry e destrói o store; falha parcial devolve `503 SESSION_EXPIRY_INCOMPLETE` sem permitir acesso.
- Indisponibilidade do registry durante validação ou consumo da transação OIDC produz resposta fail-closed `503`, sem ser apresentada como falha de protocolo OIDC.
- O catálogo publicado pela API reflete os endpoints realmente montados em `legacy`, `oidc` e `transition`.
- A interface OIDC deixou de oferecer alteração local de password; credenciais, MFA e recuperação permanecem no serviço de identidade C4G.
- O header `Origin` só é aceite quando contém exatamente uma origem, sem path, query, fragmento ou normalização permissiva; `Referer` mantém o fallback estrito aprovado.
- Foram adicionadas regressões sintéticas para rotação, compensação após falha do registry, indisponibilidade na validação, catálogo por modo e `Origin` sintaticamente inválido.

## Correções da revisão paralela F2

- `validateSession` é uma única operação SQL condicional e atómica, com atualização de `last_seen_at` e `RETURNING` apenas quando sessão, utilizador, versão e expiração são válidos.
- Migrations e queries centrais qualificam explicitamente o schema `public`; identidade central e sessões têm ciclos de migration separados e os rollbacks preservam integralmente identidade e privilégios.
- Logout não depende de `authenticate`: limpa sempre o cookie e tenta revogação do registry e destruição do store, devolvendo reconciliação quando qualquer persistência falha.
- Nos modos `oidc` e `transition`, os três tempos de segurança são obrigatórios e estritamente positivos; o redirect pós-logout tem de usar a origem exata de `PUBLIC_APP_URL`.
- A API não agenda `expireSessions`. Antes do cutover é obrigatório existir um worker separado que invoque periodicamente `expireSessions`, monitorize falhas e reconcilie registry/store; até esse worker estar operacional, não existe limpeza periódica operacional.
- Os testes verificam os routers Express efetivamente montados por modo, expiração completa e falhas independentes de registry/store, credenciais Bearer e sessão simultaneamente válidas, SQL atómico e rollback não destrutivo.

## Decisão e correções após revisão especializada

- A política de logout degradado do MVP foi aceite e registada em `context/decisions/degraded-logout-policy.md`: limpa cookie, devolve sempre `503 LOGOUT_INCOMPLETE` quando a revogação persistente falha, mantém autenticação fail-closed, tenta logout Keycloak e exige retry, aceitando explicitamente o risco residual de uma cópia previamente roubada do cookie sem introduzir armazenamento secundário.
- A composição usa pools distintos: `legacyPool` para rotas, health check, bootstrap e jobs do piloto; `centralPool`, configurado exclusivamente por `CENTRAL_DB_*`, para identidade, OIDC, registry e session store. O bootstrap automático permanece exclusivamente legado e migrations centrais nunca são executadas no arranque.
- O arranque OIDC/transition normaliza host, porta e nome das duas configurações e recusa destinos central/legado iguais, mesmo quando os objetos `Pool` são distintos.
- A baseline central `000` é declarada irreversível e o seu `down` aborta, impedindo que um runner convencional remova o ledger e tente reaplicar os `CREATE` estritos.
- Os testes F2 passam a provar rotação entre SIDs diferentes, invalidação do SID anterior, token CSRF adulterado e reutilizado entre sessões, predicados críticos da validação SQL e catálogo HTTP publicado por modo.
- A matriz bloqueia `SEC-AC-01`–`SEC-AC-04` em `partial` até existir um gate de integração descartável real.
- Em logout degradado, a API mantém o `503`, inclui `retryRequired` e o URL de logout Keycloak; o cliente limpa o estado local e navega para o IdP, sem converter a resposta em sucesso. O retry posterior não elimina o risco residual aceite do SID anterior.

## Evidência de validação F2

- Gate descartável F2 concluído em 2026-10-05 com 10/10 verificações: (1) login password+TOTP; (2) `acr=c4g-loa2` e `amr` com `otp`; (3) sessão, registry e store persistentes após restart por PID real; (4) CSRF ausente, inválido e de outra sessão recusados com HTTP `403`, resposta sem detalhes internos e sem efeitos; (5) `Origin` não autorizado recusado com `403` e persistência inalterada; (6) ACR isolado e AMR isolado recusados; (7) versão de política divergente recusada; (8) step-up expirado exigiu password e OTP; (9) SID novo distinto e SID anterior revogado como `SESSION_ROTATED`; (10) logout revogou metadata, removeu store e a sessão deixou de ser reutilizável.
- O gate usou Chrome local sem `ignoreHTTPSErrors`, CA mkcert copiada apenas para `.tmp`, `NODE_EXTRA_CA_CERTS` definido antes dos processos Node, contextos Chrome independentes para sessões distintas e fetch autenticado exclusivamente dentro do browser. Nenhum cookie, password, TOTP, token ou segredo foi registado na evidência.
- A política descartável foi versionada como `f2-integration-stepup-v1` com janela `recent-mfa=2s`, alinhada ao LoA2 Keycloak descartável, para provar expiração/reauth sem alterar política de produção. O lifecycle direto `node src/server.js` e o teardown usaram metadata/PID real validado, nunca seleção destrutiva por porta.
- `SEC-AC-01`–`SEC-AC-04` permanecem `partial` até à revisão focada com subagentes, conforme decisão anterior. O teardown final removeu containers, volumes, perfil Chrome, CA copiada, certificados, logs, metadata, Playwright e segredos descartáveis.

- Decisão de gate aprovada em 2026-10-05: negativos CSRF exigem HTTP `403`, resposta sem detalhes internos e ausência comprovada de efeitos para token ausente, inválido e pertencente a outra sessão. O gate não exige `code=CSRF_INVALID` no JSON e o error handler de produção não será alterado por esta decisão.

## Ronda coordenada de findings F2

- Sessão/logout: prova CSRF HMAC ligada ao SID, recuperação estritamente limitada a CSRF/logout após falha de leitura do store, logout federado tentado e cookie limpo sem dispensar Origin ou CSRF; sessões com versão de política ausente ou divergente falham fechado antes do registry.
- Health/bases: readiness agrega legacy e central, responde `503` sanitizado quando qualquer dependência obrigatória falha e o arranque valida marcador e identidade observada do servidor antes do bootstrap/listener, rejeitando aliases para a mesma instância.
- Gate/migrations: migrations centrais têm manifest allowlisted, checksum, ledger, advisory lock e transação; `000` é irreversível e apenas `001` aceita rollback. O lifecycle versionado usa processos Node diretos, PID/instante/comando validados e nunca termina processos escolhidos apenas pela porta.
- OIDC/testes: `openid-client` ativa validação criptográfica de assinatura; testes locais usam RSA/JWKS/JWT reais para nonce, issuer, audience, assinatura e state; negativos CSRF observam diretamente zero efeitos.
- O runner permanente `test/integration/f2/run-gate.ps1` prepara infraestrutura e segredos descartáveis, executa migrations forward/rollback/re-forward, instala `playwright-core` apenas sob `.tmp`, corre o gate Chrome 10/10 e faz teardown em `finally`.
- A primeira revisão final desta ronda detetou lacunas reais no vínculo versão/mapa de assurance, identidade física PostgreSQL, integridade do rollback/readiness, validação do lifecycle, fidelidade dos negativos de assurance, Origin credenciado e logout federado/degradado. Todas foram corrigidas antes de fixar o novo snapshot.
- A política de assurance está agora ligada a um manifesto reconhecido por versão; drift de conteúdo sob a mesma versão impede o arranque. A topologia compara `system_identifier` observado do cluster, além de endereço/porta, e a central só fica healthy com marker, ledger/checksums e relações obrigatórias intactos.
- O rollback de `001` valida primeiro checksums e flags de `000`/`001`. O lifecycle vincula metadata a executável, argumentos, cwd, instante e owner do listener segundo especificação imutável; o teardown tenta processos e Docker independentemente, preservando metadata se não puder comprovar a limpeza.
- O gate final usa uma segunda origem HTTPS com a sessão Chrome real, JWT/JWKS RSA locais no controller real para ACR/AMR incompletos, rota autenticada para drift de versão, TOTP explicitamente apresentado, logout federado navegado no browser e falha real das relações registry/store para o contrato degradado.
- A correlação do teste de Origin usa um marcador público próprio no access log sanitizado; o scan cobre todos os níveis de consola e todos os segredos gerados. Mesmo se o teardown falhar, `.env`, passwords, TOTP, CA/certificados/chave, Playwright e logs são removidos, preservando apenas metadata de controlo necessária a nova tentativa segura.
- A implementação e validação desta ronda terminaram: `npm test` passou 77/77, `node --check` passou nos 31 ficheiros JavaScript alterados/criados, o build frontend passou, `git diff --check` passou, o runner de migrations provou forward/rollback/re-forward, drift recusado e preservação da baseline, e o gate descartável reforçado passou 10/10.
- A revisão final paralela de segurança, arquitetura e testes não encontrou findings bloqueantes, altos ou médios. O único finding baixo consolidado é que uma invocação manual de `down.ps1` numa shell PowerShell duradoura conserva as variáveis no ambiente desse processo até ele terminar; o runner normal termina o processo imediatamente e todos os ficheiros/recursos descartáveis são removidos. A matriz SEC continua deliberadamente `partial` pelos limites de rollout e F3/F5, não por defeito F2 conhecido neste snapshot.

- Em 2026-10-05, o lifecycle descartável passou num canário independente em duas fases: a API foi lançada diretamente como `node src/server.js` com `spawn(detached:true, windowsHide:true)`, cwd/env/CA explícitos, logs separados e metadata sem segredos; o runner fechou handles e fez `unref()`. Um segundo processo confirmou PID vivo, comando, instante, listener, `/health/db` e sessão Chrome persistente.
- Na repetição integral, os testes 1–3 passaram: password+TOTP, `acr=c4g-loa2`/`amr` com `otp`, e sessão/registry/store persistentes após restart por PID real. O gate parou no teste 4: os pedidos sem CSRF e com CSRF inválido foram recusados, mas a assertion exigia também `code=CSRF_INVALID`; o error handler HTTP atual serializa apenas `message` e descarta `err.code`, pelo que o contrato observado não contém esse código estável.
- Os testes 5–10 não foram executados. Esta falha já não pertence ao lifecycle do runner; a próxima decisão é se o gate deve exigir apenas HTTP `403` para estes negativos ou se o contrato HTTP de produção deve preservar códigos de erro de middleware. O teardown usou exclusivamente o PID real validado no ficheiro de controlo e removeu logs, metadata, perfil Chrome, CA e segredos.

- Em 2026-10-05, o canário específico de restart passou todos os controlos pedidos: terminou apenas a árvore do PID guardado, confirmou processo antigo terminado e porta `5000` livre, arrancou PID diferente com a mesma configuração/CA, confirmou processo vivo, listener, `/health/db=200`, sessão Chrome `200` com a mesma identidade e persistência do registry/store.
- A repetição integral passou novamente os testes 1 e 2, mas parou no teste 3 antes de reiniciar: o wrapper PowerShell criado pelo canário tinha terminado depois de o processo do runner ser encerrado, embora o filho `node.exe` continuasse a escutar `5000`; o PID guardado estava morto e o listener ainda tinha esse PID como parent original. O runner recusou corretamente procurar ou matar processos pela porta.
- A causa é o lifecycle do processo lançado pelo canário (`detached:false` e handle ainda referenciado quando o runner foi terminado), não a persistência da aplicação. Correção mínima: lançar a API de substituição em grupo destacado, fechar os handles de log e executar `unref()` apenas depois do readiness; confirmar novamente que o wrapper guardado permanece vivo após o canário terminar antes de iniciar o gate. Testes 4–10 não foram executados; teardown integral efetuado.

- Em 2026-10-05, o canário corrigido arrancou Node/Playwright com `NODE_EXTRA_CA_CERTS` definido antes do processo, concluiu password+TOTP e obteve `/api/auth/session=200` via `fetch` dentro do Chrome para o administrador sintético, sem cookies/tokens nos logs.
- No gate reiniciado, os testes 1 e 2 passaram novamente: login password+TOTP e evidência persistida `acr=c4g-loa2` com `amr` contendo `otp`. O gate parou no teste 3: o helper de restart matou a árvore da API e lançou imediatamente o novo wrapper, mas este terminou e a porta `5000` ficou sem listener; a base central conservava duas sessões registry/store, logo a falha foi do mecanismo descartável de restart e não perda da sessão PostgreSQL.
- Os testes 4–10 não foram executados. Correção mínima do runner: depois de terminar a árvore da API, aguardar explicitamente a libertação da porta `5000`, iniciar a API com stdout/stderr sanitizáveis e só então aguardar readiness; não considerar polling da sessão suficiente quando o processo já terminou. O teardown removeu ambiente, CA copiada, Playwright e segredos.

- Em 2026-10-05, o harness descartável foi corrigido para copiar `rootCA.pem` do CAROOT mkcert para `.tmp/f2-integration`, definir `NODE_EXTRA_CA_CERTS` com o caminho absoluto antes de iniciar a API e manter `localhost.crt`/chave exclusivamente no nginx. Não foram usados `NODE_TLS_REJECT_UNAUTHORIZED=0` nem `ignoreHTTPSErrors`.
- As quatro pré-verificações passaram: discovery pelo runtime Node com a CA configurada devolveu `200`; `GET /api/auth/oidc/login` devolveu `302`; nginx registou o pedido ao authorization endpoint e Keycloak respondeu `200`; Chrome apresentou o formulário de login.
- O gate parou no primeiro teste após a navegação de login: o `APIRequestContext` interno do Playwright, executado noutro processo Node sem `NODE_EXTRA_CA_CERTS`, falhou ao consultar `/api/auth/session` com `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. O browser Chrome usou corretamente o trust store normal; a falha pertence ao cliente HTTP auxiliar do runner, não ao redirect já corrigido.
- Por instrução, os testes seguintes não foram executados nem declarados válidos. A correção mínima para a próxima execução é iniciar também o runner Playwright com `NODE_EXTRA_CA_CERTS` apontado à cópia descartável da CA, ou efetuar as verificações HTTP dentro do próprio contexto da página; não usar bypass TLS. O ambiente, Playwright e segredos foram removidos após a falha.

- Diagnóstico focado de 2026-10-05 isolou a falha entre login e Keycloak. Antes do clique, Chrome estava em `https://localhost:8443/login` (`UBI Research`). O `GET /api/auth/oidc/login?returnTo=...` respondeu `500`, `application/json`, sem `Location`, com `{"message":"fetch failed"}`; a navegação final ficou nesse JSON e nunca atingiu o authorization endpoint.
- A causa concreta é a cadeia TLS usada pela API: após trocar o certificado self-signed por um certificado folha mkcert, `NODE_EXTRA_CA_CERTS` continuou a apontar para `localhost.crt`. Um fetch Node correlacionado ao discovery falhou com `UNABLE_TO_VERIFY_LEAF_SIGNATURE` e indicou que a CA raiz local não estava disponível ao processo Node. O nginx registou o `500`; Keycloak arrancou normalmente mas não recebeu pedido de autorização.
- Issuer, authorization endpoint e redirect URI usam todos `https://localhost:8443`, acessível pelo browser host, sem nomes Docker. O certificado apresentado cobre exatamente `localhost`, `127.0.0.1` e `::1`. Os erros HMR Vite observados são incidentais e não causam o `500` OIDC.
- Correção mínima recomendada, não aplicada neste diagnóstico: apontar `NODE_EXTRA_CA_CERTS` para o `rootCA.pem` do mkcert antes de iniciar a API (ou iniciar Node com suporte explícito à CA do sistema), mantendo o certificado folha apenas no nginx. Depois repetir somente a navegação até confirmar o `302` para o authorization endpoint.

- Em 2026-10-05, `playwright-core` foi instalado exclusivamente sob `.tmp/playwright-runner`, sem alterar manifests/lockfiles, e o gate foi recriado com Chrome local, trust store normal do Windows e `ignoreHTTPSErrors` desativado.
- O ponto 1 falhou: depois de o Chrome abrir `https://localhost:8443/login` e acionar “Continuar com Keycloak”, o formulário Keycloak não apresentou `#username` em 30 segundos (`locator.fill: Timeout 30000ms exceeded`). Password, segredo/código TOTP e cookies não foram impressos.
- Por instrução explícita, o gate parou nessa primeira falha. Login, claims, persistência, negativos CSRF/Origin/assurance, step-up, rotação e logout não foram declarados validados nesta execução; `SEC-AC-01`–`SEC-AC-04` permanecem `partial`.
- Containers, volumes, portas, runner Playwright e todos os segredos descartáveis foram removidos após o bloqueio.

- Em 2026-10-05, a tentativa de gate interativo via Playwright parou na pré-condição: Chrome e Edge locais estavam disponíveis e `https://localhost:8443/` respondeu `200` através do trust store normal do Windows, mas não existia `playwright`, `playwright-core` nem `@playwright/test` instalado no projeto/runtime. Por instrução explícita, nenhuma dependência foi instalada e nenhum fluxo interativo foi iniciado.
- Nenhum dos dez cenários pedidos nesta tentativa foi marcado como validado. `SEC-AC-01`–`SEC-AC-04` permanecem `partial`; o ambiente, volumes e segredos descartáveis foram removidos após o bloqueio.

- Em 2026-10-05, a nova execução integral do gate criou com sucesso Keycloak `26.8.0`, PostgreSQL central e legacy separados, nginx HTTPS, API e frontend, exclusivamente com segredos sob `.tmp/f2-integration` ignorado por Git. O endpoint de sessão respondeu `401` conforme esperado antes do login.
- A inspeção antes do bloqueio confirmou containers e portas distintos (`central` em `5441`, `legacy` em `5442`), `application_session` e `oidc_transaction` apenas na base `c4g_central` e ausência dessas tabelas na base `c4g_legacy`; as migrations centrais estavam montadas exclusivamente no serviço central.
- O gate parou antes do login por indisponibilidade das duas superfícies de browser autorizadas: Computer Use Windows devolveu `Trusted RPC service is not configured: sky` e o browser isolado devolveu `Browser is not available: iab`. Sem browser não é possível comprovar password+TOTP, claims reais, callback, persistência, CSRF, step-up, rotação e logout nos termos pedidos.
- Por instrução explícita, nenhum subagente foi iniciado e nenhuma verificação posterior foi tratada como concluída. `SEC-AC-01`–`SEC-AC-04` permanecem `partial`. O ambiente descartável foi desmontado após registar o bloqueio.

- A fronteira PostgreSQL converte agora epochs finitos para `Date` válida antes das queries de transação OIDC, binding/rotação e validação de sessão; valores inválidos falham antes de `pool.query`. O registry in-memory conserva epochs numéricos.
- Os testes dirigidos comprovam instância `Date`, preservação exata do instante, rejeição antecipada de `NaN`, infinito e datas fora do intervalo, e preservam o teste concorrente do registry in-memory.
- Na repetição descartável, o login Authorization Code com PKCE, `state` e `nonce` concluiu contra Keycloak; o callback devolveu `302`, o cookie `__Host-` foi emitido com `Secure`, `HttpOnly` e `SameSite=Lax`, o SID mudou e a sessão persistiu após restart da API.
- PostgreSQL central e legado ficaram em containers, portas, volumes e credenciais diferentes. As tabelas centrais/F2 existiam apenas na central e as tabelas legado apenas na base legado.
- O Keycloak descartável validou password e TOTP do administrador sintético. Contudo, o ID token real apresentou `auth_time` e `acr=0`, mas não publicou `amr`, apesar do mapper AMR; a APP recusou corretamente o login privilegiado com `MFA_EVIDENCE_INSUFFICIENT`.
- A integração completa ficou interrompida neste gate: é necessário configurar e versionar referências AMR nos executions do authentication flow do realm descartável antes de repetir MFA/step-up e os restantes cenários. A revisão paralela não deve começar antes disso.
- O script declarativo descartável passou a criar `f2-browser` com LoA 1/password e LoA 2/OTP, referências AMR nas executions, mapa `c4g-loa1`/`c4g-loa2`, client scope AMR e ACR mínimo/default `c4g-loa2`. O realm vazio aceitou a configuração e o login privilegiado concluiu com `auth_time` recente e `acr=c4g-loa2`.
- A decisão F2-D3 passou a reconhecer `c4g-loa2` como nível autoritativo e `otp` como método cumulativamente obrigatório. `pwd` deixou de ser exigido no AMR porque o mapper oficial só publica executions preservadas; ACR ou AMR isolados continuam insuficientes e versões divergentes falham fechado.
- Apesar das referências `pwd` e `otp`, o ID token validado pela aplicação continha apenas `amr=["otp"]`. O mapper oficial lê a nota de executions concluídas, e a promoção para LoA 2 não conservou a password do LoA 1 nessa nota. A decisão agora reconhece esta semântica sem claims inventados: o gate deve ser repetido exigindo cumulativamente `acr=c4g-loa2`, `otp`, recência e versão reconhecida.

- Em 2026-10-05 foi criado um ambiente local descartável com PostgreSQL central e legado fisicamente separados, Keycloak 26.8.0, API, frontend e reverse proxy HTTPS. As bases e identidades eram exclusivamente sintéticas e os segredos ficaram sob `.tmp/`, ignorada por Git.
- A central descartável recebeu apenas a baseline central e a migration F2; a base legado recebeu apenas o bootstrap legado. Nenhuma base real ou UBI foi contactada.
- O discovery real do realm Keycloak e o proxy HTTPS responderam; `GET /api/auth/session` devolveu o `401 SESSION_REQUIRED` esperado sem sessão.
- O primeiro `GET /api/auth/oidc/login` devolveu `500`: `registerOidcTransaction` enviou `expiresAt` como epoch em milissegundos para `public.oidc_transaction.expires_at`, produzindo `date/time field value out of range`. O fluxo parou antes do redirect, logo login, callback, persistência, SID, MFA, CSRF autenticado, logout, revogação e expiração não ficaram comprovados por integração.
- O browser controlado pedido não estava disponível no ambiente (inventário de browsers vazio); não foi contornado o aviso do certificado self-signed.
- O teardown descartável removeu containers, volumes e segredos locais. A correção recomendada é normalizar `expiresAt` para `Date` no adaptador PostgreSQL, cobrir a fronteira de tipos com teste e repetir integralmente este gate.

- `npm test` no backend: 59 testes passaram, incluindo preservação de F0/F1, separação dos pools central/legado e regressões sintéticas das correções F2.
- `node --check`: passou nos 16 ficheiros JavaScript alterados/criados.
- `npm run build` no frontend: passou; permanece apenas o aviso preexistente de chunk superior a 500 kB.
- `git diff --check`: passou; apenas foram reportados avisos de normalização futura LF/CRLF.
- A validação posterior à decisão de logout degradado e correção dos findings 2–8 repetiu com sucesso `node --check` nos oito ficheiros JavaScript alterados/relevantes, os 59 testes backend, o build frontend e `git diff --check`; o build manteve apenas o aviso preexistente de chunk superior a 500 kB.
- `npm audit --omit=dev`: executado e terminou com 6 vulnerabilidades já presentes na árvore base — `body-parser`/`qs` via Express, `multer`, `node-cron`/`uuid` e `xlsx`; nenhuma pertence às quatro dependências introduzidas por F2. Há 1 baixa, 3 moderadas e 2 altas; `xlsx` não tem correção disponível no registry indicado.
- As dependências F2 instaladas são as versões atuais consultadas durante a implementação: `openid-client@6.8.8`, `express-session@1.19.0`, `connect-pg-simple@10.0.0` e `csrf-sync@4.2.1`.

### Mapa SEC-AC-01 a SEC-AC-04

| Critério | Estado | Evidência automatizada | Evidência externa ainda necessária |
| --- | --- | --- | --- |
| `SEC-AC-01` | `partial` | callback PKCE real contra Keycloak 26.8.0 cria sessão PostgreSQL server-side, emite cookie `__Host-`, sobrevive a restart validado e não expõe tokens no browser/logs | revisão final focada e validação do rollout no ambiente alvo |
| `SEC-AC-02` | `partial` | Keycloak real cobre state, code/replay e PKCE; RSA/JWKS/JWT locais reais recusam nonce, issuer, audience e assinatura inválidos sem criar sessão | revisão final focada e operação de rotação de chaves no ambiente alvo |
| `SEC-AC-03` | `partial` | Chrome/nginx HTTPS real comprovam cookie seguro, rotação, CSRF ausente/inválido/cross-session e Origin não autorizado com ausência direta de efeitos | revisão final focada e configuração de origins por ambiente antes do rollout |
| `SEC-AC-04` | `partial` | flow Keycloak real comprova password+TOTP, `acr=c4g-loa2`, `amr` com `otp`, recência, negativos isolados, divergência de versão, step-up e SID novo | revisão final focada e integração posterior da política organizacional com F3/F5 |

## Objetivo concreto de F2

Definir e preparar a fundação de autenticação e sessão aplicacional para substituir o login/JWT legado por OIDC Authorization Code Flow com PKCE através do Keycloak C4G, com sessão server-side identificada por cookie seguro, validação rigorosa do callback, rotação contra fixation, proteção CSRF e MFA conforme política, sem implementar ainda revogação de membership, troca de organização, autorização funcional ou isolamento multi-tenant.

## Critérios de aceitação abrangidos

F2 é responsável exclusivamente pelos seguintes critérios da matriz SEC:

1. **SEC-AC-01:** login OIDC válido conclui Authorization Code com PKCE e cria sessão por cookie seguro, sem expor tokens ao storage JavaScript, URL ou logs.
2. **SEC-AC-02:** callback com `state`, `nonce`, issuer, audience, redirect URI ou código inválido é recusado sem criar sessão.
3. **SEC-AC-03:** fixation é impedida por rotação do identificador nos limites aprovados; pedidos mutáveis sem prova CSRF válida são recusados.
4. **SEC-AC-04:** perfis privilegiados e ações sensíveis exigem MFA segundo a política aplicável.

Os critérios continuam `pending` durante este load. Só podem mudar de estado com implementação e testes automatizados correspondentes.

## Estado atual do legado

- A SPA React/Vite guarda token e utilizador em `localStorage`.
- A API Express usa JWT com duração de oito horas.
- Os perfis globais `ADMIN` e `PROFESSOR` fazem parte do modelo de acesso atual.
- Credenciais e autenticação ainda não são geridas por Keycloak.
- Não existe sessão aplicacional central conforme o modelo futuro nem cookie `HttpOnly`, `Secure` e `SameSite` aprovado.
- Não existe fluxo OIDC Authorization Code com PKCE nem validação documentada de `state`, `nonce`, issuer, audience e redirect URI.
- A desativação ou despromoção de um utilizador não revoga imediatamente o JWT já emitido.
- O piloto usa uma única base PostgreSQL e não tem organizações/memberships globais nem isolamento multi-tenant.

Estes factos são evidência de migração e não arquitetura aprovada.

## Âmbito de preparação, implementação e migração

### Preparação — âmbito atual autorizado

- fechar as decisões F2-D1 a F2-D3 abaixo;
- documentar contratos, limites de confiança, estados e cenários negativos de `SEC-AC-01`–`SEC-AC-04`;
- identificar dependências de Keycloak, base central, reverse proxy/HTTPS, frontend, API e harness de testes;
- produzir posteriormente um plano de implementação e migração, sujeito a aprovação própria;
- manter F2 em `Draft` até as decisões bloqueantes estarem aprovadas.

### Implementação — fase futura, não autorizada

- integrar Keycloak/OIDC/PKCE;
- criar o mecanismo de sessão aplicacional e cookies;
- implementar callback, rotação, CSRF, MFA/step-up e respetivos testes;
- alterar frontend, API, configuração, dependências, schema ou infraestrutura.

### Migração — fase futura, não autorizada

- mapear utilizadores legados para `global_user` e `auth_identity_ref` sem migrar passwords para a aplicação;
- resolver duplicados de email, estados e correspondências de identidade por processo validado;
- descontinuar login, recuperação e tokens legados apenas após compatibilidade, reconciliação e rollback aprovados;
- remover tokens de `localStorage` e invalidá-los no cutover;
- preservar evidência e manter o legado read-only quando o plano de cutover assim o determinar.

## Dependências de F2

- decisão aceite `context/decisions/multi-tenant-identity-and-data.md`: Keycloak C4G, realm único inicial, OIDC Authorization Code com PKCE, base central para identidade aplicacional e sessões, sem credenciais duplicadas;
- decisão aceite `context/decisions/hosting-and-external-services.md`: reverse proxy HTTPS e serviços separados no destino;
- modelo lógico de `global_user`, `auth_identity_ref`, `application_session`, `organization` e `organization_membership`;
- F1 concluída, fornecendo harness, doubles e matriz SEC;
- disponibilidade futura de um ambiente Keycloak e dos domínios/redirect URIs por ambiente, sem os criar nesta fase;
- coordenação com F3 para revogação imediata, membership ativa e troca de organização, sem antecipar `SEC-AC-05/06` em F2;
- coordenação futura com F5 para autorização, ações sensíveis e catálogo final de permissões, sem antecipar `SEC-AC-07/08/22`.

## Decisões necessárias

### F2-D1 — Modelo e ciclo de vida da sessão

Decisão registada em `context/decisions/application-session-lifecycle.md`:

- sessões server-side persistidas na base central;
- cookie com identificador opaco e sem identidade, roles ou tokens;
- tokens Keycloak exclusivamente no servidor e protegidos em repouso;
- expirações idle e absoluta configuráveis e versionadas, sem prazos hardcoded, e renovação limitada pela expiração absoluta;
- rotação após login, callback OIDC, alteração de privilégio, autenticação recente e outros limites de confiança;
- revogação imediata por sessão, utilizador e membership/organização quando aplicável;
- logout local com invalidação da sessão e coordenação com Keycloak;
- sessões simultâneas identificáveis e revogáveis;
- metadados mínimos e auditáveis, sem tokens em logs;
- falha de validação ou estado resulta em recusa de acesso.

Estado: **aprovada em 2026-10-04**.

### F2-D2 — Cookie, CSRF, CORS e topologia de domínios

Decisão registada em `context/decisions/session-cookie-csrf-and-origin-policy.md`:

- frontend e API partilham a mesma origem pública em produção, com a API publicada sob `/api` pelo reverse proxy;
- cookie host-only com prefixo `__Host-`, `Secure`, `HttpOnly`, `Path=/`, `SameSite=Lax` e sem `Domain`;
- token CSRF associado à sessão e enviado num header próprio em operações mutáveis;
- validação estrita de `Origin` e, quando necessário, `Referer`;
- `SameSite` como defesa adicional, nunca como substituto de CSRF;
- sem CORS no fluxo normal de produção;
- desenvolvimento local limitado a origins exatas explicitamente autorizadas, sem wildcard com credenciais;
- recusa de pedidos credenciados provenientes de origins não autorizadas;
- sem origens cross-site ou cookies third-party no MVP;
- exceções do callback OIDC limitadas e validadas por `state`, `nonce` e PKCE.

Estado: **aprovada em 2026-10-04**.

### F2-D3 — MFA e autenticação recente

Decisão registada em `context/decisions/mfa-and-recent-authentication-policy.md`:

- MFA obrigatório para administradores C4G, suporte e administradores das organizações;
- cada organização pode exigir MFA a todos os membros, sem reduzir os mínimos C4G;
- autenticação recente ou MFA recente exigidos por categoria de risco, com janelas configuráveis, versionadas e externas ao código;
- catálogo definitivo de ações sensíveis remetido para F5/D11;
- step-up executado pelo Keycloak, sem MFA próprio na aplicação;
- validação server-side de `issuer`, `audience`, assinatura, `state`, `nonce`, PKCE, `auth_time`, `acr` e `amr`, conforme aplicável;
- browser, roles e flags nunca constituem prova de MFA;
- rotação do identificador da sessão depois de step-up válido;
- falha fechada perante evidência ausente, expirada, insuficiente ou ambígua;
- recuperação e alteração de fatores no Keycloak com auditoria aplicável.

Estado: **aprovada em 2026-10-04**.

## Plano de implementação de F2

Estado do plano: **implementado em F2; aguarda revisão formal e testes de integração externos**.

### 1. Preparação e refactor

- Preservar `backend/src/app.js` como factory sem efeitos e ampliar a injeção de dependências para autenticação, sessão, relógio, geração aleatória, política e auditoria, sem ligar módulos OIDC diretamente às rotas.
- Separar os handlers legados de credenciais/JWT em `backend/src/controllers/authController.js` dos novos casos de uso de login, callback, sessão, logout e step-up; manter o legado identificável durante a transição.
- Substituir gradualmente o acoplamento direto de `backend/src/middlewares/authMiddleware.js` a `jsonwebtoken` por um contrato de autenticação que receba contexto de sessão validado; não antecipar o policy engine de F5.
- Tornar explícita na composição de produção a configuração validada por ambiente para origem pública, issuer, client, redirect URIs, nomes de cookies e versões de políticas; falhar o arranque quando configuração obrigatória for inválida.
- Inventariar todas as rotas protegidas e classificá-las, para F2, apenas como leitura ou mutação e como normal ou provisoriamente sensível; roles UBI continuam evidência do legado, não modelo de autorização futuro.
- Preservar os testes de import sem efeitos, paridade de composição, retenção F0 e matriz SEC existentes.

### 2. Contratos de sessão e OIDC

- Definir interfaces para cliente OIDC, repositório de sessões centrais, proteção/armazenamento server-side de tokens, relógio, aleatoriedade, política de assurance e auditoria.
- Modelar a sessão opaca com hash do identificador, utilizador global, contexto aplicacional mínimo, estados, expirações idle/absoluta, versão de política, evidência de `auth_time`/`acr`/`amr`, timestamps e dados mínimos de auditoria; não guardar roles, memberships ou tokens no cookie.
- Definir estados e transições de sessão: tentativa OIDC, callback validado, ativa, rodada, expirada, revogada e terminada; validação incerta ou dependência indisponível falha fechado.
- Especificar os contratos HTTP de início de login, callback, `GET /api/auth/me`, logout, início/retorno de step-up e obtenção/renovação controlada da prova CSRF.
- Definir rotação atómica do identificador no login/callback, step-up, alteração de privilégio e restantes limites já aprovados, invalidando o identificador anterior.
- Planear migrations ordenadas para as estruturas centrais de identidade/sessão e respetivos índices/constraints, sem reutilizar as tabelas UBI como modelo futuro e sem escrever SQL antes da implementação autorizada.

### 3. Integração Keycloak

- Selecionar durante a implementação uma biblioteca OIDC server-side mantida e compatível com CommonJS/Node, isolada pelo contrato definido, sem construir validação criptográfica própria.
- Implementar Authorization Code Flow com PKCE gerado no servidor, correlação temporária de `state` e `nonce`, redirect URI exato e troca de código exclusivamente no backend.
- Validar discovery/configuração confiável, assinatura e algoritmo permitido, `issuer`, `audience`, tempos do token, `state`, `nonce`, PKCE e redirect URI antes de criar sessão.
- Manter access/refresh/ID tokens apenas no servidor, protegidos em repouso e ausentes de URLs, respostas ao frontend, logs, erros e eventos.
- Mapear a identidade Keycloak para `auth_identity_ref`/`global_user` e recusar identidades não reconciliadas ou utilizadores inativos; a membership e a troca de organização permanecem para F3.
- Implementar logout local com invalidação imediata da sessão aplicacional e coordenação limitada com o endpoint de logout/revogação do Keycloak, sem depender deste para concluir a invalidação local.

### 4. CSRF e validação de origem

- Emitir o cookie de sessão host-only com nome `__Host-...`, `Secure`, `HttpOnly`, `Path=/`, `SameSite=Lax`, sem `Domain`, e garantir que apenas o reverse proxy o expõe sob a origem pública.
- Criar prova CSRF ligada à sessão, não reutilizável entre sessões, disponibilizada ao frontend sem expor o identificador de sessão e exigida num header próprio em todos os métodos mutáveis abrangidos.
- Validar `Origin` por igualdade exata e usar `Referer` apenas no fallback aprovado; recusar pedidos credenciados de origem ausente onde não admissível, malformada ou não autorizada.
- Desativar CORS no fluxo normal de produção; em desenvolvimento aceitar somente a allowlist exata configurada, com credenciais e sem wildcard.
- Limitar as exceções OIDC aos endpoints e métodos necessários, protegidos por `state`, `nonce` e PKCE, sem criar bypass genérico para outras mutações.
- Aplicar a proteção antes dos controllers e testar JSON, formulários, uploads e demais mutações existentes.

### 5. MFA e step-up

- Representar política de assurance por códigos e versões externas ao código: mínimos C4G por perfil, reforço opcional por organização e categorias de autenticação recente/MFA recente.
- Validar no servidor `auth_time`, `acr` e `amr` contra o mapeamento Keycloak configurado; dados do browser e roles nunca satisfazem assurance.
- Quando a prova for insuficiente ou expirada, interromper a ação sem a executar, guardar apenas contexto de continuação seguro e iniciar step-up no Keycloak.
- No retorno, repetir toda a validação OIDC aplicável, confirmar assurance e recência, rodar a sessão e exigir nova proteção CSRF antes de permitir nova tentativa explícita da operação; não reproduzir automaticamente mutações.
- Recusar prova ausente, ambígua, incompatível com a versão de política ou impossível de validar; indisponibilidade do Keycloak não produz bypass.
- Registar eventos mínimos de login, MFA, step-up, falha, alteração/recuperação de fatores observável, rotação e logout, sem segredos ou detalhes dos fatores; o catálogo final de ações fica para F5/D11.

### 6. Migração controlada do JWT e `localStorage`

- Introduzir um modo de transição explicitamente configurado por ambiente, no qual o novo fluxo de sessão possa ser validado antes do cutover sem aceitar silenciosamente dois mecanismos na mesma decisão de acesso.
- Adaptar `frontend/src/api/api.js` para pedidos same-origin com cookie e header CSRF, removendo a construção de `Authorization: Bearer` após o cutover.
- Adaptar `frontend/src/contexts/AuthContext.jsx`, `frontend/src/pages/Login.jsx` e guards de `frontend/src/App.jsx` para bootstrap via `/api/auth/me`, redirects OIDC, estados de callback/step-up e logout server-side, sem identidade ou token persistidos no browser.
- Reconciliar previamente utilizadores UBI com `global_user` e `auth_identity_ref`, resolver duplicados/estados de forma auditável e não migrar passwords para a aplicação ou entre bases.
- No cutover, invalidar JWTs legados, remover `JWT_SECRET` e `jsonwebtoken` apenas quando nenhuma rota/script depender deles, limpar `token` e `user` legados do `localStorage` no cliente e desativar login, setup e alteração de password locais.
- Manter rollback compatível apenas até ao ponto de não retorno aprovado; nunca reativar automaticamente JWTs já invalidados nem reintroduzir passwords ou tokens no browser.

### 7. Testes e rollback

- Estender os doubles de F1 para OIDC, sessão, relógio, aleatoriedade, política e auditoria, mantendo fixtures sintéticas e sem contactar Keycloak/Neon reais na suite unitária.
- Cobrir `SEC-AC-01`: login PKCE válido, cookie exato, sessão server-side, rotação e ausência de tokens no storage, URL, respostas e logs.
- Cobrir `SEC-AC-02` com testes de tabela para `state`, `nonce`, issuer, audience, assinatura/algoritmo, redirect URI, código, PKCE e tempos inválidos, garantindo que nenhuma sessão é criada.
- Cobrir `SEC-AC-03`: fixation, token CSRF ausente/inválido/de outra sessão, `Origin`/`Referer` malformado ou não autorizado, CORS de produção e allowlist exata de desenvolvimento.
- Cobrir `SEC-AC-04`: mínimos por perfil, política reforçada da organização, categorias e janelas versionadas, prova `auth_time`/`acr`/`amr`, step-up, rotação e todos os modos de falha fechada.
- Adicionar testes de contrato HTTP e integração com um Keycloak descartável/configuração versionada antes de produção, incluindo logout, recuperação/alteração de fatores observável e indisponibilidade; não usar identidades reais.
- Executar `npm test` e `node --check` no backend, `npm run build` no frontend, testes de migração forward/rollback e `git diff --check`; manter `SEC-AC-01`–`04` como `pending` até a evidência automatizada existir.
- Fazer rollout por ambiente e coorte controlada, observar falhas sem tokens/PII, e só então executar o cutover. Antes do ponto de não retorno, rollback repõe a versão anterior e a configuração anterior preservando dados novos; depois da invalidação dos JWTs, rollback mantém a sessão segura ou suspende o acesso, nunca restaura tokens legados.

## Ficheiros e componentes previstos

| Área | Alteração futura prevista |
| --- | --- |
| `backend/src/app.js` e `backend/src/productionComposition.js` | injeção/composição de sessão, OIDC, CSRF, política e auditoria |
| `backend/src/routes/authRoutes.js` e controllers/serviços de autenticação | endpoints OIDC, sessão, logout e step-up; isolamento do legado |
| `backend/src/middlewares/authMiddleware.js` | autenticação por sessão server-side e contexto validado |
| novos adaptadores/repositórios backend | Keycloak/OIDC, sessão central, proteção de tokens e políticas versionadas |
| migrations futuras da base central | identidades, tentativas OIDC, sessões e metadados mínimos; não usar schema UBI como destino |
| `frontend/src/api/api.js` | cookie same-origin, CSRF e tratamento de sessão expirada/step-up |
| `frontend/src/contexts/AuthContext.jsx`, `frontend/src/pages/Login.jsx`, `frontend/src/App.jsx` | bootstrap de sessão e navegação OIDC sem `localStorage` |
| `backend/test/` | testes unitários, HTTP, segurança e matriz SEC |
| configuração/deployment futuros | origens exatas, reverse proxy `/api`, Keycloak e políticas por ambiente |

## Dependências e limites do plano

- O ambiente de implementação precisa de configuração Keycloak não secreta conhecida — issuer, client ID, redirect/logout URIs e mapeamentos de assurance — e de segredos fornecidos fora do repositório.
- Os valores produtivos das expirações de sessão e janelas de recência precisam de aprovação operacional antes do deploy, são configuração obrigatória nos modos OIDC/transição e não ficam hardcoded.
- Os roles PostgreSQL usados por `legacyPool` e `centralPool` têm de poder observar `pg_control_system().system_identifier` com o privilégio mínimo explicitamente concedido; se essa identidade de cluster não for observável, o arranque e a readiness falham fechado.
- F2 não implementa revogação por membership/troca de organização de F3, policy engine e catálogo final de F5, nem o sistema transversal de auditoria de F7; cria apenas os pontos de integração necessários sem declarar esses critérios cobertos.
- Foram escolhidos `openid-client`, `express-session`, `connect-pg-simple` e `csrf-sync`; nenhum token Keycloak é persistido, pelo que não foi necessário criar proteção criptográfica própria em repouso.
- A autorização de implementação não incluiu configuração Keycloak, reverse proxy, deploy, execução de migrations ou cutover definitivo.

## Restrições de revisão e rollout

- Não registar credenciais, tokens, ligações, chaves ou dados reais.
- Não tratar o modelo UBI como arquitetura futura.
- Não elevar `SEC-AC-01`–`SEC-AC-04` de `partial` para `covered` antes dos testes com Keycloak e armazenamento central descartáveis.
- Não resolver valores de política ou decisões de produto por inferência silenciosa.
- Não executar a migration F2 contra a base UBI ou qualquer base real sem plano operacional próprio.
- Não executar cutover enquanto um worker separado não correr `expireSessions` de forma periódica, monitorizada e reconciliável; esta responsabilidade não pertence à API.
- Não fazer cutover definitivo do JWT enquanto logout coordenado, revogação, rollback e integração Keycloak não estiverem validados no ambiente alvo.

## Fora do âmbito

- F3–F10 e todos os critérios SEC que lhes estão atribuídos.
- `SEC-AC-05/06`: revogação imediata de membership/sessão e troca de organização.
- tenant resolver, bases por organização e isolamento (`SEC-AC-09/10/11`).
- policy engine, grants, unidades, equipas, suporte e autorização funcional.
- R2, worker, jobs, outbox/inbox, auditoria, pedidos de titulares, retenção, logging/observabilidade integral e recuperação.
- migração executada, cutover, deploy ou configuração de fornecedores.

## Referências

- `context/features/security-privacy-and-audit-foundation.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/coding-standards.md`
- `context/decisions/multi-tenant-identity-and-data.md`
- `context/decisions/application-session-lifecycle.md`
- `context/decisions/session-cookie-csrf-and-origin-policy.md`
- `context/decisions/mfa-and-recent-authentication-policy.md`
- `context/decisions/hosting-and-external-services.md`
- `context/decisions/future-data-model.md`
- `context/references/logical-data-dictionary.md`
- `context/references/current-implementation.md`
- `backend/test/security/secCoverageMatrix.js`

Next step: submeter F2 à decisão de fecho mantendo `SEC-AC-01`–`SEC-AC-04` como `partial` até ao rollout no ambiente alvo e às dependências previstas de F3/F5.
