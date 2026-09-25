// As lojas da empresa: abrir, editar, fechar.
//
// ── o furo que isto fecha ────────────────────────────────────
// Até 25/09 a única loja que existia era a do cadastro inicial. A tabela de
// planos vendia "até 3 lojas", "até 5", "sem limite" — e não havia tela para
// abrir a segunda. O comentário em `comecar/acoes.ts` já dizia: "quando existir
// tela de abrir outra loja, a cota é lá". É aqui.
//
// ── três regras ──────────────────────────────────────────────
// 1. A COTA É CONFERIDA ANTES, E FORA da transação. `exigirCotaDeUnidade`
//    abre o próprio `comoOrg`; chamá-la de dentro de outro trava (ver o
//    comentário longo em `banco.ts`).
// 2. A LOJA NASCE COM O RAMO DELA. Uma sorveteria aberta dentro de uma
//    empresa de roupa ganha as categorias e o eixo Sabor que faltam — sem
//    apagar nem duplicar nada do que já existe. E ela nasce sem produto
//    nenhum À VENDA que não seja do catálogo comum: quem decide o que vai para
//    o balcão dela é a ficha de cada produto ("Vendido em").
// 3. FECHAR NÃO APAGA. Loja desativada some do balcão e dos seletores, e o
//    histórico dela continua inteiro. A última loja ativa não fecha, e loja com
//    caixa aberto também não — o dinheiro da gaveta precisa ser conferido antes.

import { comoOrg, type BancoDaOrg } from './banco'
import { exigir, type Sessao } from './permissao'
import { exigirCotaDeUnidade } from './assinatura'
import { RAMOS, type Ramo } from './modulos'

export type DadosLoja = {
  nome: string
  apelido?: string | null
  documento?: string | null
  ramo?: string | null
  ehDeposito?: boolean
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
  ramo: string | null
  ehDeposito: boolean
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
    ramo: RAMO_VALIDO(d.ramo) ? d.ramo : null,
    ehDeposito: !!d.ehDeposito,
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
    const exclusivos = await db.$queryRaw<{ unidade_id: string; n: number }[]>`
      select u as unidade_id, count(*)::int as n
        from produtos p, unnest(p.vendido_em) as u
       where p.ativo
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
      ramo: l.ramo,
      ehDeposito: l.ehDeposito,
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

export async function criarLoja(sessao: Sessao, dados: DadosLoja) {
  exigir(sessao, 'empresa.configurar')
  const d = limparLoja(dados)

  // FORA da transação — ver a regra 1 no topo.
  const cota = await exigirCotaDeUnidade(sessao)

  return comoOrg(sessao.orgId, async (db) => {
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
        depois: { ramo: d.ramo, ehDeposito: d.ehDeposito, ...semeado },
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
        antes: { nome: antes.nome, ramo: antes.ramo, ehDeposito: antes.ehDeposito },
        depois: { nome: loja.nome, ramo: loja.ramo, ehDeposito: loja.ehDeposito, ...semeado },
      },
    })
    return { loja, ...semeado }
  })
}

export async function mudarSituacaoLoja(sessao: Sessao, id: string, ativa: boolean) {
  exigir(sessao, 'empresa.configurar')

  // Reabrir conta cota, igual abrir — e fora da transação. Mas só se a loja
  // estiver MESMO fechada: reabrir a que já está aberta não ocupa lugar
  // novo, e antes recusava com "o plano atende N lojas" quem estava no teto.
  if (ativa) {
    const jaAberta = await comoOrg(sessao.orgId, (db) =>
      db.unidade.findUnique({ where: { id }, select: { ativa: true } }),
    )
    if (!jaAberta?.ativa) await exigirCotaDeUnidade(sessao)
  }

  return comoOrg(sessao.orgId, async (db) => {
    const loja = await db.unidade.findUnique({ where: { id } })
    if (!loja) throw new LojaRecusada('Loja não encontrada.')
    if (loja.ativa === ativa) return loja

    if (!ativa) {
      const outras = await db.unidade.count({ where: { ativa: true, id: { not: id }, ehDeposito: false } })
      if (!loja.ehDeposito && outras === 0) {
        throw new LojaRecusada('Esta é a única loja aberta. A empresa precisa de pelo menos uma.')
      }
      const caixa = await db.caixa.count({ where: { unidadeId: id, aberto: true } })
      if (caixa > 0) {
        throw new LojaRecusada('Esta loja está com o caixa aberto. Feche o caixa antes, para a gaveta ser conferida.')
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
