# Cópias de segurança do staging para o R2

Estado: Review (13/11/2026), por validar na VPS. Pedido do utilizador: agendamento e teste de restauro, com as cópias numa pasta do R2 já ligado. Ambiente: [staging na VPS](staging-vps-deployment.md). Operação: [runbook](../runbooks/staging-backups.md).

## Decisões do utilizador (13/11/2026)

- As cópias vão para o **R2 já ligado**, numa **pasta** própria para backups.
- Agendamento diário e teste de restauro.

## Decisões técnicas (a confirmar com o utilizador no que está marcado)

- **Pasta:** prefixo `backups/staging/` dentro do bucket de documentos (`C4G_R2_DOCUMENTS_BUCKET`). O token R2 atual só cobre os dois buckets existentes; uma «pasta» no R2 é um prefixo, não um objeto. O prefixo é distinto dos do código de documentos (`central/…` e `<organização>/…`). O bucket de quarentena fica de fora.
- **Conteúdo:** `pg_dump -Fc` da Central e do tenant do staging, cifrado antes de sair da VPS (`openssl enc -aes-256-cbc -pbkdf2`), mais um manifesto JSON por cópia (eventos de auditoria e número de tabelas no momento da cópia). Nada do conteúdo viaja em claro.
- **Chave de cifra:** ficheiro `600` só do root na VPS. **A cópia da chave tem de existir fora da VPS** (gestor de palavras-passe do utilizador); sem ela, perdida a VPS, as cópias não se abrem. A chave nunca entra no Git, em logs ou em saídas.
- **Retenção:** 14 cópias diárias e 8 semanais (a mais recente de cada semana ISO); a mais recente nunca se apaga; só se apagam objetos que o código reconhece sob o prefixo. A limpeza é simulação por omissão e exige `--apply`.
- **Agendamento:** temporizador systemd diário às 02:30 UTC (fora de 03:00, retenção do chat, e 04:00, recolha) com `Persistent=true`; teste de restauro semanal ao domingo às 05:30.
- **Teste de restauro:** descarrega a última cópia, decifra, restaura num PostgreSQL 18 **descartável** (contentor sem rede, removido no fim), verifica que o restauro termina sem erros, que os eventos de auditoria restaurados não são menos do que os registados no manifesto e que o número de tabelas coincide. Não substitui um ensaio de recuperação completo.
- **Fora de âmbito:** a base do Keycloak (`c4g-staging-keycloak-db-1`: contas e realm) **não** fica coberta neste passo. Perdê-la significa perder as contas de login; fica como seguimento a decidir.

## Critérios de aceitação

- O cliente R2 só lê e escreve chaves sob o prefixo configurado; recusa nomes de base, carimbos e prefixos inválidos.
- Cada cópia é verificada depois do envio (tamanho e SHA-256 em metadados).
- A retenção apaga só o que o plano indica e nunca a cópia mais recente de cada base.
- O estado (`status`) falha se a última cópia de uma base tiver mais de 36 h ou faltar.
- O teste de restauro termina sempre sem contentores nem ficheiros temporários e devolve código diferente de zero em qualquer falha.
- Nenhum comando imprime credenciais, chave de cifra ou ligações.

## Limites conhecidos

- A cópia fica no mesmo bucket e com a mesma credencial que a API de documentos. Quem tiver essa credencial pode apagar as cópias. Recomenda-se, mais tarde, um bucket e um token só para backups (com versionamento ou bloqueio de objetos).
- O restauro de teste cria os papéis `c4g_*` (só nomes, vindos do manifesto) sem login e restaura com donos, permissões e políticas RLS. Não replica as pertenças entre papéis nem as palavras-passe.
- Objetos enviados numa só chamada (sem multipart): limite de 500 MB por cópia nesta versão. As bases do staging têm alguns MB.

## Resultado (13/11/2026)

- **Código:** `backend/src/backups/r2Backups.js` (configuração, chaves, retenção, cliente R2 com verificação, estado e limpeza) e `backend/scripts/staging/r2Backup.js` (linha de comandos); `deploy/staging/backup/` com `backup.sh`, `restore-test.sh`, `common.sh` e as unidades systemd (diário 02:30 UTC; restauro semanal ao domingo 05:30 UTC). [Runbook](../runbooks/staging-backups.md).
- **Provas:** 11 testes novos em `stagingBackups.test.js` (configuração, chaves, retenção, cliente com R2 simulado, linha de comandos e códigos de saída); lint limpo, backend 3177 aprovados, 9 ignorados, 0 falhas. Lógica de manifesto, cifra (chave errada recusada), criação dos papéis a partir do manifesto, restauro com donos, permissões e política RLS e verificação das contagens, provada com as mesmas consultas num par de PostgreSQL 18.3 descartáveis nesta máquina (removidos no fim).
- **Não provado:** os scripts de shell não correram de ponta a ponta (sem Docker nesta máquina, só `bash -n`); o envio real ao R2 (permissão de apagar do token incluída); o agendamento na VPS; o teste de restauro dentro do contentor `postgres:18`. O primeiro ensaio na VPS é a prova.
- **Por decidir:** backup da base do Keycloak; bucket e token só para backups (versionamento ou bloqueio de objetos).
