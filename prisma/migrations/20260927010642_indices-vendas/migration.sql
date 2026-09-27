-- (O Prisma pediu `DROP INDEX "campanha_execucoes_uma_viva"`: ele lê mal o
-- índice parcial e acha que sobrou. Não sobrou — é a garantia de uma campanha
-- viva por telefone. Linha removida, como nas migrações anteriores.)

-- CreateIndex
CREATE INDEX "vendas_org_id_cliente_id_criada_em_idx" ON "vendas"("org_id", "cliente_id", "criada_em");

-- CreateIndex
CREATE INDEX "vendas_org_id_vendedor_id_criada_em_idx" ON "vendas"("org_id", "vendedor_id", "criada_em");
