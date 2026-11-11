# Criar oportunidade — campos da call

Acrescentados Geografia/Local, Grupos elegíveis e Requisitos aplicáveis à call, opcionais e com parágrafos. Formulário organizado em informações gerais, destinatários/requisitos e datas/financiamento. A ficha da oportunidade manual mostra os mesmos campos depois da leitura autorizada; ausências explícitas e conteúdo tratado como texto, sem interpretar HTML.

## Contrato e preservação

`geographySummary` até 2 000 caracteres e `eligibleGroups` até 4 000 são adições opcionais ao snapshot v1. `eligibilitySummary`, já existente, é usado pelo formulário manual para os requisitos (até 4 000). A lista de campos da criação central é separada das listas privadas; autoridade C4G_ADMIN atual, autenticação recente, auditoria e bloqueio de revogação mantidos. Nenhuma migração, nova recolha, permissão ou alteração de normalização/hashes históricos.

Os textos integram a intenção idempotente e o pedido recuperável por administrador. Omissão não cria defaults. A revisão imutável guarda os dados, com rejeição de tipos, excesso de tamanho e campos desconhecidos. A criação continua a devolver apenas recibo; o conteúdo vem do GET autorizado.

Os requisitos são informação editorial, sem checklist nem decisões automáticas. `eligibilitySummary` conserva o uso histórico como texto em sugestões por palavras-chave e preenchimento; esse mecanismo não foi alterado. Dados importados Portugal 2030 podem usar esse campo para beneficiários e não são reclassificados como requisitos pela nova secção. Geografia/grupos livres não viram códigos nem taxonomias verificadas. O incremento corresponde ao percurso ativo de criação central e respetiva ficha; não ativa o adaptador candidato manual v2 nem recompõe a geração imutável do leitor isolado.

## Validação e autorrevisão

- Regressões captadas antes da implementação; backend focado 64 PASS, frontend focado 42 PASS.
- Backend completo: 2 553 PASS, sete SKIP existentes, zero falhas.
- Frontend completo: 627 PASS; build PASS.
- PostgreSQL descartável: 13 verificações PASS, 36 migrações existentes até 035, cinco oportunidades exclusivamente sintéticas. Persistência dos três textos, releitura de revisão, concorrência/replay/conflito por campo, rollback/auditoria, revogação e duas organizações só de leitura. Limpeza confirmada.
- Compatibilidade com o destino habitual: mais 13 verificações PASS em PostgreSQL 18.6 e versão 048 (49 migrações existentes), com os mesmos testes e cinco registos sintéticos. Limpeza confirmada.
- Navegador com interface compilada e API simulada: 23 verificações PASS, 1440 e 390 px sem excesso de largura, envio/recuperação/repetição com uma chave, ficha com texto literal e limpeza do pedido. Capturas inspecionadas. Sem erros JavaScript nem pedidos API imprevistos no ensaio final.
- Revisão independente de código e autorrevisão sem problemas acionáveis no âmbito alterado.

O primeiro arranque das ferramentas frontend encontrou restrição de escrita na cache das dependências; a repetição autorizada passou sem alterar testes. A primeira fixture visual não previa a consulta de disponibilidade do catálogo; foi completada com resposta desligada explícita, sem alterar o produto ou eliminar verificações.

O ensaio adicional 048 exigiu atualizar a preparação do teste: PostgreSQL 18 e respetivo diretório temporário, admissão central por versão e passagem da admissão verificada ao controlo do leitor (igual ao percurso do produto). As tentativas iniciais foram recusadas e os seus contentores removidos. Não foram alterados fingerprints nem controlos do produto para obter aprovação; o ensaio base 035 mantém a preparação histórica e o controlo v1 correspondente.

Evidência PostgreSQL: `output/central-manual-pg-170b3d04e68b488ab950ce1c115d0edc/verification.json` (035) e `output/central-manual-pg-0a9912efdf7d4866821dd184e890b2be/verification.json` (048). Evidência visual: `output/playwright/manual-call-fields/verification.json` na cópia isolada. A autenticação do ensaio é sintética; não comprova um novo login humano/institucional. Nenhum registo sintético foi criado na base habitual.

Integrados 18 ficheiros com backup e comparação de conteúdo. Reiniciado exclusivamente o serviço controlado sem fontes. Verificação final em 2026-11-02 21:05 UTC: interface/saúde 200, catálogo anónimo 401, versão 048, 178 oportunidades e 178 revisões, mesma geração, fontes QUIESCED e zero recolhas. Política de exposição mantida para uma entidade/ORG_ADMIN; criação manual mantém autorização própria C4G_ADMIN. Confirmação humana do formulário fica como próximo passo, sem confundir com os ensaios automatizados já concluídos.
