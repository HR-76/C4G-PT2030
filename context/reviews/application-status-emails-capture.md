# Captura central — validação isolada

2026-11-02. GCNI_C4G. Emails desativados.

Implementada captura SQL de organização, autor e memberships centrais, ligada à composição apenas através de opção interna isolada. Histórico e equipa vêm do tenant e o guard é verificado antes/depois. Não recebe destinatários do HTTP.

Prova executada: node scripts/testStatusEmailTransaction.js, PostgreSQL 17 descartável com bases separadas central_fixture e tenant_fixture. Usa repository/capture/producer/OutboxRepository reais; commit, repetição idempotente, rollback após escrita de outbox, autoridade indisponível e suspensão aprovados. Container e bases removidos no finally. Sem bases da APP, migrações reais de deploy ou envios.

Limites: fixture central mínima e guard/audit doubles; permissões de outbox concedidas apenas à fixture. Antes da ativação é necessário admitir a consulta no protocolo central fechado e preparar os grants mínimos de produção. Não contornar essa admissão nem declarar validado o gate de segurança completo.

Testes focados: 37 aprovados. Suite backend: 2631 aprovados, 7 ignorados, zero falhas (2638 total), exit 0. Evidência: application-status-emails-capture-suite.log. Sintaxe dos JS de produção/script validada. Um erro inicial de sintaxe no novo teste foi corrigido antes da execução final.

Próximo passo: pacote de admissão da consulta central e permissões mínimas da outbox, com gate isolado sob os papéis restritos da APP, mantendo envios desligados.
