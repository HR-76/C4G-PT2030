# GCNI — ligação funcional do catálogo
Estado: Complete nesta preparação; autorrevisão concluída. Âmbito autorizado: preparar ligação desligada e validar numa cópia isolada; sem promoção, fontes ou otimização.

## Implementação
- Montagem oficial de /api/catalog-read/v1 após a sessão na composição normal, com CATALOG_READ_RUNTIME=disabled por omissão. Seleção controlled exige um fornecedor de runtime explícito, política durável, readiness e encerramento; ausência ou configuração inválida falha fechada. Não criar pools/grants/migrações por inferência nem promover a capacidade isolatedAdmission.
- Nova entrada /catalogo/consulta e ficha /catalogo/consulta/:id no router normal, sob autenticação e disponibilidade autorizada. Catálogo /catalogo e seus interesses/candidaturas/exportação/criação mantidos. Nenhum mapeamento implícito entre IDs dos dois modelos.
- Entrada visível só quando o servidor confirma disponibilidade; acesso direto continua sujeito ao gate e autorização por pedido. Retorno explícito à gestão existente.
- Cópia de fontes em work/catalog-functional/GCNI_C4G; dependências instaladas partilhadas só para execução. Bases e IdP descartáveis. Alterações aprovadas podem ser devolvidas ao repositório como código desligado, nunca a uma instalação em execução.

## Critérios
1. Sem flag: endpoint recusa, factory não é invocada, catálogo habitual preservado.
2. Com flag e fornecedor inválido: startup falha; sem fallback para dados.
3. Com fornecedor durável válido: rota normal chega ao leitor sob a sessão GCNI; indisponibilidade/revogação/expiração não contornadas.
4. UI normal contém entrada e novas rotas, mantém gestão e não navega UUIDs novos para fichas antigas.
5. Testes dirigidos e suites backend/frontend + build normal; ensaio HTTP/OIDC/browser com composição normal, sem interceptar express.use para montar o leitor.
6. Autorrevisão e limites claros: a configuração do fornecedor do destino, admissão normal das migrações e validação operacional continuam necessárias antes de ativar fora da cópia. A ligação preparada não autoriza aplicar o pacote candidato ao habitual.


## Resultado
2512 testes backend PASS,7 skips herdados;585 frontend PASS;build normal PASS;20 verificações OIDC/HTTP/browser PASS. Artefacto normal (não catalog-isolated), rota montada em app.js pela productionComposition, sem interceptação de express.use. Ensaio terminou OFF e removeu os dois contentores próprios. Sem carga de desempenho.

## Contrato do fornecedor
createCatalogReadRuntime é uma dependência de composição confiável e síncrona; devolve {policyKind:'durable',router,ready,close}. ready é assíncrona e só confirma disponibilidade técnica com true; close é idempotente através da ligação. A declaração policyKind não substitui admissão/ACL/membership no runtime fornecido. O ensaio fornece o leitor durável existente, numa base isolada e com a capacidade isolada já autorizada; essa capacidade não é promovida.
loadProductionDependencies não inventa este fornecedor nem lê credenciais alternativas. CATALOG_READ_RUNTIME ausente/disabled não o invoca; controlled sem fornecedor recusa startup. Preparar o fornecedor/configuração do destino e a admissão normal do pacote continua obrigatório antes de ativar no habitual. Não configurar controlled apenas por esta preparação ter passado.
