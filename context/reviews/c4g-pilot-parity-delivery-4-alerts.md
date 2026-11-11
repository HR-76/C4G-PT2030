# Alertas de candidaturas — revisão da recuperação

2026-10-18. Estado: Review. A entrega 4 global continua em curso.

## Implementado e ativado

- Caixa de alertas do piloto, cartões, mensagens, datas, ligações e leitura individual/em lote. Acesso para membros da organização, sino com contagem autorizada, filtros de equipa e prazo; falhas explícitas e repetição. Resultados antigos descartados quando muda a organização/utilizador.
- Mudanças de estado para responsável/equipa, como confirmado pelo utilizador; autor excluído e destinatários repetidos deduplicados. Inclusão na equipa avisa a pessoa adicionada. Memberships centrais ativas e autorização atual do recurso condicionam a divulgação; nenhum grant decorre do alerta.
- Avisos 30/7/1 dias, janela de recuperação de dois dias, para candidaturas Em preparação. Verificação dos próprios prazos ao entrar/atualizar a aplicação. Data de fecho da oportunidade privada ou snapshot central associado; dia civil de Lisboa. Sem execução fora da sessão, emails ou reativação do scheduler global.
- Migração tenant 029, aditiva, com RLS de organização/destinatário, eventos imutáveis e leitura monotónica. Estado/equipa na transação original; leitura e geração de prazo auditadas com eventos F7 próprios. Não reescrever histórico nem gerar retroativamente notificações usando a equipa atual.

## Evidência

- 29 testes backend de alertas/candidaturas/tarefas/parceiros/F7 PASS; mais 69 de leases F4, runtime de leitura, autorização F5 e composição PASS. Dois testes de contagem de catálogo estavam desatualizados: atualizados para os catálogos explícitos, mantendo as listas fechadas e a proibição de grants implícitos.
- Dez testes frontend PASS: erros versus vazio, repetição, leitura, filtros, bloqueio de cliques duplicados, respostas atrasadas entre contextos e contagem do servidor. Build e verificações sintáticas PASS.
- PostgreSQL 17 descartável: migração/fingerprint, preservação de campos/tarefas/histórico/recibos e rollback; HTTP com duas organizações, destinatários, duplicação responsável/equipa, replay, COMMIT incerto, rollback por falha F7, leitura própria, revogação e RLS. [Prova funcional](../../output/playwright/c4g-alerts/verification.json).
- Chrome sobre serviços reais descartáveis: três alertas de ensaio; leitura persistida após recarregar, ligação à candidatura, filtros e caixa vazia na outra organização; 1440/390 px, sem overflow nem erros. [Prova visual](../../output/playwright/c4g-alerts/visual-verification.json).
- [Comparação lado a lado](../../output/playwright/c4g-alerts/comparison.html): original `2fa3b1c` com respostas simuladas versus C4G sobre PostgreSQL descartável. Capturas inspecionadas: composição e densidade conservadas; cores/logo C4G; tipos de prazo legíveis. Dados de ensaio identificados nas imagens.
- Instalação habitual: migração 029 aplicada com backup PostgreSQL protegido/verificado; hashes das tabelas de negócio anteriores iguais; privilégio temporário do instalador retirado. API reiniciada, worker existente disponível. [Prova de atualização](../../output/playwright/c4g-alerts/local-upgrade.json).
- Chrome OIDC habitual: conta de membro, GET alertas 200, caixa vazia coerente com ausência de candidaturas; atualização dos próprios prazos não criou registos. Candidaturas/Pessoas acessíveis; catálogo central e restantes dados tenant preservados. [Prova nativa](../../output/playwright/c4g-alerts/native-verification.json). Não apresentar alertas sintéticos como mensagens reais recebidas.

## Limites e pendências

- Email adiado por decisão explícita; nenhum envio real e nenhuma promessa de agendamento fora da aplicação.
- Comunicação administrativa global permanece no legado. O POST broadcast não foi ligado a todos os membros/organizações: essa adaptação requer definir o âmbito administrativo, separadamente dos destinatários de candidaturas já confirmados.
- Lista conserva o limite de 100 alertas do piloto, com aviso explícito; contagem de não lidos autorizada sobre o conjunto. Acima de 10 000 registos examinados, recusa explícita em vez de contagem parcial.
- Eventos históricos globais não foram migrados sem correspondência demonstrada. Novos eventos operam a partir da ativação; histórico anterior preservado.
- Portugal 2030 e anexos continuam dependentes de armazenamento/antivírus; estas pendências e a validação integral não ficam resolvidas por este incremento.

Próximo passo: rever a comparação dos alertas com o utilizador e delimitar a comunicação administrativa ainda pendente da entrega 4.
