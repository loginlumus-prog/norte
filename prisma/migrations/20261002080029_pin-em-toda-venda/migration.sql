-- Toda venda do balcão se confirma com o PIN de quem vendeu (ver autorizacao.ts).
-- Nasce ligado, inclusive para as empresas que já existem.
ALTER TABLE "orgs" ADD COLUMN "pin_em_toda_venda" BOOLEAN NOT NULL DEFAULT true;
