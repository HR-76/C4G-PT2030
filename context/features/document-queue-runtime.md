# Perfil funcional pg-boss — AV-01

Autorização de 25/10/2026: provisionamento explícito fora do arranque, apenas
em bases descartáveis nesta prova. API mantém outbox Tenant; worker/relay é o
único cliente da fila. Credenciais de instalação, autoridade e fila separadas.

Versão instalada 12.37.0/schema 45: verificar versão e catálogo de filas,
publicar, reclamar, heartbeat, concluir, falhar, cancelar, consultar estado;
registar/atualizar/remover registos de instância segundo o registrar da biblioteca.
Sem scheduler, supervisor, migração ou criação de filas no runtime.

Perfil NOLOGIN sem elevação; login externo NOINHERIT, SET permitido apenas para
esse perfil, sem ADMIN. Grants específicos em pgboss: SELECT version/queue;
SELECT/INSERT/DELETE e UPDATE das colunas de execução em job_common; INSERT em
job exigido pelo CTE de dead letter; DML de instance para registrar/heartbeat/prune.
USAGE no schema. Sem TRUNCATE, CREATE, escrita no catálogo, identidade ou diretório.
As três filas documentais são pré-instaladas, não particionadas, sem dead-letter
ou políticas adicionais; configuração divergente falha antes do consumo.

Critérios: operações reais positivas e negativas em PostgreSQL; detecção de
drift e configuração incompleta; fingerprints Central preservados; npm start
real com OIDC, HTTP documental, restart/persistência e shutdown. Nenhuma prova
externa R2 nesta fase; storage controlado apenas pelo selector de teste existente.
