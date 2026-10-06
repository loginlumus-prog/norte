-- Variação: eixo e opção arquivados (saem da tela, mas ainda nomeiam item com venda)
ALTER TABLE "eixos" ADD COLUMN "arquivado_em" TIMESTAMP(3);
ALTER TABLE "opcoes" ADD COLUMN "arquivado_em" TIMESTAMP(3);

-- Financeiro: mês em que o lançamento da conta fixa foi excluído não volta a nascer
ALTER TABLE "recorrentes" ADD COLUMN "pulados" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Ponto: primeiro dia de trabalho e dias abonados
ALTER TABLE "colaboradores" ADD COLUMN "inicio_em" DATE;

CREATE TABLE "abonos_ponto" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "colaborador_id" TEXT NOT NULL,
    "dia" DATE NOT NULL,
    "motivo" TEXT NOT NULL,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abonos_ponto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "abonos_ponto_org_id_idx" ON "abonos_ponto"("org_id");
CREATE UNIQUE INDEX "abonos_ponto_colaborador_id_dia_key" ON "abonos_ponto"("colaborador_id", "dia");

ALTER TABLE "abonos_ponto" ADD CONSTRAINT "abonos_ponto_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "abonos_ponto" ADD CONSTRAINT "abonos_ponto_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
