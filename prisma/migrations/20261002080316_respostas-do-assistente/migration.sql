-- As respostas do assistente: a unidade que o plano vende (1.000 por mês).
-- Ver "o assistente, em respostas" em src/servidor/planos.ts. As mensagens
-- antigas ficam false: o mês de outubro começa a contar da migração.
ALTER TABLE "mensagens_agente" ADD COLUMN "resposta_ia" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "mensagens_agente_org_id_resposta_ia_criada_em_idx" ON "mensagens_agente"("org_id", "resposta_ia", "criada_em");
