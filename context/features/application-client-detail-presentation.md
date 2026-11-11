# Ficha de candidatura do cliente — paridade de apresentação UBI
State: Review
Pedido de 03/11/2026. Apenas GCNI_C4G; sem novas capacidades de negócio.

Comparação: UBI reúne dados, orçamento/anexos, equipa, parceiros e histórico. C4G já liga estes componentes, mas a navegação existente dentro do próximo passo não cobre dados/orçamento nem histórico e coloca documentos depois de equipa/parceiros. Menu Candidaturas exige organização selecionada; C4G_ADMIN não substitui acesso de cliente.

Critérios: navegação local acessível para dados/orçamento, documentos, equipa, parceiros e histórico; documentos junto aos dados/orçamento; identificar organização; preservar todos os formulários, estados, permissões e intenções pendentes. Não ocultar componentes por separadores que os desmontem. Validar edição e consulta com testes existentes e regressão de navegação; suites e build. Não afirmar validação com sessão real sem a executar.


Implementação: reutilizado ApplicationNextStep, agora antes dos dados, com cinco destinos; contexto da entidade no cabeçalho; documentos movidos para depois do formulário e antes de equipa/parceiros; indicação explícita de Budget em Excel. Nenhuma mudança de API ou permissões. Componentes permanecem montados.

Validação: regressão inicialmente falhou; frontend final 717 PASS, 83 ficheiros; build PASS. Chrome com API simulada: navegação por secções e resumo, 1440/390 sem overflow, PASS. Captura mobile inspecionada. Não equivale a autenticação real de administrador; fixture usa capacidades de edição da candidatura/equipa e consulta documental. Prova backend e respetivo resultado registados abaixo quando concluídos.

Próximo passo: confirmar esta ficha na sessão real de administrador do cliente, incluindo disponibilidade dos anexos e associação de colaboradores/parceiros, sem iniciar outra componente.

Suite backend concluída com exit 0 fora da restrição localhost; log: output/application-detail-backend-unrestricted.log. Primeira execução no sandbox interrompida sem conclusão; não contada como aprovação. Nenhum código backend alterado.
