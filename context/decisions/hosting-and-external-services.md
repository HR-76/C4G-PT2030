# Decisão: alojamento e serviços externos

## Estado

Aceite para o MVP.

## Decisão

- VPS C4G partilhada.
- Frontend, API e worker como serviços/contentores independentes.
- Reverse proxy HTTPS; portas internas não expostas.
- PostgreSQL no Neon: base central e base/projeto por cliente.
- Cloudflare R2 privado para documentos, anexos, importações e exportações.
- Resend para e-mail transacional.
- Infraestrutura dedicada opcional por contrato, usando o mesmo código-base.

## Restrições

- Apenas API e worker acedem a Neon, R2 e Resend.
- URLs R2 são temporárias e emitidas depois da autorização.
- Worker processa integrações, jobs e outboxes.
- Backups e recuperação são testados.
- Segredos ficam fora do repositório.
- Logs e métricas carregam contexto organizacional sem expor dados sensíveis.

## Evolução

Separar fisicamente API e workers, alojar frontend em CDN e escalar serviços apenas quando carga, disponibilidade ou contrato justificarem.
