# Pendências da candidatura em modal

Pedido (2026-11-19): retirar a faixa permanente «Próximo passo» da ficha da candidatura e substituí-la por um botão «Pendências» que abre um modal com as questões a tratar, com visto nas que já estão feitas.

Substitui `application-next-step-completion.md` e a apresentação de `application-next-step-ubi.md`.

## Regras confirmadas pelo utilizador

- Equipa: feita com pelo menos um participante ativo.
- Parceiros: podem não existir, mas em geral existem. Aparecem como «se aplicável»: têm visto com pelo menos um parceiro, mas não contam para o número de pendências do botão.

## Regras assumidas nesta entrega (por confirmar)

- Documentação: feita com pelo menos um documento associado.
- Responsável e prazo interno: feitos quando estão preenchidos na candidatura.

## Pontos por estado

| Estado | Pontos | Passo seguinte |
|---|---|---|
| Identificada | Responsável; prazo interno | Iniciar a preparação |
| Intenção | Equipa | Iniciar a preparação |
| Em preparação | Equipa; parceiros (se aplicável); documentação | Registar a submissão |

Nos restantes estados não existe botão de pendências.

## Critérios de aceitação

- A ficha deixa de mostrar a faixa «Próximo passo».
- O botão «Pendências» mostra o número de pontos obrigatórios por tratar; sem pontos por tratar, não mostra número.
- Os vistos resultam dos dados da candidatura, por isso são iguais para cliente e técnico e mantêm-se entre sessões e dispositivos.
- Um ponto cujos dados ainda não foram lidos, ou não puderam ser lidos, aparece como «A consultar…» ou «Consulta indisponível», nunca como feito nem como por tratar.
- Cada ponto por tratar leva à secção ou ao formulário correspondente; o modal fecha ao seguir.
- Os parceiros só são consultados quando o modal é aberto.
- O passo seguinte só é oferecido a quem pode mudar o estado e só depois de os pontos obrigatórios estarem feitos.
- O modal indica que é uma verificação interna: não confirma elegibilidade nem prontidão para submissão, e não bloqueia nenhuma ação.
