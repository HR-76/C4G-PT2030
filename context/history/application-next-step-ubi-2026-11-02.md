# Recuperação do próximo passo da candidatura UBI
State: Complete

Limite confirmado pelo utilizador: recuperar e melhorar apenas capacidades existentes na UBI; identificar separadamente qualquer funcionalidade nova.

Evidência: GCNI_UBI/GCNI_C4G-main/frontend/src/pages/Applications/ApplicationDetail.jsx, bloco Próximo passo, usa APPLICATION_STATUS_NEXT_ACTION de frontend/src/utils/applicationUi.js. Existem secções de equipa, parceiros, orçamento/anexos, mas não foi encontrado resumo agregado que calcule pendências de equipa/tarefas/documentos.

Âmbito desta entrega: recuperar orientação por estado, adaptando rótulos e transições C4G, e disponibilizar atalhos para as secções existentes. Sem contagens agregadas, regras de completude, percentagens de preparação ou novos bloqueios. Resumo automático de pendências é proposta nova, informada ao utilizador e não implementada.

Aceitação: orientação adequada aos estados atuais incluindo terminais; links levam a equipa/tarefas, parceiros e documentos; nenhuma escrita nem consulta adicional; permissões e conteúdo existentes preservados; testes/build e navegador.

## Entrega e verificação

- Bloco Próximo passo recuperado com base na tabela UBI, adaptado aos códigos C4G. Estados terminais orientam consulta/preservação sem propor transições que a C4G não permite.
- Atalhos para equipa/tarefas, parceiros e documentos existentes; destinos focáveis e margem de deslocação para o cabeçalho. Sem queries adicionais, comandos de escrita, mudanças de permissões ou regras de preparação.
- Regressão falhou antes da implementação. Backend: 2583 aprovados/7 ignorados; frontend: 661 aprovados em 81 ficheiros; build aprovado.
- Chrome local com API simulada, 1440/390 px: orientação e navegação por âncoras/foco aprovadas, captura móvel inspecionada. Evidência output/ubi-next-step-*.log e output/playwright/ubi-next-step/verification.json.
- Revisão focada concluída sem impedimentos para esta recuperação. Sem deploy.

## Proposta nova não implementada

Resumo automático que reúne pendências de equipa, tarefas e documentos. Não foi encontrado equivalente na UBI. Exigiria definição própria de pendência, tratamento de páginas incompletas/permissões e critérios de agregação. A sugestão anterior do assistente não deve ser tratada como funcionalidade UBI. O utilizador foi informado antes de qualquer implementação dessa proposta.

Próximo passo: decidir com o utilizador se pretende acrescentar o resumo automático, identificado como funcionalidade nova, ou continuar apenas a recuperação UBI.
