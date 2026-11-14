# Ficha de faturação: edição C4G e pedido de validação

14/11/2026 — Pedido confirmado: o Admin C4G edita a ficha de faturação de cada
entidade e pode pedir à entidade que valide os dados.

## Contrato e critérios de aceitação

- A área Faturação disponibiliza «Fichas de faturação», independente da criação de
  ciclos. Selecionar uma entidade abre a conta existente para edição ou permite
  configurá-la com as sugestões da ficha institucional.
- Guardar reutiliza a escrita versionada existente, revisão otimista, idempotência
  e autorização C4G. Não altera snapshots de ciclos ou documentos anteriores.
- Após guardar, permanece na ficha, apresenta sucesso e permite nova edição com a
  revisão atualizada. Trocar de entidade não conserva campos da entidade anterior.
- O envio pretendido é um pedido de validação, não uma cópia informativa (confirmado
  pelo utilizador). Deve referir a versão guardada e nunca incluir notas internas.
- Uma confirmação de dados antigos não pode confirmar uma versão entretanto editada.

## Decisões confirmadas

- Valida o administrador da entidade com sessão iniciada. O email não confere
  autorização e abrir a ligação nunca confirma os dados.
- O pedido aparece na área de Faturação e também é enviado por email ao
  administrador da entidade.

## Fluxo a implementar

1. C4G guarda a ficha e escolhe «Pedir validação». O pedido fixa a versão guardada.
2. A operação regista o pedido e a intenção de email na mesma transação Central.
   O worker envia uma ligação à área de Faturação; não envia notas internas.
3. O ORG_ADMIN da entidade vê o pedido e os dados a confirmar na área Faturação.
   Uma sessão de outra organização, membership suspensa ou simples `billing.read`
   não pode confirmar, mesmo por HTTP direto.
4. «Confirmar dados» regista autor, data e versão. O Admin C4G consulta o estado.
5. Uma edição posterior torna a confirmação anterior desatualizada; é preciso um
   novo pedido para a versão nova. O histórico anterior permanece disponível.

## Critérios adicionais

- Duplo clique/repetição não cria dois pedidos nem dois emails para o mesmo pedido.
- Falha do fornecedor mantém o pedido e permite retry com a mesma identidade de
  envio; «email enviado» não é confundido com «dados confirmados».
- Sem administrador ativo com email, o pedido é recusado com mensagem explícita.
- Antes do envio, revalidar que o destinatário ainda administra aquela entidade.
- O email só indica que há dados para validar, com ligação autenticada à plataforma.
- Não confirmar uma versão diferente da que foi apresentada, mesmo havendo edição
  concorrente pela C4G. Leitura e confirmação não dependem de dados em cache.

## Implementação (14/11/2026)

- Acesso direto às fichas, preservando escrita versionada, revisão e snapshots.
- `GET/POST /api/admin/billing/organizations/:organizationId/account/validation`:
  consulta e pedido C4G. `GET/POST /api/billing/account/validation`: consulta e
  confirmação ORG_ADMIN da organização autenticada.
- Revisão explícita dos dados guardados antes de pedir/confirmar. O servidor
  recusa confirmação de versão desatualizada. A ligação do email não confirma
  nada nem seleciona automaticamente uma entidade.
- Central 054: pedido, confirmação imutável e outbox por destinatário; funções
  fechadas com validação de sessão e locks de conta/membership. O role da API não
  pode marcar emails como enviados nem modificar diretamente estas tabelas.
- Worker separado, role dedicado, leases, revalidação do destinatário e retries
  com a identidade persistida. Email sem dados fiscais nem notas internas.
- Estado de aceitação pelo fornecedor separado da confirmação dos dados. Não há
  webhooks de entrega nem botão de reenvio depois de falha definitiva.
- Ativação explícita por `BILLING_VALIDATION_RUNTIME=central`, após migração e
  provisionamento do worker. Nada foi ativado em Dev/staging/produção.
- [Instalação e operação](../runbooks/billing-account-validation.md).

## Verificação

- Fronteira SQL provada em PostgreSQL 18 descartável, com dados sintéticos:
  isolamento, permissões C4G/ORG_ADMIN, versão atual, idempotência, concorrência,
  lease/retry e cancelamento antes do envio após suspensão do destinatário.
- Gates finais registados: PASS genérico (`.tmp/billing-validation-pg-1794699008887`)
  e variante de staging (`.tmp/billing-validation-pg-1794699085908`), com instalação
  idempotente e preflight após a migração.
- Backend focado: 49 PASS, incluindo o novo pacote, serviço/HTTP/transporte/worker
  e os testes de metadados/autorização. O fixture de versões foi atualizado para 054.
- Suite backend: 3302 PASS, 11 FAIL e 9 SKIP. Dez falhas passaram no foco posterior
  (duas exigiam a atualização do fixture; as outras foram transitórias durante
  alterações paralelas). A restante é `SEC-AC-01` de `f2Security.test.js`, sobre
  `sessionStorage` noutra funcionalidade; não foi alterada por este trabalho.
- Interface focada: 24 PASS. Suite frontend: 1120 PASS e um timeout em
  `ApplicationPartners.test.jsx`; repetição isolada: 16 PASS, sem mudar o timeout.
- Lint completo: zero erros/avisos. Build final PASS (1928 módulos). `node --check`
  nos módulos de backend alterados e `git diff --check` aprovados.
- As primeiras execuções de HTTP na sandbox falharam com EACCES em loopback; a
  suite backend relatada acima foi repetida fora dessa restrição. Execuções
  interrompidas por esse problema não são apresentadas como verificações aprovadas.
- Nenhum email real enviado; não verificado com sessão OIDC real no browser.
