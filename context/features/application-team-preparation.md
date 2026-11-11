# Preparação da candidatura — equipa e responsabilidades
State: Complete

Reutilizar participantes, tarefas, responsáveis, revisões e histórico existentes. Não criar novos papéis ou permissões.

Entrega: mostrar responsável global e prazo interno junto da equipa; participantes com número de tarefas abertas carregadas; evitar propor novamente participantes já ativos na página; seleção do responsável da tarefa agrupada por equipa e restantes membros elegíveis; tarefas em cartões com estado, responsável e prazo legíveis; aviso informativo quando o prazo da tarefa excede o prazo interno. Resumos identificam paginação parcial, sem afirmar totais globais. Atribuir tarefa não adiciona automaticamente participante nem concede acesso.

Aceitação: visualização e edição mantêm comandos, revisões e recuperação; consulta sem escrita; agrupamentos corretos; não ocultar opções por páginas ainda não carregadas; avisos de prazo não bloqueiam uma escolha válida. Build/testes e desktop/móvel. Sem migrações, deploy ou alterações de autoridade.

## Entrega e revisão

- Responsável global e prazo interno recebidos do registo autorizado da candidatura; resumo junto da equipa, sem nova consulta/contrato.
- Participantes apresentados com identificação do responsável global e quantidade de tarefas abertas carregadas. Participantes ativos já apresentados deixam de ser opções de nova adição; seleção obsoleta também não permite Adicionar.
- Responsáveis de tarefa agrupados em equipa e outros membros disponíveis, preservando os candidatos elegíveis existentes e a opção de carregar mais membros. Não se restringe a atribuição à equipa nem se concede acesso por atribuir tarefa.
- Tarefas em cartões com estado, responsável e prazo formatado em português; formulário e botões alinhados com os componentes visuais existentes. Aviso em tarefas abertas/formulário quando ultrapassam o prazo interno, sem transformar esse aviso numa restrição de negócio.
- Resumos limitados aos dados carregados e indicação explícita de páginas restantes. Sem novos filtros locais que ocultem resultados por carregar.
- Comandos, revisão esperada, idempotência, histórico, consulta sem edição e backend preservados. Nenhuma migração ou nova permissão.

## Validação

- Regressão inicial falhou antes da implementação. Backend completo: 2583 aprovados, 7 ignorados; frontend completo: 653 aprovados; foco final: 27 aprovados; build aprovado.
- Testes novos verificam agrupamentos, exclusão de participantes já ativos, contexto de paginação e aviso de prazo; tarefa posterior continua a enviar a data escolhida, sem adicionar o responsável à equipa.
- Chrome com API simulada: 1440/390 px, resumo, grupos de atribuição e aviso verificados, sem overflow no componente. Captura móvel inspecionada e botões ajustados; nova execução aprovada.
- Evidências: output/team-preparation-*.log e output/playwright/team-preparation/verification.json. Revisão focada sem impedimentos; não representa validação em base real ou deploy.

Próximo passo: melhorar a preparação e revisão dos documentos da candidatura.
