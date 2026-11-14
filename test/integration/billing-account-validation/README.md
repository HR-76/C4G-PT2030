# Gate da validação da ficha de faturação

Preparado, ainda não executado. Requer autorização explícita conforme AGENTS.md.

Comando, a partir da raiz: `node test/integration/billing-account-validation/gate.cjs`.

Cria um cluster PostgreSQL 18 local em `.tmp/billing-validation-pg-<timestamp>`,
escuta exclusivamente em `127.0.0.1` numa porta livre, instala Central até 051 e
aplica o candidato `billing_account_validation.up.sql`. Usa só dados sintéticos,
não lê ligações de ambientes e não envia emails. Para o cluster ao terminar e
preserva a pasta de evidência. Não altera Dev, staging ou produção.

Provas preparadas: escrita apenas C4G, confirmação apenas ORG_ADMIN da entidade
selecionada, isolamento entre entidades, idempotência do pedido/confirmação,
intenção de email única, recusa de versão desatualizada e membership suspensa,
proibição de eliminação pelo role runtime.

Este gate é o primeiro teste da fronteira SQL candidata. Não prova ainda worker,
HTTP, browser, concorrência/revogação em duas ligações, admissão nos manifestos ou
instalação sobre Central 053. Esses passos permanecem necessários antes de ativar.
