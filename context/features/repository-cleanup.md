# Limpeza do repositório — 31/10/2026

Pedido: retirar do projeto o que já não é necessário à APP, preservando o trabalho existente, os dados e o histórico.

## Âmbito confirmado por inspeção

- Retirar cinco módulos backend sem consumidores: `apiBootstrap.js` e os utilitários `errorResponse.js`, `notificationVisibility.js`, `opportunityStatus.js` e `platformUrl.js`.
- Retirar `frontend/src/pages/Organization/EntityRegistrationProfile.jsx`, substituído no percurso ativo por `EntityProfileCard`, e quinze ícones PNG antigos não referenciados pelo HTML, manifesto ou código.
- Retirar os três geradores pontuais `scripts/extend-{admission-draft,registration,completion}-migration.cjs`; conservar integralmente as migrations que produziram.
- Retirar a dependência frontend `framer-motion`, sem imports, incluindo a pré-otimização Vite e o lockfile.
- Limpar capturas temporárias de `.playwright-cli/`, o `debug.log` da raiz e diretórios de saída vazios; impedir que artefactos locais e arquivos de limpeza apareçam como código novo no Git.

## Critérios de aceitação

1. Arquivar os ficheiros retirados e as configurações anteriores em `.archive/cleanup-2026-10-31/`, com caminhos originais e SHA-256; verificar o conteúdo do ZIP antes de remover as cópias ativas.
2. Não alterar funcionalidades, contratos HTTP, permissões, dados, SQL, serviços, configuração privada ou trabalho paralelo. Sem commit, push ou deploy.
3. Preservar `context/`, testes, fontes de marca, Keycloak, dependências usadas, `.tmp/`, o Git aninhado `CAND-C4G/` e as provas/baselines de `output/`. As baselines históricas conservam os seus hashes e cópias originais.
4. Confirmar a ausência de consumidores dos módulos/recursos retirados e validar suites backend/frontend, testes operacionais locais e build frontend. Não executar gates externos ou migrations.
5. Registar o resultado e a localização do arquivo recuperável neste documento. O arquivo local é ignorado pelo Git; não é uma cópia de segurança externa.

## Resultado

Concluído no âmbito confirmado: 108 ficheiros retirados (24 módulos/scripts/ícones e 84 capturas/log temporário), sete diretórios vazios removidos e `framer-motion` retirado do manifesto, pré-otimização e lock. O npm atualizou o lock offline e removeu também as entradas transitivas exclusivas `motion-dom`, `motion-utils` e `tslib`. Dependências instaladas foram conservadas porque também servem snapshots históricos através de junctions.

O `.gitignore` passa a excluir as saídas locais `output/`, `backend/output/`, `frontend/output/`, `.playwright-cli/`, `.archive/` e o Git aninhado `CAND-C4G/`; o conteúdo de prova e o histórico dessas pastas foram preservados. A inspeção independente confirmou consumidores reais em documentação, provas, scripts e pastas aparentemente temporárias. Nenhuma eliminação em bloco de `.tmp/` ou `output/`.

### Recuperação

- Arquivo local: `.archive/cleanup-2026-10-31/originals.zip`, com 112 entradas (108 ficheiros retirados e quatro configurações anteriores), verificadas individualmente por SHA-256 antes da remoção.
- SHA-256 do ZIP: `9549d946e636841748e5f701e9a665aeda4b8b09a3632f7b2a3667a394526266`.
- Índice: `.archive/cleanup-2026-10-31/manifest.json`, com caminhos, tamanhos, hashes e ação aplicada.
- Para recuperar, extrair o ZIP para uma pasta de revisão e copiar apenas os ficheiros pretendidos para os caminhos originais; não substituir configurações atuais em bloco.

### Validação

- Backend: 2256 PASS, 0 FAIL, 7 SKIP (2263 testes).
- Frontend: 495 PASS, 63 ficheiros; build PASS.
- Supervisor local: 22 PASS; sintaxe de `frontend/vite.config.js` e `git diff --check` do âmbito alterado PASS.
- Revisão independente frontend/backend: sem imports ou consumidores funcionais pendentes; manifesto e lock coerentes; recursos C4G ativos preservados.
- Conferência SHA-256 de 2870 ficheiros: 28 alterações previstas nesta limpeza; uma alteração paralela em `context/features/dashboard-tenant-read-cost.md`, que esta tarefa não editou. Restantes ficheiros conferidos intactos. A atualização final deste contrato é adicional e intencional.
- Logs locais em `.archive/cleanup-2026-10-31/`. As tentativas iniciais de testes foram impedidas por `spawn EPERM` da sandbox; as execuções com permissão passaram.

### Limites históricos

Não foram executados gates de infraestrutura, migrations ou validação contra bases externas. `test/integration/partner-portal/sources.json` já apresentava 67 hashes divergentes antes da limpeza; cinco módulos agora arquivados constam desse manifesto. A reprodução desse gate e das baselines EU exige as versões históricas correspondentes. Os manifestos, hashes e snapshots originais foram preservados; não foram regenerados para simular uma validação da versão atual.
