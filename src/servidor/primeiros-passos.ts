// Os primeiros passos da empresa nova — o cartão do Painel que o DONO vê
// enquanto falta alguma coisa.
//
// ── por que contado do banco, e não marcado ──────────────────
// "Feito" é o que o banco diz, nunca um clique de "já fiz": o cartão que diz
// "estoque lançado" com o estoque zerado ensina a não acreditar no resto do
// painel. Cada passo é uma pergunta de uma linha ao banco, e some sozinho
// quando a resposta muda.
//
// ── e por que só o dono ──────────────────────────────────────
// Abrir catálogo, ligar o WhatsApp e convidar a equipe são decisões de quem
// responde pela empresa. A balconista que vê "convide a equipe" não tem o
// que fazer com isso — e aprende que o painel fala com outra pessoa.

import { comoOrg } from './banco'
import type { Sessao } from './permissao'

export type EstadoDosPassos = {
  produtos: boolean
  estoque: boolean
  /** `null` = não deu para saber (o catálogo ainda não existe neste banco). */
  catalogo: boolean | null
  /** `null` = a empresa não tem o assistente no plano: o passo nem aparece. */
  whatsapp: boolean | null
  equipe: boolean
}

export type PrimeiroPasso = {
  chave: keyof EstadoDosPassos
  titulo: string
  detalhe: string
  feito: boolean
  href: string
  acao: string
}

/** É dono da empresa inteira? É para quem o cartão existe. */
export const ehDono = (sessao: Sessao, agora = new Date()) =>
  sessao.acessos.some((a) => a.papel === 'DONO' && a.unidadeId === null && (!a.expiraEm || a.expiraEm > agora))

/** A lista, na ordem em que se faz. Pura: a tela e o teste montam igual. */
export function montarPassos(e: EstadoDosPassos, slug: string): PrimeiroPasso[] {
  const passos: (PrimeiroPasso | null)[] = [
    {
      chave: 'produtos',
      titulo: 'Produtos cadastrados',
      detalhe: 'Traga o catálogo da planilha ou do sistema antigo de uma vez — sem digitar de novo.',
      feito: e.produtos,
      href: `/${slug}/produtos/importar`,
      acao: 'Trazer',
    },
    {
      chave: 'estoque',
      titulo: 'Estoque lançado',
      detalhe: 'O saldo de cada loja: entra junto com a planilha, ou pela contagem na tela de Estoque.',
      feito: e.estoque,
      href: `/${slug}/estoque`,
      acao: 'Lançar',
    },
    e.catalogo === null
      ? null
      : {
          chave: 'catalogo',
          titulo: 'Catálogo da loja aberto',
          detalhe: 'O link que a cliente abre no celular para ver o que tem e pedir pelo WhatsApp.',
          feito: e.catalogo,
          href: `/${slug}/catalogo`,
          acao: 'Abrir',
        },
    e.whatsapp === null
      ? null
      : {
          chave: 'whatsapp',
          titulo: 'WhatsApp do assistente conectado',
          detalhe: 'Leia o QR Code com o celular da loja e o assistente passa a responder e avisar.',
          feito: e.whatsapp,
          href: `/${slug}/agente`,
          acao: 'Conectar',
        },
    {
      chave: 'equipe',
      titulo: 'Equipe convidada',
      detalhe: 'Cada pessoa com o próprio acesso: o livro de auditoria diz quem fez o quê.',
      feito: e.equipe,
      href: `/${slug}/equipe`,
      acao: 'Convidar',
    },
  ]
  return passos.filter((p): p is PrimeiroPasso => p !== null)
}

/**
 * O estado dos passos, lido do banco — ou `null` para quem não é dono.
 * Leituras em sequência, numa transação só; o catálogo à parte, porque a
 * tabela dele pode ainda não existir num banco que não foi migrado, e a
 * falha de uma consulta derruba a transação inteira.
 */
export async function primeirosPassos(
  sessao: Sessao,
  empresa: { slug: string; temAssistente: boolean },
): Promise<PrimeiroPasso[] | null> {
  if (!ehDono(sessao)) return null
  const agora = new Date()
  const base = await comoOrg(sessao.orgId, async (db) => {
    const produto = await db.produto.findFirst({ select: { id: true } })
    const estoque = await db.estoque.findFirst({ where: { quantidade: { not: 0 } }, select: { id: true } })
    const agente = empresa.temAssistente
      ? await db.agente.findUnique({ where: { orgId: sessao.orgId }, select: { canal: true } })
      : null
    const pessoas = await db.usuario.count({ where: { ativo: true } })
    const convite = pessoas >= 2 ? null : await db.convite.findFirst({ where: { aceitoEm: null, expiraEm: { gt: agora } }, select: { id: true } })
    return {
      produtos: !!produto,
      estoque: !!estoque,
      // A mesma régua da tela do assistente (`estadoDaConexao`): ligado é
      // ter um canal — o QR Code, o Z-API ou o oficial da Meta.
      whatsapp: empresa.temAssistente ? !!agente && agente.canal !== 'NENHUM' : null,
      equipe: pessoas >= 2 || !!convite,
    }
  })
  let catalogo: boolean | null
  try {
    catalogo = await comoOrg(sessao.orgId, async (db) => !!(await db.catalogoLoja.findFirst({ where: { ativo: true }, select: { id: true } })))
  } catch {
    catalogo = null
  }
  return montarPassos({ ...base, catalogo }, empresa.slug)
}
