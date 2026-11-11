# Entrega 3 — preparação do transporte de anexos

2026-10-17 — In Progress. **Anexos reais ainda não operacionais.**

## Trabalho realizado

- Substituído o stub R2 por adaptador S3 com SDK oficial, credenciais explícitas e prefixo por organização, upload condicional, hash/tamanho, limites de memória/concorrência, multipart, leituras limitadas, download assinado de duração limitada e erros sanitizados. Multipart permanece condicionado a prova real de criação condicional, não inferida de testes locais.
- Implementado adaptador ClamAV INSTREAM de loopback: verifica conteúdo contra tamanho/hash confirmados, resposta terminal, timeout e resultado; erros e conteúdo inseguro não ficam disponíveis. Inspeção estrutural OOXML continua pendente e o bloqueio F11 foi preservado.
- Upload F11 passa hash/MIME esperados ao armazenamento; scan F11 passa tamanho/hash confirmados ao scanner. Sem mudança de grants, recurso de autorização, estados persistidos ou esquema.
- Corrigida falsa prontidão do bootstrap: flags válidas já não podem produzir `ready: true` enquanto devolve portas nulas e zero handlers.
- Diagnóstico de presença e template de configuração privada. Utilizador confirmou ausência de R2 e antivírus configurados.

## Validação executada

`node --test --test-isolation=none backend/test/f11RealTransportAdapters.test.js backend/test/f11PrivateDocumentStorage.test.js`: **39/39 PASS**. Prova em `output/validation/application-attachments/transport-tests.txt`.

Os testes novos usam comandos SDK simulados e daemon TCP de protocolo simulado; não são provas de R2 ou de um motor antivírus real. Cobrem isolamento de prefixos, colisão condicional, limites e aborto, integridade, leitura truncada, duração da assinatura, concorrência entre instâncias, falhas de provider, respostas de scanner, hash da stream e OOXML sem inspeção.

Atualizada a expectativa global de eventos F7 de 108 para 111: os três eventos de candidatura já existiam antes deste incremento. Os nove eventos F11 e as suas propriedades continuam verificados; nenhum evento foi acrescentado nesta execução.

`node --check` nos JavaScript alterados e `git diff --check` dos ficheiros tracked do incremento: PASS. Diagnóstico guardado em `output/validation/application-attachments/infrastructure-status.json`, com todas as configurações ausentes e `ready: false`. Saúde habitual `http://localhost:5000/api/local-health`: HTTP 200, ready/workerReady true; isto apenas confirma a aplicação existente, não documentos.

## Limites e trabalho em falta

Não foram alterados frontend, dados de negócio, migrations, grants ou arranque do ambiente habitual. Sem build frontend/comparação visual novos porque nenhuma interface foi alterada; não existe ainda percurso real a demonstrar. Não se voltou a executar integração PostgreSQL, por não haver alteração de persistência ou autorização neste incremento. A autorização do domínio continua a depender dos serviços atuais, não do prefixo R2.

Faltam configuração e validação de serviços reais, composição APPLICATION/F11/F7/F9 com confirmação/reconciliação, endpoints de intent/conteúdo/estado/download, inspeção OOXML e recuperação da interação original na interface. A validação de domínio/API em duas organizações, revogação e revisão interna deve ser repetida com essa composição antes de ativar. A entrega 3 não está concluída, e as entregas 4–5 não foram iniciadas.

Contrato e configuração: [transporte de anexos](../references/application-attachments-transport.md).

## DOC-MVP-01 — Grupo C e HTTP-DOC-REV-01 (2026-10-24)

O Grupo C fica fechado no seu âmbito comportamental, sem equivaler a prontidão para piloto. A evidência preserva o resultado original `R2_SIGNED_EXPIRY_NOT_PROVEN` e a reavaliação posterior: a mesma capacidade assinada foi aceite antes do limite e recusada depois, enquanto o objeto e as credenciais autenticadas continuavam válidos. O código e a mensagem causais devolvidos pelo fornecedor não ficaram preservados, pelo que não se declara causalidade inequívoca. O classificador local passou a reconhecer o código Cloudflare documentado `ExpiredRequest`, sem aceitar genericamente qualquer HTTP 403; não houve nova chamada R2 nem alteração dos artefactos históricos.

O finding `HTTP-DOC-REV-01` foi corrigido e validado localmente. O contrato público distingue: sessão inválida/expirada → `401 SESSION_REQUIRED`; sessão válida com membership removida/inativa ou grant documental insuficiente → `403 NOT_AUTHORIZED`; recurso estrangeiro/inexistente após autorização → `404 RESOURCE_NOT_AVAILABLE`; indisponibilidade efetiva da autoridade → `503 SERVICE_UNAVAILABLE`. A recusa de acesso ocorre antes de lookup, assinatura ou storage. A interface deixa de incentivar repetição após 401/403 e preserva uma intenção de escrita incerta em 403 para recuperação depois de restaurar sessão e organização; 503 mantém o percurso idempotente de confirmação.

Validação local desta correção: sintaxe JavaScript PASS; transporte/autoridade documental e gate de expiração **23/23 PASS**; membership e middleware **19/19 PASS** dentro da execução dirigida de **34/34 PASS**; regressões de candidaturas/F5/sessão **58/58 PASS**; interface documental **6/6 PASS**; build frontend PASS; `git diff --check` dos caminhos deste incremento PASS. Nenhum serviço, migration, base de dados, browser ou acesso remoto foi executado.

A conclusão multipart preserva a fronteira exata: foram comprovadas a conclusão normal e a recuperação após reinício com abort da sessão expirada pelo UploadId persistido; não foi comprovada retoma e conclusão de um upload interrompido. Permanecem pendentes inspeção estrutural OOXML, IdP real, worker supervisionado, percurso no browser e remediação de instalações históricas quando aplicável.
