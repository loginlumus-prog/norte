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

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { ClienteNoBalcao, Achado, InicialDoBalcao } from './acoes'
import { procurar, fecharVenda, consultarValeAcao, fichaNoBalcao } from './acoes'
import { EVENTO_CATALOGO_MUDOU } from './semInternet'
import { lerFila, marcarErro, novaChave, podeIrParaFila, porNaFila, procurarGuardado, tirarDaFila, type VendaNaFila } from './semInternet'
import { chaveDoBalcao, guardar, recuperar, esquecer, lembrar, lembrado } from './guardar'
import { contar, cpfConfere, faltaCom, pagamentosParaEnviar, precoDe, brl, cent, NOME_DA_FORMA, rotuloDoPagamento } from './conta'
import type { Tabela } from '@/servidor/preco'
import type { Maquininha } from '@/servidor/maquininhas'
import { diaEmSP } from '@/servidor/dia'
import { primeiroVencimentoPadrao } from '@/servidor/crediario-agenda'
import { oferecer, valorEmCentavos, type Programa } from '@/servidor/pontos'
import type { Vendedor } from '@/servidor/equipe'
import { vendidoNaLoja } from '@/servidor/catalogo-loja'
import { escolhaDoEnter } from '@/servidor/etiqueta'
import { agruparAchados, tirarUmDoPedido, type ProdutoNaVitrine } from './vitrine'
import { plural } from '@/ui/texto'
import { usePalavras } from './palavras'
import { DINHEIRO_ILEGIVEL, lerDinheiro } from '@/servidor/dinheiro'

export type Pago = {
  forma: string
  valor: number
  referencia?: string
  rotulo?: string
  parcelas?: number
  /** Pix, débito, crédito: em qual maquininha caiu. Ver servidor/maquininhas.ts. */
  maquininha?: string | null
  /** Crediário: o dia do 1º vencimento ('AAAA-MM-DD'). */
  primeiroVencimento?: string | null
}

/**
 * As teclas da tela de pagamento, como no balcão de onde as lojas vêm: F2
 * dinheiro e F5 Pix são as mesmas do sistema de nota fiscal que costuma
 * rodar junto — a mão da vendedora já vai sozinha nelas. Mexer nesta lista
 * muda o dedo de quem trabalha: não reordene sem avisar.
 */
export const TECLAS_FORMA: Record<string, string> = {
  F2: 'DINHEIRO',
  F3: 'DEBITO',
  F4: 'CREDITO',
  F5: 'PIX',
  F6: 'CREDIARIO',
}
export const TECLA_DA_FORMA: Record<string, string> = Object.fromEntries(
  Object.entries(TECLAS_FORMA).map(([t, f]) => [f, t]),
)

/** As abas da ficha da cliente no balcão (FichaDaCliente.tsx). */
export type AbaDaFicha = 'resumo' | 'dados' | 'crediario' | 'historico'

/** O pedido de autorização aberto: por que a venda precisa do PIN de quem pode. */
export type PedidoDePin = { motivo: string; erro?: string }

/**
 * O que a página entrega do jeito desta loja: as regras que a tela precisa
 * saber para perguntar a coisa certa. O servidor confere tudo de novo.
 */
export type ConfigDoBalcao = {
  semForma: Tabela
  vendeSemEstoque: boolean
  maquininhas: Maquininha[]
  credito: { maxParcelas: number; jurosPct: number }
  /** A empresa pede o PIN de quem vendeu em toda venda. Nulo = não pede. */
  assinatura?: AssinaturaDoBalcao | null
}

/**
 * O PIN de quem vendeu, no fim de toda venda (ver "ASSINAR A VENDA" em
 * servidor/autorizacao.ts). `tenhoPin`: quem está na conta aberta já criou o
 * dela — sem ele, a janela vira "Crie o seu PIN para registrar vendas": o PIN
 * é a assinatura de quem vendeu, então a venda não grava sem ele.
 */
export type AssinaturaDoBalcao = {
  tenhoPin: boolean
  meuNome: string
  /**
   * Criar o PIN na hora pede a senha de entrar? Só de quem pode autorizar
   * exceção (dono, gerente…); o balcão cria só com o PIN. O servidor decide
   * de novo (`podeAutorizar`): isto só poupa um passo na tela.
   */
  pedeSenhaParaCriar: boolean
}

/** A janela do PIN da venda aberta: o porquê da última recusa, e se o freio travou. */
export type PedidoDeAssinatura = {
  erro?: string
  travado?: boolean
  /** Na criação do PIN: a que passo voltar depois da recusa (o PIN ou a senha de entrar). */
  refazer?: 'pin' | 'senha'
}

/**
 * O PIN digitado sem internet, à espera de a venda subir — SÓ na memória da
 * página, pela chave da venda. Nunca no aparelho: a fila (localStorage) não
 * leva PIN. Fechou a página, perdeu: a venda sobe sem ele e o servidor marca
 * "conferir assinatura" (ver `NovaVenda.assinatura` em venda.ts).
 */
const pinsDaFila = new Map<string, string>()

export type Linha = Achado & {
  quantidade: number
  avulso?: boolean
  /**
   * A linha de uma encomenda ("Receber no balcão"): o que falta pagar dela.
   * Não vai para o servidor como item — vai o id, e o servidor lança a linha
   * com o valor que ELE lê da encomenda. Quantidade fixa em 1.
   */
  encomendaId?: string
}

/** A encomenda que abriu o balcão, como a página a entrega. */
export type EncomendaNoPedido = {
  id: string
  codigo: string
  descricao: string
  clienteNome: string
  falta: number
  /** O pedido do catálogo: os produtos entram como linhas de verdade. */
  itens?: { achado: Achado; quantidade: number }[]
  /** Itens do pedido que a loja não vende mais (não entraram). */
  faltaram?: number
}

const linhaDaEncomenda = (e: EncomendaNoPedido): Linha => ({
  id: `encomenda-${e.id}`,
  codigo: e.codigo,
  descricao: `Encomenda ${e.codigo}: ${e.descricao}`,
  medida: 'UN',
  preco: e.falta,
  precos: { vista: e.falta, cartao: e.falta, crediario: e.falta },
  saldo: 1,
  quantidade: 1,
  avulso: true,
  encomendaId: e.id,
})

export type Recado = {
  nivel: 'bom' | 'critico'
  texto: string
  /** "imprimir comprovante", depois de fechar. */
  link?: { href: string; rotulo: string }
  /** Um segundo papel ao lado do primeiro: o carnê da venda no crediário. */
  outro?: { href: string; rotulo: string }
}

/** A venda que acabou de fechar — o que a tela de sucesso do simples mostra. */
export type Fechada = {
  vendaId: string
  numero: number
  total: number
  trocoCent: number
  pontosGanhos: number
  /** "Crediário 3×", "Crédito 2× · Stone", "Dividido: Pix + Dinheiro" — ver conta.ts. */
  pagamento: string
  comprovante: string
  /** A venda teve crediário: o carnê que a cliente assina. Nulo sem crediário. */
  carne: string | null
  /** Guardada no aparelho, sem internet: ainda sem número nem comprovante. */
  semInternet?: boolean
}

export const FORMAS = [
  { chave: 'DINHEIRO', titulo: 'Dinheiro' },
  { chave: 'PIX', titulo: 'Pix' },
  { chave: 'DEBITO', titulo: 'Débito' },
  { chave: 'CREDITO', titulo: 'Crédito' },
] as const

export const tituloDaForma = (p: { forma: string; rotulo?: string }) =>
  p.rotulo ?? FORMAS.find((f) => f.chave === p.forma)?.titulo ?? NOME_DA_FORMA[p.forma] ?? p.forma

/** A recusa da fila em palavras de gente, para quem for resolver. */
function motivoEmPalavras(motivo: string): string {
  const m: Record<string, string> = {
    sem_itens: 'A venda chegou sem itens.',
    pagamento_nao_fecha: 'A conta não fecha com o preço de agora (o preço mudou?).',
    preco_mudou: 'O preço de um produto mudou depois que a venda foi montada.',
    caixa_fechado: 'Não há caixa aberto na loja: abra o caixa para esta venda subir.',
    desconto_acima_do_teto: 'O desconto passa do teto da loja: precisa de autorização.',
    avulso_negado: 'Item fora do cadastro precisa de autorização.',
    vendedor_invalido: 'O vendedor escolhido não pode vender nesta loja.',
    fora_da_loja: 'Um produto não é vendido nesta loja.',
    uso_interno: 'Um item é material de uso e não se vende.',
    teto_do_plano: 'O plano chegou ao teto de vendas do mês.',
    loja_nao_vende: 'A loja não vende (depósito ou fechada).',
    item_inativo: 'Um produto foi desativado no cadastro.',
    quantidade_fracionada: 'Quantidade quebrada em produto por unidade.',
    crediario_pede_autorizacao: 'O crediário passa do limite da cliente ou ela tem parcela atrasada: precisa de autorização.',
  }
  return m[motivo] ?? 'O servidor recusou esta venda.'
}

export function useVenda({
  slug,
  unidadeId,
  unidadeNome,
  usuarioId,
  caixaId,
  programa,
  vendedores,
  crediario,
  inicial,
  encomenda = null,
  veAssinatura = false,
  semForma = 'vista',
  vendeSemEstoque = false,
  maquininhas = [],
  credito = { maxParcelas: 1, jurosPct: 0 },
  assinatura = null,
}: {
  /** A empresa pede o PIN de quem vendeu em toda venda. */
  assinatura?: AssinaturaDoBalcao | null
  /** A tabela mostrada antes de escolher a forma: a mais cara da loja. Ver conta.ts. */
  semForma?: Tabela
  /** A empresa vende o que o sistema diz que acabou (avisa, pergunta e deixa). */
  vendeSemEstoque?: boolean
  /** As maquininhas desta loja (Configurações). Vazio = não pergunta. */
  maquininhas?: Maquininha[]
  /** Crédito: em até quantas vezes, e o juro do parcelamento (0 = sem juro). */
  credito?: { maxParcelas: number; jurosPct: number }
  /** Aberto por "Receber no balcão", em Encomendas: o que falta dela entra no pedido. */
  encomenda?: EncomendaNoPedido | null
  /** Pode abrir Assinatura — decide o link do recado de "teto do plano". */
  veAssinatura?: boolean
  slug: string
  unidadeId: string
  /**
   * O balcão aberto pela Agenda ("Atender e cobrar"): o serviço e o cliente
   * já na venda, e o horário que ela cobra.
   */
  inicial?: InicialDoBalcao | null
  /** Para dizer "não é vendido na Loja Centro", e não "nesta loja". */
  unidadeNome: string
  usuarioId: string
  caixaId: string | null
  programa: Programa
  vendedores: Vendedor[] | null
  crediario: { maxParcelas: number; diasEntre?: number } | null
}) {
  // Os recados falam a palavra do ramo: "Atendimento 12 fechado" na recepção.
  const palavras = usePalavras()
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
  /** O desconto digitado é em %? Guardado como %, ver `Ajustes` em conta.ts. */
  const [descontoEmPct, setDescontoEmPct] = useState(false)
  const [acrescimo, setAcrescimo] = useState(0)
  const [cliente, setCliente_] = useState<ClienteNoBalcao | null>(null)
  /** O que a busca de cliente não traz: CPF na ficha e os vales dela que valem aqui. */
  const [ficha, setFicha] = useState<{ temCpf: boolean; vales: { codigo: string; saldo: number }[]; falta?: string[] } | null>(null)
  /** O CPF ditado no crediário, para a ficha sem CPF. Vai com a venda. */
  const [cpf, setCpf] = useState('')
  const [vendedorId, setVendedorId_] = useState(usuarioId)
  /** Dividindo o pagamento em duas formas (F8). */
  const [dividindo, setDividindo] = useState(false)
  /** O PIN pedido — aberto quando o servidor diz que a venda precisa de autorização. */
  const [pedidoDePin, setPedidoDePin] = useState<PedidoDePin | null>(null)
  /** A janela do PIN de quem vendeu — aberta no "Concluir", antes de mandar. */
  const [assinando, setAssinando] = useState<PedidoDeAssinatura | null>(null)
  /**
   * A assinatura DESTA venda, enquanto ela não fecha: a venda que volta
   * pedindo a autorização da gerente é mandada de novo com o mesmo PIN, sem
   * perguntar duas vezes. Some ao fechar, ao cancelar e ao limpar — nada
   * passa de uma venda para a outra.
   */
  const assinaturaDaVenda = useRef<{
    pin?: string
    travado?: boolean
    /** Sem internet e sem PIN: sobe na fila, no nome da conta aberta, para conferir. */
    semInternet?: boolean
    criarPin?: { pin: string; senha: string }
  } | null>(null)
  // Quem está na conta aberta tem PIN? Nasce do servidor e vira quando o PIN
  // nasce aqui, ou quando o servidor conta que já existe (criado em outra tela).
  const [tenhoPin, setTenhoPin] = useState(assinatura?.tenhoPin ?? true)
  /** "O sistema diz que acabou — vende assim mesmo?", antes de mandar a venda. */
  const [perguntaSemEstoque, setPerguntaSemEstoque] = useState<string[] | null>(null)
  const [pontosUsar, setPontosUsar] = useState(0)
  const [observacoes, setObservacoes] = useState('')
  /** O horário da agenda que esta venda cobra. Some ao fechar, ao limpar, e quando a pessoa tira. */
  const [agendamentoId, setAgendamentoId] = useState<string | null>(null)
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
  /**
   * A ficha da cliente escolhida, em tela cheia (FichaDaCliente.tsx): a aba
   * que abre, ou nula. Alt+N com a cliente já escolhida abre aqui — sem
   * cliente, Alt+N continua sendo "procurar cliente".
   */
  const [fichaAberta, setFichaAberta] = useState<AbaDaFicha | null>(null)
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
  /** Os ids lançados, o mais novo por último — é o que o "tirar um" desfaz (ver `tirarUm`). */
  const lancados = useRef<string[]>([])

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
    if (!g) {
      // Veio da Agenda e não havia venda pela metade: o horário entra.
      if (inicial) {
        setCarrinho(inicial.itens.map((a) => ({ ...a, quantidade: 1 })))
        setCliente(inicial.cliente)
        setAgendamentoId(inicial.agendamentoId)
      }
      return
    }
    setCarrinho(g.carrinho as Linha[])
    setPagos(g.pagos)
    setDesconto(g.desconto)
    setDescontoEmPct(!!g.descontoEmPct)
    setAcrescimo(g.acrescimo ?? 0)
    setCliente_(g.cliente)
    setPontosUsar(g.pontosUsar)
    setAgendamentoId(g.agendamentoId ?? null)
    setVoltou(g.em)
    setIncerta(!!g.fechando)
    // Havia uma venda pela metade de OUTRA coisa: ela não some por causa do
    // horário. A pessoa conclui ou limpa, e volta à Agenda para cobrar.
    if (inicial && g.agendamentoId !== inicial.agendamentoId) {
      setAviso(`Havia uma venda em andamento neste balcão, e ela voltou. Conclua ou limpe essa venda antes de cobrar o horário de ${inicial.rotulo}.`)
    }
    // Só na montagem: o horário é do endereço que abriu a tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  // A encomenda do endereço (`?encomenda=`) entra como a linha do que falta.
  // Mesma regra do horário da Agenda: se havia uma venda pela metade de
  // outra coisa, ela volta e a encomenda espera — misturar as duas cobraria
  // o bolo de um cliente na conta de outro.
  useEffect(() => {
    if (!encomenda) return
    const g = recuperar(chave)
    const pela = (g?.carrinho ?? []) as Linha[]
    if (pela.some((l) => l.encomendaId === encomenda.id)) return
    if (pela.length > 0) {
      setAviso(
        `Havia uma venda em andamento neste balcão, e ela voltou. Conclua ou limpe essa venda antes de receber a encomenda de ${encomenda.clienteNome}.`,
      )
      return
    }
    setCarrinho((c) =>
      c.some((l) => l.encomendaId)
        ? c
        : [...c, linhaDaEncomenda(encomenda), ...(encomenda.itens ?? []).map((i) => ({ ...i.achado, quantidade: i.quantidade }))],
    )
    if (encomenda.faltaram) {
      setAviso(
        `${encomenda.faltaram === 1 ? 'Um item' : `${encomenda.faltaram} itens`} do pedido de ${encomenda.clienteNome} não ${encomenda.faltaram === 1 ? 'é' : 'são'} mais vendido${encomenda.faltaram === 1 ? '' : 's'} nesta loja e ficou de fora — e o pedido só fecha com todos os produtos dele. Combine com a cliente: cancele esta encomenda em Encomendas e venda o que ela levar.`,
      )
    }
    // Só na montagem: a encomenda é do endereço que abriu a tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, encomenda?.id])

  useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false
      return
    }
    if (carrinho.length === 0) esquecer(chave)
    else guardar(chave, { carrinho, pagos, desconto, descontoEmPct, acrescimo, cliente, pontosUsar, agendamentoId })
  }, [chave, carrinho, pagos, desconto, descontoEmPct, acrescimo, cliente, pontosUsar, agendamentoId])

  // ── a vendedora do turno fica no aparelho ────────────────
  // Ela é a mesma a manhã inteira: escolher de novo a cada venda é um toque
  // cobrado de quem já respondeu. Por LOJA e por aparelho — o computador do
  // balcão lembra a dele. Quem saiu da equipe (não está mais na lista) não
  // volta: o seletor cai em quem está operando, e a venda não sai no nome de
  // quem não trabalha mais aqui.
  const chaveVendedor = `norte:balcao:vendedor:${slug}:${unidadeId}`
  useEffect(() => {
    if (!vendedores) return
    const id = lembrado(chaveVendedor)
    if (id && vendedores.some((x) => x.id === id)) setVendedorId_(id)
    // Só ao abrir a loja: trocar de vendedora depois é escolha da pessoa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveVendedor])
  function setVendedorId(id: string) {
    setVendedorId_(id)
    lembrar(chaveVendedor, id)
  }

  // ── a maquininha também ──────────────────────────────────
  // Uma por forma (o Pix cai numa conta, o cartão em outra): escolhida uma
  // vez, vem marcada nas próximas vendas deste aparelho.
  const chaveMaquininha = `norte:balcao:maquininha:${slug}:${unidadeId}`
  function maquininhaPara(forma: string): string | null {
    const daForma = maquininhas.filter((m) => (m.formas as string[]).includes(forma))
    if (daForma.length === 0) return null
    let guardadas: Record<string, string> = {}
    try {
      guardadas = JSON.parse(lembrado(chaveMaquininha) ?? '{}') as Record<string, string>
    } catch {}
    return daForma.find((m) => m.nome === guardadas[forma])?.nome ?? daForma[0]!.nome
  }
  function mudarMaquininha(i: number, nome: string) {
    const p = pagos[i]
    if (!p) return
    setPagos((x) => x.map((y, j) => (j === i ? { ...y, maquininha: nome } : y)))
    let guardadas: Record<string, string> = {}
    try {
      guardadas = JSON.parse(lembrado(chaveMaquininha) ?? '{}') as Record<string, string>
    } catch {}
    lembrar(chaveMaquininha, JSON.stringify({ ...guardadas, [p.forma]: nome }))
  }
  /** Uma forma nova, já com a maquininha lembrada e (no crédito) à vista. */
  const novoPago = (forma: string, valor: number): Pago => ({
    forma,
    valor,
    ...(maquininhaPara(forma) ? { maquininha: maquininhaPara(forma) } : {}),
    ...(forma === 'CREDITO' ? { parcelas: 1 } : {}),
  })

  // ── a ficha da cliente ───────────────────────────────────
  // Escolhida a cliente, o balcão pergunta o que a busca não traz. O vale
  // dela aparece sozinho no pagamento.
  function setCliente(c: ClienteNoBalcao | null) {
    setCliente_(c)
    setCpf('')
    if (!c) {
      setFicha(null)
      setFichaAberta(null)
    }
  }
  // Mudou na ficha (o CPF que faltava, o telefone novo): o pedido fica com a
  // mesma cliente, com o nome de agora, e a pergunta do CPF no crediário some.
  const [fichaMudou, setFichaMudou] = useState(0)
  function atualizarCliente(dados: { nome: string; telefone: string | null }) {
    setCliente_((c) => (c ? { ...c, nome: dados.nome, telefone: dados.telefone } : c))
    setFichaMudou((n) => n + 1)
  }
  useEffect(() => {
    if (!cliente) return
    let vivo = true
    fichaNoBalcao(slug, cliente.id, unidadeId)
      .then((f) => vivo && setFicha(f))
      .catch(() => vivo && setFicha(null))
    return () => {
      vivo = false
    }
  }, [cliente?.id, slug, unidadeId, fichaMudou])

  // Busca conforme digita, com uma pausa curta para não consultar a cada tecla.
  useEffect(() => {
    const t0 = termo.trim()
    if (t0.length < 2) {
      setBusca_({ de: '', itens: [] })
      return
    }
    const t = setTimeout(() => {
      procurar(slug, unidadeId, t0)
        // Sem internet, a busca sai do catálogo guardado no aparelho.
        .catch(async () => (await procurarGuardado(slug, unidadeId, t0)) ?? [])
        .then((itens) => setBusca_({ de: t0, itens }))
        .catch(() => setBusca_({ de: t0, itens: [] }))
    }, 180)
    return () => clearTimeout(t)
  }, [termo, slug, unidadeId])

  // ── sem internet: a fila do aparelho (ver semInternet.ts) ──
  // A chave desta venda: nasce no primeiro "Concluir" e vale até ela entrar.
  // Mandar de novo (a rede caiu no meio, a fila subiu outra vez) com a mesma
  // chave devolve a venda que já entrou, em vez de gravar outra.
  const chaveDaVenda = useRef<string | null>(null)
  const [fila, setFila] = useState<VendaNaFila[]>([])
  const [online, setOnline] = useState(true)
  const subindo = useRef(false)

  const subirFila = useCallback(async (tambemRecusadas = false) => {
    if (subindo.current) return
    subindo.current = true
    try {
      for (const item of lerFila(slug)) {
        if (item.erro && !tambemRecusadas) continue
        let r: Awaited<ReturnType<typeof fecharVenda>>
        try {
          // O PIN digitado sem internet, se a página ainda o tem na memória.
          const pin = pinsDaFila.get(item.chave)
          r = await fecharVenda(slug, {
            ...(item.dados as Parameters<typeof fecharVenda>[1]),
            chave: item.chave,
            offline: { quando: item.quando },
            assinatura: pin ? { pin } : null,
          })
        } catch {
          break // ainda sem internet: tenta na próxima
        }
        // Subiu: o PIN não tem mais para que ficar. Recusada (o caixa
        // fechado), ele fica para o "mandar de novo" — ainda só na memória.
        if (r.ok) {
          pinsDaFila.delete(item.chave)
          tirarDaFila(slug, item.chave)
        } else marcarErro(slug, item.chave, 'recado' in r && typeof r.recado === 'string' ? r.recado : motivoEmPalavras(r.motivo))
      }
    } finally {
      subindo.current = false
      setFila(lerFila(slug))
    }
  }, [slug])

  useEffect(() => {
    // O ajudante do navegador que guarda a página do balcão para abrir sem
    // internet (public/sw.js). Só em produção: no desenvolvimento os arquivos
    // mudam a cada salvamento, e guardá-los só atrapalharia.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    setFila(lerFila(slug))
    setOnline(navigator.onLine)
    const voltou = () => {
      setOnline(true)
      void subirFila()
    }
    const caiu = () => setOnline(false)
    window.addEventListener('online', voltou)
    window.addEventListener('offline', caiu)
    const t = setInterval(() => void subirFila(), 20_000)
    void subirFila()
    return () => {
      window.removeEventListener('online', voltou)
      window.removeEventListener('offline', caiu)
      clearInterval(t)
    }
  }, [slug, subirFila])

  function descartarDaFila(chave: string) {
    pinsDaFila.delete(chave)
    tirarDaFila(slug, chave)
    setFila(lerFila(slug))
  }

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
  const ajustes = { desconto, descontoEmPct, acrescimo }
  const conta = contar(carrinho, pagos, ajustes, pontosCent, semForma)
  const { tabela, faltaCent, trocoCent, sobrouSemDinheiro } = conta
  const oferta = cliente ? oferecer(cliente.pontos, conta.comDescontoCent, programa) : null
  // O CPF digitado que não confere segura a venda aqui (o servidor recusaria
  // de novo): é o carnê que vai levar esse número.
  const cpfRuim = cpf.trim() !== '' && !cpfConfere(cpf)
  const temCrediario = pagos.some((p) => p.forma === 'CREDIARIO')

  const podeConcluir =
    carrinho.length > 0 && faltaCent <= 0 && !sobrouSemDinheiro && !!caixaId && !indo && !(temCrediario && cpfRuim)

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
    lancados.current = [...lancados.current.slice(-49), a.id]
    // O aviso é agora, não no fim: quem lançou 3 e só tem 1 precisa saber
    // com a pessoa na frente, não depois de escolher o pagamento. Na loja que
    // vende o que o sistema diz que acabou, o aviso não trava: a peça está na
    // mão, e quem confere o estoque depois é a gerente.
    // Item que NUNCA teve estoque lançado (a sorveteria que não conta o estoque)
    // não "acabou": não é controlado. Na loja que vende sem estoque, ele não
    // gera aviso — avisar "acabou" em toda venda ensina a ignorar o aviso.
    if (novaQtd > a.saldo && !(vendeSemEstoque && a.semLancamento)) {
      setAlerta(
        vendeSemEstoque
          ? `O sistema diz que ${a.saldo <= 0 ? `acabou ${a.descricao}` : `só tem ${a.saldo} de ${a.descricao}`}. Se a peça está na mão, pode vender — fica anotado para conferir o estoque.`
          : a.saldo <= 0
            ? `${a.descricao} está sem estoque nesta loja. ${palavras.aVenda.replace(/^./, (x) => x.toUpperCase())} não vai fechar assim.`
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
  async function enterNaBusca(): Promise<Achado | ProdutoNaVitrine | null> {
    const t = termo.trim()
    if (t.length < 2) return null
    let itens = busca_.de === t ? busca_.itens : null
    if (!itens) {
      try {
        itens = await procurar(slug, unidadeId, t)
      } catch {
        itens = (await procurarGuardado(slug, unidadeId, t).catch(() => null)) ?? []
      }
    }
    // A etiqueta do PRODUTO (um número para a grade inteira — ver
    // etiqueta.ts) não lança sozinha quando há mais de um tamanho ou cor: a
    // grade fica na lista e a vendedora toca no que está na mão.
    const { item, varios } = escolhaDoEnter(t, itens)
    if (varios > 0) {
      setBusca_({ de: t, itens })
      // A etiqueta é de um produto só: abre a escolha de tamanho dele, como
      // tocar no cartão. Etiqueta que cobre produtos diferentes (raro) fica na
      // lista, com o aviso.
      const grades = agruparAchados(itens.filter((a) => !a.foraDaLoja)).filter((b) => b.tipo === 'grade')
      if (grades.length === 1 && grades[0]!.tipo === 'grade') return grades[0]!.produto
      setAlerta(`A etiqueta ${t} tem ${varios} tamanhos ou cores. Toque no da peça.`)
      return null
    }
    if (!item) setAlerta(`Nada encontrado com “${t}”. Confira o código ou digite o nome.`)
    return item
  }

  function lancarAvulso() {
    const nome = avulsoNome.trim()
    // A régua de todo campo de dinheiro: "1.234,56" é mil e tanto, e o que
    // não dá para ler é avisado — `Number` dava NaN e o clique não fazia nada.
    const preco = lerDinheiro(avulsoPreco)
    if (!nome) return
    if (preco === null) {
      setAlerta(`Preço do item avulso: ${DINHEIRO_ILEGIVEL}`)
      return
    }
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
    // A encomenda é uma só: "2 × o bolo" cobraria o que falta duas vezes.
    setCarrinho((c) => c.map((l) => (l.id === id && !l.encomendaId ? { ...l, quantidade: Math.max(q, 0) } : l)))
  }

  const tirar = (id: string) => {
    setRecado(null)
    setCarrinho((c) => c.filter((l) => l.id !== id))
  }

  // ── tirar um (o clique direito da vitrine) ───────────────
  // Os ids na ordem em que entraram, o mais novo por último: com P e M da
  // mesma blusa no pedido, o clique direito desfaz o ÚLTIMO toque, e não o
  // primeiro (ver vitrine.ts, `tirarUmDoPedido`). Fica só na memória: o
  // pedido recuperado do aparelho cai na ordem das linhas, que é quase igual.
  // (`lancados` mora junto dos outros ganchos, lá em cima.)
  /** Tira uma unidade de uma destas peças (a última lançada). Devolve se tirou. */
  function tirarUm(ids: readonly string[]): boolean {
    const novo = tirarUmDoPedido(carrinho, ids, lancados.current)
    if (!novo) return false
    setRecado(null)
    setCarrinho(novo)
    return true
  }

  function pagarCom(forma: string) {
    // Clicar na forma preenche o que FALTA. É o gesto mais comum: a pessoa
    // escolhe como vai receber e o valor já vem certo. Mas o valor fica
    // EDITÁVEL: em dinheiro o cliente entrega R$ 100 numa venda de R$ 83, e o
    // caixa precisa digitar os 100 para ver o troco.
    const falta = faltaCom(carrinho, pagos, forma, ajustes, pontosCent) / 100
    if (falta <= 0) return
    setPagos((p) => [...p, novoPago(forma, falta)])
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
    const falta = faltaCom(carrinho, manter, forma, ajustes, pontosCent)
    setPagos(falta > 0 ? [...manter, novoPago(forma, falta / 100)] : manter)
  }

  /** Em quantas vezes no crédito (até o máximo da loja). */
  const mudarParcelasCredito = (i: number, n: number) =>
    setPagos((p) =>
      p.map((x, j) =>
        j === i && x.forma === 'CREDITO'
          ? { ...x, parcelas: Math.min(Math.max(1, Math.floor(n) || 1), credito.maxParcelas), rotulo: n > 1 ? `Crédito ${n}×` : undefined }
          : x,
      ),
    )

  /** O 1º vencimento do crediário ('AAAA-MM-DD'). */
  const mudarPrimeiroVencimento = (dia: string) =>
    setPagos((p) => p.map((x) => (x.forma === 'CREDIARIO' ? { ...x, primeiroVencimento: dia } : x)))

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
    const falta = faltaCom(carrinho, base, 'CREDIARIO', ajustes, pontosCent)
    if (falta <= 0) return
    setRecado(null)
    setParcelasN(n)
    setPagos([
      ...base,
      {
        forma: 'CREDIARIO',
        valor: falta / 100,
        parcelas: n,
        rotulo: `Crediário ${n}×`,
        // Hoje + 30 (o intervalo da loja); a vendedora muda na hora.
        primeiroVencimento: primeiroVencimentoPadrao(diaEmSP(), crediario.diasEntre ?? 30),
      },
    ])
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
  async function usarVale(codigoDireto?: string) {
    const codigo = (codigoDireto ?? valeCodigo).trim()
    if (!codigo) return
    setValeIndo(true)
    setValeErro(null)
    try {
      const r = await consultarValeAcao(slug, codigo, unidadeId)
      if (!r.ok) {
        setValeErro(
          r.motivo === 'nao_achado' ? 'Vale não encontrado. Confira o código.'
          : r.motivo === 'zerado' ? 'Este vale já foi todo usado.'
          : r.motivo === 'outra_loja' ? `Este vale é da ${r.loja} e só vale lá.`
          // Muitos códigos errados em seguida: a consulta trava por uns minutos.
          : r.motivo === 'bloqueado' ? r.recado
          : 'Este vale venceu.',
        )
        if (codigoDireto) setValeAberto(true)
        return
      }
      if (pagos.some((p) => p.referencia === r.codigo)) {
        setValeErro('Esse vale já está nesta venda.')
        return
      }
      const falta = faltaCom(carrinho, pagos, 'VALE', ajustes, pontosCent)
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

  /** O vale da cliente que ainda não está nesta venda — o que o F7 usa. */
  const valeDaCliente = ficha?.vales.find((x) => !pagos.some((p) => p.referencia === x.codigo)) ?? null

  function limpar() {
    setAviso(null)
    setVoltou(null)
    setIncerta(false)
    setCarrinho([])
    setPagos([])
    setDesconto(0)
    setDescontoEmPct(false)
    setAcrescimo(0)
    setDividindo(false)
    setPedidoDePin(null)
    setAssinando(null)
    assinaturaDaVenda.current = null
    setPerguntaSemEstoque(null)
    setCliente(null)
    setPontosUsar(0)
    setObservacoes('')
    setAgendamentoId(null)
    setTermo('')
    setAchados([])
    setAlerta(null)
    focarBusca()
  }

  /** As linhas que passam do que o sistema diz ter (não conta avulso nem encomenda). */
  // O item que nunca teve estoque lançado não entra na conta: não é "acabou",
  // é sem controle (ver `lancar`). Sem isto, toda venda da sorveteria perguntava
  // "vende assim mesmo?" — e a pergunta, abaixo da tela, parecia botão quebrado.
  const curtas = carrinho.filter((l) => !l.avulso && l.quantidade > l.saldo && !(vendeSemEstoque && l.semLancamento))

  function concluir(o: { pin?: string; semEstoqueOk?: boolean } = {}) {
    if (!podeConcluir) return
    // Vendendo o que o sistema diz que acabou: pergunta UMA vez, com os nomes,
    // antes de mandar. É o "tem certeza?" de quem está com a peça na mão.
    if (vendeSemEstoque && curtas.length > 0 && !o.semEstoqueOk && !o.pin) {
      setPerguntaSemEstoque(curtas.map((l) => l.descricao))
      return
    }
    setPerguntaSemEstoque(null)
    // A empresa pede o PIN de quem vendeu: sem ele, nada sai daqui. A janela
    // do PIN é a última pergunta — e é ela que manda (ver `assinar`).
    if (assinatura && !assinaturaDaVenda.current) {
      setAssinando({})
      return
    }
    const assinaturaAgora = assinaturaDaVenda.current
    // A janela do PIN fecha ao mandar — menos a da criação do PIN: ela guarda o
    // que a pessoa digitou (o PIN novo), para a recusa do servidor (senha que não
    // confere) não obrigar a digitar tudo de novo. Fecha quando a venda entra.
    if (!assinaturaAgora?.criarPin) setAssinando(null)
    // A foto do que a tela mostrou: o troco e as formas vão para a tela de
    // sucesso depois que o carrinho já foi limpo.
    const trocoAgora = trocoCent
    const pagamentoAgora = rotuloDoPagamento(pagos)
    const comCarne = pagos.some((p) => p.forma === 'CREDIARIO')
    const guardado = { carrinho, pagos, desconto, descontoEmPct, acrescimo, cliente, pontosUsar, agendamentoId }
    // Marca o guardado como "concluindo" ANTES de pedir: se a tela cair entre
    // o pedido e a resposta, quem abrir de novo fica sabendo.
    guardar(chave, { ...guardado, fechando: Date.now() })
    setIncerta(false)
    chaveDaVenda.current ??= novaChave()
    const chaveVenda = chaveDaVenda.current
    comecar(async () => {
      let r: Awaited<ReturnType<typeof fecharVenda>>
      let enviado: Parameters<typeof fecharVenda>[1] | null = null
      try {
        r = await fecharVenda(slug, enviado = {
        chave: chaveVenda,
        unidadeId,
        caixaId,
        // Em reais, já calculado na tabela da forma (o % vira dinheiro aqui).
        desconto: conta.descontoCent / 100,
        acrescimo: conta.acrescimoCent / 100,
        // O PIN vai só nesta chamada e não fica em lugar nenhum da tela.
        pin: o.pin ?? null,
        assinatura: assinaturaAgora?.criarPin
          ? { criarPin: assinaturaAgora.criarPin }
          : assinaturaAgora?.pin
            ? { pin: assinaturaAgora.pin }
            : assinaturaAgora?.travado
              ? { travado: true }
              : null,
        clienteCpf: temCrediario && cpf.trim() && cpfConfere(cpf) ? cpf : null,
        clienteId: cliente?.id ?? null,
        vendedorId: vendedores ? vendedorId : null,
        pontosUsar,
        observacoes,
        agendamentoId,
        // A linha da encomenda não vai como item: vai o id, e o servidor
        // lança o que falta com o valor que ele lê.
        encomendaId: carrinho.find((l) => l.encomendaId)?.encomendaId ?? null,
        itens: carrinho.filter((l) => !l.encomendaId).map((l) =>
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
        // O troco não é pagamento (o que entra é o que FICA na gaveta), mas vai
        // junto para o comprovante e a ficha da venda poderem mostrá-lo depois.
        troco: trocoAgora / 100,
        })
      } catch {
        setAssinando(null)
        // Caiu a rede. Com a chave, mandar de novo não duplica: a venda vai
        // para a fila do aparelho e sobe sozinha quando a conexão voltar — se
        // for uma venda que se faz sem internet (dinheiro, Pix, cartão).
        if (enviado && podeIrParaFila({ ...enviado, pin: o.pin ?? null })) {
          // A assinatura NÃO vai para a fila (o aparelho): o PIN fica só na
          // memória desta página até a venda subir (ver `pinsDaFila`).
          const { chave: _c, assinatura: _a, ...dados } = enviado
          if (assinaturaAgora?.pin) pinsDaFila.set(chaveVenda, assinaturaAgora.pin)
          const foi = porNaFila(slug, {
            chave: chaveVenda,
            unidadeId,
            quando: Date.now(),
            total: conta.aPagarCent / 100,
            resumo: `${plural(carrinho.length, 'item', 'itens')}${pagamentoAgora ? ` · ${pagamentoAgora}` : ''}`,
            dados,
          })
          if (foi) {
            setFila(lerFila(slug))
            chaveDaVenda.current = null
            setFechada({
              vendaId: chaveVenda,
              numero: 0,
              total: conta.aPagarCent / 100,
              trocoCent: trocoAgora,
              pontosGanhos: 0,
              pagamento: pagamentoAgora,
              comprovante: '',
              carne: null,
              semInternet: true,
            })
            setRecado({
              nivel: 'bom',
              texto: `Sem internet: ${palavras.aVenda} de ${brl(conta.aPagarCent / 100)} ficou guardad${palavras.vendaFeminina ? 'a' : 'o'} neste aparelho e sobe sozinh${palavras.vendaFeminina ? 'a' : 'o'} quando a conexão voltar. O comprovante sai depois, em ${palavras.Vendas}.`,
            })
            limpar()
            return
          }
        }
        // Não pôde ir para a fila (crediário, vale, pontos, PIN, encomenda ou
        // o aparelho sem lugar): não dá para saber se o servidor gravou. A marca
        // de "concluindo" fica, e a tela diz para conferir antes de repetir.
        assinaturaDaVenda.current = null
        setIncerta(true)
        setRecado({
          nivel: 'critico',
          texto: `A conexão caiu enquanto ${palavras.aVenda} era ${palavras.vendaFeminina ? 'concluída' : 'concluído'}. Confira em ${palavras.Vendas} se ${palavras.vendaFeminina ? 'ela' : 'ele'} entrou antes de concluir de novo.`,
          link: { href: `/${slug}/vendas`, rotulo: `abrir ${palavras.Vendas}` },
        })
        return
      }

      // Recusada: o servidor não gravou nada, então a marca sai.
      if (!r.ok) guardar(chave, guardado)
      // A janela da criação do PIN só continua aberta para a recusa dela mesma.
      if (!r.ok && r.motivo !== 'assinatura_pedida') setAssinando(null)

      // A autorização foi usada (ou recusada): o pedido de PIN fecha, ou
      // fica aberto com a frase do porquê.
      if (r.ok || r.motivo !== 'autorizacao_recusada') setPedidoDePin(null)

      // A assinatura só segue para a próxima tentativa quando a venda volta
      // pedindo a autorização da gerente (é a mesma venda, mandada de novo).
      // Qualquer outra resposta: o próximo "Concluir" pede o PIN outra vez.
      if (
        r.ok ||
        !['desconto_acima_do_teto', 'avulso_negado', 'autorizacao_recusada', 'crediario_pede_autorizacao'].includes(r.motivo)
      ) {
        assinaturaDaVenda.current = null
      }

      // O PIN nasceu junto com a venda: daqui em diante a conta tem PIN.
      if (r.ok && assinaturaAgora?.criarPin) setTenhoPin(true)

      if (r.ok) {
        chaveDaVenda.current = null
        // O ganho aparece no recado porque e a hora de falar: "voce ja tem
        // 1.240 pontos" dito no balcao e o que faz a pessoa voltar. Guardado
        // so no banco, o programa nao existe para quem compra.
        const ganhou = r.pontosGanhos > 0 ? ` · ganhou ${plural(r.pontosGanhos, 'ponto', 'pontos')}` : ''
        const autorizada = r.autorizadoPor ? ` · autorizado por ${r.autorizadoPor}` : ''
        // Com o PIN na venda, em nome de quem ela ficou — a confirmação de que
        // a comissão foi para a pessoa certa.
        const quemVendeu = assinatura && r.vendedor ? ` · ${r.vendedor}` : ''
        const conferir = r.semEstoque.length > 0
          ? ` · ${plural(r.semEstoque.length, 'item foi', 'itens foram')} para “Vendido sem estoque — conferir”`
          : ''
        // O troco some da tela junto com o pedido: o recado guarda o valor
        // até a gaveta fechar (a cara simples já diz o troco no "concluída").
        const troco = trocoAgora > 0 ? ` · troco ${brl(trocoAgora / 100)}` : ''
        const comprovante = `/${slug}/vendas/${r.vendaId}/comprovante?imprimir=1`
        // No crediário, o carnê é o outro papel: o que a cliente assina e leva.
        const carne = comCarne ? `/${slug}/vendas/${r.vendaId}/carne?imprimir=1` : null
        setRecado({
          nivel: 'bom',
          texto: `${palavras.Venda} ${r.numero} ${palavras.vendaFeminina ? 'fechada' : 'fechado'} — ${brl(r.total)}${pagamentoAgora ? ` · ${pagamentoAgora}` : ''}${troco}${quemVendeu}${ganhou}${autorizada}${conferir}`,
          link: { href: comprovante, rotulo: 'imprimir comprovante' },
          ...(carne ? { outro: { href: carne, rotulo: 'imprimir carnê' } } : {}),
        })
        setFechada({
          vendaId: r.vendaId,
          numero: r.numero,
          total: r.total,
          trocoCent: trocoAgora,
          pontosGanhos: r.pontosGanhos,
          pagamento: pagamentoAgora,
          comprovante,
          carne,
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
        setRecado({ nivel: 'critico', texto: r.recado ?? `A conta não fecha: falta ${brl(r.total - r.pago)}` })
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
        // O link só para quem abre Assinatura: para o balcão, ele levava a
        // uma página que não existe para ele.
        setRecado(
          veAssinatura
            ? { nivel: 'critico', texto: r.recado, link: { href: `/${slug}/assinatura`, rotulo: 'ver o plano' } }
            : { nivel: 'critico', texto: `${r.recado} Avise quem responde pela empresa — é quem pode mudar o plano.` },
        )
      } else if (r.motivo === 'recusa') {
        // A venda estourou no meio e nada foi gravado — ver `fecharVenda`.
        setRecado({ nivel: 'critico', texto: r.recado })
        if (r.soltar === 'vale') setPagos((p) => p.filter((x) => x.forma !== 'VALE'))
        if (r.soltar === 'pontos') setPontosUsar(0)
      } else if (r.motivo === 'loja_nao_vende') {
        setRecado({ nivel: 'critico', texto: 'Esta unidade não vende: é depósito ou foi desativada. Escolha uma loja.' })
      } else if (r.motivo === 'preco_mudou') {
        // A tabela mudou com o balcão aberto: troca os preços no pedido pelos
        // de agora, avisa, e a vitrine se renova. Nada foi gravado.
        const novos = new Map(r.itens.map((i) => [i.variacaoId, i.precos]))
        setCarrinho((c) => c.map((l) => (!l.avulso && novos.has(l.id) ? { ...l, preco: novos.get(l.id)!.vista, precos: novos.get(l.id)! } : l)))
        setAviso(
          `Preço atualizado: ${r.itens.map((i) => `${i.descricao} ${brl(i.de)} → ${brl(i.para)}`).join(', ')}. Confira o total novo e conclua de novo.`,
        )
        window.dispatchEvent(new Event(EVENTO_CATALOGO_MUDOU))
      } else if (r.motivo === 'item_inativo') {
        const fora = new Set(r.itens)
        setCarrinho((c) => c.filter((l) => l.avulso || !fora.has(l.descricao)))
        setAviso(`Saiu do pedido: ${r.itens.join(', ')} — foi desativado no cadastro. Confira o total e conclua de novo.`)
      } else if (r.motivo === 'quantidade_fracionada') {
        setRecado({
          nivel: 'critico',
          texto: `Peça, par e caixa vão em número inteiro: ${r.itens.join(', ')}. Fração só em quilo, litro ou metro.`,
        })
      } else if (r.motivo === 'encomenda_recusada') {
        // A encomenda sai do pedido; o resto da venda pode seguir.
        setCarrinho((c) => c.filter((l) => !l.encomendaId))
        setRecado({ nivel: 'critico', texto: r.recado, link: { href: `/${slug}/encomendas`, rotulo: 'abrir Encomendas' } })
      } else if (r.motivo === 'desconto_acima_do_teto') {
        // Em vez de "chame quem pode", o pedido do PIN: a gerente digita o
        // dela aqui mesmo, e a venda segue no nome de quem vendeu.
        const pct = r.percentual.toFixed(1).replace('.', ',')
        setRecado(null)
        setPedidoDePin({ motivo: `Desconto de ${pct}% passa do teto de ${String(r.teto).replace('.', ',')}% da loja.` })
      } else if (r.motivo === 'avulso_negado') {
        setRecado(null)
        setPedidoDePin({ motivo: 'Item fora do cadastro tem preço digitado na hora: precisa de quem autoriza desconto.' })
      } else if (r.motivo === 'assinatura_pedida') {
        // O PIN de quem vendeu não conferiu (ou o freio travou): a janela
        // volta, com o porquê. Nada foi gravado.
        setRecado(null)
        // O servidor é quem sabe se há PIN: a tela acompanha (criado em outra
        // tela, ou ainda sem).
        if (r.pinNovo === 'ja_tem') setTenhoPin(true)
        if (r.pinNovo === 'criar') setTenhoPin(false)
        setAssinando({
          erro: r.pinNovo === 'criar' ? undefined : r.recado,
          travado: r.travado,
          refazer: r.pinNovo === 'refazer_pin' ? 'pin' : r.pinNovo === 'refazer_senha' ? 'senha' : undefined,
        })
      } else if (r.motivo === 'autorizacao_recusada') {
        setPedidoDePin((x) => ({ motivo: x?.motivo ?? 'Esta venda precisa de autorização.', erro: r.recado }))
      } else if (r.motivo === 'pagamento_recusado') {
        setRecado({ nivel: 'critico', texto: r.recado })
      } else if (r.motivo === 'vendedor_invalido') {
        setRecado({ nivel: 'critico', texto: 'Esse vendedor não pode vender nesta loja.' })
      } else if (r.motivo === 'vale_recusado') {
        setRecado({ nivel: 'critico', texto: r.recado })
        setPagos((p) => p.filter((x) => x.forma !== 'VALE'))
      } else if (r.motivo === 'crediario_recusado') {
        setRecado({ nivel: 'critico', texto: r.recado })
      } else if (r.motivo === 'crediario_pede_autorizacao') {
        // Limite da cliente ou parcela atrasada além da regra: não é trava, é
        // a gerente olhando. O mesmo pedido de PIN do desconto.
        setRecado(null)
        setPedidoDePin({ motivo: r.recado })
      } else if (r.motivo === 'agendamento_recusado') {
        // O horário sai da venda (a venda pode seguir sem ele), e a frase diz
        // por quê — quase sempre: já foi cobrado em outra aba.
        setAgendamentoId(null)
        setRecado({ nivel: 'critico', texto: r.recado, link: { href: `/${slug}/agenda`, rotulo: 'abrir a Agenda' } })
      } else if (r.motivo === 'fora_da_loja') {
        // O cadastro mudou depois que o item entrou (alguém tirou o produto
        // desta loja agora há pouco). Mesma regra de cima: sai, com aviso, e a
        // pessoa confere o total e conclui de novo.
        const fora = new Set(r.itens)
        setCarrinho((c) => c.filter((l) => l.avulso || !fora.has(l.descricao)))
        setAviso(`Saiu do pedido: ${r.itens.join(', ')} — não é vendido na ${unidadeNome}. Confira o total e conclua de novo.`)
      } else if (r.motivo === 'uso_interno') {
        // Virou material de uso depois de entrar no pedido: sai, com aviso.
        const deUso = new Set(r.itens)
        setCarrinho((c) => c.filter((l) => l.avulso || !deUso.has(l.descricao)))
        setAviso(`Saiu do pedido: ${r.itens.join(', ')} — é material de uso, não se vende. Confira o total e conclua de novo.`)
      } else {
        setRecado({ nivel: 'critico', texto: `Não deu para fechar ${palavras.aVenda}.` })
      }
    })
  }

  // ── as teclas ────────────────────────────────────────────
  // Uma escuta só, na janela, lendo o estado mais recente por referência:
  // registrar de novo a cada tecla digitada seria trocar o ouvinte trinta
  // vezes por venda. F10 é a única que age; as outras só levam o foco.
  // As formas pelas teclas (F2–F8). A mesma regra do toque: sem forma ainda,
  // a tecla escolhe; faltando receber (pagamento dividido), soma o resto;
  // com tudo pago numa forma só, troca. F7 usa o vale da cliente (ou abre o
  // campo do código); F8 liga e desliga o "dividir em duas formas".
  function teclaDeForma(tecla: string) {
    if (carrinho.length === 0 || fechada) return
    if (tecla === 'F7') {
      if (valeDaCliente) void usarVale(valeDaCliente.codigo)
      else setValeAberto(true)
      return
    }
    if (tecla === 'F8') {
      setDividindo((d) => !d)
      return
    }
    const forma = TECLAS_FORMA[tecla]
    if (!forma) return
    if (forma === 'CREDIARIO') {
      if (!crediario) return
      const formas = pagos.filter((p) => p.forma !== 'VALE')
      pagarNoCrediario(parcelasN, formas.length === 0 || faltaCent <= 0)
      return
    }
    const formas = pagos.filter((p) => p.forma !== 'VALE')
    if (formas.some((p) => p.forma === forma)) return
    if ((dividindo || formas.length > 0) && faltaCent > 0) pagarCom(forma)
    else pagarSoCom(forma)
  }

  // ── a assinatura de quem vendeu (a janela do PIN da venda) ──
  // A pergunta do "vende assim mesmo?" já foi respondida antes da janela
  // abrir, então quem assina manda com ela respondida.
  function assinar(pin: string) {
    assinaturaDaVenda.current = { pin }
    concluir({ semEstoqueOk: true })
  }
  /**
   * Quem não tem PIN cria o seu aqui: o PIN novo e a senha de entrar vão na
   * mesma chamada que registra a venda — o servidor grava os dois juntos.
   */
  function criarPinEVender(pin: string, senha: string) {
    assinaturaDaVenda.current = { criarPin: { pin, senha } }
    concluir({ semEstoqueOk: true })
  }
  /**
   * Sem internet não há como criar o PIN (nem conferir): a venda que já
   * aconteceu sobe na fila, no nome da conta aberta, marcada para conferir.
   */
  function registrarSemInternet() {
    assinaturaDaVenda.current = { semInternet: true }
    concluir({ semEstoqueOk: true })
  }
  /** O freio travou: registra no nome da conta aberta, marcada para conferir. */
  function registrarTravado() {
    assinaturaDaVenda.current = { travado: true }
    concluir({ semEstoqueOk: true })
  }
  /** Fechou a janela do PIN: volta ao pedido, intocado, e nada foi gravado. */
  function cancelarAssinatura() {
    assinaturaDaVenda.current = null
    setAssinando(null)
  }
  /** Fechou o pedido de autorização: a assinatura que esperava por ele vai junto. */
  function cancelarAutorizacao() {
    assinaturaDaVenda.current = null
    setPedidoDePin(null)
  }

  /** ESC: fecha o que está aberto por cima, do mais novo para o mais velho. */
  function esc() {
    if (assinando) return cancelarAssinatura()
    if (pedidoDePin) return cancelarAutorizacao()
    if (perguntaSemEstoque) return setPerguntaSemEstoque(null)
    if (valeAberto) return setValeAberto(false)
    if (avulsoAberto) return setAvulsoAberto(false)
  }

  const estado = useRef({ podeConcluir, concluir, temItens: carrinho.length > 0, teclaDeForma, esc, temCliente: !!cliente })
  useEffect(() => {
    estado.current = { podeConcluir, concluir, temItens: carrinho.length > 0, teclaDeForma, esc, temCliente: !!cliente }
  })
  useEffect(() => {
    // Uma janela por cima que NÃO é o pedido (o tamanho, o PIN, as opções):
    // a tecla é dela. A folha do pedido no tablet é uma janela também, e lá
    // F2–F8, F10 e Esc têm de continuar valendo — é onde se paga.
    const janelaAlheia = () => {
      const janela = (document.activeElement as HTMLElement | null)?.closest('[role="dialog"]')
      return !!janela && !janela.hasAttribute('data-pagamento')
    }
    const tecla = (e: KeyboardEvent) => {
      // F2–F8: as formas. O preventDefault vem SEMPRE — o F5 do navegador
      // recarregava a página e o pedido sumia. Com uma janela aberta por cima
      // (a escolha do tamanho, as opções, o PIN), as teclas são dela.
      if (/^F[2-8]$/.test(e.key)) {
        e.preventDefault()
        if (janelaAlheia()) return
        estado.current.teclaDeForma(e.key)
        return
      }
      if (e.key === 'Escape') {
        if (janelaAlheia()) return
        estado.current.esc()
        return
      }
      if (e.key === 'F10') {
        e.preventDefault()
        // Com o PIN aberto, quem conclui é o "Autorizar" dele (Enter).
        if (janelaAlheia()) return
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
        // Com a cliente já escolhida, Alt+N é a ficha dela (o "quanto ela
        // deve?", o telefone novo); sem cliente, é procurar uma. Com outra
        // janela por cima, a tecla é dela.
        if (estado.current.temCliente) {
          if (!janelaAlheia()) setFichaAberta((a) => a ?? 'resumo')
        } else setPedidoCliente((n) => n + 1)
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
    // sem internet: a fila do aparelho
    fila,
    online,
    subirFila,
    descartarDaFila,
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
    tirarUm,
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
    mudarParcelasCredito,
    mudarPrimeiroVencimento,
    mudarMaquininha,
    maquininhas,
    credito,
    dividindo,
    setDividindo,
    teclaDeForma,
    // o crediário: o CPF que a ficha não tem
    ficha,
    cpf,
    setCpf,
    cpfRuim,
    // a autorização com PIN e o "vende assim mesmo?"
    pedidoDePin,
    setPedidoDePin,
    cancelarAutorizacao,
    autorizar: (pin: string) => concluir({ pin }),
    // o PIN de quem vendeu
    assinatura: assinatura ? { ...assinatura, tenhoPin } : null,
    assinando,
    assinar,
    criarPinEVender,
    registrarSemInternet,
    registrarTravado,
    cancelarAssinatura,
    perguntaSemEstoque,
    setPerguntaSemEstoque,
    venderSemEstoque: () => concluir({ semEstoqueOk: true }),
    vendeSemEstoque,
    // o vale
    vale: {
      aberto: valeAberto,
      setAberto: setValeAberto,
      codigo: valeCodigo,
      setCodigo: setValeCodigo,
      erro: valeErro,
      indo: valeIndo,
      usar: () => usarVale(),
      /** O vale da cliente escolhida que ainda não entrou nesta venda. */
      daCliente: valeDaCliente,
      usarDaCliente: () => valeDaCliente && usarVale(valeDaCliente.codigo),
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
    // o horário da agenda que esta venda cobra
    cobrando: agendamentoId && inicial?.agendamentoId === agendamentoId ? inicial.rotulo : agendamentoId ? 'um horário da agenda' : null,
    tirarHorario: () => setAgendamentoId(null),
    // quem, e o resto
    desconto,
    setDesconto,
    descontoEmPct,
    setDescontoEmPct,
    acrescimo,
    setAcrescimo,
    cliente,
    setCliente,
    atualizarCliente,
    fichaAberta,
    setFichaAberta,
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
