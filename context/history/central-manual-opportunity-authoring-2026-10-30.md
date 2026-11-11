# Fecho — criação manual de oportunidades no Admin C4G

Complete em 30/10/2026, por aceitação explícita do utilizador. [Contrato e evidências](../features/central-manual-opportunity-authoring.md).

Criação manual exclusiva da Administração C4G no catálogo comum para fontes sem API. Clientes consultam oportunidades e mantêm qualificação/candidaturas; escritas privadas bloqueadas, dados históricos preservados. Pedidos incertos conservam chave, campos e recibo por administrador no mesmo separador, incluindo erros 502/504 e navegação/reload. Recibo confirmado repete apenas GET.

Validação final: frontend 423 PASS/build PASS; formulário 21 PASS; segurança 49 PASS; backend 1737 PASS/1 FAIL preexistente de enriquecimento/7 SKIP. PostgreSQL descartável: 12 verificações PASS, com auditoria, idempotência, concorrência, revogação e rollback; contentor removido. Chrome real com API simulada: 13 verificações PASS e capturas 1440/390 inspecionadas. Sem bloqueadores funcionais deste âmbito.

Limites preservados: recuperação não cobre fechar o separador/apagar armazenamento; HTTP sintético não prova OIDC; gate PostgreSQL usou instalador como ligação de escrita e não certifica provisionamento do login de produção nem isolamento entre bases tenant. Falha global preexistente de enriquecimento continua fora do âmbito. Fecho funcional não autoriza produção.

Nenhuma nova migração de produto, dado real, commit ou deploy. Apenas as migrações existentes foram aplicadas à base descartável do gate autorizado. Alterações disponíveis para a operação Git que o utilizador venha a autorizar.

## Entrada de trabalho ativo arquivada

O texto abaixo preserva o estado imediatamente anterior à aceitação; o estado final é Complete.

### Criação manual de oportunidades no Admin C4G — Review (30/10/2026)

[Contrato e validação](../features/central-manual-opportunity-authoring.md): criação manual exclusiva C4G no catálogo comum para fontes sem API; formulário/menu privados retirados, mutações privadas recusadas e histórico preservado. Backend focado 33 PASS; frontend 412 PASS/build PASS; sintaxe 15 PASS; Chrome sintético Admin/cliente em 1440/390 PASS. Suite backend 1737 PASS/1 FAIL/7 SKIP, falha de enriquecimento fora do âmbito documentada. API local anuncia a nova rota. Gate PostgreSQL descartável em 30/10: 12 PASS, cinco registos sintéticos com revisão/proveniência/recibo/auditoria; concorrência, revogação, rollback, leitor restrito e HTTP de duas organizações PASS. 36 migrações existentes aplicadas apenas à base temporária, removida no fim. Autenticação sintética e writer instalador: não prova OIDC nem provisionamento do login de produção. Sem alterações em bases existentes, dados reais ou deploy. Evidência e limites no contrato.

**Recuperação corrigida (30/10):** pedidos incertos persistidos por Admin na sessão do separador antes do POST, incluindo 500/502/504; remount e recibo recuperados, respostas tardias ignoradas. 11 testes adicionados, formulário 21 PASS; segurança 49 PASS; frontend 423 PASS/build PASS; backend 1737 PASS/1 FAIL preexistente/7 SKIP. Módulo de armazenamento restrito sem autenticação; sem SQL/deploy. Limite: não cobre fechar separador ou apagar armazenamento.

**Validação funcional de recuperação (30/10):** Chrome real com API simulada, 13 verificações PASS; 502/504, reload, navegação, separação entre administradores e recibo com GET apenas. Três POST sintéticos com uma chave. Capturas 1440/390 inspecionadas, sem overflow ou pageerrors. Sessão fechada, zero dados reais. Evidência no contrato; pronta para aceitação/fecho humano.

## Preparação do commit local autorizado — 30/10/2026

O utilizador autorizou apenas commit local e, após esclarecimento, a inclusão das dependências necessárias ainda não versionadas. A seleção inclui a base integrada de execução: catálogo/conectores, candidaturas, composição da API e frontend, autoridade, manifests/migrações e testes de suporte. Não se apresenta esta base anterior como implementação nova desta funcionalidade. Documentação comum selecionada por alteração, preservando as restantes decisões e trabalhos no working tree. Configuração privada, output, capturas e relatórios de outras funcionalidades excluídos.

Prova do conteúdo do índice numa cópia isolada: frontend **423 PASS** e build PASS; backend **1560 PASS / 1 FAIL preexistente em fundingEnrichmentPersistence.test.js / 7 SKIP**, 1568 testes. A contagem difere da workspace porque não inclui testes não relacionados deixados fora do commit. A fixture pública Interreg e respetiva proveniência foram incluídas após o primeiro ensaio detetar a ausência. Zero imports locais de runtime em falta; pesquisa de padrões de segredos sem credenciais reais identificadas, apenas canários de teste. Os avisos de linhas vazias no fim de ficheiros anteriores não foram tratados como alterações funcionais.

Evidência local: `output/git-manual-commit/` (excluída do commit). Nenhuma execução de migrações, dado real, push ou deploy durante a preparação Git.
