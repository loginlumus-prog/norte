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

import { comoOrg } from './banco'
import { exigir, type Sessao } from './permissao'

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
): Promise<ResultadoCliente> {
  exigir(sessao, 'cliente.editar')

  const c = await limpar(dados)
  if (!c.nome) return { ok: false, motivo: 'O cliente precisa de um nome.' }
  if (c.documento && !cpfValido(c.documento)) {
    return { ok: false, motivo: 'Esse CPF não confere. Confira os números.' }
  }

  return comoOrg(sessao.orgId, async (db) => {
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

    return { ok: true as const, clienteId: criado.id }
  })
}

export async function editarCliente(
  sessao: Sessao,
  clienteId: string,
  dados: DadosCliente & { ativo?: boolean },
): Promise<ResultadoCliente> {
  exigir(sessao, 'cliente.editar')

  const c = await limpar(dados)
  if (!c.nome) return { ok: false, motivo: 'O cliente precisa de um nome.' }
  if (c.documento && !cpfValido(c.documento)) {
    return { ok: false, motivo: 'Esse CPF não confere. Confira os números.' }
  }

  return comoOrg(sessao.orgId, async (db) => {
    const antes = await db.cliente.findUnique({
      where: { id: clienteId },
      select: { nome: true, telefone: true },
    })
    if (!antes) return { ok: false as const, motivo: 'Cliente não encontrado.' }

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
}

/**
 * A lista, já com o que decide a conversa: quanto a pessoa gastou e há quanto
 * tempo ela não aparece.
 *
 * Nome e telefone sozinhos fazem uma agenda; é o histórico que transforma a
 * lista em ferramenta de venda — e é dele que sai o "cliente sumido" que o
 * assistente vai buscar.
 */
export async function listarClientes(
  sessao: Sessao,
  termo?: string,
): Promise<ClienteNaLista[]> {
  exigir(sessao, 'cliente.ver')

  const t = termo?.trim() ?? ''
  const digitos = soDigitos(t)

  return comoOrg(sessao.orgId, async (db) => {
    const clientes = await db.cliente.findMany({
      where: t
        ? {
            OR: [
              { nome: { contains: t, mode: 'insensitive' } },
              ...(digitos.length >= 3
                ? [{ telefone: { contains: digitos } }, { documento: { contains: digitos } }]
                : []),
            ],
          }
        : {},
      orderBy: { nome: 'asc' },
      take: 200,
      select: {
        id: true, nome: true, telefone: true, ativo: true, pontos: true,
        vendas: {
          where: { situacao: 'CONCLUIDA' },
          select: { total: true, criadaEm: true },
        },
      },
    })

    return clientes.map((c) => ({
      id: c.id,
      nome: c.nome,
      telefone: c.telefone,
      ativo: c.ativo,
      pontos: c.pontos,
      compras: c.vendas.length,
      gastou: c.vendas.reduce((s, v) => s + Number(v.total), 0),
      ultimaCompra: c.vendas.reduce<Date | null>(
        (maior, v) => (!maior || v.criadaEm > maior ? v.criadaEm : maior),
        null,
      ),
    }))
  })
}

/** A ficha, com as últimas compras. */
export async function acharCliente(sessao: Sessao, clienteId: string) {
  exigir(sessao, 'cliente.ver')

  return comoOrg(sessao.orgId, (db) =>
    db.cliente.findUnique({
      where: { id: clienteId },
      select: {
        id: true, nome: true, telefone: true, documento: true, email: true,
        nascimento: true, endereco: true, numero: true, bairro: true,
        cidade: true, estado: true, cep: true, observacoes: true, ativo: true,
        pontos: true,
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
          where: { situacao: 'CONCLUIDA' },
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
