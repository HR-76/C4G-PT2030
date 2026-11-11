# Evidência e preview de migração EU legada

31/10/2026. Continuação do [fecho técnico EU](../reviews/opportunity-data-standardization/eu-source-integrity-phase.md). O inventário read-only identificou 398 identidades v1 com o rótulo legado e sem candidato v2/decisão de revisão. A fonte habitual está `QUIESCED` com fence 7. Esta fase prepara decisões; não aceita revisões nem reativa escritores.

## Critérios de aceitação

1. Consultar a API pública EU apenas para os 398 IDs fixados no inventário, com limites por pedido, cadência controlada e sem usar o worker, os endpoints habituais ou credenciais. Preservar resultados individuais, erros e hora da observação; não classificar `ABSENT`, `ERROR` ou `CONFLICT` como candidato aceitável.
2. Para `FOUND`, guardar evidência oficial integral limitada, snapshot v2 validado e hashes verificáveis. Para `CONFLICT`, guardar as variantes verificadas e os motivos fechados quando disponíveis. Nunca preencher `funderName=European Commission` nem inferir moeda da dotação ou concedente direto do nome do portal.
3. Preparar preview por identidade com oportunidade/revisão/rowVersion esperados, digest do conteúdo, orçamento, estado da moeda, prazos, partes e motivo de revisão. O preview distingue candidato novo de ausência/conflito/erro e exige nova verificação de CAS, arquivo e autoridade antes de qualquer aceitação.
4. Ligar a proposta ao fluxo existente de plano, arquivo e aprovação OIDC autenticada por identidade; um manifesto local ou esta conversa não são aprovação. Não escrever na BD habitual nem retomar EU nesta fase. Qualquer execução futura exige backup/restauro próprios, preview atual, aprovação autenticada e reconciliação pós-escrita.
5. Ensaiar invariantes e verificar as saídas sem presumir que as 398 chamadas terão dados disponíveis. Registar contagens, limitações e pendências específicas.

## Decisão adicional: pré-aprovação antes do arquivo

31/10/2026: a aprovação humana OIDC também precede a gravação técnica de `funding_candidate_v2` na BD habitual. Um evento de auditoria de aprovação é escrita de controlo, não arquivo candidato nem aceitação. A pré-aprovação vincula uma identidade, evidência oficial com hash, snapshot/digest, CAS, fence EU e validade curta. Deve falhar perante alterações desses dados, exigir sessão OIDC, autoridade administrativa atual, CSRF e origem, e nunca aceitar/resumir uma oportunidade pela própria rota de pré-aprovação. A execução futura terá de verificar o evento de auditoria e repetir o preview antes de arquivar; a aprovação existente de aceitação continua distinta e posterior ao arquivo.

## Gate de arquivo e ensaio, incremento seguinte

1. Todo o `INSERT` de `funding_candidate_v2` para identidade EU ainda em v1 exige recibo de pré-aprovação OIDC: evento crítico no ledger Central, actor humano, recurso/ID, digest do binding e do item, validade, CAS e fence exatos. A verificação não concede leitura geral da auditoria ao escritor. Sem recibo, o escritor automático recusa o arquivo v1 e não deve ser retomado.
2. O arquivo usa os mesmos bytes de evidência e snapshot aprovados; novo dado oficial ou nova observação exige novo preview e aprovação. Repetições devem ser idempotentes e não reutilizar aprovação para outro ID, revisão ou run. O arquivo e a verificação decorrem na mesma transação ou num gate SQL que conserva o bloqueio até ao `INSERT`.
3. Ensaiar recusa por recibo ausente/falso/expirado, actor e ID trocados, CAS/fence alterados, evidência divergente e corrida; sucesso exato, rollback e backup/restauro em PostgreSQL isolado. Não aplicar SQL nem retomar a fonte habitual nesta fase.
4. Só depois dos gates verdes, renovar preview/pacote e apresentar as 391 decisões humanas para autenticação OIDC. Esta conversa e um ensaio sintético não contam como aprovação.

## Revisão operacional autenticada da fila

1. Uma página exclusiva de administrador C4G mostra o pacote vigente, expiração, 391 itens elegíveis e sete conflitos excluídos, com os campos do preview verificável. A leitura do pacote passa pela API autenticada; o frontend não publica os ficheiros `output/`.
2. A decisão global já expressa pelo utilizador é executada na APP como 391 aprovações individuais. Para cada item, a página consulta o gate atual e envia um `requestId` UUIDv7 estável pela rota OIDC existente. Regista o recibo retornado, interrompe em qualquer erro e nunca faz retry cego com uma intenção nova.
3. O progresso e as intenções ficam recuperáveis no navegador durante a sessão de revisão. A página oferece exportação dos recibos para a janela posterior; não arquiva candidatos, não aceita revisões, não instala 045 e não reativa o escritor.
4. Se a APP, o OIDC ou o pacote não estiverem disponíveis, a página falha de forma explícita. Um pacote expirado exige preview/pacote novos; nenhuma decisão é inferida da mensagem do chat ou de eventos sintéticos.
5. Uma sessão administrativa antiga pode passar no dashboard e ser recusada pelo gate de autoridade. Perante `OPPORTUNITY_V2_AUTHORITY_DENIED`, oferecer reautenticação OIDC com a categoria vigente do servidor, conservar o pacote e qualquer intenção pendente, e regressar à fila sem emitir aprovações automaticamente.

## Conferência do lote de recibos

1. O export da APP é entrada não confiável: conferir formato fechado, pacote, 391 identidades distintas, digests e binding individual do pacote, UUIDv7 da intenção, ator, evento, hash e prazo. Não aceitar subconjuntos ou itens dos sete conflitos como lote completo.
2. A conferência local não substitui o ledger. Antes de usar qualquer recibo no arquivo, verificar no PostgreSQL o evento crítico correspondente, o ator humano e o vínculo exato; a migração 045 e o gate de arquivo repetem esta verificação transacionalmente.
3. Um erro, pacote expirado, CAS/fence alterado ou recibo em falta interrompe a janela. A recolha EU continua suspensa até reconciliação, backup/restauro, aprovação de aceitação posterior e nova decisão de retoma.

## Janela de arquivo por identidade, ainda por implementar

1. Preparar um executor fechado para as 391 identidades `CHANGE_REQUIRES_APPROVAL`, sem aceitar candidatos nem reativar EU. Usar exclusivamente os bytes dos artefactos oficiais aprovados; nada de nova recolha durante a janela. Cada identidade tem um run terminal `EU_LEGACY_PREARCHIVE_STAGING` e exatamente um candidato v2, vinculados ao seu recibo OIDC.
2. Instalar a migração 045 apenas numa janela com fonte `QUIESCED`, preflight 044, pausa dos escritores, backup das bases Central e tenant e restauro ensaiado. O executor deve verificar novamente pacote, evento auditado, ator, CAS, fence, mapeamento e integridade antes do `INSERT`, manter autorização, run e candidato na mesma transação, e falhar fechado se algo mudar.
3. Guardar checkpoint durável por identidade e reconciliar após cada commit. A repetição só pode confirmar o mesmo run, recibo e payload; nunca criar outra identidade ou usar outro recibo. Falha parcial mantém EU suspensa e preserva os resultados já confirmados para recuperação explícita.
4. Verificar contagens, digests, orçamentos numéricos, moeda sem inferência, prazos e fonte no SQL depois do arquivo. A aceitação de cada candidato e a retoma da recolha são operações posteriores com autoridade própria. Renovar preview/pacote e recolher aprovações OIDC apenas quando este executor e a janela estiverem prontos; um pacote de uma hora anterior não autoriza escrita futura.
