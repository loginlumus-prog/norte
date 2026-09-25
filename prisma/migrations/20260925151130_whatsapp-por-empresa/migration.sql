-- AlterTable
ALTER TABLE "agentes" ADD COLUMN     "webhook_token_hash" TEXT,
ADD COLUMN     "zapi_client_token_cifrado" TEXT,
ADD COLUMN     "zapi_instancia" TEXT,
ADD COLUMN     "zapi_token_cifrado" TEXT;
