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

## Implementação

Acesso direto às fichas implementado no frontend. Pedido, email e confirmação
ainda por implementar. Exigem persistência Central, nova fronteira de escrita
ORG_ADMIN e integração com o worker de emails. Não ativar por uma escrita direta
nas tabelas existentes nem pelo envio de email dentro da transação HTTP.

### Estado de verificação

- Edição direta: 14 testes focados aprovados; lint e build concluídos sem erros.
- Suite frontend: 1104 aprovados e um timeout em `ApplicationPartners.test.jsx`,
  já documentado noutras alterações do repositório; repetição isolada: 16 aprovados.
- SQL candidato preparado com pedido e intenção de email atómicos, confirmação
  separada, histórico imutável e recusa de versão desatualizada. Não aplicado.
- Gate PostgreSQL isolado preparado em `test/integration/billing-account-validation`;
  sintaxe dos scripts verificada com `node --check`, execução aguarda autorização.
- Ainda não existem endpoints, interface de confirmação, worker de envio nem
  pacote de migração admitido. O pedido de validação ainda não está disponível.
