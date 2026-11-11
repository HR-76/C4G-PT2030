# Serviço central de criação e ativação

Estado: Review, 18/10/2026. Implementação explicitamente autorizada após a prova isolada. Incremento backend anterior à ligação do ecrã/ambiente habitual. Serviço persistido, migração e factory HTTP implementados; 54 testes direcionados e 17 grupos PostgreSQL/HTTP passaram. [Resultados e fronteira dos adaptadores](../reviews/platform-onboarding-service.md).

## Contrato deste incremento

Serviço persistido que cria organização em PROVISIONING, prepara identidade, tenant e projeções por adaptadores idempotentes, emite convite manual e ativa primeiro administrador. Central permanece fonte de verdade. Exigir campos canónicos explícitos (nome, denominação legal, tipo, país, moeda e destinatário), sem inferir valores fiscais ou comerciais; decisão visual desses campos fica para o ecrã.

Cada comando administrativo verifica sessão ativa, utilizador ativo e atribuição C4G_ADMIN atual na transação. Perfis da entidade não bastam. Escritas protegidas usam coordenador de autoridade, catálogo SQL fechado e F7; não conceder à API poderes de criação de bases ou administração do IdP. Revalidar autorização antes de confirmar cada efeito externo. Leases com fence impedem confirmar trabalho antigo; estado e identificadores estáveis permitem retoma por outro administrador C4G autorizado.

Adaptadores de identidade/preparação/projeção pertencem à composição confiável e recebem IDs estáveis da operação; têm de verificar ownership e consultar resultados anteriores. Serviço não aceita resultado externo fornecido por HTTP. Sem adaptador configurado, recusar execução; não declarar base pronta. Não instalar a extensão experimental nem alterar runtime habitual neste incremento.

Convite: 256 bits, digest persistido, uso único e validade inicial de 24 horas. Repetição de emissão não recupera segredo; substituição revoga a anterior. Troca de convite ligada a uma sessão transitória confiável; novo início invalida troca anterior, sem consumir o convite. Identidade verificada pelo adaptador OIDC, nunca por claims recebidos no body. A prova da identidade pode ser retomada após reinício; se a troca OIDC se perder antes de persistir, reiniciar autenticação com convite ainda não consumido.

Ativação confirma issuer/subject, utilizador, entidade e preparação atual, e verifica que o emissor continua C4G ativo. Na mesma transação central: membership PENDING_PROJECTION → ACTIVE, grants fixos ORG_ADMIN, consumo do convite, operação concluída e F7. Falha ou auditoria recusada reverte tudo. COMMIT incerto pode ser consultado/repetido pela mesma troca e sessão; não gera outra membership. Não emitir sessão autenticada por posse do convite; login/seleção continuam OIDC normal após ativação.

## Aceitação

1. C4G cria e retoma; admin/gestor/técnico sem papel C4G, sessão expirada/revogada e utilizador suspenso são recusados.
2. Repetição e concorrência não duplicam organização, identidade, membership ou convite; chave com conteúdo diferente é conflito.
3. Falhas após efeito externo retomam pelo mesmo ID; fence antigo não confirma; revogação durante o efeito impede confirmação.
4. Convite expirado/revogado/substituído, troca antiga, sessão diferente e subject errado não ativam; conta existente preserva credenciais e outros vínculos.
5. Falha depois de ativar membership/grants e falha F7 revertem também consumo; repetição após COMMIT incerto devolve recibo.
6. Migração aditiva com manifests e protocolo atualizados; testes PostgreSQL/HTTP isolados, casos de falha e isolamento. Preservar dados/tarefas anteriores. Nenhuma migração habitual ou UI neste incremento.

Próximo passo: integrar os adaptadores reais numa composição isolada e repetir o percurso completo com este serviço antes de ligar o ecrã habitual.
