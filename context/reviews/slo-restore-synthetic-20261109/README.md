# Restauro sintético cronometrado

Em 09/11/2026, o harness `test/integration/cia-restore-timed/run.ps1` criou um PostgreSQL 18.6 descartável, aplicou migrações e gerou dados sintéticos para Central e duas organizações. Criou três dumps, restaurou para bases novas e verificou dados selecionados, locale, marcadores e RLS. [Resultado](results.json): PASS, 27 verificações; duração técnica de **11,141 s** para os três dumps/restauros e verificações. O contentor e volume próprios foram removidos.

Esta duração inclui criação dos dumps e exclui a criação da fixture, deteção de incidente, preparação de infraestrutura independente, cutover, recuperação de ficheiros, testes funcionais completos e volumes realistas. Não mede RPO nem demonstra RTO operacional. A tabela de auditoria não tinha eventos nesta fixture; a prova anterior de recuperação com eventos e objetos sintéticos é [CIA recovery](../cia-recovery-20261109-r2/README.md). Nenhuma base habitual, backup real ou R2 real foi utilizado.
