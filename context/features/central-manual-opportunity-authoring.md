# Criação manual de oportunidades pela C4G

Estado: Complete — aceitação e fecho explicitamente autorizados pelo utilizador em 30/10/2026. Implementação e validação realizadas em 29–30/10/2026. [Registo de fecho](../history/central-manual-opportunity-authoring-2026-10-30.md).

## Decisão e âmbito

A criação manual serve para publicar no catálogo comum oportunidades de plataformas sem API. Pertence exclusivamente à Administração C4G (`C4G_ADMIN`, designada Super Admin pelo utilizador), sem membership de cliente ou seleção de entidade. Os clientes consultam as oportunidades e mantêm os seus processos privados de qualificação e candidatura. Esta decisão substitui a criação manual privada prevista anteriormente em F12.

Preservar oportunidades privadas, revisões e candidaturas existentes no respetivo tenant; nunca promover os dados privados ao catálogo comum. Retirar a entrada de oportunidades privadas do menu e o formulário do cliente, conservando consulta histórica por URL. Desativar criação, edição e arquivo de oportunidades pelas rotas privadas e impedir novas importações privadas. Critérios, qualificação e candidaturas não mudam de autoridade.

## Plano e aceitação

1. Criar página administrativa de registo manual e ligação no catálogo/menu, protegidas por atribuição C4G. Clientes não veem nem acedem ao formulário.
2. POST administrativo exige sessão, autenticação recente segundo a política existente e utilizador/atribuição centrais atuais. Validar e bloquear autoridade fornecida pelo caller; fixar proveniência C4G_MANUAL e estado ACTIVE/PENDING_REVIEW no servidor.
3. Reutilizar repositório Central F12: transação única com autoridade bloqueada, revisão, proveniência, auditoria e idempotência. Repetição do mesmo pedido não duplica; conteúdo diferente conflita; falha de auditoria reverte a operação. Resultado incerto conserva intenção e chave no formulário.
4. Catálogo, filtros/programas, detalhe, referência de revisão para candidatura e resumo organizacional incluem registos manuais sem identidade de integração. Identificar fonte como registo manual C4G. Não criar identidades fictícias de conectores.
5. Recusar mutações privadas no servidor mesmo com grants anteriores. Leituras históricas continuam isoladas; permissões devolvidas não anunciam criação/edição/arquivo.
6. Testes de regressão antes da implementação, testes focados de autorização/revogação/validação/repetição e UI; suites backend/frontend, sintaxe e build. Gates com PostgreSQL/SQL externo continuam sujeitos a autorização isolada própria; não executar migrations ou deploy.

## Validação

### Gate PostgreSQL autorizado — 29/10/2026

Pedido posterior do utilizador autoriza a validação num PostgreSQL isolado. Criar um contentor descartável exclusivo, ligado apenas a loopback numa porta efémera, com base vazia e dados sintéticos; aplicar aí o manifest Central existente, sem novas migrações de produto. Validar criação/persistência/auditoria, concorrência e replay, revogação, rollback, leitor restrito, consulta HTTP de duas entidades e bloqueio de escrita do cliente. A autenticação HTTP da fixture é sintética: este gate não declara nova prova OIDC nem rollout. No fim fechar ligações e remover apenas o contentor identificado por ID e label desta execução, preservando evidência sanitizada. Bases Dev e produção ficam fora do âmbito.

- Registo administrativo em `/administracao/oportunidades/nova`, acessível pelo menu e catálogo; `POST /api/admin/central-opportunities` protegido por sessão, política de autenticação recente e autoridade central atual. O formulário preserva a chave/conteúdo em resultados incertos e usa o recibo conhecido para repetir apenas a leitura.
- Bloqueios de catálogo privado devolvem 403, incluindo criação/edição/arquivo e novas importações/revisões de linhas. Leituras e cancelamento de importações anteriores permanecem. Critérios e candidaturas não foram retirados. O cliente API deixou de exportar métodos de escrita de oportunidades privadas.
- O repositório central reaproveita as tabelas existentes; nenhuma migração é necessária. A chave de idempotência é isolada por administrador e inclui toda a intenção, incluindo resumo; proveniência e instante gerados pelo servidor não alteram um retry. Locks de autoridade, revisão, proveniência, recibo e auditoria partilham a transação. A fonte manual não recebe identidade fictícia de conector.
- Regressões RED→GREEN: serviço central inicialmente ausente; antiga rota privada aceitava POST (201 em vez de 403); shell bloqueava o Admin sem entidade. Testes agora comprovam estas fronteiras.
- Backend focado: **33 PASS**; inclui HTTP real sobre doubles de persistência, auditoria real F7, revogação, sessão ausente, autenticação expirada, injeção de autoridade, replay/conflito, rollback por auditoria e recusa das rotas privadas. Log `output/central-manual-focused-backend.log`.
- Suite backend: **1737 PASS / 1 FAIL / 7 SKIP** (1745 testes). Falha fora deste incremento: `fundingEnrichmentPersistence.test.js:29`, “enrichment discovery defers every new identity until its complete known lookup”, no método `discovered` de `fundingTenders/refresh.js`, não alterado. Reproduzida isoladamente com `--test-name-pattern`; não se deve declarar suite global verde. Logs `output/central-manual-backend-tests-final.log` e `output/central-manual-unrelated-failure.log`.
- Frontend: **412 PASS**, 59 ficheiros; build Vite PASS. `node --check`: 15 ficheiros JS backend/testes PASS; `git diff --check` do âmbito versionado PASS. Logs `output/central-manual-frontend-tests-final.log` e `output/central-manual-build-final.log`.
- Chrome com API sintética: Admin sem entidade, criação → detalhe identificado como “Registo manual C4G”, 1440×900 e 390×900 sem overflow horizontal; capturas inspecionadas. Cliente sem ligação de criação/privadas, tentativa de URL administrativa redireciona ao catálogo e consulta da oportunidade manual PASS. Zero erros de consola; avisos conhecidos do React Router. Fixtures e capturas em `output/playwright/central-manual-*`.
- GET de descoberta na API local ativa já anuncia apenas leitura privada e criação administrativa. A prova de browser intercetou todas as chamadas `/api/`; não criou oportunidades reais nem comprovou persistência PostgreSQL deste percurso.

### Resultado PostgreSQL isolado — 30/10/2026

**12 verificações PASS** em PostgreSQL 17.11. Script reproduzível: `node test/integration/funding-tenders/manual-authoring.js --isolated`. Evidência: [verification.json](../../output/central-manual-pg-fa5d98492d064a7eb92b9b77626a753c/verification.json).

Aplicadas as 36 migrações existentes (000–035) exclusivamente na base descartável vazia, com fingerprints e preflights originais. Cinco oportunidades sintéticas persistidas, cada uma com revisão, proveniência, recibo e evento auditável; zero identidades de conector. Validados valores decimais exatos, replay após reconexão, concorrência sem duplicação, conflito de intenção, rejeição de autoridade/input inválidos, revogação do Admin, serialização de revogação com commit, rollback inclusive da cadeia de auditoria, histórico imutável e ACL do leitor. HTTP: Admin cria, dois clientes consultam o mesmo catálogo, clientes não escrevem, sessão ausente/expirada recusada.

Limites: autenticação HTTP sintética, sem novo teste OIDC; ligação de escrita usa o instalador isolado e o código de mutação assume o papel runtime do catálogo. Não prova provisionamento de um login de escrita de produção, suspensão de membership ou isolamento entre bases tenant. O leitor usa login restrito real, com admissão e ACL verificadas. Tentativas anteriores de preparação da fixture ficaram registadas como FAIL, com limpeza confirmada; corrigiu-se apenas o harness, sem alterar código de produto ou relaxar manifests.

Ligações fechadas, contentor identificado por ID/label removido e ausência confirmada (`cleanup: true`). Não foram criadas migrações de produto nem alteradas bases Dev/produção; não houve dados reais, commit ou deploy. Mantém-se a falha preexistente da suite backend acima. A revisão funcional posterior e a aceitação estão registadas abaixo.


### Correção autorizada — recuperação de pedidos incertos (30/10/2026)

Implementado. Guardar chave, campos e recibo em sessionStorage por administrador antes de enviar; recuperar ao remontar/recarregar no mesmo separador. Não reenviar automaticamente: confirmar com a mesma chave ou reler o recibo. Preservar após falha de rede/5xx e recusa posterior; apenas rejeição definitiva sem incerteza anterior permite editar. Não partilhar o pedido entre administradores. Falha de armazenamento impede novo envio. Limite explícito: fechar o separador ou apagar armazenamento não é recuperação suportada. Testar 502/504, remount após falha e durante envio, recibo, separação por utilizador, rejeição definitiva e armazenamento indisponível; executar suites e build.


Validação da correção: sete regressões falharam antes da implementação; os 21 testes do formulário passam agora, incluindo 11 casos adicionados. Suite frontend **423 PASS** (59 ficheiros); build Vite PASS. Verificados 500/502/504, restauro após remount e durante POST, isolamento por administrador, recibo com repetição GET, limpeza após sucesso/rejeição definitiva, armazenamento indisponível/corrompido, recusa posterior sem perda de intenção e resposta tardia de componente desmontado. Bloqueio síncrono evita envio duplo antes de renderizar. Armazenamento local nunca substitui autorização do servidor e não provoca envio automático. Sem alterações ao runtime backend, SQL, dados reais ou deploy. Não foi repetido o gate PostgreSQL nem o browser real neste incremento; testes de componente remontam a página sobre sessionStorage.

O primeiro ensaio backend revelou, além da falha preexistente, a proibição de armazenamento fora dos módulos aprovados. O novo `manualIntentions.js` foi isolado e admitido explicitamente em SEC-AC-01, mantendo a proibição global de localStorage/sessionStorage fora destes módulos. O teste passou a rejeitar tokens, roles, grants e organização em todos os níveis do registo manual. Foco de segurança **49 PASS**, sintaxe PASS. Apenas os campos funcionais, utilizador, chave e ID do recibo são persistidos; nenhum token ou estado de autenticação.

Logs finais: `output/central-manual-recovery-frontend-final.log`, `output/central-manual-recovery-backend-final.log` e `output/central-manual-recovery-build-final.log`. Revisão do código corrigido sem novos bloqueadores identificados.

Suite backend final: **1737 PASS / 1 FAIL preexistente em fundingEnrichmentPersistence.test.js / 7 SKIP**. Não há novas falhas da correção. A validação funcional posterior está registada abaixo.


### Validação funcional no Chrome — 30/10/2026

**13 verificações PASS**, frontend real em localhost:3000 e API integralmente simulada numa sessão Chrome exclusiva. Erro 502 bloqueia campos/cancelamento; reload conserva campos sem POST automático; retry 504 usa chave e conteúdo idênticos; navegação catálogo→formulário recupera o pedido; outro Admin vê formulário vazio e o original recupera o seu pedido. Resposta 201 seguida de falha GET conserva recibo; reload e repetição fazem apenas GET, apresentam detalhe com fonte manual e limpam a recuperação após sucesso. Três tentativas POST sintéticas, uma única chave; zero API inesperada e zero pageerrors JavaScript. Mensagens de consola 502/504/503 foram induzidas pela fixture, além dos avisos conhecidos do React Router.

Capturas 1440×900 e 390×900 inspecionadas, sem overflow horizontal. Evidência: [relatório](../../output/playwright/manual-recovery-verification.json), [desktop](../../output/playwright/manual-recovery-1440.png), [mobile](../../output/playwright/manual-recovery-390.png). Fixture e cenário reproduzíveis em `output/playwright/manual-recovery-setup.js` e `manual-recovery-verify.js`. A primeira preparação intercetou também módulos `/src/api/` e foi corrigida antes do teste, restringindo a fixture a `/api/`; essa tentativa não constitui falha do produto.

Sessão de browser encerrada. Nenhuma oportunidade real criada, nenhuma escrita na base, migration ou deploy. Esta prova valida a recuperação no browser, não autenticação OIDC ou uma nova transação PostgreSQL. Sem novos bloqueadores funcionais neste âmbito; aceite e fechada pelo utilizador em 30/10/2026.


### Aceitação e fecho — 30/10/2026

Pedido explícito: «aceitação e fecho da funcionalidade». Resultado aceite: autoria manual exclusiva no Admin C4G, leitura pelos clientes, histórico privado preservado e recuperação segura de pedidos incertos no mesmo separador. Critérios funcionais validados e revisão concluída; estado Complete no âmbito implementado e testado. A falha preexistente de enriquecimento e os limites de OIDC, login de escrita de produção e recuperação após fechar o separador permanecem documentados; o fecho não constitui certificação de produção. Entrada concluída arquivada no histórico, restantes trabalhos ativos preservados. Sem commit, merge, push ou deploy.
