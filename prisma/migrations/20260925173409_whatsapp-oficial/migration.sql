-- O WhatsApp oficial (Meta, Cloud API): os ids da conta e do número, o token
-- de negócio CIFRADO (src/servidor/cifra.ts) e o número mascarado para a tela.
--
-- O diff contra produção trouxe também um `DROP INDEX "campanha_execucoes_uma_viva"`
-- (seguido do CREATE igual, que já mora na migração das campanhas): é o Prisma
-- comparando o texto do predicado do índice parcial como o Postgres o guarda
-- ("status = ANY (ARRAY[...])") com o do schema. O índice é o mesmo, e é ele
-- que garante "uma campanha viva por telefone" — o DROP saiu daqui à mão.

-- AlterTable
ALTER TABLE "agentes" ADD COLUMN     "meta_conectado_em" TIMESTAMP(3),
ADD COLUMN     "meta_numero_exibicao" TEXT,
ADD COLUMN     "meta_phone_number_id" TEXT,
ADD COLUMN     "meta_token_cifrado" TEXT,
ADD COLUMN     "meta_waba_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "agentes_meta_phone_number_id_key" ON "agentes"("meta_phone_number_id");
