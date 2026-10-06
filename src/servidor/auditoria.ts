// O livro de auditoria — a parte que LÊ.
//
// Escrever nele todo mundo escreve: venda, caixa, produto, cliente, equipe,
// plano. Cada módulo grava a própria linha na mesma transação da ação, e é
// assim que o livro não mente. O que faltava era o outro lado: uma tela onde
// o dono abre e pergunta "quem deu 40% de desconto na terça?".
//
// ── o que este arquivo NÃO faz ───────────────────────────────
// Não escreve. Não existe `registrar()` aqui de propósito — se existisse, a
// tentação seria chamar de fora da transação da ação, e aí o livro passaria
// a registrar coisas que não aconteceram (a ação falhou, o registro ficou).
// Cada módulo grava dentro do próprio `comoOrg`, junto do que fez.
//
// E o banco não deixa reescrever nem apagar: ver `rls.sql`, política de
// `auditoria`. Ler é tudo que dá para fazer, e é o que esta tela faz.

import { comoOrg } from './banco'
import { exigir, pode, textoDaBusca, type Sessao } from './permissao'

/**
 * O que cada ação quer dizer, em português de gente.
 *
 * A chave é o que o código grava (`venda.registrou`); o valor é o que a tela
 * mostra. Ação que não estiver aqui aparece com a chave crua — não some.
 */
export const ACOES: Record<string, string> = {
  'venda.registrou': 'registrou uma venda',
  'venda.cancelou': 'cancelou uma venda',
  'venda.data_corrigiu': 'corrigiu a data de uma venda',
  'venda.devolveu': 'recebeu uma devolução',
  'caixa.abriu': 'abriu o caixa',
  'caixa.fechou': 'fechou o caixa',
  'caixa.sangria': 'tirou dinheiro do caixa',
  'caixa.suprimento': 'pôs dinheiro no caixa',
  'produto.criou': 'cadastrou um produto',
  'produto.alterou': 'alterou um produto',
  'produto.excluiu': 'excluiu um produto',
  'produto.reativou': 'pôs um produto de volta à venda',
  'produto.preco.alterou': 'mudou um preço',
  'produto.preco.loja': 'mudou o preço de um produto numa loja',
  'produto.composicao': 'mudou o que um item gasta do estoque',
  'produto.grade.alterou': 'mexeu na grade',
  'produto.opcao.criou': 'criou uma opção de variação',
  'produto.eixo.criou': 'criou um eixo de variação',
  'produto.eixo.renomeou': 'renomeou um eixo de variação',
  'produto.eixo.apagou': 'excluiu um eixo de variação',
  'produto.eixo.arquivou': 'tirou um eixo de variação da tela',
  'produto.opcao.renomeou': 'renomeou uma opção de variação',
  'produto.opcao.apagou': 'excluiu uma opção de variação',
  'produto.opcao.arquivou': 'tirou uma opção de variação da tela',
  'estoque.entrada': 'deu entrada de mercadoria',
  'estoque.ajustou': 'ajustou o estoque',
  'estoque.perda': 'lançou uma avaria',
  'estoque.transferiu': 'transferiu estoque entre lojas',
  'cliente.criou': 'cadastrou um cliente',
  'cliente.alterou': 'alterou um cliente',
  'cliente.ofertas.aceitou': 'registrou que o cliente aceita ofertas no WhatsApp',
  'cliente.ofertas.recusou': 'registrou que o cliente não quer ofertas no WhatsApp',
  'cliente.anonimizou': 'anonimizou um cliente (pedido do titular)',
  'ofertas.parou': 'um contato mandou PARAR e saiu das ofertas',
  'ofertas.voltou': 'um contato mandou VOLTAR e voltou às ofertas',
  'ofertas.anotou': 'pôs um número na lista de quem não recebe ofertas',
  'ofertas.tirou': 'tirou um número da lista de quem não recebe ofertas',
  // O acesso do NOSSO suporte (papel SUPORTE, com prazo e motivo): uma linha
  // por tela ou ação, no máximo uma a cada 10 minutos por tela — ver
  // `registrarAcessoDeSuporte` em pagina.ts.
  'suporte.acessou': 'acesso do suporte do Norte',
  // As planilhas baixadas (ver exportacao.ts): a saída dos dados deixa rastro.
  'exportou.clientes': 'baixou a planilha de clientes',
  'exportou.vendas': 'baixou a planilha de vendas',
  'exportou.produtos': 'baixou a planilha de produtos',
  'exportou.estoque': 'baixou a planilha do estoque',
  'exportou.financeiro': 'baixou a planilha do financeiro',
  'exportou.mensalidades': 'baixou a planilha das mensalidades',
  'crediario.recebeu': 'recebeu uma parcela',
  'crediario.baixa_externa': 'deu baixa de crediário pago fora',
  'crediario.quitou': 'deu o crediário por quitado (pago fora)',
  'crediario.pausou': 'pausou a cobrança de uma cliente',
  'crediario.retomou': 'retomou a cobrança de uma cliente',
  'crediario.lancou_divida': 'lançou uma dívida à mão no crediário',
  'cliente.juntou': 'juntou duas fichas da mesma cliente',
  'cliente.anotou': 'anotou na ficha de uma cliente',
  'empresa.assinaturas': 'mudou a regra de assinar com o PIN',
  'empresa.balcao_ampliado': 'mudou o que a vendedora pode no estoque e no cadastro',
  // A escola (escola.ts e mensalidades.ts).
  'turma.criou': 'criou uma turma',
  'turma.alterou': 'alterou uma turma',
  'matricula.criou': 'matriculou um aluno',
  'matricula.alterou': 'mudou o valor ou a bolsa de uma matrícula',
  'matricula.ativa': 'reativou uma matrícula',
  'matricula.trancada': 'trancou uma matrícula',
  'matricula.cancelada': 'cancelou uma matrícula',
  'matricula.concluida': 'concluiu uma matrícula',
  'responsavel.anotou': 'anotou o responsável de um aluno',
  'responsavel.alterou': 'alterou o responsável de um aluno',
  'mensalidade.gerou': 'gerou as mensalidades do mês',
  'mensalidade.recebeu': 'recebeu uma mensalidade',
  'mensalidade.dispensou': 'dispensou uma mensalidade',
  'equipe.papel.alterou': 'mudou o acesso de alguém',
  'equipe.meta': 'definiu meta e comissão',
  'quadro.criou': 'criou um quadro de tarefas',
  'quadro.alterou': 'alterou um quadro de tarefas',
  'quadro.arquivou': 'arquivou um quadro de tarefas',
  'tarefa.criou': 'criou uma tarefa',
  'tarefa.alterou': 'alterou uma tarefa',
  'tarefa.moveu': 'mudou a situação de uma tarefa',
  'tarefa.concluiu': 'concluiu uma tarefa',
  'tarefa.apagou': 'apagou uma tarefa',
  'encomenda.criou': 'anotou uma encomenda',
  'encomenda.alterou': 'alterou uma encomenda',
  'encomenda.aceitou': 'aceitou um pedido do catálogo',
  'encomenda.pronta': 'marcou uma encomenda como pronta',
  'encomenda.entregou': 'entregou uma encomenda',
  'encomenda.cancelou': 'cancelou uma encomenda',
  'financeiro.recorrente.criou': 'cadastrou uma conta recorrente',
  'financeiro.recorrente.alterou': 'alterou uma conta recorrente',
  'financeiro.recorrente.gerou': 'gerou as contas recorrentes do mês',
  'equipe.desativou': 'desativou uma conta',
  'equipe.reativou': 'reativou uma conta',
  'equipe.suporte.cortou': 'cortou o acesso do suporte do Norte',
  'equipe.nome': 'trocou o próprio nome',
  'equipe.telefone': 'mudou o telefone de alguém da equipe',
  'convite.criou': 'convidou alguém',
  'convite.revogou': 'cancelou um convite',
  'convite.aceitou': 'entrou pelo convite',
  'sessao.entrou': 'entrou no sistema',
  'vaga.assumiu': 'assumiu a vaga de alguém',
  'empresa.configurou': 'configurou a empresa',
  'unidade.criou': 'abriu uma loja',
  'unidade.alterou': 'alterou os dados de uma loja',
  'unidade.desativou': 'fechou uma loja',
  'unidade.reativou': 'reabriu uma loja',
  'empresa.modulos': 'ligou ou desligou módulos',
  'pontos.configurou': 'configurou o programa de pontos',
  'compra.criou': 'fez um pedido de compra',
  'compra.mudou_itens': 'mudou os itens de um pedido de compra',
  'compra.enviou': 'mandou um pedido ao fornecedor',
  'compra.recebeu': 'recebeu mercadoria de um pedido',
  'compra.encerrou': 'encerrou um pedido de compra',
  'compra.cancelou': 'cancelou um pedido de compra',
  'estoque.consumo': 'anotou material usado',
  'plano.trocou': 'trocou de plano',
  'plano.pediu': 'pediu outro plano',
  'credito.pediu': 'pediu crédito de IA',
  'respostas.pediu': 'pediu um pacote de respostas do assistente',
  'respostas.adicionou': 'entrou um pacote de respostas do assistente',
  // O que a equipe do Norte faz pela ferramenta de operação
  // (scripts/operacao.ts) — sempre assinado "Equipe Norte (<quem>)".
  'credito.recarregou': 'o Norte pôs crédito de IA',
  'pedido.recusou': 'o Norte recusou um pedido',
  'empresa.situacao': 'o Norte mudou a situação da conta',
  'suporte.concedeu': 'o Norte liberou acesso de suporte',
  'suporte.revogou': 'o Norte encerrou o acesso de suporte',
  // O porquê de uma decisão da equipe (o motivo de quem decidiu), logo
  // depois da linha do fato — ver `trocarPlanoPelaEquipe` em operacao.ts.
  'equipe.anotou': 'o Norte anotou o motivo de uma decisão',
  'empresa.modulo': 'o Norte ligou ou desligou um módulo contratado',
  'agente.proposta.confirmou': 'confirmou uma proposta do assistente',
  'financeiro.despesa': 'lançou uma conta a pagar',
  'financeiro.receita': 'lançou uma receita',
  'financeiro.pagou': 'deu baixa numa conta',
  'financeiro.despagou': 'desfez a baixa de uma conta',
  'financeiro.editou': 'corrigiu um lançamento',
  'financeiro.excluiu': 'excluiu um lançamento',
  'estoque.minimo': 'mudou o estoque mínimo',
  'agente.criou': 'criou o assistente',
  'agente.alterou': 'alterou o assistente',
  'agente.canal.conectou': 'conectou o WhatsApp do assistente',
  'agente.canal.desconectou': 'desconectou o WhatsApp do assistente',
  'agente.webhook.mostrou': 'viu o endereço do webhook do assistente',
  'agente.rotinas': 'ligou ou desligou rotinas do assistente',
  'campanha.criou': 'criou uma campanha de WhatsApp',
  'campanha.alterou': 'alterou uma campanha de WhatsApp',
  'campanha.ativou': 'ativou uma campanha de WhatsApp',
  'campanha.pausou': 'pausou uma campanha de WhatsApp',
  'campanha.apagou': 'apagou uma campanha de WhatsApp',
  'campanha.testou': 'testou uma campanha no próprio número',
  // O PIN pessoal (autorizacao.ts): quem AUTORIZOU fica como autor da linha.
  'autorizacao.pin': 'autorizou com o PIN',
  'conta.pin.criou': 'criou o próprio PIN de autorizar',
  'conta.pin.trocou': 'trocou o próprio PIN de autorizar',
  'conta.pin.tirou': 'apagou o próprio PIN de autorizar',
  'estoque.conferiu': 'conferiu uma peça vendida sem estoque',
  'empresa.maquininhas': 'mexeu nas maquininhas da loja',
  'empresa.lembrete': 'mudou o lembrete de horário pelo WhatsApp',
  'empresa.farol_marcas': 'o Norte mudou o limite de marcas do Farol',
  // Feitas pelo nosso script de criar empresa (scripts/criar-empresa.ts).
  'empresa.criou': 'a empresa foi criada',
  'empresa.reconvidou': 'o Norte mandou um convite novo ao dono',
  'venda.trocou': 'fez uma troca',
  'crediario.estornou': 'estornou um recebimento do crediário',
  'produto.foto': 'mudou a foto de um produto',
  'produto.importou': 'importou produtos de uma planilha',
  'fornecedor.criou': 'cadastrou um fornecedor',
  'fornecedor.alterou': 'alterou um fornecedor',
  'conta.senha.trocou': 'trocou a própria senha',
  'conta.senha.redefiniu': 'redefiniu a senha pelo link',
  'conta.email.confirmou': 'confirmou o e-mail',
  'equipe.senha.gerou-link': 'gerou um link de senha nova para alguém',
  'equipe.cargo.criou': 'criou um cargo',
  'equipe.cargo.alterou': 'alterou um cargo',
  'equipe.cargo.apagou': 'apagou um cargo',
  'equipe.telefone.confirmou': 'confirmou o telefone pelo WhatsApp',
  // A agenda (agenda.ts): cada passo do horário.
  'agenda.marcou': 'marcou um horário',
  'agenda.remarcou': 'remarcou um horário',
  'agenda.confirmou': 'confirmou um horário',
  'agenda.atendeu': 'marcou um horário como atendido',
  'agenda.faltou': 'marcou que o cliente faltou',
  'agenda.desmarcou': 'desmarcou um horário',
  'agenda.voltou': 'voltou um horário para marcado',
  // O ponto (ponto.ts).
  'colaborador.criou': 'cadastrou um funcionário',
  'colaborador.alterou': 'alterou um funcionário',
  'ponto.bateu': 'bateu o ponto por um funcionário',
  'ponto.ajustou': 'ajustou o ponto de um funcionário',
  'ponto.anulou': 'anulou uma batida de ponto',
  'ponto.abonou': 'abonou um dia no ponto',
  'ponto.desabonou': 'tirou o abono de um dia no ponto',
  'ponto.inicio': 'mudou o primeiro dia de trabalho',
  // A fábrica (fabrica.ts).
  'fabrica.receita.criou': 'criou uma ficha técnica',
  'fabrica.receita.alterou': 'alterou uma ficha técnica',
  'fabrica.receita.apagou': 'apagou uma ficha técnica',
  'fabrica.ordem.abriu': 'abriu uma ordem de produção',
  'fabrica.ordem.encerrou': 'encerrou uma ordem de produção',
  'fabrica.ordem.cancelou': 'cancelou uma ordem de produção',
  'fabrica.pedido.fez': 'fez um pedido à fábrica',
  'fabrica.pedido.enviou': 'mandou um pedido da fábrica para a loja',
  'fabrica.pedido.recebeu': 'recebeu um pedido da fábrica',
  'fabrica.pedido.cancelou': 'cancelou um pedido da fábrica',
  // O catálogo na internet (catalogo.ts).
  'catalogo.abriu': 'abriu o catálogo na internet',
  'catalogo.fechou': 'fechou o catálogo na internet',
  'catalogo.ajustou': 'ajustou o catálogo na internet',
  'encomenda.pelo_catalogo': 'chegou um pedido pelo catálogo',
  // O Farol (farol.ts).
  'farol.marca.criou': 'cadastrou uma marca no Farol',
  'farol.marca.alterou': 'alterou uma marca do Farol',
  'farol.marca.arquivou': 'arquivou uma marca do Farol',
  'farol.peca.gerou': 'gerou uma peça no Farol',
  // A conexão do WhatsApp do assistente (assistente/conexao.ts e meta-conexao.ts).
  'agente.proprio.conectou': 'conectou o número próprio do assistente',
  'agente.proprio.desconectou': 'desconectou o número próprio do assistente',
  'agente.zapi.salvou': 'salvou a conexão do WhatsApp do assistente',
  'agente.zapi.apagou': 'apagou a conexão do WhatsApp do assistente',
  'agente.webhook.gerou': 'gerou o endereço do webhook do assistente',
  'agente.webhook.trocou': 'trocou o endereço do webhook do assistente',
  'agente.meta.conectou': 'conectou o WhatsApp oficial do assistente',
  'agente.meta.desconectou': 'desconectou o WhatsApp oficial do assistente',
  'agente.modelo.criou': 'criou um modelo de mensagem do WhatsApp',
  'agente.modelo.apagou': 'apagou um modelo de mensagem do WhatsApp',
}

/**
 * Os assuntos do filtro. Cada um é um prefixo de ação — `venda.` pega
 * `venda.registrou` e `venda.cancelou`. Alguns juntam dois prefixos, porque
 * quem procura "gente" quer convite e sessão junto com equipe.
 */
/**
 * O livro de assinaturas: o que foi feito com o PIN de quem fez (as exceções
 * que a empresa manda assinar, juntar fichas, a vendedora corrigindo estoque)
 * e as autorizações com o PIN da gerente. É um filtro deste livro, e não um
 * livro à parte: a linha é a mesma da ação.
 */
export const ASSINADO = 'assinado'

export const ASSUNTOS: { chave: string; rotulo: string; prefixos: string[] }[] = [
  { chave: 'venda', rotulo: 'vendas e encomendas', prefixos: ['venda.', 'encomenda.', 'autorizacao.', 'agenda.', 'catalogo.'] },
  { chave: 'caixa', rotulo: 'caixa', prefixos: ['caixa.'] },
  { chave: 'produto', rotulo: 'produtos, estoque e compras', prefixos: ['produto.', 'estoque.', 'compra.', 'fornecedor.', 'fabrica.', 'farol.'] },
  { chave: 'cliente', rotulo: 'clientes', prefixos: ['cliente.', 'crediario.', 'pontos.', 'ofertas.'] },
  { chave: 'escola', rotulo: 'escola e mensalidades', prefixos: ['turma.', 'matricula.', 'responsavel.', 'mensalidade.'] },
  { chave: 'equipe', rotulo: 'equipe e acessos', prefixos: ['equipe.', 'convite.', 'sessao.', 'vaga.', 'conta.', 'colaborador.', 'ponto.'] },
  { chave: 'tarefa', rotulo: 'tarefas', prefixos: ['tarefa.', 'quadro.'] },
  { chave: 'empresa', rotulo: 'empresa e lojas', prefixos: ['empresa.', 'unidade.', 'plano.', 'credito.', 'pedido.', 'agente.', 'campanha.', 'financeiro.'] },
  { chave: 'suporte', rotulo: 'suporte do Norte', prefixos: ['suporte.'] },
  // Sem prefixo: o filtro é a marca de assinado (ver `filtroDoLivro`).
  { chave: ASSINADO, rotulo: 'assinado com PIN', prefixos: [] },
]

export type FiltroAuditoria = {
  unidadeIds: string[]
  de: Date
  /** Exclusivo. */
  ate: Date
  /** Nome de quem fez, nome do alvo, ou pedaço da ação. */
  q?: string | null
  assunto?: string | null
}

export type LinhaDoLivro = {
  id: string
  criadoEm: Date
  quem: string
  autor: string
  acao: string
  /** A ação em português. */
  texto: string
  alvoTipo: string | null
  alvoId: string | null
  alvoNome: string | null
  valor: number | null
  motivo: string | null
  unidade: string | null
  antes: unknown
  depois: unknown
  /** Feito com o PIN de quem fez (ou autorizado com o PIN). */
  assinado: boolean
}

/**
 * As condições do livro, cada uma no seu lugar do AND.
 *
 * Pura e exportada para o teste conferir a FORMA: é aqui que uma chave
 * repetida num objeto do Prisma apaga a outra sem erro nenhum.
 */
export function filtroDoLivro(permitidas: string[], prefixos: string[] | null, q: string, soAssinadas = false) {
  return [
    // Linha sem unidade é da empresa inteira (cadastro de produto, troca de
    // plano) e vale para quem tem o livro liberado.
    { OR: [{ unidadeId: null }, { unidadeId: { in: permitidas } }] },
    ...(prefixos && prefixos.length > 0 ? [{ OR: prefixos.map((p) => ({ acao: { startsWith: p } })) }] : []),
    // A autorização com PIN de antes da marca existir também é assinatura.
    ...(soAssinadas ? [{ OR: [{ assinado: true }, { acao: 'autorizacao.pin' }] }] : []),
    ...(q
      ? [
          {
            OR: [
              { quem: { contains: q, mode: 'insensitive' as const } },
              { alvoNome: { contains: q, mode: 'insensitive' as const } },
              { motivo: { contains: q, mode: 'insensitive' as const } },
              { acao: { contains: q, mode: 'insensitive' as const } },
            ],
          },
        ]
      : []),
  ]
}

export async function listarAuditoria(sessao: Sessao, f: FiltroAuditoria): Promise<LinhaDoLivro[]> {
  exigir(sessao, 'auditoria.ver')

  // A unidade vem do endereço. Só entram as que a pessoa pode ver — e as
  // linhas SEM unidade (cadastro de produto, troca de plano), que são da
  // empresa inteira e valem para quem tem o livro liberado.
  const permitidas = f.unidadeIds.filter((u) => pode(sessao, 'auditoria.ver', u))
  if (permitidas.length === 0) return []

  const q = textoDaBusca(f.q)
  const assunto = ASSUNTOS.find((a) => a.chave === f.assunto)

  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.auditoria.findMany({
      where: {
        criadoEm: { gte: f.de, lt: f.ate },
        // TRÊS condições de "ou", e por isso as três num AND só. Antes o
        // assunto e a busca eram cada um um `AND` espalhado no mesmo objeto, e
        // o segundo SOBRESCREVIA o primeiro: filtrar por "caixa" e digitar
        // "Ana" devolvia tudo que a Ana fez, de qualquer assunto. É o mesmo
        // defeito do `OR` da busca que apagava o `OR` da loja no financeiro.
        AND: filtroDoLivro(permitidas, assunto?.prefixos ?? null, q, assunto?.chave === ASSINADO),
      },
      orderBy: { criadoEm: 'desc' },
      // Um mês de loja movimentada são umas duas mil linhas. Quinhentas com
      // filtro cobrem qualquer pergunta; acima disso é exportação, não tela.
      take: 500,
      select: {
        id: true, criadoEm: true, quem: true, autor: true, acao: true,
        alvoTipo: true, alvoId: true, alvoNome: true, valor: true, motivo: true,
        antes: true, depois: true, assinado: true,
        unidade: { select: { nome: true } },
      },
    })

    return linhas.map((l) => ({
      id: l.id,
      criadoEm: l.criadoEm,
      quem: l.quem,
      autor: l.autor,
      acao: l.acao,
      texto: ACOES[l.acao] ?? l.acao,
      alvoTipo: l.alvoTipo,
      alvoId: l.alvoId,
      alvoNome: l.alvoNome,
      valor: l.valor === null ? null : Number(l.valor),
      motivo: l.motivo,
      unidade: l.unidade?.nome ?? null,
      antes: l.antes,
      depois: l.depois,
      assinado: l.assinado || l.acao === 'autorizacao.pin',
    }))
  })
}
