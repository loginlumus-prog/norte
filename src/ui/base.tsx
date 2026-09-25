// Peças básicas da interface.
//
// A regra que mantém 30 telas parecidas em vez de "quase parecidas": nenhuma
// tela escreve cor, borda ou espaçamento na mão. Se falta um jeito de um
// componente, ele ganha uma variante aqui — não uma classe solta lá.

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
} from 'react'

export const cx = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(' ')

/* ── Botão ────────────────────────────────────────────────── */

type Tom = 'principal' | 'confirmar' | 'secundario' | 'discreto' | 'perigo'

const TOM: Record<Tom, string> = {
  principal: 'botao-marca text-marca-tinta border-transparent',
  // Verde é para o que CONCLUI: fechar venda, receber, dar baixa. A ação
  // principal comum continua sendo a cor da marca, senão tudo vira verde e
  // o verde deixa de querer dizer alguma coisa.
  confirmar: 'bg-bom-vivo text-white hover:brightness-95 border-transparent',
  secundario: 'bg-superficie text-tinta hover:bg-superficie-2 border-borda',
  discreto: 'bg-transparent text-tinta-2 hover:bg-superficie-2 hover:text-tinta border-transparent',
  perigo: 'bg-critico-vivo text-white hover:brightness-95 border-transparent',
}

export function Botao({
  tom = 'principal',
  largo,
  carregando,
  children,
  className,
  botaoRef,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tom?: Tom
  largo?: boolean
  carregando?: boolean
  /** Para quem precisa levar o foco até o botão — o F10 do balcão faz isso. */
  botaoRef?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      {...resto}
      ref={botaoRef}
      disabled={resto.disabled || carregando}
      aria-busy={carregando || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-norte border px-3 py-2',
        'text-sm font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-55',
        TOM[tom],
        largo && 'w-full',
        className,
      )}
    >
      {carregando && <Girando />}
      {children}
    </button>
  )
}

function Girando() {
  return (
    <span
      aria-hidden
      className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}

/* ── Campo ────────────────────────────────────────────────── */

export function Campo({
  rotulo,
  erro,
  dica,
  id,
  className,
  campoRef,
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & {
  rotulo: string
  erro?: string
  dica?: string
  /**
   * Para quem precisa devolver o foco ao campo depois de uma ação — o balcão
   * e a entrada de mercadoria fazem isso a cada item lançado. Sem ele, a tela
   * ou usa um <input> solto (e perde rótulo, dica e erro) ou obriga a pessoa
   * a clicar entre um bipe e outro.
   */
  campoRef?: Ref<HTMLInputElement>
}) {
  const meuId = id ?? `campo-${resto.name ?? rotulo.toLowerCase().replace(/\W+/g, '-')}`
  const idDica = dica ? `${meuId}-dica` : undefined
  const idErro = erro ? `${meuId}-erro` : undefined

  // `min-w-0` no invólucro e no campo: sem eles, o <input> tem largura
  // mínima de ~20 letras, e numa grade de três colunas (rua · número ·
  // complemento) a 768px ele vazava da caixa e a PÁGINA rolava de lado —
  // Lojas, ao abrir "Endereço", ia de 768 para 924px.
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={meuId} className="text-sm font-medium text-tinta">
        {rotulo}
      </label>
      <input
        {...resto}
        ref={campoRef}
        id={meuId}
        aria-invalid={erro ? true : undefined}
        aria-describedby={cx(idDica, idErro) || undefined}
        className={cx(
          'w-full min-w-0 rounded-norte border bg-superficie px-3 py-2 text-sm text-tinta',
          'placeholder:text-tinta-3',
          erro ? 'border-critico' : 'border-borda',
          className,
        )}
      />
      {dica && !erro && (
        <p id={idDica} className="text-xs text-tinta-3">
          {dica}
        </p>
      )}
      {erro && (
        <p id={idErro} className="text-xs font-medium text-critico">
          {erro}
        </p>
      )}
    </div>
  )
}

/* ── Aviso ────────────────────────────────────────────────── */

type Nivel = 'bom' | 'atencao' | 'critico' | 'neutro'

const AVISO: Record<Nivel, string> = {
  bom: 'bg-bom-fundo text-bom',
  atencao: 'bg-atencao-fundo text-atencao',
  critico: 'bg-critico-fundo text-critico',
  neutro: 'bg-superficie-2 text-tinta-2',
}

const BARRA: Record<Nivel, string> = {
  bom: 'border-l-[3px] border-l-bom-vivo',
  atencao: 'border-l-[3px] border-l-atencao-vivo',
  critico: 'border-l-[3px] border-l-critico-vivo',
  neutro: 'border-l-[3px] border-l-tinta-3',
}

const BOLA: Record<Nivel, string> = {
  bom: 'bg-bom-vivo',
  atencao: 'bg-atencao-vivo',
  critico: 'bg-critico-vivo',
  neutro: 'bg-tinta-3',
}

export function Aviso({
  nivel = 'neutro',
  pulsa = false,
  children,
}: {
  nivel?: Nivel
  /**
   * Chama a atencao com um halo que abre e some.
   *
   * NAO e o padrao, e nao pode ser: tela onde tudo pisca e tela onde nada
   * chama. Liga so no que a pessoa precisa RESOLVER agora — conta vencida,
   * proposta esperando resposta — e some junto com o problema.
   */
  pulsa?: boolean
  children: ReactNode
}) {
  return (
    <div
      // 'alert' faz o leitor de tela anunciar sem a pessoa precisar procurar
      role={nivel === 'critico' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-2.5 rounded-norte px-3 py-2.5 text-sm font-medium',
        BARRA[nivel],
        AVISO[nivel],
        pulsa && 'pulsa',
        pulsa && (nivel === 'critico' ? 'pulsa-critico' : 'pulsa-atencao'),
      )}
    >
      <span
        aria-hidden
        className={cx('mt-1.5 size-2 shrink-0 rounded-full', BOLA[nivel], pulsa && 'respira')}
      />
      <span>{children}</span>
    </div>
  )
}

/* ── Situação ─────────────────────────────────────────────── */

/**
 * Etiqueta de situação. Cor E texto — nunca só cor: quem não distingue verde
 * de vermelho (8% dos homens) precisa ler o mesmo que os outros enxergam.
 */
export function Situacao({ nivel = 'neutro', children }: { nivel?: Nivel; children: ReactNode }) {
  const bolinha: Record<Nivel, string> = {
    bom: 'bg-bom-vivo',
    atencao: 'bg-atencao-vivo',
    critico: 'bg-critico-vivo',
    neutro: 'bg-tinta-3',
  }
  return (
    <span
      className={cx(
        // Etiqueta não quebra linha: "Em / andamento" em duas linhas vira um
        // bloco alto no meio da tabela e perde a cara de etiqueta.
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        AVISO[nivel],
      )}
    >
      {/* a bolinha dá o recado de longe; o texto dá para quem não vê a cor */}
      <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', bolinha[nivel])} />
      {children}
    </span>
  )
}

/* ── Cartão ───────────────────────────────────────────────── */

export function Cartao({
  titulo,
  acao,
  caixa = false,
  children,
}: {
  titulo?: string
  acao?: ReactNode
  /**
   * Fecha em caixa: borda, fundo e sombra.
   *
   * NÃO é o padrão, e a mudança foi essa. Quando tudo é caixa, caixa deixa de
   * significar alguma coisa: a tela vira uma pilha de retângulos cinzentos e o
   * olho não distingue o que é um objeto de verdade do que é só um assunto.
   *
   * Sem caixa, o que separa é o ESPAÇO e a régua fina embaixo do título — que
   * é como página impressa boa faz há quinhentos anos. Sobra ar, o texto ganha
   * peso, e a caixa passa a ser exceção com sentido.
   *
   * Ligue quando o conteúdo é uma PEÇA e não um trecho: um formulário que se
   * preenche e envia, um pacote que se compra, um painel que se opera. Se você
   * não consegue dizer por que aquilo é um objeto, não é.
   */
  caixa?: boolean
  children: ReactNode
}) {
  if (caixa) {
    // Sem `overflow-hidden`: ele cortava qualquer coisa que precise sair da
    // caixa — o primeiro caso foi a lista de resultados da busca de entrada de
    // mercadoria, que sumia atrás da borda. O canto arredondado vem do próprio
    // cabeçalho.
    return (
      <section className="realce rounded-norte border border-borda bg-superficie">
        {titulo && (
          <header className="flex items-center justify-between gap-3 rounded-t-norte border-b border-borda bg-superficie-2 px-4 py-2.5">
            <h2 className="text-sm font-semibold">{titulo}</h2>
            {acao}
          </header>
        )}
        <div className="p-4">{children}</div>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      {titulo && (
        <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-borda pb-2">
          {/* Sem a caixa em volta, é o TÍTULO que segura a seção — então ele
              cresce e ganha peso. Título fraco sem caixa vira texto solto. */}
          <h2 className="text-[15px] font-bold tracking-tight">{titulo}</h2>
          {acao}
        </header>
      )}
      {children}
    </section>
  )
}

/* ── Vazio ────────────────────────────────────────────────── */

/** Lista sem nada dentro. Diz o que fazer, não só que está vazio. */
export function Vazio({ children, acao }: { children: ReactNode; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <p className="max-w-sm text-sm text-tinta-2">{children}</p>
      {acao}
    </div>
  )
}

/* ── Seleção ──────────────────────────────────────────────── */

export function Selecao({
  rotulo,
  dica,
  opcoes,
  id,
  className,
  ...resto
}: SelectHTMLAttributes<HTMLSelectElement> & {
  rotulo: string
  dica?: string
  opcoes: { valor: string; titulo: string }[]
}) {
  const meuId = id ?? `sel-${resto.name ?? rotulo.toLowerCase().replace(/\W+/g, '-')}`
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={meuId} className="text-sm font-medium text-tinta">
        {rotulo}
      </label>
      <select
        {...resto}
        id={meuId}
        className={cx(
          // O mesmo `min-w-0` do `Campo`: opção de nome comprido não estica a grade.
          'w-full min-w-0 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta',
          className,
        )}
      >
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.titulo}
          </option>
        ))}
      </select>
      {dica && <p className="text-xs text-tinta-3">{dica}</p>}
    </div>
  )
}

/* ── Caixa de marcar ──────────────────────────────────────── */

/**
 * Rótulo grande e clicável inteiro. No balcão se usa com o dedo, e alvo
 * pequeno de 16px erra mais do que acerta.
 */
export function Marcar({
  titulo,
  resumo,
  id,
  className,
  // Caixa por padrao, mas serve de bolinha tambem. A diferenca entre "marque
  // quantas quiser" e "escolha uma" e do tipo do input, nao do desenho — o
  // cartao, a borda e o fundo sao os mesmos, e e bom que sejam: duas
  // aparencias para a mesma pergunta so confundem.
  type = 'checkbox',
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & {
  titulo: string
  resumo?: string
}) {
  // Bolinha divide o `name` com as irmas — e o que faz uma desmarcar a outra.
  // Sem o valor no id, todas nasceriam com o mesmo, e clicar no rotulo de
  // qualquer uma marcaria sempre a primeira.
  const meuId = id ?? `mar-${resto.name}${resto.value ? `-${resto.value}` : ''}`
  return (
    <label
      htmlFor={meuId}
      className={cx(
        'flex cursor-pointer items-start gap-3 rounded-norte border border-borda',
        'bg-superficie p-3 transition-colors hover:bg-superficie-2',
        // Escolhido tem que se ver de longe: borda e fundo da MARCA. Já foi
        // verde — mas verde neste sistema quer dizer "está bom" (estoque,
        // margem, caixa), e a loja marcada no cadastro lia como situação,
        // não como escolha. Escolher é ação, e ação é azul, como o período
        // e os filtros.
        'has-checked:border-marca has-checked:bg-marca-suave',
        className,
      )}
    >
      <input
        {...resto}
        id={meuId}
        type={type}
        className="mt-0.5 size-4 shrink-0 accent-[var(--marca)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-tinta">{titulo}</span>
        {resumo && <span className="text-xs text-tinta-2">{resumo}</span>}
      </span>
    </label>
  )
}

/* ── Bolinha de aviso ─────────────────────────────────────── */

/**
 * O ponto que diz "tem coisa aqui". Aparece no menu e em aba.
 *
 * Sem número quando é só "tem novidade"; com número quando a quantidade
 * importa ("3 acabando" pede ação diferente de "30 acabando").
 */
export function Ponto({
  nivel = 'critico',
  quantos,
  titulo,
}: {
  nivel?: Nivel
  quantos?: number
  titulo?: string
}) {
  const cor: Record<Nivel, string> = {
    bom: 'bg-bom-vivo',
    atencao: 'bg-atencao-vivo',
    critico: 'bg-critico-vivo',
    neutro: 'bg-tinta-3',
  }

  if (quantos === undefined) {
    return (
      <span
        title={titulo}
        aria-label={titulo}
        className={cx('inline-block size-2 shrink-0 rounded-full', cor[nivel])}
      />
    )
  }

  return (
    <span
      title={titulo}
      aria-label={titulo ? `${quantos} ${titulo}` : String(quantos)}
      className={cx(
        'numero inline-flex min-w-5 shrink-0 items-center justify-center rounded-full',
        'px-1.5 py-0.5 text-[11px] leading-none font-bold text-white',
        cor[nivel],
      )}
    >
      {quantos > 99 ? '99+' : quantos}
    </span>
  )
}

/* ── Faixa de destaque ────────────────────────────────────── */

/**
 * Barra de cor na borda de um cartão ou tile. É o jeito mais barato de dar
 * situação a um bloco inteiro sem pintar o fundo e cansar a vista.
 */
export const FAIXA: Record<Nivel, string> = {
  bom: 'border-l-[3px] border-l-bom-vivo',
  atencao: 'border-l-[3px] border-l-atencao-vivo',
  critico: 'border-l-[3px] border-l-critico-vivo',
  neutro: 'border-l-[3px] border-l-borda',
}

export type { Nivel }
