# Interrupção após aceitação simulada — 2026-11-03

Fornecedor simulado alojado no processo pai, independente do worker filho. Ponte IPC isolada no transporte, sem HTTP, SDK ou credenciais reais de fornecedor. Worker filho continua com login restrito e consumer real; autoridade passa pelo motor real da fixture.

Gate aprovado:
- Fornecedor aceita uma vez; checkpoint antes de store.finish confirma ledger RESERVED.
- Worker terminado com SIGKILL e saída aguardada; ledger continua RESERVED.
- Novo processo após expiração da lease repete a mesma chave e o mesmo conteúdo (igualdade verificada).
- Fornecedor conserva a aceitação entre processos: 2 chamadas, 1 aceitação.
- Resultado recuperado persistido como ACCEPTED.
- Outro processo reencontra ACCEPTED e não chama o fornecedor.

PostgreSQL e credenciais descartáveis; nenhum email real. Janela testada após resposta de aceitação e antes da escrita local. Pai/fornecedor permanece vivo durante os reinícios; não é prova de perda simultânea do fornecedor simulado nem garantia externa de exactly-once. Worker global da APP permanece desativado.

56 testes focados aprovados. Gate repetido aprovado; sintaxe dos JS verificada. Sem necessidade de mudar a lógica de recuperação do consumer; alterados ponte de simulação e harness de processos.

Próximo passo: integrar e validar o link autenticado da candidatura, incluindo confirmação explícita da organização correta, sem envios reais.

Suite backend final: 2650 aprovados, 7 ignorados, zero falhas (2657 total), exit 0. Evidência application-status-emails-acceptance-suite.log. Diff check aprovado.
