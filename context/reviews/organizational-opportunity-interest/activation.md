# Preparação da ativação no ambiente habitual

**Estado atual: ATIVADO em 30/10/2026.** [Ativação, recuperação e prova final](activation-completed.md). O conteúdo abaixo documenta a preparação anterior e não representa o estado atual.

**Janela e renovação concluídas:** [prova](maintenance-window.md), pausa22:03:02–22:03:39 UTC em30/10, backups/restauro PASS sem divergência em ambas as bases. Plano renovado e serviços retomados. A ativação continua pendente; revalidar imediatamente na próxima janela antes de aplicar.

**Atualização posterior — backups/restauro:** [prova concluída](backup-restore.md), PostgreSQL18 isolado PASS, 210 tabelas, preflights Central035/tenant030. Pacote protegido inclui suplemento de 16 ACLs explícitas necessário para equivalência estrita. Instâncias encerradas; nenhuma ativação executada. A Central manteve atividade normal: renovar os backups na janela sem writers antes da ativação.

Data: 30/10/2026. Pedido: preparar a migração e as permissões, mantendo o ambiente inalterado. **Resultado atualizado: compatibilidade resolvida e ensaio aprovado; ativação pendente.** Nenhuma migração, grant, conta, serviço ou configuração ativa foi alterada.

## Observação efetiva

Consulta exclusivamente de leitura em PostgreSQL local `localhost:5432`: Central `c4g_central_dev`, tenant `c4g_tenant_dev`. Configuração e credenciais lidas em memória; sem divulgar segredos. Ligações configuradas com `default_transaction_read_only=on`, timeouts e transações READ ONLY terminadas em ROLLBACK.

- Central: `035_funding_source_resolution`. Não há migração Central prevista neste incremento.
- Tenant: `030_organization_notices`, não 032. Fingerprint físico canónico `518daabb394601fe785442c80ea83349135908c1331c60fe9f59e56683dd5712`.
- Ledger: digest `4dc1dc0d4b91d822c27b5a996b4a8ca051bc621edc5122970aeee9d572c4c46d`, correspondente à baseline histórica documentada em [transição de ownership](../../features/local-tenant-ownership-compatibility.md). A preparação inicial recusava-o com `TENANT_LEDGER_MISMATCH`; a reconsulta após correção passou (ver resultado atualizado abaixo).
- Diretório Central: schema030, `COMPATIBLE`, revisão 3. Binding API `AVAILABLE`, revisão 2, fence 1. O runtime usa o diretório Central (`memberAccess=true`); atualizar apenas o JSON local seria insuficiente. O snapshot local também indica 030.
- Uma membership elegível, perfil `ORG_ADMIN`, versão de autorização 5. Acrescentar apenas `opportunity_interest.read`, `opportunity_interest.register`, `opportunity_interest.manage`. Nenhuma nova conta, mudança de perfil, equipa ou acesso por unidade.
- As seis tabelas de candidaturas/recibos/equipa/relação histórica inventariadas têm zero linhas. Isto não significa que o tenant inteiro esteja vazio: unidades, pessoas, perfis e restantes dados devem ser integralmente preservados.

O plano privado com IDs exatos, versões esperadas, digest dos grants/política/assurance, checksums de migrações e contagens está em `.tmp/local-platform/opportunity-interest-activation-plan.json`. Não contém passwords, tokens ou strings de ligação. É uma observação datada, não um lock nem um backup; deve ser renovado imediatamente antes de aplicar.

## Artefacto de preparação

```powershell
node backend/scripts/localPlatform/prepareOpportunityInterests.js --prepare
```

O comando recusa `--apply`, flags desconhecidas e destinos alternativos. Não importa um executor de migração, não faz ALTER/UPDATE/INSERT, não inicia serviços e não grava a configuração ativa. Guarda apenas o plano privado. Status atualizado: `PREPARED_DEPENDENCIES_IDENTIFIED`; 1 membership a alterar, 3 permissões em falta.

Critérios: destino fixo e identidade conferida; leitura protegida pelo servidor; grant adicional mínimo por perfil; preservar grants não relacionados; recusar autoridade ausente, perfil desconhecido e grants de interesses excessivos; nenhuma admissão operacional com preflight falhado. Seis testes automatizados e sintaxe validam estes limites.

## Condições antes de autorizar a execução

1. **Conclu?do em 30/10:** resolver a compatibilidade estrita da baseline histórica no percurso normal de preflight/runner, preservando os registos existentes do ledger. Não atualizar fingerprints históricos, substituir checksums ou fazer bypass do verificador. A função de ownership já tem o resultado físico canónico; não executar novamente uma alteração de owner por inferência.
2. **Concluído, 19 checks PASS:** ensaiar em ambiente descartável a passagem efetiva **030 → 031 → 032 → 033**, incluindo o ledger histórico exato, rollback, repetição e preservação de dados. Os 13/15 checks anteriores validam a candidata033 a partir de032; não são prova desta baseline histórica.
3. Validar as dependências:031 acrescenta transporte de documentos;032 acrescenta runtime do worker de documentos. Aplicar a estrutura não autoriza ativar R2, filas, serviços externos ou workers adicionais. Confirmar ACLs e compatibilidade dos consumidores existentes.
4. Renovar o plano e preparar backup protegido de Central, tenant e configuração privada. Verificar legibilidade dos dumps e restauração numa base isolada antes de qualquer aplicação. Não publicar dumps ou ficheiros privados.

Enquanto estas condições não estiverem satisfeitas, **não existe comando de aplicação liberado**. Não usar `npm run setup:local`: o instalador geral também reconcilia identidades, roles e outros módulos, excedendo o recorte desta ativação.

## Sequência de ativação proposta após validação e autorização

1. Registar baseline de identidade física, ledger, schema, grants e dados; confirmar ausência de divergência face ao plano. Parar apenas os writers habituais abrangidos e aguardar transações em curso. Não terminar processos desconhecidos nem sessões à força.
2. Aplicar exclusivamente as migrações pendentes031/032/033 pelo runner original, com checksum/fingerprint registados e lock de migração. Nenhuma concessão funcional ocorre antes de o preflight final passar.
3. Publicar a observação033 pelo repositório/publisher Central existente, com revisão esperada e auditoria. Reconciliar os metadados do diretório e snapshot local preservando identidades, passwords, refs de credenciais e bindings não relacionados. Uma falha entre tenant/Central/ficheiro exige retoma verificada, não reaplicação cega ou edição manual do ledger.
4. Acrescentar as três permissões à membership identificada, sob `coordinator.write` e locks ORG/MEMBER. Revalidar membership, perfil, validade e digest da autoridade; usar CAS da versão5 observada (ou recusar se mudou). Preservar integralmente grants existentes, política e assurance. Gravar `GRANT_CHANGED` na mesma transação; a repetição não acrescenta duplicados nem aumenta a versão sem alteração. Não substituir todos os grants por `grantsForProfile`.
5. Retomar os serviços abrangidos e verificar o login/organização existente, capacidades e percurso HTTP. A observação do formulário não deve criar interesses ou candidaturas reais; qualquer prova com escrita requer âmbito de dados de teste explícito.
6. Confirmar checksums, fingerprints, ACL/RLS, dados preservados, capability de interesses e ausência de grants noutras memberships. Registar evidência sem segredos.

## Recuperação

Antes do commit, falha de migração termina em rollback pelo runner. A033 é irreversível: depois do commit, não fazer DROP de tabelas nem downgrade improvisado. Manter writers parados e retomar apenas os passos pendentes comprovados ou restaurar backups validados sob autorização própria. Se grants foram confirmados, uma compensação remove só os grants adicionados por este plano, com nova revisão/CAS e auditoria, sem apagar eventos nem reverter outras alterações. Central, tenant e snapshot local têm de ficar coerentes antes de retomar a aplicação.

Condições 1 e 2 concluídas; ver evidência atualizada abaixo.

## Resultado atualizado — compatibilidade e ensaio 030 → 033

Em 30/10/2026, o pedido foi concluído: **19 checks PASS**, cleanup confirmado. Relatório: `output/opportunity-interests-pg-eac59665ab194914b0e9b8c9ec8f642f/verification.json`.

O prefixo histórico exato de 30 entradas é reconhecido sem reescrever o ledger. Entradas posteriores continuam integralmente validadas. O preflight mantém a verificação do schema físico, ownership e ACL/RLS. Corrigida também a seleção imutável do manifest no preparador.

O runner original aplicou031/032/033; repetição sem efeitos. Uma falha injetada antes de033 desfez031/032, dados e ledger. Drift físico e corrupção histórica foram recusados. Todas as colunas das 30 entradas históricas, incluindo timestamps, e os dados anteriores inventariados foram preservados. A reconstrução do ledger histórico acontece apenas na construção inicial da fixture sintética descartável, antes da baseline de preservação; não é um procedimento de reparação do ambiente habitual.

Reconsulta habitual READ ONLY: preflight PASS; schema030, fingerprint, digest do ledger, contagens/digests inventariados, autoridade Central e digest da configuração runtime iguais à observação anterior. Recibo privado: `.tmp/local-platform/opportunity-interest-historical-recheck.json`. Status: `PREPARED_DEPENDENCIES_IDENTIFIED`. Nenhuma migração, grant ou reinício aplicado.

Regressões RED→GREEN; foco histórico/gate/preparador 14 PASS. Backend 1783 PASS, 1 FAIL preexistente em `fundingEnrichmentPersistence.test.js:33`, 7 SKIP. Frontend 461 PASS; build PASS. Logs: `output/organizational-opportunity-interest/*-historical.log`.

Próximo passo: preparar backups protegidos e verificar o restauro isolado antes da ativação autorizada.
