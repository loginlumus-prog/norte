-- CreateTable
CREATE TABLE "campanhas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "pasta" TEXT,
    "gatilho" JSONB NOT NULL,
    "grafo" JSONB NOT NULL,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "campanhas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanha_execucoes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "campanha_id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "envio" TEXT NOT NULL,
    "nome" TEXT,
    "node_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'rodando',
    "proximo_em" TIMESTAMP(3),
    "vars" JSONB NOT NULL DEFAULT '{}',
    "teste" BOOLEAN NOT NULL DEFAULT false,
    "trava" TEXT,
    "trava_em" TIMESTAMP(3),
    "ultima_entrada_em" TIMESTAMP(3),
    "ultimo_envio_em" TIMESTAMP(3),
    "iniciada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizada_em" TIMESTAMP(3),
    "motivo_fim" TEXT,

CONSTRAINT "campanha_execucoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanha_passos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "execucao_id" TEXT NOT NULL,
    "campanha_id" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "saida" TEXT,
    "enviadas" INTEGER NOT NULL DEFAULT 0,
    "internas" INTEGER NOT NULL DEFAULT 0,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "campanha_passos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campanha_ajustes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "por_contato_dia" INTEGER NOT NULL DEFAULT 15,
    "por_empresa_dia" INTEGER NOT NULL DEFAULT 1000,
    "intervalo_seg" INTEGER NOT NULL DEFAULT 2,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "campanha_ajustes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "midias" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "dados" BYTEA NOT NULL,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "midias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campanhas_org_id_ativa_idx" ON "campanhas"("org_id", "ativa");

-- CreateIndex
CREATE INDEX "campanha_execucoes_org_id_status_proximo_em_idx" ON "campanha_execucoes"("org_id", "status", "proximo_em");

-- CreateIndex
CREATE INDEX "campanha_execucoes_org_id_campanha_id_status_idx" ON "campanha_execucoes"("org_id", "campanha_id", "status");

-- CreateIndex
CREATE INDEX "campanha_execucoes_org_id_telefone_iniciada_em_idx" ON "campanha_execucoes"("org_id", "telefone", "iniciada_em");

-- CreateIndex
CREATE UNIQUE INDEX "campanha_execucoes_uma_viva" ON "campanha_execucoes"("org_id", "telefone") WHERE (status in ('rodando', 'esperando', 'aguardando_resposta'));

-- CreateIndex
CREATE INDEX "campanha_passos_org_id_execucao_id_em_idx" ON "campanha_passos"("org_id", "execucao_id", "em");

-- CreateIndex
CREATE INDEX "campanha_passos_org_id_em_idx" ON "campanha_passos"("org_id", "em");

-- CreateIndex
CREATE UNIQUE INDEX "campanha_ajustes_org_id_key" ON "campanha_ajustes"("org_id");

-- CreateIndex
CREATE INDEX "midias_org_id_criada_em_idx" ON "midias"("org_id", "criada_em");

-- CreateIndex
CREATE UNIQUE INDEX "midias_org_id_sha256_key" ON "midias"("org_id", "sha256");

-- AddForeignKey
ALTER TABLE "campanhas" ADD CONSTRAINT "campanhas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanha_execucoes" ADD CONSTRAINT "campanha_execucoes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanha_execucoes" ADD CONSTRAINT "campanha_execucoes_campanha_id_fkey" FOREIGN KEY ("campanha_id") REFERENCES "campanhas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanha_passos" ADD CONSTRAINT "campanha_passos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanha_passos" ADD CONSTRAINT "campanha_passos_execucao_id_fkey" FOREIGN KEY ("execucao_id") REFERENCES "campanha_execucoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanha_passos" ADD CONSTRAINT "campanha_passos_campanha_id_fkey" FOREIGN KEY ("campanha_id") REFERENCES "campanhas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campanha_ajustes" ADD CONSTRAINT "campanha_ajustes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "midias" ADD CONSTRAINT "midias_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
