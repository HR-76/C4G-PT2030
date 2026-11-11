# Onboarding com adaptadores reais — 18/10/2026

Estado: Review. **Gate integrado final PASS: 12 grupos**, com Keycloak/PostgreSQL/Chrome reais. Não corresponde à ligação do ecrã habitual nem a uma implantação pública.

## Implementação

- `keycloakAdapter.js`: Admin REST por HTTPS, conta sem password e sem email verificado, username estável e marcador HMAC de ownership. Repetição reconcilia a conta criada pela operação. Identidade central existente usa o subject conhecido; colisão desconhecida exige reconciliação.
- `postgresProvisioner.js`: base própria, migrações tenant até 030, preflight e diretório central real; logins API/WORKER separados, sem privilégios de criação ou administração. Publicação só após verificações. Projeção da ficha pessoal ligada à membership, com contexto organizacional, papel limitado e recibo idempotente.
- `encryptedJournal.js`: reserva imutável cifrada com AES-256-GCM, publicação atómica por hard link e chave externa ao journal. Mantém identificadores e credenciais em reinícios do worker; alteração de intenção ou adulteração é recusada.
- `oidcActivationAdapter.js` e `service.checkActivation`: transação transitória ligada ao navegador, PKCE, state, nonce, assinatura, issuer/subject e confirmação da password. A ponte Keycloak consulta o serviço central. Perda do callback após definir password permite novo login sem a redefinir.
- Worker separado por IPC em `real-worker.js`; a composição HTTP do ensaio recebe portas fechadas. O próprio orquestrador de testes também tem privilégios para criar e inspecionar a infraestrutura descartável.
- Reutilizada a SPI isolada anterior para a definição nativa de password. A ativação, membership, grants e F7 pertencem ao serviço central 020. O login seguinte usa os controladores OIDC, sessões persistidas, CSRF e autorização normais da aplicação; não há fixture de sessão ou membership do cliente.

## Verificação

- `node --test backend/test/platformOnboarding.test.js backend/test/platformOnboardingAdapters.test.js backend/test/f7AppendOnlyAudit.test.js backend/test/centralMigrationPreflight.test.js backend/test/f5AuthorityCommitGuard.test.js backend/test/internalAccessProfiles.test.js`: **47 PASS**. O primeiro arranque foi impedido pelo sandbox (`spawn EPERM`); a execução autorizada passou.
- `service-gate.ps1`: **17 grupos PASS**, PostgreSQL descartável e coordenador restrito. Inclui concorrência, leases/fences, expiração/revogação, rollback F7 e perda da resposta de COMMIT.
- `node --check`: **13 ficheiros PASS** — módulos de onboarding, helpers reais do gate e teste novo.
- `real-gate.ps1 -SkipBuild`: **12 grupos PASS**, Keycloak 26.8.0 com a imagem da SPI já construída, PostgreSQL 17 e Chrome real, em portas próprias e HTTPS com certificado local confiável. Resultado final confirmado em `verification.json`; containers e diretórios temporários próprios removidos e ausência conferida.

O gate cria identidades e memberships de cliente exclusivamente pelo novo serviço e pelos adaptadores reais. O registo de catálogo é sintético e passa pelo repositório de importação existente; não foram feitas recolhas externas. São verificados login C4G, perda de respostas e reinício, ativação nova/existente, segunda entidade, login normal, Acessos, recusa de autoridade C4G ao ORG_ADMIN, candidatura/tarefa, catálogo partilhado, isolamento HTTP e CONNECT físico. Os casos finais incluem conta errada, revogação com formulário aberto, convite consumido e conta Keycloak desconhecida com o mesmo email.

Confirmado também: repetir o provisionamento e a projeção de uma entidade já usada preserva o detalhe da candidatura e as linhas da tarefa; a projeção pessoal não é duplicada. A revogação com formulário aberto impede tanto o commit da password no Keycloak como a ativação da membership. A conta desconhecida mantém a representação original e não recebe membership. Os campos de diagnóstico `callbackError`, `activationError`, `lastHttpError` e `workerFailure` no relatório final registam recusas deliberadamente provocadas; não são falhas pendentes quando `result` é `PASS`.

Durante o ensaio foram corrigidos o search_path exigido pelo preflight e o contexto organizacional da projeção. Os testes passaram a respeitar o cabeçalho `X-C4G-Organization` já usado em `frontend/src/api/api.js`, a reautenticação Keycloak com username fixo e a renovação do token administrativo do inspetor. Não se alteraram estas proteções da aplicação para acomodar o teste.

## Limites e ambiente habitual

- Só composição descartável. A factory administrativa continua sem montagem no `app.js`/composição habitual; frontend e contrato do cliente habitual não foram alterados. Build frontend não aplicável.
- A SPI continua restrita ao realm de prova. Faltam empacotamento e configuração próprios para o ambiente habitual, revisão das permissões do IdP e separação operacional dos segredos. O processo HTTP do produto não deve herdar o ambiente privilegiado do orquestrador de ensaio.
- O login central de leitura do ensaio usa `pg_read_all_data`, sem CREATE DATABASE/ROLE ou superuser. É uma escolha da fixture de inspeção, não uma aprovação de permissões de produção. O coordenador de escrita continua restrito.
- Journal local comprova retoma entre processos; não comprova backup durável, recuperação após falha do host, cofre remoto ou implantação cloud. Códigos EU no diretório não constituem prova de uma infraestrutura cloud regional.
- Nenhuma base habitual migrada, conta real criada, email enviado ou configuração R2/antivírus alterada. A consulta isolada a `http://localhost:5000/health/ready` não obteve resposta; não se afirma que o serviço habitual estava saudável, nem se tentou reiniciá-lo.

Evidência: `output/playwright/c4g-onboarding-real/verification.json`, `password-native.png` e `activation-complete.png`. Diagnósticos de execuções anteriores não são prova do resultado final; prevalece o JSON do gate final.

Próximo passo: preparar a composição do ambiente habitual, com separação operacional dos segredos e configuração própria da ativação, antes de ligar o formulário Entidades e utilizadores.
