-- CreateTable
CREATE TABLE "taxas_pagamento" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "parcelas" INTEGER NOT NULL DEFAULT 1,
    "percentual" DECIMAL(5,2) NOT NULL,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "taxas_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "taxas_pagamento_org_id_forma_parcelas_key" ON "taxas_pagamento"("org_id", "forma", "parcelas");

-- AddForeignKey
ALTER TABLE "taxas_pagamento" ADD CONSTRAINT "taxas_pagamento_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
