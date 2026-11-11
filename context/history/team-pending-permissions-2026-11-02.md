# Recuperação da equipa e tarefas
State: Complete

Correção aprovada: intenções isoladas por utilizador, organização e candidatura, sem repetição cruzada. Migrar intenção antiga apenas na candidatura correspondente, preservando chave/payload e evitando substituir intenção nova. Permissão efetiva APPLICATION_WORK_EDIT projetada na consulta existente. Ausência de permissão, leitura pendente ou 401/403/404 bloqueiam ações; recusa retira dados anteriores e preserva intenção. Recuperação por reconsulta explícita, sem reenvio automático. Ignorar respostas de contextos desmontados. Servidor mantém guardas de escrita.

Aceitação: regressão antes de correção; isolamento/legado, consulta, perda e recuperação de acesso com mesma chave, paginação/histórico; testes completos, build e navegador nos dois perfis. Sem alteração de esquema, links oficiais ou infraestrutura.

## Entrega e revisão

- Chave de intenção inclui candidatura; loader valida utilizador/organização/candidatura e método. Migração da chave antiga só no contexto correspondente, sem substituir intenção isolada já existente. Nenhuma migração envia comandos.
- GET work acrescenta canEdit pela autorização APPLICATION_WORK_EDIT; ausência de permissão fecha ações. A guarda de escrita no servidor mantém-se. Cliente HTTP e rota existentes preservam o campo sem adaptação.
- 401/403/404 limpam projeções visíveis e mantêm intenção. Recuperação requer consulta e clique explícitos; chave/payload preservados. Paginação atualiza permissão e histórico trata recusa. Geração de contexto descarta respostas tardias após desmontagem; falha de armazenamento bloqueia transmissão.
- Revisão focada concluída sem bloqueios neste âmbito. Alterações de contexto pré-existentes no repositório preservadas.
- Regressão inicial: 5 falhas reproduzidas. Frontend final: 696 testes / 82 ficheiros aprovados. Backend: 2594 aprovados, 7 ignorados, zero falhas. Sintaxe backend e build frontend aprovados. Falhas intermédias de sintaxe e fixture corrigidas antes da validação final.
- Chrome local com API simulada: administrador e membro; recusa, reconsulta sem edição, recuperação explícita com comando idêntico, bloqueio de intenção antiga estrangeira; 1440px/390px. Evidência em output/playwright/team-pending-permissions/verification.json. Captura mobile inspecionada.
- Não foram usados dados reais nem ativados R2/ClamAV ou deploy. Nenhuma migração de base de dados ou alteração de links oficiais.

Próximo passo: validar a recuperação integrada ao alternar candidaturas e organizações, verificando em conjunto equipa, parceiros e documentos, sem novas funcionalidades.
