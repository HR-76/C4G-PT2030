# Consumidor simulado — 2026-11-02

Implementado handler/registry isolado, organização fixa e versões exatas. Somente transporte simulado autenticado por marca interna. Revalidação por destinatário antes de reserva e imediatamente antes da chamada: identidade, membership, equipa e leituras de candidatura/oportunidade/avaliação. Autoridade indisponível adia, revogação impede chamada; resultado anterior incerto preserva reconciliação.

Tabela de simulação separada, candidato SQL com checksum, RLS e sem grants PUBLIC. Reserva/resultado em transações separadas da chamada. Mensagem imutável após tentativa, chave estável, deduplicação por evento/endereço, lease/fence e bloqueio de revisão posterior. Não alterados os estados persistidos das entregas reais nem ativado o worker global.

Gate PostgreSQL descartável aprovado: percurso produtor/outbox, consumidor, registo persistente da simulação, suspensão, grants de destinatário, aceitação com resposta perdida, retry e duplicação. Dois bancos/containers descartáveis, nenhum email. A instância do fornecedor simulado conserva a memória de idempotência entre reconstruções do consumidor.

Limites: dados de identidade/equipa vêm do PostgreSQL fixture; port de direitos funcionais é controlado pelo teste e não constitui integração do motor completo. Store usa owner tenant apenas na fixture. Próximo passo: ligar ports ao motor real por destinatário e validar o papel worker restrito, mantendo emails reais desligados.

Validação: 52 testes focados aprovados; suite backend 2646 aprovados, 7 ignorados, zero falhas (2653 total). JS verificado com node --check. Evidência completa: application-status-emails-consumer-suite.log. Não houve alteração de frontend, bases da APP, deploy ou envio real.
