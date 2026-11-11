# Limpeza de código morto

## Estado

Review — 19/10/2026.

## Objetivo

Remover código que não participa em nenhum percurso suportado da aplicação, sem alterar contratos HTTP ativos, dados, migrations, autorização ou comportamento funcional.

## Âmbito confirmado

- Ficheiros de produção sem caminho de entrada e sem consumidor no runtime, scripts ou testes.
- Testes que apenas exercitam um módulo removido e sem integração na aplicação.
- Imports, bindings, exports e helpers sem qualquer referência.
- Métodos de cliente e estilos que servem exclusivamente páginas ou componentes removidos.

## Fora de âmbito

- Rotas backend ainda montadas numa composição suportada, mesmo quando não são usadas pela composição habitual.
- Código invocado dinamicamente, adaptadores opcionais, scripts operacionais, migrations e artefactos de preservação histórica.
- Refatorações funcionais ou alterações de arquitetura.
- Ficheiros gerados de evidência em `context/reviews/` e `output/`.

## Critérios de aceitação

1. Cada remoção tem evidência estática de ausência de consumidores ou é um binding local não referenciado.
2. O grafo de módulos do frontend não contém ficheiros de produção órfãos conhecidos.
3. O backend não contém módulos de `src/` sem referência no runtime, scripts ou testes conhecidos.
4. O build do frontend termina com sucesso.
5. Os ficheiros JavaScript alterados no backend passam `node --check` e os testes direcionados relevantes passam.
6. Não são alterados dados, migrations, configuração operacional, permissões ou contratos HTTP ativos.

## Resultado

- Removidos quatro módulos/páginas de produção sem entrada (`Signup`, `SetPassword`, repositório de consulta de auditoria e serviço antigo de versões documentais).
- Removido o componente `ProfileLinks`, o respetivo teste isolado e os dois métodos de cliente que só esse componente consumia.
- Removidos o cliente de imports legacy sem consumidor, três métodos de autenticação frontend desligados, quatro exports frontend não usados e bindings locais/imports sem referência.
- Removidos estilos exclusivos dos ecrãs/componentes eliminados e estilos de login legacy sem qualquer consumidor.
- Preservadas as rotas de autenticação legacy do backend porque continuam montadas numa composição suportada.

## Validação

- Grafo estático frontend: nenhum módulo de produção órfão conhecido.
- Pesquisa de exports frontend: nenhum export com uma única ocorrência residual.
- Pesquisa backend por módulos: nenhum ficheiro de `backend/src` sem referência conhecida.
- `npm run build` no frontend: PASS.
- Testes frontend direcionados: 11/11 PASS.
- Testes backend direcionados: 83/83 PASS.
- `node --check` nos onze ficheiros backend alterados: PASS.
- Suite frontend global: 271/273 PASS; duas falhas já divergentes do runtime atual (`/integracoes` esperado em vez de `/administracao/dashboard` e label `Prazo` esperado em vez de `Prazo interno`).
- Seleção backend alargada: 105/108 PASS; três falhas preexistentes por expectativas de migration 026 perante manifesto 030 e deteção de `localStorage` em fontes não alteradas por esta limpeza.
