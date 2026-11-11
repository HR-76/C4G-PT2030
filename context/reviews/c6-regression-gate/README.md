# Gate de regressão C6 — 27/10/2026

Implementado o pedido de usar o SLO aprovado nas futuras regressões C6. [Decisão](../../decisions/2026-10-27-c6-admission-slo.md) e [comandos](../../../test/integration/c6-dedicated/README.md).

O diagnóstico anterior devolvia COMPLETE/exit 0 mesmo com SLO reprovado, e o runner não o avaliava. Agora `gate.js` devolve zero exclusivamente com PASS, após conferir a evidência bruta e recalcular as admissões de A e B contra `policy.json`: p95 ≤3000 ms, máximo ≤4000 ms, margem ≥1000 ms para timeout 5000 ms, zero falhas. O runner verifica o contrato antes de operar contentores e executa análise/gate após o finally de reposição do host.

Corrigida também a comparação de `slo.js`: arredondar antes de avaliar permitia aprovar 3000,001/4000,001 ms. A decisão usa agora a precisão disponível; só a apresentação é arredondada. Não foi alterada a precisão histórica das medições.

Exigidos: 12 bursts na ordem AB/BA, seis respostas e 18 admissões por burst; aquecimentos separados; políticas integrais iguais; cinco checks reais de segurança; 198 chamadas de protocolo e dez prepares/appends por dashboard; zero erros SQL/admissão/HTTP e queries após resposta; hashes e manifests das fontes A/B, preflights e observador v2 com CPU/memória dentro dos limites definidos. Dados ausentes, inconsistentes ou fora do workspace são recusados. Contagens de queries/transações não são um teto de desempenho nem substituem autoridade.

Validação: [15 testes focados](tests.log) PASS, incluindo CLI real, fronteiras exatas e fracionárias, tentativas de relaxar critérios, omissões, ambiente inválido e integridade das fontes. [Sintaxe](syntax.json) PASS nos quatro JavaScript alterados/adicionados e runner PowerShell. [Avaliação das provas preservadas](evidence-evaluation.json): repetição válida exit 0/PASS; primeira série exit 1/INVALID_ENVIRONMENT. Não foram reescritos os artefactos históricos.

A integração PowerShell foi validada por parsing e revisão; não se iniciou novamente o runner de carga. Não houve nova reserva do computador, operações Docker, HTTP/OIDC, acesso SQL ou build frontend/suites globais neste incremento. Este gate não é uma nova prova de revogação/durabilidade nem demonstra desempenho produtivo.

[Baseline](baseline.json) e [preservação final](preservation.json) registam HEAD, branch e hashes dos ficheiros existentes, incluindo o worktree previamente alterado. Alterações restritas a harness, testes e documentação; runtime, migrations, grants/permissões, dados Dev e deploy não foram alterados. A comparação de hashes não é um snapshot atómico de todo o repositório ou dos dados Dev. Sem commit, merge ou push.

O runner histórico continua a fixar os três módulos e destinos anteriores. Cada nova regressão requer protocolo/nomes/manifests novos antes da carga; o gate aceita esses diretórios sem alterar o SLO. A política só muda por decisão explícita, nunca para aprovar uma execução desfavorável.
