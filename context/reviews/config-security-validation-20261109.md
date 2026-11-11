# Configuração e padrões de segredos — validação isolada

Data: 09/11/2026. Não foram lidas configurações reais `.env`, acedidas bases habituais nem contactados fornecedores. Os testes usam entradas e adaptadores sintéticos.

## Matriz parcial executada

64 testes PASS em `f2Security`, `documentApiConfiguration`, `documentApiInfrastructure`, `localCatalogReaderConfig` e `optionalMfa`. Cobrem configuração obrigatória de OIDC, origem de redirecionamento, HTTPS de produção, política de assurance, recusa de providers de teste em produção, destinos de health, configuração documental em falta e leitor de catálogo sem fallback administrativo. Os testes documentais usam cliente injetado sem rede. Estes testes não demonstram a configuração implantada e não cobrem integralmente todos os serviços ou modos de build.

## Pesquisa limitada

`python test/integration/config-security/scan_tracked.py` examinou 1549 ficheiros de texto rastreados no estado atual; 43 ficheiros foram ignorados por não existirem, serem binários, grandes, symlinks ou ficheiros de ambiente. Procurou marcadores de chave privada e padrões selecionados de chaves AWS e tokens GitHub e Resend. **Nenhuma correspondência** nesses padrões. O programa devolve apenas tipo, caminho e linha; não imprime valores encontrados.

Limites: não analisa ficheiros não rastreados, histórico Git, variáveis do processo, cofres, artefactos, credenciais de infraestrutura nem todos os formatos de segredo. Padrões desconhecidos ou não correspondentes podem existir. O resultado não certifica ausência de segredos. A verificação do histórico e de sistemas externos precisa de âmbito e mecanismo apropriados; não copiar ou divulgar valores. R2 real permanece adiado.
