'use client'

// O coração do balcão: a venda em andamento, sem a cara.
//
// ── por que é um gancho, e não o Balcao.tsx inteiro ──────────
// O balcão tem duas caras: o SIMPLES, de cartões grandes para tocar, e o
// AVANÇADO, de busca e tabela. As duas vendem a mesma coisa, com as mesmas
// regras: o que acumula, o que substitui, quando o troco existe, o que o
// servidor recusa e como a tela explica. Se cada cara tivesse o seu estado,
// o crediário ia ganhar uma trava numa e esquecer da outra na primeira
// mudança. Então o estado e as ações moram aqui, uma vez; as telas só
// desenham e chamam.
//
// As regras de quem fica em pé atrás do caixa estão no topo do Balcao.tsx e
// valem para as duas caras. Duas se juntaram aqui, porque o balcão agora
// também roda em tablet:
//
// 9.  O TOQUE NÃO PUXA O TECLADO. Depois de lançar, o cursor volta para a
//     busca — mas só se quem lançou usou mouse ou teclado. No tablet, pôr o
//     foco num campo abre o teclado da tela por cima dos produtos, a cada
//     toque. Quem toca não precisa do cursor na busca.
// 10. O BIPE ACHA A BUSCA SOZINHO. O leitor de código de barras é um teclado
//     que digita rápido e dá Enter. Se o foco está num cartão (porque a
//     pessoa acabou de tocar nele) ou em lugar nenhum, a primeira tecla do
//     bipe leva o foco para a busca e o resto do código cai lá. Sem isso, a
//     regra 9 quebraria o leitor no tablet.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { ClienteNoBalcao, Achado } from './acoes'
import { procurar, fecharVenda, consultarValeAcao } from './acoes'
import { chaveDoBalcao, guardar, recuperar, esquecer } from './guardar'
import { contar, faltaCom, pagamentosParaEnviar, precoDe, brl, cent } from './conta'
import { oferecer, valorEmCentavos, type Programa } from '@/servidor/pontos'
import type { Vendedor } from '@/servidor/equipe'
import { vendidoNaLoja } from '@/servidor/catalogo-loja'

export type Pago = { forma: string; valor: number; referencia?: string; rotulo?: string; parcelas?: number }

export type Linha = Achado & { quantidade: number; avulso?: boolean }

export type Recado = {
  nivel: 'bom' | 'critico'
  texto: string
  /** "imprimir comprovante", depois de fechar. */
  link?: { href: string; rotulo: string }
}

/** A venda que acabou de fechar — o que a tela de sucesso do simples mostra. */
export type Fechada = {
  vendaId: string
  numero: number
  total: number
  trocoCent: number
  pontosGanhos: number
  formas: string[]
  comprovante: string
}

export const FORMAS = [
  { chave: 'DINHEIRO', titulo: 'Dinheiro' },
  { chave: 'PIX', titulo: 'Pix' },
  { chave: 'DEBITO', titulo: 'Débito' },
  { chave: 'CREDITO', titulo: 'Crédito' },
] as const

export const tituloDaForma = (p: { forma: string; rotulo?: string }) =>
  p.rotulo ?? FORMAS.find((f) => f.chave === p.forma)?.titulo ?? p.forma

export function useVenda({
  slug,
  unidadeId,
  unidadeNome,
  usuarioId,
  caixaId,
  programa,
  vendedores,
  crediario,
}: {
  slug: string
  unidadeId: string
  /** Para dizer "não é vendido na Loja Centro", e não "nesta loja". */
  unidadeNome: string
  usuarioId: string
  caixaId: string | null
  programa: Programa
  vendedores: Vendedor[] | null
  crediario: { maxParcelas: number } | null
}) {
  const [termo, setTermo] = useState('')
  // Os resultados guardam o termo que os trouxe: é o que deixa o Enter saber
  // se a lista na tela é deste código ou do anterior.
  const [busca_, setBusca_] = useState<{ de: string; itens: Achado[] }>({ de: '', itens: [] })
  const achados = busca_.itens
  const setAchados = (itens: Achado[]) => setBusca_({ de: '', itens })
  const [carrinho, setCarrinho] = useState<Linha[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])

  // ── o crediário ──────────────────────────────────────────
  const [parcelasN, setParcelasN] = useState(1)

  // ── o vale de troca ──────────────────────────────────────
  const [valeAberto, setValeAberto] = useState(false)
  const [valeCodigo, setValeCodigo] = useState('')
  const [valeErro, setValeErro] = useState<string | null>(null)
  const [valeIndo, setValeIndo] = useState(false)

  const [desconto, setDesconto] = useState(0)
  const [cliente, setCliente] = useState<ClienteNoBalcao | null>(null)
  const [vendedorId, setVendedorId] = useState(usuarioId)
  const [pontosUsar, setPontosUsar] = useState(0)
  const [observacoes, setObservacoes] = useState('')
  const [recado, setRecado] = useState<Recado | null>(null)
  const [fechada, setFechada] = useState<Fechada | null>(null)
  const [alerta, setAlerta] = useState<string | null>(null)
  /**
   * O aviso que fica até alguém ler: o item que SAIU do pedido porque esta
   * loja não o vende. Diferente do alerta de estoque, que some sozinho —
   * item que some do pedido sem a pessoa ver é o tipo de coisa que vira
   * "o sistema comeu minha venda".
   */
  const [aviso, setAviso] = useState<string | null>(null)
  const [voltou, setVoltou] = useState<number | null>(null)
  /** A venda recuperada estava no meio do "concluir" — ver guardar.ts. */
  const [incerta, setIncerta] = useState(false)
  const [pedidoCliente, setPedidoCliente] = useState(0)
  const [pedidoVendedor, setPedidoVendedor] = useState(0)
  const [indo, comecar] = useTransition()

  // `qtd` é a quantidade do PRÓXIMO lançamento, e volta a 1 depois de cada um.
  // Para peso (KG), é o peso lido na balança; para unidade, quantas.
  const [qtd, setQtd] = useState(1)

  // ── item avulso ──────────────────────────────────────────
  const [avulsoAberto, setAvulsoAberto] = useState(false)
  const [avulsoNome, setAvulsoNome] = useState('')
  const [avulsoPreco, setAvulsoPreco] = useState('')

  const busca = useRef<HTMLInputElement>(null)
  const vendedorRef = useRef<HTMLSelectElement>(null)
  const primeiraForma = useRef<HTMLButtonElement>(null)
  /** A caixa da tela inteira. O bipe só é puxado para a busca se o foco estava aqui dentro. */
  const raiz = useRef<HTMLDivElement>(null)

  // Regra 9: o último gesto foi toque? Ouvido na janela, na fase de captura,
  // para valer antes do clique que vai lançar o item.
  const tocou = useRef(false)
  useEffect(() => {
    const gesto = (e: PointerEvent) => {
      tocou.current = e.pointerType === 'touch' || e.pointerType === 'pen'
    }
    const tecla = () => {
      tocou.current = false
    }
    window.addEventListener('pointerdown', gesto, true)
    window.addEventListener('keydown', tecla, true)
    return () => {
      window.removeEventListener('pointerdown', gesto, true)
      window.removeEventListener('keydown', tecla, true)
    }
  }, [])

  /** Volta o cursor para a busca — menos depois de um toque (regra 9). */
  const focarBusca = () => {
    if (!tocou.current) busca.current?.focus()
  }

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
    setIncerta(!!g.fechando)
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
    const t0 = termo.trim()
    if (t0.length < 2) {
      setBusca_({ de: '', itens: [] })
      return
    }
    const t = setTimeout(() => {
      procurar(slug, unidadeId, t0)
        .then((itens) => setBusca_({ de: t0, itens }))
        .catch(() => setBusca_({ de: t0, itens: [] }))
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
  // A oferta de pontos é calculada em cima do valor JÁ com desconto, e sobre
  // o saldo menos o que já foi marcado — senão, ao aplicar, a tela ofereceria
  // os mesmos pontos de novo.
  const pontosCent = valorEmCentavos(pontosUsar, programa)
  const conta = contar(carrinho, pagos, desconto, pontosCent)
  const { tabela, faltaCent, trocoCent, sobrouSemDinheiro } = conta
  const oferta = cliente ? oferecer(cliente.pontos, conta.comDescontoCent, programa) : null

  const podeConcluir =
    carrinho.length > 0 && faltaCent <= 0 && !sobrouSemDinheiro && !!caixaId && !indo

  // ── cada loja só vende o que é dela ──────────────────────
  // (catalogo-loja.ts) Uma linha de outra loja só chega ao pedido de um jeito:
  // a pessoa montou o pedido numa loja e trocou para outra, ou a tela
  // recuperou um pedido guardado. Ela SAI do pedido, com aviso — deixá-la lá
  // travando o "concluir" só ensinaria a pessoa a achar o botão quebrado.
  useEffect(() => {
    const fora = carrinho.filter((l) => !l.avulso && !vendidoNaLoja(l.vendidoEm, unidadeId))
    if (fora.length === 0) return
    setCarrinho((c) => c.filter((l) => l.avulso || vendidoNaLoja(l.vendidoEm, unidadeId)))
    setAviso(`Saiu do pedido: ${fora.map((l) => l.descricao).join(', ')} — não é vendido na ${unidadeNome}.`)
  }, [carrinho, unidadeId, unidadeNome])

  function lancar(a: Achado, quantidade?: number) {
    // A etiqueta de outra loja: explica, não lança.
    if (a.foraDaLoja || !vendidoNaLoja(a.vendidoEm, unidadeId)) {
      setAlerta(`${a.descricao} não é vendido na ${unidadeNome}.`)
      setTermo('')
      setBusca_({ de: '', itens: [] })
      focarBusca()
      return
    }
    setRecado(null)
    setFechada(null)
    const q = quantidade ?? (qtd > 0 ? qtd : 1)
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

  /**
   * O Enter da busca: devolve a peça a lançar, ou nada.
   *
   * O leitor de código de barras digita o código inteiro e dá Enter em
   * cinquenta milissegundos — antes da pausa de 180ms da busca, e muito antes
   * da resposta do servidor. Confiar na lista da tela ali é lançar NADA (a
   * lista ainda está vazia) ou, pior, lançar o item ERRADO (a lista ainda é
   * do "CAM00" digitado antes, e o primeiro dela é o CAM001, não o CAM002).
   * Então: se a lista na tela é deste termo, usa; se não, pergunta agora.
   */
  async function enterNaBusca(): Promise<Achado | null> {
    const t = termo.trim()
    if (t.length < 2) return null
    let itens = busca_.de === t ? busca_.itens : null
    if (!itens) {
      try {
        itens = await procurar(slug, unidadeId, t)
      } catch {
        itens = []
      }
    }
    const a = itens[0] ?? null
    if (!a) setAlerta(`Nada encontrado com “${t}”. Confira o código ou digite o nome.`)
    return a
  }

  function lancarAvulso() {
    const nome = avulsoNome.trim()
    const preco = Number(avulsoPreco.replace(',', '.'))
    if (!nome || !(preco >= 0)) return
    setFechada(null)
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

  // Mexeu no pedido, o recado da recusa anterior já não fala do pedido que
  // está na tela — e recado velho na tela é recado que ninguém mais lê.
  function mudarQtd(id: string, q: number) {
    setRecado(null)
    setCarrinho((c) => c.map((l) => (l.id === id ? { ...l, quantidade: Math.max(q, 0) } : l)))
  }

  const tirar = (id: string) => {
    setRecado(null)
    setCarrinho((c) => c.filter((l) => l.id !== id))
  }

  function pagarCom(forma: string) {
    // Clicar na forma preenche o que FALTA. É o gesto mais comum: a pessoa
    // escolhe como vai receber e o valor já vem certo. Mas o valor fica
    // EDITÁVEL: em dinheiro o cliente entrega R$ 100 numa venda de R$ 83, e o
    // caixa precisa digitar os 100 para ver o troco.
    const falta = faltaCom(carrinho, pagos, forma, desconto, pontosCent) / 100
    if (falta <= 0) return
    setPagos((p) => [...p, { forma, valor: falta }])
  }

  /**
   * Troca as formas escolhidas por esta, cobrindo o que falta.
   *
   * É o gesto do simples: "ah, vai ser no Pix" depois de já ter tocado em
   * Dinheiro. Sem isto, o segundo toque somaria um pagamento em cima do
   * outro, e a tela passaria a mostrar troco de um dinheiro que não existe.
   * O vale fica: é papel que o cliente trouxe, não forma que se troca.
   */
  function pagarSoCom(forma: string) {
    const manter = pagos.filter((p) => p.forma === 'VALE')
    const falta = faltaCom(carrinho, manter, forma, desconto, pontosCent)
    setPagos(falta > 0 ? [...manter, { forma, valor: falta / 100 }] : manter)
  }

  const mudarPago = (i: number, valor: number) =>
    setPagos((p) => p.map((x, j) => (j === i ? { ...x, valor: Math.max(valor, 0) } : x)))

  const tirarPago = (i: number) => setPagos((p) => p.filter((_, j) => j !== i))

  // Fiado é dívida com nome: sem cliente, a tela abre a busca de cliente em
  // vez de aceitar. O total é o da tabela "no crediário" — o preço que já
  // embute o risco de vender a prazo.
  function pagarNoCrediario(n = parcelasN, substituir = false) {
    if (!crediario) return
    if (!cliente) {
      setRecado({ nivel: 'critico', texto: 'Venda no crediário precisa de cliente. Escolha quem está comprando.' })
      setPedidoCliente((x) => x + 1)
      return
    }
    // `substituir` é o toque do simples: o crediário entra NO LUGAR das
    // outras formas (menos o vale), como o Pix entraria no lugar do dinheiro.
    const base = substituir ? pagos.filter((p) => p.forma === 'VALE') : pagos
    if (base.some((p) => p.forma === 'CREDIARIO')) return
    const falta = faltaCom(carrinho, base, 'CREDIARIO', desconto, pontosCent)
    if (falta <= 0) return
    setRecado(null)
    setParcelasN(n)
    setPagos([...base, { forma: 'CREDIARIO', valor: falta / 100, parcelas: n, rotulo: `Crediário ${n}×` }])
  }

  /** Muda em quantas vezes, depois de o crediário já estar na venda. */
  function mudarParcelas(n: number) {
    setParcelasN(n)
    setPagos((p) =>
      p.map((x) => (x.forma === 'CREDIARIO' ? { ...x, parcelas: n, rotulo: `Crediário ${n}×` } : x)),
    )
  }

  // O vale entra pelo código do papel. A tela consulta antes de aceitar,
  // para dizer o saldo e de quem é; o servidor confere de novo ao fechar.
  async function usarVale() {
    const codigo = valeCodigo.trim()
    if (!codigo) return
    setValeIndo(true)
    setValeErro(null)
    try {
      const r = await consultarValeAcao(slug, codigo)
      if (!r.ok) {
        setValeErro(
          r.motivo === 'nao_achado' ? 'Vale não encontrado. Confira o código.'
          : r.motivo === 'zerado' ? 'Este vale já foi todo usado.'
          : 'Este vale venceu.',
        )
        return
      }
      if (pagos.some((p) => p.referencia === r.codigo)) {
        setValeErro('Esse vale já está nesta venda.')
        return
      }
      const falta = faltaCom(carrinho, pagos, 'VALE', desconto, pontosCent)
      if (falta <= 0) {
        setValeErro('Não falta nada para pagar.')
        return
      }
      const valorCent = Math.min(cent(r.saldo), falta)
      setPagos((p) => [
        ...p,
        {
          forma: 'VALE',
          valor: valorCent / 100,
          referencia: r.codigo,
          rotulo: `Vale ${r.codigo}${r.cliente ? ` · ${r.cliente}` : ''}`,
        },
      ])
      setValeCodigo('')
      setValeAberto(false)
    } catch {
      setValeErro('Não deu para consultar o vale agora.')
    } finally {
      setValeIndo(false)
    }
  }

  function limpar() {
    setAviso(null)
    setVoltou(null)
    setIncerta(false)
    setCarrinho([])
    setPagos([])
    setDesconto(0)
    setCliente(null)
    setPontosUsar(0)
    setObservacoes('')
    setTermo('')
    setAchados([])
    setAlerta(null)
    focarBusca()
  }

  function concluir() {
    if (!podeConcluir) return
    // A foto do que a tela mostrou: o troco e as formas vão para a tela de
    // sucesso depois que o carrinho já foi limpo.
    const trocoAgora = trocoCent
    const formasAgora = pagos.map((p) => p.forma)
    const guardado = { carrinho, pagos, desconto, cliente, pontosUsar }
    // Marca o guardado como "concluindo" ANTES de pedir: se a tela cair entre
    // o pedido e a resposta, quem abrir de novo fica sabendo.
    guardar(chave, { ...guardado, fechando: Date.now() })
    setIncerta(false)
    comecar(async () => {
      let r: Awaited<ReturnType<typeof fecharVenda>>
      try {
        r = await fecharVenda(slug, {
        unidadeId,
        caixaId,
        desconto,
        clienteId: cliente?.id ?? null,
        vendedorId: vendedores ? vendedorId : null,
        pontosUsar,
        observacoes,
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
        pagamentos: pagamentosParaEnviar(pagos, trocoAgora),
        })
      } catch {
        // Caiu a rede no meio: não dá para saber se o servidor gravou. A marca
        // de "concluindo" fica, e a tela diz para conferir antes de repetir.
        setIncerta(true)
        setRecado({
          nivel: 'critico',
          texto: 'A conexão caiu enquanto a venda era concluída. Confira em Vendas se ela entrou antes de concluir de novo.',
          link: { href: `/${slug}/vendas`, rotulo: 'abrir Vendas' },
        })
        return
      }

      // Recusada: o servidor não gravou nada, então a marca sai.
      if (!r.ok) guardar(chave, guardado)

      if (r.ok) {
        // O ganho aparece no recado porque e a hora de falar: "voce ja tem
        // 1.240 pontos" dito no balcao e o que faz a pessoa voltar. Guardado
        // so no banco, o programa nao existe para quem compra.
        const ganhou = r.pontosGanhos > 0 ? ` · ganhou ${r.pontosGanhos} pontos` : ''
        const comprovante = `/${slug}/vendas/${r.vendaId}/comprovante?imprimir=1`
        setRecado({
          nivel: 'bom',
          texto: `Venda ${r.numero} fechada — ${brl(r.total)}${ganhou}`,
          link: { href: comprovante, rotulo: 'imprimir comprovante' },
        })
        setFechada({
          vendaId: r.vendaId,
          numero: r.numero,
          total: r.total,
          trocoCent: trocoAgora,
          pontosGanhos: r.pontosGanhos,
          formas: formasAgora,
          comprovante,
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
        // Volta quando o caixa desta loja fechou no meio do turno (outra aba,
        // outra pessoa) e quando a venda tem dinheiro sem caixa aberto: o
        // dinheiro precisa de gaveta com dono e hora.
        setRecado({
          nivel: 'critico',
          texto: 'O caixa desta loja está fechado. Abra o caixa para receber em dinheiro.',
          link: { href: `/${slug}/balcao?unidade=${unidadeId}`, rotulo: 'abrir o caixa' },
        })
      } else if (r.motivo === 'teto_do_plano') {
        setRecado({ nivel: 'critico', texto: r.recado, link: { href: `/${slug}/assinatura`, rotulo: 'ver o plano' } })
      } else if (r.motivo === 'desconto_acima_do_teto') {
        setRecado({
          nivel: 'critico',
          texto: `Desconto de ${r.percentual.toFixed(1)}% passa do teto de ${r.teto}%. Chame quem pode autorizar.`,
        })
      } else if (r.motivo === 'avulso_negado') {
        setRecado({ nivel: 'critico', texto: 'Item avulso só com permissão de desconto acima do teto.' })
      } else if (r.motivo === 'vendedor_invalido') {
        setRecado({ nivel: 'critico', texto: 'Esse vendedor não pode vender nesta loja.' })
      } else if (r.motivo === 'vale_recusado') {
        setRecado({ nivel: 'critico', texto: r.recado })
        setPagos((p) => p.filter((x) => x.forma !== 'VALE'))
      } else if (r.motivo === 'crediario_recusado') {
        setRecado({ nivel: 'critico', texto: r.recado })
      } else if (r.motivo === 'fora_da_loja') {
        // O cadastro mudou depois que o item entrou (alguém tirou o produto
        // desta loja agora há pouco). Mesma regra de cima: sai, com aviso, e a
        // pessoa confere o total e conclui de novo.
        const fora = new Set(r.itens)
        setCarrinho((c) => c.filter((l) => l.avulso || !fora.has(l.descricao)))
        setAviso(`Saiu do pedido: ${r.itens.join(', ')} — não é vendido na ${unidadeNome}. Confira o total e conclua de novo.`)
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
  useEffect(() => {
    estado.current = { podeConcluir, concluir, temItens: carrinho.length > 0 }
  })
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
        busca.current?.focus()
        return
      }
      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        setPedidoCliente((n) => n + 1)
        return
      }
      if (e.altKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        // O simples guarda o vendedor em "Mais opções": o pedido abre a
        // gaveta, e a tela leva o foco quando o seletor aparecer.
        setPedidoVendedor((n) => n + 1)
        vendedorRef.current?.focus()
        return
      }
      // Regra 10: o bipe acha a busca. Só tecla que escreve, sem modificador,
      // e só quando o foco não está num campo — senão a pessoa não conseguiria
      // digitar o desconto. Espaço fica de fora quando há um botão em foco,
      // porque espaço num botão é "apertar".
      if (e.ctrlKey || e.altKey || e.metaKey || e.key.length !== 1) return
      const ativo = document.activeElement as HTMLElement | null
      const escreve =
        ativo instanceof HTMLInputElement ||
        ativo instanceof HTMLTextAreaElement ||
        ativo instanceof HTMLSelectElement ||
        !!ativo?.isContentEditable
      if (escreve || !busca.current) return
      // Com uma janela aberta por cima (a escolha do tamanho, as opções), a
      // tecla é dela: puxar o foco para a busca de trás seria perder a janela.
      if (ativo?.closest('[role="dialog"]')) return
      const noBalcao = !ativo || ativo === document.body || !!raiz.current?.contains(ativo)
      if (!noBalcao) return
      if (e.key === ' ' && ativo && ativo !== document.body) return
      // Mudar o foco durante o keydown faz a própria tecla cair no campo novo.
      busca.current.focus()
    }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [])

  const itensNaVenda = carrinho.reduce((s, l) => s + (l.medida === 'UN' ? l.quantidade : 1), 0)

  return {
    // a busca
    termo,
    setTermo,
    achados,
    setAchados,
    enterNaBusca,
    // o pedido
    carrinho,
    lancar,
    mudarQtd,
    tirar,
    limpar,
    itensNaVenda,
    qtd,
    setQtd,
    // a conta
    conta,
    pontosCent,
    oferta,
    podeConcluir,
    // o pagamento
    pagos,
    setPagos,
    pagarCom,
    pagarSoCom,
    mudarPago,
    tirarPago,
    parcelasN,
    setParcelasN,
    pagarNoCrediario,
    mudarParcelas,
    // o vale
    vale: {
      aberto: valeAberto,
      setAberto: setValeAberto,
      codigo: valeCodigo,
      setCodigo: setValeCodigo,
      erro: valeErro,
      indo: valeIndo,
      usar: usarVale,
    },
    // o avulso
    avulso: {
      aberto: avulsoAberto,
      setAberto: setAvulsoAberto,
      nome: avulsoNome,
      setNome: setAvulsoNome,
      preco: avulsoPreco,
      setPreco: setAvulsoPreco,
      lancar: lancarAvulso,
    },
    // quem, e o resto
    desconto,
    setDesconto,
    cliente,
    setCliente,
    vendedorId,
    setVendedorId,
    pontosUsar,
    setPontosUsar,
    observacoes,
    setObservacoes,
    pedidoCliente,
    pedidoVendedor,
    // o que a tela diz
    recado,
    setRecado,
    fechada,
    setFechada,
    alerta,
    aviso,
    setAviso,
    voltou,
    incerta,
    // fechar
    concluir,
    indo,
    // os ganchos da tela
    busca,
    vendedorRef,
    primeiraForma,
    raiz,
    focarBusca,
  }
}

export type Venda = ReturnType<typeof useVenda>
