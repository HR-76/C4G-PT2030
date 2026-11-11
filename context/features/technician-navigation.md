# Navegação por acesso da entidade

Pedido de 11/11/2026: mostrar na navegação e pesquisa apenas áreas da organização acessíveis ao utilizador, incluindo o perfil Técnico.

- Consultar as capacidades existentes do diretório e o serviço de acessos para a organização e utilizador atuais; não inferir permissões pelo nome do perfil.
- Mostrar Perfil da organização e Pessoas quando a consulta do diretório é autorizada, Unidades apenas quando a capacidade respetiva é concedida e Acessos quando a consulta de acessos é autorizada. Esconder o grupo se não contiver opções.
- Durante carregamento ou erro, não apresentar acesso não confirmado; invalidar resultados ao mudar de utilizador ou entidade. A autorização do servidor permanece obrigatória.
- Aplicar as mesmas regras à pesquisa de páginas. Validar a navegação com permissões diferentes, a sessão de Técnico, testes e build.

## Correção da consulta da candidatura — 11/11/2026

- A consulta da candidatura/equipa deve devolver os nomes dos membros referidos nos resultados autorizados, limitada à organização atual e sem disponibilizar o diretório completo ao Técnico.
- Um utilizador apenas de consulta não deve pedir opções de edição (lista geral de membros ou documentos candidatos a associação).
- Falhas na consulta de membros devem distinguir indisponibilidade de uma lista vazia; não devem ser descritas como um envio incerto.
- Preservar as autorizações da API, incluindo acesso documental próprio. Cobrir com regressões e validar nomes, secções, menus e diálogos em computador e telemóvel.
- Diagnóstico SQL: consultas de detalhe concorrentes podem adquirir o bloqueio de auditoria tenant durante a preparação da autoridade Central, provocando inversão de bloqueios e `LEASE_TIMEOUT`. Estender o contrato fechado de auditoria de leituras já existente às consultas de candidatura, equipa, documentos e parceiros; apenas eventos observacionais ALLOW são acumulados, mantendo DENY/críticos imediatos, flush obrigatório e todas as verificações finais antes do commit. Não aumentar timeouts nem retirar auditoria.
- Capacidades de interface dos detalhes reutilizam a avaliação protegida já usada pelo browse para transições, limitada a um conjunto fechado de ações e ao guard atual. Não executar tentativas de comandos apenas para decidir se um botão é visível. As leituras efetivas e todos os comandos continuam a exigir autorização e auditoria próprias; snapshots nunca são partilhados entre pedidos.
