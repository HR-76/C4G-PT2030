# Portugal 2030 na administração C4G

Pedido de 18/10/2026. Substitui a localização anterior na entidade: entrada administrativa exclusiva C4G no grupo Oportunidades e catálogo, destino futuro catálogo central. Não requer selecionar entidade. Retirar menu e acesso à página de importação das entidades; URL antiga redireciona só C4G para o novo percurso.

O processamento XLSX implementado anteriormente é privado/tenant e não deve ser apresentado como central nem utilizado pela nova página. Preservar código e histórico anteriores, sem migrar dados silenciosamente. O envio real continua adiado: requer armazenamento, antivírus e composição central própria. Consulta administrativa de disponibilidade com autoridade C4G atual, sem upload enquanto indisponível. Interface preparada reaproveitada, com indicação explícita destas pendências e ligação ao catálogo central.

Aceitação: menu C4G e proteção de rota; ausência no menu entidade; API de disponibilidade recusada a entidades/anónimos; sem calls à importação privada pelo novo ecrã, sem criação/migração de dados. Build, testes de navegação e autorização.

Resultado: localização e acesso implementados em `/administracao/importar`, com redirecionamento C4G de `/importar`. 23 testes frontend, nove grupos PostgreSQL (incluindo recusa por perfil de entidade), sintaxe e build PASS. Chrome real com contas C4G e entidade: disponibilidade administrativa 200/available=false, entidade 403, upload desativado, zero consultas à importação privada e revisão 1440/390. Evidência `output/playwright/platform-import/verification.json`. A migração do motor privado para composição central não foi implementada; manter esta pendência explícita antes de ativar importações reais. Infraestrutura privada anterior preservada, não ligada ao novo ecrã.
