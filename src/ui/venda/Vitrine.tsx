// A vitrine do topo: o painel do Norte, grande, logo abaixo da promessa.
//
// ── por que o produto, e não uma cena ────────────────────────
// A página antiga abria com um desenho de loja num fundo azul-noite. Bonito,
// e dizia pouco: quem chega quer saber "o que é isto" e o desenho respondia
// "é sobre lojas". O padrão das ferramentas que o dono citou é mostrar o
// PRODUTO logo no topo, grande o bastante para ser lido — e aqui ele é lido:
// o total do dia, o movimento por hora, o que está acabando, a meta.
//
// ── HTML, e não captura ──────────────────────────────────────
// Captura envelhece na primeira mudança de cor, sai borrada em tela de
// retina e ignora o tema. Montado com as mesmas peças da interface (pílula,
// avatar, barra), ele acompanha o claro e o escuro e anima de graça. Os
// números são de exemplo — de loja nenhuma.
//
// ── os três cartões por cima ─────────────────────────────────
// Cada um é uma das três coisas que acontecem o dia inteiro fora do painel e
// que o painel resume: a venda fechando no balcão, o assistente propondo a
// reposição, e a tarefa da equipe virando "Feito". Eles sangram pela borda
// da janela de propósito — é o que diz que o sistema é maior que a tela.
//
// ── o movimento ──────────────────────────────────────────────
// Uma vez só, em cascata: a janela sobe, as colunas do gráfico crescem, a
// linha do dia se desenha, e os cartões encaixam um depois do outro. O único
// movimento que continua depois disso é CONTEÚDO: a tarefa que estava "Em
// andamento" vira "Feito" — é a equipe dando baixa, não enfeite. Nenhum laço.
//
// Nada nasce invisível: o servidor manda tudo no estado final, e a animação
// só existe enquanto roda (ver `AoEntrar`). Quem pediu menos movimento vê o
// quadro parado e completo.
//
// ── acessibilidade ───────────────────────────────────────────
// A composição inteira é UMA imagem para o leitor de tela (`role="img"` com
// a descrição). Anunciar os 60 pedaços de texto de uma amostra seria ruído —
// e o que a amostra diz está escrito de verdade nas seções de baixo.

import { AoEntrar } from '../AoEntrar'
import { ContaReais } from './ContaReais'
import { Simbolo } from '../Marca'
import { Avatar, Barra, Pilula, Rotulo, reais } from './Pecas'

// O movimento por hora, das 8h às 19h. A hora "de agora" é a última cheia.
const HORAS = [18, 26, 34, 52, 71, 60, 44, 48, 63, 82, 94, 58]
const HORA_INICIAL = 8

// A linha dos últimos 7 dias, em % da altura. Desenhada uma vez.
const SEMANA = [42, 55, 48, 62, 58, 74, 81]

const MENU_LATERAL: { grupo?: string; itens: { nome: string; ativo?: boolean; aviso?: number }[] }[] = [
  { itens: [{ nome: 'Painel', ativo: true }] },
  { grupo: 'Vender', itens: [{ nome: 'Balcão' }, { nome: 'Vendas' }, { nome: 'Caixa' }] },
  { grupo: 'Catálogo', itens: [{ nome: 'Produtos' }, { nome: 'Estoque', aviso: 3 }, { nome: 'Preços' }] },
  { grupo: 'Pessoas', itens: [{ nome: 'Clientes' }, { nome: 'Equipe' }, { nome: 'Tarefas' }] },
  { grupo: 'Dinheiro', itens: [{ nome: 'Financeiro' }, { nome: 'Análise' }] },
]

const ACABANDO: { nome: string; tem: string; tom: 'critico' | 'atencao'; quando: string }[] = [
  { nome: 'Camiseta canelada · Preto · G', tem: '2 un', tom: 'atencao', quando: 'acaba quinta' },
  { nome: 'Tênis casual · 38', tem: '1 par', tom: 'atencao', quando: 'no mínimo' },
  { nome: 'Sandália rasteira · 36', tem: '0', tom: 'critico', quando: 'acabou' },
]

const META: { quem: string; iniciais: string; pct: number }[] = [
  { quem: 'Marina', iniciais: 'MC', pct: 86 },
  { quem: 'João', iniciais: 'JP', pct: 64 },
  { quem: 'Rafaela', iniciais: 'RA', pct: 47 },
]

export function Vitrine() {
  const maior = Math.max(...HORAS)
  const linha = SEMANA.map((v, i) => `${(i / (SEMANA.length - 1)) * 100},${100 - v}`).join(' ')

  return (
    <AoEntrar className="relative mx-auto w-full max-w-6xl">
      <div
        role="img"
        aria-label="O painel do Norte: o total vendido hoje, o movimento por hora, o que está acabando e a meta da equipe — com uma venda fechando no balcão, o assistente propondo uma reposição e uma tarefa da equipe virando Feito."
        className="relative pb-24 sm:pb-16 md:pb-10"
      >
        {/* ── a janela ── */}
        <div className="surge overflow-hidden rounded-2xl border border-borda bg-superficie shadow-[var(--sombra-vitrine)]">
          {/* A barra fina de cima: a busca e a loja, como no sistema. */}
          <div className="flex items-center gap-3 border-b border-borda-suave px-4 py-2.5">
            <Simbolo tamanho={20} id="vitrine-sol" />
            <span className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md bg-superficie-2 px-2.5 text-[11.5px] text-tinta-3 sm:max-w-xs">
              <span className="truncate">Buscar produto, cliente ou venda…</span>
            </span>
            <span className="ml-auto hidden items-center gap-1.5 rounded-md border border-borda px-2 py-1 text-[11.5px] font-semibold text-tinta sm:flex">
              Loja Centro
              <span className="text-tinta-3">▾</span>
            </span>
            <Avatar iniciais="MC" className="size-7" />
          </div>

          <div className="grid md:grid-cols-[12.5rem_minmax(0,1fr)]">
            {/* ── a barra lateral branca ── */}
            <aside className="hidden flex-col gap-3 border-r border-borda-suave bg-superficie px-3 py-4 md:flex">
              {MENU_LATERAL.map((b, k) => (
                <div key={k} className="flex flex-col gap-0.5">
                  {b.grupo && (
                    <span className="px-2 pb-0.5 text-[9.5px] font-bold tracking-[0.14em] text-tinta-3 uppercase">
                      {b.grupo}
                    </span>
                  )}
                  {b.itens.map((i) => (
                    <span
                      key={i.nome}
                      className={
                        'flex items-center justify-between rounded-md px-2 py-1 text-[12.5px] ' +
                        (i.ativo ? 'bg-marca-suave font-semibold text-marca' : 'text-tinta-2')
                      }
                    >
                      {i.nome}
                      {i.aviso && (
                        <span className="grid size-4 place-items-center rounded-full bg-atencao-fundo text-[9px] font-bold text-atencao">
                          {i.aviso}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              ))}
            </aside>

            {/* ── o painel ── */}
            <div className="flex min-w-0 flex-col gap-4 bg-fundo p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="text-[11px] text-tinta-3">quinta-feira, 24 de setembro</p>
                  <p className="font-display text-lg font-bold tracking-tight text-titulo">
                    Bom dia, Marina
                  </p>
                </div>
                <span className="flex gap-1 rounded-lg bg-superficie p-0.5 text-[11px] font-semibold shadow-norte">
                  <span className="rounded-md bg-tinta px-2 py-0.5 text-superficie">Hoje</span>
                  <span className="px-2 py-0.5 text-tinta-3">7 dias</span>
                  <span className="hidden px-2 py-0.5 text-tinta-3 sm:inline">30 dias</span>
                  <span className="hidden px-2 py-0.5 text-tinta-3 sm:inline">Este mês</span>
                </span>
              </div>

              {/* Os quatro números do dia. */}
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
                <Numero rotulo="Vendido hoje" destaque>
                  <ContaReais ate={4382.9} duracao={600} className="numero" />
                  <span className="mt-1 block text-[10.5px] font-semibold text-bom">
                    ▲ 12% sobre ontem
                  </span>
                </Numero>
                <Numero rotulo="Ticket médio">
                  <span className="numero">{reais(146.1)}</span>
                  <span className="mt-1 block text-[10.5px] text-tinta-3">30 vendas</span>
                </Numero>
                <Numero rotulo="Margem">
                  <span className="numero">43,2%</span>
                  <span className="mt-1 block text-[10.5px] text-tinta-3">sobre o custo do dia</span>
                </Numero>
                <Numero rotulo="Com cliente">
                  <span className="numero">68%</span>
                  <span className="mt-1 block text-[10.5px] text-tinta-3">das vendas</span>
                </Numero>
              </div>

              <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                {/* O movimento por hora: as colunas crescem de baixo, uma
                    depois da outra, e a linha da semana se desenha por cima. */}
                <div className="rounded-xl bg-superficie p-3.5 shadow-norte">
                  <div className="flex items-baseline justify-between">
                    <Rotulo>Movimento por hora</Rotulo>
                    <span className="flex items-center gap-3 text-[10px] text-tinta-3">
                      <span className="flex items-center gap-1">
                        <i className="size-2 rounded-sm bg-marca" /> hoje
                      </span>
                      <span className="flex items-center gap-1">
                        <i className="h-0.5 w-3 rounded bg-sol" /> semana
                      </span>
                    </span>
                  </div>
                  <div className="relative mt-3 h-28 sm:h-32">
                    <div className="absolute inset-0 flex items-end gap-[5%] sm:gap-[4%]">
                      {HORAS.map((h, i) => (
                        <span
                          key={i}
                          className={
                            'sobe flex-1 rounded-t-[4px] ' +
                            (i === HORAS.length - 1 ? 'bg-marca/45' : 'bg-marca')
                          }
                          style={{ height: `${(h / maior) * 100}%`, animationDelay: `${0.25 + i * 0.04}s` }}
                        />
                      ))}
                    </div>
                    {/* A linha se revela da esquerda por recorte, e não por
                        traço tracejado: com a caixa esticada
                        (`preserveAspectRatio="none"`) o traço precisa de
                        `non-scaling-stroke`, e aí o comprimento do tracejado
                        deixa de bater com o da linha. */}
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      className="revela pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                      style={{ animationDelay: '0.75s' }}
                    >
                      <polyline
                        points={linha}
                        fill="none"
                        stroke="var(--sol)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  </div>
                  <div className="mt-1.5 flex justify-between text-[9.5px] text-tinta-3">
                    <span>{HORA_INICIAL}h</span>
                    <span>{HORA_INICIAL + 4}h</span>
                    <span>{HORA_INICIAL + 8}h</span>
                    <span>agora</span>
                  </div>
                </div>

                {/* O que precisa de você: acabando e a meta. Some no celular
                    — a vitrine ali é o número e o gráfico. */}
                <div className="hidden flex-col gap-2.5 sm:flex">
                  <div className="rounded-xl bg-superficie p-3.5 shadow-norte">
                    <Rotulo>Acabando</Rotulo>
                    <ul className="mt-2 flex flex-col">
                      {ACABANDO.map((a) => (
                        <li
                          key={a.nome}
                          className="flex items-center justify-between gap-2 border-t border-borda-suave py-1.5 first:border-t-0"
                        >
                          <span className="min-w-0 truncate text-[11.5px] text-tinta">{a.nome}</span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="numero text-[11px] font-semibold text-tinta-2">{a.tem}</span>
                            <Pilula tom={a.tom} className="!text-[10px]">
                              {a.quando}
                            </Pilula>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl bg-superficie p-3.5 shadow-norte">
                    <Rotulo>Meta do mês</Rotulo>
                    <ul className="mt-2 flex flex-col gap-2">
                      {META.map((m, i) => (
                        <li key={m.quem} className="flex items-center gap-2">
                          <Avatar iniciais={m.iniciais} className="size-5 text-[8px]" />
                          <Barra valor={m.pct} tom={m.pct >= 80 ? 'bom' : 'marca'} atraso={0.5 + i * 0.08} className="flex-1" />
                          <span className="numero w-8 text-right text-[10.5px] font-semibold text-tinta-2">
                            {m.pct}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── os cartões por cima ── */}

        {/* A venda fechando no balcão: à esquerda, sangrando. */}
        <div
          className="encaixa absolute top-[38%] -left-3 hidden w-60 rounded-xl border border-borda bg-superficie p-3.5 shadow-norte-alta md:block lg:-left-10"
          style={{ animationDelay: '0.55s' }}
        >
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-full bg-bom-fundo text-bom">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5 L10 17.5 L19 7.5" />
              </svg>
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[12px] font-bold text-tinta">Venda fechada</span>
              <span className="text-[10.5px] text-tinta-3">nº 1.284 · Balcão · agora</span>
            </span>
          </div>
          <div className="mt-3 flex items-end justify-between border-t border-borda-suave pt-2.5">
            <span className="flex flex-col text-[10.5px] text-tinta-3">
              3 itens · Pix + dinheiro
              <span className="font-semibold text-bom">troco {reais(10.3)}</span>
            </span>
            <span className="numero font-display text-xl font-bold text-titulo">{reais(189.7)}</span>
          </div>
        </div>

        {/* O assistente propondo a reposição: à direita, no alto. No celular
            ele desce e encaixa embaixo da janela. */}
        <div
          className="encaixa absolute right-3 bottom-0 left-3 rounded-xl border border-borda bg-superficie p-3.5 shadow-norte-alta sm:left-auto sm:w-80 md:top-[12%] md:right-4 md:bottom-auto lg:-right-12"
          style={{ animationDelay: '0.75s' }}
        >
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-full bg-bom-vivo text-[11px] font-bold text-white">
              A
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[12px] font-bold text-tinta">Aurora · assistente</span>
              <span className="text-[10.5px] text-tinta-3">proposta · espera o seu sim</span>
            </span>
          </div>
          <p className="mt-2.5 text-[12.5px] leading-snug text-tinta">
            A Camiseta canelada Preto · G acaba quinta. Peço <b>20 un.</b> ao fornecedor por{' '}
            <b className="numero">{reais(448)}</b>?
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="rounded-md border border-borda px-3 py-1 text-[11.5px] font-semibold text-tinta-2">
              Não
            </span>
            <span className="rounded-md bg-marca px-3 py-1 text-[11.5px] font-semibold text-marca-tinta">
              Confirmar
            </span>
            <span className="ml-auto text-[10px] text-tinta-3">dentro do teto</span>
          </div>
        </div>

        {/* A tarefa virando "Feito": embaixo, sangrando pela borda de baixo. */}
        <div
          className="encaixa absolute -bottom-2 left-6 hidden w-72 rounded-xl border border-borda bg-superficie p-3 shadow-norte-alta sm:block md:right-[22%] md:left-auto lg:-bottom-6"
          style={{ animationDelay: '0.95s' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-[0.12em] text-marca uppercase">
              Quadro · esta semana
            </span>
            <Avatar iniciais="JP" />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-[12.5px] font-semibold text-tinta">
              Montar a vitrine de primavera
            </span>
            {/* A troca de situação é o conteúdo, e acontece uma vez: o
                "Em andamento" sai e o "Feito" entra. Parado, sem animação,
                fica só o "Feito" — o estado final. */}
            <span className="vira shrink-0" style={{ '--vira': '1.9s' } as React.CSSProperties}>
              <Pilula tom="atencao" className="vira-antes">
                Em andamento
              </Pilula>
              <Pilula tom="bom" className="vira-depois justify-self-end">
                Feito
              </Pilula>
            </span>
          </div>
        </div>
      </div>
    </AoEntrar>
  )
}

function Numero({
  rotulo,
  destaque,
  children,
}: {
  rotulo: string
  destaque?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl bg-superficie p-3 shadow-norte">
      <Rotulo>{rotulo}</Rotulo>
      <p
        className={
          'mt-1.5 font-display leading-none font-bold tracking-tight text-titulo ' +
          (destaque ? 'text-[1.35rem] sm:text-2xl' : 'text-lg sm:text-xl')
        }
      >
        {children}
      </p>
    </div>
  )
}
