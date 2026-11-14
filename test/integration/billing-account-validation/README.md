# Gate da validação da ficha de faturação

Executado com autorização explícita do utilizador em 14/11/2026. Usa exclusivamente bases descartáveis.

Comando, a partir da raiz: `node test/integration/billing-account-validation/gate.cjs`.

Cria um cluster PostgreSQL 18 local em `.tmp/billing-validation-pg-<timestamp>`,
escuta exclusivamente em `127.0.0.1` numa porta livre, instala Central até 053 e
aplica o pacote registado da Central 054 `billing_account_validation.up.sql`. Usa só dados sintéticos,
não lê ligações de ambientes e não envia emails. Para o cluster ao terminar e
preserva a pasta de evidência. Não altera Dev, staging ou produção.

Provas preparadas: escrita apenas C4G, confirmação apenas ORG_ADMIN da entidade
selecionada, isolamento entre entidades, idempotência do pedido/confirmação,
intenção de email única, recusa de versão desatualizada e membership suspensa,
proibição de eliminação pelo role runtime.

Inclui pedidos e confirmações concorrentes, claims exclusivos, repetição de entrega,
marcação de aceitação e cancelamento após revogação do destinatário. A suite unitária
testa o transporte com fetch simulado; este gate não contacta Resend nem testa OIDC
num browser. `--staging` reproduz os logins de staging numa base descartável.
`--calibrate` mede assinaturas canónicas antes de registar o pacote; não é um instalador.
