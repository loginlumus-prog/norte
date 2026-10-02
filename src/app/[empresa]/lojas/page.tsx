import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { listarLojas } from '@/servidor/lojas'
import { assinaturaDe } from '@/servidor/assinatura'
import { comoOrg } from '@/servidor/banco'
import { RAMOS, type Ramo } from '@/servidor/modulos'
import { PLANOS, podeCriarUnidade } from '@/servidor/planos'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso, Cartao } from '@/ui/base'
import { Secao, Tira } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { CartaoLoja, NovaLoja, type LojaNaTela } from './Loja'
import { palavra } from '@/ui/texto'

export const metadata: Metadata = { title: 'Lojas' }

// As lojas da empresa.
//
// Abre pelo que a dona quer saber primeiro — quantas tem e quanto isso custa —
// e depois as lojas, uma por cartão. Abrir loja nova fica no fim, e quando o
// plano não comporta mais uma ele não some: diz o limite e aponta para a
// Assinatura. Botão que some sem explicação ensina que o sistema é menor do
// que é.
//
// ── o preço da loja a mais, ANTES de abrir ───────────────────
// Desde a tabela de 02/10/2026 o Norte não tem teto de lojas: cada loja a
// mais soma ao mês (`PRECOS.lojaExtra`). A regra de ouro de `planos.ts` vale
// aqui ao pé da letra — o valor e a conta nova aparecem junto do botão de
// abrir e de reabrir, nunca só na fatura. Depósito não vende e não entra na
// conta (`lojas.ts`, `travarCota`).

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)

export default async function TelaLojas({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'empresa.configurar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const lojas = await listarLojas(sessao)
  const assinatura = await assinaturaDe(sessao)
  const org = await comoOrg(sessao.orgId, (db) =>
    db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { ramo: true } }),
  )

  const ramos = (Object.keys(RAMOS) as Ramo[]).map((r) => ({ valor: r, titulo: RAMOS[r].titulo }))
  const tituloDoRamo = (r: string | null) => (r && r in RAMOS ? RAMOS[r as Ramo].titulo : null)

  const naTela: LojaNaTela[] = lojas.map((l) => ({ ...l, ramoTitulo: tituloDoRamo(l.ramo) }))
  const ativas = naTela.filter((l) => l.ativa).length
  const plano = PLANOS[assinatura.plano]
  // A conta usa as lojas de VENDA abertas (`assinatura.uso`), sem depósito.
  const deVenda = assinatura.uso.unidades
  const veredito = podeCriarUnidade(assinatura.plano, deVenda)
  const emTeste = assinatura.situacao === 'TESTE'
  const deContrato = !plano.aVenda && assinatura.plano !== 'GRATIS'

  // A frase que vai junto do botão de abrir (e do de reabrir): quanto soma e
  // como fica a conta. Em teste nada é cobrado; no contrato, é a tabela.
  const custo =
    veredito.pode && veredito.custoExtra > 0
      ? `Uma loja de venda a mais soma ${brl(veredito.custoExtra)} por mês` +
        ('novoTotal' in veredito ? ` — a conta${deContrato ? ' da tabela' : ''} passa a ${brl(veredito.novoTotal)}` : '') +
        (emTeste ? '. Durante o teste, nada é cobrado' : '') +
        '. Depósito não entra na conta.'
      : null

  const sobreAConta =
    plano.unidades === null
      ? `O plano ${plano.titulo} não tem limite de lojas.`
      : plano.porUnidadeExtra !== null
        ? `No ${plano.titulo}, a primeira loja vem no plano e cada loja a mais soma ${brl(plano.porUnidadeExtra)} por mês` +
          (assinatura.mensal.total !== null
            ? ` — hoje ${deVenda === 1 ? '1 loja de venda' : `${deVenda} lojas de venda`}, ${brl(assinatura.mensal.total)} por mês${deContrato ? ' pela tabela' : ''}.`
            : '.') +
          ' Depósito não entra na conta.'
        : `O plano ${plano.titulo} comporta ${plano.unidades === 1 ? '1 loja aberta' : `até ${plano.unidades} lojas abertas`} — você tem ${ativas}.`

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/lojas`}
      tema={tema}
      titulo="Lojas"
    >
      <Tira
        itens={[
          { rotulo: ativas === 1 ? 'loja aberta' : 'lojas abertas', quantos: ativas, nivel: 'bom' },
          { rotulo: palavra(naTela.length - ativas, 'fechada', 'fechadas'), quantos: naTela.length - ativas, nivel: 'neutro' },
        ]}
      />

      <p className="max-w-2xl text-sm leading-relaxed text-tinta-2">
        {sobreAConta} Cada loja tem o próprio estoque, o próprio caixa e o próprio balcão. O que cada uma vende
        se escolhe na ficha do produto, em &ldquo;Vendido em&rdquo;.
      </p>

      <Secao titulo="Suas lojas">
        <div className="grid gap-4 xl:grid-cols-2">
          {naTela.map((l) => (
            <CartaoLoja
              key={l.id}
              slug={slug}
              loja={l}
              ramos={ramos}
              ramoDaEmpresa={org.ramo}
              // Reabrir loja de venda ocupa lugar na conta, igual abrir.
              custoAoReabrir={!l.ehDeposito ? custo : null}
            />
          ))}
        </div>
      </Secao>

      <Secao titulo="Abrir outra loja">
        {veredito.pode ? (
          <Cartao caixa>
            <NovaLoja slug={slug} ramos={ramos} ramoDaEmpresa={org.ramo} custo={custo} />
          </Cartao>
        ) : (
          <Aviso nivel="atencao">
            O plano {plano.titulo} já está com todas as lojas que comporta. Para abrir mais uma,
            assine o {PLANOS[veredito.sugestao].titulo} em{' '}
            <Link href={`/${slug}/assinatura`} className="font-semibold underline underline-offset-2">
              Assinatura
            </Link>{' '}
            — ou feche uma loja que não usa mais.
          </Aviso>
        )}
      </Secao>
    </Estrutura>
  )
}
