# Orientação após conclusão de uma ação

Pedido: retirar «Próximo passo» quando a ação indicada termina com sucesso.

Critérios de aceitação:
- A confirmação de uma ação indicada retira a orientação da fase atual.
- Abrir secções, cancelar, falhar ou aguardar confirmação não retira a orientação.
- A orientação permanece retirada ao reabrir a candidatura na mesma sessão do navegador, separada por utilizador, organização, candidatura e fase.
- Uma nova fase pode apresentar a sua própria orientação. Retirar o aviso não declara a candidatura pronta para submissão.

Validação: 62 testes focados aprovados; 91 testes dos painéis aprovados com um worker e limite de 15 segundos; build e lint aprovados. A suite completa registou 1120 testes aprovados e um timeout de 5 segundos no teste de parceiros «applies existing server field limits and stops adding people at fifty», aprovado na repetição isolada. Nenhuma expectativa de teste foi removida.
