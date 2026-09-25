-- AlterEnum
ALTER TYPE "CanalAgente" ADD VALUE 'PROPRIO';

-- CreateTable
CREATE TABLE "sessoes_whatsapp" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "dados_cifrados" TEXT NOT NULL,
    "versao" BIGINT NOT NULL,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "sessoes_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessoes_whatsapp_org_id_key" ON "sessoes_whatsapp"("org_id");

-- AddForeignKey
ALTER TABLE "sessoes_whatsapp" ADD CONSTRAINT "sessoes_whatsapp_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
