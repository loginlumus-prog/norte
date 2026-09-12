import type { Metadata } from 'next'
import Image from 'next/image'
import type { Plano } from '@prisma/client'
import {
  PLANOS as LIMITES,
  PLANOS_COM_PRECO,
  RECOMENDADO,
  type Limite,
} from '@/servidor/planos'
import { Marca, Simbolo } from '@/ui/Marca'
import { ConversaFlutuante } from '@/ui/ConversaFlutuante'
import { Digitando } from '@/ui/Digitando'
import { CompararPlanos } from '@/ui/CompararPlanos'
import { TrocaTema } from '@/ui/TrocaTema'
import { CenaViva } from '@/ui/CenaViva'

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

// O texto de venda de cada plano.
//
// Só o que é TEXTO mora aqui. Preço, cota de loja, cota de gente e crédito
// mensal vêm de `servidor/planos.ts`, que é a mesma fonte que a tela de
// assinatura consulta para barrar a criação da sexta loja. Número repetido à
// mão é como a página passa a prometer o que o sistema não entrega.
const CARTOES: Record<
  Plano,
  {
    selo?: string
    /** A tradução do crédito para a unidade que o cliente entende. */
    conta: string | null
    nota: string
    itens: string[]
    fora: string[]
  }
> = {
  GRATIS: {
    conta: null,
    nota: 'sem prazo para acabar e sem cartão',
    itens: [
      'Produtos com as variações da sua loja',
      'Estoque com histórico de cada movimento',
      'Balcão, caixa e fechamento do turno',
      'Clientes e histórico de compra',
      'Um relatório simples do mês',
    ],
    fora: [
      'Nota fiscal',
      'Assistente no WhatsApp',
      'DRE e financeiro completo',
      'Mais de uma pessoa por vez',
    ],
  },
  BALCAO: {
    conta: null,
    nota: 'o WhatsApp continua sendo você',
    itens: [
      'Tudo do Grátis, sem teto de vendas',
      'Nota fiscal no balcão',
      'Financeiro e o DRE do mês',
      'Até três lojas, cada uma com seu estoque',
      'Equipe sem limite de cadastro, com permissão por pessoa',
      'Fechamento de mês guiado',
    ],
    fora: ['Assistente no WhatsApp', 'Crediário próprio'],
  },
  BALCAO_AGENTE: {
    // "R$ 120 de crédito" não diz nada para quem nunca comprou token. O número
    // sai do custo medido por conversa, com cache e roteamento de modelo.
    conta: '~1.650 conversas no WhatsApp',
    nota: 'renovado todo mês · compra mais quando quiser',
    itens: [
      'Tudo do Balcão, e até cinco lojas',
      'Assistente no WhatsApp, com o nome que você der',
      'Cobrança de atraso, aviso de ruptura, relatório 2× por dia',
      'Análise básica: o que aconteceu no dia e no mês · em breve',
      'Teto de valor e de desconto que você define',
      'Toda ação do assistente assinada no livro',
    ],
    fora: ['Análise profunda do negócio', 'Crediário próprio', 'Lojas sem limite'],
  },
  REDE: {
    selo: 'O mais pedido',
    conta: '~5.000 conversas no WhatsApp',
    nota: 'renovado todo mês · compra mais quando quiser',
    itens: [
      'Tudo do Assistente, sem limite de loja nem de gente',
      'Análise profunda: onde está perdendo, onde está ganhando, e o que fazer · em breve',
      'Comparação entre lojas: venda, margem e estoque parado lado a lado',
      'Curva ABC e dinheiro parado: o que sustenta e o que come o capital',
      'Escala e presença: quem abriu o caixa, a que horas, e quanto vendeu',
      'Crediário próprio, com juros e cobrança',
      'Cada gerente vê só a loja dele',
    ],
    fora: [],
  },
  CORPORATIVO: {
    conta: 'crédito combinado no contrato',
    nota: 'junto com o preço, depois de olhar a operação',
    itens: [],
    fora: [],
  },
}

const CORPORATIVO_EXTRAS: [string, string][] = [
  ['Site, tráfego e condução', 'A gente entra junto na operação, não só entrega o sistema.'],
  ['Login único da empresa', 'SSO, ambiente dedicado e acordo de nível de serviço.'],
  ['Gerente de conta', 'Uma pessoa nossa que conhece a sua operação pelo nome.'],
]

const reais = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(v)

const cotaLojas = (l: Limite) =>
  l.unidades === null ? 'Sem limite' : l.unidades === 1 ? '1 loja' : `Até ${l.unidades}`

// O número que se paga não é quanta gente existe, é quanta gente fica dentro
// ao mesmo tempo. Cadastrar a equipe toda é de graça em qualquer plano — e
// dizer isso na tabela é o que evita a pergunta na hora da venda.
const cotaGente = (l: Limite) =>
  l.vagas === null ? 'Sem limite' : l.vagas === 1 ? '1 por vez' : `${l.vagas} ao mesmo tempo`


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

// A régua de fatos do topo. Cada um destes é provado mais embaixo na própria
// página — preço de tabela na seção de planos, "de 1 a 40 lojas" em para quem
// é, e o teto do assistente na seção dele. Nenhum número de mercado: a gente
// não mediu, e promessa que não se cumpre vira pedido de reembolso no segundo
// mês.
const PROVAS: [string, string][] = [
  [
    'A partir de R$ 349 por mês',
    'Sem taxa de implantação escondida, e loja extra tem preço de tabela.',
  ],
  [
    'De uma loja a quarenta',
    'A mesma tela cresce junto. Não existe migrar, nem “versão para redes”, nem contratar de novo.',
  ],
  [
    'O assistente é seu',
    'Você dá o nome e a personalidade. O teto do que ele faz sozinho é número no banco.',
  ],
]

// Os cinco ramos da fileira, no mesmo traço do topo. "Serve para o seu ramo
// também" é mais rápido de mostrar do que de explicar — e desenho mostra
// isso melhor que foto, porque foto de loja é sempre a loja de alguém.
//
// Os cinco arquivos foram levados à MESMA proporção (1,24:1) na origem: sem
// isso, dentro de caixas iguais, uma cena apareceria grande e a vizinha
// minúscula. O rótulo é HTML embaixo da arte — modelo de imagem escreve
// garrancho.
//
// A linha embaixo do rótulo não é slogan: é o que MUDA no sistema quando a
// empresa escolhe aquele ramo. Eixo de variação, unidade de medida, módulo
// sugerido — tudo já existe em `src/servidor/modulos.ts`. Frase que promete
// função inexistente é a mais cara de escrever.
const RAMOS = [
  { nome: 'cena-moda', rotulo: 'Moda', linha: 'Cor e Tamanho na mesma peça — um cadastro, não trinta.' },
  { nome: 'cena-calcados', rotulo: 'Calçados', linha: 'Numeração do 34 ao 40, e o par que falta aparece.' },
  { nome: 'cena-sorveteria', rotulo: 'Sorveteria', linha: 'Sabor vira eixo, e a venda sai por quilo.' },
  { nome: 'cena-lanchonete', rotulo: 'Lanchonete', linha: 'Encomenda anotada no balcão, com retirada marcada.' },
  { nome: 'cena-deposito', rotulo: 'Distribuição', linha: 'Cada depósito com estoque e caixa próprios.' },
]

const QUEM: [string, string][] = [
  [
    'A mesma tela serve a uma loja e a quarenta',
    'Quem começa com uma loja não descobre nem que existe o conceito de unidade: o seletor de loja só aparece quando nasce a segunda. E a arquitetura não tem teto — a mesma tabela que guarda a loja única guarda a rede inteira.',
  ],
  [
    'Você nomeia os eixos do seu ramo',
    'Cor e Tamanho na roupa, Numeração na sapataria, Sabor na sorveteria. Vende por unidade, por quilo, por litro ou por par.',
  ],
  [
    'Depósito conta como loja',
    'Cada unidade tem estoque e caixa próprios, e o painel soma tudo num clique. O gerente da loja 3 não vê o caixa da 5.',
  ],
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

// O rodízio da faixa do assistente.
//
// A primeira versão tinha o rótulo "Você define" e uma lista solta embaixo —
// e metade da lista não era definição, era coisa que ELE faz. Frase pela
// metade num rodízio vira promessa torta.
//
// Agora cada linha traz o próprio sujeito, e elas se alternam de propósito:
// uma que você regula, uma que ele executa. É a divisão de trabalho do
// produto inteiro dita em oito frases — e nenhuma delas é recurso inventado
// para encher a lista.
const NA_PRATICA = [
  'Você dá o nome e a personalidade dele',
  'Ele avisa qual peça vai faltar antes de faltar',
  'Você define o teto de desconto que ele pode dar',
  'Ele cobra quem atrasou, sem você precisar pedir',
  'Você diz quanto ele pode gastar de IA por dia',
  'Ele manda o relatório do dia na hora que você marcar',
  'Você escolhe o que ele enxerga do seu estoque',
  'Ele lança a compra no financeiro depois que você confirma',
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
          <div className="flex items-center gap-3 sm:gap-4">
            {/* A troca de tema mora aqui e não só dentro do sistema: quem chega
                pela página de venda também trabalha em sala clara ou escura, e
                descobrir que o produto tem os dois temas ANTES de assinar é
                argumento de venda, não configuração escondida.

                Sem `inicial`: ele lê o cookie sozinho depois de montar, e esta
                página não precisa saber que o cookie existe. */}
            <TrocaTema tom="papel" />
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
          ── por que desenho, e não foto ──
          Foto de loja é sempre a loja de ALGUÉM: quem vende sapato olha uma
          arara de roupa e entende "não é para mim". Desenho vetorial plano é
          universal — a pessoa vê o balcão, a prateleira e a maquininha, e
          preenche o resto com o próprio negócio.

          ── e por que UMA cena, e não o ramo dela ──
          O topo não responde "para quem é" — isso é a seção seguinte, e lá os
          ramos aparecem um a um. Aqui a pergunta é "o que é isto", e a
          resposta é o universo inteiro numa imagem: a dona no balcão e, em
          volta dela, os cartões do que o sistema faz — venda, estoque,
          conversa no WhatsApp, resultado, dinheiro girando.

          ── o fundo ──
          A mesma aurora da seção do assistente, com dois brilhos que derivam
          por cima. O recorte da cena é transparente de propósito: é o que
          deixa a luz do fundo passar por baixo do desenho, em vez de o desenho
          tapar a luz com um retângulo de tinta.

          ── e nenhum texto dentro da arte ──
          Modelo de imagem escreve garrancho, e a primeira tentativa do projeto
          voltou com duas linhas de letra embaralhada. Por isso os cartões
          flutuantes têm só forma: barra, bolha, caixa, etiqueta. A imagem é
          cena; a palavra é HTML. */}
      <section className="aurora emenda-base relative isolate overflow-hidden">
        <span aria-hidden className="brilhos pointer-events-none absolute inset-0 z-0" />

        <div className="relative z-10 mx-auto max-w-6xl px-5 py-16 md:py-20">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-8">
            <div className="flex max-w-2xl flex-col items-start gap-6">
              <span className="text-xs font-bold tracking-[0.14em] text-sol-claro uppercase">
                Gestão + assistente de IA no WhatsApp
              </span>
              <h1 className="text-[clamp(2.5rem,6vw,4.25rem)] leading-[0.96] !text-nav-tinta text-balance">
                A empresa inteira
                <br />
                numa tela só.
              </h1>
              <p className="max-w-xl leading-relaxed text-nav-tinta-2 md:text-lg">
                Produto, estoque, balcão, caixa e o resultado do mês. E um assistente que você
                batiza, que conhece o seu estoque de verdade e responde por você — dentro dos
                limites que você define.
              </p>
              <div className="flex flex-wrap items-center gap-3">
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
            </div>

            {/* A cena sangra um pouco para fora da coluna à direita — a mesma
                sangria que a conversa do assistente usa.

                É VÍDEO, com fundo transparente: o gráfico sobe, os pontinhos
                andam pelas linhas pontilhadas, ela pisca e digita. O laço fecha
                sem emenda porque o último quadro É o primeiro — foi assim que o
                vídeo foi pedido ao gerador, e não um corte esperto aqui.

                Nada de pulso, nada de escala: o movimento é dentro do desenho.
                A cena não se mexe na página, o que acontece acontece dentro
                dela. */}
            <div
              aria-hidden
              className="relative aspect-[927/609] w-full lg:-mr-[12%] lg:w-[118%]"
            >
              <CenaViva
                nome="cena-sistema"
                jaAVista
                className="absolute inset-0 h-full w-full object-contain object-bottom"
              />
            </div>
          </div>

          {/* A RÉGUA DE FATOS.
              Mesma anatomia da grade de "o que todo cliente tem": fio em cima,
              uma linha forte, uma linha explicando. Aqui ela é sobre azul, e
              por isso o fio é branco a 20% em vez da borda do tema.

              Os três são coisas que a própria página prova mais embaixo —
              preço de tabela, a mesma tela de 1 a 40 lojas, e o teto do
              assistente sendo número no banco. Nenhum número de mercado. */}
          <div className="mt-14 grid gap-x-10 gap-y-7 sm:grid-cols-3 md:mt-16">
            {PROVAS.map(([t, d]) => (
              <div key={t} className="flex flex-col gap-1.5 border-t border-white/20 pt-4">
                <p className="text-[15px] leading-snug font-bold text-nav-tinta">{t}</p>
                <p className="text-sm leading-relaxed text-nav-tinta-2">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── a dor ──
          Ganhou olho, título e resumo como todas as outras: solta embaixo do
          topo, sem cabeçalho, a grade parecia legenda da foto de cima. */}
      <section className="bg-superficie">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Titulo
            olho="O problema"
            titulo="Sistema quase todo mundo tem. Resposta é que é raro."
            resumo="São três perguntas simples — e hoje as três só têm resposta no fim do mês, no susto, com o caderno do lado."
          />
          <div className="mt-9 grid gap-x-8 gap-y-7 sm:grid-cols-3">
            {DOR.map(([t, d]) => (
              <div key={t} className="flex flex-col gap-2 border-t border-borda pt-4">
                <h3 className="text-base font-bold">{t}</h3>
                <p className="text-sm leading-relaxed text-tinta-2">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── para quem é ──
          ── o que estava aqui antes ──
          Um bento de três cartões com fundo, canto arredondado e a foto presa
          dentro de cada um. Era caixote — a coisa que a página inteira passou
          a evitar — e ainda empilhava caixote dentro de caixote: um mosaico de
          três fotos dentro de um cartão dentro da grade.

          ── o que ficou ──
          A mesma ideia em três tempos, no desenho do resto da página:

            1. Olho, título e resumo, como em toda seção daqui para baixo.
            2. UMA fileira de cinco ramos desenhados, que faz "não é só loja
               de roupa" ser entendido antes de qualquer texto ser lido.
            3. A explicação embaixo, em três itens abertos separados por fio —
               exatamente a grade que a pessoa reencontra em "o que todo
               cliente tem".

          A arte deixou de ser foto e passou a ser o mesmo desenho do topo:
          quem vende sapato olha uma fotografia de arara de roupa e entende
          "não é para mim". Desenho é universal — a pessoa vê o balcão e a
          prateleira, e preenche o resto com o próprio negócio. */}
      <section className="bg-superficie">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Titulo
            olho="Para quem é"
            titulo="Comércio que vende no balcão e no WhatsApp"
            resumo="De uma loja de bairro à rede com dezenas de unidades — e não só loja de roupa."
          />

        {/* A FILEIRA DE RAMOS.
            Cinco cenas no mesmo traço do topo — moda, calçados, sorveteria,
            lanchonete e depósito. É a resposta visual para "não é só loja de
            roupa", e ela chega antes de qualquer texto ser lido.

            ── caixinhas, e não uma faixa só ──
            Emendadas, as cinco viravam um mural: o olho lia uma cena comprida
            e confusa em vez de cinco negócios diferentes. Separadas por 6px
            elas continuam lendo como conjunto — perto o bastante para ser uma
            fileira, longe o bastante para cada uma ser um lugar.

            ── e por que todas as artes têm a MESMA proporção ──
            Caixa igual com arte de proporção diferente dá uma cena grande e
            outra minúscula do lado. Os cinco arquivos foram levados a 1,24:1
            na origem (a lanchonete cortada, as outras com margem transparente)
            — então dentro da caixa as cinco ocupam exatamente o mesmo lugar.

            ── por que a arte encosta EM CIMA ──
            Antes a caixa era mais alta que a arte e a arte encostava embaixo,
            deixando uma faixa vazia no topo. A intenção era dar ar ao abajur;
            o efeito foi outro — a cena parecia afundada na caixa, e a faixa
            lia como erro de carregamento, não como respiro.

            Agora a caixa tem a proporção EXATA da arte (1,24:1), então a cena
            preenche de borda a borda e o fio do abajur é cortado no topo, que
            é como quadro de cena funciona: o que sai do quadro sugere que o
            lugar continua. O ar que a arte perdeu virou a linha de texto — que
            informa, enquanto a faixa vazia não informava nada. */}
        <div className="mt-9 grid grid-cols-2 gap-1.5 lg:grid-cols-5">
          {RAMOS.map((r) => (
            <div
              key={r.rotulo}
              className="aurora flex flex-col overflow-hidden rounded-norte last:col-span-2 lg:last:col-span-1"
            >
              <div className="relative aspect-[124/100] w-full">
                <CenaViva
                  nome={r.nome}
                  className="absolute inset-0 h-full w-full object-cover object-top"
                />
              </div>
              <div className="flex flex-col gap-1.5 px-3.5 pt-2.5 pb-3.5">
                <span className="text-[11px] font-bold tracking-[0.16em] text-nav-tinta uppercase">
                  {r.rotulo}
                </span>
                <p className="text-[12.5px] leading-snug text-nav-tinta-2">{r.linha}</p>
              </div>
            </div>
          ))}
        </div>

          <div className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-3">
            {QUEM.map(([t, d]) => (
              <div key={t} className="flex flex-col gap-2 border-t border-borda pt-4">
                <h3 className="text-base font-bold">{t}</h3>
                <p className="text-sm leading-relaxed text-tinta-2">{d}</p>
              </div>
            ))}
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
                <h3 className="text-base font-bold">{f.t}</h3>
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

        {/* A LOJISTA RECORTADA, saindo pela borda direita.
            É o movimento que faltava: foto sem fundo pode sair da grade — ser
            cortada pela borda da tela e ficar atrás de um elemento e na
            frente de outro. Foto retangular nunca faz isso, porque retângulo
            obedece a grade.

            ── os dois cortes, e por que só um deles serve ──
            Ela é maior que a seção, então alguma coisa dela vai ser cortada.
            Cortar em CIMA (ancorar embaixo) come a cabeça — e cabeça cortada
            não parece profundidade, parece imagem mal encaixada. Ancorada no
            TOPO, o rosto fica inteiro e quem sai do quadro é a perna, que é
            como uma pessoa realmente sai de um enquadramento.

            ── e por que boa parte dela fica FORA da tela ──
            O translate-x empurra mais de um terço da largura dela para fora
            da direita. Silhueta que cabe inteira no canto vira adesivo
            colado; passando da borda, o olho completa o corpo que não vê e
            entende que ela está NA FRENTE do plano da tela. Foi por isso que
            a seção ganhou altura (py-40): é o que deixa ela grande e ainda
            assim mostrar até a coxa antes do corte.

            Só a partir de 1280px: em tela menor não existe a margem fora da
            coluna de conteúdo, e ela passaria por cima da conversa. */}
        {/* O halo atrás dela. Sem ele, o recorte encosta no fundo escuro e
            some pelas bordas — com ele, a silhueta se destaca e o olho lê
            "está na frente", que é a sensação de profundidade. */}
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 right-0 z-0 hidden h-[52rem] w-[38rem] translate-x-[28%] xl:block 2xl:h-[56rem]"
          style={{
            background:
              'radial-gradient(22rem 26rem at 52% 62%, color-mix(in srgb, var(--marca) 34%, transparent) 0%, transparent 72%)',
          }}
        />
        <Image
          src="/img/lojista-recorte.png"
          alt=""
          aria-hidden
          width={1328}
          height={1760}
          sizes="(max-width: 1536px) 50vw, 45vw"
          quality={90}
          className="pointer-events-none absolute top-6 right-0 z-0 hidden h-[62rem] w-auto max-w-none translate-x-[40%] object-contain object-top drop-shadow-[0_40px_90px_rgb(0_0_0/0.75)] xl:block 2xl:h-[66rem] 2xl:translate-x-[34%]"
        />

        <div className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-5 pt-24 md:grid-cols-[1fr_1.05fr] md:pt-40">
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

        {/* A FAIXA DO "NA PRÁTICA".
            A lista do que o assistente faz e do que a loja regula nele é longa
            demais para caber numa linha, e escolher três seria mentir por
            omissão. Então a linha se reescreve: cada volta mostra outra, e o
            que a peça diz é "tem mais coisa aqui do que cabe na tela".

            As frases alternam sujeito — uma "você", uma "ele" — porque é
            exatamente essa a divisão de trabalho que a seção inteira defende.

            É o ÚNICO laço infinito da página, e é de propósito: aqui a
            repetição é o conteúdo. Todo o resto se mexe uma vez só. */}
        <div className="relative z-10 mx-auto max-w-6xl px-5 pt-14 pb-24 md:pb-40">
          <div className="flex flex-col gap-2 border-t border-white/15 pt-6 sm:flex-row sm:items-baseline sm:gap-6">
            <span className="shrink-0 text-[11px] font-bold tracking-[0.16em] text-sol-claro uppercase">
              Na prática
            </span>
            <Digitando
              itens={NA_PRATICA}
              className="min-h-[1.6em] text-lg leading-snug font-semibold tracking-tight text-nav-tinta sm:text-xl"
            />
          </div>
        </div>
      </section>

      {/* ── planos ──
          ── por que três cartões e não quatro ──
          O Corporativo não é o irmão maior dos outros: não tem preço de
          tabela, não se assina sozinho e o que se compra nele é trabalho
          nosso, não assento no sistema. Enfiado como quarta coluna, ele
          espremia os três que a pessoa realmente compara e ainda mentia sobre
          o próprio formato. Fora da grade, cada cartão respira e ele fica com
          a faixa larga que o tipo de contrato dele pede.

          ── e por que o número vem do servidor ──
          Preço, cota de loja, cota de gente e crédito mensal saem de
          `servidor/planos.ts` — a MESMA fonte que a tela de assinatura lê para
          barrar a criação da sexta loja. Repetir o número aqui à mão é como
          divergência começa, e divergir aqui é prometer na venda o que o
          sistema não entrega. Aqui em cima fica só o que é texto de venda: as
          balas e a tradução de crédito em conversa. */}
      <section id="planos" className="scroll-mt-16 bg-fundo">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Titulo
            olho="Planos"
            titulo="Preço por tamanho de operação"
            resumo="Sem taxa de implantação escondida. Pessoa a mais tem preço de tabela, não “fale com o comercial”."
          />

          {/* ── O GRÁTIS FICA FORA DA GRADE, e é decisão de desenho ──
              Quatro cartões de peso tão diferente numa fileira só achatam os
              pagos: o olho compara R$ 0 com R$ 1.500 e para de comparar o que
              importa, que é entre os pagos. Numa faixa própria, mais quieta,
              ele continua achável — e quem está comparando preço segue
              comparando os três que disputam de verdade. */}
          <div className="mt-9 flex flex-col gap-4 rounded-norte border border-borda bg-superficie p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-lg font-bold">{LIMITES.GRATIS.titulo}</h3>
                <span className="numero text-sm font-semibold text-bom">
                  R$ 0 — sem prazo e sem cartão
                </span>
              </div>
              <p className="max-w-xl text-sm leading-relaxed text-tinta-2">
                Uma loja, uma pessoa por vez, até {LIMITES.GRATIS.tetoVendasMes} vendas no mês.
                Produto, estoque, balcão e cliente funcionam igual — o que fica de fora é nota
                fiscal, assistente e o financeiro completo. É onde a loja pequena pode ficar, não
                uma demonstração com prazo.
              </p>
            </div>
            <a
              href="#falar"
              className="shrink-0 rounded-norte border border-borda px-5 py-2.5 text-center text-sm font-semibold text-tinta hover:bg-superficie-2"
            >
              Começar de graça
            </a>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PLANOS_COM_PRECO.map((codigo) => {
              const l = LIMITES[codigo]
              const c = CARTOES[codigo]
              const eleito = codigo === RECOMENDADO
              return (
                <div
                  key={codigo}
                  className={
                    'relative flex flex-col rounded-norte p-6 ' +
                    (eleito
                      ? 'bg-superficie-2 shadow-norte-alta ring-1 ring-marca/35 lg:-my-3 lg:pt-9'
                      : 'bg-superficie shadow-norte ring-1 ring-borda')
                  }
                >
                  {eleito && (
                    <span className="absolute top-4 right-4 rounded-full bg-marca px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] text-marca-tinta uppercase">
                      {c.selo}
                    </span>
                  )}

                  <h3 className="pr-24 text-xl font-bold tracking-tight">{l.titulo}</h3>
                  <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-tinta-2">
                    {l.resumo}
                  </p>

                  <p className="mt-7 flex items-baseline gap-1.5">
                    <span className="numero text-[2.6rem] leading-none font-extrabold tracking-[-0.03em] text-tinta">
                      {reais(l.mensal!)}
                    </span>
                    <span className="text-sm text-tinta-3">/mês</span>
                  </p>
                  <p className="mt-2 text-xs text-tinta-3">
                    {l.porUnidadeExtra
                      ? `+ ${reais(l.porUnidadeExtra)} por loja além da ${l.unidades}ª`
                      : 'Sem taxa de implantação'}
                  </p>

                  <a
                    href="#falar"
                    className={
                      'mt-5 rounded-norte px-4 py-2.5 text-center text-sm font-semibold ' +
                      (eleito
                        ? 'botao-marca text-marca-tinta'
                        : 'border border-borda text-tinta hover:bg-superficie-2')
                    }
                  >
                    Começar o teste
                  </a>

                  {/* A FICHA. Três linhas de rótulo à esquerda e número à
                      direita — é o que a pessoa procura quando já entendeu o
                      plano e quer saber se cabe na operação dela. Antes isso
                      estava dissolvido no meio das balas, e cota de loja
                      escondida numa lista de quinze linhas é a informação que
                      ninguém acha. */}
                  <dl className="mt-7">
                    <Ficha rotulo="Lojas" valor={cotaLojas(l)} />
                    <Ficha rotulo="Pessoas" valor={cotaGente(l)} />
                    <Ficha
                      rotulo="Crédito de IA"
                      valor={l.creditoMensal ? `${reais(l.creditoMensal)}/mês` : 'Sem assistente'}
                      nota={c.conta}
                      rodape={c.nota}
                    />
                  </dl>

                  <ul className="mt-6 flex flex-1 flex-col gap-2 border-t border-borda-suave pt-4">
                    {/* O sufixo " · em breve" vira etiqueta em vez de texto
                        corrido. Marcar o que ainda nao existe nao enfraquece a
                        lista: quem assina por uma linha que nao encontra
                        depois cancela, e esse cancelamento vem com reclamacao
                        publica junto. Marcado, vira expectativa. */}
                    {c.itens.map((x) => {
                      const breve = x.endsWith(' · em breve')
                      const texto = breve ? x.slice(0, -' · em breve'.length) : x
                      return (
                        <li key={x} className="flex gap-2 text-[13px] leading-snug text-tinta-2">
                          <span
                            aria-hidden
                            className={
                              'mt-px shrink-0 text-[11px] ' + (breve ? 'text-tinta-3' : 'text-bom')
                            }
                          >
                            ✓
                          </span>
                          <span>
                            {texto}
                            {breve && (
                              <span className="ml-1.5 rounded-full bg-superficie-2 px-1.5 py-0.5 align-middle text-[9px] font-bold tracking-wide text-tinta-3 uppercase">
                                em breve
                              </span>
                            )}
                          </span>
                        </li>
                      )
                    })}
                    {/* O que NÃO tem, agrupado no fim. Esconder o que falta é o
                        que faz o cliente descobrir depois de assinar — e
                        mostrar aumenta a confiança na lista inteira. */}
                    {c.fora.map((x) => (
                      <li
                        key={x}
                        className="flex gap-2 text-[13px] leading-snug text-tinta-3 line-through decoration-tinta-3/40"
                      >
                        <span
                          aria-hidden
                          className="mt-px shrink-0 text-[11px] no-underline opacity-50"
                        >
                          ✕
                        </span>
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>

          {/* O CORPORATIVO, em faixa larga.
              Aqui o que se contrata é a condução do negócio junto com o
              sistema, e por isso o lado direito não tem preço: tem o crédito
              que já vem e o convite para conversar. */}
          <div className="mt-5 flex flex-col gap-8 overflow-hidden rounded-norte bg-nav p-7 md:flex-row md:items-center md:justify-between md:p-9">
            <div className="max-w-2xl">
              <span className="text-[11px] font-bold tracking-[0.16em] text-sol-claro uppercase">
                Para rede grande
              </span>
              <h3 className="mt-2 text-2xl font-bold tracking-tight !text-white">Corporativo</h3>
              <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-white/65">
                {LIMITES.CORPORATIVO.resumo}
              </p>
              <div className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-3">
                {CORPORATIVO_EXTRAS.map(([t, d]) => (
                  <div key={t} className="flex flex-col gap-1 border-t border-white/20 pt-3">
                    <p className="text-[13px] font-bold text-white">{t}</p>
                    <p className="text-xs leading-relaxed text-white/60">{d}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-3 md:w-56 md:items-end md:text-right">
              <p className="text-2xl leading-none font-extrabold tracking-tight !text-white">
                Sob consulta
              </p>
              {/* Sem número de crédito aqui, e é de propósito: o volume de
                  conversa de um cliente Corporativo não se parece com o de
                  outro. Um número de tabela viraria promessa feita antes de
                  alguém olhar a operação — que é o mesmo motivo de o preço
                  ser sob consulta. */}
              <p className="text-xs leading-relaxed text-white/60">
                Sem limite de loja nem de gente, com{' '}
                <span className="font-semibold text-sol-claro">
                  crédito de IA dimensionado para a sua operação
                </span>{' '}
                e o resto combinado no contrato.
              </p>
              <a
                href="#falar"
                className="botao-marca mt-1 rounded-norte px-6 py-3 text-center text-sm font-semibold text-marca-tinta"
              >
                Falar com a gente
              </a>
            </div>
          </div>

          <p className="mt-5 text-xs text-tinta-3">
            Valores mensais, por empresa. Nota fiscal e conciliação de maquininha entram como
            opcional no plano Balcão.
          </p>

          {/* A tabela item por item. Cartão vende, tabela decide: quem está
              com o cartão do meio quase escolhido tem UMA pergunta específica
              ("o crediário está no Rede ou não?"), e procurar isso em quatro
              listas de bala é onde a pessoa desiste e vai perguntar no
              WhatsApp. Ela responde sem ninguém do outro lado. */}
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
                <h3 className="text-base font-bold">{t}</h3>
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
          <div className="flex flex-col gap-3 sm:items-end">
            <p className="text-xs text-tinta-3">
              Cada empresa entra pelo próprio endereço. Recebeu um convite? Use o link que chegou
              para você.
            </p>
            {/* Termos e privacidade no rodapé, e não escondidos numa página de
                ajuda: quem procura isso antes de assinar procura no rodapé, e
                quem não acha desconfia — com razão. */}
            <nav className="flex gap-5 text-xs text-tinta-3">
              <a href="/termos" className="hover:text-tinta-2">
                Termos de uso
              </a>
              <a href="/privacidade" className="hover:text-tinta-2">
                Privacidade
              </a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Titulo({ olho, titulo, resumo }: { olho: string; titulo: string; resumo?: string }) {
  return (
    <div className="flex max-w-2xl flex-col gap-2.5">
      <span className="text-xs font-bold tracking-[0.14em] text-marca uppercase">{olho}</span>
      <h2 className="text-3xl leading-tight font-extrabold tracking-[-0.02em] text-balance">
        {titulo}
      </h2>
      {resumo && <p className="leading-relaxed text-tinta-2">{resumo}</p>}
    </div>
  )
}

/**
 * Uma linha da ficha do plano: rótulo à esquerda, número à direita.
 *
 * É `<dl>` de verdade porque é exatamente isso — termo e definição. Leitor de
 * tela anuncia "Lojas, até 5"; num par de divs ele leria "até 5" solto. A
 * tradução e a letra miúda entram como um SEGUNDO `<dd>` do mesmo termo, que
 * é HTML válido e diz a coisa certa: são duas definições do mesmo item.
 */
function Ficha({
  rotulo,
  valor,
  nota,
  rodape,
}: {
  rotulo: string
  valor: string
  /** A tradução do número, quando ela existe. Ex.: "~5.800 conversas". */
  nota?: string | null
  /** A letra miúda de baixo. Ex.: "renovado todo mês". */
  rodape?: string
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 border-t border-borda-suave py-2.5">
      <dt className="text-[13px] text-tinta-2">{rotulo}</dt>
      <dd className="numero ml-auto text-[13px] font-bold text-tinta">{valor}</dd>
      {(nota || rodape) && (
        <dd className="w-full">
          {nota && <span className="numero block pt-1 text-[11px] font-semibold text-bom">{nota}</span>}
          {rodape && (
            <span className="block pt-0.5 text-right text-[11px] leading-snug text-tinta-3">
              {rodape}
            </span>
          )}
        </dd>
      )}
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
