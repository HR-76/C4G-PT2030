# Validação HTTP/OIDC isolada — não aprovada para produção

26/10/2026. A prova foi executada, não apenas preparada. OIDC, cliente HTTP e isolamento SQL funcionam nos cenários abaixo, mas o dashboard e a concorrência do relatório impedem aprovar o conjunto. Não foram alterados ficheiros de runtime, migrations, definições de grants/permissões, configuração de deploy ou dados Dev.

## Ambiente e método

PostgreSQL **17.11**, Keycloak **26.8.0**, Chrome real, TLS verificado e Authorization Code/PKCE. Contentores exclusivos, portas de loopback livres, uma base central e duas bases tenant. Manifests correntes aplicados a bases novas, incluindo Central `032_single_organization_membership`; diretório, provisionador, autoridade, roles e RLS reais. Cada conta pertence a uma única entidade. O teste de rotação reseleciona a própria entidade; selecionar a entidade alheia é recusado.

Foi utilizada `createProductionComposition` com pools isolados. Axios e `AuthProvider` são os módulos reais compilados para um pequeno harness em memória. As injeções limitam-se a falhas de transporte/CSRF e locks SQL de teste; autorização, sessão persistida e queries funcionais não têm doubles. O cenário pendurado retém a resposta depois do handler de sessão, não uma query infinita. O recorte de revogação bloqueia a leitura de metadados/tenant no PostgreSQL e revoga a membership central antes de a leitura prosseguir.

Os logins tenant da API usam as capabilities existentes, sem superuser, BYPASSRLS, CREATEDB, CREATEROLE, REPLICATION ou INHERIT. A autoridade usa `c4g_authority_runtime`; o catálogo usa login próprio de `c4g_catalog_reader`. O leitor central não coordenado é um perfil de bootstrap `pg_read_all_data`, como nos gates anteriores: **não se afirma paridade dos privilégios centrais com produção**, nem aprovação do arranque produtivo completo. Keycloak usa modo de desenvolvimento e a política existente de autenticação recente por password; MFA/OTP não foi testado.

## Resultados funcionais

- Login OIDC real e cookie `Secure`, `HttpOnly`, `SameSite=Lax`, prefixo `__Host-`: PASS.
- POST de organização devolve utilizador, organização e CSRF; o `AuthProvider` aplica o estado sem GET obrigatório e conserva-o após revalidação GET 503: PASS.
- Token em cache desatualizado: POST externo 200, POST do cliente 403/CSRF_INVALID, renovação e retry 200. Duas rejeições reais produzem exatamente `[403,403]`, sem ciclo: PASS.
- GET sem resposta cancelado antes de organização/logout: PASS. Na execução de 12 amostras, POST de organização completou em **3,91 s** e logout em **1,80 s**; estes tempos incluem backend, não apenas a barreira de 250 ms. A sessão persistida fica inválida após logout.
- API SQL não lê sem assumir o role funcional, não assume owner/migrator/worker e não liga à base de outra entidade: PASS.
- RLS esconde linhas com contexto alheio e rejeita escrita incompatível. Candidaturas/diretório têm FORCE RLS; o catálogo privado conserva ENABLE RLS e runtime não proprietário, conforme o manifest existente. O role é restaurado após rollback: PASS.
- Autoridade SQL recusa leitura direta das tabelas centrais fora do protocolo fechado: PASS.
- HTTP não permite selecionar a entidade alheia, ler a sua candidatura ou pedir o seu dashboard: PASS.
- Criação de candidatura por POST, com autoridade e auditoria reais: PASS.
- Browse e relatório seriais: HTTP 200, 25 detalhes. Matching por oportunidade com 25 pessoas: HTTP 200 e **uma** consulta de lote de pessoas/áreas; cerca de **21,79 s** e **4285 chamadas SQL** no percurso integral. Não foi medido p95 de matching com 1000 pessoas.

**Revogação concorrente: PASS na confirmação.** O lock real foi observado na admissão/metadados do tenant. A escrita central foi registada e a suspensão confirmou-se antes de libertar o lock. O pedido já iniciado respondeu 503, sem dados, em cerca de 2,87 s; a leitura posterior também foi recusada. Isto prova revalidação após a resolução inicial da identidade; não se apresenta como um ensaio de revogação depois de emitido o permit final de commit. Evidência em [results.json](results.json). Os ensaios de calibração e asserções refinadas são distinguidos abaixo.

## Bloqueios confirmados e causas

1. **Dashboard: 503 / `CATALOG_READER_SCHEMA_DRIFT`.** O preflight real do leitor recusa o schema 032. [catalogReaderSchema.js:2](../../../backend/src/security/catalogReaderSchema.js:2) só admite 029/030, embora o manifest central corrente inclua 031/032. A query de agregação central não chega a executar. Não foi adicionado um bypass nem alterado qualquer fingerprint.
2. **Relatório concorrente: 31/36 respostas 503.** Observados `AUTHORITY_STALE` e `AUTHORITY_WRITE_PENDING`. Um GET normal de sessão manteve o cookie e avançou o epoch. [sessionSecurity.js:22](../../../backend/src/security/sessionSecurity.js:22) envolve também `touch` em `coordinator.write`; [authorityCoordinator.js:128](../../../backend/src/security/authorityCoordinator.js:128) regista um writer e avança o epoch, que [validateEpochs:187](../../../backend/src/security/authorityCoordinator.js:187) compara com o snapshot das leituras. Isto cria invalidações de leituras concorrentes por renovação de expiração, mesmo sem mudança de identidade/entidade. A evidência está em `sessionTouch`, `failures` e `measurements` dos JSONs.
3. **Custo dominante fora da consulta de dados.** Browse serial: cerca de 6,09 s e 1155 chamadas SQL; relatório: 5,85 s e 1240. São chamadas de rede ao driver, incluindo controlo transacional, protocolo e metadados; não statements internos das funções SQL. [authorityCoordinator.js:24](../../../backend/src/security/authorityCoordinator.js:24) repete admissão/security snapshot por transação. Nos perfis observados, centenas de leituras de metadados concentram o tempo; polling sob concorrência acrescenta chamadas. A consulta de dados paginada mantém-se única.
4. **Achado separado na listagem geral.** O ensaio exploratório de `GET /applications`, distinto do browse da interface (`/applications/browse`), atingiu `LEASE_TIMEOUT` com 25 candidaturas e respondeu 503 após cerca de 15 s. Não atribuir este resultado ao novo browse SQL.

As causas não foram corrigidas neste recorte de validação. Alterar o tratamento de `touch` exige preservar expiração, revogação e a proteção de commits; simplesmente desativar touch, epochs ou preflights não satisfaz o contrato.

## Medições HTTP — 12 amostras, concorrência 4

[Dados completos](benchmark-12.json). Uma sessão OIDC nova por volume, um aquecimento por percurso; login fora dos quantis. Mesma sessão partilhada pelos quatro pedidos. O cliente Playwright de medição tem timeout de 65 s; os timeouts reais do Axios são exercitados separadamente e não foram aumentados. p50/p95 apenas dos pedidos 200, em milissegundos; os erros são apresentados separadamente.

| Percurso | Candidaturas | Sucessos | Erros | p50 ms dos sucessos | p95 ms dos sucessos |
| --- | ---: | ---: | ---: | ---: | ---: |
| Browse | 25 | 12 | 0 | 9664,97 | 10740,19 |
| Browse | 1000 | 12 | 0 | 10052,24 | 10561,84 |
| Browse | 10000 | 12 | 0 | 10565,79 | 11193,71 |
| Relatório | 25 | 1 | 11 | 6894,75 | 6894,75 |
| Relatório | 1000 | 2 | 10 | 6338,73 | 6721,45 |
| Relatório | 10000 | 2 | 10 | 6619,15 | 6902,65 |

Quantis baseados em 1–2 sucessos **não caracterizam um serviço saudável**. Dashboard falhou no aquecimento em todos os volumes, pelo que não se atribui p95 de sucesso. Aos 10000 registos, o browse transportou **20389 bytes**, o relatório **19587 bytes** nos sucessos, sempre 25 detalhes. No primeiro pedido concorrente desse volume, a seleção SQL demorou aproximadamente 217 ms no browse e 198 ms no relatório, muito abaixo do tempo HTTP total. Contagens/digest continuam a depender do conjunto autorizado na base.

São dados sintéticos, uma oportunidade privada e uma membership por tenant; o diretório A cresce de 25 para 250/1000 pessoas. Não há distribuição produtiva, entidades numerosas, rede/cloud, tráfego prolongado, capacidade dedicada ou SLO acordado. Não existe baseline HTTP anterior comparável, nem percentagem de ganho produtivo. Os benchmarks antigos com doubles/tabelas temporárias não são comparados como se fossem o mesmo percurso.

## Reprodutibilidade e integridade

**Confirmação final:** `gate.ps1 -Samples 4` terminou com exit **1**, por bloqueios reais do produto, sem exceções de fixture/cleanup. Os **22 cenários funcionais** registados passaram. Browse: **12/12** respostas 200 nos três volumes; relatório: **9/12** respostas 503; dashboard: três aquecimentos 503. A confirmação reproduziu as duas causas descritas acima e aprovou a revogação concorrente com a observação correta do lock. [Resultado final](results.json) e [log completo](gate-confirmation.log).

[Comandos e funcionamento do gate](../../../test/integration/http-oidc/README.md). Novos ficheiros: [gate.ps1](../../../test/integration/http-oidc/gate.ps1), [fixture.js](../../../test/integration/http-oidc/fixture.js), [gate.js](../../../test/integration/http-oidc/gate.js), [browserProof.js](../../../test/integration/http-oidc/browserProof.js), [sqlProof.js](../../../test/integration/http-oidc/sqlProof.js), [measurement.js](../../../test/integration/http-oidc/measurement.js) e [revocationProof.js](../../../test/integration/http-oidc/revocationProof.js).

Na calibração corrigiram-se espera de arranque, observação da rota antes do router Express, JSX automático, revisão obrigatória da fixture e expectativas de FORCE RLS. A primeira observação da revogação esperava que o lock ocorresse na seleção final; PostgreSQL pode bloquear antes, ao observar metadados da relação. A fixture final identifica ambas as fases. Uma asserção inicial exigia contagem SQL total constante; foi substituída por uma seleção funcional por página, porque polling de autoridade varia legitimamente sob concorrência. Estas correções não alteram o produto nem apagam as falhas funcionais observadas. O JSON `benchmark-12.json` conserva essas duas asserções antigas como falhas da fixture, além das medições válidas; a confirmação posterior usa asserções corrigidas.

Validação adicional: [frontend focado](frontend-focused.log) **10/10**; [backend focado](backend-focused.log) **22/22**, sem skips; [build Vite](vite-build.log) PASS. Sintaxe verificada nos novos módulos. As suites completas da implementação anterior não foram repetidas: nenhum ficheiro de produto mudou, e as três falhas globais então documentadas não foram tratadas como resolvidas.

Baseline: [HEAD/branch/worktree e 2555 hashes](baseline.json), branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, ambos inalterados no fim. A [comparação final](preservation.json) encontrou **2552 ficheiros idênticos**, três documentos de contexto atualizados intencionalmente, nenhum ficheiro ausente e nenhuma alteração inesperada/protegida. Os oito ficheiros novos do gate estão identificados em [test-files.json](test-files.json).

O gate aplica migrations/grants existentes exclusivamente nos seus contentores; isto não significa alterar os ficheiros de migration/permissões nem as bases Dev. A inspeção Docker final confirmou **zero contentores com a label do gate**. Os contentores e volumes próprios foram limpos por label/UUID. A verificação de artefactos não encontrou strings de ligação, passwords ou tokens gravados. Sem commit, push, merge ou deploy. Estes hashes comprovam a preservação do conjunto registado, não imutabilidade universal de ficheiros ignorados ou de processos externos.

Próximo passo: corrigir a compatibilidade do leitor e o contrato de renovação de sessão versus epochs, reduzir o custo repetido de metadados preservando as validações de autoridade e repetir este gate antes de qualquer aprovação produtiva.
