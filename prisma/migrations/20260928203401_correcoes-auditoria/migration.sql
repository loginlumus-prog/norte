-- DropForeignKey
ALTER TABLE "recebimentos" DROP CONSTRAINT "recebimentos_parcela_id_fkey";

-- AlterTable
ALTER TABLE "caixa_movimentos" ADD COLUMN     "encomenda_id" TEXT;

-- AlterTable
ALTER TABLE "encomendas" ADD COLUMN     "sinal_forma" "FormaPagamento";

-- AlterTable
ALTER TABLE "movimentos_estoque" ADD COLUMN     "transferencia_id" TEXT;

-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN     "taxa_pct" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "parcelas" ADD COLUMN     "juros_ate" DATE;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "telefone_confirmado" TEXT,
ADD COLUMN     "telefone_confirmado_em" TIMESTAMP(3),
ADD COLUMN     "telefone_visto_em" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vendas" ADD COLUMN     "encomenda_id" TEXT;

-- CreateTable
CREATE TABLE "confirmacoes_telefone" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "enviado" BOOLEAN NOT NULL DEFAULT false,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "usado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "confirmacoes_telefone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "confirmacoes_telefone_org_id_usuario_id_criado_em_idx" ON "confirmacoes_telefone"("org_id", "usuario_id", "criado_em");

-- CreateIndex
CREATE INDEX "confirmacoes_telefone_org_id_chave_idx" ON "confirmacoes_telefone"("org_id", "chave");

-- CreateIndex
CREATE INDEX "caixa_movimentos_org_id_encomenda_id_idx" ON "caixa_movimentos"("org_id", "encomenda_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendas_encomenda_id_key" ON "vendas"("encomenda_id");

-- AddForeignKey
ALTER TABLE "confirmacoes_telefone" ADD CONSTRAINT "confirmacoes_telefone_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmacoes_telefone" ADD CONSTRAINT "confirmacoes_telefone_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixa_movimentos" ADD CONSTRAINT "caixa_movimentos_encomenda_id_fkey" FOREIGN KEY ("encomenda_id") REFERENCES "encomendas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_encomenda_id_fkey" FOREIGN KEY ("encomenda_id") REFERENCES "encomendas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimentos" ADD CONSTRAINT "recebimentos_parcela_id_fkey" FOREIGN KEY ("parcela_id") REFERENCES "parcelas"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Backfill: as transferências de antes desta coluna. As duas pernas ganham o
-- mesmo id (o da saída). A ENTRADA do destino é achada pela saída gêmea — mesma
-- empresa e variação, quantidade oposta, outra loja, gravada no mesmo instante
-- — e não só pelo texto do motivo.
UPDATE "movimentos_estoque" SET "transferencia_id" = "id"
 WHERE "tipo" = 'TRANSFERENCIA' AND "transferencia_id" IS NULL;

UPDATE "movimentos_estoque" m SET "transferencia_id" = par.saida
  FROM (
    SELECT DISTINCT ON (en.id) en.id AS entrada, sa.id AS saida
      FROM "movimentos_estoque" en
      JOIN "movimentos_estoque" sa
        ON sa.org_id = en.org_id AND sa.variacao_id = en.variacao_id
       AND sa.tipo = 'TRANSFERENCIA' AND sa.quantidade = -en.quantidade
       AND sa.unidade_id <> en.unidade_id
       AND abs(extract(epoch from (en.criado_em - sa.criado_em))) < 5
     WHERE en.tipo = 'ENTRADA' AND en.transferencia_id IS NULL
       AND en.motivo LIKE 'Transferência de %'
     ORDER BY en.id, abs(extract(epoch from (en.criado_em - sa.criado_em)))
  ) par
 WHERE m.id = par.entrada;

-- Backfill: a venda que recebeu uma encomenda antes desta coluna. Só quando os
-- DOIS lados do texto antigo concordam (o código ENC-… na venda e o número da
-- venda na encomenda) e há um par só.
UPDATE "vendas" v SET "encomenda_id" = par.encomenda
  FROM (
    SELECT v2.id AS venda, min(e.id) AS encomenda, count(*) AS n
      FROM "vendas" v2
      JOIN "encomendas" e
        ON e.org_id = v2.org_id AND e.unidade_id = v2.unidade_id
       AND v2.observacoes LIKE 'Encomenda ENC-' || upper(right(e.id, 6)) || '%'
       AND e.observacao LIKE '%Recebida no balcão: venda ' || v2.numero || '.%'
     WHERE v2.encomenda_id IS NULL
     GROUP BY v2.id
  ) par
 WHERE v.id = par.venda AND par.n = 1
   AND NOT EXISTS (SELECT 1 FROM "vendas" o WHERE o.encomenda_id = par.encomenda);
