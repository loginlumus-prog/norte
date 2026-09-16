// O quadro da equipe, desenhado em HTML.
//
// ── por que HTML, e não captura de tela ──────────────────────
// A mesma regra dos banners: captura envelhece na primeira mudança de cor,
// sai borrada em tela de retina e ignora o tema. Desenhado com as peças da
// interface — pílula de situação, avatar, barra, estrela — ele é nítido em
// qualquer densidade, acompanha o claro e o escuro, e anima de graça.
//
// ── sem moldura de janela ────────────────────────────────────
// A primeira ideia era pôr o quadro dentro de uma "janela" com barra de
// título e três bolinhas. É caixa dentro de caixa, e parece print colado num
// slide — a coisa que a página inteira evita. Aqui as linhas pousam direto no
// papel da seção: o único traço que separa "quadro" de "lista" é o fio
// colorido na esquerda de cada linha, que é a cor do grupo.
//
// ── a sangria, e o que ela NÃO pode cortar ───────────────────
// Em `lg` o quadro passa 40px da coluna, como a última bolha da conversa do
// assistente: é o que rompe a grade e diz que a tabela continua. Mas a
// conversa ensinou uma coisa — sangria que come conteúdo é defeito, não
// efeito. Entre 1024 e 1232px a coluna encosta na borda da tela e o corte
// acontece de verdade; por isso toda linha guarda `lg:pr-5` do lado direito,
// e o que a tela corta é só o respiro, nunca a estrela da prioridade.
//
// ── o movimento ──────────────────────────────────────────────
// As linhas entram uma a uma e, 200ms depois de cada uma pousar, a barra da
// linha do tempo cresce. Não é `cascata`: ela conhece oito filhos e o quadro
// tem dez linhas em dois grupos. Cada linha recebe `surge` com o atraso em
// linha, que é o mesmo truque do gráfico do painel. Nada nasce invisível — o
// servidor manda o quadro inteiro e a animação só existe enquanto roda.
//
// ── no celular ───────────────────────────────────────────────
// Abaixo de `sm`, cada tarefa ocupa duas linhas — o nome em cima, o resto
// embaixo — em vez de espremer o nome num terço da tela. O nome É o conteúdo;
// truncar ele para caber a pílula seria mostrar a forma e esconder o assunto.
// A linha do tempo só aparece de `md` para cima: numa tela de 375px ela
// roubaria o espaço do nome para dizer o que a pílula de situação já diz.
//
// Nomes e tarefas são de exemplo. As tarefas são as de qualquer loja; as
// pessoas não existem.

import { AoEntrar } from './AoEntrar'

type Situacao = 'feito' | 'andamento' | 'parado' | 'fazer'

// Cor nunca vem sozinha: toda pílula tem a palavra. Quem não distingue verde
// de vermelho lê "Feito" e "Parado" igual.
const SITUACAO: Record<Situacao, { texto: string; classe: string }> = {
  feito: { texto: 'Feito', classe: 'bg-bom-fundo text-bom' },
  andamento: { texto: 'Em andamento', classe: 'bg-atencao-fundo text-atencao' },
  parado: { texto: 'Parado', classe: 'bg-critico-fundo text-critico' },
  fazer: { texto: 'A fazer', classe: 'bg-superficie-2 text-tinta-2' },
}

type Pessoa = { iniciais: string; nome: string }

const PESSOAS = {
  marina: { iniciais: 'MC', nome: 'Marina Costa' },
  joao: { iniciais: 'JP', nome: 'João Pereira' },
  rafaela: { iniciais: 'RA', nome: 'Rafaela Alves' },
  carlos: { iniciais: 'CS', nome: 'Carlos Silva' },
} satisfies Record<string, Pessoa>

type Tarefa = {
  nome: string
  quem: Pessoa
  situacao: Situacao
  /** Começo e fim da barra, em % da linha do tempo do grupo. */
  tempo: [number, number]
  prazo: string
  estrelas: 1 | 2 | 3 | 4 | 5
}

type Grupo = {
  nome: string
  /** A cor do grupo pinta o título, o fio da esquerda e a barra. */
  cor: 'marca' | 'bom'
  tarefas: Tarefa[]
}

const COR: Record<Grupo['cor'], { titulo: string; fio: string; barra: string }> = {
  marca: {
    titulo: 'text-marca',
    fio: 'shadow-[inset_3px_0_0_var(--marca)]',
    barra: 'bg-marca',
  },
  bom: {
    titulo: 'text-bom',
    fio: 'shadow-[inset_3px_0_0_var(--bom)]',
    barra: 'bg-bom',
  },
}

const GRUPOS: Grupo[] = [
  {
    nome: 'Esta semana',
    cor: 'marca',
    tarefas: [
      { nome: 'Conferir troco e abrir o caixa', quem: PESSOAS.marina, situacao: 'feito', tempo: [0, 28], prazo: '15 set', estrelas: 3 },
      { nome: 'Montar a vitrine de primavera', quem: PESSOAS.joao, situacao: 'andamento', tempo: [14, 66], prazo: '18 set', estrelas: 4 },
      { nome: 'Ligar para o fornecedor de sandálias', quem: PESSOAS.rafaela, situacao: 'parado', tempo: [30, 56], prazo: '17 set', estrelas: 5 },
      { nome: 'Etiquetar a mercadoria que chegou', quem: PESSOAS.carlos, situacao: 'andamento', tempo: [42, 84], prazo: '19 set', estrelas: 2 },
    ],
  },
  {
    nome: 'Próximo mês',
    cor: 'bom',
    tarefas: [
      { nome: 'Contar o estoque da loja 2', quem: PESSOAS.rafaela, situacao: 'fazer', tempo: [4, 38], prazo: '3 out', estrelas: 4 },
      { nome: 'Fechar o mês com a contadora', quem: PESSOAS.marina, situacao: 'fazer', tempo: [8, 30], prazo: '6 out', estrelas: 5 },
      { nome: 'Campanha do Dia das Crianças', quem: PESSOAS.joao, situacao: 'andamento', tempo: [0, 62], prazo: '10 out', estrelas: 3 },
      { nome: 'Treinar a balconista nova no caixa', quem: PESSOAS.carlos, situacao: 'fazer', tempo: [36, 70], prazo: '14 out', estrelas: 2 },
    ],
  },
]

// As colunas, numa string só, porque o cabeçalho e cada linha precisam ser a
// MESMA grade — coluna `auto` mediria a pílula de cada linha e "Em andamento"
// desalinharia tudo embaixo de "Feito". Larguras fixas para o que é fixo, e
// `minmax(0, 1fr)` no nome para ele poder truncar.
//
//   celular    nome | estrelas          (e o resto na segunda linha)
//   sm         nome | quem | situação | prazo | estrelas
//   md         nome | quem | situação | linha do tempo | prazo | estrelas
const COLUNAS =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 ' +
  'sm:grid-cols-[minmax(0,1fr)_1.75rem_6rem_3rem_4.5rem] ' +
  'md:grid-cols-[minmax(0,1fr)_1.75rem_6rem_7rem_3rem_4.5rem]'

/** Passo entre uma linha e a próxima. 60ms lê como sequência sem virar espera. */
const PASSO = 0.06
/** Quanto a barra espera depois de a linha pousar. */
const BARRA_DEPOIS = 0.2

export function QuadroVivo() {
  const totalTarefas = GRUPOS.reduce((n, g) => n + g.tarefas.length, 0)
  const pessoas = new Set(GRUPOS.flatMap((g) => g.tarefas.map((t) => t.quem.nome))).size

  // A ordem de entrada corre pelo quadro inteiro: título do grupo, as quatro
  // linhas dele, o título do próximo, as quatro dele.
  let ordem = 0

  return (
    <AoEntrar className="lg:-mr-10 lg:w-[calc(100%+2.5rem)]">
      {/* O nome do quadro flutua em cima, sem barra de aplicativo em volta. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pl-3 lg:pr-5">
        <p className="flex items-baseline gap-2">
          <span className="text-sm font-bold text-tinta">Quadro da Loja Centro</span>
          <span className="numero text-xs text-tinta-3">
            {pessoas} pessoas · {totalTarefas} tarefas
          </span>
        </p>
        <span className="text-xs text-tinta-3">setembro e outubro</span>
      </div>

      {/* O cabeçalho das colunas só existe de `sm` para cima: no celular as
          colunas viram duas linhas por tarefa e não há o que rotular. Ele é
          decorativo — cada célula das linhas carrega o próprio rótulo para o
          leitor de tela. */}
      <div
        aria-hidden
        className={`${COLUNAS} mt-4 hidden pb-1.5 pl-3 text-[10px] font-bold tracking-[0.12em] text-tinta-3 uppercase sm:grid lg:pr-5`}
      >
        <span>Tarefa</span>
        <span />
        <span>Situação</span>
        <span className="hidden md:block">Linha do tempo</span>
        <span>Prazo</span>
        <span className="text-right">Prioridade</span>
      </div>

      {GRUPOS.map((g) => {
        const cor = COR[g.cor]
        const atrasoTitulo = ordem++ * PASSO
        return (
          <div key={g.nome}>
            <div
              className="surge flex items-baseline gap-2 pt-5 pb-1.5 pl-3"
              style={{ animationDelay: `${atrasoTitulo}s` }}
            >
              <p className={`text-[13px] font-bold ${cor.titulo}`}>{g.nome}</p>
              <span className="numero text-[11px] text-tinta-3">{g.tarefas.length} tarefas</span>
            </div>

            <ul className="flex flex-col">
              {g.tarefas.map((t) => {
                const s = SITUACAO[t.situacao]
                const [de, ate] = t.tempo
                const atraso = ordem++ * PASSO
                return (
                  <li
                    key={t.nome}
                    className={`${COLUNAS} surge border-t border-borda-suave py-2.5 pl-3 lg:pr-5 ${cor.fio}`}
                    style={{ animationDelay: `${atraso}s` }}
                  >
                    <span className="truncate text-[13px] font-medium text-tinta sm:text-sm">
                      {t.nome}
                    </span>

                    {/* No celular estes quatro formam a segunda linha da
                        tarefa; de `sm` para cima o invólucro some
                        (`contents`) e cada um vira uma coluna da grade. */}
                    <div className="col-span-2 flex items-center gap-2.5 sm:contents">
                      <span
                        className="grid size-7 shrink-0 place-items-center rounded-full bg-marca-suave text-[10px] font-bold text-marca"
                        title={t.quem.nome}
                      >
                        {t.quem.iniciais}
                        <span className="sr-only"> — responsável: {t.quem.nome}</span>
                      </span>

                      <span
                        className={`justify-self-start rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.classe}`}
                      >
                        {s.texto}
                      </span>

                      {/* A barra: trilho claro, e o preenchimento cresce da
                          esquerda depois que a linha pousou. */}
                      <span
                        aria-hidden
                        className="relative hidden h-1.5 overflow-hidden rounded-full bg-superficie-2 md:block"
                      >
                        <span
                          className={`cresce absolute inset-y-0 rounded-full ${cor.barra}`}
                          style={{
                            left: `${de}%`,
                            width: `${ate - de}%`,
                            animationDelay: `${atraso + BARRA_DEPOIS}s`,
                          }}
                        />
                      </span>

                      <span className="numero text-[11px] text-tinta-2">
                        <span className="sr-only">prazo </span>
                        {t.prazo}
                      </span>
                    </div>

                    <Estrelas
                      n={t.estrelas}
                      className="col-start-2 row-start-1 justify-self-end sm:col-auto sm:row-auto"
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}

      <p className="mt-4 pl-3 text-[11px] text-tinta-3">
        Quadro de exemplo: as tarefas são as de qualquer loja, as pessoas não existem.
      </p>
    </AoEntrar>
  )
}

/**
 * A prioridade em cinco estrelas.
 *
 * Cheia em âmbar vivo, vazia só em traço. É a mesma peça da tela de tarefas,
 * e o leitor de tela recebe o número em vez de cinco desenhos.
 */
function Estrelas({ n, className }: { n: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label={`prioridade ${n} de 5`}
      className={`flex items-center gap-px ${className ?? ''}`}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const cheia = i <= n
        return (
          <svg
            key={i}
            aria-hidden
            focusable="false"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill={cheia ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            className={cheia ? 'text-atencao-vivo' : 'text-tinta-3'}
          >
            <path d="M12 3l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.4l-5.7 3.1 1.2-6.4L2.8 9.7l6.4-.8z" />
          </svg>
        )
      })}
    </span>
  )
}
