// As lojas da empresa: abrir, editar, fechar.
//
// ── o furo que isto fecha ────────────────────────────────────
// Até 25/09 a única loja que existia era a do cadastro inicial. A tabela de
// planos vendia "até 3 lojas", "até 5", "sem limite" — e não havia tela para
// abrir a segunda. O comentário em `comecar/acoes.ts` já dizia: "quando existir
// tela de abrir outra loja, a cota é lá". É aqui.
//
// ── três regras ──────────────────────────────────────────────
// 1. A COTA É CONFERIDA DENTRO da transação que abre a loja, com a trava da
//    empresa (`pg_advisory_xact_lock`) e a contagem refeita ali. Conferida
//    antes e fora, dois cliques em "Abrir" passavam os dois pela conferência
//    (cada um via N lojas) e a empresa ficava com N+2 num plano de N+1. A
//    trava faz o segundo clique esperar o primeiro terminar e contar de novo.
// 2. A LOJA NASCE COM O RAMO DELA. Uma sorveteria aberta dentro de uma
//    empresa de roupa ganha as categorias e o eixo Sabor que faltam — sem
//    apagar nem duplicar nada do que já existe. E ela nasce sem produto
//    nenhum À VENDA que não seja do catálogo comum: quem decide o que vai para
//    o balcão dela é a ficha de cada produto ("Vendido em").
// 3. FECHAR NÃO APAGA. Loja desativada some do balcão e dos seletores, e o
//    histórico dela continua inteiro. A última loja ativa não fecha, e loja
//    com pendência também não: caixa aberto (a gaveta precisa ser conferida),
//    mercadoria no estoque (sumiria de toda tela, que só lista loja aberta)
//    e encomenda por entregar (o cliente vem buscar numa loja que não existe
//    mais na tela). A recusa diz o que resolver, tudo de uma vez.

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, type Sessao } from './permissao'
import { SemCota } from './assinatura'
import { podeCriarUnidade } from './planos'
import { RAMOS, type Ramo } from './modulos'

export type DadosLoja = {
  nome: string
  apelido?: string | null
  documento?: string | null
  /** Razão social e inscrição estadual DESTA loja — o credor do carnê. */
  razaoSocial?: string | null
  inscricaoEstadual?: string | null
  ramo?: string | null
  ehDeposito?: boolean
  /** Fábrica: produz o que as lojas vendem. É depósito também (não vende no balcão). */
  ehFabrica?: boolean
  telefone?: string | null
  endereco?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
  horario?: string | null
}

export type LojaNaLista = {
  id: string
  nome: string
  apelido: string | null
  documento: string | null
  razaoSocial: string | null
  inscricaoEstadual: string | null
  ramo: string | null
  ehDeposito: boolean
  ehFabrica: boolean
  ativa: boolean
  telefone: string | null
  endereco: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  estado: string | null
  cep: string | null
  horario: string | null
  /** Produtos que só esta loja vende (os "do catálogo comum" não contam). */
  exclusivos: number
  caixaAberto: boolean
}

export class LojaRecusada extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'LojaRecusada'
  }
}

const RAMO_VALIDO = (r: string | null | undefined): r is Ramo => !!r && r in RAMOS && Object.hasOwn(RAMOS, r)

/** Limpa o que veio do formulário. Puro, para poder testar. */
export function limparLoja(d: DadosLoja): DadosLoja {
  const t = (v: string | null | undefined, max = 120) => {
    const s = (v ?? '').trim().slice(0, max)
    return s || null
  }
  const nome = (d.nome ?? '').trim().slice(0, 80)
  if (!nome) throw new LojaRecusada('A loja precisa de um nome.')
  const estado = t(d.estado, 2)?.toUpperCase() ?? null
  return {
    nome,
    apelido: t(d.apelido, 60),
    documento: t(d.documento, 20),
    razaoSocial: t(d.razaoSocial, 120),
    inscricaoEstadual: t(d.inscricaoEstadual, 20),
    ramo: RAMO_VALIDO(d.ramo) ? d.ramo : null,
    // Fábrica é depósito: não tem balcão, e não entra na conta das lojas.
    ehDeposito: !!d.ehDeposito || !!d.ehFabrica,
    ehFabrica: !!d.ehFabrica,
    telefone: t(d.telefone, 30),
    endereco: t(d.endereco),
    numero: t(d.numero, 20),
    complemento: t(d.complemento, 60),
    bairro: t(d.bairro, 60),
    cidade: t(d.cidade, 60),
    estado,
    cep: t(d.cep, 10),
    horario: t(d.horario, 120),
  }
}

export async function listarLojas(sessao: Sessao): Promise<LojaNaLista[]> {
  exigir(sessao, 'empresa.configurar')
  return comoOrg(sessao.orgId, async (db) => {
    const lojas = await db.unidade.findMany({
      orderBy: [{ ativa: 'desc' }, { ehDeposito: 'asc' }, { nome: 'asc' }],
    })
    // "Só dela" é só dela: lista de UMA loja. Contar toda lista em que a
    // loja aparece dizia "40 produtos só dela" da loja que divide os 40
    // com a vizinha.
    const exclusivos = await db.$queryRaw<{ unidade_id: string; n: number }[]>`
      select p.vendido_em[1] as unidade_id, count(*)::int as n
        from produtos p
       where p.ativo and cardinality(p.vendido_em) = 1
       group by 1
    `
    const abertos = await db.caixa.findMany({ where: { aberto: true }, select: { unidadeId: true } })
    const nDe = new Map(exclusivos.map((e) => [e.unidade_id, e.n]))
    const comCaixa = new Set(abertos.map((c) => c.unidadeId))
    return lojas.map((l) => ({
      id: l.id,
      nome: l.nome,
      apelido: l.apelido,
      documento: l.documento,
      razaoSocial: l.razaoSocial,
      inscricaoEstadual: l.inscricaoEstadual,
      ramo: l.ramo,
      ehDeposito: l.ehDeposito,
      ehFabrica: l.ehFabrica,
      ativa: l.ativa,
      telefone: l.telefone,
      endereco: l.endereco,
      numero: l.numero,
      complemento: l.complemento,
      bairro: l.bairro,
      cidade: l.cidade,
      estado: l.estado,
      cep: l.cep,
      horario: l.horario,
      exclusivos: nDe.get(l.id) ?? 0,
      caixaAberto: comCaixa.has(l.id),
    }))
  })
}

/**
 * Acrescenta o que o ramo precisa e ainda não existe: categorias e eixos,
 * comparados por NOME (sem acento nem caixa). Nunca apaga, nunca duplica.
 * Devolve o que criou, para a tela dizer.
 */
export async function semearRamo(db: BancoDaOrg, orgId: string, ramo: Ramo) {
  const preset = RAMOS[ramo]
  const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

  const categorias = await db.categoria.findMany({ select: { nome: true, ordem: true } })
  const temCat = new Set(categorias.map((c) => chave(c.nome)))
  let ordem = categorias.reduce((m, c) => Math.max(m, c.ordem), -1) + 1
  const novasCategorias: string[] = []
  for (const nome of preset.categorias) {
    if (temCat.has(chave(nome))) continue
    await db.categoria.create({ data: { orgId, nome, ordem: ordem++ } })
    novasCategorias.push(nome)
  }

  const eixos = await db.eixo.findMany({ select: { nome: true, ordem: true } })
  const temEixo = new Set(eixos.map((e) => chave(e.nome)))
  let ordemEixo = eixos.reduce((m, e) => Math.max(m, e.ordem), -1) + 1
  const novosEixos: string[] = []
  for (const e of preset.eixos) {
    if (temEixo.has(chave(e.nome))) continue
    const eixo = await db.eixo.create({ data: { orgId, nome: e.nome, ordem: ordemEixo++, ehCor: e.ehCor } })
    for (const [j, valor] of e.opcoes.entries()) {
      await db.opcao.create({ data: { orgId, eixoId: eixo.id, valor, ordem: j } })
    }
    novosEixos.push(e.nome)
  }
  return { novasCategorias, novosEixos }
}

/**
 * A cota de lojas, conferida DENTRO da transação que vai ocupar a vaga.
 *
 * A trava é por empresa e vive até o fim da transação: o segundo clique em
 * "Abrir" (ou "Reabrir") espera o primeiro gravar, e aí conta as lojas de
 * novo — já com a do primeiro. É a regra 1 do topo.
 */
async function travarCota(db: BancoDaOrg, orgId: string, deposito = false) {
  await db.$executeRaw`select pg_advisory_xact_lock(hashtext(${`cota:unidades:${orgId}`}))`
  const org = await db.org.findUniqueOrThrow({ where: { id: orgId }, select: { plano: true } })
  // Depósito não vende e não entra na conta (desde a tabela de 02/10/2026, o
  // que se paga é a LOJA). No Grátis ele segue a régua de sempre: lá a
  // empresa é de uma unidade só.
  if (deposito && org.plano !== 'GRATIS') return { custoExtra: 0 }
  // Só loja ABERTA, e só loja de vender — a mesma conta de `assinaturaDaEmpresa`.
  const abertas = await db.unidade.count({ where: { ativa: true, ...(org.plano === 'GRATIS' ? {} : { ehDeposito: false }) } })
  const v = podeCriarUnidade(org.plano, abertas)
  if (!v.pode) throw new SemCota(v.motivo, v.sugestao)
  return { custoExtra: v.custoExtra }
}

export async function criarLoja(sessao: Sessao, dados: DadosLoja) {
  exigir(sessao, 'empresa.configurar')
  const d = limparLoja(dados)

  return comoOrg(sessao.orgId, async (db) => {
    const cota = await travarCota(db, sessao.orgId, !!d.ehDeposito)
    const org = await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { ramo: true, modulos: true } })
    const loja = await db.unidade.create({ data: { orgId: sessao.orgId, ...d } })

    const ramo = (d.ramo ?? org.ramo) as string | null
    const semeado = RAMO_VALIDO(ramo) ? await semearRamo(db, sessao.orgId, ramo) : { novasCategorias: [], novosEixos: [] }

    // A segunda loja liga o módulo de várias lojas: sem ele os seletores de
    // loja não aparecem, e a dona abriria a loja nova sem ter como olhar
    // para ela. A cota já garantiu que o plano comporta mais de uma.
    const lojasAtivas = await db.unidade.count({ where: { ativa: true } })
    if (lojasAtivas > 1 && !org.modulos.includes('multiUnidade')) {
      await db.org.update({ where: { id: sessao.orgId }, data: { modulos: [...org.modulos, 'multiUnidade'] } })
    }

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: loja.id,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'unidade.criou',
        alvoTipo: 'unidade',
        alvoId: loja.id,
        alvoNome: loja.nome,
        depois: { ramo: d.ramo, ehDeposito: d.ehDeposito, ehFabrica: d.ehFabrica, ...semeado },
        valor: cota.custoExtra || undefined,
      },
    })
    return { loja, ...semeado, custoExtra: cota.custoExtra }
  })
}

export async function editarLoja(sessao: Sessao, id: string, dados: DadosLoja) {
  exigir(sessao, 'empresa.configurar')
  const d = limparLoja(dados)
  return comoOrg(sessao.orgId, async (db) => {
    const antes = await db.unidade.findUnique({ where: { id } })
    if (!antes) throw new LojaRecusada('Loja não encontrada.')
    // Virar depósito a última loja aberta é fechar a última loja por outro
    // caminho: depósito não vende, e a empresa ficaria sem balcão nenhum.
    if (d.ehDeposito && !antes.ehDeposito && antes.ativa) {
      const outras = await db.unidade.count({ where: { ativa: true, ehDeposito: false, id: { not: id } } })
      if (outras === 0) {
        throw new LojaRecusada('Esta é a única loja que vende. Abra outra antes de transformar esta em depósito.')
      }
    }
    const loja = await db.unidade.update({ where: { id }, data: d })

    // Trocou o ramo: acrescenta o que o ramo novo pede. Não tira nada do
    // antigo — outra loja pode estar usando.
    const semeado =
      d.ramo && d.ramo !== antes.ramo && RAMO_VALIDO(d.ramo)
        ? await semearRamo(db, sessao.orgId, d.ramo)
        : { novasCategorias: [], novosEixos: [] }

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: id,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'unidade.alterou',
        alvoTipo: 'unidade',
        alvoId: id,
        alvoNome: loja.nome,
        antes: { nome: antes.nome, ramo: antes.ramo, ehDeposito: antes.ehDeposito, ehFabrica: antes.ehFabrica },
        depois: { nome: loja.nome, ramo: loja.ramo, ehDeposito: loja.ehDeposito, ehFabrica: loja.ehFabrica, ...semeado },
      },
    })
    return { loja, ...semeado }
  })
}

/**
 * O que impede fechar a loja, em frases prontas para a tela.
 *
 * Tudo de uma vez: recusar pelo caixa, a pessoa fechar o caixa e aí ser
 * recusada pelo estoque é fazer a dona tentar três vezes para descobrir a
 * lista. Loja fechada some de toda tela — o saldo dela ficaria contado em
 * lugar nenhum, e a encomenda, sem balcão para ser entregue.
 */
export async function pendenciasParaFechar(db: BancoDaOrg, unidadeId: string): Promise<string[]> {
  const faltam: string[] = []
  const caixa = await db.caixa.count({ where: { unidadeId, aberto: true } })
  if (caixa > 0) faltam.push('o caixa está aberto — feche o caixa, para a gaveta ser conferida')
  const itens = await db.estoque.count({ where: { unidadeId, quantidade: { not: 0 } } })
  if (itens > 0) {
    faltam.push(
      `${itens === 1 ? 'há 1 item' : `há ${itens.toLocaleString('pt-BR')} itens`} com saldo no estoque — ` +
        'transfira para outra loja ou para um depósito, ou corrija pelo que foi contado',
    )
  }
  const encomendas = await db.encomenda.count({ where: { unidadeId, situacao: { in: ['ABERTA', 'PRONTA'] } } })
  if (encomendas > 0) {
    faltam.push(
      `${encomendas === 1 ? 'há 1 encomenda' : `há ${encomendas} encomendas`} por entregar — entregue ou cancele`,
    )
  }
  // Horário marcado daqui para a frente: a cliente chegaria numa loja que o
  // sistema não abre mais, e a agenda dela sumiria de toda tela.
  const horarios = await db.agendamento.count({
    where: { unidadeId, situacao: { in: ['MARCADO', 'CONFIRMADO'] }, inicio: { gte: new Date() } },
  })
  if (horarios > 0) {
    faltam.push(
      `${horarios === 1 ? 'há 1 horário marcado' : `há ${horarios} horários marcados`} na agenda — remarque em outra loja ou desmarque`,
    )
  }
  // Pedido ao fornecedor ainda aberto: a mercadoria chegaria numa loja
  // fechada, sem ninguém para dar entrada.
  const pedidos = await db.pedidoCompra.count({ where: { unidadeId, situacao: { in: ['RASCUNHO', 'ENVIADO', 'PARCIAL'] } } })
  if (pedidos > 0) {
    faltam.push(
      `${pedidos === 1 ? 'há 1 pedido de compra em aberto' : `há ${pedidos} pedidos de compra em aberto`} — receba, encerre ou cancele`,
    )
  }
  return faltam
}

export async function mudarSituacaoLoja(sessao: Sessao, id: string, ativa: boolean) {
  exigir(sessao, 'empresa.configurar')

  return comoOrg(sessao.orgId, async (db) => {
    const loja = await db.unidade.findUnique({ where: { id } })
    if (!loja) throw new LojaRecusada('Loja não encontrada.')
    // Reabrir a que já está aberta não ocupa lugar novo — antes recusava
    // com "o plano atende N lojas" quem estava no teto.
    if (loja.ativa === ativa) return loja

    // Reabrir ocupa vaga, igual abrir: a mesma trava e a mesma contagem.
    if (ativa) await travarCota(db, sessao.orgId, loja.ehDeposito)

    if (!ativa) {
      const outras = await db.unidade.count({ where: { ativa: true, id: { not: id }, ehDeposito: false } })
      if (!loja.ehDeposito && outras === 0) {
        throw new LojaRecusada('Esta é a única loja aberta. A empresa precisa de pelo menos uma.')
      }
      const pendencias = await pendenciasParaFechar(db, id)
      if (pendencias.length > 0) {
        throw new LojaRecusada(`Antes de fechar ${loja.nome}, resolva: ${pendencias.join('; ')}.`)
      }
    }

    const nova = await db.unidade.update({ where: { id }, data: { ativa } })
    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: id,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: ativa ? 'unidade.reativou' : 'unidade.desativou',
        alvoTipo: 'unidade',
        alvoId: id,
        alvoNome: loja.nome,
      },
    })
    return nova
  })
}
