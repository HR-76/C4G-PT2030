# Retenção do chat da candidatura

Estado: **Review** — código e migração 040 prontos e provados em PostgreSQL descartável; migração 040 aplicada à base local em 11/11/2026; executor periódico decidido e implementado, ainda sem tarefa registada.

## Decisão de produto (11/11/2026)

Motivo: o chat é uma conversa por candidatura, com mensagens imutáveis e sem retenção; o histórico só cresce, mesmo depois de a candidatura fechar. Decisão do utilizador: eliminar o histórico **90 dias depois de a candidatura passar a um estado final**.

- Estados finais: `APPROVED`, `REJECTED`, `CANCELLED`, `ARCHIVED`.
- Marca de tempo: `recorded_at` da última transição (`application_change`, `kind='TRANSITION'`) para o estado final atual. Uma candidatura reaberta (estado deixa de ser final) deixa de ser elegível e o prazo recomeça se voltar a fechar.
- Nunca se elimina o chat de candidaturas ativas (`IDENTIFIED`, `INTENTION`, `PREPARATION`, `SUBMITTED`).
- Prazo mínimo **fixo em 90 dias** na própria política da base de dados; uma configuração só pode aumentá-lo.
- A eliminação é automática (quando o executor periódico corre), não por ação manual. Isto é uma exceção deliberada à regra «arquivar em vez de eliminar automaticamente», limitada ao texto do chat e confirmada pelo utilizador.
- Antes da eliminação, qualquer membro da equipa pode **exportar a conversa** (ficheiro de texto) a partir do painel.

## Critérios de aceitação

- Só mensagens e recibos de candidaturas elegíveis são eliminados, e por inteiro (por candidatura), na mesma transação. Nenhuma outra tabela é alterada.
- Cada eliminação fica registada em `application_chat_purge` (candidatura, organização, número de mensagens, estado final, quando fechou, quando se eliminou), sem o texto. O registo é imutável.
- O runtime da aplicação continua sem permissão de `DELETE`; o caminho de eliminação é uma função própria, sem acesso público, executável apenas por um papel dedicado. A imutabilidade de qualquer outro uso das tabelas mantém-se.
- Depois da eliminação o painel indica que a conversa foi eliminada e quando, em vez de mostrar uma conversa vazia sem explicação.
- A eliminação é idempotente, limitada por lote, e isolada por organização.
- Testes demonstram: candidatura ativa e fechada há menos de 90 dias intactas; exatamente 90 dias elegível; reaberta não elegível; recibos eliminados com as mensagens; registo imutável e sem texto; runtime sem `DELETE`; outro papel sem execução; repetição sem efeito.
- A validação PostgreSQL usa somente infraestrutura descartável explicitamente autorizada.

## Implementação (11/11/2026)

- Migração `backend/database/tenant/migrations/040_application_chat_retention.up.sql`, ordinal 40, **irreversível, sem `down`**, registada no manifesto (`chatRetentionManifest`, capacidade `APPLICATION_CHAT_RETENTION`). Cria a tabela imutável `application_chat_purge`, o papel `c4g_chat_retention_runtime` (NOLOGIN), um guarda próprio para as tabelas do chat e a função `purge_closed_application_chat_v1(organização, dias, limite)`. O guarda partilhado das tabelas F13 não foi alterado. O preflight reconhece a tabela nova (`tenantMigrationPreflight`). Como a 039, a 040 é reconhecida mas **não exigida** pelo runtime (continua a 038).
- Serviço `backend/src/applications/chatRetention.js` (`runOnce`): uma transação por lote com o papel dedicado; recusa menos de 90 dias; reverte e liberta a ligação se falhar.
- Exportação: botão «Exportar conversa» no painel (`chatExport.js`), que descarrega um `.txt` com todo o histórico (hora de Lisboa) e aviso de que as conversas fechadas são eliminadas ao fim de 90 dias.
- Testes: `chatRetention.test.js` (serviço, registo, SQL) e `chatExport.test.jsx`.

## Validação em PostgreSQL 17 descartável (11/11/2026)

`test/integration/chat-retention/proof.js`: contentor próprio em `127.0.0.1`, removido no fim; **19 verificações PASS**, sem bases habituais, R2 ou fornecedores. O runner oficial aplica a 040 (fingerprint e ledger conferem; repetir é no-op); fechada há 91 dias e há exatamente 90 dias são eliminadas; fechada há 30 dias, ativa e reaberta ficam intactas; recibos saem com as mensagens; outra organização intacta; registo sem texto e imutável; o runtime da aplicação não faz `DELETE` nem executa a função; outros papéis não executam; menos de 90 dias e lotes fora de limites recusados; repetir não tem efeito; `DELETE` direto fora da função continua recusado; uma candidatura fechada de novo recomeça os 90 dias.

## Execução periódica (decidida a 11/11/2026)

Executor: comando de uma só execução, diário às 03:00 de Lisboa, lançado pelo agendador do sistema (tarefa do Windows no perfil local; timer systemd no VPS). Alternativas descartadas: ciclo dentro do worker (os workers atuais não têm credenciais de tenant para isto) e job na fila central pg-boss (alinhado com a arquitetura, mas exige ativar o agendamento, novo tipo de job e linhagem; reavaliar quando houver um agendador central). O serviço é reutilizável por esse job no futuro.

Implementado: `chatRetentionRunner.js` (lotes, isolamento por organização, só contagens nos registos), adaptador local `scripts/localPlatform/chatRetentionRun.js` (`--check` não elimina) e registo da tarefa `scheduleChatRetention.ps1`. Operação: [runbook](../runbooks/chat-retention.md).

## Pendentes

- **Tarefa do Windows por registar** e **primeira execução por fazer**: dependem de autorização expressa. A primeira execução cria um registo permanente em `application_chat_purge` para cada candidatura final com mais de 90 dias.
- **Produção (VPS):** falta o adaptador de organizações e credenciais, o login por tenant só com o papel de retenção e aplicar a 040 em cada tenant. Ver o runbook.
- **Sem aviso «conversa eliminada em …» no painel:** o painel mostra «Ainda não há mensagens» depois da eliminação. Fica por fazer: `chatGet` ler `application_chat_purge` quando a 040 existir.
- A estimativa de custo (≈2,5 KB por mensagem) é uma estimativa; a base local tinha 0 mensagens.
