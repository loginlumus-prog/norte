-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "vendido_em" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "unidades" ADD COLUMN     "ramo" TEXT;
