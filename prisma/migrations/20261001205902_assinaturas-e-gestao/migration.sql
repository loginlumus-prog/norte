-- AlterTable
ALTER TABLE "auditoria" ADD COLUMN     "assinado" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "cobranca_pausada_em" TIMESTAMP(3),
ADD COLUMN     "cobranca_pausada_motivo" TEXT,
ADD COLUMN     "cobranca_pausada_por" TEXT,
ADD COLUMN     "juntada_em" TIMESTAMP(3),
ADD COLUMN     "juntada_na_id" TEXT;

-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "balcao_ampliado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pin_nas_excecoes" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "vendas" ADD COLUMN     "data_corrigida_em" TIMESTAMP(3),
ADD COLUMN     "data_corrigida_motivo" TEXT,
ADD COLUMN     "data_corrigida_por" TEXT,
ADD COLUMN     "data_original" TIMESTAMP(3);
