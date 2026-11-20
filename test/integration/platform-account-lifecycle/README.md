# Gate PostgreSQL da Central 058

Executar a partir da raiz do repositório, apenas no âmbito isolado autorizado:

```powershell
node test/integration/platform-account-lifecycle/gate.cjs upgrade
node test/integration/platform-account-lifecycle/gate.cjs fresh
```

Cada execução cria um cluster PostgreSQL 18 próprio em `.tmp`, numa porta loopback livre, sem ler URLs/credenciais de bases existentes. Aplica as migrações registadas, usa o login de autoridade real e os cinco perfis produtivos limitados, testa os fluxos e termina o cluster. Só remove o diretório `data` desse cluster após verificar o alvo; conserva pins e resultados.

`upgrade` prova a recusa original em 057, rollback de migração, preservação e instalação explícita. `fresh` aplica a cadeia completa até 058. Ambos validam os pins fixos, repetição, permissões, drift, convites, eliminação e tenant041 real. Comparar os ficheiros `pins.json` dos dois modos.

`calibrate` é apenas uma ferramenta de desenvolvimento para medir os pins num cluster novo; não é gate de aprovação, não altera o manifest e não permite admissão dinâmica em runtime. Os pins medidos têm de ser revistos e confirmados por `upgrade` e `fresh`.

Keycloak, projeção durante o fluxo Central, email e OIDC são simulados. A função tenant041 é provada separadamente em PostgreSQL real. Não se envia email nem se elimina qualquer identidade externa real.
