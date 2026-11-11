# Recuperação UBI — revisão funcional

Data: 03/11/2026. Revisão de código e evidências existentes, sem implementação nem certificação do ambiente real. Esta lista atualiza as prioridades dos planos históricos.

## Falta ao utilizador

1. **Editar oportunidades existentes (Super Admin C4G).** Criação e consulta centrais existem; falta o percurso geral para completar/corrigir informação, preservando links oficiais e correções em atualizações da fonte. A edição de critérios não substitui esta função. Referência: RF-08A da especificação consolidada e CentralOpportunityCreate/CentralOpportunities.
2. **Concluir a importação do Excel até ao Catálogo.** Upload e preview foram desenvolvidos; o contrato central-import-upload-preview.md exclui explicitamente staging/publicação. Falta integrar confirmação, publicação e resultado por linha, reutilizando preparação central existente. É trabalho funcional distinto da configuração R2.
3. **Alertas de descoberta, abertura e prazo das oportunidades.** A UBI tem notifyNewOpportunity, checkDeadlineAlerts e checkOpportunityOpeningAlerts em notificationService.js. Não foi identificado produtor equivalente no percurso C4G analisado. Notificações operacionais e emails de estado da candidatura não substituem estes avisos.
4. **Ficha agregada da unidade.** A UBI tem ResearchCenterDetail.jsx; a C4G distribui pessoas e candidaturas entre diretório e relatórios, sem percurso equivalente no router analisado. Recuperar a consulta agregada, sem impor estrutura universitária.
5. **Gestão de áreas temáticas e palavras-chave.** A UBI tem CRUD em Areas.jsx; não foi identificado percurso administrativo equivalente na C4G. Selecionar áreas já existe. Definir responsabilidade pela taxonomia comum antes de recuperar a edição, distinguindo áreas temáticas de áreas de intervenção.

Os itens 3–5 são diferenças de paridade, não bloqueadores automáticos do deployment. A análise identifica percursos em falta; não afirma ausência de todos os componentes internos reutilizáveis.

## Retirar da lista antiga de desenvolvimento pendente

As entregas posteriores ao plano original já cobrem filtros do Catálogo e pessoas, opções de programas internacionais, classificação manual, parceiros, interesse → candidatura, equipa/tarefas/documentos, resumo de preparação e confirmação das transições. Matching e dashboard também existem. Não reconstruir estes módulos.

As opções HORIZON/LIFE não comprovam cobertura atualizada das fontes: validar dados é aceitação operacional, não refazer filtros. Diretório reutilizável de parceiros e configurador genérico de pipeline são evoluções adicionais, não recuperação obrigatória da UBI.

## Pendências técnicas para deployment

- Configurar/validar armazenamento real R2 e composição com antivírus para upload/preview e percursos documentais aplicáveis. ClamAV já tem prova isolada.
- Admitir/aplicar esquemas e permissões necessários, configurar serviços e validar autenticação/autorização no ambiente alvo.
- Validar recolhas das fontes oficiais e cobertura efetiva nacional/internacional, mantendo links oficiais.
- Concluir ligação produtiva dos emails internos já simulados: autoridade, persistência/worker, fornecedor e operação. Retomar application-status-emails-readiness.md; emails reais continuam desligados e parceiros externos fora do âmbito.
- Aceitação integrada no ambiente de teste com administrador e membro antes de produção. Provas simuladas não certificam deployment; não repetir provas aprovadas sem alteração ou risco concreto.

## Próximo passo

Recuperar a edição de oportunidades existentes pelo Super Admin, aproveitando formulário e contratos existentes, com campos editáveis e preservação das fontes definidos antes de alterar código. Engenharia de ativação dos emails fica em espera para deployment.

Evidência: ubi-functional-recovery-specification.md; central-import-upload-preview.md; central-manual-opportunity-authoring.md; application-status-emails-readiness.md; entregas em context/history; frontend/src/App.jsx e páginas centrais/diretório. Referência UBI: GCNI_UBI/GCNI_C4G-main no workspace.
