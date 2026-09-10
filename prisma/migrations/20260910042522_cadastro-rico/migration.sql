-- CreateEnum
CREATE TYPE "Porte" AS ENUM ('SO_EU', 'ATE_5', 'ATE_20', 'MAIS_DE_20');

-- CreateEnum
CREATE TYPE "Dor" AS ENUM ('ESTOQUE', 'LUCRO', 'COBRANCA', 'ATENDIMENTO');

-- CreateEnum
CREATE TYPE "Catalogo" AS ENUM ('ATE_50', 'ATE_500', 'ATE_5000', 'MAIS_DE_5000');

-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "catalogo" "Catalogo",
ADD COLUMN     "como_vende" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "dor" "Dor",
ADD COLUMN     "porte" "Porte";
