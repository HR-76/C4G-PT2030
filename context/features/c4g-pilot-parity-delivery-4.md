# Recuperação do piloto — entrega 4

Estado: In Progress, 2026-10-17. O utilizador autorizou avançar para o bloco seguinte e deixar a configuração dos anexos para o final. A entrega 3 não fica concluída: configurar os serviços, completar a composição documental e demonstrar os anexos continuam obrigatórios no fecho.

## Âmbito e sequência

Recuperar administração de fontes/API, importação Portugal 2030, atualização do catálogo central e alertas existentes, conforme o plano de paridade. Sem novos motores, IA ou sistemas de configuração. Preservar catálogo, correções manuais, histórico, memberships e isolamento.

Primeiro incremento: recuperar a página de integrações com as cinco fontes originais e histórico real da recolha central. Reutilizar o componente de secção do piloto, identidade C4G, composição compacta, ações visíveis e tabela completa. Branco #FFFFFF, fundo #F6F8F8, texto #20262B, navegação #075B59, destaque #5FAD2F; tipografia de sistema e alinhamento à esquerda, conforme plano existente.

- Funding & Tenders: conservar atualização manual existente, idempotência, worker e limites atuais. Mostrar modo real/teste/não configurado sem prometer cobertura completa. Não ampliar nesta fatia os cinco resultados por execução autorizados na instalação habitual.
- CORDIS e Erasmus: conectores preservados no piloto usam Funding & Tenders com filtros e writes/notificações legacy. Não estão ligados à recolha central atual; apresentar esse estado e impedir ações fictícias.
- Interreg Europe e POCTEP: código preservado em `externalOpportunitySyncService.js`; endpoints/parsers e adaptação central ainda por verificar. Ausência de validação não equivale a fonte extinta.
- Histórico: acrescentar ao GET administrativo atual as últimas 100 execuções persistidas, em ordem estável, apenas depois da verificação de C4G_ADMIN atual. Mesmo limite da tabela do piloto. Projetar datas, estado, contagens, duração e recolha limitada, sem identidades internas, payloads ou dados privados. Ausência de contagem não é zero.
- Sem alteração de POST, grants, migrations, agendamentos, limites de recolha ou dados. A interface repete a mesma intenção após resposta incerta, descarta respostas de sessões anteriores e não permite atualização sem estado atual válido.

## Aceitação deste incremento

1. Cinco secções originais reconhecíveis; estado e impedimento individual visíveis; apenas a atualização central efetivamente configurada pode ser solicitada.
2. Histórico corresponde à projeção persistida e não desaparece silenciosamente em falha. Consulta falhada mostra erro e saída prática, não «sem execuções».
3. Autoridade administrativa atual, revogação e ausência de acesso pela membership de organização verificadas automaticamente. GET não escreve negócio nem dispara fontes.
4. Build, testes direcionados e Chrome no ambiente habitual, desktop/móvel; comparação com componente original em largura equivalente. Dados simulados usados na referência devem estar identificados.
5. Nenhuma fonte pendente é declarada operacional. Esta fatia não fecha a entrega 4.

## Incrementos seguintes e fecho

### Alertas de candidaturas — recuperados e ativos em 2026-10-18

[Contrato](c4g-pilot-parity-delivery-4-alerts.md) e [revisão](../reviews/c4g-pilot-parity-delivery-4-alerts.md). Estado/equipa/prazos, caixa e leitura recuperados sobre membership/tenant atuais; migração 029 e OIDC habitual verificados, dados preservados. Responsável/equipa, autor excluído, conforme decisão do utilizador. Prazos verificados durante a utilização da aplicação. Email fica para o final; comunicação administrativa global ainda por adaptar. A recuperação dos alertas de candidaturas não fecha a entrega 4.

### Recuperação Portugal 2030 — preparada em 2026-10-18

[Contrato do incremento](c4g-pilot-parity-delivery-4-portugal2030.md) e [revisão](../reviews/c4g-pilot-parity-delivery-4-portugal2030.md). Pré-visualização, validação, resultado e histórico recuperados sobre o fluxo XLSX F12 privado; datas/linhas/integridade corrigidas. Testes, build, PostgreSQL A/B e percurso visual de ensaio PASS. Por decisão explícita do utilizador, armazenamento privado/antivírus ficam para o final: não houve ativação nem importação real no ambiente habitual. Fecho operacional pendente. Interreg/POCTEP já tiveram as importações reais conferidas no incremento próprio; alertas mantêm a sua recuperação/verificação pendente.

### Classificação, desempate e identidade de chamadas em cascata — autorizado em 2026-10-18

- Converter `43251589` para CERV e `43254037` para ESC. Conservar as restantes conversões verificadas.
- Enviar ordenação composta `deadlineDate DESC`, `identifier ASC`, `callccm2Id ASC`, sem alterar filtros, prioridade por prazo ou limites.
- Tipo 8: chave externa `CASCADE:<callccm2Id>`, com identificador decimal positivo obrigatório; conservar `identifier` como referência de tópico e construir URL oficial a partir do identificador da chamada. Rejeitar tipo 8 sem identificador próprio válido; nunca fundir pelo tópico. Chamadas diretas conservam a identidade existente. Reservar o prefixo CASCADE para evitar colisões entre tipos.
- Reconciliação explícita, transacional, precedida de preview e backup: derivar a chave de cada chamada em cascata do URL da última observação de fonte, nunca de um URL editado manualmente; conservar opportunity_id, relações, correções e histórico. Duplicação de destinos, URL ambíguo ou divergência desde o preview impedem a aplicação. Registos antigos de observação, revisões, proveniência e recibos permanecem imutáveis; acrescentar revisão/proveniência e auditoria da reconciliação. Sem migração de esquema.
- Correções retroativas de programa apenas com evidência oficial correspondente à chamada e ao valor de origem esperado; preservar alterações manuais usando a composição existente. Não aplicar a regra genérica LIFE → CERV. A chamada ESC histórica mantém datas e ciclo de vida, sem a declarar atualmente aberta.
- Aceitação: separar chamadas em cascata que partilham tópico, manter versões duplicadas do mesmo tópico direto reunidas, rejeitar identidades inválidas, preservar o UUID e relações de uma chamada reconciliada, conservar o histórico anterior byte a byte, proteger correções manuais e reverter integralmente em conflito. Segunda reconciliação sem novas revisões; segunda recolha sem duplicados. Testes automatizados e PostgreSQL descartável antes de alterar dados locais. Reconciliar e verificar o ambiente habitual antes de repetir importações reais.

### Separação Erasmus+/RENEWFM — autorizada em 2026-10-18

Corrigir os filtros central e legado Erasmus para excluir `43253967`, que identifica RENEWFM. Manter `43353764` como Erasmus+ e converter `43253967` para `RENEWFM` na normalização partilhada.

Aceitação: o pedido Erasmus enviado ao transporte exclui RENEWFM; uma resposta que misture ambos os programas só admite Erasmus nessa seleção; a recolha geral admite ambos com nomes corretos e identidades distintas. Testar também a persistência através do worker em PostgreSQL descartável. Preservar dados reais e histórico, sem migração nem novas importações reais neste incremento. A conferência das fontes reais continua pendente.

### Recolha por programa — autorizada em 2026-10-17

Ampliar Funding & Tenders e ligar CORDIS/Erasmus ao catálogo central. Limites já aprovados: 100 resultados, 25 por página, quatro páginas por execução manual; conservar limites de tempo, tamanho e retries. A instalação habitual passa explicitamente do ensaio de cinco registos para este perfil. Outros ensaios mantêm o limite anterior.

- CORDIS recupera as chamadas Horizon Europe/EURATOM através dos filtros Funding & Tenders do piloto; não importa projetos CORDIS. Erasmus usa os programas Erasmus+ da mesma API. A interface identifica esta origem.
- Uma identidade canónica Funding & Tenders por identificador externo, partilhada pelas três seleções. Preservar correções manuais, revisões, observações e dados existentes. Não arquivar por ausência numa recolha limitada.
- Persistir a seleção em cada execução; histórico e estado individual por fonte. Apenas uma recolha ativa globalmente, evitando concorrência na criação da mesma identidade. Repetir a mesma intenção não cria novo trabalho; reutilizá-la com outra seleção é conflito.
- Migração central incremental 017, sem alterações de tenancy, permissões ou envelopes F9. Worker usa a seleção persistida, nunca um filtro arbitrário enviado pelo cliente. Administração atual continua obrigatória na submissão e execução.
- Aceitação: paginação até 100, filtros verificados na API oficial, sobreposição sem duplicados, correção manual preservada, retries/revogações e isolamento existentes; migração testada em PostgreSQL descartável; build e testes direcionados; recolhas reais e percurso no ambiente habitual, com comparação visual ao piloto. Zero resultados atuais é um resultado válido, distinguido de erro.
- Esta fatia não fecha a entrega 4: Interreg, POCTEP, importações e alertas mantêm a sua validação própria pendente.

Completar paginação/cobertura Funding & Tenders e os filtros CORDIS/Erasmus com identidade central sem duplicação; verificar Interreg/POCTEP individualmente; recuperar importação com preview/validação/resultado e alertas privados. Dependências de ficheiros/email sem configuração ficam identificadas para o final conforme orientação do utilizador. A validação final continua a exigir fonte real, importação, destinatários corretos, isolamento e evidência de envio quando o email for declarado disponível.
