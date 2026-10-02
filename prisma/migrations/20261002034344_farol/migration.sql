-- CreateEnum
CREATE TYPE "TipoPecaFarol" AS ENUM ('DIAGNOSTICO', 'CALENDARIO', 'ROTEIRO', 'CARROSSEL', 'LEGENDA', 'COMENTARIOS', 'WHATSAPP', 'ANUNCIO');

-- CreateEnum
CREATE TYPE "SituacaoPecaFarol" AS ENUM ('RASCUNHO', 'APROVADA', 'PUBLICADA', 'ARQUIVADA');

-- CreateTable
CREATE TABLE "marcas_farol" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nicho" TEXT,
    "cidade" TEXT,
    "instagram" TEXT,
    "tiktok" TEXT,
    "publico" TEXT,
    "tom" TEXT,
    "diferenciais" TEXT,
    "objetivos" TEXT,
    "unidade_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "marcas_farol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pecas_farol" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "marca_id" TEXT NOT NULL,
    "tipo" "TipoPecaFarol" NOT NULL,
    "titulo" TEXT NOT NULL,
    "pedido" TEXT,
    "conteudo" TEXT NOT NULL,
    "situacao" "SituacaoPecaFarol" NOT NULL DEFAULT 'RASCUNHO',
    "para" DATE,
    "custo_cent" INTEGER NOT NULL DEFAULT 0,
    "quem" TEXT NOT NULL,
    "usuario_id" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "pecas_farol_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marcas_farol_org_id_idx" ON "marcas_farol"("org_id");

-- CreateIndex
CREATE INDEX "pecas_farol_org_id_marca_id_criada_em_idx" ON "pecas_farol"("org_id", "marca_id", "criada_em");

-- AddForeignKey
ALTER TABLE "marcas_farol" ADD CONSTRAINT "marcas_farol_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pecas_farol" ADD CONSTRAINT "pecas_farol_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pecas_farol" ADD CONSTRAINT "pecas_farol_marca_id_fkey" FOREIGN KEY ("marca_id") REFERENCES "marcas_farol"("id") ON DELETE CASCADE ON UPDATE CASCADE;
