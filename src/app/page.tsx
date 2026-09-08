import type { Metadata } from 'next'
import Image from 'next/image'
import { Marca, Simbolo } from '@/ui/Marca'
import { Traco } from '@/ui/Traco'
import { HeroRolante } from '@/ui/HeroRolante'
import { ConversaFlutuante } from '@/ui/ConversaFlutuante'
import { CompararPlanos } from '@/ui/CompararPlanos'

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
    // O bloco do meio: o que este plano dá de IA, e a tradução para a unidade
    // que a pessoa entende. "R$ 0 de crédito" não diz nada; "o WhatsApp
    // continua sendo você" diz.
    credito: { valor: 'Sem assistente', nota: 'o WhatsApp continua sendo você', conta: null },
    itens: [
      'Produtos com as variações da sua loja',
      'Estoque com histórico de cada movimento',
      'Balcão, caixa e fechamento do turno',
      'Financeiro e o DRE do mês',
      'Equipe com permissão por pessoa',
    ],
    fora: ['Assistente no WhatsApp', 'Mais de uma loja', 'Crediário próprio'],
  },
  {
    nome: 'Balcão + Assistente',
    preco: '697',
    para: 'Uma loja, com o assistente no WhatsApp',
    destaque: 'O mais pedido',
    credito: {
      valor: 'R$ 120 de crédito de IA',
      nota: 'renovado todo mês · compra mais quando quiser',
      conta: '~2.000 conversas no WhatsApp',
    },
    itens: [
      'Tudo do Balcão',
      'Assistente no WhatsApp, com o nome que você der',
      'Cobrança de atraso, aviso de ruptura, relatório 2× por dia',
      'Teto de valor e de desconto que você define',
      'Toda ação do assistente assinada no livro',
    ],
    fora: ['Mais de uma loja', 'Crediário próprio'],
  },
  {
    nome: 'Rede',
    preco: '1.497',
    para: 'Até 5 lojas · R$ 249 por loja extra',
    credito: {
      valor: 'R$ 350 de crédito de IA',
      nota: 'renovado todo mês · compra mais quando quiser',
      conta: '~5.800 conversas no WhatsApp',
    },
    itens: [
      'Tudo do Balcão + Assistente',
      'Estoque separado por loja, consolidado num clique',
      'Cada gerente vê só a loja dele',
      'Crediário próprio, com juros e cobrança',
      'Metas e ranking de vendedor',
    ],
    fora: [],
  },
  {
    nome: 'Corporativo',
    preco: null,
    para: 'Sem limite de lojas',
    credito: {
      valor: 'R$ 800 de crédito de IA',
      nota: 'e o resto combinado no contrato',
      conta: '~13.000 conversas no WhatsApp',
    },
    itens: [
      'Tudo da Rede',
      'Site, tráfego e a condução do negócio com a gente',
      'Login único da empresa (SSO)',
      'Ambiente dedicado e acordo de nível de serviço',
      'Gerente de conta',
    ],
    fora: [],
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
          {/* Entrar e Comecar sao coisas diferentes e nao podem ter o mesmo
              peso: quem ja e cliente procura "entrar" e nao pode competir com
              a chamada de venda. Texto simples para um, botao solido escuro
              para o outro. */}
          <div className="flex items-center gap-4">
            <a href="/exemplo/entrar" className="text-sm font-medium text-tinta-2 hover:text-tinta">
              Entrar
            </a>
            <a
              href="#planos"
              className="rounded-norte bg-tinta px-4 py-2 text-sm font-semibold text-superficie hover:opacity-90"
            >
              Começar
            </a>
          </div>
        </div>
      </header>

      {/* ── topo ──
          A foto sangra a tela inteira e o texto mora EM CIMA dela. O véu é um
          degradê de azul-noite que vai de opaco na esquerda a quase nada na
          direita: assim a rua escura da foto some atrás do texto e a loja
          acesa continua visível do outro lado.

          Nenhum texto vai dentro da imagem gerada — modelo de imagem escreve
          letra embaralhada, e a primeira tentativa voltou com duas linhas de
          garrancho. A imagem é fundo; a palavra é HTML. */}
      <section
        className="emenda-base relative isolate overflow-hidden bg-nav"
        style={{ '--emenda-base': 'var(--superficie)' } as React.CSSProperties}
      >
        <Image
          src="/img/loja-a.png"
          alt=""
          aria-hidden
          fill
          priority
          sizes="100vw"
          className="object-cover object-[70%_center]"
        />
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(100deg, var(--nav) 0%, color-mix(in srgb, var(--nav) 92%, transparent) 34%, color-mix(in srgb, var(--nav) 55%, transparent) 62%, color-mix(in srgb, var(--nav) 18%, transparent) 100%)',
          }}
        />

        <div className="relative z-10 mx-auto max-w-6xl px-5 py-24 md:py-32">
          <div className="flex max-w-2xl flex-col items-start gap-6">
            <span className="rounded-full border border-white/20 bg-white/[0.07] px-3 py-1 text-xs font-semibold text-sol-claro backdrop-blur-sm">
              Gestão + assistente de IA no WhatsApp
            </span>
            <h1 className="text-[clamp(2.75rem,7.5vw,4.75rem)] leading-[0.95] !text-nav-tinta text-balance">
              A empresa inteira
              <br />
              numa tela só.
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-nav-tinta-2 md:text-lg">
              Produto, estoque, balcão, caixa e o resultado do mês. E um assistente que você
              batiza, que conhece o seu estoque de verdade e responde por você — dentro dos
              limites que você define.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a
                href="#planos"
                className="botao-marca rounded-norte px-6 py-3 text-sm font-semibold text-marca-tinta"
              >
                Ver os planos
              </a>
              <a
                href="#faz"
                className="rounded-norte border border-white/25 px-6 py-3 text-sm font-semibold text-nav-tinta backdrop-blur-sm hover:bg-white/10"
              >
                Ver o sistema por dentro
              </a>
            </div>

            <div className="w-full max-w-xl pt-2">
              <HeroRolante />
            </div>
          </div>
        </div>
      </section>

      {/* ── a dor ── */}
      <section className="bg-superficie">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-14 sm:grid-cols-3">
          {DOR.map(([t, d]) => (
            <div key={t} className="flex flex-col gap-2">
              <h3 className="text-lg font-bold tracking-tight">{t}</h3>
              <p className="text-sm leading-relaxed text-tinta-2">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── para quem é ──
          Bento no formato da referência, e a diferença que importa está na
          ORDEM DENTRO DO CARTÃO: título e parágrafo em cima, como texto normal
          e legível; a imagem embaixo, sangrando pela borda.

          A versão anterior jogava o texto POR CIMA da foto, com véu. Isso
          funciona para uma etiqueta de duas palavras e falha para explicar:
          texto sobre foto é sempre mais difícil de ler, e explicação precisa
          de contraste, não de atmosfera. A foto passou a ser o rodapé do
          cartão, e o texto voltou para o papel.

          Uma ideia completa em cima, dois blocos embaixo para completar — e um
          deles mistura vários comércios num mosaico só. */}
      <section className="bg-superficie">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Titulo
            olho="Para quem é"
            titulo="Comércio que vende no balcão e no WhatsApp"
            resumo="De uma loja de bairro à rede com dezenas de unidades."
          />

          <div className="mt-9 grid gap-3 lg:grid-cols-2">
            {/* A IDEIA COMPLETA — ocupa a largura toda, texto à esquerda e a
                foto sangrando pela direita e por baixo. */}
            <article className="relative isolate col-span-full grid overflow-hidden rounded-norte bg-superficie-2 lg:grid-cols-[1fr_1.15fr]">
              <div className="flex flex-col justify-center gap-3 p-6 sm:p-8">
                <h3 className="text-[clamp(1.75rem,3.2vw,2.5rem)] leading-[1.05] text-balance">
                  A mesma tela serve a uma loja e a quarenta
                </h3>
                <p className="max-w-[48ch] text-sm leading-relaxed text-tinta-2">
                  Quem começa com uma loja <strong className="font-semibold text-tinta">não
                  descobre nem que existe o conceito de unidade</strong> — o seletor de loja
                  só aparece quando nasce a segunda. E a arquitetura não tem teto: a mesma
                  tabela que guarda a loja única guarda a rede inteira.
                </p>
                <p className="max-w-[48ch] text-sm leading-relaxed text-tinta-2">
                  Não existe migração, nem “versão para redes”, nem contratar de novo.
                </p>
              </div>
              <div className="relative min-h-[16rem] lg:min-h-[20rem]">
                <Image
                  src="/img/dona-b.jpg"
                  alt=""
                  aria-hidden
                  fill
                  sizes="(max-width: 1024px) 100vw, 55vw"
                  className="object-cover"
                />
              </div>
            </article>

            {/* O MOSAICO — vários comércios numa peça só. */}
            <article className="relative isolate flex flex-col overflow-hidden rounded-norte bg-superficie-2">
              <div className="flex flex-col gap-2.5 p-6">
                <h3 className="text-xl leading-tight">Não é só loja de roupa</h3>
                <p className="max-w-[42ch] text-sm leading-relaxed text-tinta-2">
                  Você nomeia os eixos do seu ramo. <strong className="font-semibold text-tinta">Cor
                  e Tamanho</strong> na roupa, <strong className="font-semibold text-tinta">Numeração</strong> na
                  sapataria, <strong className="font-semibold text-tinta">Sabor</strong> na
                  sorveteria. Vende por unidade, por quilo, por litro ou por par.
                </p>
              </div>
              {/* As três fotos SE SOBREPÕEM, em alturas e profundidades
                  diferentes. A versão anterior era uma fila com espaços iguais
                  — e fila com espaço igual lê como contact sheet, não como
                  cena. O que dá o ar caro é a sobreposição: uma na frente da
                  outra, com sombra e um giro de meio grau, e a última saindo
                  pela borda direita. */}
              <div className="relative mt-auto h-44 px-6 sm:h-52">
                {[
                  {
                    src: '/img/sapataria.jpg',
                    cls: 'left-6 bottom-0 h-[78%] w-[42%] z-10 -rotate-[1.2deg]',
                  },
                  {
                    src: '/img/sorveteria.jpg',
                    cls: 'left-[32%] bottom-0 h-full w-[40%] z-20 rotate-[0.8deg]',
                  },
                  {
                    src: '/img/balcao-pagto.jpg',
                    cls: 'right-[-1.5rem] bottom-0 h-[64%] w-[38%] z-10 rotate-[1.6deg]',
                  },
                ].map((f) => (
                  <span
                    key={f.src}
                    className={`absolute overflow-hidden rounded-t-norte shadow-[0_-8px_30px_-10px_rgb(20_18_12/0.45)] ${f.cls}`}
                  >
                    <Image
                      src={f.src}
                      alt=""
                      aria-hidden
                      fill
                      sizes="20vw"
                      className="object-cover"
                    />
                  </span>
                ))}
              </div>
            </article>

            {/* O REGULAR — depósito e rede. */}
            <article className="relative isolate flex flex-col overflow-hidden rounded-norte bg-nav">
              <div className="flex flex-col gap-2.5 p-6">
                <h3 className="text-xl leading-tight !text-white">Depósito conta como loja</h3>
                <p className="max-w-[42ch] text-sm leading-relaxed text-white/65">
                  Cada unidade tem <strong className="font-semibold text-white">estoque e caixa
                  próprios</strong>, e o painel soma tudo num clique. O gerente da loja 3 não vê
                  o caixa da 5 — e ninguém concede um cargo que ele mesmo não tem.
                </p>
              </div>
              <div className="relative mt-auto h-40 sm:h-44">
                <Image
                  src="/img/distribuidora.jpg"
                  alt=""
                  aria-hidden
                  fill
                  sizes="(max-width: 1024px) 100vw, 45vw"
                  className="object-cover object-center"
                />
              </div>
            </article>
          </div>
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
                className="flex flex-col gap-2 border-t border-borda pt-4"
              >
                <h3 className="text-base font-bold text-tinta">{f.t}</h3>
                <p className="text-sm leading-relaxed text-tinta-2">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── o agente ──
          Fundo de aurora sangrando a seção, texto à esquerda no lado escuro e
          a conversa FLUTUANDO à direita — sem painel, sem moldura de celular,
          sem borda. A versão anterior era uma janelinha branca dentro de uma
          moldura escura dentro da seção: três degraus de caixa, e parecia
          print colado num slide.

          As bolhas agora pousam direto no fundo, com vidro fosco, indentação
          desigual e a última sangrando pela borda direita. É o que faz a cena
          parecer conversa acontecendo, e não captura de tela. */}
      <section
        id="agente"
        className="aurora emenda-topo emenda-base relative isolate scroll-mt-16 overflow-hidden"
        style={
          {
            '--emenda': 'var(--fundo)',
            '--emenda-base': 'var(--fundo)',
          } as React.CSSProperties
        }
      >

        {/* A LOJISTA RECORTADA, grande e encostada na borda direita.
            É o movimento que faltava: foto sem fundo pode sair da grade — ser
            cortada pela borda da seção e ficar atrás de um elemento e na
            frente de outro. Foto retangular nunca faz isso, porque retângulo
            obedece a grade.

            No CANTO e não no meio: no meio ela ficava debaixo das bolhas e as
            duas coisas se estragavam. Encostada na direita, ela ocupa a
            margem que sobra fora da coluna de conteúdo (que para em 6xl), e a
            conversa fica inteira do lado de cá.

            Só a partir de 1280px: em tela menor não existe essa margem, e ela
            passaria por cima da conversa. */}
        {/* O halo atrás dela. Sem ele, o recorte encosta no fundo escuro e
            some pelas bordas — com ele, a silhueta se destaca e o olho lê
            "está na frente", que é a sensação de profundidade. */}
        <span
          aria-hidden
          className="pointer-events-none absolute right-0 bottom-0 z-0 hidden h-[46rem] w-[34rem] translate-x-[14%] xl:block 2xl:h-[52rem]"
          style={{
            background:
              'radial-gradient(22rem 26rem at 52% 62%, color-mix(in srgb, var(--marca) 34%, transparent) 0%, transparent 72%)',
          }}
        />
        <Image
          src="/img/lojista-recorte.png"
          alt=""
          aria-hidden
          width={620}
          height={827}
          className="pointer-events-none absolute right-0 bottom-0 z-0 hidden h-[46rem] w-auto max-w-none translate-x-[26%] object-contain object-bottom drop-shadow-[0_40px_90px_rgb(0_0_0/0.75)] xl:block 2xl:h-[52rem] 2xl:translate-x-[20%]"
        />

        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 md:grid-cols-[1fr_1.05fr] md:py-28">
          <div className="flex flex-col gap-5">
            <span className="text-xs font-bold tracking-[0.14em] text-sol-claro uppercase">
              O que só o Norte faz
            </span>
            <h2 className="text-[clamp(2rem,4.4vw,3rem)] leading-[1.02] !text-nav-tinta text-balance">
              Um assistente que <em className="text-sol-claro not-italic">age</em>, não um robô
              que responde.
            </h2>
            <p className="max-w-lg leading-relaxed text-nav-tinta-2">
              Ele não é um chat com respostas prontas: ele lê o seu estoque, o seu caixa e as
              suas contas, e faz coisa que dá dinheiro. Você dá o nome, a personalidade e o
              que ele pode fazer.
            </p>
            <ul className="flex flex-col gap-3 pt-1">
              {[
                ['Mexeu em dinheiro, preço ou estoque: ele propõe, você confirma.', 'Nada de descobrir depois que o robô resolveu dar 40%.'],
                ['Teto em tudo, e o teto é número no banco.', 'Desconto máximo, valor de proposta, gasto de IA por dia.'],
                ['Toda ação vai para o livro, com antes e depois.', 'Inclusive as nossas, quando entramos para dar suporte.'],
              ].map(([t, d]) => (
                <li key={t} className="flex gap-2.5">
                  <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sol-claro" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-nav-tinta">{t}</span>
                    <span className="text-sm text-nav-tinta-2">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <ConversaFlutuante />
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
            {PLANOS.map((p, i) => (
              /* A ordem dentro do cartao e a mesma da referencia, e ela nao e
                 arbitraria: nome → para quem e → preco → O QUE VOCE GANHA DE
                 IA → botao → lista. O bloco do credito vem ANTES do botao
                 porque e ele que diferencia os pacotes na pratica; a lista de
                 recursos vem depois porque e quase igual nos quatro. */
              <div
                key={p.nome}
                className={
                  'relative flex flex-col gap-4 rounded-norte bg-superficie p-5 ' +
                  (p.destaque
                    ? 'border border-tinta/25 shadow-norte lg:-my-2 lg:pt-7'
                    : 'border border-borda')
                }
              >
                {p.destaque && (
                  <span className="absolute top-4 right-4 rounded-full border border-sol px-2 py-0.5 text-[10px] font-semibold tracking-wide text-sol">
                    {p.destaque}
                  </span>
                )}

                <div className="flex flex-col gap-1 pr-24">
                  <h3 className="text-lg font-bold tracking-tight">{p.nome}</h3>
                  <p className="text-xs text-tinta-3">{p.para}</p>
                </div>

                <p className="flex items-baseline gap-1">
                  {p.preco ? (
                    <>
                      <span className="numero text-[30px] leading-none font-extrabold tracking-tight text-tinta">
                        R$ {p.preco}
                      </span>
                      <span className="ml-0.5 text-xs text-tinta-3">/mês</span>
                    </>
                  ) : (
                    <span className="text-2xl leading-none font-extrabold tracking-tight text-tinta">
                      Sob consulta
                    </span>
                  )}
                </p>

                {/* O bloco do credito. Fundo mais claro, sem borda — bloco
                    aninhado com borda seria caixa dentro de caixa. */}
                <div className="rounded-norte bg-superficie-2 px-3 py-2.5">
                  <p className="text-sm font-bold text-tinta">{p.credito.valor}</p>
                  {p.credito.conta && (
                    /* A traducao para a unidade do cliente. "R$ 120 de credito"
                       nao diz nada para quem nunca comprou token; "2.000
                       conversas" diz. */
                    <p className="numero pt-1 text-xs font-semibold text-bom">
                      {p.credito.conta}
                    </p>
                  )}
                  <p className="pt-0.5 text-[11px] leading-snug text-tinta-3">{p.credito.nota}</p>
                </div>

                <a
                  href="#falar"
                  className={
                    'rounded-norte px-4 py-2.5 text-center text-sm font-semibold ' +
                    (p.destaque
                      ? 'botao-marca text-marca-tinta'
                      : i === PLANOS.length - 1
                        ? 'bg-tinta text-superficie hover:opacity-90'
                        : 'border border-borda text-tinta hover:bg-superficie-2')
                  }
                >
                  {p.preco ? 'Começar o teste' : 'Falar com a gente'}
                </a>

                <ul className="flex flex-1 flex-col gap-1.5 border-t border-borda-suave pt-3.5">
                  {p.itens.map((x) => (
                    <li key={x} className="flex gap-2 text-[13px] leading-snug text-tinta-2">
                      <span aria-hidden className="mt-px shrink-0 text-[11px] text-bom">✓</span>
                      {x}
                    </li>
                  ))}
                  {/* O que NAO tem, agrupado no fim. Esconder o que falta e o
                      que faz o cliente descobrir depois de assinar — e mostrar
                      aumenta a confianca na lista inteira. */}
                  {p.fora.map((x) => (
                    <li
                      key={x}
                      className="flex gap-2 text-[13px] leading-snug text-tinta-3 line-through decoration-tinta-3/40"
                    >
                      <span aria-hidden className="mt-px shrink-0 text-[11px] no-underline opacity-50">
                        ✕
                      </span>
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-5 text-xs text-tinta-3">
            Valores mensais, por empresa. Nota fiscal e conciliação de maquininha entram como
            opcional no plano Balcão.
          </p>

          {/* A tabela item por item. Cartão vende, tabela decide: quem está
              com o cartão do meio quase escolhido tem UMA pergunta específica
              ("o crediário está no Rede ou não?"), e procurar isso em quatro
              listas de bala é onde a pessoa desiste e vai perguntar no
              WhatsApp. Ela responde sem ninguém do outro lado.

              O dado vem de `servidor/planos.ts`, a MESMA lista que a tela de
              assinatura usa por dentro — duas listas separadas divergem, e
              divergir aqui é prometer na venda o que o sistema não entrega. */}
          <div className="mt-14">
            <h3 className="mb-1 text-2xl leading-tight">Item por item</h3>
            <p className="mb-6 max-w-[56ch] text-sm text-tinta-2">
              Tudo que muda de um plano para o outro, sem asterisco. O que não está aqui está
              em todos.
            </p>
            <CompararPlanos />
          </div>
        </div>
      </section>

      {/* ── segurança ── */}
      <section className="bg-superficie">
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
                className="group border-b border-borda py-4"
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
      <section
        id="falar"
        className="emenda-topo relative scroll-mt-16 overflow-hidden bg-nav"
        style={{ '--emenda': 'var(--fundo)' } as React.CSSProperties}
      >
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
            className="botao-marca rounded-norte px-6 py-3 text-sm font-semibold text-marca-tinta"
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

/** Uma conversa de exemplo — o assistente propondo, e a dona confirmando. */
