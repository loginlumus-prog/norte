-- Preço do produto numa loja (praça diferente, preço diferente)
CREATE TABLE "precos_na_loja" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "preco_vista" DECIMAL(12,2) NOT NULL,
    "preco_cartao" DECIMAL(12,2),
    "preco_crediario" DECIMAL(12,2),
    "quem" TEXT NOT NULL,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "precos_na_loja_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "precos_na_loja_org_id_idx" ON "precos_na_loja"("org_id");
CREATE UNIQUE INDEX "precos_na_loja_produto_id_unidade_id_key" ON "precos_na_loja"("produto_id", "unidade_id");
ALTER TABLE "precos_na_loja" ADD CONSTRAINT "precos_na_loja_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "precos_na_loja" ADD CONSTRAINT "precos_na_loja_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "precos_na_loja" ADD CONSTRAINT "precos_na_loja_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O item que monta na hora: o que ele baixa do estoque
CREATE TABLE "composicoes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "componente_id" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "composicoes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "composicoes_org_id_idx" ON "composicoes"("org_id");
CREATE INDEX "composicoes_componente_id_idx" ON "composicoes"("componente_id");
CREATE UNIQUE INDEX "composicoes_variacao_id_componente_id_key" ON "composicoes"("variacao_id", "componente_id");
ALTER TABLE "composicoes" ADD CONSTRAINT "composicoes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "composicoes" ADD CONSTRAINT "composicoes_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "composicoes" ADD CONSTRAINT "composicoes_componente_id_fkey" FOREIGN KEY ("componente_id") REFERENCES "variacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
