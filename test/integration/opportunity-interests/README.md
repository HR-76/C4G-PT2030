# Gate PostgreSQL de interesses organizacionais

**Executado com autorização explícita em 30/10/2026: medição 13 checks PASS, verificação 15 checks PASS.** Evidência em `output/opportunity-interests-pg-18dd7a60568347909046310933cfb3b9/` e `output/opportunity-interests-pg-82f934d2a9c94c648d4017997129fc13/`. A migration033 está registada com fingerprint medido. Cleanup confirmado em todas as tentativas; bases habituais não alteradas. A execução cria infraestrutura e aplica SQL exclusivamente num PostgreSQL descartável, exigindo âmbito próprio segundo `AGENTS.md`. Os testes unitários não substituem este gate.

## Duas fases

### 1. Medir a migration candidata sem a admitir no runtime

Na raiz do repositório, após autorização explícita:

```powershell
node test/integration/opportunity-interests/gate.js --isolated
```

O gate cria um contentor com imagem **já instalada** `postgres:17-alpine`, identificada pelo digest. Não faz pull. Recusa endpoints Docker remotos, URLs de bases e argumentos desconhecidos. Publica apenas uma porta efémera de loopback, usa armazenamento tmpfs e identifica o contentor por ID, nome e label únicos.

Cria uma base sintética PostgreSQL 17 com ICU `und`, UTF-8 e UTC. Aplica a baseline tenant até `032_document_worker_runtime` pelo runner original e executa o preflight original. Insere unidades e uma candidatura sintéticas para provar preservação. Depois:

1. Abre uma transação e aplica a migration candidata `033`.
2. Mede o fingerprint real e valida roles/ACL/capabilities pelas rotinas originais exportadas de leitura. Não substitui preflight, fingerprint ou validação por stubs.
3. Exercita repositórios reais, RLS com role real, unidades inválidas, CAS, arquivo, histórico, conversão e rollback após escrita F7 real, dentro da transação candidata.
4. Faz rollback e verifica fingerprint `032`, ledger e todos os registos sintéticos anteriores iguais.
5. Executa novamente o preflight normal `032` e destrói o contentor verificado por ID/nome/label.

O fingerprint medido fica em `output/opportunity-interests-pg-<id>/candidate.json`, acompanhado por `verification.json`. Este descritor é apenas evidência para revisão: **não altera o manifest ativo nem produz evidência de capability aceite pelo runtime**. O helper `backend/src/security/opportunityInterestMigrationCandidate.js` nunca admite uma migration automaticamente.

O probe usa `SET LOCAL ROLE c4g_opportunity_tenant_runtime` na sessão instaladora porque o DDL está ainda por confirmar e não é visível a outra sessão. Não declara prova de login runtime independente, concorrência entre sessões ou recuperação após reconexão.

### 2. Verificar a migration já registada com o fingerprint medido

Só depois de revisão da evidência e registo explícito da `033` no manifest, dentro do âmbito autorizado para as duas fases (ou com autorização adicional se só a medição foi autorizada):

```powershell
node test/integration/opportunity-interests/gate.js --isolated --verify
```

Esta fase recusa iniciar se a `033` ainda não for a versão atual do manifest ou o checksum não coincidir com o SQL. Cria outro contentor/base descartável, aplica a baseline `032`, insere a fixture de preservação e aplica a `033` pelo runner original. Não aceita fingerprint por argumento, variável de ambiente ou ficheiro externo.

Executa runner/preflight normais, repetição idempotente do upgrade, preservação de candidatura/recibo anterior, login runtime independente sem superuser/BYPASSRLS/ownership, repositórios/RLS e duas gravações concorrentes da mesma sinalização. Confirma o mesmo recibo numa ligação nova e termina com o preflight original.

## Provas de domínio

- Registar e repetir sem duplicar; uma nova sinalização do mesmo agregado conserva conteúdo.
- Registo recusado pela porta de autorização sintética não escreve.
- Organização B não lê o interesse de A e não escreve sob organização forjada.
- SQL direto recusa associação a TEAM, unidade estrangeira, inexistente ou arquivada; histórico e aggregate não admitem mutações destrutivas pelo runtime.
- Abertura de candidatura com revisão central atual escolhida, mantendo a revisão histórica observada pelo interesse; afetações próprias, equipa explícita, recibo e histórico.
- Edição do interesse não redistribui unidades da candidatura; arquivo conserva registos; CAS e estado terminal são respeitados.
- Unidade arquivada já associada pode ser conservada numa edição de notas. Associação nova e reativação após remoção são recusadas.
- Falha injetada **depois do append F7 real** desfaz aggregate, unidades, histórico, recibo e chain head.

## Limites, duração e artefactos

O gate não liga à Central, Keycloak/OIDC, bases existentes, armazenamento externo ou browser. As portas de autorização, responsável e catálogo central são fixtures declaradas; não prova a integração produtiva F5 nem o transporte HTTP. Não aplica grants em contas reais nem faz deploy.

Credenciais são geradas em memória e passadas ao processo Docker pelo ambiente, sem serem escritas nos comandos, artefactos ou mensagens. Os relatórios não incluem strings de ligação nem mensagens SQL potencialmente sensíveis. Não lê `.env` e não aceita configuração de base externa. Limites: dez minutos entre fases, consultas PostgreSQL com timeout de 15 segundos, ligações de cinco segundos e chamadas Docker de 30 segundos. Todos os passos são limitados; qualquer falha impede declarar PASS.

O cleanup encerra pools, confirma propriedade do contentor e remove apenas o ID com o label/nome esperado; verifica que o ID e o label já não existem. Não usa prune, nomes de contentores existentes ou diretórios Dev. Se a criação terminar sem devolver ID, tenta localizar exclusivamente o label único desta execução. Falha de cleanup fica explícita no relatório e no exit code.

`verification.json` regista checks, modo, limites, hashes dos ficheiros testados, medição candidata quando aplicável e cleanup. Mudança das fontes durante a execução recusa o resultado. Nenhum ficheiro de infraestrutura deste gate é usado pelo runtime habitual.

Validação segura disponível sem infraestrutura:

```powershell
node --test --test-isolation=none backend/test/opportunityInterestsGate.test.js
node --check test/integration/opportunity-interests/gate.js
node --check test/integration/opportunity-interests/proof.js
```

## Executar a baseline histórica

Com autorização explícita:

```powershell
node test/integration/opportunity-interests/gate.js --isolated --historical-030
```

## Resultado atualizado — compatibilidade e ensaio 030 → 033

Em 30/10/2026, o pedido foi concluído: **19 checks PASS**, cleanup confirmado. Relatório: `output/opportunity-interests-pg-eac59665ab194914b0e9b8c9ec8f642f/verification.json`.

O prefixo histórico exato de 30 entradas é reconhecido sem reescrever o ledger. Entradas posteriores continuam integralmente validadas. O preflight mantém a verificação do schema físico, ownership e ACL/RLS. Corrigida também a seleção imutável do manifest no preparador.

O runner original aplicou031/032/033; repetição sem efeitos. Uma falha injetada antes de033 desfez031/032, dados e ledger. Drift físico e corrupção histórica foram recusados. Todas as colunas das 30 entradas históricas, incluindo timestamps, e os dados anteriores inventariados foram preservados. A reconstrução do ledger histórico acontece apenas na construção inicial da fixture sintética descartável, antes da baseline de preservação; não é um procedimento de reparação do ambiente habitual.

Reconsulta habitual READ ONLY: preflight PASS; schema030, fingerprint, digest do ledger, contagens/digests inventariados, autoridade Central e digest da configuração runtime iguais à observação anterior. Recibo privado: `.tmp/local-platform/opportunity-interest-historical-recheck.json`. Status: `PREPARED_DEPENDENCIES_IDENTIFIED`. Nenhuma migração, grant ou reinício aplicado.

Regressões RED→GREEN; foco histórico/gate/preparador 14 PASS. Backend 1783 PASS, 1 FAIL preexistente em `fundingEnrichmentPersistence.test.js:33`, 7 SKIP. Frontend 461 PASS; build PASS. Logs: `output/organizational-opportunity-interest/*-historical.log`.

Próximo passo: preparar backups protegidos e verificar o restauro isolado antes da ativação autorizada.
