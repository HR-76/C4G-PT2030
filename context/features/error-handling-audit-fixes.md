# Tratamento de erros — correções da auditoria

## Incremento: flush de telemetria

O bootstrap usa `Promise.allSettled` e não verifica resultados de `forceFlush` e `shutdown`, pelo que uma falha pode parecer sucesso ao lifecycle. Corrigir mantendo execução de ambos os fornecedores, propagando erro sanitizado após ambos terminarem e libertando estado mesmo em falha. Não alterar catálogo, exportadores, protocolos de autoridade ou configuração. Regressão primeiro; testes focados, suites completas e build. Outros candidatos da auditoria mantêm-se pendentes de provas específicas.

Resultado 09/11: regressão reproduzida com exporter de métricas sintético (flush resolvia apesar da rejeição). O bootstrap aguarda ambos os fornecedores e rejeita com código sanitizado se algum falhar; shutdown liberta estado no `finally`. Três regressões PASS, incluindo lifecycle a reportar `SHUTDOWN_FAILURE`; testes focados de observabilidade/lifecycle 28 PASS antes da terceira regressão adicional. A primeira tentativa de testes HTTP locais teve EACCES da sandbox; repetição com loopback autorizado PASS. Suite backend 2749 PASS/7 SKIP, frontend PASS e build PASS. Sem bases habituais ou R2 real. Não prova exportação persistente nem corrige outros candidatos de autoridade, workers ou R2.
