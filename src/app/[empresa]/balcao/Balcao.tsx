'use client'

// A tela do balcão.
//
// Aqui as regras vêm de quem fica em pé atrás do caixa, não de quem desenha:
//
// 1. O CURSOR VOLTA SOZINHO PARA A BUSCA. Depois de cada item lançado. Quem
//    passa o leitor de código de barras não pode ter que clicar entre um bipe
//    e outro — o leitor digita e dá Enter, e só isso.
// 2. ENTER LANÇA O PRIMEIRO RESULTADO. Se veio um só, entra direto.
// 3. NADA DE MODAL PARA FECHAR. O pagamento vive ao lado, sempre visível: com
//    fila esperando, abrir e fechar janela custa segundos que não existem.
// 4. O TROCO APARECE ANTES DE CONFIRMAR, grande. É o número que a pessoa vai
//    conferir na gaveta.
// 5. QUEM NÃO TEM ETIQUETA TOCA NO BOTÃO. Sorveteria não etiqueta picolé,
//    lanchonete não etiqueta X-salada. Para essas, embaixo da busca fica a
//    grade: categorias como abas, produtos como botões com nome e preço, um
//    toque lança. E a quantidade se escolhe ANTES de tocar ("×20, picolé"),
//    que é uma ação a menos do que lançar e corrigir depois.
// 6. AS TECLAS SÃO AS DE TODO PDV. F10 fecha, Ctrl+P vai para o produto,
//    Alt+N para o cliente, Alt+F para o vendedor. Quem já operou um caixa na
//    vida chega sabendo — e quem não, aprende olhando a etiqueta do botão.
// 7. A FORMA DE PAGAMENTO ESCOLHE O PREÇO. Crédito cobra o preço "no cartão";
//    o resto, "à vista". A escada dos três totais fica à vista para a pessoa
//    dizer "à vista sai por tanto" sem fazer conta.
// 8. ESTOQUE CURTO AVISA NA HORA, NÃO NO FIM. Lançou mais do que tem, a tela
//    diz. O servidor recusa de novo ao fechar — o aviso é conforto, a trava
//    é lá.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { EscolherCliente } from './Cliente'
import type { ClienteNoBalcao } from './acoes'
import { chaveDoBalcao, guardar, recuperar, esquecer, faz } from './guardar'
import { oferecer, valorEmCentavos, type Programa } from '@/servidor/pontos'
import { tabelaDe, ROTULO_TABELA, type Tabela } from '@/servidor/preco'
import { multiplicar } from '@/servidor/dinheiro'
import type { Vendedor } from '@/servidor/equipe'
import { Botao, Aviso, Situacao, cx } from '@/ui/base'
import { procurar, grade, fecharVenda, type Achado, type Grade } from './acoes'

const FORMAS = [
  { chave: 'DINHEIRO', titulo: 'Dinheiro' },
  { chave: 'PIX', titulo: 'Pix' },
  { chave: 'DEBITO', titulo: 'Débito' },
  { chave: 'CREDITO', titulo: 'Crédito' },
] as const

type Linha = Achado & { quantidade: number; avulso?: boolean }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const cent = (v: number) => Math.round(v * 100)
const MEDIDA: Record<string, string> = {
  UN: 'un', KG: 'kg', G: 'g', L: 'l', ML: 'ml', M: 'm', PAR: 'par', CX: 'cx',
}

function Tecla({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-borda bg-superficie-2 px-1 py-px font-mono text-[10px] font-semibold text-tinta-3">
      {children}
    </kbd>
  )
}

export function Balcao({
  slug,
  unidadeId,
  usuarioId,
  grade: usaGrade,
  caixaId,
  unidadeNome,
  programa,
  vendedores,
  podeAvulso,
}: {
  slug: string
  unidadeId: string
  /** Quem está operando. Entra na chave do que fica guardado — ver guardar.ts. */
  usuarioId: string
  /**
   * Mostrar a grade de botões? Vem da empresa (padrão do ramo, trocável em
   * Configurações). Loja que bipa etiqueta não precisa de sessenta botões de
   * camiseta na frente do caixa.
   */
  grade: boolean
  caixaId: string | null
  unidadeNome: string
  programa: Programa
  /** Quem pode vender aqui. Nulo = módulo de metas desligado: quem vende é quem opera. */
  vendedores: Vendedor[] | null
  /** Pode lançar item fora do catálogo. É a mesma trava do desconto acima do teto. */
  podeAvulso: boolean
}) {
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<Achado[]>([])
  const [carrinho, setCarrinho] = useState<Linha[]>([])
  const [pagos, setPagos] = useState<{ forma: string; valor: number }[]>([])
  const [desconto, setDesconto] = useState(0)
  const [cliente, setCliente] = useState<ClienteNoBalcao | null>(null)
  const [vendedorId, setVendedorId] = useState(usuarioId)
  const [pontosUsar, setPontosUsar] = useState(0)
  const [recado, setRecado] = useState<{ nivel: 'bom' | 'critico'; texto: string } | null>(null)
  const [alerta, setAlerta] = useState<string | null>(null)
  const [voltou, setVoltou] = useState<number | null>(null)
  const [pedidoCliente, setPedidoCliente] = useState(0)
  const [indo, comecar] = useTransition()

  // ── a grade e a quantidade ───────────────────────────────
  // `qtd` é a quantidade do PRÓXIMO lançamento, e volta a 1 depois de cada um.
  // Para peso (KG), é o peso lido na balança; para unidade, quantas.
  const [qtd, setQtd] = useState(1)
  const [botoes, setBotoes] = useState<Grade | null>(null)
  const [categoriaId, setCategoriaId] = useState<string | null>(null)

  // ── item avulso ──────────────────────────────────────────
  const [avulsoAberto, setAvulsoAberto] = useState(false)
  const [avulsoNome, setAvulsoNome] = useState('')
  const [avulsoPreco, setAvulsoPreco] = useState('')

  useEffect(() => {
    if (!usaGrade) return
    let vivo = true
    grade(slug, unidadeId, categoriaId)
      .then((g) => vivo && setBotoes(g))
      .catch(() => vivo && setBotoes(null))
    return () => {
      vivo = false
    }
  }, [slug, unidadeId, categoriaId, usaGrade])

  const busca = useRef<HTMLInputElement>(null)
  const vendedorRef = useRef<HTMLSelectElement>(null)
  const primeiraForma = useRef<HTMLButtonElement>(null)
  const focarBusca = () => busca.current?.focus()

  // ── a venda em andamento não se perde ────────────────────
  // Ver guardar.ts para o porquê. Aqui é só a ligação com a tela, e ela tem
  // uma ordem que importa: RECUPERAR antes de começar a GUARDAR.
  //
  // Sem isso os dois efeitos brigam na montagem — o de guardar rodaria com o
  // carrinho ainda vazio e apagaria o que o de recuperar ia buscar. O
  // `primeiraVez` existe só para o segundo efeito deixar a montagem passar.
  const chave = useMemo(
    () => chaveDoBalcao(slug, unidadeId, usuarioId),
    [slug, unidadeId, usuarioId],
  )
  const primeiraVez = useRef(true)

  useEffect(() => {
    const g = recuperar(chave)
    if (!g) return
    setCarrinho(g.carrinho as Linha[])
    setPagos(g.pagos)
    setDesconto(g.desconto)
    setCliente(g.cliente)
    setPontosUsar(g.pontosUsar)
    setVoltou(g.em)
  }, [chave])

  useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false
      return
    }
    if (carrinho.length === 0) esquecer(chave)
    else guardar(chave, { carrinho, pagos, desconto, cliente, pontosUsar })
  }, [chave, carrinho, pagos, desconto, cliente, pontosUsar])

  // Busca conforme digita, com uma pausa curta para não consultar a cada tecla.
  useEffect(() => {
    if (termo.trim().length < 2) {
      setAchados([])
      return
    }
    const t = setTimeout(() => {
      procurar(slug, unidadeId, termo).then(setAchados).catch(() => setAchados([]))
    }, 180)
    return () => clearTimeout(t)
  }, [termo, slug, unidadeId])

  // O aviso de estoque some sozinho: ele é informação de agora, não erro.
  useEffect(() => {
    if (!alerta) return
    const t = setTimeout(() => setAlerta(null), 7000)
    return () => clearTimeout(t)
  }, [alerta])

  // ── as contas ────────────────────────────────────────────
  // A tabela de preço vem das formas já escolhidas. Sem forma, à vista. O
  // carrinho guardado de antes desta versão pode não ter `precos`; aí vale o
  // preço à vista que ele sempre teve.
  const tabela: Tabela = tabelaDe(pagos.map((p) => p.forma))
  const precoDe = (l: Linha, t: Tabela) => (l.avulso ? l.preco : (l.precos?.[t] ?? l.preco))
  const linhaCent = (l: Linha, t: Tabela) => multiplicar(cent(precoDe(l, t)), l.quantidade)
  const totalNa = (t: Tabela) => carrinho.reduce((s, l) => s + linhaCent(l, t), 0)

  const totalCent = totalNa(tabela)
  const descontoCent = cent(desconto)
  const comDescontoCent = Math.max(totalCent - descontoCent, 0)

  // A oferta de pontos é calculada em cima do valor JÁ com desconto, e sobre o
  // saldo menos o que já foi marcado — senão, ao aplicar, a tela ofereceria os
  // mesmos pontos de novo.
  const oferta = cliente ? oferecer(cliente.pontos, comDescontoCent, programa) : null
  const pontosCent = valorEmCentavos(pontosUsar, programa)
  const aPagarCent = Math.max(comDescontoCent - pontosCent, 0)
  const pagoCent = pagos.reduce((s, p) => s + cent(p.valor), 0)
  const faltaCent = aPagarCent - pagoCent
  // Troco só existe em dinheiro. Cartão e Pix não devolvem diferença — se
  // sobrar ali, é erro de digitação, e a venda tem que travar em vez de
  // "dar troco" de um valor que nunca entrou na gaveta.
  const temDinheiro = pagos.some((p) => p.forma === 'DINHEIRO')
  const trocoCent = temDinheiro ? Math.max(-faltaCent, 0) : 0
  const sobrouSemDinheiro = !temDinheiro && faltaCent < 0

  // A escada: os três totais. Só aparece quando são diferentes — loja que
  // cobra igual em tudo não precisa saber que a escada existe.
  const escada = { vista: totalNa('vista'), cartao: totalNa('cartao'), crediario: totalNa('crediario') }
  const temEscada = escada.cartao !== escada.vista || escada.crediario !== escada.vista

  const podeConcluir =
    carrinho.length > 0 && faltaCent <= 0 && !sobrouSemDinheiro && !!caixaId && !indo

  function lancar(a: Achado) {
    setRecado(null)
    const q = qtd > 0 ? qtd : 1
    const jaTem = carrinho.find((l) => l.id === a.id)
    // Unidade acumula: tocar duas vezes no picolé é dois picolés. Peso não
    // acumula sozinho: 0,3 kg + 0,3 kg raramente é o que se quer — a segunda
    // pesagem SUBSTITUI a primeira.
    const novaQtd = jaTem ? (a.medida === 'UN' ? jaTem.quantidade + q : q) : q
    setCarrinho((c) =>
      jaTem
        ? c.map((l) => (l.id === a.id ? { ...l, quantidade: novaQtd } : l))
        : [...c, { ...a, quantidade: novaQtd }],
    )
    // O aviso é agora, não no fim: quem lançou 3 e só tem 1 precisa saber
    // com a pessoa na frente, não depois de escolher o pagamento.
    if (novaQtd > a.saldo) {
      setAlerta(
        a.saldo <= 0
          ? `${a.descricao} está sem estoque nesta loja. A venda não vai fechar assim.`
          : `Estoque de ${a.descricao}: ${a.saldo}. Você lançou ${novaQtd}. Confira a peça.`,
      )
    }
    // A quantidade é do lançamento, não da sessão: "×20" vale para o próximo
    // toque e mais nenhum. Sem isto, o "20" esquecido lançava 20 do item
    // seguinte — e o erro só aparecia no total.
    setQtd(1)
    setTermo('')
    setAchados([])
    focarBusca()
  }

  function lancarAvulso() {
    const nome = avulsoNome.trim()
    const preco = Number(avulsoPreco.replace(',', '.'))
    if (!nome || !(preco >= 0)) return
    const id = `avulso-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setCarrinho((c) => [
      ...c,
      {
        id,
        codigo: null,
        descricao: nome,
        medida: 'UN',
        preco,
        precos: { vista: preco, cartao: preco, crediario: preco },
        saldo: 0,
        quantidade: qtd > 0 ? qtd : 1,
        avulso: true,
      },
    ])
    setQtd(1)
    setAvulsoNome('')
    setAvulsoPreco('')
    setAvulsoAberto(false)
    focarBusca()
  }

  function mudarQtd(id: string, q: number) {
    setCarrinho((c) => c.map((l) => (l.id === id ? { ...l, quantidade: Math.max(q, 0) } : l)))
  }

  const tirar = (id: string) => setCarrinho((c) => c.filter((l) => l.id !== id))

  function pagarCom(forma: string) {
    // Clicar na forma preenche o que FALTA. É o gesto mais comum: a pessoa
    // escolhe como vai receber e o valor já vem certo. Mas o valor fica
    // EDITÁVEL: em dinheiro o cliente entrega R$ 100 numa venda de R$ 83, e o
    // caixa precisa digitar os 100 para ver o troco.
    //
    // A conta é feita na tabela que a NOVA forma puxa: escolher Crédito numa
    // venda à vista sobe o total, e o que falta tem que ser calculado já com
    // o total de cartão.
    const t = tabelaDe([...pagos.map((p) => p.forma), forma])
    const aPagarNa = Math.max(Math.max(totalNa(t) - descontoCent, 0) - pontosCent, 0)
    const falta = (aPagarNa - pagoCent) / 100
    if (falta <= 0) return
    setPagos((p) => [...p, { forma, valor: falta }])
  }

  const mudarPago = (i: number, valor: number) =>
    setPagos((p) => p.map((x, j) => (j === i ? { ...x, valor: Math.max(valor, 0) } : x)))

  function limpar() {
    setVoltou(null)
    setCarrinho([])
    setPagos([])
    setDesconto(0)
    setCliente(null)
    setPontosUsar(0)
    setTermo('')
    setAchados([])
    setAlerta(null)
    focarBusca()
  }

  function concluir() {
    if (!podeConcluir) return
    comecar(async () => {
      const r = await fecharVenda(slug, {
        unidadeId,
        caixaId,
        desconto,
        clienteId: cliente?.id ?? null,
        vendedorId: vendedores ? vendedorId : null,
        pontosUsar,
        itens: carrinho.map((l) =>
          l.avulso
            ? {
                variacaoId: null,
                quantidade: l.quantidade,
                precoUnit: l.preco,
                avulso: { descricao: l.descricao, precoUnit: l.preco },
              }
            : { variacaoId: l.id, quantidade: l.quantidade, precoUnit: precoDe(l, tabela) },
        ),
        // O troco não é pagamento: o que entra no sistema é o que FICA na
        // gaveta. E ele sai do dinheiro, nunca do cartão.
        pagamentos: (() => {
          if (trocoCent === 0) return pagos
          const ultimoDinheiro = pagos.map((p) => p.forma).lastIndexOf('DINHEIRO')
          return pagos.map((p, i) =>
            i === ultimoDinheiro ? { ...p, valor: p.valor - trocoCent / 100 } : p,
          )
        })(),
      })

      if (r.ok) {
        // O ganho aparece no recado porque e a hora de falar: "voce ja tem
        // 1.240 pontos" dito no balcao e o que faz a pessoa voltar. Guardado
        // so no banco, o programa nao existe para quem compra.
        const ganhou = r.pontosGanhos > 0 ? ` · ganhou ${r.pontosGanhos} pontos` : ''
        setRecado({
          nivel: 'bom',
          texto: `Venda ${r.numero} fechada — ${brl(r.total)}${ganhou}`,
        })
        limpar()
      } else if (r.motivo === 'pontos_recusados') {
        setRecado({ nivel: 'critico', texto: r.recado })
        setPontosUsar(0)
      } else if (r.motivo === 'sem_estoque') {
        setRecado({
          nivel: 'critico',
          texto: `Sem estoque: ${r.faltando.map((f) => `${f.descricao} (tem ${f.tem})`).join(', ')}`,
        })
      } else if (r.motivo === 'pagamento_nao_fecha') {
        setRecado({ nivel: 'critico', texto: `A conta não fecha: falta ${brl(r.total - r.pago)}` })
      } else if (r.motivo === 'caixa_fechado') {
        setRecado({ nivel: 'critico', texto: 'O caixa foi fechado. Abra de novo para vender.' })
      } else if (r.motivo === 'desconto_acima_do_teto') {
        setRecado({
          nivel: 'critico',
          texto: `Desconto de ${r.percentual.toFixed(1)}% passa do teto de ${r.teto}%. Chame quem pode autorizar.`,
        })
      } else if (r.motivo === 'avulso_negado') {
        setRecado({ nivel: 'critico', texto: 'Item avulso só com permissão de desconto acima do teto.' })
      } else if (r.motivo === 'vendedor_invalido') {
        setRecado({ nivel: 'critico', texto: 'Esse vendedor não pode vender nesta loja.' })
      } else {
        setRecado({ nivel: 'critico', texto: 'Não deu para fechar a venda.' })
      }
    })
  }

  // ── as teclas ────────────────────────────────────────────
  // Uma escuta só, na janela, lendo o estado mais recente por referência:
  // registrar de novo a cada tecla digitada seria trocar o ouvinte trinta
  // vezes por venda. F10 é a única que age; as outras só levam o foco.
  const estado = useRef({ podeConcluir, concluir, temItens: carrinho.length > 0 })
  estado.current = { podeConcluir, concluir, temItens: carrinho.length > 0 }
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'F10') {
        e.preventDefault()
        const s = estado.current
        if (s.podeConcluir) s.concluir()
        else if (s.temItens) primeiraForma.current?.focus()
        return
      }
      if (e.ctrlKey && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        // Ctrl+P é imprimir no navegador; no balcão é "produto", como em todo PDV.
        e.preventDefault()
        focarBusca()
        return
      }
      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        setPedidoCliente((n) => n + 1)
        return
      }
      if (e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        vendedorRef.current?.focus()
      }
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  const emVenda = carrinho.length > 0
  const itensNaVenda = carrinho.reduce((s, l) => s + (l.medida === 'UN' ? l.quantidade : 1), 0)

  return (
    <div className="flex flex-col gap-3">
      {/* Recuperar em silêncio seria pior que perder: a pessoa veria itens
          que ela não lançou agora e não saberia de onde vieram. Diz o que
          aconteceu, de quando é, e deixa jogar fora num clique. */}
      {voltou !== null && carrinho.length > 0 && (
        <Aviso nivel="atencao">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Recuperamos a venda que estava sendo montada {faz(voltou)}.</span>
            <button type="button" onClick={limpar} className="font-semibold underline underline-offset-2">
              Não é essa — começar do zero
            </button>
          </span>
        </Aviso>
      )}

      {recado && <Aviso nivel={recado.nivel}>{recado.texto}</Aviso>}
      {alerta && <Aviso nivel="atencao">{alerta}</Aviso>}

      {/* ── quem compra, quem vende ── */}
      <div className={cx('grid gap-2', vendedores ? 'sm:grid-cols-[1fr_16rem]' : '')}>
        <div className="flex flex-col gap-1 rounded-norte border border-borda bg-superficie px-3 py-2">
          <span className="flex items-center gap-2 text-[10px] font-semibold tracking-wide text-tinta-3 uppercase">
            Cliente <Tecla>Alt N</Tecla>
          </span>
          <EscolherCliente slug={slug} escolhido={cliente} aoEscolher={setCliente} pedido={pedidoCliente} />
        </div>
        {vendedores && (
          <label className="flex flex-col gap-1 rounded-norte border border-borda bg-superficie px-3 py-2">
            <span className="flex items-center gap-2 text-[10px] font-semibold tracking-wide text-tinta-3 uppercase">
              Vendedor <Tecla>Alt F</Tecla>
            </span>
            <select
              ref={vendedorRef}
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value)}
              className="rounded border border-borda bg-superficie px-2 py-1.5 text-sm font-semibold text-tinta"
            >
              {!vendedores.some((v) => v.id === usuarioId) && <option value={usuarioId}>Eu</option>}
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nome}
                  {v.id === usuarioId ? ' (eu)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_21rem]">
        {/* ── esquerda: buscar e lançar ── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-stretch gap-2">
            {/* A quantidade fica À ESQUERDA, antes do produto, porque é essa a
                ordem em que se fala: "vinte picolés", não "picolé, vinte".
                Estreita e com o × na frente para ler como multiplicador. */}
            <label className="flex shrink-0 items-center gap-1 rounded-norte border-2 border-borda bg-superficie px-2">
              <span aria-hidden className="text-sm text-tinta-3">×</span>
              <input
                type="number"
                min={0.001}
                step="any"
                inputMode="decimal"
                value={qtd}
                onChange={(e) => setQtd(Number(e.target.value))}
                onFocus={(e) => e.target.select()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    focarBusca()
                  }
                }}
                aria-label="Quantidade do próximo item"
                className="numero w-14 bg-transparent py-3 text-center text-base text-tinta focus:outline-none"
              />
            </label>

            <div className="relative min-w-0 flex-1">
              <input
                ref={busca}
                autoFocus
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && achados[0]) {
                    e.preventDefault()
                    lancar(achados[0])
                  }
                  if (e.key === 'Escape') {
                    setTermo('')
                    setAchados([])
                  }
                }}
                placeholder="Bipe a etiqueta ou digite o nome..."
                aria-label="Procurar produto (Ctrl+P)"
                className={cx(
                  'w-full rounded-norte border-2 border-borda bg-superficie py-3 pr-16 pl-4',
                  'text-base text-tinta placeholder:text-tinta-3',
                  'focus:border-marca focus:outline-none',
                )}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <Tecla>Ctrl P</Tecla>
              </span>
              {achados.length > 0 && (
                <ul className="absolute z-20 mt-1 flex max-h-80 w-full flex-col overflow-y-auto rounded-norte border border-borda bg-superficie shadow-norte">
                  {achados.map((a, i) => (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => lancar(a)}
                        className="flex w-full items-center justify-between gap-3 border-b border-borda-suave px-3 py-2 text-left last:border-0 hover:bg-superficie-2"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium text-tinta">{a.descricao}</span>
                          <span className="font-mono text-xs text-tinta-3">{a.codigo}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Situacao nivel={a.saldo <= 0 ? 'critico' : 'bom'}>
                            {a.saldo <= 0 ? 'acabou' : `${a.saldo}`}
                          </Situacao>
                          <span className="numero text-sm font-semibold text-tinta">{brl(precoDe(a as Linha, tabela))}</span>
                          {i === 0 && <Tecla>Enter</Tecla>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* O estado, grande e apagado, como no PDV de referência: quem
                olha de longe sabe se o caixa está no meio de uma venda. */}
            <span
              aria-live="polite"
              className={cx(
                'hidden shrink-0 items-center self-center text-lg font-extrabold tracking-[0.08em] uppercase sm:flex',
                emVenda ? 'text-marca' : 'text-tinta-3/60',
              )}
            >
              {emVenda ? 'Em venda…' : 'Caixa livre'}
            </span>
          </div>

          {/* ── a grade de botões ──
              Aparece quando a busca está vazia — quem está digitando quer o
              dropdown, quem não está quer os botões. Some sozinha quando não há
              o que mostrar (loja sem produto ainda). */}
          {usaGrade && termo.trim().length < 2 && botoes && botoes.itens.length > 0 && (
            <div className="flex flex-col gap-2">
              {botoes.categorias.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {[{ id: null as string | null, nome: 'Todos', quantos: 0 }, ...botoes.categorias].map((c) => (
                    <button
                      key={c.id ?? 'todos'}
                      type="button"
                      onClick={() => setCategoriaId(c.id)}
                      aria-pressed={categoriaId === c.id}
                      className={cx(
                        'rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
                        categoriaId === c.id
                          ? 'bg-tinta text-superficie'
                          : 'border border-borda bg-superficie text-tinta-2 hover:bg-superficie-2',
                      )}
                    >
                      {c.nome}
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {botoes.itens.map((a) => {
                  const acabou = a.saldo <= 0
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => lancar(a)}
                      disabled={acabou}
                      title={acabou ? 'Acabou' : `Lançar ${a.descricao}`}
                      className={cx(
                        'flex min-h-[4.25rem] flex-col justify-between rounded-norte border px-3 py-2 text-left transition-colors',
                        acabou
                          ? 'cursor-not-allowed border-borda-suave bg-superficie-2 text-tinta-3'
                          : 'border-borda bg-superficie hover:border-marca hover:bg-superficie-2 active:bg-marca/10',
                      )}
                    >
                      <span className="line-clamp-2 text-[13px] leading-snug font-medium">{a.descricao}</span>
                      <span className="flex items-baseline justify-between gap-2 pt-1">
                        <span className="numero text-sm font-bold">{brl(precoDe(a as Linha, tabela))}</span>
                        <span className={cx('numero text-[11px]', acabou ? 'font-semibold' : 'text-tinta-3')}>
                          {acabou ? 'acabou' : a.saldo}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>

              {botoes.cortou && (
                <p className="text-xs text-tinta-3">
                  Categoria grande demais para botão — mostrando os primeiros. Para o resto, digite.
                </p>
              )}
            </div>
          )}

          {/* ── os itens da venda ── */}
          <div className="overflow-hidden rounded-norte border border-borda bg-superficie">
            {carrinho.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-tinta-3">
                {usaGrade && botoes && botoes.itens.length > 0
                  ? 'Toque num produto, ou bipe a etiqueta.'
                  : 'Nenhuma peça ainda. Bipe a etiqueta ou aperte '}
                {!(usaGrade && botoes && botoes.itens.length > 0) && <Tecla>Ctrl P</Tecla>}
                {!(usaGrade && botoes && botoes.itens.length > 0) && ' para buscar.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-borda bg-superficie-2 text-xs tracking-wide text-tinta-3 uppercase">
                      <th className="hidden px-3 py-2 text-left font-semibold sm:table-cell">Código</th>
                      <th className="px-3 py-2 text-left font-semibold">Descrição</th>
                      <th className="px-3 py-2 text-center font-semibold">Quantidade</th>
                      <th className="hidden px-3 py-2 text-left font-semibold sm:table-cell">Un.</th>
                      <th className="hidden px-3 py-2 text-right font-semibold sm:table-cell">Preço unit.</th>
                      <th className="px-3 py-2 text-right font-semibold">Total</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {carrinho.map((l) => {
                      const passou = !l.avulso && l.quantidade > l.saldo
                      return (
                        <tr key={l.id} className={cx('border-b border-borda-suave last:border-0', passou && 'bg-atencao-fundo/50')}>
                          <td className="hidden px-3 py-2 font-mono text-xs text-tinta-3 sm:table-cell">
                            {l.avulso ? 'avulso' : l.codigo}
                          </td>
                          <td className="px-3 py-2">
                            <span className="block font-medium text-tinta">{l.descricao}</span>
                            <span className="text-xs text-tinta-3 sm:hidden">
                              {brl(precoDe(l, tabela))}
                              {l.medida !== 'UN' && ` / ${MEDIDA[l.medida] ?? l.medida}`}
                            </span>
                            {passou && (
                              <span className="block text-xs font-medium text-atencao">
                                só tem {l.saldo} em estoque
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className="flex items-center justify-center gap-1">
                              {l.medida === 'UN' && (
                                <button
                                  type="button"
                                  onClick={() => mudarQtd(l.id, l.quantidade - 1)}
                                  aria-label={`Menos um de ${l.descricao}`}
                                  className="size-7 rounded border border-borda text-tinta-2 hover:bg-superficie-2"
                                >
                                  −
                                </button>
                              )}
                              <input
                                type="number"
                                value={l.quantidade}
                                min={0}
                                step={l.medida === 'UN' ? 1 : 0.001}
                                onChange={(e) => mudarQtd(l.id, Number(e.target.value))}
                                onFocus={(e) => e.target.select()}
                                aria-label={`Quantidade de ${l.descricao}`}
                                className="numero w-16 rounded border border-borda bg-superficie px-1.5 py-1 text-center text-sm"
                              />
                              {l.medida === 'UN' && (
                                <button
                                  type="button"
                                  onClick={() => mudarQtd(l.id, l.quantidade + 1)}
                                  aria-label={`Mais um de ${l.descricao}`}
                                  className="size-7 rounded border border-borda text-tinta-2 hover:bg-superficie-2"
                                >
                                  +
                                </button>
                              )}
                            </span>
                          </td>
                          <td className="hidden px-3 py-2 text-xs text-tinta-2 uppercase sm:table-cell">
                            {MEDIDA[l.medida] ?? l.medida}
                          </td>
                          <td className="numero hidden px-3 py-2 text-tinta-2 sm:table-cell">
                            {brl(precoDe(l, tabela))}
                          </td>
                          <td className="numero px-3 py-2 font-semibold text-tinta">
                            {brl(linhaCent(l, tabela) / 100)}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => tirar(l.id)}
                              aria-label={`Tirar ${l.descricao}`}
                              className="rounded px-1.5 py-0.5 text-sm text-tinta-3 hover:bg-critico-fundo hover:text-critico"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* O rodapé da lista: quantos, quanto, e o que a pessoa pode
                fazer com a lista inteira. */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-borda-suave bg-superficie-2 px-3 py-2 text-xs text-tinta-2">
              <span className="flex items-center gap-3">
                <span>
                  <b className="numero text-tinta">{itensNaVenda}</b> ite{itensNaVenda === 1 ? 'm' : 'ns'}
                </span>
                {podeAvulso && !avulsoAberto && (
                  <button
                    type="button"
                    onClick={() => setAvulsoAberto(true)}
                    className="font-medium text-marca underline-offset-2 hover:underline"
                  >
                    + item avulso (fora do estoque)
                  </button>
                )}
              </span>
              {carrinho.length > 0 && (
                <button type="button" onClick={limpar} className="text-tinta-3 underline-offset-2 hover:text-critico hover:underline">
                  limpar venda
                </button>
              )}
            </div>

            {avulsoAberto && (
              <div className="flex flex-wrap items-end gap-2 border-t border-borda-suave px-3 py-2">
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-tinta-2">
                  O que é
                  <input
                    autoFocus
                    value={avulsoNome}
                    onChange={(e) => setAvulsoNome(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && lancarAvulso()}
                    placeholder="Conserto de barra, peça sem cadastro..."
                    className="rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta"
                  />
                </label>
                <label className="flex w-28 flex-col gap-1 text-xs text-tinta-2">
                  Preço
                  <input
                    value={avulsoPreco}
                    onChange={(e) => setAvulsoPreco(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && lancarAvulso()}
                    inputMode="decimal"
                    placeholder="0,00"
                    className="numero rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta"
                  />
                </label>
                <Botao tom="secundario" onClick={lancarAvulso} className="py-1.5 text-xs">
                  Lançar
                </Botao>
                <button type="button" onClick={() => setAvulsoAberto(false)} className="px-1 text-xs text-tinta-3 hover:text-tinta">
                  cancelar
                </button>
                <p className="w-full text-[11px] text-tinta-3">
                  Item avulso não mexe em estoque e fica marcado no livro. Se a peça existe, cadastre — o
                  relatório agradece.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── direita: pagamento, sempre visível ── */}
        <aside className="flex h-fit flex-col gap-3 rounded-norte border border-borda bg-superficie p-4 lg:sticky lg:top-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-tinta-3">{unidadeNome}</span>
            {!caixaId && <Situacao nivel="critico">caixa fechado</Situacao>}
          </div>

          <div className="flex flex-col gap-1 border-b border-borda-suave pb-3">
            <div className="flex items-baseline justify-between text-sm text-tinta-2">
              <span>
                {carrinho.length} {carrinho.length === 1 ? 'item' : 'itens'}
                {temEscada && (
                  <span className="text-xs text-tinta-3"> · tabela {ROTULO_TABELA[tabela]}</span>
                )}
              </span>
              <span className="numero">{brl(totalCent / 100)}</span>
            </div>

            {/* A escada: o que a pessoa fala em voz alta para quem está
                decidindo como pagar. */}
            {temEscada && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-tinta-3">
                {(['vista', 'cartao', 'crediario'] as Tabela[]).map((t) => (
                  <span key={t} className={cx(t === tabela && 'font-semibold text-tinta-2')}>
                    {ROTULO_TABELA[t]} <span className="numero">{brl(escada[t] / 100)}</span>
                  </span>
                ))}
              </div>
            )}

            <label className="flex items-center justify-between gap-2 text-sm text-tinta-2">
              Desconto
              <input
                type="number"
                min={0}
                step={0.01}
                value={desconto || ''}
                onChange={(e) => setDesconto(Number(e.target.value) || 0)}
                placeholder="0,00"
                className="numero w-24 rounded border border-borda bg-superficie px-2 py-1 text-sm"
              />
            </label>

            {/* A oferta. Aparece sozinha, com o numero pronto: ninguem no balcao
                vai abrir outra tela para descobrir quantos pontos a pessoa tem,
                nem fazer a conta de quanto isso vale. Se nao aparecer aqui,
                o programa de pontos nao existe na pratica. */}
            {oferta?.pode && pontosUsar === 0 && (
              <button
                type="button"
                onClick={() => setPontosUsar(oferta.pontos)}
                className="flex items-center justify-between gap-2 rounded-norte border border-bom-vivo bg-bom-fundo px-2.5 py-2 text-left"
              >
                <span className="flex flex-col">
                  <span className="text-xs font-semibold text-tinta">Tem {oferta.saldo} pontos</span>
                  <span className="text-xs text-tinta-2">dá {brl(oferta.centavos / 100)} de desconto</span>
                </span>
                <span className="shrink-0 text-xs font-bold text-bom">usar</span>
              </button>
            )}

            {pontosUsar > 0 && (
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-tinta-2">{pontosUsar} pontos</span>
                <span className="flex items-baseline gap-2">
                  <span className="numero text-bom">- {brl(pontosCent / 100)}</span>
                  <button type="button" onClick={() => setPontosUsar(0)} className="text-xs text-tinta-3 hover:text-tinta" aria-label="Não usar os pontos">
                    ✕
                  </button>
                </span>
              </div>
            )}

            {oferta && !oferta.pode && oferta.recado && (
              <span className="text-xs text-tinta-3">{oferta.recado}</span>
            )}
          </div>

          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-tinta">A pagar</span>
            <span className="numero text-3xl font-bold tracking-tight text-tinta">{brl(aPagarCent / 100)}</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {FORMAS.map((f, i) => (
              <Botao
                key={f.chave}
                botaoRef={i === 0 ? primeiraForma : undefined}
                tom="secundario"
                onClick={() => pagarCom(f.chave)}
                disabled={carrinho.length === 0 || faltaCent <= 0}
                className="py-2 text-xs"
              >
                {f.titulo}
              </Botao>
            ))}
          </div>

          {pagos.length > 0 && (
            <ul className="flex flex-col gap-1">
              {pagos.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-tinta-2">{FORMAS.find((f) => f.chave === p.forma)?.titulo ?? p.forma}</span>
                  <span className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step={0.01}
                      min={0}
                      value={p.valor}
                      onChange={(e) => mudarPago(i, Number(e.target.value))}
                      aria-label={`Valor recebido em ${p.forma}`}
                      className="numero w-24 rounded border border-borda bg-superficie px-2 py-1 text-sm font-semibold text-tinta"
                    />
                    <button
                      type="button"
                      onClick={() => setPagos((x) => x.filter((_, j) => j !== i))}
                      aria-label="Tirar pagamento"
                      className="text-tinta-3 hover:text-critico"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {faltaCent > 0 && pagos.length > 0 && (
            <div className="flex items-baseline justify-between rounded-norte bg-atencao-fundo px-2.5 py-1.5">
              <span className="text-sm font-semibold text-atencao">Falta</span>
              <span className="numero font-bold text-atencao">{brl(faltaCent / 100)}</span>
            </div>
          )}

          {sobrouSemDinheiro && (
            <Aviso nivel="critico">
              O valor passou do total, e não há dinheiro na venda para dar troco. Ajuste o valor
              recebido.
            </Aviso>
          )}

          {trocoCent > 0 && (
            <div className="flex items-baseline justify-between rounded-norte bg-bom-fundo px-2.5 py-2">
              <span className="text-sm font-semibold text-bom">Troco</span>
              <span className="numero text-2xl font-bold text-bom">{brl(trocoCent / 100)}</span>
            </div>
          )}

          <Botao
            tom="confirmar"
            largo
            onClick={concluir}
            carregando={indo}
            disabled={!podeConcluir}
            className="py-3 text-base"
          >
            {indo ? 'Fechando...' : 'Fechar venda'}
            {!indo && (
              <kbd className="rounded bg-white/20 px-1.5 py-px font-mono text-[10px] font-semibold">F10</kbd>
            )}
          </Botao>
        </aside>
      </div>
    </div>
  )
}
