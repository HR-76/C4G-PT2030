# Integração da release de produção — 15/11/2026

Base local `af594e7ef6529770652a8bb51e63c0b3f0763c46` (`Prod 4`). Alterações ainda não publicadas. Não houve commit, push, deploy, acesso a bases externas nem alteração do staging. MFA mantém-se opcional.

## Resultado implementado

- Perfil explícito `production-editorial-v1` partilhado pelo bootstrap, API, primeiro administrador, convites e eliminação. O perfil mínimo continua disponível para os consumidores anteriores; produção recusa seleções ou grants divergentes.
- Bootstrap Central058/tenant041 integrado com os inputs privados, primeiro administrador verificado pela origem administrativa privada e bindings F4 lidos da Central depois da publicação. As migrações e os fingerprints publicados não foram alterados.
- Preparação local da identidade antes de existir o administrador real, com plano sem escrita e import/propriedades privados apenas sob `--write`. Import real de Keycloak é uma etapa distinta.
- Faturação e email de autenticação/histórico incluídos para ativação, conforme confirmação do utilizador. Login de faturação limitado às funções de entrega; segredos separados por consumidor e retoma vinculada à configuração e aos vinte segredos do pacote completo.
- Bootstrap Docker independente dos ficheiros que ainda vai gerar, serviços/ficheiros separados e executor de ensaio com projeto/redes/volumes próprios, imagens imutáveis, contexto e builder locais verificados e limpeza limitada aos recursos da execução.

## Verificações

| Verificação | Resultado |
| --- | --- |
| PostgreSQL18.6, instalação limpa | **41/41** — [recibo sanitizado](postgres-fresh.json) |
| PostgreSQL18.6, falhas e retomas | **50/50** — [recibo sanitizado](postgres-full.json) |
| Testes focados de produção/email do worker | **105/105** |
| Estrutura/configuração e executor Docker simulado | **21/21** |
| Suite completa backend | **3538 aprovados, 9 ignorados existentes, 0 falhas** |
| Suite completa frontend | **1150/1150, 128 ficheiros, 0 falhas** |
| ESLint de todo o código | PASS, sem avisos |
| `node --check` | PASS, 30 ficheiros alterados/novos |
| Build frontend | PASS |

Os gates PostgreSQL usaram clusters novos, password SCRAM aleatória, porta loopback própria e dados sintéticos. Testaram permissões reais, RLS, acesso entre bases/organizações, projeção e eliminação repetíveis, login de faturação, rejeição de grants adicionais, credenciais/configuração alteradas, retoma incompleta e remoção da elevação técnica após falhas. Ambos terminaram com o cluster encerrado e o diretório de dados removido. Nenhuma identidade sintética foi criada num fornecedor real.

As regressões foram observadas antes das correções: seleção editorial incompatível nos validadores, preparação de identidade dependente de um administrador ainda inexistente, configuração falsa/nula interpretada como omissão, omissão de runtime numa retoma já vinculada, dependência circular de ficheiros Compose e seleção de builder remoto. O gate SQL também detetou avaliação antecipada de `has_sequence_privilege` para uma relação que não era sequência; a correção protege a chamada com `CASE` e os dois percursos reais finais passaram. O teste de grants excedentes verifica tanto a recusa do validador específico como a recusa antecipada do preflight058.

Comandos principais: `node --test backend/test/production*.test.js backend/test/memberWorkerPrivateEmail.test.js`; `node --test test/production-preparation.test.cjs test/production-rehearsal.test.cjs`; `node test/integration/production-bootstrap/gate.cjs fresh` e `full`; `npm test` em cada aplicação; `npm run lint` na raiz; `npm run build` em frontend. Os logs locais ficam em `.tmp/production-release-*.log`, fora do Git.

## Limites e próximo aceite

Docker/Podman não estão disponíveis no Windows nem na distribuição WSL Ubuntu inspecionada. Não houve construção ou execução de contentores, `docker compose config` real, arranque HTTP integral da API ou prova de TLS/proxy/Keycloak/SMTP/Resend/R2/ClamAV. O executor foi testado com comandos simulados; os gates SQL usaram PostgreSQL local real e verificação de identidade simulada. CI da revisão final ainda não existe porque este pacote não foi publicado.

O [ensaio Docker preparado](../../../deploy/rehearsal/production/README.md) identifica a fase automática da imagem candidata/PostgreSQL e o aceite integral de aplicação/fornecedores que continua por executar. Faltam os dados reais da primeira entidade e administrador prometidos pelo utilizador; os exemplos permanecem deliberadamente inválidos. Antes de produção, completar esses inputs, fixar a revisão/digests, executar o ensaio e comprovar backups/restauro e configuração real dos fornecedores. A aplicação/deploy são uma ação posterior, não executada neste trabalho.

Procedimentos atualizados: [bootstrap](../../runbooks/production-bootstrap-installer.md), [pacote privado](../../runbooks/production-runtime-bundle.md), [aplicação e deploy](../../runbooks/production-057-deployment.md), [rollback](../../runbooks/production-057-rollback.md).
