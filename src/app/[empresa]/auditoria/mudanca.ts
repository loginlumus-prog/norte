// O "antes → depois" de uma linha do livro, em palavras de gente.
//
// O livro guarda o que mudou do jeito que o banco chama: `precoVista: 12.5 →
// 14`, `papel: BALCAO → GERENTE`, `ativo: true → false`. A dona lê isto na
// tela Auditoria para saber quem mexeu no quê — e "precoVista" e "BALCAO" não
// são palavras dela. Aqui cada campo conhecido ganha nome, e cada valor ganha
// a forma que ele tem no resto do sistema: dinheiro em reais, papel pelo nome
// da tela Equipe, data em dia/mês/ano, sim e não.
//
// Puro (sem banco, sem Next): o teste cobre os casos.

import type { Papel } from '@/servidor/permissao'

const NOME_DO_CAMPO: Record<string, string> = {
  precoVista: 'preço à vista',
  precoCartao: 'preço no cartão',
  precoCrediario: 'preço no crediário',
  custo: 'custo',
  esperado: 'esperado',
  contado: 'contado',
  valor: 'valor',
  valorMax: 'valor máximo',
  saldo: 'saldo',
  limite: 'limite',
  minimo: 'mínimo',
  papel: 'papel',
  unidadeId: 'loja',
  ativo: 'situação',
  situacao: 'situação',
  nome: 'nome',
  telefone: 'telefone',
  descricao: 'descrição',
  titulo: 'título',
  grupo: 'grupo',
  prioridade: 'prioridade',
  progresso: 'progresso',
  prazo: 'prazo',
  inicio: 'início',
  quantidade: 'quantidade',
  responsavel: 'responsável',
  plano: 'plano',
  canal: 'canal',
  ramo: 'ramo',
  cor: 'cor',
  ehDeposito: 'depósito',
  expiraEm: 'vale até',
  pagoEm: 'pago em',
  vencimento: 'vencimento',
  email: 'e-mail',
  codigo: 'código',
  tipo: 'tipo',
  origem: 'origem',
  teto: 'teto',
}

/** Campos que não se mostram: identificadores internos, que não dizem nada a ninguém. */
const ESCONDIDOS = new Set(['responsavelId', 'vendaId', 'pedidoId', 'colaboradorId', 'sessao', 'path', 'phoneNumberId', 'instancia'])

const DINHEIRO = /^(preco|custo|esperado|contado|valor|saldo|limite|minimo|teto)/i

const PAPEL: Record<Papel, string> = {
  DONO: 'Dono',
  GERENTE: 'Gerente',
  BALCAO: 'Balcão',
  FINANCEIRO: 'Financeiro',
  CONTADOR: 'Contador',
  SUPORTE: 'Suporte',
}

const SITUACAO: Record<string, string> = {
  A_FAZER: 'a fazer',
  FAZENDO: 'em andamento',
  EM_ANDAMENTO: 'em andamento',
  PARADA: 'parada',
  PARADO: 'parado',
  FEITO: 'feita',
  ATIVA: 'ativa',
  SUSPENSA: 'suspensa',
  CANCELADA: 'cancelada',
  PENDENTE: 'pendente',
  PAGO: 'pago',
  ABERTO: 'aberto',
  FECHADO: 'fechado',
}

const reais = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)

/** "2026-09-10" ou ISO completo → "10/09/2026". */
function data(x: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(x)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null
}

/** Um valor, como a tela mostraria. `lojas` traduz o id da loja para o nome. */
export function valorLegivel(campo: string, x: unknown, lojas: ReadonlyMap<string, string> = new Map()): string {
  if (x === null || x === undefined || x === '') return campo === 'unidadeId' ? 'todas as lojas' : '—'
  if (typeof x === 'boolean') {
    if (campo === 'ativo') return x ? 'ativo' : 'sem acesso'
    return x ? 'sim' : 'não'
  }
  if (typeof x === 'number') {
    if (DINHEIRO.test(campo)) return reais(x)
    if (campo === 'progresso') return `${x}%`
    return new Intl.NumberFormat('pt-BR').format(x)
  }
  const s = String(x)
  if (campo === 'papel' && s in PAPEL) return PAPEL[s as Papel]
  if (campo === 'unidadeId') return lojas.get(s) ?? 'outra loja'
  if (s in SITUACAO) return SITUACAO[s]!
  const d = data(s)
  if (d) return d
  // Código do banco (MAIÚSCULAS_COM_TRAÇO) vira palavra minúscula.
  if (/^[A-Z][A-Z_]+$/.test(s)) return s.toLowerCase().replace(/_/g, ' ')
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

/** O nome de um campo; campo desconhecido vira palavras ("valeHoras" → "vale horas"). */
export function campoLegivel(campo: string): string {
  return NOME_DO_CAMPO[campo] ?? campo.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
}

/** O "antes → depois" numa frase curta, só quando dá para ler. Até três campos. */
export function resumoDaMudanca(
  antes: unknown,
  depois: unknown,
  lojas: ReadonlyMap<string, string> = new Map(),
): string | null {
  const a = antes as Record<string, unknown> | null
  const d = depois as Record<string, unknown> | null
  if (!a || !d || typeof a !== 'object' || typeof d !== 'object' || Array.isArray(a) || Array.isArray(d)) return null
  const simples = (x: unknown) => x === null || ['string', 'number', 'boolean'].includes(typeof x)
  const partes: string[] = []
  for (const k of Object.keys(d)) {
    if (ESCONDIDOS.has(k)) continue
    if (!(k in a) || a[k] === d[k] || !simples(a[k]) || !simples(d[k])) continue
    partes.push(`${campoLegivel(k)}: ${valorLegivel(k, a[k], lojas)} → ${valorLegivel(k, d[k], lojas)}`)
  }
  return partes.length ? partes.slice(0, 3).join(' · ') : null
}
