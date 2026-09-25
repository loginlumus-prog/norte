import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { listarLojas } from '@/servidor/lojas'
import { assinaturaDe } from '@/servidor/assinatura'
import { comoOrg } from '@/servidor/banco'
import { RAMOS, type Ramo } from '@/servidor/modulos'
import { PLANOS } from '@/servidor/planos'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso, Cartao } from '@/ui/base'
import { Secao, Tira } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { CartaoLoja, NovaLoja, type LojaNaTela } from './Loja'
import { palavra } from '@/ui/texto'

// As lojas da empresa.
//
// Abre pelo que a dona quer saber primeiro — quantas tem e quantas o plano
// comporta — e depois as lojas, uma por cartão. Abrir loja nova fica no fim, e
// quando a cota acabou ele não some: diz o limite e aponta para a Assinatura.
// Botão que some sem explicação ensina que o sistema é menor do que é.

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
  const limite = assinatura.limite.unidades
  const cabe = limite === null || ativas < limite
  const plano = PLANOS[assinatura.plano]

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
        {limite === null
          ? `O plano ${plano.titulo} não tem limite de lojas.`
          : `O plano ${plano.titulo} comporta ${limite === 1 ? '1 loja' : `até ${limite} lojas`} abertas — você tem ${ativas}.`}{' '}
        Cada loja tem o próprio estoque, o próprio caixa e o próprio balcão. O que cada uma vende
        se escolhe na ficha do produto, em &ldquo;Vendido em&rdquo;.
      </p>

      <Secao titulo="Suas lojas">
        <div className="grid gap-4 xl:grid-cols-2">
          {naTela.map((l) => (
            <CartaoLoja key={l.id} slug={slug} loja={l} ramos={ramos} ramoDaEmpresa={org.ramo} />
          ))}
        </div>
      </Secao>

      <Secao titulo="Abrir outra loja">
        {cabe ? (
          <Cartao caixa>
            <NovaLoja slug={slug} ramos={ramos} ramoDaEmpresa={org.ramo} />
          </Cartao>
        ) : (
          <Aviso nivel="atencao">
            O plano {plano.titulo} já está com todas as lojas que comporta. Para abrir mais uma,
            troque de plano em{' '}
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
