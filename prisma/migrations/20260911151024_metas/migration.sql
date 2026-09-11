-- CreateTable
CREATE TABLE "metas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "mes" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "comissao_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "quem" TEXT NOT NULL,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "metas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "metas_org_id_usuario_id_mes_key" ON "metas"("org_id", "usuario_id", "mes");

-- AddForeignKey
ALTER TABLE "metas" ADD CONSTRAINT "metas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metas" ADD CONSTRAINT "metas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
