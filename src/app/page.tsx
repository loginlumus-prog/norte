import type { Metadata } from 'next'
import type { CSSProperties, ComponentType, ReactNode } from 'react'
import type { Plano } from '@prisma/client'
import './site.css'
import { PLANOS as LIMITES, PLANOS_COM_PRECO, PRECOS, RECURSOS, milhar } from '@/servidor/planos'
import { PODERES, TODOS_PODERES } from '@/servidor/poderes'
import { MODULOS, RAMOS, type Ramo } from '@/servidor/modulos'
import { EMPRESA } from '@/servidor/legal'
import { Marca } from '@/ui/Marca'
import { SistemaPorDentro, type TextoTela } from '@/ui/venda/demo/SistemaPorDentro'
import type { TelaId } from '@/ui/venda/demo/estado'
import { COMECAR, ENTRAR, mailto } from '@/ui/venda/mapa'
import {
  CelularCatalogo,
  ConversaAssistente,
  MiniBalcao,
  MiniEquipe,
  MiniEstoque,
  MiniGrafico,
  MiniSemInternet,
  PecasFarol,
  PlanilhaParaNorte,
} from '@/ui/site/Cenas'
import { Calculadora } from '@/ui/site/Calculadora'
import { LuzQueSegue } from '@/ui/site/LuzQueSegue'
import { Ramos, type RamoNaVitrine } from '@/ui/site/Ramos'
import { IconeAuditoria, IconeCorte, IconeFreio, IconeParedes, IconeTranca } from '@/ui/Icones'

// A página de venda.
//
// Ela existe para o dono de uma loja que nunca ouviu falar da gente decidir,
// em dois minutos, que vale testar. A ordem segue as perguntas que aparecem
// na cabeça dele:
//
//   1. o que é, e serve para mim?      → o topo: a loja de verdade, com o
//                                        sistema acontecendo por cima
//   2. o que muda no meu dia?          → antes e depois
//   3. o que ele faz?                  → o bento das funções da loja
//   4. o que só vocês têm?             → catálogo, assistente por áudio,
//                                        Farol e fábrica, um de cada vez
//   5. vou conseguir começar?          → a planilha velha entrando
//   6. como é por dentro?              → o exemplo clicável
//   7. meu dado fica seguro?           → as cinco garantias
//   8. quanto fica para MIM?           → a calculadora, e os planos
//   9. e se…?                          → as dúvidas
//
// ── 02/10/2026: viva e colorida ──────────────────────────────
// O dono pediu "muito mais profissional, mais vida, mais cor, mais
// interação, moderna de 2026", e que a página venda — palavra que o lojista
// procura, o que entrega, o que facilita. O que mudou:
//
// • FOTO de loja brasileira de verdade no topo, com o sistema flutuando por
//   cima (venda, pedido do catálogo, áudio, gráfico). As fotos foram geradas
//   para nós (public/img/site), sem marca de ninguém.
// • Cada função com a sua cor (site.css): azul o Norte, rosa o catálogo,
//   verde o WhatsApp, sol o Farol, violeta a fábrica.
// • As telinhas contam uma história em laço (src/ui/site/Cenas.tsx): a
//   cliente monta o pedido, o dono manda o áudio, o Farol escreve.
// • Entrar ao rolar com CSS puro, bento com luz que segue o mouse, faixa de
//   ramos correndo, calculadora de preço.
//
// ── 02/10/2026 (2): de todo ramo, e sem tela vazia ──────────
// O dono olhou de novo e pediu: menos açougue e sorveteria, mais "geral" —
// a gente atende mercado, salão, escola, pet shop. E os celulares por cima
// das fotos, com a história aparecendo e sumindo, ficaram feios.
// • O topo virou um mosaico de quatro ramos (mercado, salão, moda,
//   sorveteria). O exemplo do áudio é água mineral, que todo ramo vende.
// • A telinha mora DENTRO do quadro da foto (nada pendurado para fora), e
//   está sempre inteira — o laço só destaca cada peça na vez dela.
// • A fábrica saiu do palco: é um dos ramos (aba "Sorveteria"/"Padaria" e o
//   preço à parte), não uma seção inteira.
// • "Para quem é" virou o seletor de ramo, lido de `RAMOS`.
//
// ── o que continua NÃO estando aqui, de propósito ───────────
// • Logo de cliente e depoimento: não inventamos. Quando houver, com nome e
//   permissão.
// • Número de mercado ("+30% de vendas"): não medimos.
// • Preço digitado à mão: tudo sai de `servidor/planos.ts`.

export const metadata: Metadata = {
  title: 'Norte — sistema de gestão para loja: PDV, estoque, catálogo no WhatsApp e IA',
  description:
    'Frente de caixa (PDV) que funciona sem internet, controle de estoque por loja, catálogo online para mandar no WhatsApp, financeiro com DRE, equipe com metas e um assistente com IA que lança a compra por áudio. Teste 30 dias grátis, sem cartão.',
  openGraph: {
    title: 'Norte — sua loja vendendo mais, você no controle',
    description: 'PDV, estoque, catálogo no WhatsApp, financeiro e um assistente com IA. 30 dias grátis.',
    images: [{ url: '/img/site/mercado.webp', width: 1100, height: 1365 }],
  },
}

/* ═══════════════════════════════════════════════════════════
   Os números, lidos da tabela
   ═══════════════════════════════════════════════════════════ */

const reais = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)

const [BASE, COM_ASSISTENTE] = PLANOS_COM_PRECO as [Plano, Plano]

/** "Incluso no Norte" ou "Com o assistente", lido de `RECURSOS`. Título errado quebra o build — de propósito. */
function desde(titulo: string): string {
  const r = RECURSOS.find((x) => x.titulo === titulo)
  if (!r) throw new Error(`A página de venda cita "${titulo}", que não existe em RECURSOS.`)
  if (r.em.includes(BASE)) return `Incluso no ${LIMITES[BASE].titulo}`
  if (r.em.includes(COM_ASSISTENTE)) return 'Com o assistente'
  throw new Error(`A página de venda cita "${titulo}", que nenhum plano à venda tem.`)
}
function juntos(...titulos: string[]): string {
  const onde = titulos.map(desde)
  if (new Set(onde).size === 1) return onde[0]!
  return titulos.map((t, i) => `${t}: ${onde[i]!.replace(/^./, (c) => c.toLowerCase())}`).join('. ')
}

const IMPLANTACAO = { de: PRECOS.implantacaoMigracao[0], ate: PRECOS.implantacaoFabrica[1] }

/* ═══════════════════════════════════════════════════════════
   O sistema por dentro (o exemplo clicável de ui/venda/demo)
   ═══════════════════════════════════════════════════════════ */
const TEXTOS: Record<TelaId, TextoTela> = {
  painel: {
    chamada: 'O dia da loja numa olhada, e o que precisa de você.',
    frases: [
      'No simples, o painel abre pelo que precisa de você hoje — o que acabou, a conta que vence, o pedido esperando — e cada linha leva à tela que resolve.',
      'No avançado, o período que você escolher, sempre contra o período anterior do mesmo tamanho.',
      'Hora a hora contra a mesma semana passada, ticket médio, margem sobre o custo e quem mais vendeu.',
    ],
    plano: `${desde('Relatório de vendas')}.`,
  },
  balcao: {
    chamada: 'Vender rápido, e fechar o caixa sem susto.',
    frases: [
      'Bipe a etiqueta e o Enter lança. Quem não etiqueta — sorveteria, lanchonete, floricultura — vende tocando em botões grandes.',
      'Várias formas de pagamento na mesma venda, troco grande na tela, e três preços por produto: à vista, no cartão e no crediário.',
      'Caiu a internet? O balcão continua vendendo e as vendas sobem sozinhas quando a conexão volta.',
    ],
    plano: `${desde('Balcão, caixa e sangria')}.`,
  },
  estoque: {
    chamada: 'Cada loja com o seu saldo, e o aviso antes de faltar.',
    frases: [
      'Cada loja com o saldo dela. Transferir sai de uma e entra na outra na mesma operação.',
      '“Vai faltar”: quantos dias o saldo aguenta no ritmo dos últimos 30 dias, contra o prazo de reposição — e até quando pedir.',
      'Editar em planilha: nome, preço e estoque de tudo numa tela só, com a assinatura de quem mexeu.',
    ],
    plano: `${juntos('Estoque, entrada de mercadoria e balanço', 'Previsão de ruptura com prazo de reposição')}.`,
  },
  financeiro: {
    chamada: 'Saber quanto sobrou, e não só quanto vendeu.',
    frases: [
      'Contas a pagar avisando o que venceu, o que vence hoje e o que vem nos próximos 15 dias.',
      'O resultado do mês puxa direto das vendas, com o custo de cada peça e a taxa da maquininha descontados venda a venda.',
      'O fechamento guiado diz o que falta conferir — caixa, gaveta, contas, taxa, fiado — antes de o número do mês valer.',
    ],
    plano: `${desde('Financeiro com DRE do mês')}.`,
  },
  clientes: {
    chamada: 'Quem compra, quanto, e há quanto tempo sumiu.',
    frases: [
      'Busca por nome, telefone ou CPF, e a ficha de cada um com o histórico de compra.',
      'Fichas prontas para o que vira ação: quem sumiu há mais de 60 dias e quem faz aniversário no mês.',
      'Programa de pontos e crediário com carnê: a venda com cliente escolhido soma na hora.',
    ],
    plano: `${juntos('Ficha do cliente com histórico', 'Programa de pontos')}.`,
  },
  tarefas: {
    chamada: 'A equipe no mesmo quadro, e o mês em estrelas.',
    frases: [
      'O quadro no jeito que a equipe já conhece: grupos, situação colorida, responsável, prazo e linha do tempo.',
      'Meta e comissão por vendedor, contando o vendido já sem as devoluções.',
      'De 0 a 5 estrelas por pessoa e por mês: meta batida, tarefa no prazo e dias presente.',
    ],
    plano: `${juntos('Quadro de tarefas da equipe', 'Desempenho da equipe em estrelas', 'Metas e comissão por vendedor')}.`,
  },
  analise: {
    chamada: 'Onde o dinheiro está parado, e qual loja puxa a rede.',
    frases: [
      'As lojas lado a lado: vendas, o que entrou, margem, ticket e o que ficou sem saída.',
      'A curva ABC separa o que sustenta a loja do que só ocupa prateleira.',
      'O dinheiro parado em reais, a preço de custo — o que não vende há 90 dias são as candidatas a promoção.',
    ],
    plano: `${desde('Curva ABC e dinheiro parado')}. No menu, só no modo avançado.`,
  },
  assistente: {
    chamada: 'Um assistente que age — e que pede antes.',
    frases: [
      'Ele conversa com você e a equipe no WhatsApp: conta como foi o dia e consulta estoque, caixa, contas e encomendas.',
      'Para agir — lançar uma compra, uma conta, aceitar um pedido — ele monta a proposta com o número e espera o seu SIM, ali mesmo na conversa.',
      'Os tetos moram no banco: valor máximo, gasto de IA e mensagens por dia. Nenhuma mensagem convence ele a passar.',
    ],
    plano: `Assistente: ${reais(PRECOS.assistente)} a mais por mês para a empresa inteira, com ${milhar(PRECOS.respostasDoAssistente)} respostas.`,
  },
}

const CONSULTA_EXEMPLO = TODOS_PODERES.filter((k) => !('semIA' in PODERES[k]) && !PODERES[k].escreve).map((k) => ({
  titulo: PODERES[k].titulo,
  disponivel: PODERES[k].disponivel as boolean,
}))

/* ═══════════════════════════════════════════════════════════
   Os textos
   ═══════════════════════════════════════════════════════════ */

const ANTES_DEPOIS: [string, string][] = [
  ['O fiado anotado no caderno, que some', 'Crediário com carnê, vencimento e aviso de quem atrasou'],
  ['Descobrir que acabou quando a cliente pede', '“Vai faltar”: o aviso com o dia certo de pedir ao fornecedor'],
  ['Pedido de WhatsApp perdido no meio da conversa', 'Catálogo com link: o pedido chega pronto, com itens e endereço'],
  ['A planilha que ninguém atualiza', 'Tudo lançado na hora — do balcão ao financeiro, sem digitar duas vezes'],
  ['Caixa que não bate, e ninguém sabe por quê', 'Fechamento guiado: a diferença aparece, com quem e quando'],
  ['Sistema que trava quando a internet cai', 'O balcão segue vendendo e sobe tudo quando a conexão volta'],
]

const SEGURANCA: { Icone: ComponentType<{ tamanho?: number; className?: string }>; t: string; d: string }[] = [
  { Icone: IconeParedes, t: 'Duas paredes entre empresas', d: 'A aplicação só fala com o banco já presa à sua empresa, e o próprio banco se recusa a devolver linha de outra.' },
  { Icone: IconeAuditoria, t: 'O livro não se apaga', d: 'Quem mexeu, no quê, quando, de quanto para quanto. Ninguém edita nem apaga — nem a gente.' },
  { Icone: IconeCorte, t: 'Tirou o acesso, acabou', d: 'Desativou alguém no meio do expediente? A próxima tela que ele abrir já pede login.' },
  { Icone: IconeFreio, t: 'Porta com freio', d: 'Senha errada repetida trava a tentativa por alguns minutos. Chute em lista não vai longe.' },
  { Icone: IconeTranca, t: 'A tela que tranca', d: 'Parada por meia hora, ela pede a senha de novo — sem perder a venda do balcão.' },
]

/** O plano que se vende: um só, por loja. Tudo o que a loja usa vem dentro. */
const O_PLANO = {
  nome: LIMITES[BASE].titulo,
  preco: reais(PRECOS.primeiraLoja),
  sub: `por mês, a primeira loja · ${reais(PRECOS.lojaExtra)} cada loja a mais · depósito não conta`,
  itens: [
    'Frente de caixa (PDV) que funciona sem internet',
    'Estoque por loja, com grade de cor e tamanho',
    'Catálogo online de cada loja, para mandar no WhatsApp',
    'Encomendas, agenda, compras e fornecedores',
    'Clientes, programa de pontos e crediário com carnê',
    'Financeiro com DRE do mês e fechamento guiado',
    'Metas, comissão e equipe sem limite de usuários',
    'Nota fiscal no balcão · em breve',
  ],
}

/** O que liga por cima, para a empresa inteira. Os números saem de PRECOS. */
const POR_CIMA: { t: string; cor: string; d: string; preco: string; sub: string }[] = [
  {
    t: 'Assistente',
    cor: 'var(--s-verde)',
    d: 'IA no WhatsApp para você e a equipe: relatório, avisos, perguntas e lançamentos por áudio.',
    preco: `${reais(PRECOS.assistente)}/mês`,
    sub: `${milhar(PRECOS.respostasDoAssistente)} respostas por mês · +${milhar(PRECOS.pacoteRespostas)} por ${reais(PRECOS.pacotePreco)} se precisar`,
  },
  {
    t: 'Fábrica',
    cor: 'var(--s-violeta)',
    d: 'Ficha técnica, produção com lote e validade, e o pedido das lojas.',
    preco: `${reais(PRECOS.fabrica)}/mês`,
    sub: 'uma vez, com quantas cozinhas você tiver',
  },
  {
    t: 'Farol',
    cor: 'var(--s-sol)',
    d: 'Marketing com IA para o Instagram e o TikTok da marca.',
    preco: `${reais(PRECOS.farolMarca)}/mês`,
    sub: `por marca · ${reais(PRECOS.farolMarcaExtra)} cada marca a mais`,
  },
]

const PERGUNTAS: { p: string; r: string }[] = [
  {
    p: 'Preciso de computador, ou funciona no celular?',
    r: 'Funciona no navegador de qualquer aparelho: computador, tablet ou celular. O balcão pode ser instalado como aplicativo no tablet, e o catálogo da loja é feito para o celular da cliente.',
  },
  {
    p: 'Como eu trago os meus produtos do sistema antigo?',
    r: 'Exporte a planilha do sistema antigo (Excel ou CSV) ou copie e cole as colunas. O Norte entende sozinho qual coluna é nome, preço, código e estoque — a IA ajuda quando o título é estranho —, mostra a prévia e importa sem repetir. Para migrações grandes, a nossa equipe faz junto com você.',
  },
  {
    p: 'E se a internet cair no meio do movimento?',
    r: 'O balcão continua vendendo em dinheiro, Pix e cartão. As vendas ficam guardadas no aparelho e sobem sozinhas quando a conexão volta, com a hora certa — e mandar de novo nunca duplica a venda.',
  },
  {
    p: 'O catálogo cobra taxa por pedido?',
    r: `Não. O catálogo de cada loja vem no ${LIMITES[BASE].titulo}, sem taxa por pedido. O pagamento é combinado com a loja (Pix, dinheiro ou cartão na entrega ou na retirada), e o pedido entra em Encomendas e no WhatsApp da loja.`,
  },
  {
    p: 'O assistente faz alguma coisa sozinho?',
    r: 'Consultar, sim: como foi o dia, o que vai faltar, quanto tem no caixa. Agir, nunca sozinho: lançar uma compra, uma conta ou aceitar um pedido vira proposta com o número, e só acontece quando você responde SIM. Os tetos de valor e de gasto ficam no banco — mensagem nenhuma passa deles.',
  },
  {
    p: 'Emite nota fiscal?',
    r: `Ainda não — está como “em breve”. Ela depende de um emissor contratado e do certificado digital A1 de cada loja, e quando entrar vem no ${LIMITES[BASE].titulo}, sem custo a mais de plano.`,
  },
  {
    p: 'Pago por usuário?',
    r: 'Não. A equipe inteira entra sem custo a mais, sem limite de gente dentro ao mesmo tempo, cada um com a própria senha e o que o cargo dele permite. O que se paga é a loja.',
  },
  {
    p: 'Como funciona o teste?',
    r: `São ${PRECOS.diasDeTeste} dias com tudo ligado — o assistente também, com ${milhar(PRECOS.respostasDoTeste)} respostas para conhecer —, sem cartão. Assinando, nada muda: o que você lançou continua. Sem assinar, a conta não vira cobrança: fica no básico, com os dados guardados.`,
  },
  {
    p: 'O que conta como resposta do assistente?',
    r: `Cada mensagem que ele escreve com IA para você ou a equipe. Relatório, avisos e campanhas não contam. O mês vem com ${milhar(PRECOS.respostasDoAssistente)}; acabou, ele avisa antes, e você compra +${milhar(PRECOS.pacoteRespostas)} por ${reais(PRECOS.pacotePreco)} ou espera o dia 1º.`,
  },
  {
    p: 'Meus dados ficam misturados com os de outra empresa?',
    r: 'Não. São duas paredes: a aplicação só fala com o banco já presa à sua empresa, e o próprio banco se recusa a devolver linha de outra — para o dia em que a primeira falhar.',
  },
]

/** As abas de "Para quem é": o ramo, a frase e a cor. O resto vem de RAMOS. */
const VITRINE_RAMOS: { id: Ramo; frase: string; cor: string }[] = [
  { id: 'roupa', cor: 'var(--s-rosa)', frase: 'Grade de cor e tamanho, troca com vale, crediário com carnê, etiqueta com código de barras e meta por vendedora.' },
  { id: 'mercearia', cor: 'var(--s-verde)', frase: 'Catálogo grande e giro rápido: bipe e receba, veja o que acaba hoje e lance a mercadoria que chegou mandando um áudio.' },
  { id: 'beleza', cor: 'var(--s-violeta)', frase: 'Agenda de horários, o serviço e a revenda no mesmo balcão, e o material de uso separado do que se vende.' },
  { id: 'sorveteria', cor: 'var(--s-sol)', frase: 'Venda por quilo e por sabor, botões grandes, encomenda com sinal — e, se você produz, a fábrica com ficha técnica, lote e o pedido das lojas.' },
  { id: 'padaria', cor: 'var(--s-sol)', frase: 'A produção do dia que zera sem virar “falta”, encomenda de bolo com sinal e data, e venda por quilo.' },
  { id: 'petshop', cor: 'var(--s-azul)', frase: 'Ração por porte, banho e tosa na agenda, e o cliente que volta com o programa de pontos.' },
  { id: 'escola', cor: 'var(--s-azul)', frase: 'Turmas, matrícula e mensalidade com aviso no WhatsApp — e o uniforme e o material vendidos no mesmo caixa.' },
  { id: 'construcao', cor: 'var(--s-verde)', frase: 'Venda por metro, caixa e litro, encomenda para entregar e o crediário de quem compra todo mês.' },
]
const RAMOS_VITRINE: RamoNaVitrine[] = VITRINE_RAMOS.map(({ id, frase, cor }) => {
  const r = RAMOS[id]
  return {
    id,
    frase,
    cor,
    titulo: r.titulo,
    categorias: [...r.categorias],
    eixos: r.eixos.map((e) => ({ nome: e.nome, opcoes: [...e.opcoes] })),
    medida: r.medida,
    balcao: r.balcao,
    funcoes: [...(r.sugere as readonly string[]), ...(id === 'sorveteria' || id === 'padaria' ? ['fabrica'] : [])]
      .filter((m): m is keyof typeof MODULOS => m in MODULOS)
      .map((m) => MODULOS[m].titulo),
  }
})

const RAMOS_FAIXA = Object.values(RAMOS)
  .map((r) => r.titulo)
  .filter((t) => t !== 'Outro' && t !== 'Serviços')

/* ═══════════════════════════════════════════════════════════
   Peças
   ═══════════════════════════════════════════════════════════ */

const v = (d: number) => ({ '--d': `${d}s` }) as CSSProperties

function Olho({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="site-olho inline-flex items-center gap-2" style={{ color: cor }}>
      <span className="h-2 w-2 rounded-full" style={{ background: cor }} />
      {children}
    </span>
  )
}

function Cabeca({ olho, cor, titulo, texto, centro = false }: { olho: string; cor: string; titulo: ReactNode; texto?: ReactNode; centro?: boolean }) {
  return (
    <div className={`site-revela flex max-w-3xl flex-col gap-4 ${centro ? 'mx-auto items-center text-center' : ''}`}>
      <Olho cor={cor}>{olho}</Olho>
      <h2 className="text-[2.1rem] leading-[1.05] font-extrabold sm:text-5xl">{titulo}</h2>
      {texto ? <p className="text-lg leading-relaxed text-[var(--s-tinta-2)]">{texto}</p> : null}
    </div>
  )
}

function Ficha({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span
      className="rounded-full border px-3.5 py-1.5 text-[13px] font-semibold"
      style={{ borderColor: `color-mix(in srgb, ${cor} 30%, transparent)`, background: `color-mix(in srgb, ${cor} 9%, transparent)`, color: cor }}
    >
      {children}
    </span>
  )
}

function Visto({ cor = 'var(--s-verde)' }: { cor?: string }) {
  return (
    <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black text-white" style={{ background: cor }}>
      ✓
    </span>
  )
}

function Foto({ src, alt, className = '', prioridade = false, foco = '' }: { src: string; alt: string; className?: string; prioridade?: boolean; foco?: string }) {
  return (
    <div className={`site-foto overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading={prioridade ? 'eager' : 'lazy'} decoding="async" fetchPriority={prioridade ? 'high' : 'auto'} className={`h-full w-full object-cover ${foco}`} />
    </div>
  )
}

/** Uma foto do mosaico do topo, com o nome do ramo no canto. */
function Mosaico({ src, alt, rotulo, proporcao, foco = '', prioridade = false }: { src: string; alt: string; rotulo: string; proporcao: string; foco?: string; prioridade?: boolean }) {
  return (
    <div className={`relative overflow-hidden rounded-[24px] shadow-[var(--s-sombra)] sm:rounded-[28px] ${proporcao}`}>
      <Foto src={src} alt={alt} prioridade={prioridade} foco={foco} className="h-full w-full" />
      <span className="absolute bottom-2.5 left-2.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-[#0d1b45] backdrop-blur sm:text-[12px]">{rotulo}</span>
    </div>
  )
}

/** Um destaque: texto de um lado; do outro, a foto com a telinha morando dentro dela. */
function Destaque({
  id,
  cor,
  olho,
  titulo,
  texto,
  itens,
  fichas,
  foto,
  alt,
  tela,
  invertido = false,
  rodape,
  foco = '',
}: {
  id: string
  cor: string
  olho: string
  titulo: ReactNode
  texto: ReactNode
  itens: string[]
  fichas?: string[]
  foto: string
  alt: string
  tela: ReactNode
  invertido?: boolean
  rodape?: ReactNode
  /** Para onde a foto olha (object-position), para a pessoa não ficar atrás da telinha. */
  foco?: string
}) {
  return (
    <section id={id} className="relative scroll-mt-20 overflow-hidden py-20 sm:py-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: `radial-gradient(60% 60% at ${invertido ? '15%' : '85%'} 40%, color-mix(in srgb, ${cor} 10%, transparent), transparent 70%)` }} />
      <div className={`mx-auto grid max-w-6xl items-center gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:gap-20 ${invertido ? 'lg:[&>*:first-child]:order-2' : ''}`}>
        <div className="flex flex-col gap-6">
          <Cabeca olho={olho} cor={cor} titulo={titulo} texto={texto} />
          <ul className="site-revela flex flex-col gap-3">
            {itens.map((i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                <Visto cor={cor} />
                <span>{i}</span>
              </li>
            ))}
          </ul>
          {fichas ? (
            <div className="site-revela flex flex-wrap gap-2">
              {fichas.map((f) => (
                <Ficha key={f} cor={cor}>
                  {f}
                </Ficha>
              ))}
            </div>
          ) : null}
          {rodape}
        </div>
        <div className="site-revela relative overflow-hidden rounded-[36px] shadow-[var(--s-sombra-alta)]">
          <Foto src={foto} alt={alt} foco={foco} className="absolute inset-0 h-full w-full" />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `linear-gradient(${invertido ? '90deg' : '270deg'}, color-mix(in srgb, ${cor} 30%, rgb(11 18 48 / 0.6)) 0%, transparent 70%)`,
            }}
          />
          <div className={`relative flex min-h-[520px] items-end p-5 pt-44 sm:p-8 sm:pt-8 lg:h-[660px] ${invertido ? 'justify-start' : 'justify-end'}`}>{tela}</div>
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════
   A página
   ═══════════════════════════════════════════════════════════ */

const NAV: [string, string][] = [
  ['Funções', '#funcoes'],
  ['Catálogo', '#catalogo'],
  ['Assistente', '#assistente'],
  ['Farol', '#farol'],
  ['Preços', '#precos'],
  ['Dúvidas', '#duvidas'],
]

export default function Inicio() {
  return (
    <div className="site flex min-h-dvh flex-col text-base">
      <a href="#conteudo" className="sr-only z-50 rounded-md bg-marca px-4 py-2 text-sm font-semibold text-marca-tinta focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Pular para o conteúdo
      </a>

      {/* ── a barra ── */}
      <header className="sticky top-0 z-40 border-b border-[var(--s-borda)] bg-[color-mix(in_srgb,var(--s-fundo)_78%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="#topo" aria-label="Norte, início">
            <Marca tamanho={26} id="nav-sol" />
          </a>
          <nav aria-label="Seções" className="hidden items-center gap-1 lg:flex">
            {NAV.map(([n, h]) => (
              <a key={h} href={h} className="rounded-full px-3.5 py-2 text-[14px] font-semibold text-[var(--s-tinta-2)] transition-colors hover:bg-[var(--s-borda)] hover:text-[var(--s-tinta)]">
                {n}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <a href={ENTRAR} className="hidden rounded-full px-3.5 py-2 text-[14px] font-semibold text-[var(--s-tinta-2)] hover:text-[var(--s-tinta)] sm:block">
              Entrar
            </a>
            <a href={COMECAR} className="site-botao site-botao-principal px-5 py-2.5 text-[14px]">
              Testar grátis
            </a>
            <details className="group relative lg:hidden">
              <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-[var(--s-borda)] [&::-webkit-details-marker]:hidden" aria-label="Abrir menu">
                <span aria-hidden className="flex flex-col gap-1">
                  <i className="block h-0.5 w-4 rounded bg-current" />
                  <i className="block h-0.5 w-4 rounded bg-current" />
                </span>
              </summary>
              <nav aria-label="Seções" className="site-cartao absolute right-0 mt-2 flex w-56 flex-col rounded-2xl p-2">
                {NAV.map(([n, h]) => (
                  <a key={h} href={h} className="rounded-xl px-3 py-2.5 text-[15px] font-semibold hover:bg-[var(--s-borda)]">
                    {n}
                  </a>
                ))}
                <a href={ENTRAR} className="rounded-xl px-3 py-2.5 text-[15px] font-semibold text-[var(--s-tinta-2)] hover:bg-[var(--s-borda)]">
                  Entrar
                </a>
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="conteudo">
        {/* ── o topo ──────────────────────────────────────────── */}
        <section id="topo" className="relative isolate overflow-hidden">
          <div aria-hidden className="site-aurora">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div aria-hidden className="site-grade" />
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-14 pb-20 sm:px-6 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:pb-28">
            <div className="flex flex-col items-start">
              <a
                href="#catalogo"
                className="site-chega group inline-flex items-center gap-2 rounded-full border border-[var(--s-borda)] bg-[var(--s-cartao)] py-1 pr-3.5 pl-1 text-[13px] font-semibold text-[var(--s-tinta-2)] shadow-[var(--s-sombra)]"
              >
                <span className="rounded-full bg-[var(--s-rosa)] px-2.5 py-0.5 text-[11px] font-extrabold text-white">Novo</span>
                <span className="sm:hidden">Catálogo e estoque por áudio</span>
                <span className="hidden sm:inline">Catálogo no WhatsApp e estoque por áudio</span>
                <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
              </a>
              <h1 className="site-chega mt-7 text-[2.9rem] leading-[1.02] font-extrabold sm:text-[4rem] lg:text-[4.6rem]" style={v(0.1)}>
                Seu negócio vende mais
                <br />
                <span className="site-troca" aria-hidden>
                  <span>no balcão.</span>
                  <span>no WhatsApp.</span>
                  <span>no catálogo.</span>
                  <span>no Instagram.</span>
                </span>
                <span className="sr-only">no balcão, no WhatsApp, no catálogo e no Instagram.</span>
              </h1>
              <p className="site-chega mt-6 max-w-xl text-lg leading-relaxed text-[var(--s-tinta-2)] sm:text-xl" style={v(0.25)}>
                Frente de caixa, estoque, catálogo online, financeiro e equipe numa tela só — e um assistente no WhatsApp que lança a mercadoria
                quando você manda um áudio. Do mercadinho ao salão, da loja de roupa à sorveteria.
              </p>
              <div className="site-chega mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row" style={v(0.4)}>
                <a href={COMECAR} className="site-botao site-botao-principal px-8 py-4 text-[16px]">
                  Testar {PRECOS.diasDeTeste} dias grátis
                </a>
                <a href="#demo" className="site-botao site-botao-claro px-8 py-4 text-[16px]">
                  Ver o sistema funcionando
                </a>
              </div>
              <ul className="site-chega mt-7 grid gap-x-6 gap-y-2.5 sm:grid-cols-2 text-[14px] font-medium text-[var(--s-tinta-2)]" style={v(0.55)}>
                {['Sem cartão de crédito', 'Traga seus produtos da planilha', 'Funciona sem internet', 'Equipe sem limite de usuários'].map((t) => (
                  <li key={t} className="flex items-center gap-2">
                    <Visto />
                    {t}
                  </li>
                ))}
              </ul>
            </div>

            {/* Quatro ramos de verdade, com o sistema acontecendo por cima. */}
            <div className="site-chega relative mx-auto w-full max-w-xl" style={v(0.3)}>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div className="flex flex-col gap-3 sm:gap-4">
                  <Mosaico src="/img/site/mercado.webp" alt="Dona de mercadinho entregando a sacola para a cliente no caixa" rotulo="Mercado" proporcao="aspect-[4/5]" foco="object-[50%_30%]" prioridade />
                  <Mosaico src="/img/site/moda.webp" alt="Vendedora de loja de roupa entre as araras coloridas" rotulo="Moda" proporcao="aspect-[4/3]" />
                </div>
                <div className="flex flex-col gap-3 pt-10 sm:gap-4">
                  <Mosaico src="/img/site/beleza.webp" alt="Manicure conferindo a agenda no tablet, no balcão do salão" rotulo="Salão e beleza" proporcao="aspect-[4/3]" foco="object-[60%_35%]" />
                  <Mosaico src="/img/site/balcao.webp" alt="Dona de sorveteria lançando a venda no tablet, no balcão" rotulo="Sorveteria" proporcao="aspect-[4/5]" foco="object-[70%_50%]" />
                </div>
              </div>
              <div className="site-boia site-cartao absolute top-6 -left-3 flex items-center gap-3 rounded-2xl px-4 py-3 sm:-left-8" style={{ animationDelay: '-1s' }}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--s-verde)] text-sm font-black text-white">✓</span>
                <div className="leading-tight">
                  <p className="text-[11px] text-[var(--s-tinta-2)]">Venda concluída · Pix</p>
                  <p className="text-lg font-extrabold tabular-nums">R$ 38,00</p>
                </div>
              </div>
              <div className="site-boia site-cartao absolute top-[42%] -right-3 w-52 rounded-2xl p-3.5 sm:-right-8" style={{ animationDelay: '-3s' }}>
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--s-rosa)]">
                  <span className="site-pulsa h-2 w-2 rounded-full bg-[var(--s-rosa)]" style={{ '--cor': 'var(--s-rosa)' } as CSSProperties} />
                  Pedido novo pelo catálogo
                </p>
                <p className="mt-1 text-[13px] font-bold">ENC-7Q2K · 3 itens</p>
                <p className="text-[12px] text-[var(--s-tinta-2)]">Retirada às 15h · Pix</p>
              </div>
              <div className="site-boia site-cartao absolute -bottom-5 left-2 flex max-w-[16rem] items-center gap-2.5 rounded-2xl px-3.5 py-3 sm:-left-6" style={{ animationDelay: '-2s' }}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0f6e47] text-[11px] font-black text-white">▶</span>
                <p className="text-[12px] leading-snug">
                  <span className="text-[var(--s-tinta-2)]">Ouvi:</span> “chegaram 48 águas de 500 ml”
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── a faixa dos ramos ── */}
        <section aria-label="Para quem é" className="border-y border-[var(--s-borda)] bg-[var(--s-cartao)] py-5">
          <div className="site-faixa overflow-hidden">
            <div>
              {[...RAMOS_FAIXA, ...RAMOS_FAIXA].map((r, i) => (
                <span key={i} aria-hidden={i >= RAMOS_FAIXA.length} className="mx-3 flex shrink-0 items-center gap-3 text-[15px] font-bold whitespace-nowrap text-[var(--s-tinta-2)]">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: ['var(--s-azul)', 'var(--s-rosa)', 'var(--s-verde)', 'var(--s-sol)', 'var(--s-violeta)'][i % 5] }} />
                  {r}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── antes e depois ── */}
        <section className="py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Cabeca
              centro
              olho="O que muda no seu dia"
              cor="var(--s-azul)"
              titulo={
                <>
                  Chega de caderno, planilha e <span className="text-[var(--s-rosa)]">pedido perdido</span>.
                </>
              }
              texto="Tudo o que hoje mora em cinco lugares diferentes passa a morar num só — e conversa entre si."
            />
            <div className="site-revela mt-14 grid gap-4 md:grid-cols-2">
              <div className="rounded-[28px] border border-[var(--s-borda)] bg-[var(--s-cartao)] p-6 sm:p-8">
                <p className="site-olho text-[var(--s-tinta-2)]">Sem o Norte</p>
                <ul className="mt-5 flex flex-col gap-4">
                  {ANTES_DEPOIS.map(([a]) => (
                    <li key={a} className="flex gap-3 text-[15px] text-[var(--s-tinta-2)]">
                      <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--s-borda)] text-[11px] font-black">
                        ✕
                      </span>
                      <span className="line-through decoration-[color-mix(in_srgb,var(--s-rosa)_50%,transparent)]">{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(150deg,#1f4fd8,#6d4cf0)] p-6 text-white shadow-[var(--s-sombra-alta)] sm:p-8">
                <span aria-hidden className="pointer-events-none absolute -right-16 -bottom-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
                <p className="site-olho text-white/80">Com o Norte</p>
                <ul className="mt-5 flex flex-col gap-4">
                  {ANTES_DEPOIS.map(([, d]) => (
                    <li key={d} className="flex gap-3 text-[15px] font-semibold">
                      <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-black text-[#1f4fd8]">
                        ✓
                      </span>
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── o bento das funções ── */}
        <section id="funcoes" className="scroll-mt-20 bg-[var(--s-cartao)] py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Cabeca
              olho="Tudo numa tela só"
              cor="var(--s-azul)"
              titulo="O sistema de gestão que a loja inteira consegue usar."
              texto="Do balcão ao fim do mês: vender, controlar o estoque, cuidar do dinheiro e da equipe — com o modo simples para quem atende e o avançado para o dono."
            />
            <LuzQueSegue className="mt-14 grid gap-4 md:grid-cols-3">
              <article className="site-bloco site-revela site-cartao flex flex-col gap-5 p-6 sm:p-8 md:col-span-2" style={{ '--cor': 'var(--s-azul)' } as CSSProperties}>
                <div>
                  <Olho cor="var(--s-azul)">Frente de caixa (PDV)</Olho>
                  <h3 className="mt-3 text-2xl font-extrabold sm:text-3xl">Bipe, toque e receba.</h3>
                  <p className="mt-2 max-w-lg text-[15px] text-[var(--s-tinta-2)]">
                    Dinheiro, Pix, cartão, crediário e vale na mesma venda. Grade de cor e tamanho, três preços por produto, troca e etiqueta. Botões grandes para quem vende sem código de barras.
                  </p>
                </div>
                <div className="site-mostra grid gap-4 sm:grid-cols-[1.2fr_1fr]">
                  <MiniBalcao />
                  <div className="flex flex-col justify-center gap-2 text-[13px]">
                    {['Venda por peso (kg)', 'Troco grande na tela', 'Caixa que abre, sangra e fecha', 'Comprovante e carnê na hora'].map((t) => (
                      <span key={t} className="flex items-center gap-2 font-semibold">
                        <Visto cor="var(--s-azul)" />
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </article>
              <article className="site-bloco site-revela site-cartao flex flex-col gap-5 p-6 sm:p-8" style={{ '--cor': 'var(--s-verde)' } as CSSProperties}>
                <div>
                  <Olho cor="var(--s-verde)">Controle de estoque</Olho>
                  <h3 className="mt-3 text-2xl font-extrabold">Saiba antes de faltar.</h3>
                  <p className="mt-2 text-[15px] text-[var(--s-tinta-2)]">Cada loja com o seu saldo, o aviso do que acaba e o dia de pedir ao fornecedor.</p>
                </div>
                <div className="site-mostra">
                  <MiniEstoque />
                </div>
              </article>
              <article className="site-bloco site-revela site-cartao flex flex-col gap-5 p-6 sm:p-8" style={{ '--cor': 'var(--s-violeta)' } as CSSProperties}>
                <div>
                  <Olho cor="var(--s-violeta)">Financeiro e DRE</Olho>
                  <h3 className="mt-3 text-2xl font-extrabold">Quanto sobrou de verdade.</h3>
                  <p className="mt-2 text-[15px] text-[var(--s-tinta-2)]">O lucro do mês com o custo de cada peça e a taxa da maquininha já descontados.</p>
                </div>
                <div className="site-mostra">
                  <MiniGrafico cor="var(--s-violeta)" />
                </div>
              </article>
              <article className="site-bloco site-revela site-cartao flex flex-col gap-5 p-6 sm:p-8" style={{ '--cor': 'var(--s-rosa)' } as CSSProperties}>
                <div>
                  <Olho cor="var(--s-rosa)">Equipe, metas e comissão</Olho>
                  <h3 className="mt-3 text-2xl font-extrabold">O time no mesmo ritmo.</h3>
                  <p className="mt-2 text-[15px] text-[var(--s-tinta-2)]">Meta e comissão por vendedor, tarefas no quadro e o mês de cada um em estrelas.</p>
                </div>
                <div className="site-mostra">
                  <MiniEquipe />
                </div>
              </article>
              <article className="site-bloco site-revela site-cartao flex flex-col gap-5 p-6 sm:p-8" style={{ '--cor': 'var(--s-sol)' } as CSSProperties}>
                <div>
                  <Olho cor="var(--s-sol)">Funciona sem internet</Olho>
                  <h3 className="mt-3 text-2xl font-extrabold">A fila não para.</h3>
                  <p className="mt-2 text-[15px] text-[var(--s-tinta-2)]">Caiu a conexão no pico? O balcão segue vendendo e sobe tudo depois, sem duplicar.</p>
                </div>
                <div className="site-mostra">
                  <MiniSemInternet />
                </div>
              </article>
              <article className="site-bloco site-revela site-cartao flex flex-col gap-4 p-6 sm:p-8" style={{ '--cor': 'var(--s-rosa)' } as CSSProperties}>
                <Olho cor="var(--s-rosa)">Clientes e crediário</Olho>
                <h3 className="text-2xl font-extrabold">Cliente que volta.</h3>
                <p className="text-[15px] text-[var(--s-tinta-2)]">
                  Ficha com o histórico, programa de pontos, crediário com carnê e a lista de quem sumiu há mais de 60 dias — pronta para chamar.
                </p>
              </article>
              <article className="site-bloco site-revela site-cartao flex flex-col gap-4 p-6 sm:p-8 md:col-span-2" style={{ '--cor': 'var(--s-azul)' } as CSSProperties}>
                <Olho cor="var(--s-azul)">Simples ou avançado</Olho>
                <h3 className="text-2xl font-extrabold">A moça do balcão não se perde. O dono vê tudo.</h3>
                <p className="max-w-2xl text-[15px] text-[var(--s-tinta-2)]">
                  O modo simples mostra só o que importa para atender, com botões grandes. O avançado abre os gráficos, a curva ABC, a comparação entre lojas e o dinheiro parado.
                  Cada cargo vê só o que pode — subgerente, estoquista, caixa — e cada mexida fica assinada no livro.
                </p>
                <div className="flex flex-wrap gap-2">
                  {['Encomendas e agenda', 'Compras e fornecedores', 'Etiquetas', 'Várias lojas e depósito', 'Ponto da equipe', 'Relatórios'].map((f) => (
                    <Ficha key={f} cor="var(--s-azul)">
                      {f}
                    </Ficha>
                  ))}
                </div>
              </article>
            </LuzQueSegue>
          </div>
        </section>

        {/* ── catálogo ── */}
        <Destaque
          id="catalogo"
          cor="var(--s-rosa)"
          olho="Catálogo online · novo"
          titulo={
            <>
              Sua vitrine no celular de <span className="text-[var(--s-rosa)]">cada cliente</span>.
            </>
          }
          texto="Cada loja ganha um link com o que tem nela agora: foto, preço e categoria. A cliente escolhe, monta a sacola e manda o pedido — que chega organizado em Encomendas e no seu WhatsApp. Sem site para montar e sem taxa por pedido."
          itens={[
            'Abra o catálogo com um clique e mande o link no status, no Instagram e nos grupos.',
            'O pedido chega com os itens, a forma de pagamento e se é entrega ou retirada.',
            'A cliente acompanha: aceito, pronto, saiu para entrega — com o botão para falar com a loja.',
            'Na hora de receber, os produtos entram no balcão e o estoque baixa sozinho.',
          ]}
          fichas={['Retirada ou entrega', 'Taxa e pedido mínimo', 'Chave Pix', 'Esgotado some sozinho', 'Um link por loja']}
          foto="/img/site/catalogo.webp"
          alt="Cliente escolhendo produtos pelo catálogo da loja no celular, numa mesa de café"
          foco="object-[25%_50%]"
          tela={<CelularCatalogo />}
        />

        {/* ── assistente ── */}
        <section className="bg-[var(--s-cartao)]">
          <Destaque
            id="assistente"
            cor="var(--s-verde)"
            olho="Assistente com IA no WhatsApp"
            titulo={
              <>
                Mande um áudio. <span className="text-[var(--s-verde)]">O estoque se atualiza.</span>
              </>
            }
            texto={
              <>
                “Chegaram 48 águas a R$ 1,20.” O assistente entende, monta a entrada com o valor e pergunta. Você responde <b>SIM</b> e está feito — com o saldo
                novo na resposta. Para você e a sua equipe, no WhatsApp que vocês já usam.
              </>
            }
            itens={[
              'Relatório de manhã e à noite: o que vendeu, o que vai faltar, as contas do dia.',
              'Pergunte qualquer coisa: “quanto vendi ontem na loja do centro?”',
              'Pedido novo do catálogo avisado na hora — responda ACEITAR ou PRONTO.',
              'Nada acontece sem o seu SIM. Tetos de valor no banco, tudo assinado no livro.',
            ]}
            foto="/img/site/mercadoria.webp"
            alt="Dono de loja no estoque, entre as caixas que acabaram de chegar, gravando um áudio no WhatsApp"
            foco="object-[60%_15%]"
            tela={<ConversaAssistente />}
            invertido
            rodape={
              <p className="site-revela text-[14px] text-[var(--s-tinta-2)]">
                Assistente: {reais(PRECOS.assistente)} a mais por mês para a empresa inteira, com {milhar(PRECOS.respostasDoAssistente)} respostas.
              </p>
            }
          />
        </section>

        {/* ── Farol ── */}
        <Destaque
          id="farol"
          cor="var(--s-sol)"
          olho="Farol · marketing com IA"
          titulo={
            <>
              Conteúdo que vende, escrito a partir do que <span className="text-[var(--s-sol)]">a sua loja vende</span>.
            </>
          }
          texto="O Farol lê os seus números — o que mais sai, os horários de movimento, os bairros — e escreve o mês inteiro da sua marca. Você revisa, aprova e posta. Sem agência, sem página em branco."
          itens={[
            'Diagnóstico do nicho e calendário do mês, com a data de cada post.',
            'Roteiros de Reels, carrosséis, legendas e os comentários certos para fazer.',
            'Anúncios e campanhas no WhatsApp com começo, meio e fim.',
            'Nunca usa dado de cliente: só os números da loja, somados.',
          ]}
          fichas={['Instagram', 'TikTok', 'WhatsApp', `${reais(PRECOS.farolMarca)}/mês por marca`]}
          foto="/img/site/farol.webp"
          alt="Dona de loja gravando um vídeo do produto com o celular e um anel de luz"
          foco="object-[30%_15%]"
          tela={<PecasFarol />}
        />

        {/* ── começar ── */}
        <section id="comecar" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Cabeca
              centro
              olho="Comece hoje"
              cor="var(--s-azul)"
              titulo={
                <>
                  Seus produtos entram em <span className="text-[var(--s-azul)]">minutos</span>, não em semanas.
                </>
              }
              texto="Exporte a planilha do sistema antigo — ou copie e cole. O Norte entende as colunas sozinho, mostra a prévia e importa sem repetir nada."
            />
            <div className="site-revela mt-14">
              <PlanilhaParaNorte />
            </div>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {[
                ['1', 'Crie a conta', 'Dois minutos. O sistema já abre com as categorias, as variações e o jeito de vender do seu ramo.'],
                ['2', 'Traga o que você já tem', 'Excel, CSV ou colar da planilha. Para migração grande, a nossa equipe faz junto com você.'],
                ['3', 'Abra o caixa e mande o link', 'Comece a vender no balcão e mande o catálogo para as clientes no mesmo dia.'],
              ].map(([n, t, d]) => (
                <div key={n} className="site-revela site-cartao rounded-[24px] p-6">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--s-azul-claro)] text-lg font-extrabold text-[var(--s-azul)]">{n}</span>
                  <h3 className="mt-4 text-xl font-extrabold">{t}</h3>
                  <p className="mt-1.5 text-[15px] text-[var(--s-tinta-2)]">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── o sistema por dentro ── */}
        <section id="demo" className="scroll-mt-20 bg-[var(--s-cartao)] py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Cabeca
              centro
              olho="Por dentro"
              cor="var(--s-violeta)"
              titulo="Clique e explore o sistema de verdade."
              texto="Uma tarde numa loja de exemplo. Troque de tela, abra o balcão, veja o estoque e o financeiro — sem cadastro."
            />
            <div className="site-cresce mt-12 overflow-hidden rounded-[28px]">
              <SistemaPorDentro textos={TEXTOS} consulta={CONSULTA_EXEMPLO} />
            </div>
          </div>
        </section>

        {/* ── para quem é ── */}
        <section id="ramos" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Cabeca
              olho="Para quem é"
              cor="var(--s-rosa)"
              titulo="Feito para o seu ramo desde o primeiro dia."
              texto="Diga o seu ramo no cadastro e o Norte já abre com as categorias, as variações e o jeito de vender de quem é do ramo. Toque no seu:"
            />
            <div className="site-revela mt-12">
              <Ramos ramos={RAMOS_VITRINE} />
            </div>
            <div className="site-revela mt-10">
              <p className="text-[13px] font-bold text-[var(--s-tinta-2)]">E também:</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {RAMOS_FAIXA.filter((t) => !RAMOS_VITRINE.some((r) => r.titulo === t)).map((r, i) => (
                  <Ficha key={r} cor={['var(--s-azul)', 'var(--s-rosa)', 'var(--s-verde)', 'var(--s-sol)', 'var(--s-violeta)'][i % 5]!}>
                    {r}
                  </Ficha>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── segurança ── */}
        <section className="bg-[#0b1230] py-20 text-white sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="site-revela flex max-w-3xl flex-col gap-4">
              <span className="site-olho text-[#8fb0ff]">Segurança</span>
              <h2 className="text-[2.1rem] leading-[1.05] font-extrabold sm:text-5xl" style={{ color: 'white' }}>
                O seu dado fica com você. Trancado.
              </h2>
            </div>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {SEGURANCA.map(({ Icone, t, d }) => (
                <div key={t} className="site-revela rounded-[24px] border border-white/10 bg-white/[0.04] p-5">
                  <Icone tamanho={36} className="text-[#8fb0ff]" />
                  <h3 className="mt-4 text-[17px] font-extrabold" style={{ color: 'white' }}>
                    {t}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-white/70">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── preço ── */}
        <section id="precos" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Cabeca
              centro
              olho="Preço"
              cor="var(--s-verde)"
              titulo={
                <>
                  Preço por loja. <span className="text-[var(--s-verde)]">A equipe entra de graça.</span>
                </>
              }
              texto="Monte a sua conta: sem taxa por usuário, sem taxa por pedido do catálogo, sem fidelidade."
            />
            <div className="site-revela mt-12">
              <Calculadora comecar={COMECAR} />
            </div>

            {/* Um plano, por loja — e, ao lado, o que liga por cima para a
                empresa inteira. Antes eram dois cartões de plano ("Norte" e
                "Norte + Assistente") e a pergunta "qual é a diferença?"; o
                assistente é uma chave, e a página passou a dizer isso. */}
            <div className="mt-10 grid gap-4 lg:grid-cols-[1.05fr_1fr]">
              <article className="site-revela relative flex flex-col gap-5 rounded-[28px] border-2 border-[var(--s-verde)] bg-[var(--s-cartao)] p-7 shadow-[var(--s-sombra-alta)]">
                <div>
                  <h3 className="text-2xl font-extrabold">{O_PLANO.nome}</h3>
                  <p className="mt-2">
                    <span className="font-[family-name:var(--font-display)] text-4xl font-extrabold tabular-nums">{O_PLANO.preco}</span>
                  </p>
                  <p className="text-[14px] text-[var(--s-tinta-2)]">{O_PLANO.sub}</p>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {O_PLANO.itens.map((i) => {
                    const breve = i.endsWith(' · em breve')
                    return (
                      <li key={i} className="flex gap-2.5 text-[15px]">
                        <Visto cor="var(--s-verde)" />
                        <span>
                          {breve ? i.replace(' · em breve', '') : i}
                          {breve ? <span className="ml-2 rounded-full bg-[var(--s-sol-claro)] px-2 py-0.5 text-[11px] font-bold text-[var(--s-sol)]">em breve</span> : null}
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <a href={COMECAR} className="site-botao site-botao-principal mt-auto px-6 py-3.5 text-[15px]">
                  Testar {PRECOS.diasDeTeste} dias grátis
                </a>
              </article>

              <div className="flex flex-col gap-3">
                <p className="site-olho px-1 text-[var(--s-tinta-2)]">Liga se quiser, para a empresa inteira</p>
                {POR_CIMA.map((a) => (
                  <div key={a.t} className="site-revela site-cartao flex items-start justify-between gap-4 rounded-[24px] p-5">
                    <div className="min-w-0">
                      <Olho cor={a.cor}>{a.t}</Olho>
                      <p className="mt-2 text-[14px] text-[var(--s-tinta-2)]">{a.d}</p>
                      <p className="mt-1 text-[13px] text-[var(--s-tinta-2)]">{a.sub}</p>
                    </div>
                    <p className="shrink-0 text-right text-xl font-extrabold tabular-nums">{a.preco}</p>
                  </div>
                ))}
                <div className="site-revela flex items-start justify-between gap-4 rounded-[24px] border border-dashed border-[var(--s-borda)] p-5">
                  <div className="min-w-0">
                    <Olho cor="var(--s-azul)">Implantação</Olho>
                    <p className="mt-2 text-[13px] text-[var(--s-tinta-2)]">
                      Cadastro simples não paga nada. Trazer de outro sistema ou montar a fábrica: de {reais(IMPLANTACAO.de)} a{' '}
                      {reais(IMPLANTACAO.ate)}, uma vez, com orçamento antes.
                    </p>
                  </div>
                  <p className="shrink-0 text-right text-xl font-extrabold">Grátis</p>
                </div>
              </div>
            </div>

            <p className="site-revela mt-8 text-center text-[15px] text-[var(--s-tinta-2)]">
              Prefere pagar o ano? {12 - PRECOS.anualPagaMeses} meses grátis —{' '}
              <a href={mailto('Norte no anual')} className="font-bold text-[var(--s-azul)] underline-offset-4 hover:underline">
                fale com a gente
              </a>
              . Rede grande ou operação especial? A gente monta com você.
            </p>
          </div>
        </section>

        {/* ── dúvidas ── */}
        <section id="duvidas" className="scroll-mt-20 bg-[var(--s-cartao)] py-20 sm:py-28">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
            <Cabeca olho="Dúvidas" cor="var(--s-violeta)" titulo="O que costumam perguntar antes de assinar." texto="Não achou a sua? Escreva para a gente — quem responde é quem faz o sistema." />
            <div className="site-revela flex flex-col gap-3">
              {PERGUNTAS.map((q) => (
                <details key={q.p} className="group site-cartao rounded-2xl px-5 py-4 open:shadow-[var(--s-sombra-alta)]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-bold [&::-webkit-details-marker]:hidden">
                    {q.p}
                    <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--s-violeta-claro)] text-[var(--s-violeta)] transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-[15px] leading-relaxed text-[var(--s-tinta-2)]">{q.r}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── o fechamento ── */}
        <section className="px-4 py-20 sm:px-6 sm:py-28">
          <div className="site-cresce relative mx-auto max-w-6xl overflow-hidden rounded-[40px]">
            <Foto src="/img/site/fimdodia.webp" alt="Dona de loja tranquila no fim do dia, olhando os números no notebook" className="absolute inset-0 h-full w-full" />
            <div className="absolute inset-0 bg-[linear-gradient(100deg,rgb(11_18_48/0.92)_20%,rgb(11_18_48/0.55)_60%,rgb(11_18_48/0.15))]" />
            <div className="relative flex max-w-2xl flex-col items-start gap-6 p-8 py-16 sm:p-14 sm:py-24">
              <span className="site-olho text-[#ffc04d]">Comece hoje</span>
              <h2 className="text-[2.3rem] leading-[1.04] font-extrabold sm:text-6xl" style={{ color: 'white' }}>
                Feche o mês sabendo para onde foi cada real.
              </h2>
              <p className="text-lg text-white/80">
                {PRECOS.diasDeTeste} dias com tudo liberado, o assistente incluso, sem cartão. Se não fizer sentido, você não paga nada.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <a href={COMECAR} className="site-botao site-botao-principal px-8 py-4 text-[16px]">
                  Testar {PRECOS.diasDeTeste} dias grátis
                </a>
                <a href={mailto('Quero conhecer o Norte')} className="site-botao border border-white/30 px-8 py-4 text-[16px] text-white hover:bg-white/10">
                  Falar com a gente
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── o rodapé ── */}
      <footer className="border-t border-[var(--s-borda)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="flex flex-col gap-4">
            <Marca tamanho={26} id="rodape-sol" />
            <p className="max-w-xs text-sm leading-relaxed text-[var(--s-tinta-2)]">
              Sistema de gestão para o comércio: PDV, estoque, catálogo no WhatsApp, financeiro e um assistente com IA. Recebeu um convite? Use o link que chegou para você.
            </p>
          </div>
          {[
            {
              t: 'Produto',
              l: [
                ['Funções', '#funcoes'],
                ['Catálogo online', '#catalogo'],
                ['Assistente no WhatsApp', '#assistente'],
                ['Farol', '#farol'],
                ['Para o seu ramo', '#ramos'],
                ['Por dentro', '#demo'],
              ],
            },
            {
              t: 'Empresa',
              l: [
                ['Preços', '#precos'],
                ['Dúvidas', '#duvidas'],
                ['Falar com a gente', mailto('Contato pelo site')],
                ['Entrar', ENTRAR],
              ],
            },
            {
              t: 'Legal',
              l: [
                ['Termos de uso', '/termos'],
                ['Privacidade', '/privacidade'],
                ['Exclusão de dados', '/exclusao-de-dados'],
              ],
            },
          ].map((c) => (
            <div key={c.t}>
              <p className="site-olho text-[var(--s-tinta-2)]">{c.t}</p>
              <ul className="mt-4 flex flex-col gap-2.5 text-[14px]">
                {c.l.map(([n, h]) => (
                  <li key={n}>
                    <a href={h} className="font-medium text-[var(--s-tinta-2)] hover:text-[var(--s-tinta)]">
                      {n}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {/* A identidade de quem opera o site (src/servidor/legal.ts). Enquanto
            for nula, só o e-mail aparece: nada de razão social de mentira. */}
        <div className="border-t border-[var(--s-borda)]">
          <div className="mx-auto flex max-w-6xl flex-col gap-1.5 px-4 py-6 text-xs leading-relaxed text-[var(--s-tinta-2)] sm:px-6">
            <p className="break-words">
              {[EMPRESA.razaoSocial, EMPRESA.cnpj && `CNPJ ${EMPRESA.cnpj}`, EMPRESA.endereco].filter(Boolean).map((parte) => (
                <span key={parte as string}>{parte} · </span>
              ))}
              <a href={`mailto:${EMPRESA.email}`} className="hover:text-[var(--s-tinta)]">
                {EMPRESA.email}
              </a>
            </p>
            <p>© {new Date().getFullYear()} Norte. As telas e os números desta página são de uma loja de exemplo; as fotos são ilustrativas.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
