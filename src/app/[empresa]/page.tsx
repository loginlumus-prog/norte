import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { resumoDoPainel } from '@/servidor/painel'
import { moduloLigado } from '@/servidor/modulos'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Aviso, Ponto } from '@/ui/base'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Numero, Barras, Ranque, Secao, brl } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Débito', CREDITO: 'Crédito',
  CREDIARIO: 'Crediário', VALE: 'Vale', TRANSFERENCIA: 'Transferência',
}

export default async function Painel({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const onde = await escolherUnidade(sessao, empresa, pedida)
  const r = await resumoDoPainel(sessao, onde.ids)

  const verDinheiro = pode(sessao, 'financeiro.ver')
  const verEstoque = pode(sessao, 'estoque.ver')
  const verEquipe = moduloLigado(empresa, 'metas') && pode(sessao, 'equipe.ver')

  // O menu avisa ANTES de a pessoa clicar. É a diferença entre descobrir que
  // acabou o estoque porque foi olhar, e ser avisado assim que entra.
  const acabou = r.acabando.filter((a) => a.saldo <= 0).length
  const menu = MENU(slug).map((i) => {
    if (i.href === `/${slug}/estoque` && r.acabando.length > 0) {
      return {
        ...i,
        aviso: {
          quantos: r.acabando.length,
          nivel: acabou > 0 ? ('critico' as const) : ('atencao' as const),
          titulo: acabou > 0 ? 'item(ns) acabado(s)' : 'abaixo do mínimo',
        },
      }
    }
    if (i.href === `/${slug}/produtos` && r.parados.length > 0) {
      return {
        ...i,
        aviso: { quantos: r.parados.length, nivel: 'atencao' as const, titulo: 'parado(s)' },
      }
    }
    return i
  })

  // Comparação com ontem, que é a pergunta que o dono faz de manhã.
  const pct = r.ontem.total > 0 ? ((r.hoje.total - r.ontem.total) / r.ontem.total) * 100 : NaN
  const margem = r.mes.total > 0 ? ((r.mes.total - r.mes.custo) / r.mes.total) * 100 : 0

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menu}
      ativo={`/${slug}`}
      tema={tema}
      titulo="Painel"
      acao={
        onde.mostrarSeletor ? (
          <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />
        ) : undefined
      }
    >
      {onde.opcoes.length === 0 && (
        <Aviso nivel="atencao">
          Você ainda não tem acesso a nenhuma unidade. Peça para quem responde pela empresa
          liberar o seu acesso.
        </Aviso>
      )}

      {/* ── VENDAS ── */}
      <Secao titulo={`Vendas · ${onde.titulo}`}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            rotulo="Hoje"
            valor={brl(r.hoje.total)}
            detalhe={`${r.hoje.vendas} venda${r.hoje.vendas === 1 ? '' : 's'}`}
            comparacao={{ pct, contra: 'vs ontem' }}
          />
          <Numero
            rotulo="Este mês"
            valor={brl(r.mes.total)}
            detalhe={`${r.mes.vendas} vendas`}
            nivel="bom"
          />
          <Numero
            rotulo="Ticket médio do mês"
            valor={brl(r.mes.ticket)}
            detalhe="por venda"
          />
          {verDinheiro && (
            <Numero
              rotulo="Margem do mês"
              valor={`${margem.toFixed(0)}%`}
              detalhe={`${brl(r.mes.total - r.mes.custo)} sobre o custo`}
              nivel={margem >= 40 ? 'bom' : margem >= 20 ? 'atencao' : 'critico'}
            />
          )}
        </div>

        <Cartao titulo="Últimos 30 dias">
          <Barras dados={r.porDia} titulo="Vendas por dia" />
        </Cartao>

        {onde.mostrarSeletor && onde.unidadeId === null && (
          <Cartao titulo="Por unidade, no mês">
            <Ranque
              itens={r.porUnidade.map((u) => ({
                rotulo: u.nome,
                valor: u.total,
                detalhe: `${u.vendas} vendas`,
              }))}
            />
          </Cartao>
        )}
      </Secao>

      {/* ── PRODUTOS ── */}
      <Secao titulo="Produtos">
        <div className="grid gap-3 lg:grid-cols-2">
          <Cartao titulo="Mais vendidos no mês">
            <Ranque
              itens={r.maisVendidos.map((i) => ({
                rotulo: i.descricao,
                valor: i.total,
                detalhe: `${i.quantidade.toLocaleString('pt-BR')} un`,
              }))}
            />
          </Cartao>

          <Cartao
            titulo="Parados há mais de 30 dias"
            acao={r.parados.length > 0 ? <Ponto nivel="atencao" quantos={r.parados.length} titulo="parados" /> : undefined}
          >
            {r.parados.length === 0 ? (
              <p className="flex items-center justify-center gap-2 py-6 text-center text-sm font-medium text-bom">
                <span aria-hidden className="size-2 rounded-full bg-bom-vivo" />
                Tudo girou no último mês.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {r.parados.map((p) => (
                  <li key={p.descricao} className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm text-tinta">{p.descricao}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="numero text-sm text-tinta-2">{p.saldo} un</span>
                      <Situacao nivel="atencao">
                        {p.desde == null ? 'nunca vendeu' : `${p.desde}d`}
                      </Situacao>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </div>
      </Secao>

      {/* ── ESTOQUE ── */}
      {verEstoque && (
        <Secao titulo="Estoque">
          <div className="grid gap-2 sm:grid-cols-3">
            <Numero rotulo="Itens diferentes" valor={String(r.estoque.itens)} detalhe="com saldo" />
            <Numero
              rotulo="Peças em estoque"
              valor={r.estoque.unidades.toLocaleString('pt-BR')}
            />
            {verDinheiro && (
              <Numero
                rotulo="Dinheiro parado"
                valor={brl(r.estoque.valorCusto)}
                detalhe="a preço de custo"
                nivel="atencao"
              />
            )}
          </div>

          <Cartao
            titulo="Acabando"
            acao={
              r.acabando.length > 0 ? (
                <Ponto nivel={acabou > 0 ? 'critico' : 'atencao'} quantos={r.acabando.length} titulo="itens" />
              ) : undefined
            }
          >
            {r.acabando.length === 0 ? (
              <p className="flex items-center justify-center gap-2 py-6 text-center text-sm font-medium text-bom">
                <span aria-hidden className="size-2 rounded-full bg-bom-vivo" />
                Nada abaixo do mínimo.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {r.acabando.map((a) => (
                  <li key={a.descricao} className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm text-tinta">{a.descricao}</span>
                    <Situacao nivel={a.saldo <= 0 ? 'critico' : 'atencao'}>
                      {a.saldo <= 0 ? 'acabou' : `${a.saldo} de ${a.minimo}`}
                    </Situacao>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        </Secao>
      )}

      {/* ── FINANCEIRO ── */}
      {verDinheiro && (
        <Secao titulo="Financeiro">
          <Cartao titulo="Como receberam, no mês">
            <Ranque
              itens={r.porForma.map((f) => ({
                rotulo: FORMA[f.forma] ?? f.forma,
                valor: f.total,
                detalhe: `${f.vendas}×`,
              }))}
            />
          </Cartao>
        </Secao>
      )}

      {/* ── EQUIPE ── */}
      {verEquipe && (
        <Secao titulo="Equipe">
          <Cartao titulo="Quem mais vendeu no mês">
            <Ranque
              itens={r.porVendedor.map((v) => ({
                rotulo: v.nome,
                valor: v.total,
                detalhe: `${v.vendas} vendas`,
              }))}
            />
          </Cartao>
        </Secao>
      )}

      {/* ── CLIENTES ── */}
      {pode(sessao, 'cliente.ver') && (
        <Secao titulo="Clientes">
          <div className="grid gap-2 sm:grid-cols-2">
            <Numero rotulo="Cadastrados" valor={String(r.clientes.total)} />
            <Numero rotulo="Novos este mês" valor={String(r.clientes.novosNoMes)} />
          </div>
        </Secao>
      )}
    </Estrutura>
  )
}
