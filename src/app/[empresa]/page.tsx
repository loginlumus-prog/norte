import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { resumoDoPainel } from '@/servidor/painel'
import { resumoCrediario } from '@/servidor/crediario'
import { metasDoMes, mesChave } from '@/servidor/metas'
import { janela, lerPeriodo } from '@/servidor/periodo'
import { moduloLigado } from '@/servidor/modulos'
import { desempenhoDoMes, semDados } from '@/servidor/desempenho'
import { liberado } from '@/servidor/planos'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Aviso, Ponto, cx } from '@/ui/base'
import { Estrelas } from '@/ui/Estrelas'
import { Trancado } from '@/ui/Cadeado'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { SeletorPeriodo } from '@/ui/Periodo'
import { Numero, Barras, Ranque, Secao, brl } from '@/ui/painel'
import { Rosca, BarrasH, Linhas, Calor, BarrasMeses } from '@/ui/Graficos'
import type { Tema } from '@/ui/TrocaTema'

// O painel.
//
// A ordem das seções é a ordem das perguntas de quem abre o sistema de manhã:
// quanto vendi (e foi melhor ou pior?), quando e como vendi, o que vendeu,
// o que está parado ou acabando, quem comprou, quem vendeu. Cada seção tem o
// número grande e, embaixo, o gráfico que explica o número.
//
// O plano Grátis vê o essencial — quanto vendeu, o movimento por dia, o que
// mais vendeu — e vê ONDE está o resto, sem cinza nem cadeado. É o relatório
// simples que a tabela de planos promete, e é a melhor propaganda do de cima.

const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Débito', CREDITO: 'Crédito',
  CREDIARIO: 'Crediário', VALE: 'Vale de troca', TRANSFERENCIA: 'Transferência',
}
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

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

  // A unidade se escolhe pela capacidade de LER relatório, não de vender: o
  // contador lê o painel e não vende em loja nenhuma — com 'venda.ver' ele
  // caía em "sem acesso a nenhuma unidade" logo depois de entrar.
  const onde = await escolherUnidade(sessao, empresa, pedida, 'relatorio.ver')
  const j = janela(lerPeriodo(pedido))
  const temCrediario = moduloLigado(empresa, 'crediario') && pode(sessao, 'crediario.ver')
  const verEquipe = moduloLigado(empresa, 'metas') && pode(sessao, 'equipe.ver')
  const [r, fiado, metas] = await Promise.all([
    resumoDoPainel(sessao, onde.ids, j),
    temCrediario ? resumoCrediario(sessao, onde.ids) : Promise.resolve(null),
    verEquipe ? metasDoMes(sessao, mesChave(new Date())) : Promise.resolve([]),
  ])

  const completo = r.plano !== 'GRATIS'

  // As estrelas do mês reaproveitam as metas já lidas: o painel é a tela que
  // mais consulta o banco, e não vale ler a mesma coisa duas vezes. Fora do
  // Promise.all porque abre o próprio comoOrg depois do das metas.
  const verDesempenho = verEquipe && liberado(r.plano, 'desempenho.basico')
  const desempenho = verDesempenho
    ? await desempenhoDoMes(sessao, mesChave(new Date()), { metas: true, metasProntas: metas })
    : null
  const melhores = desempenho?.pessoas.filter((p) => !semDados(p.nota)).slice(0, 5) ?? []
  const temCartaoMeta = metas.some((m) => m.valor > 0)

  const verDinheiro = pode(sessao, 'financeiro.ver')
  const verEstoque = pode(sessao, 'estoque.ver')

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
    if (i.href === `/${slug}/crediario` && fiado && fiado.parcelasVencidas > 0) {
      return {
        ...i,
        aviso: { quantos: fiado.parcelasVencidas, nivel: 'critico' as const, titulo: 'parcela(s) vencida(s)' },
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

  // ── por hora do dia: só as horas em que a loja vive ──────
  // Somando os dias da semana. Mostra da primeira à última hora com venda,
  // nunca menos que das 8h às 20h — o gráfico de 24 colunas, vinte delas
  // vazias, só diz que a loja fecha à noite.
  const porHoraDia = Array.from({ length: 24 }, (_, h) => r.porHora.reduce((s, dia) => s + (dia[h] ?? 0), 0))
  const horasComVenda = porHoraDia.map((v, h) => (v > 0 ? h : -1)).filter((h) => h >= 0)
  const hIni = Math.min(8, ...horasComVenda)
  const hFim = Math.max(20, ...horasComVenda)
  const horas = Array.from({ length: hFim - hIni + 1 }, (_, i) => hIni + i)
  const semanaOrdem = [1, 2, 3, 4, 5, 6, 0] // segunda primeiro

  const identificadasPct = r.clientes.vendas > 0 ? (r.clientes.identificadas / r.clientes.vendas) * 100 : 0

  const Bloqueado = ({ oQue }: { oQue: string }) => (
    <Cartao>
      <p className="py-4 text-center text-sm text-tinta-2">
        {oQue} faz parte do relatório completo, do plano Balcão para cima.{' '}
        <Link href={`/${slug}/assinatura`} className="font-semibold text-marca underline-offset-2 hover:underline">
          Ver planos
        </Link>
      </p>
    </Cartao>
  )

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
            detalhe={`${r.atual.vendas} venda${r.atual.vendas === 1 ? '' : 's'}${
              r.devolucoes.valor > 0 ? ` · ${brl(r.devolucoes.valor)} devolvidos` : ''
            }`}
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
        {j.temGrafico &&
          (completo ? (
            <Cartao titulo={`Movimento · ${j.rotulo.toLowerCase()} contra ${j.comparacao.replace('vs ', '')}`}>
              <Linhas
                rotulos={r.porDia.map((d) => ddmm(d.dia))}
                series={[
                  { nome: j.rotulo, cor: 'var(--bom-vivo)', valores: r.porDia.map((d) => d.total) },
                  { nome: j.comparacao.replace('vs ', ''), cor: 'var(--tinta-3)', valores: r.porDiaAnterior.map((d) => d.total) },
                ]}
              />
            </Cartao>
          ) : (
            <Cartao titulo={`Movimento · ${j.rotulo.toLowerCase()}`}>
              <Barras dados={r.porDia} titulo="Vendas por dia" />
            </Cartao>
          ))}

        <div className="grid gap-3 lg:grid-cols-2">
          {completo ? (
            <Cartao caixa titulo="Como receberam">
              <Rosca
                fatias={r.porForma.map((f) => ({
                  rotulo: FORMA[f.forma] ?? f.forma,
                  valor: f.total,
                  detalhe: `${f.vendas}×`,
                }))}
              />
            </Cartao>
          ) : (
            <Bloqueado oQue="Como receberam, por forma de pagamento," />
          )}
          {completo ? (
            <Cartao caixa titulo="Por hora do dia">
              <BarrasMeses
                rotulos={horas.map((h) => `${h}h`)}
                series={[{ nome: 'Vendido', cor: 'var(--marca)', valores: horas.map((h) => porHoraDia[h] ?? 0) }]}
                altura={120}
              />
            </Cartao>
          ) : (
            <Bloqueado oQue="O movimento por hora do dia" />
          )}
        </div>

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

      {/* ── QUANDO ── */}
      {completo && j.dias >= 7 && r.atual.vendas > 0 && (
        <Secao
          titulo="Quando a loja vende"
          resumo="Dia da semana contra hora do dia. É o que decide a escala da equipe e o horário de abrir."
        >
          <Cartao caixa>
            <Calor
              linhas={semanaOrdem.map((d) => SEMANA[d]!)}
              colunas={horas.map(String)}
              valores={semanaOrdem.map((d) => horas.map((h) => r.porHora[d]?.[h] ?? 0))}
            />
          </Cartao>
        </Secao>
      )}

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

          {completo ? (
            <Cartao titulo={`Por categoria · ${j.rotulo.toLowerCase()}`}>
              <BarrasH
                itens={r.porCategoria.map((c) => ({
                  rotulo: c.nome,
                  valor: c.total,
                  detalhe: `${c.quantidade.toLocaleString('pt-BR')} un`,
                }))}
              />
            </Cartao>
          ) : (
            <Bloqueado oQue="A venda por categoria" />
          )}
        </div>

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

          <div className="grid gap-3 lg:grid-cols-2">
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

            {verDinheiro &&
              (completo ? (
                <Cartao titulo="Dinheiro parado, por categoria">
                  <BarrasH
                    itens={r.estoquePorCategoria.map((c) => ({ rotulo: c.nome, valor: c.valor }))}
                    cor="var(--atencao-vivo)"
                    vazio="Nada em estoque com custo cadastrado."
                  />
                </Cartao>
              ) : (
                <Bloqueado oQue="O dinheiro parado por categoria" />
              ))}
          </div>
        </Secao>
      )}

      {/* ── FIADO ── */}
      {fiado && (fiado.emAberto > 0 || fiado.vencido > 0) && (
        <Secao titulo="Crediário">
          <div className="grid gap-2 sm:grid-cols-3">
            <Numero rotulo="Em aberto" valor={brl(fiado.emAberto)} detalhe={`${fiado.clientesDevendo} cliente(s)`} />
            <Numero
              rotulo="Vencido"
              valor={brl(fiado.vencido)}
              detalhe={fiado.parcelasVencidas ? `${fiado.parcelasVencidas} parcela(s) · ${fiado.clientesAtrasados} cliente(s)` : 'ninguém atrasado'}
              nivel={fiado.vencido > 0 ? 'critico' : 'bom'}
            />
            <Numero rotulo="Vence em 7 dias" valor={brl(fiado.aVencer7)} detalhe="para lembrar antes" />
          </div>
          <p className="text-xs text-tinta-3">
            Quem deve, quanto e desde quando está em{' '}
            <Link href={`/${slug}/crediario`} className="font-medium text-marca underline-offset-2 hover:underline">
              Crediário
            </Link>
            .
          </p>
        </Secao>
      )}

      {/* ── EQUIPE ── */}
      {verEquipe && (
        <Secao titulo="Equipe">
          <div className={cx('grid gap-3 lg:grid-cols-2', temCartaoMeta && 'xl:grid-cols-3')}>
            <Cartao titulo={`Quem mais vendeu · ${j.rotulo.toLowerCase()}`}>
              <Ranque
                itens={r.porVendedor.map((v) => ({
                  rotulo: v.nome,
                  valor: v.total,
                  detalhe: `${v.vendas} vendas`,
                }))}
              />
            </Cartao>
            {temCartaoMeta && (
              <Cartao
                titulo="Meta do mês"
                acao={
                  <Link href={`/${slug}/equipe`} className="text-xs font-medium text-marca underline-offset-2 hover:underline">
                    metas e comissão
                  </Link>
                }
              >
                <ul className="flex flex-col gap-2">
                  {metas
                    .filter((m) => m.valor > 0)
                    .sort((a, b) => (b.progresso ?? 0) - (a.progresso ?? 0))
                    .map((m) => {
                      const p = m.progresso ?? 0
                      return (
                        <li key={m.usuarioId} className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className="truncate text-tinta">{m.nome}</span>
                            <span className="flex shrink-0 items-baseline gap-2">
                              <span className="numero font-semibold text-tinta">{brl(m.liquido)}</span>
                              <span className="numero text-xs text-tinta-3">de {brl(m.valor)}</span>
                              <span className={'numero text-xs font-semibold ' + (p >= 1 ? 'text-bom' : p >= 0.7 ? 'text-atencao' : 'text-critico')}>
                                {Math.round(p * 100)}%
                              </span>
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-superficie-2">
                            <div
                              className={'h-full rounded-full ' + (p >= 1 ? 'bg-bom-vivo' : p >= 0.7 ? 'bg-atencao-vivo' : 'bg-critico-vivo')}
                              style={{ width: `${Math.min(p, 1) * 100}%` }}
                            />
                          </div>
                        </li>
                      )
                    })}
                </ul>
              </Cartao>
            )}
            <Cartao
              titulo="Desempenho do mês"
              acao={
                <Link href={`/${slug}/equipe`} className="text-xs font-medium text-marca underline-offset-2 hover:underline">
                  ver a equipe
                </Link>
              }
            >
              {verDesempenho ? (
                melhores.length === 0 ? (
                  <p className="py-6 text-center text-sm text-tinta-3">Sem meta, tarefa ou entrada registrada neste mês ainda.</p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {melhores.map((p) => (
                      <li key={p.usuarioId} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-tinta">{p.nome}</span>
                        <Estrelas valor={p.nota.estrelas} tamanho="sm" />
                      </li>
                    ))}
                  </ol>
                )
              ) : (
                // Amostra inventada, nunca dado real: o plano não abre.
                <Trancado
                  chave="desempenho.basico"
                  plano={r.plano}
                  slug={slug}
                  resumo="Uma nota de 0 a 5 por pessoa, todo mês: meta, tarefas no prazo e presença."
                >
                  <ol className="flex flex-col gap-2">
                    {[
                      ['Ana', 4.5],
                      ['Bia', 4],
                      ['Carlos', 3],
                    ].map(([nome, v]) => (
                      <li key={String(nome)} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-tinta">{nome}</span>
                        <Estrelas valor={Number(v)} tamanho="sm" />
                      </li>
                    ))}
                  </ol>
                </Trancado>
              )}
            </Cartao>
          </div>
        </Secao>
      )}

      {/* ── CLIENTES ── */}
      {pode(sessao, 'cliente.ver') && (
        <Secao titulo="Clientes">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Numero rotulo="Cadastrados" valor={String(r.clientes.total)} />
            <Numero rotulo="Novos no período" valor={String(r.clientes.novosNoPeriodo)} nivel={r.clientes.novosNoPeriodo > 0 ? 'bom' : undefined} />
            {completo && (
              <>
                <Numero
                  rotulo="Vendas com cliente"
                  valor={`${identificadasPct.toFixed(0)}%`}
                  detalhe={`${r.clientes.identificadas} de ${r.clientes.vendas}`}
                  nivel={identificadasPct >= 50 ? 'bom' : identificadasPct >= 20 ? 'atencao' : 'critico'}
                />
                <Numero
                  rotulo="Voltaram no período"
                  valor={String(r.clientes.recorrentes)}
                  detalhe={`de ${r.clientes.pessoas} pessoa${r.clientes.pessoas === 1 ? '' : 's'} que compraram`}
                />
              </>
            )}
          </div>
          {completo && identificadasPct < 50 && r.clientes.vendas > 5 && (
            <p className="text-xs text-tinta-3">
              Venda sem cliente escolhido é histórico que não existe. Quanto mais vendas com nome, mais o
              sistema consegue dizer quem sumiu e quem voltou.
            </p>
          )}
        </Secao>
      )}
    </Estrutura>
  )
}
