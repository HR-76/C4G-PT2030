# Funding & Tenders — primeira fatia central

2026-10-17 — implementação local com fixtures validada; recolha real limitada autorizada e executada. Contrato: [critérios FT-01–10](../../features/funding-tenders-central-first-slice.md). Marco obrigatório do MVP: demonstrar oportunidades reais no percurso completo antes do piloto. O browser com registos reais continua por comprovar.

## Fontes existentes e estado

| Fonte | Endpoint / código existente | Estado nesta entrega |
| --- | --- | --- |
| EU Funding & Tenders | POST `https://api.tech.ec.europa.eu/search-api/prod/rest/search`; legado `backend/src/services/euFundingSyncService.js`; nova composição `backend/src/fundingTenders/` | Percurso central comprovado com fixtures; uma recolha real limitada foi executada no destino descartável autorizado. O serviço UBI antigo continua legado. |
| CORDIS | Mesmo SEARCH; `cordisSyncService.js` | Legado; não ativado. Tratar como possível filtro da mesma fonte, sem recolha sobreposta. |
| Erasmus | Mesmo SEARCH; `erasmusSyncService.js` | Legado; não ativado. Mesmo cuidado com filtros/sobreposição. |
| Interreg Europe | `https://www.interregeurope.eu/sites/default/files/2024-08/Calls_planning_web.xlsx`; `externalOpportunitySyncService.js` | Download XLSX legado, não API; ficheiro fixo de 2024. Não migrado nem executado. |
| POCTEP | `https://www.poctep.eu/proximas-convocatorias/`; `externalOpportunitySyncService.js` | Extração HTML legada, não API; não migrada nem executada. |
| Importação XLSX F12 | Upload interno / worker de importação existente | Fluxo privado separado; não satisfaz o marco de integração API. |

Inspeção inicial de `.env.local`: autenticação legacy, seeds sintéticas, cron europeu e notificações desativados. Não foi alterado. A aplicação habitual não passa automaticamente a usar a nova fatia. O harness configura explicitamente OIDC simulado, F12, Central e A/B descartáveis. Não foram inspecionados nem alterados dados de produção. Nenhum segredo é necessário neste documento.

## Composição entregue

- `productionComposition.js` monta `GET/POST /api/admin/integrations/funding-tenders` e `GET /api/central-opportunities[/:id]` quando `FUNDING_TENDERS_RUNTIME=central`, exigindo OIDC e F12. Desliga cron e endpoints de sincronização legados nessa composição. Não foi criado agendamento de recolha.
- ADMIN consulta atribuição central ativa `C4G_ADMIN`, utilizador ativo e sessão autenticada; POST exige MFA recente existente. Atribuições são novamente verificadas no worker e bloqueadas durante commits. A role legacy ou uma membership ORG_ADMIN não concedem o poder. O browser aplica também a guarda de plataforma, mas o servidor é a autoridade.
- POST cria uma intenção, outbox e auditoria na mesma transação. Exclusão por fonte, chave de intenção, índice único da execução ativa e fencing impedem duplo processamento. O worker separado consome pg-boss através de F9, com envelope v3 estritamente limitado a esta operação central e sem tenant fictício. O polling do worker não agenda novas recolhas.
- `source.js` reaproveita a consulta e o vocabulário de programas UBI, retirando dependências de pool legacy/notificações. Limites gerais: 100 resultados, 25/página, 4 páginas, 15 s/pedido, 120 s/recolha, 2 MiB/resposta, até duas repetições HTTP. O runtime local limita adicionalmente a cinco resultados e uma página. 429 respeita Retry-After dentro do orçamento; falhas são sanitizadas.
- `repository.js` usa o catálogo F12 central, identidade única de fonte, staging durável, revisões/proveniências imutáveis, observações por execução e contadores transacionais. A origem contém `EU_FUNDING_API`, namespace, identificador externo, URL quando fornecido e data da recolha. Ausência de resultados nunca elimina oportunidades. Resposta idêntica não cria revisão redundante.
- Correções manuais prevalecem por campo, incluindo remoção explícita. Uma nova correção substitui a anterior; restantes campos acompanham a API. A observação da fonte e os conflitos permanecem separados do valor efetivo. Não foi acrescentado editor de correções.
- As candidaturas guardam no tenant a identidade central, revisão exata e snapshot público; equipa, tarefas, documentos, interpretações e decisões mantêm os repositórios e guardas privados. Nenhum dado de trabalho é escrito no catálogo central. A criação usa os grants e responsável existentes. Uma revisão alterada entre navegação e formulário obriga a reabrir o catálogo.
- Migrations: Central `015_funding_tenders_central`, tenant `024_application_central_origin`; runners canónicos e fingerprints. Sem down destrutivo automático: exigem plano de arquivo/migração. Alterações publicadas anteriores e histórico preservados.

## Provas executadas

| Verificação | Resultado / alcance |
| --- | --- |
| `core.ps1` | PASS, PostgreSQL 17 descartável: migrations canónicas Central+A/B, preflight, autorização, concorrência, fila pg-boss, deduplicação, revisões, correções manuais, ausências e erro parcial. |
| Retoma | PASS: erro transitório após primeiro commit, novo worker reutiliza staging; contadores finais 2 criadas/1 inválida, sem observações duplicadas. |
| Processo separado e crash | PASS: entrada real `backend/src/worker.js`; processo filho morto após primeiro commit e retoma pelo seguinte. Só a condição temporal das leases foi antecipada na fixture, sem esperar 150 s. |
| `flow.ps1` | PASS: HTTP real da composição OIDC/F12 e Chrome; ADMIN inicia/acompanha, clientes recusados, revogação ADMIN recusada, A/B veem a mesma oportunidade, criação/repetição de candidatura A, B não lê nem lista candidatura A. |
| Backend selecionado | 115/115 PASS: Funding, F9, F7, candidaturas, manifests, domínio F12 e paridade de composição. Alguns testes antigos apenas verificam a guarda de execução das integrações; as provas PostgreSQL acima foram executadas separadamente. |
| Frontend | 91/91 PASS na suite existente; build Vite PASS. Chrome integrado cobre as páginas novas. |
| Sintaxe | `node --check` PASS em 31 ficheiros do recorte e dependências alteradas. |

Comandos, a partir da raiz, sem alterar o ambiente habitual:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/funding-tenders/core.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/funding-tenders/flow.ps1
```

Requer Docker disponível, imagem `postgres:17-alpine`, dependências já instaladas em backend/frontend/test-harness e Chrome em `C:/Program Files/Google/Chrome/Application/chrome.exe`. Portas locais 5558/5559 e 5188 livres. Cada harness cria e remove apenas o seu contentor descartável e gera credenciais efémeras sem as imprimir. Não usa credenciais do `.env.local`.

## Abrir ADMIN e clientes

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/funding-tenders/flow.ps1 -Demo
```

O modo Demo usa a mesma prova e mantém o Chrome visível no fim, com três contextos de sessão separados, em `http://localhost:5188`: ADMIN em `/integracoes`, cliente A em `/candidaturas`, cliente B em `/catalogo/:id`. O ADMIN pode voltar a usar **Atualizar agora**; o worker continua a consumir a fila. Clientes usam **Catálogo comum** → detalhe → **Criar candidatura nesta organização**. `/oportunidades` continua a identificar oportunidades privadas. Não reutilizar o cookie de uma janela noutra. Fechar o Chrome termina o modo Demo e limpa as bases descartáveis. O percurso headless foi executado; a opção de manter as janelas abertas é conveniência operacional ainda não exercitada manualmente.

Para uma composição local existente, além das suas configurações OIDC/F4/F12, são necessários `FUNDING_TENDERS_RUNTIME=central`, `FUNDING_TENDERS_SOURCE=fixture`, migrations acima, queue pg-boss `funding-tenders-refresh`, atribuição C4G_ADMIN e worker separado. O worker exige `NODE_ENV=development` e Central loopback. Credenciais de tenant continuam exclusivas da configuração F4; não são credenciais da fonte pública.

## Ensaio real autorizado e executado

Fonte: SEARCH pública EU Funding & Tenders, endpoint acima. Limite: **uma página, no máximo cinco resultados**, com timeout e até duas repetições apenas em falha. Destino: **PostgreSQL descartável `127.0.0.1:5560/funding_live_rehearsal`**, contentor novo `c4g-funding-live-rehearsal-<PID>`. Sem produção ou fontes privadas; remoção apenas desse contentor no fim. O script verifica configuração, migra, prepara fila, executa o mesmo worker, lê listagem/detalhes persistidos e apresenta contadores sanitizados. Não comprova por si só browser com dados reais.

Executado com `test/integration/funding-tenders/rehearsal.ps1 -AuthorizeFivePublicRecords`, após autorização explícita do utilizador em 2026-10-17 para esta fonte, limite e destino. Resultado sanitizado: `SUCCESS`, cinco criadas, zero atualizadas, zero falhadas, cinco listadas, cinco detalhes lidos depois da persistência. O comando terminou com código 0 e o contentor descartável foi removido. O transporte real mantém a guarda de destino, porta e autorização. Esta autorização cobriu este ensaio; uma nova recolha não é necessária para a validação aqui descrita.

[Documentação oficial consultada](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis): SEARCH por POST e parâmetro público da aplicação portal (`SEDIA`), não uma chave privada de uma organização. Não se adicionaram credenciais fixas privadas. Quotas, SLA e condições completas de reutilização não ficaram estabelecidos pela página consultada; confirmar antes de operação continuada. A recolha limitada não representa catálogo integral nem garante elegibilidade. UI em português; conteúdo da fonte solicitado em inglês.

## Limitações e próximo marco

- Cinco registos reais da API foram recolhidos e lidos na base descartável. Browser com esses registos, staging, IdP externo e produção não foram validados. A base Central do harness usa provisionador local; não constitui certificação de privilégios mínimos de deployment. Tenants A/B usam identidades limitadas existentes. Configuração produtiva de papéis/segredos/pg-boss continua a exigir o gate de deployment existente.
- Isolamento de candidaturas A/B foi comprovado nesta fatia; não foram repetidos integralmente os percursos privados de documentos, tarefas e decisões. Mantêm as suas guardas e as limitações documentadas nas fatias anteriores.
- Não existe nesta fatia gestão de fontes privadas por tenant. Os conectores antigos não foram considerados compatíveis por defeito, nem ativados.
- Revisão final do recorte não encontrou blocker adicional para demonstração local com fixtures. O ensaio real comprovou API → worker → persistência → leitura pelo repositório de listagem e detalhe; a apresentação de registos reais no browser permanece por verificar para fechar o marco antes do piloto. Agendamento continua adiado.
- Sem stage, commit, push, deploy ou alterações ao residual fora das adaptações necessárias e identificadas da composição, contratos e harnesses.

Next step: demonstrar no browser os registos reais do catálogo, em novo ambiente local descartável autorizado, antes do piloto.
