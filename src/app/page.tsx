import type { Metadata } from 'next'
import { Marca, Simbolo } from '@/ui/Marca'

// A página de venda.
//
// Ela existe para uma pessoa que nunca ouviu falar da gente decidir, em dois
// minutos, se vale a conversa. Por isso a ordem é: o que é → por que dói →
// o que faz → o que só a gente faz → quanto custa → e as dúvidas que travam
// a assinatura.
//
// Três coisas que NÃO estão aqui, de propósito:
//
// • Logo de cliente e depoimento. Não temos ainda. Inventar isso é o tipo de
//   mentira que o primeiro cliente descobre na primeira conversa.
// • Número de mercado ("+30% de vendas"). Não medimos. Promessa que a gente
//   não sabe cumprir vira pedido de reembolso no segundo mês.
// • "Grátis para sempre". Cada cliente custa uma instância de WhatsApp desde
//   o primeiro dia, mesmo parado.

export const metadata: Metadata = {
  title: 'Norte — gestão da empresa, do balcão ao WhatsApp',
  description:
    'Sistema de gestão para comércio: produto, estoque, balcão, caixa e o resultado do mês. Com um assistente de IA no WhatsApp que você batiza e que conhece a sua operação.',
}

const PLANOS = [
  {
    nome: 'Balcão',
    preco: '349',
    para: 'Uma loja, até 5 pessoas',
    itens: [
      'Produtos com as variações da sua loja',
      'Estoque com histórico de cada movimento',
      'Balcão, caixa e fechamento do turno',
      'Financeiro e o DRE do mês',
      'Equipe com permissão por pessoa',
    ],
  },
  {
    nome: 'Balcão + Agente',
    preco: '697',
    para: 'Uma loja, com o assistente no WhatsApp',
    destaque: 'O mais pedido',
    itens: [
      'Tudo do Balcão',
      'Assistente no WhatsApp, com o nome que você der',
      'Cobrança de atraso, aviso de ruptura, relatório 2× por dia',
      'Teto de valor e de desconto que você define',
      'Toda ação do assistente assinada no livro',
    ],
  },
  {
    nome: 'Rede',
    preco: '1.497',
    para: 'Até 5 lojas · R$ 249 por loja extra',
    itens: [
      'Tudo do Balcão + Agente',
      'Estoque separado por loja, consolidado num clique',
      'Cada gerente vê só a loja dele',
      'Metas e ranking de vendedor',
      'Nota fiscal e WhatsApp oficial da Meta',
    ],
  },
  {
    nome: 'Corporativo',
    preco: null,
    para: 'Sem limite de lojas',
    itens: [
      'Tudo da Rede',
      'Login único da empresa (SSO)',
      'Ambiente dedicado e acordo de nível de serviço',
      'Gerente de conta',
    ],
  },
]

const FAZ = [
  {
    t: 'Produtos',
    d: 'Você nomeia os eixos: Cor e Tamanho na roupa, Numeração na sapataria, Sabor na sorveteria. Vende por unidade, por quilo, por litro ou por par.',
  },
  {
    t: 'Estoque',
    d: 'Cada loja com o saldo dela. A conta acontece dentro do banco, então duas vendas ao mesmo tempo nunca perdem uma baixa. E o histórico é a verdade: o sistema acusa se o saldo divergir.',
  },
  {
    t: 'Balcão',
    d: 'Bipa a etiqueta, Enter lança. Pagamento dividido em várias formas, troco calculado, e o caixa fecha conferindo a gaveta.',
  },
  {
    t: 'Financeiro',
    d: 'Contas a pagar avisando o que venceu, despesa lançada em dois cliques e o DRE mensal no formato que o seu contador reconhece.',
  },
  {
    t: 'Equipe',
    d: 'Permissão por pessoa e por loja. O gerente da loja 3 não vê o caixa da 5, e ninguém concede um cargo que ele mesmo não tem.',
  },
  {
    t: 'Livro de auditoria',
    d: 'Quem mexeu, no quê, quando, de quanto para quanto. O livro só recebe: não tem como reescrever nem apagar — nem por nós.',
  },
]

const PERGUNTAS = [
  {
    p: 'Eu não vendo fiado. Vou ter que ver crediário na tela?',
    r: 'Não. No cadastro inicial você diz o que a sua empresa usa, e o que não usa some — do menu, dos relatórios e do que o assistente sabe fazer. Ligar depois é uma chave em Configurações.',
  },
  {
    p: 'O assistente pode dar desconto sozinho? Mexer no meu preço?',
    r: 'Só até onde você deixar, e nunca sozinho em nada que envolve dinheiro, preço ou estoque: ele propõe e uma pessoa confirma. O teto é número no banco, não instrução de texto — texto quem manda mensagem consegue tentar sobrescrever.',
  },
  {
    p: 'Tenho 12 lojas. Cada uma com o estoque dela?',
    r: 'Sim, e o consolidado num clique. O dono vê todas; o gerente de cada loja vê só a dele — inclusive se colar na barra de endereço o código de outra.',
  },
  {
    p: 'Emite nota fiscal?',
    r: 'Sim, nos planos Rede e Corporativo, e como opcional no Balcão. Você precisa do certificado digital A1 e da classificação fiscal dos produtos — é trabalho do seu contador, e é o que mais atrasa a entrada.',
  },
  {
    p: 'E os meus dados ficam misturados com os de outra empresa?',
    r: 'Não. O isolamento tem duas paredes: a aplicação só fala com o banco já presa à sua empresa, e o próprio Postgres se recusa a devolver linha de outra. A segunda existe justamente para o dia em que a primeira falhar.',
  },
  {
    p: 'Quanto tempo para começar a usar?',
    r: 'O cadastro inicial leva alguns minutos e o sistema já abre com as categorias e os eixos do seu ramo prontos. Cadastrar o catálogo é o que dá trabalho — e é onde a gente ajuda.',
  },
]

const DOR: [string, string][] = [
  [
    'Você sabe quanto vendeu.',
    'Sabe quanto SOBROU? Faturamento não é lucro, e a conta que separa os dois é a que quase ninguém faz todo mês.',
  ],
  [
    'O sistema diz que tem 4.',
    'A prateleira tem 2. Quando o estoque para de bater, ele deixa de servir para decidir compra — e vira número que ninguém olha.',
  ],
  [
    'Alguém está atrasado.',
    'Quem lembra de cobrar? A conversa que traz o dinheiro de volta é chata, é repetitiva, e é sempre a primeira a ficar para amanhã.',
  ],
]

const REGRAS_AGENTE: [string, string][] = [
  [
    'Mexeu em dinheiro, preço ou estoque: ele propõe, você confirma.',
    'Nada de descobrir depois que o robô resolveu dar 40%.',
  ],
  [
    'Teto em tudo, e o teto é número no banco.',
    'Desconto máximo, valor máximo de link, gasto de IA por dia. Instrução de texto define personalidade — nunca permissão.',
  ],
  [
    'Toda ação vai para o livro, com antes e depois.',
    'Inclusive as nossas, quando entramos para dar suporte.',
  ],
]

const SEGURANCA: [string, string][] = [
  [
    'Duas paredes',
    'A aplicação só fala com o banco já presa à sua empresa. E o Postgres, por baixo, se recusa a devolver linha de outra. A segunda existe para o dia em que a primeira falhar.',
  ],
  [
    'O livro não se apaga',
    'A auditoria só recebe. Sem alterar, sem excluir — e a tentativa levanta erro em vez de falhar em silêncio.',
  ],
  [
    'Tirou o acesso, acabou na hora',
    'Desativou alguém no meio do expediente? A tela seguinte que ele abrir já pede login. Não espera cookie expirar.',
  ],
  [
    'Porta com freio',
    'Erro de senha repetido trava a tentativa por alguns minutos, por conta e por origem. Lista de senhas comuns rodando a noite inteira não passa.',
  ],
]

export default function Inicio() {
  return (
    <div className="flex min-h-dvh flex-col bg-superficie">
      {/* ── barra ── */}
      <header className="sticky top-0 z-20 border-b border-borda bg-superficie/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <Marca tamanho={28} id="topo" />
          <nav className="hidden items-center gap-6 text-sm font-medium text-tinta-2 sm:flex">
            <a href="#faz" className="hover:text-tinta">
              O que faz
            </a>
            <a href="#agente" className="hover:text-tinta">
              O assistente
            </a>
            <a href="#planos" className="hover:text-tinta">
              Planos
            </a>
          </nav>
          <a
            href="#planos"
            className="rounded-norte bg-marca px-3.5 py-2 text-sm font-semibold text-marca-tinta hover:bg-marca-forte"
          >
            Começar
          </a>
        </div>
      </header>

      {/* ── topo ── */}
      <section className="bg-nav">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-[1.05fr_1fr] md:items-center md:py-24">
          <div className="flex flex-col items-start gap-5">
            <span className="rounded-full border border-nav-borda bg-nav-2 px-3 py-1 text-xs font-semibold text-sol-claro">
              Gestão + assistente de IA no WhatsApp
            </span>
            <h1 className="text-4xl leading-[1.08] font-extrabold tracking-[-0.03em] text-nav-tinta md:text-[52px]">
              A empresa inteira numa tela só.
              <br />
              <span className="text-sol-claro">E no WhatsApp.</span>
            </h1>
            <p className="max-w-lg text-base leading-relaxed text-nav-tinta-2 md:text-lg">
              Produto, estoque, balcão, caixa e o resultado do mês. E um assistente que você
              batiza, que conhece o seu estoque de verdade e cobra, avisa e responde por você
              — dentro dos limites que você define.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a
                href="#planos"
                className="rounded-norte bg-marca px-5 py-3 text-sm font-semibold text-marca-tinta hover:bg-marca-forte"
              >
                Ver os planos
              </a>
              <a
                href="#agente"
                className="rounded-norte border border-nav-borda px-5 py-3 text-sm font-semibold text-nav-tinta hover:bg-nav-2"
              >
                Como o assistente funciona
              </a>
            </div>
            <p className="text-xs text-nav-tinta-2">
              14 dias para testar · do balcão de bairro à rede com dezenas de lojas
            </p>
          </div>

          <MockPainel />
        </div>
      </section>

      {/* ── a dor ── */}
      <section className="border-b border-borda bg-superficie">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-14 sm:grid-cols-3">
          {DOR.map(([t, d]) => (
            <div key={t} className="flex flex-col gap-2">
              <h3 className="text-lg font-bold tracking-tight text-tinta">{t}</h3>
              <p className="text-sm leading-relaxed text-tinta-2">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── o que faz ── */}
      <section id="faz" className="scroll-mt-16 bg-fundo">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Titulo
            olho="O núcleo"
            titulo="O que todo cliente tem, no primeiro dia"
            resumo="Sem módulo pago escondido no meio do caminho. O que muda de plano é a quantidade de lojas e o assistente."
          />
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FAZ.map((f) => (
              <div
                key={f.t}
                className="flex flex-col gap-2 rounded-norte border border-borda bg-superficie p-5"
              >
                <h3 className="text-base font-bold text-tinta">{f.t}</h3>
                <p className="text-sm leading-relaxed text-tinta-2">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── o agente ── */}
      <section id="agente" className="scroll-mt-16 bg-nav">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 md:grid-cols-2 md:items-center md:py-20">
          <div className="flex flex-col gap-5">
            <span className="text-xs font-bold tracking-[0.14em] text-sol-claro uppercase">
              O que só o Norte faz
            </span>
            <h2 className="text-3xl leading-tight font-extrabold tracking-[-0.02em] text-nav-tinta md:text-4xl">
              Um assistente que <span className="text-sol-claro">age</span>, não um robô que
              responde.
            </h2>
            <p className="leading-relaxed text-nav-tinta-2">
              Ele não é um chat com respostas prontas: ele lê o seu estoque, o seu caixa e as
              suas contas, e faz coisa que dá dinheiro. Você dá o nome, a personalidade e o
              que ele pode fazer. Ele é da sua loja, não da nossa.
            </p>
            <ul className="flex flex-col gap-3 pt-1">
              {REGRAS_AGENTE.map(([t, d]) => (
                <li key={t} className="flex gap-3">
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-sol-claro" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-nav-tinta">{t}</span>
                    <span className="text-sm text-nav-tinta-2">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <MockConversa />
        </div>
      </section>

      {/* ── planos ── */}
      <section id="planos" className="scroll-mt-16 bg-fundo">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Titulo
            olho="Planos"
            titulo="Preço por tamanho de operação"
            resumo="Sem taxa de implantação escondida. Loja extra tem preço de tabela, não “fale com o comercial”."
          />
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANOS.map((p) => (
              <div
                key={p.nome}
                className={
                  p.destaque
                    ? 'relative flex flex-col gap-4 rounded-norte border-2 border-marca bg-superficie p-5 shadow-norte'
                    : 'flex flex-col gap-4 rounded-norte border border-borda bg-superficie p-5'
                }
              >
                {p.destaque && (
                  <span className="absolute -top-2.5 left-5 rounded-full bg-marca px-2.5 py-0.5 text-[11px] font-bold text-marca-tinta">
                    {p.destaque}
                  </span>
                )}
                <div className="flex flex-col gap-1">
                  <h3 className="text-lg font-bold text-tinta">{p.nome}</h3>
                  <p className="text-xs text-tinta-3">{p.para}</p>
                </div>
                <p className="flex items-baseline gap-1">
                  {p.preco ? (
                    <>
                      <span className="text-sm font-semibold text-tinta-2">R$</span>
                      <span className="numero text-3xl font-extrabold tracking-tight text-tinta">
                        {p.preco}
                      </span>
                      <span className="text-sm text-tinta-3">/mês</span>
                    </>
                  ) : (
                    <span className="text-xl font-extrabold tracking-tight text-tinta">
                      Sob consulta
                    </span>
                  )}
                </p>
                <ul className="flex flex-1 flex-col gap-2">
                  {p.itens.map((i) => (
                    <li key={i} className="flex gap-2 text-sm text-tinta-2">
                      <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-bom-vivo" />
                      {i}
                    </li>
                  ))}
                </ul>
                <a
                  href="#falar"
                  className={
                    p.destaque
                      ? 'rounded-norte bg-marca px-4 py-2.5 text-center text-sm font-semibold text-marca-tinta hover:bg-marca-forte'
                      : 'rounded-norte border border-borda px-4 py-2.5 text-center text-sm font-semibold text-tinta hover:bg-superficie-2'
                  }
                >
                  {p.preco ? 'Começar o teste' : 'Falar com a gente'}
                </a>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs text-tinta-3">
            Valores mensais, por empresa. Nota fiscal e conciliação de maquininha entram como
            opcional no plano Balcão.
          </p>
        </div>
      </section>

      {/* ── segurança ── */}
      <section className="border-y border-borda bg-superficie">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Titulo
            olho="Segurança"
            titulo="O que a gente faz para o seu dado não virar problema"
            resumo="Isto costuma ficar escondido no contrato. Fica aqui porque é o que diferencia sistema multi-empresa feito direito de sistema de um cliente adaptado às pressas."
          />
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SEGURANCA.map(([t, d]) => (
              <div key={t} className="flex flex-col gap-2 rounded-norte bg-fundo p-5">
                <h3 className="text-base font-bold text-tinta">{t}</h3>
                <p className="text-sm leading-relaxed text-tinta-2">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── perguntas ── */}
      <section className="bg-fundo">
        <div className="mx-auto max-w-3xl px-5 py-16">
          <Titulo olho="Dúvidas" titulo="O que costumam perguntar antes de assinar" />
          <div className="mt-8 flex flex-col gap-3">
            {PERGUNTAS.map((q) => (
              <details
                key={q.p}
                className="group rounded-norte border border-borda bg-superficie px-5 py-4"
              >
                <summary className="cursor-pointer list-none text-sm font-bold text-tinta">
                  <span className="flex items-center justify-between gap-4">
                    {q.p}
                    <span
                      aria-hidden
                      className="shrink-0 text-tinta-3 transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-tinta-2">{q.r}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── fechamento ── */}
      <section id="falar" className="scroll-mt-16 bg-nav">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 px-5 py-16 text-center">
          <Simbolo tamanho={44} nu id="fim" />
          <h2 className="text-3xl font-extrabold tracking-[-0.02em] text-nav-tinta md:text-4xl">
            Comece pelo que dói mais.
          </h2>
          <p className="max-w-xl leading-relaxed text-nav-tinta-2">
            A gente monta o seu ambiente, sobe o seu catálogo junto com você e liga o
            assistente com o nome que você escolher. Em duas semanas você já sabe se vale.
          </p>
          <a
            href="mailto:contato@usenorte.com.br?subject=Quero%20testar%20o%20Norte"
            className="rounded-norte bg-marca px-6 py-3 text-sm font-semibold text-marca-tinta hover:bg-marca-forte"
          >
            Falar com a gente
          </a>
        </div>
      </section>

      <footer className="border-t border-borda bg-superficie">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
          <Marca tamanho={22} id="rodape" />
          <p className="text-xs text-tinta-3">
            Cada empresa entra pelo próprio endereço. Recebeu um convite? Use o link que chegou
            para você.
          </p>
        </div>
      </footer>
    </div>
  )
}

function Titulo({ olho, titulo, resumo }: { olho: string; titulo: string; resumo?: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-2.5">
      <span className="text-xs font-bold tracking-[0.14em] text-marca uppercase">{olho}</span>
      <h2 className="text-3xl leading-tight font-extrabold tracking-[-0.02em] text-tinta">
        {titulo}
      </h2>
      {resumo && <p className="leading-relaxed text-tinta-2">{resumo}</p>}
    </div>
  )
}

/**
 * O painel, desenhado à mão em HTML.
 *
 * Não é captura de tela: captura envelhece na primeira mudança de cor e sai
 * borrada em tela de retina. Desenhado, ele acompanha o tema e continua nítido
 * em qualquer densidade. Os números são os do ambiente de exemplo — não são de
 * cliente nenhum.
 */
function MockPainel() {
  const barras = [38, 52, 30, 61, 44, 72, 49, 88, 35, 57, 66, 41, 79, 54, 93, 47, 62, 36, 70, 58]
  const numeros: [string, string, string, string][] = [
    ['Hoje', 'R$ 774,71', '▲ 14,5% vs ontem', 'text-bom'],
    ['Este mês', 'R$ 9.009,74', '112 vendas', 'text-tinta-3'],
  ]
  return (
    <div className="rounded-xl bg-nav-2 p-2.5 shadow-[0_30px_60px_-25px_rgb(0_0_0/0.7)]">
      <div className="overflow-hidden rounded-lg bg-superficie">
        <div className="flex items-center justify-between border-b border-borda px-3.5 py-2.5">
          <span className="text-xs font-bold text-tinta">Painel</span>
          <span className="rounded border border-borda px-2 py-0.5 text-[10px] text-tinta-3">
            Todas as unidades ▾
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3">
          {numeros.map(([r, v, d, cor]) => (
            <div key={r} className="rounded-norte border border-borda p-3">
              <p className="text-[10px] text-tinta-3">{r}</p>
              <p className="numero text-lg font-extrabold text-tinta">{v}</p>
              <p className={`text-[10px] font-semibold ${cor}`}>{d}</p>
            </div>
          ))}
        </div>
        <div className="px-3 pb-3">
          <div className="rounded-norte border border-borda p-3">
            <p className="mb-2 text-[10px] font-semibold text-tinta-2">Últimos 30 dias</p>
            <div className="flex h-16 items-end gap-[3px]">
              {barras.map((h, i) => (
                <span
                  key={i}
                  className="flex-1 rounded-t-[2px] bg-bom-vivo"
                  style={{ height: `${h}%` }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-borda px-3.5 py-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-critico">
            <span aria-hidden className="size-2 rounded-full bg-critico-vivo" />2 contas vencidas
          </span>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-atencao">
            <span aria-hidden className="size-2 rounded-full bg-atencao-vivo" />3 itens acabando
          </span>
        </div>
      </div>
    </div>
  )
}

/** Uma conversa de exemplo — o assistente propondo, e a dona confirmando. */
function MockConversa() {
  const linhas: { de: 'agente' | 'pessoa'; texto: string }[] = [
    {
      de: 'agente',
      texto:
        'Bom dia! A Camiseta canelada Preto · G tem 2 peças e vende 9 por semana. Acaba quinta.',
    },
    { de: 'pessoa', texto: 'pede 20 pro fornecedor' },
    {
      de: 'agente',
      texto: 'Anotei a compra: 20 un × R$ 22,40 = R$ 448,00, vencimento em 30 dias. Confirma?',
    },
    { de: 'pessoa', texto: 'confirmo' },
    {
      de: 'agente',
      texto:
        'Pronto. Entrou em contas a pagar e avisei o Carlos no balcão. Esse mês eu já recuperei R$ 1.240 de crediário atrasado.',
    },
  ]
  return (
    <div className="rounded-xl bg-nav-2 p-2.5 shadow-[0_30px_60px_-25px_rgb(0_0_0/0.7)]">
      <div className="flex flex-col gap-2.5 rounded-lg bg-superficie p-4">
        <div className="flex items-center gap-2 border-b border-borda pb-2.5">
          <span className="flex size-7 items-center justify-center rounded-full bg-bom-vivo text-xs font-bold text-white">
            A
          </span>
          <span className="flex flex-col">
            <span className="text-xs font-bold text-tinta">Aurora</span>
            <span className="text-[10px] text-tinta-3">assistente da sua loja</span>
          </span>
        </div>
        {linhas.map((l, i) => (
          <p
            key={i}
            className={
              l.de === 'agente'
                ? 'max-w-[85%] self-start rounded-lg rounded-bl-sm bg-superficie-2 px-3 py-2 text-[12px] leading-relaxed text-tinta'
                : 'max-w-[85%] self-end rounded-lg rounded-br-sm bg-bom-fundo px-3 py-2 text-[12px] leading-relaxed text-tinta'
            }
          >
            {l.texto}
          </p>
        ))}
        <p className="pt-1 text-[10px] text-tinta-3">
          “Aurora” é só um exemplo — quem dá o nome é você.
        </p>
      </div>
    </div>
  )
}
