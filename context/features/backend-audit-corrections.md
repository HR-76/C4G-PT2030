# Correções da auditoria ao backend

## Critérios de aceitação

- O mesmo comando de testes backend descobre os ficheiros `*.test.js` na raiz de `backend/test` e nos seus subdiretórios em Windows e no CI Linux.
- O job frontend do CI instala as dependências do módulo backend que a suite importa num checkout limpo.
- Os artefactos com checksum mantêm os bytes originais em Windows e Linux.
- A exportação XLSX apresenta o prazo oficial, o fecho previsto da revisão central guardada quando aplicável, ou «Não indicado». Preserva a autorização, a validade do relatório, a auditoria e a precisão dos orçamentos.
- A consulta de exportação devolve apenas os campos do ficheiro. Se o relatório exceder 10 000 candidaturas, a exportação é recusada sem devolver linhas. Cada processo admite até duas exportações em simultâneo e até uma por organização. Quando a capacidade está ocupada, a API devolve HTTP 429 e o utilizador pode repetir o pedido.
- `/health/db` preserva a resposta de diagnóstico da Central e partilha a sonda com `/health/ready`, com cache curta, timeout e coalescência. A validação de arranque continua a consultar a Central diretamente.
- A vista «Por estado» usa os agregados do servidor e apresenta indisponibilidade quando esses agregados estão ausentes. Os detalhes e a exportação continuam disponíveis segundo os respetivos contratos.
- O runtime local escuta no loopback IPv4 alcançado por `host.docker.internal`. O Nginx entrega respostas JSON da API em `/api`, preserva a descoberta OIDC e a API direta passa a `READY` após validar os serviços e abrir o listener.

## Verificação

- Backend com 82 testes focados aprovados e suite completa com 2941 aprovados, 7 ignorados e zero falhas. O padrão do Node encontra 393 ficheiros na raiz de `backend/test` e 14 nos subdiretórios.
- A primeira suite completa identificou oito falhas de integridade de ficheiros na cópia de trabalho. Os bytes foram repostos segundo os checksums existentes e os atributos Git preservam a representação original nos próximos checkouts.
- Frontend com 959 testes aprovados e build Vite concluído. Sintaxe JavaScript e `git diff --check` verificados.

### PostgreSQL, Linux e proxy local

- O [gate de exportação](../../test/integration/report-export/gate.ps1) criou um PostgreSQL 17 descartável com porta dinâmica de loopback e removeu o contentor após a prova. Os quatro testes passaram. As tabelas temporárias exercitaram a consulta real, o XLSX, a seleção por organização, a precisão decimal, o identificador obsoleto, a falha de auditoria e a recusa de 10 001 candidaturas sem devolver linhas para o ficheiro. A primeira execução identificou uma coluna em falta na fixture, entretanto alinhada com a migração 027.
- A etapa `npm test` passou em Linux com Node 24.13.1 e a shell do contentor. Resultado de 2942 aprovados, 9 ignorados e zero falhas. Os testes SQL optativos foram executados separadamente no gate. Durante esse ensaio, a branch remota `main` ainda apresentava o script anterior.
- A regressão da sonda foi reproduzida com a fachada de observabilidade usada pela API. A rota preserva os estados individuais da Central e do tenant quando estes são observados e partilha a mesma verificação com `/health/ready`. Os 63 testes focados de reporting e observabilidade passaram.
- Antes da correção, o Nginx servia a descoberta OIDC por HTTPS com HTTP 200, mas devolvia HTTP 502 em `/api/auth/session` por ligação recusada ao upstream. O acesso direto a `/health/ready` devolvia HTTP 503 com `STARTING`. Uma sonda efémera confirmou que o Nginx em Docker Desktop alcança o loopback IPv4 e que a API ativa estava vinculada a `::1`.
- O runtime local escuta agora em `127.0.0.1` e ativa a observabilidade após abrir o listener. A mesma alteração foi aplicada ao ficheiro do runtime na cópia ativa `GCNI_C4G`, recarregada pelo Nodemon. Após o reload, Nginx e Vite devolveram HTTP 200 com `ready: true` em `/api/local-health` e HTTP 401 em JSON com `no-store` em `/api/auth/session` sem sessão. A descoberta OIDC devolveu HTTP 200 por HTTPS. As sondas diretas devolveram HTTP 200, com `READY` na prontidão e Central e tenant saudáveis no diagnóstico.
- Após a correção do arranque local, os 31 testes focados passaram. A suite backend teve 2943 aprovados, 9 ignorados e zero falhas. Os 959 testes frontend e o build passaram.
- O run remoto anterior falhou em `OpportunityFirstAnalysis.test.jsx` por falta de `ajv/dist/2020`. A suite carrega o modelo de leitura do backend. O job frontend instala agora as dependências de runtime do backend a partir do respetivo lockfile.
