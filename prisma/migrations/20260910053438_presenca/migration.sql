-- CreateTable
CREATE TABLE "presencas" (
    "org_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_sinal" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presencas_pkey" PRIMARY KEY ("org_id","usuario_id")
);

-- CreateIndex
CREATE INDEX "presencas_org_id_ultimo_sinal_idx" ON "presencas"("org_id", "ultimo_sinal");

-- AddForeignKey
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presencas" ADD CONSTRAINT "presencas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
