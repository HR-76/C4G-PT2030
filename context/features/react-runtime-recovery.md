# Recuperação do runtime React em desenvolvimento

Correção técnica do piloto/interface atual, sem alteração funcional ou de arquitetura.

Sintoma: Invalid hook call em MotionDOMComponent após 401; o log combina hashes de otimização distintos e referencia um chunk ausente da cache atual. React e React DOM instalados são ambos 18.3.1, deduplicados. Cache antiga/misturada é uma hipótese, ainda sem reprodução da sessão original.

Âmbito: deduplicar explicitamente React no Vite e pré-otimizar Framer Motion com o renderer, incluindo as páginas lazy de autenticação.

Aceitação: build passa; login renderiza no servidor de desenvolvimento sem erros de hooks mesmo quando a consulta de sessão devolve 401. Não modificar autorização nem esconder respostas 401.

Validação (2026-10-17): `npm run build` PASS; `node test/integration/login-runtime.cjs` PASS em Chrome headless e Vite com sessão 401 simulada, abertura e reload do login sem erros de hooks. A sessão original do browser não foi reproduzida; recarregar a página antiga continua necessário. O URL do 401 original não foi fornecido, pelo que a sua causa específica permanece por confirmar.
