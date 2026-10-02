-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "crediario_atraso_dias" INTEGER;

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "limite_credito" DECIMAL(12,2);
