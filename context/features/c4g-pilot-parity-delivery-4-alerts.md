# Recuperação do piloto — entrega 4 / Alertas

Estado: Review, 2026-10-18. Alertas de candidaturas implementados, ativados e verificados; [provas e pendências](../reviews/c4g-pilot-parity-delivery-4-alerts.md). A entrega 4 global permanece em curso.

## Evidência e âmbito

O piloto conserva a lista de notificações, leitura individual/em lote, ligações à candidatura, inclusão na equipa, mudanças de estado, avisos de prazo (30, 7 e 1 dias, com janela de recuperação de dois dias) e comunicação administrativa. A implementação usa utilizadores/tabelas globais; não é a arquitetura multi-organização aprovada. A composição habitual não liga estas rotas a um serviço tenant. O scheduler legado não deve ser ativado para resolver essa ausência.

Recuperar a composição e densidade da página original, com identidade C4G. Mostrar filtros para todos os tipos existentes, estado de carregamento, erro explícito com repetição, leitura e navegação. Uma falha nunca equivale a uma caixa vazia. Troca de utilizador, membership ou organização descarta resultados e ações pendentes. Contagem não lida vem do servidor, não do tamanho de uma página.

Na composição atual, a membership central e a autorização atual do recurso condicionam leitura e alterações. Administrador da plataforma não equivale a administrador de todas as organizações. Não copiar notificações globais para tenants sem correspondência demonstrada entre destinatário, membership e recurso. Preservar dados e histórico existentes.

## Decisões confirmadas e adaptação

- O utilizador confirmou: mudanças de estado apenas para responsável e equipa, excluindo o autor. Inclusão na equipa avisa a pessoa adicionada, também excluindo o autor. Deduplicar quando responsável e participante coincidem; resolver memberships ativas na organização. Não conceder acesso ao recurso por receber um alerta.
- O utilizador confirmou: recuperar alertas na aplicação, email para o final. Nenhum envio real durante esta recuperação.
- Prazos: conservar 30/7/1 dias e janela de recuperação de dois dias, apenas candidaturas Em preparação; usar a data civil de fecho da oportunidade associada (snapshot escolhido para origem central). Responsável/equipa recebem os seus avisos ao entrar na aplicação/atualizar alertas; não há processamento fora da sessão nem scheduler privilegiado. Deduplicar por candidatura, destinatário, data de fecho e marco; esconder prazo cuja data ou estado deixaram de corresponder. Dia civil de Lisboa. Esta adaptação dispensa o transporte de email e não cria novo motor de jobs.
- Persistência tenant aditiva 029: alerta imutável por destinatário, leitura monotónica; RLS de organização e destinatário. Eventos de estado/equipa na mesma transação da candidatura, abrangidos pela idempotência e auditoria existentes. Criação de prazo e leitura têm eventos F7 próprios, sem mensagem ou título no payload de auditoria. GET apenas consulta; POST check-deadlines verifica os prazos do próprio membro; PATCH reconhece apenas os próprios alertas autorizados.
- Não reconstruir destinatários históricos a partir da equipa atual nem converter alertas globais sem mapeamento demonstrado. Eventos novos a partir da ativação; histórico anterior preservado.
- Comunicação administrativa global do piloto permanece no legado: o endpoint de broadcast não é ativado na composição multi-organização. A regra de destinatários confirmada neste turno diz respeito às candidaturas; a adaptação da comunicação administrativa continua uma pendência explícita da entrega 4.

## Critérios de aceitação

1. Membro com organização ativa consegue abrir os seus alertas; leitura própria e links úteis, apresentação confrontada com o piloto em desktop/móvel.
2. Filtros por tipo e não lidas não entram em ciclo com o URL; marcar como lida retira o item da seleção de não lidas. Ações concorrentes ficam bloqueadas; falhas conservam a possibilidade de repetir.
3. Respostas atrasadas de consulta, leitura ou oportunidade não surgem no contexto seguinte. Pedidos tenant levam a organização esperada, sem a tratar como autoridade.
4. Não divulgar título, mensagem, contagem ou recurso a outra membership/organização, nem após revogação. Testes automatizados de autorização e PostgreSQL real antes de ativar persistência nova.
5. Geração e repetição preservam a candidatura, tarefas e histórico; ausência de duplicados e rollback verificados. Destinatários correspondem à regra confirmada e não incluem o autor quando aplicável.
6. Build frontend, verificações sintáticas backend, testes direcionados, percurso real e comparação visual. Distinguir fixtures, execução habitual e dependências pendentes. Não fechar a entrega 4 com provas apenas simuladas.

Próximo passo: rever a comparação com o utilizador e delimitar a comunicação administrativa ainda pendente.
