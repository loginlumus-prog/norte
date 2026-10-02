-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "farol_marcas" INTEGER NOT NULL DEFAULT 1;

-- Quem já usa o Farol fica com as marcas que tem ativas hoje (no mínimo uma):
-- nada para de funcionar no dia da migração. A equipe acerta pelo contrato.
UPDATE "orgs" o
   SET "farol_marcas" = GREATEST(1, (SELECT count(*) FROM "marcas_farol" m WHERE m."org_id" = o."id" AND m."ativa"))
 WHERE 'farol' = ANY(o."modulos");
