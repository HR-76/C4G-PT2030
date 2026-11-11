# Faturação do cliente

Estado: Review — 2026-11-06. Primeira versão de consulta implementada; componente documental pendente. Construção autorizada pelo utilizador.

## Contrato

Área de consulta na organização: documentos emitidos, período/serviço, emissão,
vencimento, valores pagos, saldo, pagamentos parciais e estornos. Data efetiva do
pagamento distinta da data do registo. Origem operacional: registo manual C4G.
Fornecedor externo por decidir: TOConline não está aprovado e não é dependência.

Dados permanecem centrais. Membership ativa e autorização financeira por entidade
em cada pedido, incluindo detalhe. ORG_ADMIN consulta; restantes perfis só mediante
permissão explícita `billing.read` de âmbito ORGANIZATION. Nenhum acesso implícito
por ser gestor/técnico ou administrador de plataforma. Sem mutações financeiras
pelo cliente. Excluir rascunhos, notas internas, IDs de autores e auditoria técnica.

## Plano

1. API dedicada de leitura, projeção mínima e filtros/paginação no servidor.
2. Área Faturação e navegação condicionada à capacidade devolvida pelo servidor.
3. Testes de autorização, isolamento, revogação, pagamentos e estados da interface.
4. Validar suites e build; registar limites operacionais sem instalar em ambientes.

## Critérios de aceitação

- Resumo separado por moeda, lista e detalhe apenas da entidade autenticada.
- IDs de outra entidade e documentos não publicados devolvem indisponível.
- Pagamentos e estornos preservam valor/data/origem; nunca confundir estorno com pagamento.
- Filtros de documento/serviço, datas, pagamento e moeda; paginação determinística.
- Falha, vazio, carregamento e mudança de contexto não mostram dados anteriores.
- Download só pode existir para PDF original privado realmente associado e autorizado;
  não gerar faturas nem simular links. A Fase A não tem associação/armazenamento PDF:
  registar explicitamente essa dependência documental na entrega.
- Sem conector, email, cobrança, alteração de acesso por dívida ou deployment.

Trabalho anterior: `application-create-visual.md` mantém o seu estado Review e evidência.

## Implementação e verificação

- Rotas `/faturacao`, `/faturacao/:id` e API `/api/billing/{access,summary,invoices,invoices/:id}`.
- Membership revalidada antes/depois, cabeçalho comparado com contexto autenticado,
  sem aceitar organização nos filtros. Leitura central consistente em transação
  repeatable-read/read-only e timeout de 5 s. Não altera o executor SQL fechado.
- Capacidade `billing.read` registada no catálogo; ORG_ADMIN da entidade tem consulta.
  Restantes membros precisam de grant explícito de organização. Este incremento
  não adiciona um ecrã para atribuir esse grant a responsáveis financeiros.
- Notas internas, referências técnicas, autores e comandos não saem na projeção cliente.
- A pesquisa incide na emissão; resumo explicitamente abrange todos os períodos,
  separado por moeda. Pagamentos e estornos mostram data efetiva e registo manual.
- Backend: 2689 PASS, 7 SKIP, 0 FAIL (2696 testes). Frontend: 801 PASS.
- Sintaxe backend e build frontend PASS. Catálogo F5 atualizado com testes estritos.
- Chrome headless com APIs simuladas: lista/detalhe/recusa/vazio a 1440 e 390 px,
  oito cenários PASS; screenshots inspecionadas, sem overflow global nem erros JS.
  Evidência: `output/playwright/customer-billing/`.
- Testes HTTP de loopback precisaram de execução fora da restrição de rede da sandbox.
  Não houve chamadas a fornecedores, migrations, dados reais, commit ou deployment.

## Pendências explícitas

PDFs: o domínio existente não associa ficheiros aos documentos fiscais. O detalhe
mostra “PDF ainda não disponibilizado”; não existe download nem upload nesta entrega.
A disponibilização de PDFs originais privados é trabalho documental adicional,
independente de qualquer fornecedor fiscal. A escolha de fornecedor continua aberta.

A implementação não foi instalada/reiniciada no ambiente habitual nem validada com
PostgreSQL real. A validação visual usa dados sintéticos e não prova integração SQL.
A feature global não está Complete enquanto estas pendências aplicáveis não forem concluídas.

## Incremento autorizado — PDFs e acesso financeiro (2026-11-06)

Estado: Review. Pedido explícito de completar as duas pendências.
- Só ORG_ADMIN pode atribuir/revogar `billing.read` a outra membership da entidade.
  Administradores mantêm acesso inerente; não se alteram perfis nem outros grants.
  Mudanças usam revisão/idempotência e auditoria; concessão explícita sobrevive a
  mudança de perfil. Membership suspensa nunca ganha acesso efetivo.
- C4G anexa PDF original a documento fiscal existente. Máximo 10 MiB, validação de
  extensão/MIME/conteúdo, checksum, scanner CLEAN obrigatório, versões imutáveis.
  Substituir cria nova versão e preserva as anteriores; publicação é atómica.
- Download autenticado pelo backend, incluindo revalidação depois de ler/verificar
  os bytes. Sem URLs públicas, nem confiança em organização/object key do browser.
- Reutilizar ObjectStoragePort e scanner existentes; nenhuma conexão/configuração
  de fornecedor externo é ativada por esta tarefa. Infraestrutura sem configuração
  falha fechada, sem apresentar anexação fictícia.
- Testes: autorização, terceiros, revogação, concorrência, retries, ficheiros inválidos,
  scanner indisponível, corrupção e respostas obsoletas da interface.
- Preparar migration aditiva e documentação de instalação; não aplicar ao ambiente
  habitual nem fazer deployment. Gate PostgreSQL descartável autorizado pelo utilizador e concluído.


## Entrega do incremento — 2026-11-06

As pendências de implementação acima ficam resolvidas: PDFs privados com versões e
atribuição/revogação de consulta financeira em Acessos da organização. Administradores
C4G anexam no detalhe fiscal; membros autorizados descarregam no detalhe da fatura.
A concessão é auditada, mantém o perfil e os restantes grants, e exige revisão/idempotência.

Validação: gate PostgreSQL 18 descartável PASS, com instalação/repetição do pacote,
perfil SQL runtime real, imutabilidade, isolamento, concorrência e coordenador de
autoridade real para concessão/revogação/retry/recusa. Sessões de identidade sintéticas;
nenhuma base da aplicação foi utilizada. Cluster encerrado no finally.
Frontend 806 PASS; build PASS; oito cenários Chrome simulados a 1440/390 px PASS.
Testes PDF cobrem ficheiro inválido, scanner indisponível/infeção, corrupção, revogação
antes de devolver bytes, cancelamento, versões, retry e contrato HTTP sem cache.

Instalação continua pendente e fora deste pedido. Consultar
`context/runbooks/billing-private-pdfs.md`. Nenhum fornecedor fiscal foi escolhido ou
ligado; nenhuma configuração de armazenamento externo foi ativada.

Suite backend final: 2698 PASS, 7 SKIP, 0 FAIL (2705 testes). Sintaxe dos módulos alterados PASS.

## Instalação habitual autorizada — 2026-11-06

Utilizador autorizou instalação/ativação e, após confirmar ausência de R2/ClamAV,
a preparação de infraestrutura local. Critérios: armazenamento privado persistente
local com ACL restrita, scanner ClamAV real obrigatório e loopback; pacote 050 com
backup e preservação de dados; runtime habitual saudável, sem fornecedor fiscal.
Baseline observada 048: 049 é pré-requisito aditivo, sem ativar importação externa.
O adaptador local é exclusivo do ambiente development e não substitui R2 em produção.


## Instalação e ativação concluídas — 2026-11-06

Estado: Complete para o âmbito autorizado. Instaladas 049/050 no ambiente habitual,
com backups privados das duas bases e comparação exata dos dados anteriores PASS.
Extensão de email existente preservada; fingerprints combinados ensaiados primeiro
em PostgreSQL descartável. Nenhum fornecedor fiscal ativado.

Runtime habitual ativo e saudável em http://localhost:3000. Armazenamento local
privado persistente e ClamAV real em loopback; caminho R2 permanece inativo.
Scanner real aceitou ficheiro limpo e rejeitou EICAR inofensivo mantido em memória.
Suite backend final 2700 PASS, 7 SKIP, 0 FAIL; build e sintaxe PASS.
OIDC real: administrador C4G e administrador de entidade, resumos HTTP 200,
PDF inexistente HTTP 404 com controlo de âmbito; ecrãs de faturação e acesso
financeiro verificados. Evidência `output/playwright/billing-activation/verification.json`.
Não foram alteradas permissões de pessoas reais nem anexados documentos de teste
a faturas reais. A prova de upload/versões/permissões usa dados isolados; a prova
habitual foi de leitura, configuração e disponibilidade real da infraestrutura.

Operação e backups documentados em `context/runbooks/billing-private-pdfs.md`.

10/11/2026 — Revisão transversal: Faturação e histórico confirmados em Chrome no ambiente habitual: sem erro 400 e estado vazio correto; a entidade não tem faturas para confirmar detalhes/PDF nesta passagem. Ver [relatório](../reviews/metronic-shared-surfaces-20261110.md).
