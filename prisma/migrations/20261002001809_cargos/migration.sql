-- AlterEnum
ALTER TYPE "Papel" ADD VALUE 'CARGO';

-- AlterTable
ALTER TABLE "acessos" ADD COLUMN     "cargo_id" TEXT;

-- AlterTable
ALTER TABLE "convites" ADD COLUMN     "cargo_id" TEXT;

-- CreateTable
CREATE TABLE "cargos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "capacidades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "cargos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cargos_org_id_idx" ON "cargos"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "cargos_org_id_nome_key" ON "cargos"("org_id", "nome");

-- AddForeignKey
ALTER TABLE "acessos" ADD CONSTRAINT "acessos_cargo_id_fkey" FOREIGN KEY ("cargo_id") REFERENCES "cargos"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites" ADD CONSTRAINT "convites_cargo_id_fkey" FOREIGN KEY ("cargo_id") REFERENCES "cargos"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
