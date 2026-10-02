// Clientes.
//
// ── por que o telefone é a chave, e não o CPF ────────────────
// No comércio de bairro quase ninguém pede CPF, e quase todo mundo dá o
// WhatsApp. O telefone é o que a loja realmente tem, é por onde o assistente
// fala, e é por onde a cobrança sai. CPF entra quando existe (nota fiscal e
// crediário pedem), mas nunca é obrigatório — exigir CPF para cadastrar faria
// o balcão parar de cadastrar.
//
// ── e por que o telefone é guardado só com dígito ────────────
// A mesma pessoa é digitada "(71) 99999-0000", "71999990000" e
// "+55 71 99999-0000" por três pessoas diferentes no mesmo mês. Guardando só
// os dígitos, as três viram a mesma linha — e é isso que impede a loja de ter
// o mesmo cliente cadastrado quatro vezes com dívidas separadas.

import type { ConsentimentoOfertas } from '@prisma/client'
import { SEM_ACERTO_DE_CATALOGO } from './acerto-catalogo'
import { comoOrg } from './banco'
import { exigir, pode, textoDaBusca, unidadesQuePodem, type Sessao } from './permissao'
import { listarParcelas, situacaoDosClientes, type ParcelaNaLista } from './crediario'
import { codigoDoRecibo, recibosDoCliente, type ReciboNaLista } from './recibos'
import { centavos, reais } from './dinheiro'
import { diaDaColuna, diaEmSP } from './dia'
import { janelaDoMes, mesDeAgora, outroMes } from './financeiro'
import { chaveTelefone } from './assistente/telefone'
import {
  conferirAceite,
  ehOrigemAceite,
  gravarAceite,
  type MudancaDeAceite,
  type OrigemAceite,
} from './ofertas'

/** Só os dígitos. É o que faz a busca e a checagem de repetido funcionarem. */
export const soDigitos = (v: string) => v.replace(/\D/g, '')

/** "(71) 99999-0000" — para a tela, nunca para o banco. */
export function mostrarTelefone(bruto: string | null): string {
  if (!bruto) return ''
  const d = soDigitos(bruto)
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return bruto
}

/**
 * CPF válido?
 *
 * A conferência dos dois dígitos, não só o tamanho. Sem ela o balcão digita
 * um número errado, a nota fiscal é recusada pela SEFAZ dias depois, e aí
 * ninguém lembra qual venda era.
 */
export function cpfValido(bruto: string): boolean {
  const d = soDigitos(bruto)
  if (d.length !== 11) return false
  // 111.111.111-11 e parentes passam na conta e não existem.
  if (/^(\d)\1{10}$/.test(d)) return false

  const digito = (ate: number) => {
    let soma = 0
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10])
}

export type DadosCliente = {
  nome: string
  telefone?: string | null
  documento?: string | null
  email?: string | null
  nascimento?: Date | null
  endereco?: string | null
  numero?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
  cep?: string | null
  observacoes?: string | null
}

export type ResultadoCliente =
  | { ok: true; clienteId: string }
  | { ok: false; motivo: string; jaExiste?: { id: string; nome: string } }

/**
 * O que a ficha mandou sobre as ofertas no WhatsApp. `valor` é a bolinha
 * escolhida; só vira gravação quando MUDA o que a ficha já tinha — salvar a
 * ficha por outro motivo não "aceita de novo" nem mexe na data do aceite.
 */
export type AceiteNaFicha = { valor: ConsentimentoOfertas; origem: string | null }

/** A mudança que o aceite da ficha pede, ou nula (nada mudou / não é mudança gravável). */
export function mudancaDeAceite(atual: ConsentimentoOfertas, pedido: AceiteNaFicha | null | undefined):
  | { ok: true; mudanca: MudancaDeAceite | null }
  | { ok: false; motivo: string } {
  if (!pedido || pedido.valor === atual || pedido.valor === 'NAO_PERGUNTADO') return { ok: true, mudanca: null }
  // Como a pessoa respondeu é parte da prova (LGPD art. 8º, § 2º): sem ele,
  // "aceitou" é palavra da loja contra a do cliente.
  const origem: OrigemAceite | null = ehOrigemAceite(pedido.origem) ? pedido.origem : null
  if (!origem) return { ok: false, motivo: 'Diga como a pessoa respondeu sobre as ofertas (no balcão, por telefone...).' }
  return { ok: true, mudanca: { ofertas: pedido.valor, origem } }
}

async function limpar(dados: DadosCliente) {
  const telefone = dados.telefone ? soDigitos(dados.telefone) : null
  const documento = dados.documento ? soDigitos(dados.documento) : null
  return {
    nome: dados.nome.trim(),
    telefone: telefone || null,
    documento: documento || null,
    email: dados.email?.trim().toLowerCase() || null,
    nascimento: dados.nascimento ?? null,
    endereco: dados.endereco?.trim() || null,
    numero: dados.numero?.trim() || null,
    bairro: dados.bairro?.trim() || null,
    cidade: dados.cidade?.trim() || null,
    estado: dados.estado?.trim().toUpperCase().slice(0, 2) || null,
    cep: dados.cep ? soDigitos(dados.cep) : null,
    observacoes: dados.observacoes?.trim() || null,
  }
}

export async function criarCliente(
  sessao: Sessao,
  dados: DadosCliente,
  aceite?: AceiteNaFicha | null,
  agora = new Date(),
): Promise<ResultadoCliente> {
  exigir(sessao, 'cliente.editar')

  const c = await limpar(dados)
  if (!c.nome) return { ok: false, motivo: 'O cliente precisa de um nome.' }
  if (c.documento && !cpfValido(c.documento)) {
    return { ok: false, motivo: 'Esse CPF não confere. Confira os números.' }
  }
  const m = mudancaDeAceite('NAO_PERGUNTADO', aceite)
  if (!m.ok) return m
  const chave = chaveTelefone(c.telefone)

  return comoOrg(sessao.orgId, async (db) => {
    if (m.mudanca) {
      const recusa = await conferirAceite(db, sessao.orgId, chave, m.mudanca)
      if (recusa) return { ok: false as const, motivo: recusa }
    }

    // Repetido é AVISO, não erro: homônimo existe, e travar o cadastro no
    // balcão faz a vendedora desistir e vender sem cliente. A tela mostra
    // quem já existe e deixa a pessoa decidir.
    if (c.telefone) {
      const igual = await db.cliente.findFirst({
        where: { telefone: c.telefone },
        select: { id: true, nome: true },
      })
      if (igual) {
        return { ok: false as const, motivo: 'Já existe cliente com esse telefone.', jaExiste: igual }
      }
    }

    const criado = await db.cliente.create({
      data: { orgId: sessao.orgId, ...c },
      select: { id: true },
    })

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'cliente.criou',
        alvoTipo: 'cliente',
        alvoId: criado.id,
        alvoNome: c.nome,
      },
    })

    if (m.mudanca) await gravarAceite(db, sessao, { id: criado.id, nome: c.nome }, chave, m.mudanca, agora)

    return { ok: true as const, clienteId: criado.id }
  })
}

export async function editarCliente(
  sessao: Sessao,
  clienteId: string,
  dados: DadosCliente & { ativo?: boolean },
  aceite?: AceiteNaFicha | null,
  agora = new Date(),
): Promise<ResultadoCliente> {
  exigir(sessao, 'cliente.editar')

  const c = await limpar(dados)
  if (!c.nome) return { ok: false, motivo: 'O cliente precisa de um nome.' }
  if (c.documento && !cpfValido(c.documento)) {
    return { ok: false, motivo: 'Esse CPF não confere. Confira os números.' }
  }
  const chave = chaveTelefone(c.telefone)

  return comoOrg(sessao.orgId, async (db) => {
    const antes = await db.cliente.findUnique({
      where: { id: clienteId },
      select: { nome: true, telefone: true, ofertasWhatsapp: true, anonimizadoEm: true },
    })
    if (!antes) return { ok: false as const, motivo: 'Cliente não encontrado.' }
    // Anonimizada é anonimizada: escrever um nome de novo aqui desfaria o
    // pedido do titular. Quem voltou a comprar é cadastro novo.
    if (antes.anonimizadoEm) return { ok: false as const, motivo: 'Este cadastro foi anonimizado e não se edita mais.' }

    const m = mudancaDeAceite(antes.ofertasWhatsapp, aceite)
    if (!m.ok) return m
    // Aluno com responsável (escola.ts): quem aceita mensagem é o responsável,
    // na ficha dele. O "sim" da ficha da criança não se grava.
    if (m.mudanca?.ofertas === 'SIM' && (await db.responsavel.count({ where: { alunoId: clienteId } })) > 0) {
      return { ok: false as const, motivo: 'Este aluno tem responsável: mensagem da escola vai só para o responsável, com o aceite dele. Deixe esta ficha sem aceite.' }
    }
    if (m.mudanca) {
      const recusa = await conferirAceite(db, sessao.orgId, chave, m.mudanca)
      if (recusa) return { ok: false as const, motivo: recusa }
    }

    if (c.telefone && c.telefone !== antes.telefone) {
      const igual = await db.cliente.findFirst({
        where: { telefone: c.telefone, id: { not: clienteId } },
        select: { id: true, nome: true },
      })
      if (igual) {
        return { ok: false as const, motivo: 'Outro cliente já usa esse telefone.', jaExiste: igual }
      }
    }

    await db.cliente.update({
      where: { id: clienteId },
      data: { ...c, ...(dados.ativo !== undefined && { ativo: dados.ativo }) },
    })

    await db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: 'cliente.alterou',
        alvoTipo: 'cliente',
        alvoId: clienteId,
        alvoNome: c.nome,
        antes: { nome: antes.nome, telefone: antes.telefone },
      },
    })

    if (m.mudanca) await gravarAceite(db, sessao, { id: clienteId, nome: c.nome }, chave, m.mudanca, agora)

    return { ok: true as const, clienteId }
  })
}

export type ClienteNaLista = {
  id: string
  nome: string
  telefone: string | null
  ativo: boolean
  compras: number
  gastou: number
  ultimaCompra: Date | null
  pontos: number
  nascimento: Date | null
  criadoEm: Date
  cidade: string | null
  /** Crediário em aberto e, disso, o vencido. Zero quando não deve. */
  devendo: number
  vencido: number
  /**
   * As compras trazidas do sistema anterior (o carnê importado, venda
   * SALDO_IMPORTADO). Ficam FORA de `compras` e `gastou` — não são venda deste
   * sistema, e "quem mais gasta" não pode mudar com a importação —, mas a
   * cliente não é nova: o balcão dizia "primeira compra aqui" para quem
   * compra na loja há anos.
   */
  anteriores: number
  /** A compra mais antiga que se conhece, contando as trazidas. Nula = nunca comprou. */
  primeiraCompra: Date | null
}

/**
 * A lista, já com o que decide a conversa: quanto a pessoa gastou e há quanto
 * tempo ela não aparece.
 *
 * Nome e telefone sozinhos fazem uma agenda; é o histórico que transforma a
 * lista em ferramenta de venda — e é dele que sai o "cliente sumido" que o
 * assistente vai buscar.
 */
/**
 * As vendas de um cliente que esta pessoa pode ver.
 *
 * O cliente é da empresa inteira — o cadastro é um só, e a balconista de
 * qualquer loja precisa achar a pessoa. As COMPRAS dele não: são vendas, e
 * venda se vê por loja. Antes a ficha mostrava ao gerente da loja 3 cada
 * compra feita na loja 5, com valor e itens. `null` = sem filtro (o dono).
 */
function lojasDasCompras(sessao: Sessao): string[] | null {
  const alcance = unidadesQuePodem(sessao, 'venda.ver')
  return alcance === 'todas' ? null : alcance
}

export async function listarClientes(
  sessao: Sessao,
  termo?: string,
  // A TELA mostra quinhentos; a PLANILHA pede tudo. Antes as duas usavam o
  // mesmo teto, e a planilha de uma loja com 3.000 clientes saía com 500 —
  // sem aviso, justamente na cópia que a loja leva para guardar.
  limite = 500,
  // Ficha desativada (e a anonimizada, que é desativada de vez) não é
  // cliente da loja: a lista mostrava "Cliente anonimizado" entre os outros
  // e contava ele nos números de cima, e o Painel, que só conta ativos,
  // dizia outro total. Quem quer ver as desativadas pede.
  situacao: 'ativos' | 'inativos' | 'todos' = 'ativos',
): Promise<ClienteNaLista[]> {
  exigir(sessao, 'cliente.ver')

  const t = textoDaBusca(termo)
  const digitos = soDigitos(t)
  const lojas = lojasDasCompras(sessao)

  return comoOrg(sessao.orgId, async (db) => {
    const clientes = await db.cliente.findMany({
      where: {
        ...(situacao === 'todos' ? {} : { ativo: situacao === 'ativos' }),
        ...(t
          ? {
              OR: [
                { nome: { contains: t, mode: 'insensitive' as const } },
                ...(digitos.length >= 3
                  ? [{ telefone: { contains: digitos } }, { documento: { contains: digitos } }]
                  : []),
              ],
            }
          : {}),
      },
      orderBy: { nome: 'asc' },
      // Quinhentos com os filtros da tela; a busca acha o resto. Acima disso
      // a pessoa quer a planilha, e ela existe (e pede o `limite` dela).
      take: limite,
      select: {
        id: true, nome: true, telefone: true, ativo: true, pontos: true,
        nascimento: true, criadoEm: true, cidade: true,
        vendas: {
          where: { situacao: { in: ['CONCLUIDA', 'SALDO_IMPORTADO'] }, ...(lojas ? { unidadeId: { in: lojas } } : {}) },
          select: { total: true, criadaEm: true, situacao: true },
        },
      },
    })

    const fiado = await situacaoDosClientes(db, clientes.map((c) => c.id), sessao)

    return clientes.map((c) => {
      const daqui = c.vendas.filter((v) => v.situacao === 'CONCLUIDA')
      return {
        id: c.id,
        nome: c.nome,
        telefone: c.telefone,
        ativo: c.ativo,
        pontos: c.pontos,
        nascimento: c.nascimento,
        criadoEm: c.criadoEm,
        cidade: c.cidade,
        compras: daqui.length,
        gastou: daqui.reduce((s, v) => s + Number(v.total), 0),
        ultimaCompra: daqui.reduce<Date | null>(
          (maior, v) => (!maior || v.criadaEm > maior ? v.criadaEm : maior),
          null,
        ),
        devendo: fiado.get(c.id)?.devendo ?? 0,
        vencido: fiado.get(c.id)?.vencido ?? 0,
        anteriores: c.vendas.length - daqui.length,
        primeiraCompra: c.vendas.reduce<Date | null>(
          (menor, v) => (!menor || v.criadaEm < menor ? v.criadaEm : menor),
          null,
        ),
      }
    })
  })
}

/** Quanto a pessoa gastou em cada um dos últimos N meses — para a ficha desenhar. */
export async function comprasPorMes(sessao: Sessao, clienteId: string, meses = 12) {
  exigir(sessao, 'cliente.ver')
  const lojas = lojasDasCompras(sessao)
  // Os meses de São Paulo, não os da máquina: num servidor em UTC, às 22h do
  // dia 30 o gráfico já começava no mês seguinte e a compra da noite sumia.
  const atual = mesDeAgora()
  const chaves = Array.from({ length: meses }, (_, i) => outroMes(atual, i - (meses - 1)))
  const de = janelaDoMes(chaves[0]!).de
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.$queryRaw<{ mes: string; total: string; compras: number }[]>`
      select to_char(v.criada_em at time zone 'UTC' at time zone 'America/Sao_Paulo', 'YYYY-MM') as mes,
             sum(v.total) as total, count(*)::int as compras
        from vendas v
       where v.cliente_id = ${clienteId} and v.situacao = 'CONCLUIDA' and v.criada_em >= ${de}
         and (${lojas === null} or v.unidade_id = any(${lojas ?? ['-']}))
       group by 1
    `
    return chaves.map((mes) => {
      const l = linhas.find((x) => x.mes === mes)
      return { mes, rotulo: MES[Number(mes.slice(5)) - 1]!, total: Number(l?.total ?? 0), compras: Number(l?.compras ?? 0) }
    })
  })
}

/**
 * O que a pessoa mais leva. Cinco itens, pelas vezes que levou.
 *
 * Com a MEDIDA de cada um: o sorvete a granel sai em quilo, e sem ela a
 * ficha mostrava "1,857 un". E a ordem é por vezes, não por quantidade —
 * 1,8 kg e 3 camisetas não se comparam, mas "levou em 6 compras" sim.
 */
export async function favoritosDoCliente(sessao: Sessao, clienteId: string) {
  exigir(sessao, 'cliente.ver')
  const lojas = lojasDasCompras(sessao)
  return comoOrg(sessao.orgId, async (db) => {
    const linhas = await db.$queryRaw<{ descricao: string; medida: string; quantidade: string; total: string; vezes: number }[]>`
      select i.descricao, i.medida::text as medida, sum(i.quantidade) as quantidade, sum(i.total) as total,
             count(distinct v.id)::int as vezes
        from venda_itens i join vendas v on v.id = i.venda_id
       where v.cliente_id = ${clienteId} and v.situacao = 'CONCLUIDA'
         and (${lojas === null} or v.unidade_id = any(${lojas ?? ['-']}))
         and ${SEM_ACERTO_DE_CATALOGO}
       group by 1, 2 order by vezes desc, total desc limit 5
    `
    return linhas.map((l) => ({
      descricao: l.descricao,
      medida: l.medida,
      quantidade: Number(l.quantidade),
      total: Number(l.total),
      vezes: l.vezes,
    }))
  })
}

/** A ficha, com as últimas compras. */
export async function acharCliente(sessao: Sessao, clienteId: string) {
  exigir(sessao, 'cliente.ver')
  const lojas = lojasDasCompras(sessao)

  return comoOrg(sessao.orgId, (db) =>
    db.cliente.findUnique({
      where: { id: clienteId },
      select: {
        id: true, nome: true, telefone: true, documento: true, email: true,
        nascimento: true, endereco: true, numero: true, bairro: true,
        cidade: true, estado: true, cep: true, observacoes: true, ativo: true,
        pontos: true,
        ofertasWhatsapp: true, ofertasEm: true, ofertasOrigem: true, ofertasPor: true,
        anonimizadoEm: true,
        // O extrato de pontos. Sem ele, "eu tinha 400" nao tem resposta — e
        // quem juntou nao tem comprovante nenhum em casa.
        movimentosPontos: {
          orderBy: { criadoEm: 'desc' },
          take: 20,
          select: {
            id: true, tipo: true, pontos: true, saldoDepois: true,
            motivo: true, criadoEm: true,
          },
        },
        vendas: {
          where: { situacao: 'CONCLUIDA', ...(lojas ? { unidadeId: { in: lojas } } : {}) },
          orderBy: { criadaEm: 'desc' },
          take: 30,
          select: {
            id: true, numero: true, total: true, criadaEm: true,
            unidade: { select: { nome: true } },
            itens: { select: { descricao: true, quantidade: true } },
          },
        },
      },
    }),
  )
}

// ─────────────────────────────────────────────────────────────
// A FICHA NO BALCÃO
// ─────────────────────────────────────────────────────────────
// A cliente na frente do caixa pergunta "quanto eu devo?", "quando paguei a
// de julho?", "meu telefone mudou". A página da ficha (clientes/[id]) responde
// tudo isso, mas fica fora do balcão: abrir outra tela com a fila esperando é
// perder a venda que está montada. Aqui vai a mesma ficha, num pacote só, para
// a tela cheia do balcão (balcao/FichaDaCliente.tsx) — e a venda continua lá
// atrás, do jeito que estava.
//
// Mesmo alcance das outras telas: as COMPRAS são das lojas em que a pessoa vê
// venda (`lojasDasCompras`), o CREDIÁRIO das lojas em que ela vê crediário —
// a vendedora da loja 1 não lê o carnê da loja 2.

/** O que falta no cadastro para o carnê e a nota. O balcão avisa e oferece completar. */
export function faltaNoCadastro(c: { telefone: string | null; documento: string | null; endereco: string | null }): string[] {
  const falta: string[] = []
  if (!c.documento) falta.push('CPF')
  if (!c.telefone) falta.push('telefone')
  if (!c.endereco) falta.push('endereço')
  return falta
}

/** Um pagamento que abateu a parcela: quando, quanto e por qual papel. */
export type PagamentoDaParcela = {
  /** Quando foi pago — na baixa externa, o dia que ela pagou lá fora. */
  quando: Date
  valor: number
  forma: string
  externo: boolean
  reciboId: string | null
  recibo: string | null
}

export type ParcelaNaFicha = {
  id: string
  numero: number
  de: number
  /** 'AAAA-MM-DD' (coluna `date` — ver dia.ts). */
  vencimento: string
  valor: number
  pago: number
  desconto: number
  resta: number
  situacao: ParcelaNaLista['situacao']
  diasAtraso: number
  /** Multa + juro de hoje, pela regra da empresa. */
  atrasoHoje: number
  quitadaEm: Date | null
  pagamentos: PagamentoDaParcela[]
}

/** O carnê de uma compra: as parcelas dela, pagas e abertas. */
export type CarneNaFicha = {
  vendaId: string
  vendaNumero: number
  /** Saldo trazido do sistema anterior (venda SALDO_IMPORTADO). */
  importada: boolean
  unidadeId: string
  unidade: string
  criadaEm: Date | null
  aberto: number
  vencido: number
  pago: number
  parcelas: ParcelaNaFicha[]
}

/** O que ela deve em cada loja (cada loja é um credor, com o caixa dela). */
export type LojaNaFicha = {
  unidadeId: string
  unidade: string
  aberto: number
  vencido: number
  atrasoHoje: number
  parcelasAbertas: number
  parcelasVencidas: number
  /** Quem opera pode receber parcela NESTA loja. */
  podeReceber: boolean
}

export type EventoNaFicha =
  | { tipo: 'compra'; id: string; quando: Date; unidade: string; valor: number; titulo: string; detalhe: string; vendaId: string }
  | { tipo: 'pagamento'; id: string; quando: Date; unidade: string; valor: number; titulo: string; detalhe: string; reciboId: string | null }

export type FichaNoBalcao = {
  cliente: {
    id: string
    nome: string
    telefone: string | null
    documento: string | null
    email: string | null
    /** 'AAAA-MM-DD', ou ''. */
    nascimento: string
    endereco: string | null
    numero: string | null
    bairro: string | null
    cidade: string | null
    estado: string | null
    cep: string | null
    pontos: number
    ativo: boolean
    anonimizado: boolean
  }
  falta: string[]
  /** A pessoa vê o crediário (a aba aparece). */
  veCrediario: boolean
  resumo: {
    compras: number
    gastou: number
    ultimaCompra: Date | null
    /** Compras trazidas do sistema anterior (o carnê importado). */
    anteriores: number
    /** Quanto ela já pagou de crediário (o principal abatido), nas lojas visíveis. */
    pagoCrediario: number
    lojas: LojaNaFicha[]
    vales: { codigo: string; saldo: number; validade: string | null; vencido: boolean; loja: string | null }[]
  }
  carnes: CarneNaFicha[]
  /** Os recibos do crediário, do mais novo — para reimprimir ("perdi o recibo de setembro"). */
  recibos: ReciboNaLista[]
  historico: EventoNaFicha[]
}

const NOME_DA_FORMA: Record<string, string> = {
  DINHEIRO: 'dinheiro', PIX: 'Pix', DEBITO: 'débito', CREDITO: 'crédito', CREDIARIO: 'crediário',
  VALE: 'vale', TRANSFERENCIA: 'transferência',
}

/** "parcelas 2/5, 3/5 da compra 41" — o que um pagamento abateu, agrupado por compra. */
export function parcelasDoPagamento(itens: readonly { numero: number; de: number; vendaNumero: number }[]): string {
  const porVenda = new Map<number, string[]>()
  for (const i of itens) {
    const ps = porVenda.get(i.vendaNumero) ?? []
    const rotulo = `${i.numero}/${i.de}`
    if (!ps.includes(rotulo)) ps.push(rotulo)
    porVenda.set(i.vendaNumero, ps)
  }
  return [...porVenda.entries()]
    .map(([n, ps]) => `${ps.length === 1 ? 'parcela' : 'parcelas'} ${ps.join(', ')} da compra ${n}`)
    .join('; ')
}

export async function fichaNoBalcao(sessao: Sessao, clienteId: string, agora = new Date()): Promise<FichaNoBalcao | null> {
  exigir(sessao, 'cliente.ver')
  const lojas = lojasDasCompras(sessao)
  const alcanceCred = pode(sessao, 'crediario.ver') ? unidadesQuePodem(sessao, 'crediario.ver') : []
  const veCrediario = alcanceCred === 'todas' || alcanceCred.length > 0
  const naLoja = lojas ? { unidadeId: { in: lojas } } : {}
  const credNaLoja = alcanceCred === 'todas' ? {} : { unidadeId: { in: alcanceCred } }

  // Uma consulta depois da outra, numa transação só (nunca em paralelo dentro
  // do comoOrg — ver banco.ts). As parcelas vêm de `listarParcelas`, depois:
  // é ela que sabe a conta do atraso de hoje.
  const base = await comoOrg(sessao.orgId, async (db) => {
    const c = await db.cliente.findUnique({
      where: { id: clienteId },
      select: {
        id: true, nome: true, telefone: true, documento: true, email: true, nascimento: true,
        endereco: true, numero: true, bairro: true, cidade: true, estado: true, cep: true,
        pontos: true, ativo: true, anonimizadoEm: true,
      },
    })
    if (!c) return null
    const vendas = await db.venda.findMany({
      where: { clienteId, situacao: 'CONCLUIDA', ...naLoja },
      orderBy: { criadaEm: 'desc' },
      take: 40,
      select: {
        id: true, numero: true, total: true, criadaEm: true,
        unidade: { select: { nome: true } },
        itens: { select: { descricao: true } },
        pagamentos: { select: { forma: true } },
      },
    })
    const somas = await db.venda.aggregate({
      where: { clienteId, situacao: 'CONCLUIDA', ...naLoja },
      _count: { _all: true },
      _sum: { total: true },
      _max: { criadaEm: true },
    })
    const anteriores = await db.venda.count({ where: { clienteId, situacao: 'SALDO_IMPORTADO', ...naLoja } })
    const vales = await db.vale.findMany({
      where: { clienteId, saldo: { gt: 0 } },
      orderBy: { criadoEm: 'desc' },
      select: { codigo: true, saldo: true, validade: true, unidade: { select: { nome: true } } },
    })
    const unidades = veCrediario
      ? await db.unidade.findMany({ where: alcanceCred === 'todas' ? {} : { id: { in: alcanceCred } }, select: { id: true } })
      : []
    const recebimentos = veCrediario
      ? await db.recebimento.findMany({
          where: { parcela: { clienteId, ...credNaLoja } },
          orderBy: { criadoEm: 'asc' },
          select: {
            id: true, parcelaId: true, criadoEm: true, valor: true, forma: true, externo: true, reciboId: true,
            recibo: { select: { pagoEm: true } },
            parcela: { select: { numero: true, de: true, venda: { select: { numero: true } }, unidade: { select: { nome: true } } } },
          },
        })
      : []
    const compras = veCrediario
      ? await db.venda.findMany({
          where: { parcelas: { some: { clienteId, ...credNaLoja } } },
          select: { id: true, criadaEm: true, situacao: true },
        })
      : []
    return { c, vendas, somas, anteriores, vales, unidades, recebimentos, compras }
  })
  if (!base) return null
  const { c, vendas, somas, anteriores, vales, unidades, recebimentos, compras } = base

  const parcelas = veCrediario
    ? await listarParcelas(sessao, { unidadeIds: unidades.map((u) => u.id), clienteId }, agora)
    : []
  const recibos = veCrediario ? await recibosDoCliente(sessao, clienteId, 30) : []

  // ── os pagamentos de cada parcela ──
  const pagamentosDe = new Map<string, PagamentoDaParcela[]>()
  for (const r of recebimentos) {
    const lista = pagamentosDe.get(r.parcelaId) ?? []
    lista.push({
      quando: r.externo && r.recibo?.pagoEm ? r.recibo.pagoEm : r.criadoEm,
      valor: Number(r.valor),
      forma: r.forma,
      externo: r.externo,
      reciboId: r.reciboId,
      recibo: r.reciboId ? codigoDoRecibo(r.reciboId) : null,
    })
    pagamentosDe.set(r.parcelaId, lista)
  }

  // ── os carnês, por compra, e o que ela deve em cada loja ──
  const dasCompras = new Map(compras.map((v) => [v.id, v]))
  const carnes = new Map<string, CarneNaFicha>()
  const porLoja = new Map<string, LojaNaFicha>()
  let pagoC = 0
  for (const p of parcelas) {
    const restaC = centavos(p.resta)
    pagoC += centavos(p.pago)
    const venda = dasCompras.get(p.vendaId)
    const carne: CarneNaFicha = carnes.get(p.vendaId) ?? {
      vendaId: p.vendaId,
      vendaNumero: p.vendaNumero,
      importada: venda?.situacao === 'SALDO_IMPORTADO',
      unidadeId: p.unidadeId,
      unidade: p.unidade,
      criadaEm: venda?.criadaEm ?? null,
      aberto: 0,
      vencido: 0,
      pago: 0,
      parcelas: [],
    }
    const atrasoC = centavos(p.multaHoje) + centavos(p.jurosHoje)
    carne.parcelas.push({
      id: p.id,
      numero: p.numero,
      de: p.de,
      vencimento: diaDaColuna(p.vencimento),
      valor: p.valor,
      pago: p.pago,
      desconto: p.desconto,
      resta: p.resta,
      situacao: p.situacao,
      diasAtraso: p.diasAtraso,
      atrasoHoje: reais(atrasoC),
      quitadaEm: p.quitadaEm,
      pagamentos: pagamentosDe.get(p.id) ?? [],
    })
    carne.pago = reais(centavos(carne.pago) + centavos(p.pago))
    if (p.situacao !== 'quitada' && restaC > 0) {
      carne.aberto = reais(centavos(carne.aberto) + restaC)
      const loja: LojaNaFicha = porLoja.get(p.unidadeId) ?? {
        unidadeId: p.unidadeId,
        unidade: p.unidade,
        aberto: 0,
        vencido: 0,
        atrasoHoje: 0,
        parcelasAbertas: 0,
        parcelasVencidas: 0,
        podeReceber: pode(sessao, 'crediario.receber', p.unidadeId),
      }
      loja.aberto = reais(centavos(loja.aberto) + restaC)
      loja.parcelasAbertas++
      if (p.situacao === 'vencida') {
        carne.vencido = reais(centavos(carne.vencido) + restaC)
        loja.vencido = reais(centavos(loja.vencido) + restaC)
        loja.atrasoHoje = reais(centavos(loja.atrasoHoje) + atrasoC)
        loja.parcelasVencidas++
      }
      porLoja.set(p.unidadeId, loja)
    }
    carnes.set(p.vendaId, carne)
  }
  for (const k of carnes.values()) k.parcelas.sort((a, b) => a.numero - b.numero)
  // Primeiro o que está em aberto (a mais atrasada em cima), depois os pagos,
  // do mais novo — é a ordem da conversa: "o que eu devo?", e só depois "e as
  // que já paguei?".
  const primeiraAberta = (k: CarneNaFicha) => k.parcelas.find((p) => p.situacao !== 'quitada')?.vencimento ?? '9999'
  const listaDeCarnes = [...carnes.values()].sort((a, b) => {
    const aa = a.aberto > 0
    const bb = b.aberto > 0
    if (aa !== bb) return aa ? -1 : 1
    if (aa) return primeiraAberta(a).localeCompare(primeiraAberta(b))
    return (b.criadaEm?.getTime() ?? 0) - (a.criadaEm?.getTime() ?? 0)
  })

  // ── o histórico: compras e pagamentos, do mais novo ──
  const historico: EventoNaFicha[] = vendas.map((v) => {
    const formas = [...new Set(v.pagamentos.map((x) => NOME_DA_FORMA[x.forma] ?? x.forma.toLowerCase()))]
    const itens = v.itens.map((i) => i.descricao)
    const levou = itens.slice(0, 3).join(', ') + (itens.length > 3 ? ` e mais ${itens.length - 3}` : '')
    return {
      tipo: 'compra' as const,
      id: `v-${v.id}`,
      quando: v.criadaEm,
      unidade: v.unidade.nome,
      valor: Number(v.total),
      titulo: `Compra nº ${v.numero}`,
      detalhe: [levou, formas.join(' + ')].filter(Boolean).join(' · '),
      vendaId: v.id,
    }
  })
  // Um pagamento é um recibo (o que foi pago junto); o recebimento antigo,
  // sem recibo (importado), vale sozinho.
  type Grupo = {
    quando: Date
    unidade: string
    valorC: number
    formas: Set<string>
    externo: boolean
    reciboId: string | null
    itens: { numero: number; de: number; vendaNumero: number }[]
  }
  const pagamentos = new Map<string, Grupo>()
  for (const r of recebimentos) {
    const chave = r.reciboId ?? r.id
    const quando = r.externo && r.recibo?.pagoEm ? r.recibo.pagoEm : r.criadoEm
    const g: Grupo = pagamentos.get(chave) ?? {
      quando,
      unidade: r.parcela.unidade.nome,
      valorC: 0,
      formas: new Set<string>(),
      externo: r.externo,
      reciboId: r.reciboId,
      itens: [],
    }
    g.valorC += centavos(r.valor)
    g.formas.add(NOME_DA_FORMA[r.forma] ?? r.forma.toLowerCase())
    g.itens.push({ numero: r.parcela.numero, de: r.parcela.de, vendaNumero: r.parcela.venda.numero })
    pagamentos.set(chave, g)
  }
  for (const [chave, g] of pagamentos) {
    historico.push({
      tipo: 'pagamento',
      id: `p-${chave}`,
      quando: g.quando,
      unidade: g.unidade,
      valor: reais(g.valorC),
      titulo: g.externo ? 'Crediário pago fora' : 'Pagou o crediário',
      detalhe: [parcelasDoPagamento(g.itens), g.externo ? null : [...g.formas].join(' + ')].filter(Boolean).join(' · '),
      reciboId: g.reciboId,
    })
  }
  historico.sort((a, b) => b.quando.getTime() - a.quando.getTime())

  const hoje = diaEmSP(agora)
  return {
    cliente: {
      id: c.id,
      nome: c.nome,
      telefone: c.telefone,
      documento: c.documento,
      email: c.email,
      nascimento: c.nascimento ? diaDaColuna(c.nascimento) : '',
      endereco: c.endereco,
      numero: c.numero,
      bairro: c.bairro,
      cidade: c.cidade,
      estado: c.estado,
      cep: c.cep,
      pontos: c.pontos,
      ativo: c.ativo,
      anonimizado: !!c.anonimizadoEm,
    },
    falta: c.anonimizadoEm ? [] : faltaNoCadastro(c),
    veCrediario,
    resumo: {
      compras: somas._count._all,
      gastou: reais(centavos(somas._sum.total ?? 0)),
      ultimaCompra: somas._max.criadaEm,
      anteriores,
      pagoCrediario: reais(pagoC),
      lojas: [...porLoja.values()].sort((a, b) => b.vencido - a.vencido || b.aberto - a.aberto),
      vales: vales.map((v) => {
        const validade = v.validade ? diaDaColuna(v.validade) : null
        return { codigo: v.codigo, saldo: Number(v.saldo), validade, vencido: !!validade && validade < hoje, loja: v.unidade?.nome ?? null }
      }),
    },
    carnes: listaDeCarnes,
    recibos,
    historico: historico.slice(0, 120),
  }
}

/** Os campos que o balcão edita. O resto da ficha (observação, ofertas) fica como está. */
export type DadosNoBalcao = Pick<
  DadosCliente,
  'nome' | 'telefone' | 'documento' | 'email' | 'nascimento' | 'endereco' | 'numero' | 'bairro' | 'cidade' | 'estado' | 'cep'
>

/**
 * Completar a ficha no balcão — o CPF que o carnê pede, o telefone novo.
 *
 * Lê a ficha e troca SÓ o que o balcão mostra: `editarCliente` grava todos os
 * campos de uma vez, e mandar só o que a tela tem apagaria a observação que a
 * gerente escreveu ("não vender fiado").
 */
export async function editarNoBalcao(sessao: Sessao, clienteId: string, dados: DadosNoBalcao): Promise<ResultadoCliente> {
  exigir(sessao, 'cliente.editar')
  const atual = await comoOrg(sessao.orgId, (db) =>
    db.cliente.findUnique({ where: { id: clienteId }, select: { observacoes: true } }),
  )
  if (!atual) return { ok: false, motivo: 'Cliente não encontrado.' }
  return editarCliente(sessao, clienteId, { ...dados, observacoes: atual.observacoes })
}

/**
 * O cadastro de uma linha só do balcão: nome, telefone e o CPF (perguntado,
 * nunca exigido). CPF que já está numa ficha não cria outra — a resposta
 * aponta a ficha que existe. Duas fichas da mesma pessoa são duas dívidas
 * que ninguém soma.
 */
export async function cadastroRapido(
  sessao: Sessao,
  nome: string,
  telefone: string,
  cpf = '',
): Promise<
  | { ok: true; clienteId: string }
  | { ok: false; erro: string; jaExiste?: { id: string; nome: string; telefone: string | null; pontos: number } }
> {
  exigir(sessao, 'cliente.editar')
  const documento = soDigitos(cpf)
  if (documento && !cpfValido(documento)) return { ok: false, erro: 'Esse CPF não confere. Confira os números, ou cadastre sem CPF.' }
  if (documento) {
    // A ficha desativada também conta: reativar é melhor que duplicar.
    const dono = await comoOrg(sessao.orgId, (db) =>
      db.cliente.findFirst({
        where: { documento, anonimizadoEm: null },
        orderBy: { ativo: 'desc' },
        select: { id: true, nome: true, telefone: true, pontos: true, ativo: true },
      }),
    )
    if (dono) {
      return dono.ativo
        ? { ok: false, erro: `Esse CPF já é de ${dono.nome}.`, jaExiste: { id: dono.id, nome: dono.nome, telefone: dono.telefone, pontos: dono.pontos } }
        : { ok: false, erro: `Esse CPF já é de ${dono.nome}, numa ficha desativada. Peça à gerente para reativar.` }
    }
  }
  const r = await criarCliente(sessao, { nome, telefone, documento: documento || null })
  if (!r.ok) {
    return {
      ok: false,
      erro: r.jaExiste ? `${r.jaExiste.nome} já usa esse telefone.` : r.motivo,
      jaExiste: r.jaExiste ? { id: r.jaExiste.id, nome: r.jaExiste.nome, telefone: soDigitos(telefone) || null, pontos: 0 } : undefined,
    }
  }
  return { ok: true, clienteId: r.clienteId }
}
