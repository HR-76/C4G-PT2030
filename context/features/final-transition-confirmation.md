# Confirmação de transições finais
State: Complete

Recuperar diálogo UBI e melhorar explicação no detalhe da candidatura C4G. Confirmar APPROVED, REJECTED, CANCELLED e ARCHIVED apenas quando já constam das transições autorizadas. Mostrar candidatura, estado de origem/destino, motivo e consequência real: aprovadas/rejeitadas só passam a arquivadas; canceladas/arquivadas não têm transições de saída. Não prometer bloqueio de documentos/equipa nem submissão externa.

Reutilizar useConfirmDialog. Cancelar/Escape/fechar ou abandonar o contexto não cria intenção nem envia pedido; mantém motivo. Um único envio após confirmação, com revisão/motivo capturados e idempotência existente. Envios já confirmados mas pendentes usam repetição existente, sem novo diálogo. Sem alterações de estado, grants, backend, lista ou links oficiais.

Aceitação: testes de regressão antes da implementação, cancelamento/confirmação/abandono/duplicação/repetição e permissões; suites completas, build e Chrome simulado.

## Entrega e revisão

- Diálogo existente integrado apenas no detalhe. Mensagens específicas para aprovação/rejeição (só arquivamento posterior) e cancelamento/arquivo (sem nova transição). Mostra título, origem/destino e motivo capturados.
- Nenhuma intenção antes de aceitar. Cancelar, Escape, fechar e desmontar impedem envio; motivo preservado ao cancelar. Guarda inFlight existente evita duplicação. Revisão e transições disponíveis são verificadas novamente após aceitar; servidor continua autoridade final.
- Repetição de intenção já confirmada mantém payload, revisão e idempotencyKey, sem novo diálogo. Estados, permissões, lista e links oficiais preservados.
- Regressão inicial: 5 falhas. Frontend final: 703 testes aprovados / 82 ficheiros. Build aprovado. Backend: 2594 testes aprovados, 7 ignorados, zero falhas.
- Chrome com API simulada: quatro estados, cancelar com Escape, foco inicial em Voltar, zero escritas antes da aceitação, um comando por confirmação, motivo/revisão corretos e membro sem ações. Capturas 1440px/390px e inspeção mobile aprovadas; evidência output/playwright/final-transition-confirmation/verification.json.
- Revisão focada sem bloqueios neste âmbito. Sem alteração de backend, esquema ou infraestrutura; sem deploy.

Próximo passo: avaliar a recuperação dos emails de mudança de estado existentes na UBI, identificando integração e regras de destinatários antes de implementar.
