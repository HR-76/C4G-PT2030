# Arranque autónomo do backend local

Estado: concluído localmente — 29/10/2026.

## Pedido e diagnóstico — 29/10/2026

O utilizador pede a aplicação local disponível e a correção do problema recorrente ao executar `npm run dev` separadamente em backend e frontend. O frontend responde na porta 3000; API 5000 e identidade 8080/8443 estão indisponíveis. O arranque da API falha no discovery OIDC com `ECONNREFUSED` na causa do erro, mas o entrypoint apresenta apenas `LOCAL_API_START_FAILED`. Os contentores habituais Keycloak/proxy existem e estão parados.

## Âmbito e critérios de aceitação

1. `npm run dev` em backend verifica PostgreSQL e prepara a identidade local antes de arrancar a API, reutilizando a recuperação dos contentores existentes do supervisor raiz.
2. Com identidade já pronta, não executa operações Docker; com identidade parada, inicia apenas os contentores existentes do perfil reconhecido e aguarda a prontidão.
3. Falhas de preparação impedem o arranque da API e apresentam código e remediação conhecidos, sem imprimir erros brutos, configuração ou segredos.
4. O supervisor raiz deteta o crash do processo API supervisionado sem esperar apenas pelo timeout de saúde; o nodemon individual conserva a possibilidade de reiniciar após alterações.
5. Frontend, API e worker configurado ficam disponíveis localmente; verificam-se a saúde através do proxy Vite e o encaminhamento do login OIDC.
6. Regressões primeiro, testes focados, suites backend/frontend, build e sintaxe dos ficheiros alterados. Falhas anteriores são registadas separadamente.

### Falha adicional reproduzida após retoma

O discovery direto em HTTP 8080 responde, mas o percurso HTTPS 8443 usado pela API devolve 502 (`OAUTH_RESPONSE_IS_NOT_CONFORM`). A verificação antiga aceita apenas TCP aberto em 8443 e metadata em 8080, anunciando prontidão falsa. A configuração efetivamente montada no proxy encaminha `/realms/c4g-native-local` para `c4g-native-email-idp`, conforme o contrato de localização do login; este fornecedor e o respetivo PostgreSQL persistente também ficaram parados. Não é suficiente retomar apenas o Keycloak de 8080.

A correção deve validar o discovery pelo HTTPS real com a CA local, sem desativar validação TLS, e reconhecer o perfil efetivamente montado no proxy antes de retomar os contentores existentes `c4g-native-email-pg` e `c4g-native-email-idp`. Preservar a rota, o realm ativo e todas as contas. Não criar contentores, nem ativar SMTP/infraestruturas históricas alheias ao login. A API só arranca com o discovery HTTPS válido. Acrescentar regressões para proxy 502, perfil habitual/ativo, recuperação e erros/timeout seguros.

Sem migrations, seeds, resets, alterações de contas/credenciais ou recriação de contentores. Preservar o frontend já aberto e todo o trabalho não relacionado. O comando agregado na raiz continua a ser o percurso recomendado, incluindo o worker.

## Validação

- RED confirmado antes da implementação: diagnósticos ausentes, nodemon supervisionado sem `--exitcrash`, prontidão indevida com HTTPS 502 e recuperação incompleta do perfil ativo.
- Foco final: 29/29 PASS (sete backend e 22 supervisor). Sintaxe dos quatro ficheiros JavaScript alterados/adicionados e whitespace PASS. Revisão final sem bloqueadores.
- Suite frontend: 414 PASS; build PASS.
- Suite backend: 1729 PASS, uma falha preexistente, sete SKIP. Falha em `fundingEnrichmentPersistence.test.js:33`, teste `enrichment discovery defers every new identity until its complete known lookup`, já registada no trabalho de desempenho do dashboard e fora dos ficheiros alterados. Não foi corrigida nem ocultada neste incremento.
- Evidência local: `.tmp/local-dev-startup/backend-suite-final.log`, `frontend-suite.log`, `frontend-build.log` e `readiness.json`.
- Serviços de identidade existentes retomados preservando os volumes; worker configurado iniciado em segundo plano; API retomada no nodemon do utilizador e Vite existente preservado. Nenhuma migration, seed, configuração de conta, nova recolha pedida ou recriação foi executada.
- Smoke real: frontend HTTP 200; `/api/local-health` HTTP 200 com `ready`, `workerReady` e `admissionReady` verdadeiros; sessão anónima HTTP 401; login HTTP 302 para o issuer esperado e formulário HTTPS HTTP 200 com utilizador, palavra-passe e botão Entrar. Não foi submetida uma conta real.
- O helper final confirmou o discovery real com a CA local e `started:false`, usando um double que falharia se Docker fosse chamado. `npm run dev` na raiz reconheceu a aplicação já disponível sem duplicar servidores.
- A recuperação automática desde todos os contentores parados foi coberta com doubles; a retoma real foi executada em passos durante o diagnóstico. Não se voltaram a parar serviços de identidade depois de a aplicação ficar disponível.
