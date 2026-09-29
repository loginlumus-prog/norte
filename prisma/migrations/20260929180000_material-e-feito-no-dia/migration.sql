-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "feito_no_dia" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "uso_interno" BOOLEAN NOT NULL DEFAULT false;
