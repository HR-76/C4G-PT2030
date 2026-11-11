# PDFs privados de faturação

## Estado instalado — 2026-11-06

Ativo no ambiente habitual http://localhost:3000. Central em 050; migração 049
instalada apenas como pré-requisito aditivo, sem ativar importação externa.
Backend e frontend arrancados pelo supervisor habitual. Nenhum fornecedor fiscal ligado.

Armazenamento: adaptador `local-private`, exclusivo de development. Ficheiros em
`.tmp/local-platform/billing-pdfs/objects`, fora das pastas públicas, com ACL apenas
para o utilizador Windows e SYSTEM. Separação por UUID de entidade e classe;
publicação atómica sem substituição, validação de tamanho/hash e sem URLs públicas.

Scanner: contentor `c4g-billing-clamav`, imagem oficial identificada por
`sha256:e19130cdebaeacc71fa46eab3ed6f69941f2f22aa5e08d55e9197f8edf43ce5e`,
porta exclusivamente `127.0.0.1:3310`, volume persistente `c4g-billing-clamav-db`,
restart `unless-stopped`. O scanner atualiza assinaturas; não envia PDFs a um
fornecedor fiscal. Referência: https://docs.clamav.net/manual/Installing/Docker.html

A configuração privada persistente está em `runtime.json`, campo `billingPdfs`.
O arranque valida o esquema, armazenamento e disponibilidade do scanner. Para
arrancar diariamente, usar `npm run dev`. Se o scanner tiver sido parado manualmente,
executar `docker start c4g-billing-clamav` antes. Não usar este adaptador local em produção.

Backups anteriores à instalação: `.tmp/local-platform/billing-pdfs/backup-1793997567582`.
Incluem dumps custom das duas bases, configuração anterior e hashes por tabela.
Verificação de preservação de todas as tabelas existentes: PASS.
Relatório: `.tmp/local-platform/billing-pdfs/installation.json`.

## Utilização

- C4G: detalhe do ciclo/documento fiscal → PDF original → Confirmar PDF.
- Entidade: Acessos da organização → Dar/Retirar acesso financeiro → confirmar.
  Apenas ORG_ADMIN gere esta concessão; o seu acesso financeiro é inerente ao perfil.
- Cliente: Faturação → detalhe → PDF disponível → Descarregar PDF.

Downloads autenticados, checksum integral e revalidação de acesso antes de enviar
bytes. Limite 10 MiB; quatro pedidos simultâneos por processo. Substituições criam
versões e conservam o histórico. Concessões/revogações usam auditoria central.

## Operação

A ausência/falha do scanner impede publicação. Preservar a pasta de objetos nos
backups, em conjunto com a base central. Não apagar versões existentes.
Objetos de quarentena ou sem referência podem permanecer após falhas; a instalação
conserva-os e não executa limpeza automática. Não expor a pasta através do servidor web.

Para instalação noutra máquina, preparar explicitamente o scanner, ACLs e backups.
O instalador local `backend/scripts/localPlatform/billingPdfRollout.js --apply` é
restrito ao par de bases habitual e verifica preservação de dados antes de ativar.
Para produção permanece disponível o runtime `private` com R2 e ClamAV, sujeito à
configuração e validação próprias; não foi ativado por esta instalação.

## Evidência

PostgreSQL descartável com e sem extensão de email: PASS, usando o coordenador real.
Armazenamento persistente local + ClamAV real: ficheiro limpo aceite, assinatura
inofensiva EICAR em memória rejeitada. Suite backend: 2700 PASS, 7 SKIP; build PASS.
