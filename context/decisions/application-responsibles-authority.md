# Responsáveis de candidaturas pela autoridade

Decisão aprovada em 2026-10-25. A Central 030 acrescenta ao protocolo
`authority_api.execute` três observações fechadas: página de memberships
elegíveis, validação exata e nomes de memberships já referenciadas.

O contexto organizacional vem da sessão autenticada. A composição aplica
o grant da operação e verifica o guard Tenant antes de consultar a autoridade.
A elegibilidade continua a exigir organização, utilizador e membership ativos,
valid_from atingido e valid_until ausente ou futuro. Não exige um novo perfil
ou grant ao responsável. A página tem 25 resultados e uma sentinela; os nomes
são obtidos em lotes de 100, apenas para referências da mesma organização.
Os nomes históricos não tornam uma membership inativa elegível.

A criação/alteração revalida o responsável; a listagem não autoriza a escrita.
Revogação entre listagem e submissão é recusada. Não existe atomicidade entre
esta observação Central e o commit Tenant. Mantêm-se guard, auditoria,
idempotência e controlo de revisão existentes.

Não há novos grants, memberships de roles ou SELECT genérico. Conservam-se
owner, SECURITY DEFINER, search_path e ACL da função existente. O leitor do
catálogo continua separado, sem acesso à identidade. Apenas reconhece também
o fingerprint admitido de 030. A migration exige a baseline exata 029;
drift é recusado e SQL/checksums históricos são preservados. Não existe down
automático: retirar operações exige retirar primeiro os consumidores.

Aceitação: roles reais em base descartável; paginação, validação exata,
inatividade/revogação, organização estrangeira, falha da autoridade e acesso
SQL direto recusado; grant do solicitante antes da leitura; criação pela UI,
persistência do vínculo e responsável em A e recusa de acesso por B.
