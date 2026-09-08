-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Regime" AS ENUM ('MEI', 'SIMPLES', 'PRESUMIDO', 'REAL');

-- CreateEnum
CREATE TYPE "Plano" AS ENUM ('BALCAO', 'BALCAO_AGENTE', 'REDE', 'CORPORATIVO');

-- CreateEnum
CREATE TYPE "Situacao" AS ENUM ('TESTE', 'ATIVA', 'INADIMPLENTE', 'SUSPENSA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('DONO', 'GERENTE', 'BALCAO', 'FINANCEIRO', 'CONTADOR', 'SUPORTE');

-- CreateEnum
CREATE TYPE "Autor" AS ENUM ('PESSOA', 'AGENTE', 'SISTEMA');

-- CreateEnum
CREATE TYPE "Medida" AS ENUM ('UN', 'KG', 'G', 'L', 'ML', 'M', 'PAR', 'CX');

-- CreateEnum
CREATE TYPE "TipoMovimento" AS ENUM ('ENTRADA', 'VENDA', 'DEVOLUCAO', 'AJUSTE', 'PERDA', 'TRANSFERENCIA', 'BALANCO');

-- CreateEnum
CREATE TYPE "SituacaoVenda" AS ENUM ('ABERTA', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TipoCaixa" AS ENUM ('SANGRIA', 'SUPRIMENTO');

-- CreateEnum
CREATE TYPE "FormaPagamento" AS ENUM ('DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'CREDIARIO', 'VALE', 'TRANSFERENCIA');

-- CreateEnum
CREATE TYPE "TipoLancamento" AS ENUM ('RECEITA', 'DESPESA');

-- CreateEnum
CREATE TYPE "TipoConta" AS ENUM ('CAIXA', 'BANCO', 'MAQUININHA', 'OUTRA');

-- CreateEnum
CREATE TYPE "GrupoDRE" AS ENUM ('RECEITA_OUTRA', 'IMPOSTO', 'MERCADORIA', 'PESSOAL', 'OCUPACAO', 'COMERCIAL', 'ADMINISTRATIVA', 'FINANCEIRA', 'OUTRA');

-- CreateEnum
CREATE TYPE "CanalAgente" AS ENUM ('NENHUM', 'ZAPI', 'META');

-- CreateEnum
CREATE TYPE "TipoGatilho" AS ENUM ('RELATORIO', 'RUPTURA', 'ESTOQUE_PARADO', 'CLIENTE_SUMIDO', 'COBRANCA', 'CONTA_A_VENCER', 'CAIXA_DIVERGENTE');

-- CreateEnum
CREATE TYPE "SituacaoProposta" AS ENUM ('AGUARDANDO', 'CONFIRMADA', 'RECUSADA', 'EXPIRADA', 'FALHOU');

-- CreateEnum
CREATE TYPE "TipoRecibo" AS ENUM ('COBRANCA_RECUPERADA', 'CLIENTE_VOLTOU', 'ESTOQUE_DESTRAVADO', 'RUPTURA_EVITADA', 'DIVERGENCIA_ACHADA');

-- CreateEnum
CREATE TYPE "TipoPontos" AS ENUM ('GANHOU', 'USOU', 'AJUSTE');

-- CreateEnum
CREATE TYPE "TipoRecarga" AS ENUM ('COMPRA', 'PLANO', 'AJUSTE', 'ESTORNO');

-- CreateTable
CREATE TABLE "orgs" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "documento" TEXT,
    "ramo" TEXT,
    "razao_social" TEXT,
    "inscricao_estadual" TEXT,
    "regime" "Regime",
    "email" TEXT,
    "telefone" TEXT,
    "whatsapp" TEXT,
    "agente_nome" TEXT,
    "configurada_em" TIMESTAMP(3),
    "plano" "Plano" NOT NULL DEFAULT 'BALCAO',
    "situacao" "Situacao" NOT NULL DEFAULT 'TESTE',
    "modulos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "teste_ate" TIMESTAMP(3),
    "suspensa_em" TIMESTAMP(3),
    "logo_url" TEXT,
    "cor_marca" TEXT,
    "desconto_maximo" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "pontos_ativo" BOOLEAN NOT NULL DEFAULT false,
    "pontos_por_real" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "ponto_vale" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "pontos_minimo" INTEGER NOT NULL DEFAULT 0,
    "credito_ia_cent" INTEGER NOT NULL DEFAULT 0,
    "credito_aviso_cent" INTEGER NOT NULL DEFAULT 1000,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    "apelido" TEXT,
    "endereco" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "cep" TEXT,
    "telefone" TEXT,
    "horario" TEXT,
    "eh_deposito" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "proxima_venda" INTEGER NOT NULL DEFAULT 1,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT,
    "telefone" TEXT,
    "foto_url" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_login" TIMESTAMP(3),
    "sessoes_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acessos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "unidade_id" TEXT,
    "papel" "Papel" NOT NULL,
    "expira_em" TIMESTAMP(3),
    "motivo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acessos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convites" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "papel" "Papel" NOT NULL,
    "unidade_id" TEXT,
    "token" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "aceito_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT,
    "usuario_id" TEXT,
    "quem" TEXT NOT NULL,
    "autor" "Autor" NOT NULL DEFAULT 'PESSOA',
    "acao" TEXT NOT NULL,
    "alvo_tipo" TEXT,
    "alvo_id" TEXT,
    "alvo_nome" TEXT,
    "antes" JSONB,
    "depois" JSONB,
    "valor" DECIMAL(14,2),
    "motivo" TEXT,
    "ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobranca" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "provedor" TEXT,
    "assinatura_id" TEXT,
    "valor_mensal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "unidades_extras" INTEGER NOT NULL DEFAULT 0,
    "proxima_cobranca" TIMESTAMP(3),
    "pago_ate" TIMESTAMP(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "pai_id" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eixos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "eh_cor" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "eixos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opcoes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "eixo_id" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "hex" TEXT,

    CONSTRAINT "opcoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "marca" TEXT,
    "categoria_id" TEXT,
    "medida" "Medida" NOT NULL DEFAULT 'UN',
    "preco_vista" DECIMAL(12,2),
    "preco_cartao" DECIMAL(12,2),
    "preco_crediario" DECIMAL(12,2),
    "custo" DECIMAL(12,2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto_eixos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "eixo_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "produto_eixos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variacoes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "codigo" TEXT,
    "codigo_barras" TEXT,
    "ajuste_preco" DECIMAL(12,2),
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variacao_opcoes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "opcao_id" TEXT NOT NULL,

    CONSTRAINT "variacao_opcoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estoque" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "minimo" DECIMAL(14,3),
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentos_estoque" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "tipo" "TipoMovimento" NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "saldo_depois" DECIMAL(14,3) NOT NULL,
    "motivo" TEXT,
    "referencia" TEXT,
    "usuario_id" TEXT,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "nascimento" DATE,
    "endereco" TEXT,
    "numero" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "cep" TEXT,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "pontos" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caixas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "aberto" BOOLEAN NOT NULL DEFAULT true,
    "aberto_por_id" TEXT,
    "aberto_por" TEXT NOT NULL,
    "aberto_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saldo_abertura" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "fechado_por" TEXT,
    "fechado_em" TIMESTAMP(3),
    "saldo_esperado" DECIMAL(12,2),
    "saldo_contado" DECIMAL(12,2),
    "observacoes" TEXT,

    CONSTRAINT "caixas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caixa_movimentos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "caixa_id" TEXT NOT NULL,
    "tipo" "TipoCaixa" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caixa_movimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "caixa_id" TEXT,
    "numero" INTEGER NOT NULL,
    "cliente_id" TEXT,
    "vendedor_id" TEXT,
    "vendedor_nome" TEXT,
    "situacao" "SituacaoVenda" NOT NULL DEFAULT 'ABERTA',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "desconto_pontos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pontos_usados" INTEGER NOT NULL DEFAULT 0,
    "pontos_ganhos" INTEGER NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "observacoes" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluida_em" TIMESTAMP(3),
    "cancelada_em" TIMESTAMP(3),
    "motivo_cancelamento" TEXT,

    CONSTRAINT "vendas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venda_itens" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "venda_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "codigo" TEXT,
    "medida" "Medida" NOT NULL DEFAULT 'UN',
    "quantidade" DECIMAL(14,3) NOT NULL,
    "preco_unit" DECIMAL(12,2) NOT NULL,
    "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "custo_unit" DECIMAL(12,2),

    CONSTRAINT "venda_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "venda_id" TEXT NOT NULL,
    "forma" "FormaPagamento" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "parcelas" INTEGER NOT NULL DEFAULT 1,
    "referencia" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias_financeiras" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoLancamento" NOT NULL,
    "grupo" "GrupoDRE" NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categorias_financeiras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_financeiras" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" "TipoConta" NOT NULL,
    "saldo_inicial" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "contas_financeiras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lancamentos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT,
    "categoria_id" TEXT NOT NULL,
    "conta_id" TEXT,
    "tipo" "TipoLancamento" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "pago_em" DATE,
    "fornecedor" TEXT,
    "observacoes" TEXT,
    "documento" TEXT,
    "recorrente_id" TEXT,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lancamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recorrentes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "categoria_id" TEXT NOT NULL,
    "unidade_id" TEXT,
    "tipo" "TipoLancamento" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "dia_vencimento" INTEGER NOT NULL,
    "fornecedor" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ate_em" DATE,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recorrentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tentativas_login" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "sucesso" BOOLEAN NOT NULL DEFAULT false,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tentativas_login_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agentes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "personalidade" TEXT,
    "saudacao" TEXT,
    "manual" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "canal" "CanalAgente" NOT NULL DEFAULT 'NENHUM',
    "numero" TEXT,
    "modelo" TEXT NOT NULL DEFAULT 'claude-sonnet-5',
    "poderes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "desconto_max_pct" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "valor_max_cent" INTEGER NOT NULL DEFAULT 50000,
    "gasto_dia_cent" INTEGER NOT NULL DEFAULT 1000,
    "mensagens_dia" INTEGER NOT NULL DEFAULT 300,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agentes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gatilhos_agente" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "tipo" "TipoGatilho" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "horario" TEXT,
    "dias" INTEGER,
    "ultimo_disparo" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gatilhos_agente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "propostas_agente" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "poder" TEXT NOT NULL,
    "resumo" TEXT NOT NULL,
    "dados" JSONB NOT NULL,
    "valor" DECIMAL(14,2),
    "situacao" "SituacaoProposta" NOT NULL DEFAULT 'AGUARDANDO',
    "expira_em" TIMESTAMP(3) NOT NULL,
    "respondida_em" TIMESTAMP(3),
    "quem_respondeu" TEXT,
    "erro" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "propostas_agente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recibos_agente" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "tipo" "TipoRecibo" NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "descricao" TEXT NOT NULL,
    "alvo_tipo" TEXT,
    "alvo_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recibos_agente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumo_ia" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "modelo" TEXT NOT NULL,
    "entrada_tokens" INTEGER NOT NULL DEFAULT 0,
    "saida_tokens" INTEGER NOT NULL DEFAULT 0,
    "custo_cent" INTEGER NOT NULL DEFAULT 0,
    "cobrado_cent" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumo_ia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversas_agente" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "agente_id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "nome" TEXT,
    "cliente_id" TEXT,
    "da_equipe" BOOLEAN NOT NULL DEFAULT false,
    "humano_ate" TIMESTAMP(3),
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultima_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversas_agente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens_agente" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "conversa_id" TEXT NOT NULL,
    "de" "Autor" NOT NULL,
    "texto" TEXT NOT NULL,
    "midia" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_agente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentos_pontos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "tipo" "TipoPontos" NOT NULL,
    "pontos" INTEGER NOT NULL,
    "saldo_depois" INTEGER NOT NULL,
    "venda_id" TEXT,
    "motivo" TEXT,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_pontos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recargas_ia" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "centavos" INTEGER NOT NULL,
    "saldo_depois" INTEGER NOT NULL,
    "tipo" "TipoRecarga" NOT NULL,
    "origem" TEXT NOT NULL DEFAULT 'manual',
    "referencia" TEXT,
    "motivo" TEXT,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recargas_ia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orgs_slug_key" ON "orgs"("slug");

-- CreateIndex
CREATE INDEX "unidades_org_id_idx" ON "unidades"("org_id");

-- CreateIndex
CREATE INDEX "usuarios_org_id_idx" ON "usuarios"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_org_id_email_key" ON "usuarios"("org_id", "email");

-- CreateIndex
CREATE INDEX "acessos_org_id_idx" ON "acessos"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "acessos_usuario_id_unidade_id_papel_key" ON "acessos"("usuario_id", "unidade_id", "papel");

-- CreateIndex
CREATE UNIQUE INDEX "convites_token_key" ON "convites"("token");

-- CreateIndex
CREATE INDEX "convites_org_id_idx" ON "convites"("org_id");

-- CreateIndex
CREATE INDEX "auditoria_org_id_criado_em_idx" ON "auditoria"("org_id", "criado_em");

-- CreateIndex
CREATE INDEX "auditoria_org_id_alvo_tipo_alvo_id_idx" ON "auditoria"("org_id", "alvo_tipo", "alvo_id");

-- CreateIndex
CREATE UNIQUE INDEX "cobranca_org_id_key" ON "cobranca"("org_id");

-- CreateIndex
CREATE INDEX "categorias_org_id_idx" ON "categorias"("org_id");

-- CreateIndex
CREATE INDEX "eixos_org_id_idx" ON "eixos"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "eixos_org_id_nome_key" ON "eixos"("org_id", "nome");

-- CreateIndex
CREATE INDEX "opcoes_org_id_idx" ON "opcoes"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "opcoes_eixo_id_valor_key" ON "opcoes"("eixo_id", "valor");

-- CreateIndex
CREATE INDEX "produtos_org_id_ativo_idx" ON "produtos"("org_id", "ativo");

-- CreateIndex
CREATE INDEX "produtos_org_id_categoria_id_idx" ON "produtos"("org_id", "categoria_id");

-- CreateIndex
CREATE INDEX "produto_eixos_org_id_idx" ON "produto_eixos"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "produto_eixos_produto_id_eixo_id_key" ON "produto_eixos"("produto_id", "eixo_id");

-- CreateIndex
CREATE INDEX "variacoes_org_id_produto_id_idx" ON "variacoes"("org_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "variacoes_org_id_codigo_key" ON "variacoes"("org_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "variacoes_org_id_codigo_barras_key" ON "variacoes"("org_id", "codigo_barras");

-- CreateIndex
CREATE INDEX "variacao_opcoes_org_id_idx" ON "variacao_opcoes"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "variacao_opcoes_variacao_id_opcao_id_key" ON "variacao_opcoes"("variacao_id", "opcao_id");

-- CreateIndex
CREATE INDEX "estoque_org_id_unidade_id_idx" ON "estoque"("org_id", "unidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "estoque_variacao_id_unidade_id_key" ON "estoque"("variacao_id", "unidade_id");

-- CreateIndex
CREATE INDEX "movimentos_estoque_org_id_variacao_id_criado_em_idx" ON "movimentos_estoque"("org_id", "variacao_id", "criado_em");

-- CreateIndex
CREATE INDEX "movimentos_estoque_org_id_unidade_id_criado_em_idx" ON "movimentos_estoque"("org_id", "unidade_id", "criado_em");

-- CreateIndex
CREATE INDEX "clientes_org_id_nome_idx" ON "clientes"("org_id", "nome");

-- CreateIndex
CREATE INDEX "clientes_org_id_documento_idx" ON "clientes"("org_id", "documento");

-- CreateIndex
CREATE INDEX "caixas_org_id_unidade_id_aberto_idx" ON "caixas"("org_id", "unidade_id", "aberto");

-- CreateIndex
CREATE INDEX "caixa_movimentos_org_id_caixa_id_idx" ON "caixa_movimentos"("org_id", "caixa_id");

-- CreateIndex
CREATE INDEX "vendas_org_id_unidade_id_criada_em_idx" ON "vendas"("org_id", "unidade_id", "criada_em");

-- CreateIndex
CREATE INDEX "vendas_org_id_situacao_idx" ON "vendas"("org_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "vendas_unidade_id_numero_key" ON "vendas"("unidade_id", "numero");

-- CreateIndex
CREATE INDEX "venda_itens_org_id_venda_id_idx" ON "venda_itens"("org_id", "venda_id");

-- CreateIndex
CREATE INDEX "venda_itens_org_id_variacao_id_idx" ON "venda_itens"("org_id", "variacao_id");

-- CreateIndex
CREATE INDEX "pagamentos_org_id_venda_id_idx" ON "pagamentos"("org_id", "venda_id");

-- CreateIndex
CREATE INDEX "categorias_financeiras_org_id_tipo_idx" ON "categorias_financeiras"("org_id", "tipo");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_financeiras_org_id_nome_key" ON "categorias_financeiras"("org_id", "nome");

-- CreateIndex
CREATE INDEX "contas_financeiras_org_id_idx" ON "contas_financeiras"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "contas_financeiras_org_id_nome_key" ON "contas_financeiras"("org_id", "nome");

-- CreateIndex
CREATE INDEX "lancamentos_org_id_vencimento_idx" ON "lancamentos"("org_id", "vencimento");

-- CreateIndex
CREATE INDEX "lancamentos_org_id_pago_em_idx" ON "lancamentos"("org_id", "pago_em");

-- CreateIndex
CREATE INDEX "lancamentos_org_id_categoria_id_idx" ON "lancamentos"("org_id", "categoria_id");

-- CreateIndex
CREATE INDEX "recorrentes_org_id_ativo_idx" ON "recorrentes"("org_id", "ativo");

-- CreateIndex
CREATE INDEX "tentativas_login_org_id_email_criada_em_idx" ON "tentativas_login"("org_id", "email", "criada_em");

-- CreateIndex
CREATE INDEX "tentativas_login_org_id_ip_criada_em_idx" ON "tentativas_login"("org_id", "ip", "criada_em");

-- CreateIndex
CREATE UNIQUE INDEX "agentes_org_id_key" ON "agentes"("org_id");

-- CreateIndex
CREATE INDEX "gatilhos_agente_org_id_idx" ON "gatilhos_agente"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "gatilhos_agente_agente_id_tipo_key" ON "gatilhos_agente"("agente_id", "tipo");

-- CreateIndex
CREATE INDEX "propostas_agente_org_id_situacao_expira_em_idx" ON "propostas_agente"("org_id", "situacao", "expira_em");

-- CreateIndex
CREATE INDEX "recibos_agente_org_id_criado_em_idx" ON "recibos_agente"("org_id", "criado_em");

-- CreateIndex
CREATE INDEX "consumo_ia_org_id_criado_em_idx" ON "consumo_ia"("org_id", "criado_em");

-- CreateIndex
CREATE INDEX "conversas_agente_org_id_ultima_em_idx" ON "conversas_agente"("org_id", "ultima_em");

-- CreateIndex
CREATE UNIQUE INDEX "conversas_agente_agente_id_telefone_key" ON "conversas_agente"("agente_id", "telefone");

-- CreateIndex
CREATE INDEX "mensagens_agente_org_id_conversa_id_criada_em_idx" ON "mensagens_agente"("org_id", "conversa_id", "criada_em");

-- CreateIndex
CREATE INDEX "movimentos_pontos_org_id_cliente_id_criado_em_idx" ON "movimentos_pontos"("org_id", "cliente_id", "criado_em");

-- CreateIndex
CREATE INDEX "recargas_ia_org_id_criado_em_idx" ON "recargas_ia"("org_id", "criado_em");

-- AddForeignKey
ALTER TABLE "unidades" ADD CONSTRAINT "unidades_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos" ADD CONSTRAINT "acessos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos" ADD CONSTRAINT "acessos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos" ADD CONSTRAINT "acessos_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites" ADD CONSTRAINT "convites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobranca" ADD CONSTRAINT "cobranca_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eixos" ADD CONSTRAINT "eixos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opcoes" ADD CONSTRAINT "opcoes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opcoes" ADD CONSTRAINT "opcoes_eixo_id_fkey" FOREIGN KEY ("eixo_id") REFERENCES "eixos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_eixos" ADD CONSTRAINT "produto_eixos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_eixos" ADD CONSTRAINT "produto_eixos_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_eixos" ADD CONSTRAINT "produto_eixos_eixo_id_fkey" FOREIGN KEY ("eixo_id") REFERENCES "eixos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacoes" ADD CONSTRAINT "variacoes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacoes" ADD CONSTRAINT "variacoes_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacao_opcoes" ADD CONSTRAINT "variacao_opcoes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacao_opcoes" ADD CONSTRAINT "variacao_opcoes_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacao_opcoes" ADD CONSTRAINT "variacao_opcoes_opcao_id_fkey" FOREIGN KEY ("opcao_id") REFERENCES "opcoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoque" ADD CONSTRAINT "estoque_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoque" ADD CONSTRAINT "estoque_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoque" ADD CONSTRAINT "estoque_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixa_movimentos" ADD CONSTRAINT "caixa_movimentos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixa_movimentos" ADD CONSTRAINT "caixa_movimentos_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendas" ADD CONSTRAINT "vendas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias_financeiras" ADD CONSTRAINT "categorias_financeiras_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_financeiras" ADD CONSTRAINT "contas_financeiras_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_financeiras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "contas_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_recorrente_id_fkey" FOREIGN KEY ("recorrente_id") REFERENCES "recorrentes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorrentes" ADD CONSTRAINT "recorrentes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorrentes" ADD CONSTRAINT "recorrentes_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_financeiras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tentativas_login" ADD CONSTRAINT "tentativas_login_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agentes" ADD CONSTRAINT "agentes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gatilhos_agente" ADD CONSTRAINT "gatilhos_agente_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gatilhos_agente" ADD CONSTRAINT "gatilhos_agente_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agentes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propostas_agente" ADD CONSTRAINT "propostas_agente_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "propostas_agente" ADD CONSTRAINT "propostas_agente_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agentes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recibos_agente" ADD CONSTRAINT "recibos_agente_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recibos_agente" ADD CONSTRAINT "recibos_agente_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agentes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumo_ia" ADD CONSTRAINT "consumo_ia_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumo_ia" ADD CONSTRAINT "consumo_ia_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agentes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversas_agente" ADD CONSTRAINT "conversas_agente_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversas_agente" ADD CONSTRAINT "conversas_agente_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agentes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversas_agente" ADD CONSTRAINT "conversas_agente_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_agente" ADD CONSTRAINT "mensagens_agente_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_agente" ADD CONSTRAINT "mensagens_agente_conversa_id_fkey" FOREIGN KEY ("conversa_id") REFERENCES "conversas_agente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_pontos" ADD CONSTRAINT "movimentos_pontos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_pontos" ADD CONSTRAINT "movimentos_pontos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargas_ia" ADD CONSTRAINT "recargas_ia_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

