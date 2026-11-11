# Ativação do carregamento central PT2030

Estado: pacote 049 registado e validado em PostgreSQL isolado. Sem instalação nem ativação no ambiente habitual. Não executar este documento como script.

## Componentes

- `CENTRAL_PT2030_IMPORT_RUNTIME=preview` compõe o serviço na API; por omissão está `disabled`.
- Usa `C4G_R2_*` e `C4G_CLAMAV_*`, com jurisdição EU e validação R2 existentes. Não registar credenciais.
- Prefixo `central/portugal2030/`, sem organização fictícia nem downloads públicos. Original em quarentena, admitido apenas após CLEAN e inspeção estrutural.
- Verificar retenção/lifecycle: não expirar originais referenciados. Reconciliação de objetos rejeitados ou sem recibo será tratada separadamente; sem eliminação automática neste incremento.
- O preview já existe em `038_pt2030_plan_v2`. O pacote `central-pt2030-upload-preview-v1` acrescenta apenas `049_pt2030_document_upload`, desde `048_catalog_read_service_v1`. Os SQL estão em `candidates`, mas são registados.
- Disponibilidade exige assinatura completa de 049, permissões privadas e saúde de R2/ClamAV.

## HTTP

Base: `/api/admin/directory/imports/portugal2030`, com sessão e CSRF existentes.

| Método | Percurso | Resultado |
|---|---|---|
| GET | `/` | Disponibilidade e modo PREVIEW_ONLY |
| POST | `/xlsx` | Multipart file + requestId; original verificado e folhas |
| GET | `/:requestId` | Recibo do titular após releitura verificada |
| POST | `/:requestId/preview` | JSON sheetName + requestId; novo pedido identifica a intenção de preview |

Sem stage, confirmação, publicação ou escrita em tenants. Duas receções simultâneas/processo, 10 MiB/ficheiro, 5.000 linhas e limites ZIP/XML. A interface conserva intenção e ficheiro em memória para retry; não retoma automaticamente após recarregar o navegador.

## Pacote e ensaio

Entrada: `backend/src/security/centralImportMigrationPackage.js`, com checksum fixado e fingerprints medidos em PostgreSQL 18.

Instalação explícita: `applyRegisteredCentralImportPackage(pool, 'central-pt2030-upload-preview-v1')`, exportada por `backend/scripts/runCentralMigrations.js`. O pool deve vir do procedimento de manutenção do ambiente escolhido, após backup/preflight. Não executar SQL diretamente nem instalar no arranque.

Exige marcador CENTRAL, ledger íntegro e versão 048 (ou 049 para repetição). Instalação e registo atómicos. O migrador genérico permanece em 035; o instalador do Catálogo termina em 048. Nenhum instala 049 implicitamente.

Migração irreversível para preservar histórico. Falhas antes do commit revertem a transação. Depois do commit, desligar com `CENTRAL_PT2030_IMPORT_RUNTIME=disabled`, sem eliminar tabelas.

Ensaio na raiz: `node test/integration/central-import/gate.cjs --isolated`. Cria PostgreSQL Docker exclusivo em porta loopback aleatória, sem ler configuração habitual, com imagem local `postgres:18-alpine` e label única. Remove apenas o contentor criado. Evidência e hashes em `output/c4g-central-import-<id>/verification.json`.

Prova instalação/repetição, rollback por falha no ledger, admissão normal, permissões alteradas recusadas, upload/preview de 177 linhas persistidos, imutabilidade, sessão revogada recusada e leitura do Catálogo por credencial limitada. Storage/antivírus são doubles explícitos: não certifica R2/ClamAV reais nem browser autenticado.

## Ativação seguinte

1. Preparar ambiente de teste: backup verificável, preflight 048 e instalação explícita de 049. Manter runtime desligado até validar dependências. Esta entrega não modificou a instalação habitual.
2. Validar R2/ClamAV reais com dados sintéticos: prefixo, retenção, checksum, ficheiro recusado e recuperação de falha.
3. Ativar `CENTRAL_PT2030_IMPORT_RUNTIME=preview` nesse ambiente e testar C4G/cliente, desktop/móvel: ficheiro → verificação → folha → preview, sem alterações de oportunidades ou bases privadas.
4. Manter disponível apenas após passar o percurso completo. Não habilitar fontes ou publicação como consequência desta ativação.

As alterações editoriais do Super Admin e a reconciliação de revisões continuam em incrementos próprios. Preservam-se dados de fonte e links oficiais.

## Dependência Cloudflare confirmada

Em 02/11/2026 o utilizador informou que ainda não tem conta Cloudflare. Não é possível certificar R2 real ou ativar o percurso completo com esse fornecedor antes da sua configuração. Não substituir por armazenamento simulado e declarar ativação real.

Preparação necessária na conta da C4G:

1. Criar conta Cloudflare e ativar R2 (consultar condições de faturação no painel).
2. Criar dois buckets privados exclusivos de teste, por exemplo `c4g-test-documents` e `c4g-test-quarantine`, com jurisdição **European Union (EU)**. Uma indicação de localização europeia não substitui a jurisdição EU exigida pela aplicação.
3. Criar credenciais R2 S3 com **Object Read & Write**, limitadas a esses buckets. Configurar Access Key ID e Secret Access Key no ambiente/gestor de segredos local; não enviar segredos no chat nem guardar no Git.
4. Configurar endpoint `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`, nomes dos buckets e credenciais através das variáveis `C4G_R2_*` existentes.
5. Validar o fornecedor antes de marcar `C4G_R2_LAYER_C_VALIDATED` ou `C4G_R2_MULTIPART_CONDITIONAL_VALIDATED` como verdadeiros. Estas flags representam provas, não substituem os ensaios.

Fontes oficiais: https://developers.cloudflare.com/r2/get-started/ ; https://developers.cloudflare.com/r2/api/tokens/ ; https://developers.cloudflare.com/r2/reference/data-location/

ClamAV é independente da conta Cloudflare. Ensaio isolado real: `node test/integration/central-import/clamav-gate.cjs --isolated`. Verifica o Excel de referência, EICAR inofensivo em memória, integridade e indisponibilidade do daemon, através do adaptador central existente. O armazenamento neste ensaio é um double, não R2.
