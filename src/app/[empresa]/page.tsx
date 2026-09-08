import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { resumoDoPainel } from '@/servidor/painel'
import { janela, lerPeriodo } from '@/servidor/periodo'
import { moduloLigado } from '@/servidor/modulos'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Aviso, Ponto } from '@/ui/base'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { SeletorPeriodo } from '@/ui/Periodo'
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
  searchParams: Promise<{ unidade?: string; periodo?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, periodo: pedido } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // Quem nao pode ler o resultado do mes nao para nesta tela: vai para onde
  // trabalha. Sem isto, o balconista entra e cai num 'nao encontrado' logo
  // depois do login, que parece defeito e nao regra.
  if (!pode(sessao, 'relatorio.ver')) {
    if (pode(sessao, 'venda.criar')) redirect(`/${slug}/balcao`)
    notFound()
  }

  const onde = await escolherUnidade(sessao, empresa, pedida)
  const j = janela(lerPeriodo(pedido))
  const r = await resumoDoPainel(sessao, onde.ids, j)

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

  // A comparação é sempre contra a janela do MESMO tamanho logo antes: é o
  // que faz a seta querer dizer alguma coisa. Quando não houve movimento
  // antes, não existe porcentagem — e mostrar "+∞%" seria pior que não
  // mostrar nada.
  const pct =
    r.anterior.total > 0 ? ((r.atual.total - r.anterior.total) / r.anterior.total) * 100 : NaN
  const margem = r.atual.total > 0 ? ((r.atual.total - r.atual.custo) / r.atual.total) * 100 : 0

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menu}
      ativo={`/${slug}`}
      tema={tema}
      titulo="Painel"
      acao={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SeletorPeriodo atual={j.chave} />
          {onde.mostrarSeletor && (
            <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />
          )}
        </div>
      }
    >
      {onde.opcoes.length === 0 && (
        <Aviso nivel="atencao">
          Você ainda não tem acesso a nenhuma unidade. Peça para quem responde pela empresa
          liberar o seu acesso.
        </Aviso>
      )}

      {/* ── VENDAS ── */}
      <Secao titulo={`${j.rotulo} · ${onde.titulo}`}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {/* O total do periodo e o numero que a pessoa abre o sistema para
              ver. Os outros tres sao apoio — sem essa diferenca, a faixa de
              fichas vira fileira e o olho nao sabe onde pousar. */}
          <Numero
            principal
            rotulo={j.rotulo}
            valor={brl(r.atual.total)}
            detalhe={`${r.atual.vendas} venda${r.atual.vendas === 1 ? '' : 's'}`}
            comparacao={{ pct, contra: j.comparacao }}
          />
          <Numero
            rotulo="Média por dia"
            valor={brl(r.atual.total / j.dias)}
            detalhe={`em ${j.dias} dia${j.dias === 1 ? '' : 's'}`}
            nivel="bom"
          />
          <Numero rotulo="Ticket médio" valor={brl(r.atual.ticket)} detalhe="por venda" />
          {verDinheiro && (
            <Numero
              rotulo="Margem"
              valor={`${margem.toFixed(0)}%`}
              detalhe={`${brl(r.atual.total - r.atual.custo)} sobre o custo`}
              nivel={margem >= 40 ? 'bom' : margem >= 20 ? 'atencao' : 'critico'}
            />
          )}
        </div>

        {/* Um dia so nao vira grafico de dias: seria uma barra sozinha. */}
        {j.temGrafico && (
          <Cartao titulo={`Movimento · ${j.rotulo.toLowerCase()}`}>
            <Barras dados={r.porDia} titulo="Vendas por dia" />
          </Cartao>
        )}

        {onde.mostrarSeletor && onde.unidadeId === null && (
          <Cartao titulo={`Por unidade · ${j.rotulo.toLowerCase()}`}>
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
          <Cartao titulo={`Mais vendidos · ${j.rotulo.toLowerCase()}`}>
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
            <Numero rotulo="Novos este mês" valor={String(r.clientes.novosNoPeriodo)} />
          </div>
        </Secao>
      )}
    </Estrutura>
  )
}
