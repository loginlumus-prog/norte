import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { escolherUnidade } from '@/servidor/unidade'
import { caixaAberto } from '@/servidor/caixa'
import { configCrediario } from '@/servidor/crediario'
import { moduloLigado } from '@/servidor/modulos'
import { pode } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { lerMaquininhas } from '@/servidor/maquininhas'
import { compraParaTroca } from '@/servidor/troca'
import { diaEmSP } from '@/servidor/dia'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso } from '@/ui/base'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import type { Tema } from '@/ui/TrocaTema'
import { Troca, type ConfigDaTroca } from './Troca'

export const metadata: Metadata = { title: 'Troca' }

// A troca numa tela só (ver servidor/troca.ts).
//
// Abre de dois jeitos: pelo balcão ("⇄ Troca", começa achando a compra) e
// pela venda ("Trocar", já com a compra aberta). A loja é a da compra — a
// peça volta para o estoque de lá e o vale nasce de lá.

export default async function TrocaPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; venda?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, venda } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'venda.criar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // Vinda da venda: a compra decide a loja.
  const inicial = typeof venda === 'string' && /^[\w-]{1,64}$/.test(venda) ? await compraParaTroca(sessao, venda) : null

  const escolha = await escolherUnidade(sessao, empresa, inicial?.unidadeId ?? pedida, 'venda.criar')
  const lojas = escolha.opcoes.filter((u) => !u.ehDeposito)
  const unidadeId =
    inicial?.unidadeId && lojas.some((u) => u.id === inicial.unidadeId)
      ? inicial.unidadeId
      : escolha.unidadeId && lojas.some((u) => u.id === escolha.unidadeId)
        ? escolha.unidadeId
        : (lojas[0]?.id ?? null)
  const unidadeNome = lojas.find((u) => u.id === unidadeId)?.nome ?? ''

  const conf = unidadeId
    ? await comoOrg(sessao.orgId, async (db) => {
        // Uma depois da outra: dentro de comoOrg é uma conexão só.
        const org = await db.org.findUnique({
          where: { id: sessao.orgId },
          select: { vendeSemEstoque: true, creditoMaxParcelas: true, creditoJurosPct: true, valePorLoja: true },
        })
        const loja = await db.unidade.findUnique({ where: { id: unidadeId }, select: { maquininhas: true } })
        return { org, loja }
      })
    : null
  const caixa = unidadeId ? await caixaAberto(sessao, unidadeId) : null
  const crediario = moduloLigado(empresa, 'crediario')
    ? await configCrediario(sessao).then((c) => ({ maxParcelas: c.maxParcelas, diasEntre: c.diasEntre }))
    : null

  const config: ConfigDaTroca | null = unidadeId
    ? {
        slug,
        unidadeId,
        unidadeNome,
        hoje: diaEmSP(),
        precisaPin: !pode(sessao, 'venda.desconto', unidadeId),
        caixaAberto: !!caixa,
        vendeSemEstoque: !!conf?.org?.vendeSemEstoque,
        valePorLoja: !!conf?.org?.valePorLoja,
        maquininhas: lerMaquininhas(conf?.loja?.maquininhas),
        credito: { maxParcelas: conf?.org?.creditoMaxParcelas ?? 1, jurosPct: Number(conf?.org?.creditoJurosPct ?? 0) },
        crediario,
      }
    : null

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/balcao`}
      tema={tema}
      titulo="Troca"
      acao={escolha.mostrarSeletor && lojas.length > 1 && !inicial ? <SeletorUnidade opcoes={lojas} atual={unidadeId} /> : undefined}
    >
      {typeof venda === 'string' && venda && !inicial && (
        <Aviso nivel="atencao">
          Essa venda não pode ser trocada daqui: foi cancelada, é saldo trazido do sistema anterior, ou é de uma loja
          em que você não vende. Procure a compra abaixo, ou use “Não achei a compra”.
        </Aviso>
      )}
      {!config ? (
        <Aviso nivel="atencao">Você não tem acesso de venda em nenhuma loja. Peça para quem responde pela empresa liberar.</Aviso>
      ) : (
        <Troca key={`${unidadeId}-${inicial?.id ?? ''}`} config={config} inicial={inicial} />
      )}
    </Estrutura>
  )
}
