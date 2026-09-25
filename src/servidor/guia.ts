// O manual do Norte — e a busca nele.
//
// ── o que é isto ─────────────────────────────────────────────
// Toda tela do sistema tem aqui uma entrada: o que ela é, como se faz cada
// coisa nela (em passos), e as perguntas que a loja faz de verdade. É o
// texto que o Guia (ui/Guia.tsx) mostra na aba "Nesta tela", o que a busca
// vasculha, e o contexto inteiro que vai para a IA quando há chave no
// servidor. Um texto só, três usos — para não divergir.
//
// ── a regra de escrita ───────────────────────────────────────
// Só o que o sistema FAZ. Nada de função que ainda não existe, nada de
// promessa. Cada passo foi lido do código da tela, não imaginado — e a
// tela que ainda está sendo construída (Tarefas, Preços, Desempenho, Vai
// faltar) segue a especificação dela. Quando a resposta honesta é "ainda
// não há isso na tela", é isso que está escrito.
//
// ── por que é puro ───────────────────────────────────────────
// Sem banco, sem I/O, sem React. Roda no servidor (ação que pergunta à IA),
// no navegador (a busca responde sem ir ao servidor) e no teste. É também o
// que permite, no futuro, o agente do WhatsApp (servidor/agente.ts) ler o
// mesmo manual para explicar o sistema a quem pergunta por lá — hoje só a
// tela usa; a ligação fica para quando o canal existir.

import type { Plano } from '@prisma/client'
import type { Capacidade, Papel } from './permissao'
import { LIBERACOES, doPlano, type Liberacao } from './planos'

export type Passo = {
  titulo: string
  passos: string[]
  /** A permissão que a ação pede. Sem ela, o passo é leitura para quem não pode. */
  capacidade?: Capacidade
  /** O pedaço do plano que abre isto, ou o plano a partir do qual existe. */
  plano?: Liberacao | Plano
}

export type Entrada = {
  chave: string
  titulo: string
  /** Caminho sem o slug da empresa: '' é o painel, '/financeiro/fechamento' é o fechamento. */
  caminho: string
  oQueE: string
  comoFazer: Passo[]
  perguntas: { p: string; r: string }[]
  /** Sinônimos e palavras que a pessoa usa e a tela não: 'fiado' para crediário, 'PDV' para balcão. */
  palavras: string[]
  /**
   * Quem ABRE a tela: basta uma destas capacidades. Ausente = todo mundo que
   * entrou. É a mesma régua da própria página (`exigirEntrada` ou o
   * `notFound` dela) — o Guia não mostra, na busca, tela que leva a pessoa
   * ao "este endereço não abre".
   */
  abre?: Capacidade[]
  /** O módulo que precisa estar ligado para a tela existir. */
  modulo?: string
}

/**
 * Cada capacidade em palavras de gente. Serve para o Guia dizer "precisa
 * poder operar o caixa" em vez de `caixa.operar`, e para a IA saber o que a
 * pessoa que pergunta pode fazer.
 */
export const NOME_DA_CAPACIDADE: Record<Capacidade, string> = {
  'venda.ver': 'ver as vendas',
  'venda.criar': 'vender no balcão',
  'venda.cancelar': 'cancelar venda',
  'venda.desconto': 'dar desconto acima do teto',
  'caixa.ver': 'ver o caixa',
  'caixa.operar': 'operar o caixa (abrir, sangrar, suprir, fechar)',
  'produto.ver': 'ver produtos',
  'produto.editar': 'cadastrar e editar produtos',
  'produto.preco': 'mexer em preço',
  'estoque.ver': 'ver o estoque',
  'estoque.ajustar': 'ajustar o estoque',
  'cliente.ver': 'ver clientes',
  'cliente.editar': 'cadastrar e editar clientes',
  'tarefa.ver': 'ver o quadro de tarefas',
  'tarefa.gerir': 'criar e atribuir tarefas',
  'crediario.ver': 'ver o crediário',
  'crediario.cobrar': 'cobrar o crediário',
  'crediario.receber': 'receber parcela do crediário',
  'financeiro.ver': 'ver o financeiro',
  'financeiro.lancar': 'lançar no financeiro',
  'relatorio.ver': 'ler relatórios e o painel',
  'equipe.ver': 'ver a equipe',
  'equipe.gerir': 'gerir a equipe',
  'empresa.configurar': 'configurar a empresa',
  'agente.configurar': 'configurar o assistente',
  'auditoria.ver': 'ler a auditoria',
}

export const NOME_DO_PAPEL: Record<Papel, string> = {
  DONO: 'Dono',
  GERENTE: 'Gerente',
  BALCAO: 'Balcão',
  FINANCEIRO: 'Financeiro',
  CONTADOR: 'Contador',
  SUPORTE: 'Suporte',
}

/** "do Balcão para cima", "da Direção para cima" — ou "em todo plano". */
export function rotuloDoPlano(p: Liberacao | Plano): string {
  const codigo: Plano = p in LIBERACOES ? LIBERACOES[p as Liberacao].desde : (p as Plano)
  if (codigo === 'GRATIS') return 'em todo plano'
  return `${doPlano(codigo)} para cima`
}

// ─────────────────────────────────────────────────────────────
// O MANUAL
// ─────────────────────────────────────────────────────────────

export const GUIA: Entrada[] = [
  // ── Painel ──
  {
    chave: 'painel',
    titulo: 'Painel',
    caminho: '',
    oQueE:
      'A primeira tela do dia, em dois modos. No SIMPLES: quanto vendeu hoje (comparado com o mesmo dia da semana passada até a mesma hora), o que precisa de você agora — o que acabou, conta vencida ou que vence hoje, fiado vencido, tarefa atrasada, caixa esquecido aberto, proposta do assistente —, atalhos para o que se faz mais e os mais vendidos da semana. Nos dois modos, o bloco "Hoje na sua…" muda com o RAMO da loja: grade quebrada na loja de roupa, sabores na sorveteria, encomendas e produção na padaria, o que repor na mercearia. No AVANÇADO: o resumo do período escolhido, com todos os gráficos — movimento por dia e por hora, formas de pagamento, categorias, parados, estoque, crediário, equipe e clientes. Exige a permissão de ler relatório — quem só vende cai direto no Balcão.',
    comoFazer: [
      {
        titulo: 'Trocar entre o modo simples e o avançado',
        passos: [
          'No alto de toda tela, no cabeçalho, a chave "Simples | Avançado". No painel também há o atalho "Ver o painel completo" e, no avançado, "Voltar ao simples".',
          'O modo é do APARELHO, não da pessoa: o computador do balcão fica no simples para quem sentar; o notebook do dono fica no avançado.',
          'No simples, o menu esconde as telas de análise (Caixa, Preços, Análise, Auditoria) e o balcão vende por botões grandes. Nada é tirado de permissão: a tela aberta por link continua abrindo.',
          'A tela de entrar segue o mesmo modo: no simples é só o formulário.',
        ],
      },
      {
        titulo: 'Mudar o período',
        passos: [
          'Use o seletor no alto da tela: Hoje, 7 dias, 30 dias, 90 dias, Este mês ou Mês passado.',
          'A seta com a porcentagem compara sempre com a janela do MESMO tamanho logo antes (30 dias contra os 30 anteriores).',
          'Quando não houve venda no período anterior, a porcentagem não aparece — não existe conta possível.',
          'O período fica no endereço: dá para mandar o link para alguém e ele abre igual.',
        ],
        capacidade: 'relatorio.ver',
      },
      {
        titulo: 'Ver uma loja só ou todas',
        passos: [
          'Com mais de uma loja, aparece o seletor de unidade ao lado do período.',
          'Escolha uma loja, ou "todas" para o consolidado.',
          'No consolidado aparece o quadro "Por unidade", com o ranque das lojas.',
          'Você só vê as lojas a que seu acesso alcança.',
        ],
      },
      {
        titulo: 'Ler o que está acabando e o que está parado',
        passos: [
          'Na seção Estoque, "Acabando" lista os itens no mínimo ou zerados (até 8).',
          'Na seção Produtos, "Parados há mais de 30 dias" lista o que tem saldo e não vendeu no último mês — isso não muda com o período escolhido.',
          'O menu avisa antes de você clicar: a bolinha ao lado de Estoque e de Produtos diz quantos.',
          'Para agir: Estoque (dar entrada) ou Produtos (ajustar preço, promoção).',
        ],
      },
      {
        titulo: 'Acompanhar a equipe e a meta',
        passos: [
          'A seção Equipe aparece com o módulo Metas e comissão ligado e a permissão de ver a equipe.',
          '"Quem mais vendeu" ranqueia por vendedor no período.',
          '"Meta do mês" mostra o vendido de cada pessoa, líquido de devolução, contra a meta dela.',
          'Definir meta e comissão é na tela Equipe.',
        ],
        capacidade: 'equipe.ver',
      },
      {
        titulo: 'O que o plano Grátis vê',
        passos: [
          'No Grátis o painel mostra o essencial: total, média por dia, ticket, movimento por dia e os mais vendidos.',
          'Forma de pagamento, hora do dia, venda por categoria e dinheiro parado por categoria são do relatório completo, do Balcão para cima — aparecem com o aviso e o link "Ver planos".',
          'Comparar planos é em Assinatura.',
        ],
        plano: 'BALCAO',
      },
      {
        titulo: 'Ler o bloco do seu ramo ("Hoje na sua…")',
        passos: [
          'O bloco segue o ramo de CADA loja (Lojas › o ramo dela; sem ramo, vale o da empresa). Em "Todas as unidades", cada ramo ganha o seu bloco, com as lojas dele — até três ramos. Depósito não entra.',
          'Roupa, calçado e bijuteria: "Grade quebrada" lista, loja por loja, a peça em que acabou o que vendia no último mês e sobrou o resto da grade ("acabou M e G · sobrou PP e GG"), e diz se outra loja tem a peça para transferir. Ao lado, o tamanho (ou numeração) que mais saiu em 7 dias.',
          'Sorveteria: quilos vendidos hoje, vendas e a hora de pico; "O que está acabando" (acabou e vendia, sobra menos que um dia médio de venda, ou está no mínimo da loja) e o que mais saiu hoje, primeiro o que vai a peso.',
          'Padaria, lanchonete, floricultura e serviço: as encomendas atrasadas, de hoje e de amanhã (com o módulo Encomenda); a produção do dia pela MÉDIA DO MESMO DIA DA SEMANA — "média das últimas 4 quartas", ou de menos quartas se a loja vende há menos tempo — com o que já saiu hoje; e as horas fortes desse dia.',
          'Mercearia, pet shop, papelaria, autopeças, construção, brinquedos e distribuidora: "Repor logo" — no plano Direção, pelo ritmo de venda e o prazo do fornecedor (a mesma conta do "Vai faltar"); nos outros, o que está no mínimo cadastrado — e o que mais gira em 7 dias contra os 7 anteriores.',
          'O que mostra saldo só aparece para quem pode ver o estoque; as encomendas, para quem vê vendas. Os links levam ao Estoque ou às Encomendas já na loja certa.',
          'É conta do que foi vendido, contado e anotado — não é previsão. Sem histórico, o bloco diz que ainda não há média, em vez de inventar uma.',
        ],
        capacidade: 'relatorio.ver',
      },
    ],
    perguntas: [
      {
        p: 'Por que eu não vejo o Painel?',
        r: 'O Painel exige a permissão de ler relatório. Quem tem o papel Balcão entra e cai direto no Balcão de vendas — é regra, não defeito.',
      },
      {
        p: 'Como a margem do Painel é calculada?',
        r: '(total vendido − custo dos itens vendidos) ÷ total vendido. O custo é o de cada item na hora da venda. Produto sem custo cadastrado entra com custo zero, e a margem sai maior do que é — cadastre o custo na ficha do produto ou na entrada de mercadoria.',
      },
      {
        p: 'O que é "Vendas com cliente"?',
        r: 'A parte das vendas do período em que alguém escolheu o cliente no balcão. Abaixo de 50% o painel avisa: venda sem cliente é histórico que não existe.',
      },
      {
        p: 'Onde aparece o desempenho da equipe em estrelas?',
        r: 'Num cartão do Painel e na tela Equipe, do plano Assistente para cima: de 0 a 5 estrelas por pessoa e mês, somando meta batida, tarefas no prazo e dias presente.',
      },
    ],
    palavras: ['dashboard', 'início', 'resumo', 'faturamento', 'ticket médio', 'margem', 'gráfico', 'visão geral', 'quanto vendi', 'comparação', 'ramo', 'grade quebrada', 'sabor', 'produção do dia', 'repor'],
  },

  // ── Balcão ──
  {
    chave: 'balcao',
    titulo: 'Balcão',
    caminho: '/balcao',
    abre: ['venda.criar'],
    oQueE:
      'Onde a venda acontece. Precisa de caixa aberto na loja, e só mostra o que ESTA loja vende. Tem duas caras, conforme o modo do aparelho: no simples, cartões grandes de produto à esquerda e o pedido à direita, com "Concluir venda"; no avançado, a busca por etiqueta, código ou nome e a tabela do pedido. A venda é a mesma nos dois: cliente e vendedor, desconto, pontos, e o pagamento em Dinheiro, Pix, Débito, Crédito, crediário em parcelas e vale de troca. O troco aparece grande antes de confirmar.',
    comoFazer: [
      {
        titulo: 'Vender no modo simples',
        passos: [
          'Com o aparelho no modo simples, o balcão mostra os produtos em cartões, com as categorias em abas no alto ("Todos" primeiro). A busca e o leitor continuam valendo: bipe a etiqueta ou digite o nome.',
          'Toque no cartão para pôr no pedido; tocar de novo soma mais um. A bolinha no cartão diz quantos já estão no pedido. "Esta acabou" não lança.',
          'Produto com grade (tamanho, cor, sabor) abre a folha para escolher a opção — com tamanho E cor, a grade inteira com o saldo de cada peça. Produto em quilo pergunta "Quanto pesou?" (ver "Vender por peso").',
          'No pedido, − e + mudam a quantidade, e ✕ tira o item. "Limpar" zera o pedido — toque de novo para confirmar.',
          'Em "Como vai pagar?", toque na forma. Em dinheiro, digite o recebido ou toque numa nota pronta ("Exato", 50, 100…). "Concluir venda" (ou F10) mostra "Venda concluída", com o troco para devolver em destaque.',
          'Cliente (Alt+N), quem vendeu (Alt+F), desconto na venda, item avulso e observação ficam em "Mais opções" — e o botão mostra quantas estão valendo, para ninguém esquecer um desconto ligado.',
          'No celular ou tablet em pé, a barra de baixo mostra itens e total: "Ver pedido e pagar" sobe o pedido. "Tela cheia" tira o menu e o cabeçalho do caminho (o mesmo botão sai dela) e fica lembrado neste aparelho.',
        ],
        capacidade: 'venda.criar',
      },
      {
        titulo: 'Lançar itens (modo avançado)',
        passos: [
          'O cursor já está na busca: bipe a etiqueta, ou digite 2 letras ou mais do nome, da marca ou do código.',
          'Enter lança o primeiro resultado; clique lança outro da lista. Código lido pelo leitor vem sempre em primeiro.',
          'Para vários iguais, digite a quantidade no campo × à esquerda ANTES de lançar. "×20" vale só para o próximo item e volta a 1.',
          'Item em quilo: a quantidade é o peso. Lançar de novo o mesmo item substitui o peso — não soma.',
          'Lançou mais do que tem no estoque? A tela avisa na hora, e o servidor recusa de novo ao fechar.',
          'Bipou um produto que esta loja não vende? A tela avisa, e ele não entra na venda.',
          'Tirar um item: o ✕ na linha. "limpar venda" zera tudo.',
        ],
        capacidade: 'venda.criar',
      },
      {
        titulo: 'Vender pela grade de botões',
        passos: [
          'A grade aparece quando "Vender tocando em botões" está ligado em Configurações — é o padrão de sorveteria, lanchonete, floricultura.',
          'Com a busca vazia, as categorias viram abas e os produtos viram botões com nome, preço e saldo.',
          'Escolha a quantidade no × e toque no produto. Tocar de novo soma mais um.',
          'Botão apagado com "acabou" não lança.',
          'Categoria com mais de 120 itens mostra os primeiros — para o resto, digite o nome.',
        ],
        capacidade: 'venda.criar',
      },
      {
        titulo: 'Receber e fechar a venda',
        passos: [
          'Clique na forma (Dinheiro, Pix, Débito, Crédito): o valor que falta já vem preenchido. Dá para combinar formas — parte no Pix, parte no crédito.',
          'Em dinheiro, digite quanto o cliente entregou: o troco aparece em verde. Só dinheiro dá troco — se passar do total em cartão ou Pix, a venda trava até ajustar.',
          'Desconto em reais no campo "Desconto". Acima do teto da empresa, só quem tem a permissão de desconto acima do teto consegue fechar.',
          'Crédito cobra o preço "no cartão"; as outras formas, o "à vista". Com formas misturadas vale a tabela mais cara, e a escada dos três totais aparece quando os preços diferem.',
          'Aperte F10 ou "Fechar venda". Sai o recado com o número da venda, os pontos que o cliente ganhou e o link "imprimir comprovante".',
          'Atalhos: F10 fecha (ou leva às formas, se ainda falta pagar), Ctrl+P volta à busca, Alt+N abre o cliente, Alt+F o vendedor; na busca, Enter lança o primeiro resultado e Esc limpa.',
          'No plano Grátis, a venda de número 301 do mês é recusada, com o recado do limite: o plano vai até 300 vendas concluídas por mês (a cancelada não conta), e o limite solta no dia 1º.',
        ],
        capacidade: 'venda.criar',
      },
      {
        titulo: 'Escolher cliente e vendedor',
        passos: [
          'Alt+N (ou "+ Quem está comprando?") abre a busca de cliente: nome, telefone ou CPF.',
          'Sem cadastro? Digite o nome, o WhatsApp (opcional) e "Cadastrar e usar" — sem sair da tela.',
          'A tela mostra quantas compras, quanto gastou, se sumiu há 60+ dias e se deve no crediário — em dia ou atrasado.',
          'Com o módulo Metas ligado, o campo Vendedor (Alt+F) diz quem atendeu: é para o nome dele que vai a meta e a comissão.',
          'Vender sem cliente é permitido e é o normal do balcão. "trocar" muda o cliente escolhido.',
        ],
      },
      {
        titulo: 'Vender no crediário, com pontos ou vale de troca',
        passos: [
          'Crediário (fiado): só com o módulo ligado e com cliente escolhido — fiado é dívida com nome. Escolha em quantas vezes (até o máximo de Configurações) e clique em "Crediário".',
          'No crediário o total passa para a tabela "no crediário", e as parcelas nascem a cada N dias contando de hoje. Receber depois é na tela Crediário.',
          'Pontos: com o programa ligado e o cliente escolhido, aparece "Tem X pontos — dá R$ Y de desconto — usar" quando ele passou do mínimo.',
          'Os pontos abatem do valor já com desconto e nunca passam do total da venda. O ✕ desfaz.',
          '"+ vale de troca": digite o código do papel (VT-XXXXXX) e "Usar". A tela mostra o saldo e de quem é, e o vale entra como pagamento até o que falta.',
          'Vale vencido (90 dias) ou já usado é recusado. O mesmo vale não entra duas vezes na mesma venda.',
        ],
        capacidade: 'venda.criar',
      },
      {
        titulo: 'Vender por peso, e o que muda com o ramo da loja',
        passos: [
          'No modo simples, produto em quilo (ou litro, metro) abre "Quanto pesou?". As teclas prontas põem o peso no campo — na sorveteria 200 g, 300 g, 500 g e 1 kg; na padaria 100 g, 250 g, 500 g e 1 kg — e "Adicionar" mostra quanto dá antes de entrar.',
          'Em tablet e celular aparece o teclado grande (com vírgula e apagar) no lugar do teclado do sistema.',
          '"Ler da balança" só aparece no Chrome ou Edge do computador, com a balança ligada por cabo serial ou USB-serial: na primeira vez o navegador pergunta a porta. Lê só peso ESTÁVEL (Toledo, Filizola e as que mandam "ST,GS"), a 9600 bauds.',
          'Se a balança não responde, o peso está mexendo ou a porta está ocupada, a tela diz e o campo continua para digitar — a venda nunca para por causa dela. Não substitui balança homologada que imprime etiqueta.',
          'Na sorveteria, depois de lançar açaí, sorvete de massa ou milk-shake, os produtos da aba "Complementos" sobem num toque ("Vai complemento?"). "Sem complemento" dispensa; a aba continua lá.',
          'Pesar de novo o mesmo item substitui o peso — não soma.',
        ],
        capacidade: 'venda.criar',
      },
    ],
    perguntas: [
      {
        p: 'Aparece "caixa fechado" e não consigo vender. E agora?',
        r: 'Toda venda entra no caixa aberto DESTA loja. Quem opera o caixa abre na própria tela do Balcão, informando quanto tem na gaveta. Quem não pode operar o caixa precisa chamar o gerente.',
      },
      {
        p: 'A página recarregou no meio da venda. Perdi tudo?',
        r: 'Não. A venda em montagem fica guardada neste aparelho, por pessoa, por até 12 horas. Ao voltar, a tela avisa "Recuperamos a venda que estava sendo montada" e deixa começar do zero se não for essa.',
      },
      {
        p: 'O que é item avulso?',
        r: 'Um item fora do catálogo — conserto, peça sem cadastro — com nome e preço digitados na hora. Não mexe no estoque e fica marcado no livro. Só quem tem a permissão de desconto acima do teto lança: preço digitado é o mesmo buraco que desconto sem teto.',
      },
      {
        p: 'Como imprimo o comprovante?',
        r: 'Depois de fechar, clique em "imprimir comprovante" no recado verde. Também na ficha da venda (Vendas › abrir › Comprovante). É a via do cliente em papel de 80 mm — não é nota fiscal.',
      },
    ],
    palavras: ['pdv', 'venda', 'vender', 'frente de caixa', 'carrinho', 'pagamento', 'troco', 'desconto', 'código de barras', 'leitor', 'bipar', 'atalho', 'teclado', 'f10', 'item avulso', 'grade de botões', 'pix', 'cartão', 'dinheiro', 'balança', 'peso', 'quilo', 'complemento', 'açaí'],
  },

  // ── Vendas ──
  {
    chave: 'vendas',
    titulo: 'Vendas',
    caminho: '/vendas',
    abre: ['venda.ver'],
    oQueE:
      'Tudo que já foi vendido: total e ticket do período, canceladas, e a lista com número, hora, cliente, itens, pagamento e quem vendeu. Busca por número da venda ou nome do cliente; filtros por vendedor, forma de pagamento e situação; planilha com uma linha por item. Cada venda abre numa ficha — e é lá que se devolve, troca ou cancela.',
    comoFazer: [
      {
        titulo: 'Achar uma venda',
        passos: [
          'Digite o número da venda ou o nome do cliente e clique em Buscar.',
          'Troque o período e a loja no alto da tela.',
          'Filtre por quem vendeu ou pela forma de pagamento nas fichas abaixo da busca.',
          '"abrir" leva à ficha da venda, com itens, pagamento, parcelas e devoluções.',
          'A lista mostra até 500 — aperte o período se passar disso.',
        ],
        capacidade: 'venda.ver',
      },
      {
        titulo: 'Devolver ou trocar itens',
        passos: [
          'Abra a venda e clique em "Devolver ou trocar itens desta venda".',
          'Digite quanto de cada item está voltando — até o que ainda não voltou.',
          'Escolha para onde vai o valor: Vale de troca (qualquer pessoa do balcão), Dinheiro da gaveta ou Estorno por fora (só quem pode cancelar venda).',
          'Escreva o motivo (obrigatório) e "Registrar devolução".',
          'O valor devolvido é o que a pessoa PAGOU pela peça, já com o desconto da venda. O estoque volta, e os pontos voltam na proporção.',
          'Venda no crediário com parcela em aberto: o valor primeiro abate o que o cliente ainda deve (da última parcela para a primeira). Só o que sobrar vai para o vale, a gaveta ou o estorno.',
          'Com vale, anote o código VT-… para o cliente: ele paga qualquer venda no balcão por 90 dias.',
        ],
        capacidade: 'venda.criar',
      },
      {
        titulo: 'Cancelar uma venda',
        passos: [
          'Na ficha da venda, no fim, "Cancelar esta venda".',
          'Escreva o motivo (mínimo 3 letras) e "Confirmar cancelamento".',
          'O estoque volta, os pontos do cliente voltam, o vale usado na venda volta a valer e as parcelas do crediário deixam de existir. O dinheiro NÃO volta sozinho: Pix ou cartão você devolve por fora, e o motivo é o que explica isso no livro.',
          'Cancelar é para o engano; devolver é para o dia seguinte. Cancelar desfaz a venda inteira.',
          'Venda que já teve devolução, ou venda no crediário com parcela já recebida, não se cancela: devolva o que falta.',
        ],
        capacidade: 'venda.cancelar',
      },
      {
        titulo: 'Comprovante e WhatsApp',
        passos: [
          'Na ficha, "Comprovante" abre a via do cliente em 80 mm, com botão de imprimir.',
          'Se o cliente tem telefone, "Mandar pelo WhatsApp" abre a conversa com o resumo da compra já escrito.',
          'A ficha também mostra as parcelas do crediário (receber é na tela Crediário) e as devoluções já feitas.',
        ],
        capacidade: 'venda.ver',
      },
      {
        titulo: 'Baixar a planilha',
        passos: [
          'O botão "Planilha" no alto baixa um CSV com uma linha por item vendido.',
          'Ele respeita os filtros da tela: período, loja, busca, vendedor, forma e situação.',
          'Abre em qualquer planilha (Excel, Google Planilhas).',
        ],
        capacidade: 'venda.ver',
      },
    ],
    perguntas: [
      {
        p: 'Devolver em dinheiro exige o quê?',
        r: 'Caixa aberto na loja (o dinheiro sai como sangria, para o fechamento bater) e a permissão de cancelar venda. Troca por vale, qualquer pessoa do balcão faz. Se a venda foi no crediário e ainda tem parcela em aberto, o valor abate a dívida antes — e pode não sair dinheiro nenhum.',
      },
      {
        p: 'A venda com devolução continua "concluída"?',
        r: 'Sim. A devolução fica pendurada nela, com "Devolvido" e "Ficou". O mês da venda não muda quando alguém devolve no mês seguinte — o relatório desconta as devoluções do período delas.',
      },
      {
        p: 'Por que o filtro não tem "abertas"?',
        r: 'A venda nasce concluída. Só existem concluídas e canceladas.',
      },
    ],
    palavras: ['histórico de vendas', 'devolução', 'devolver', 'troca', 'trocar', 'cancelar venda', 'estorno', 'comprovante', 'recibo', 'vale de troca', 'planilha', 'exportar', 'cupom'],
  },

  // ── Caixa ──
  {
    chave: 'caixa',
    titulo: 'Caixa',
    caminho: '/caixa',
    abre: ['caixa.ver'],
    oQueE:
      'O histórico dos turnos de caixa: quem abriu, quem fechou, quanto vendeu e a diferença da gaveta (falta ou sobra), com a conta de cada turno e as sangrias e suprimentos. Abrir, sangrar, suprir e fechar acontece no Balcão; aqui se confere. Caixa aberto há mais de um dia fica em âmbar, com o link para fechar.',
    comoFazer: [
      {
        titulo: 'Abrir o caixa',
        passos: [
          'Vá ao Balcão. Sem caixa aberto na loja, a tela mostra "Abrir o caixa".',
          'Digite quanto tem na gaveta agora — o troco que ficou de ontem; 0 se começou zerado.',
          '"Abrir caixa". Só quem opera o caixa abre, e é um caixa por loja de cada vez.',
        ],
        capacidade: 'caixa.operar',
      },
      {
        titulo: 'Sangria e suprimento',
        passos: [
          'No Balcão, na barra do caixa: "↓ Sangria" tira dinheiro da gaveta; "↑ Suprimento" põe.',
          'Valor e motivo — o motivo é obrigatório ("pagamento do entregador", "troco do banco").',
          '"Registrar". Os dois entram na conta da gaveta e no livro de auditoria.',
        ],
        capacidade: 'caixa.operar',
      },
      {
        titulo: 'Fechar o caixa conferindo a gaveta',
        passos: [
          'No Balcão, "Fechar caixa" na barra do caixa — ou pelo aviso desta tela, quando há caixa esquecido.',
          'Conte o dinheiro da gaveta ANTES de olhar o valor esperado. É o que faz a conferência valer.',
          'A tela mostra o que passou pela gaveta: abertura + vendas em dinheiro + crediário recebido em dinheiro + suprimentos − sangrias. Cartão e Pix não entram — não passam pela gaveta.',
          'Digite o que você contou e, se quiser, uma observação que explique a diferença.',
          '"Fechar o caixa": sai "fechado certinho" ou a falta/sobra. A diferença vai para o livro sempre, inclusive quando é zero.',
        ],
        capacidade: 'caixa.operar',
      },
      {
        titulo: 'Ler os turnos e a diferença acumulada',
        passos: [
          'Escolha período e loja no alto da tela.',
          'Os números de cima: diferença acumulada, vendido nos turnos, turnos com falta e com sobra.',
          '"detalhes" na linha abre a conta da gaveta daquele turno e as sangrias e suprimentos, com quem e a hora.',
          'As vendas do turno estão em Vendas, filtradas pela loja.',
        ],
        capacidade: 'caixa.ver',
      },
    ],
    perguntas: [
      {
        p: 'O caixa "faltou" exatamente o valor da maquininha. Por quê?',
        r: 'Não deveria: cartão e Pix não entram na conta da gaveta. Se faltou, conte só o dinheiro em espécie — o esperado já é só dinheiro.',
      },
      {
        p: 'O caixa ficou aberto desde ontem. E agora?',
        r: 'Feche-o (o aviso no alto desta tela tem o link "Fechar agora") e abra outro hoje. Caixa aberto de um dia para o outro mistura o dinheiro de dois turnos.',
      },
      {
        p: 'Quem pode ver esta tela?',
        r: 'Quem tem a permissão de ver o caixa: dono, gerente, balcão e financeiro. O contador não.',
      },
    ],
    palavras: ['gaveta', 'sangria', 'suprimento', 'abrir o caixa', 'fechar o caixa', 'turno', 'fechamento de caixa', 'conferência', 'diferença', 'falta', 'sobra', 'quebra de caixa'],
  },

  // ── Crediário ──
  {
    chave: 'crediario',
    titulo: 'Crediário',
    caminho: '/crediario',
    abre: ['crediario.ver'],
    modulo: 'crediario',
    oQueE:
      'Quem deve, quanto e desde quando — e receber. A tela abre nas parcelas em aberto, vencidas primeiro, com o juro de atraso já sugerido. Só existe com o módulo Crediário ligado (plano Direção). Vender fiado é escolher a forma Crediário no Balcão, com cliente.',
    comoFazer: [
      {
        titulo: 'Receber uma parcela',
        passos: [
          'Ache a parcela: busca por nome do cliente ou número da venda; fichas em aberto, vencidas, quitadas, todas.',
          '"Receber": o valor vem preenchido com o que resta mais o juro de atraso de hoje.',
          'Combinou diferente ("só tenho cinquenta", "tira o juro")? Os dois campos são editáveis — o sistema registra o combinado.',
          'Escolha como recebeu: Dinheiro (exige caixa aberto na loja — entra na gaveta), Pix, Débito, Crédito ou Transferência.',
          '"Confirmar". Pagamento parcial abate e o resto continua vencendo; a parcela só quita quando o abatido alcança o valor.',
        ],
        capacidade: 'crediario.receber',
      },
      {
        titulo: 'Vender fiado',
        passos: [
          'No Balcão, escolha o cliente (obrigatório para crediário).',
          'Escolha em quantas vezes e clique em "Crediário".',
          'O preço usado é o "no crediário" de cada produto. As parcelas nascem a cada N dias a partir de hoje, em valores iguais.',
        ],
        capacidade: 'venda.criar',
      },
      {
        titulo: 'Cobrar quem está atrasado',
        passos: [
          'As fichas coloridas no topo listam quem mais deve (vermelho = com parcela vencida); clique para ver só aquela pessoa.',
          'Na ficha do cliente (tela Clientes), "Cobrar pelo WhatsApp" abre a mensagem pronta com as parcelas vencidas.',
          'O juro de atraso é X% ao mês, proporcional aos dias, só sobre o que ficou vencido — a regra da loja aparece no número "Regra da loja".',
        ],
        capacidade: 'crediario.cobrar',
      },
      {
        titulo: 'Mudar juros, parcelas e intervalo',
        passos: [
          'Configurações › Crediário.',
          'Juro de atraso ao mês (0 a 20%), até quantas vezes (1 a 24), dias entre as parcelas (7 a 90).',
          'Vale para as vendas daqui para frente; as parcelas já escritas não mudam.',
        ],
        capacidade: 'empresa.configurar',
      },
    ],
    perguntas: [
      {
        p: 'Parcelar cobra juro do cliente?',
        r: 'Não. O prazo é cobrado pelo preço "no crediário" do produto. Juro só existe no atraso — quem paga em dia não vê juro nenhum.',
      },
      {
        p: 'Como sei se a pessoa está atrasada antes de vender fiado de novo?',
        r: 'No Balcão, ao escolher o cliente, aparece "deve R$ X · atrasado" ou "deve R$ X · em dia".',
      },
      {
        p: 'Não vejo Crediário no menu. Por quê?',
        r: 'O módulo está desligado em Configurações, ou o plano não o inclui (é da Direção para cima), ou o seu papel não vê crediário.',
      },
    ],
    palavras: ['fiado', 'vender fiado', 'parcela', 'parcelas', 'carnê', 'cobrança', 'cobrar', 'juros', 'atraso', 'receber', 'dívida', 'devedor', 'inadimplente', 'a prazo'],
  },

  // ── Encomendas ──
  {
    chave: 'encomendas',
    titulo: 'Encomendas',
    caminho: '/encomendas',
    abre: ['venda.ver'],
    modulo: 'encomenda',
    oQueE:
      'O pedido que sai depois: o bolo para sábado às 15h, o buquê para as 16h, a peça que o cliente paga metade hoje e busca na semana que vem. A lista abre pelo que vence primeiro, em faixas — Atrasadas (passou da hora e não saiu), Hoje, Amanhã, Esta semana (os próximos dias) e Depois — com hora, cliente e WhatsApp, valor, sinal, o que falta pagar e se é retirada ou entrega. Só existe com o módulo Encomenda ligado em Configurações › Módulos (planos pagos). O sinal entra no Financeiro na hora, como receita; o que falta é recebido no Balcão, como venda.',
    comoFazer: [
      {
        titulo: 'Anotar uma encomenda',
        passos: [
          '"+ Nova encomenda".',
          'Para quem: digite o nome e escolha no cadastro de clientes, ou deixe só o nome e o WhatsApp de quem não é cadastrado.',
          'O que é (tamanho, sabor, o que vai escrito), o valor e o sinal, se o cliente adiantou alguma coisa — a tela mostra quanto falta pagar.',
          'Dia E hora: a hora é a do relógio da loja. Data que já passou só é aceita marcando "a data já passou, é isso mesmo".',
          'Retirada na loja ou entrega (com o endereço), e uma observação se precisar. "Anotar encomenda".',
          'O sinal entra no Financeiro no mesmo instante, como receita da loja da encomenda — não lance de novo.',
        ],
        capacidade: 'venda.criar',
        plano: 'BALCAO',
      },
      {
        titulo: 'Marcar pronta e entregar',
        passos: [
          '"Pronta" quando a encomenda estiver feita (fica amarela: está esperando o cliente). Marcou por engano? "Não está pronta" volta atrás.',
          '"Entregue": a tela mostra quanto falta receber e lembra que o sinal já está no Financeiro.',
          '"Receber no balcão" marca a entrega e só abre o Balcão — a venda você lança lá, SÓ do que falta. Lançar o valor cheio contaria o sinal duas vezes.',
          '"Só marcar entregue" é para quando o que faltava já foi pago de outro jeito. Entregue não volta: sai da lista em aberto e fica no filtro "entregues".',
        ],
        capacidade: 'venda.criar',
      },
      {
        titulo: 'Cancelar uma encomenda',
        passos: [
          '"Cancelar" na linha da encomenda.',
          'Escreva o motivo — é obrigatório e fica no livro de auditoria.',
          'Se houve sinal, a tela lembra de devolver. Marque "Devolvi o sinal" e a devolução sai no Financeiro de hoje; sem marcar, o sinal fica como receita da loja.',
          '"Cancelar encomenda". Cancelada não volta: se foi engano, anote de novo.',
        ],
        capacidade: 'venda.cancelar',
      },
      {
        titulo: 'Mudar uma encomenda',
        passos: [
          '"Mudar" na linha: abre o formulário preenchido no alto da tela.',
          'Troque o que precisar — dia, hora, valor, endereço. A loja não muda; para outra loja, cancele e anote lá.',
          'Mudou o sinal? A diferença entra no Financeiro hoje: a mais como receita, a menos como devolução.',
          'Entregue ou cancelada não muda mais.',
        ],
        capacidade: 'venda.criar',
      },
      {
        titulo: 'Achar uma encomenda e avisar o cliente',
        passos: [
          'Busque por nome, telefone ou pelo que foi encomendado ("bolo", "buquê").',
          'Fichas: em aberto (a fazer e prontas), a fazer, prontas, entregues, canceladas, todas.',
          'O telefone de cada encomenda abre a conversa no WhatsApp num toque — "está pronto, pode vir buscar".',
          'Com mais de uma loja, o seletor do alto escolhe a loja; quem só vê uma loja só vê as encomendas dela.',
        ],
        capacidade: 'venda.ver',
      },
    ],
    perguntas: [
      {
        p: 'O sinal aparece no resultado do mês?',
        r: 'Sim. Ele entra no Financeiro no dia em que foi recebido, em "Outras receitas", com a loja da encomenda. Na entrega, o que falta vira venda no Balcão. Sinal + venda do restante = o valor da encomenda, contado uma vez só.',
      },
      {
        p: 'O que conta como atrasada?',
        r: 'Passou da hora combinada e não está entregue nem cancelada — o bolo das 10h que às 14h não saiu. É a primeira faixa da lista, fica vermelha e acende a bolinha do menu.',
      },
      {
        p: 'Não vejo Encomendas no menu. Por quê?',
        r: 'O módulo Encomenda está desligado (Configurações › Módulos), ou o plano não o inclui (é dos planos pagos), ou o seu papel não vê vendas.',
      },
    ],
    palavras: ['pedido', 'pedidos', 'bolo', 'reserva', 'retirada', 'retirar', 'entrega', 'entregar', 'sinal', 'adiantamento', 'encomendar', 'buquê', 'agendar', 'data de entrega', 'para sábado'],
  },

  // ── Produtos ──
  {
    chave: 'produtos',
    titulo: 'Produtos',
    caminho: '/produtos',
    abre: ['produto.ver'],
    oQueE:
      'O catálogo: cada produto com nome, marca, categoria, medida (unidade, quilo, par…), os três preços (à vista, no cartão, no crediário), custo, prazo de reposição e a grade de variações (cor × tamanho…), cada combinação com o próprio código de etiqueta. A lista mostra estoque, margem, quanto vendeu em 30 dias e pendências de cadastro. Daqui saem as etiquetas e a planilha.',
    comoFazer: [
      {
        titulo: 'Cadastrar um produto',
        passos: [
          '"+ Novo produto" no alto da lista.',
          'Nome (obrigatório), marca, categoria e como se conta: unidade, quilo, grama, litro, par, caixa…',
          'Preço à vista é o único obrigatório. Cartão e crediário em branco ficam iguais a ele. Custo é o que permite calcular margem.',
          'Em "Como varia", marque só as opções que o produto tem de verdade: 2 cores × 3 tamanhos = 6 itens, e a tela mostra a conta antes de salvar.',
          '"Cadastrar" leva à ficha, onde a grade já nasceu com os códigos de etiqueta (três letras do nome + número: CAM001).',
        ],
        capacidade: 'produto.editar',
      },
      {
        titulo: 'Escolher em que lojas o produto é vendido',
        passos: [
          'Só aparece para quem tem mais de uma loja: na ficha do produto, o bloco "Vendido em".',
          'Tudo marcado = vendido em todas, inclusive nas lojas que abrirem depois.',
          'No produto NOVO, a categoria sugere as lojas: categoria do ramo sorveteria (Picolé, Açaí) já vem marcada só na sorveteria. É sugestão — marque e desmarque antes de salvar.',
          'Desmarque a loja que NÃO vende: a sorveteria não mostra camisa no balcão, a loja de roupa não mostra picolé.',
          'A regra vale no servidor também: produto de outra loja é recusado na venda mesmo que alguém bipe o código de cabeça.',
          'O gerente de uma loja só marca e desmarca as lojas que ele cuida; as outras aparecem travadas. Produto novo cadastrado por ele nasce só nas lojas dele — "em todas" (inclusive as que abrirem depois) é decisão de quem responde pela empresa inteira.',
          '"Salvar". A lista de Lojas mostra quantos produtos são só de cada uma.',
        ],
        capacidade: 'produto.editar',
      },
      {
        titulo: 'Editar preço, custo e grade',
        passos: [
          'Abra o produto ("editar" na lista). A ficha mostra como ele vende — 30 e 90 dias, margem, última venda — antes dos campos.',
          'Mexer em preço exige permissão própria; quem só edita descrição não muda preço.',
          'Preço, custo, lojas, medida, situação e grade valem em toda loja onde o produto é vendido. Por isso só muda quem cuida de TODAS essas lojas: o gerente do Centro muda o que só o Centro vende; no produto vendido também em outra loja (ou em todas), esses campos aparecem travados e ele corrige nome, marca, categoria e prazo. A entrada de mercadoria dele também não reescreve o custo desse produto — a tela avisa.',
          'Desmarcar uma opção que já tem venda não apaga nada: aquela combinação sai do balcão e continua no histórico, com o saldo que tiver.',
          '"Salvar" diz o que mudou na grade: quantas variações novas, reativadas, desativadas.',
          '"Produto à venda" desmarcado tira o produto do balcão e da lista, e mantém todo relatório antigo.',
        ],
        capacidade: 'produto.editar',
      },
      {
        titulo: 'Imprimir etiquetas',
        passos: [
          'Na lista, "etiquetas" no produto; ou "Etiquetas" no alto, com uma busca ou categoria aplicada (algum recorte é obrigatório).',
          'Escolha o formato: folha A4 de adesivo 50×30 mm, ou impressora térmica (uma etiqueta por página).',
          'Cópias: uma por item, ou uma por peça em estoque — para etiquetar a caixa que acabou de chegar.',
          '"Imprimir etiquetas". O código de barras é o código interno (Code 128) ou o EAN quando a peça tem. Máximo 400 por vez.',
        ],
        capacidade: 'produto.ver',
      },
      {
        titulo: 'Achar o que precisa de atenção',
        passos: [
          'Fichas de situação: acabaram, no mínimo, com estoque — a tira de cima conta o quadro inteiro.',
          'Pendências: sem venda em 30 dias, sem custo, sem categoria, sem código de barras.',
          'Ordenar por nome, mais vendidos em 30 dias, mais estoque ou maior preço.',
          'A marca vira filtro quando a loja tem até 12 marcas; acima disso, use a busca.',
        ],
        capacidade: 'produto.ver',
      },
      {
        titulo: 'Baixar a planilha',
        passos: [
          '"Planilha" no alto baixa o catálogo em CSV, com o saldo da loja escolhida.',
          'Serve para conferir preços em massa ou levar ao contador.',
          'Alterar preço em massa pela planilha ainda não existe: o preço se muda na ficha de cada produto.',
        ],
        capacidade: 'produto.ver',
      },
    ],
    perguntas: [
      {
        p: 'O que é o código de etiqueta?',
        r: 'Três letras do nome, sem acento, mais um número sequencial (CAM001). É o que se digita no balcão quando o leitor não pega. Nunca é reaproveitado, nem de produto arquivado.',
      },
      {
        p: 'Como funcionam os três preços?',
        r: 'A forma de pagamento escolhe: dinheiro, Pix, débito, transferência e vale usam o "à vista"; crédito usa o "no cartão"; crediário usa o "no crediário". Em branco, o preço cai para o de baixo (crediário → cartão → à vista) — nunca fica menor que o à vista.',
      },
      {
        p: 'Onde vejo margem e markup de tudo de uma vez?',
        r: 'Na tela Preços (menu Catálogo), do Balcão para cima. O preço em si se muda na ficha do produto.',
      },
      {
        p: 'O que é "Prazo de reposição (dias)" na ficha?',
        r: 'Quantos dias o fornecedor leva para repor. Sem informar, vale 7. A previsão "Vai faltar", em Estoque (plano Direção), usa esse prazo para dizer até quando pedir.',
      },
    ],
    palavras: ['catálogo', 'cadastro de produto', 'cadastrar produto', 'mercadoria', 'peça', 'variação', 'grade', 'tamanho', 'cor', 'etiqueta', 'código de barras', 'ean', 'sku', 'preço', 'custo', 'categoria', 'marca', 'planilha', 'exportar'],
  },

  // ── Estoque ──
  {
    chave: 'estoque',
    titulo: 'Estoque',
    caminho: '/estoque',
    abre: ['estoque.ver'],
    oQueE:
      'O que tem em cada loja, o que acabou e o que está no mínimo — e tudo que entrou, saiu, foi corrigido ou transferido, com quem e quando. Entrada de mercadoria com custo e conta a pagar, correção pelo que foi contado, transferência entre lojas, a planilha do balanço e, na Direção, a previsão "Vai faltar".',
    comoFazer: [
      {
        titulo: 'Dar entrada na mercadoria que chegou',
        passos: [
          '"+ Dar entrada". A entrada é sempre EM uma loja: com mais de uma, escolha-a no alto — a tela avisa em qual vai entrar.',
          'Só entra na loja o que ela vende ("Vendido em", na ficha do produto). Depósito recebe qualquer produto: ele guarda o que as lojas vão vender.',
          'Bipe a etiqueta ou digite o nome; o item entra na lista. Ajuste "Quantas" e "Custo un." — o custo da peça passa a ser este.',
          'Fornecedor e número da nota são opcionais, mas é agora que a informação está fresca.',
          'Marque "Lançar a conta do fornecedor" para criar a conta a pagar com categoria, vencimento e "Já paguei" (exige permissão de lançar no financeiro).',
          '"Dar entrada". O recado diz o que foi feito — e o que não foi por falta de permissão, para a tela não mentir.',
        ],
        capacidade: 'estoque.ajustar',
      },
      {
        titulo: 'Corrigir o saldo pelo que foi contado',
        passos: [
          'Escolha uma loja no alto — no consolidado a coluna "Tem" é a soma, e corrigir não aparece.',
          'Na linha do item, "corrigir": digite o que você CONTOU na prateleira, não a diferença.',
          'Motivo obrigatório ("quebra", "contagem do mês"). A diferença aparece calculada ao lado.',
          '"Corrigir" grava um movimento de balanço e o novo saldo — e uma linha no livro de Auditoria, com o saldo de antes e o de depois.',
        ],
        capacidade: 'estoque.ajustar',
      },
      {
        titulo: 'Transferir entre lojas',
        passos: [
          'Com o módulo Mais de uma unidade e uma loja escolhida, "transferir" aparece na linha do item.',
          'Quantidade, loja de destino e motivo (opcional). O destino precisa vender o produto — ou ser um depósito — e estar aberto.',
          '"Transferir": sai como transferência aqui e entra como entrada lá, na mesma operação.',
          'Você precisa poder ajustar o estoque nas duas lojas.',
        ],
        capacidade: 'estoque.ajustar',
      },
      {
        titulo: 'Ler os movimentos',
        passos: [
          'Seção Movimentos: período no alto, fichas por tipo — entrada, venda, devolução, ajuste, perda, transferência, balanço.',
          'Cada linha: quando, item, motivo, quantidade (com sinal) e o saldo que ficou.',
          '"ver venda" leva à venda que baixou o item.',
          'A busca casa com nome e etiqueta, sem acento. Mostra até 500.',
        ],
        capacidade: 'estoque.ver',
      },
      {
        titulo: 'Ver o que vai faltar',
        passos: [
          'Seção "Vai faltar", do plano Direção: para cada item, quantos dias o saldo aguenta no ritmo de venda dos últimos 30 dias.',
          'Compara com o prazo de reposição do produto (campo na ficha do produto; sem informar, vale 7 dias).',
          'A tela diz "pedir até" tal dia — o último dia em que dá para pedir e a peça chegar antes de faltar.',
          'Situações: já faltou, pedir agora (dura menos que o prazo), atenção, ok, e sem giro (não vendeu nos 30 dias).',
          'Sem o plano, a seção aparece trancada com uma amostra e o nome do plano que abre.',
        ],
        plano: 'ruptura.previsao',
      },
      {
        titulo: 'Fazer o balanço com a planilha',
        passos: [
          '"Planilha" no alto baixa a folha do balanço da loja, com uma coluna vazia para o contado.',
          'Conte a loja com a folha na mão.',
          'Depois, corrija item a item com "corrigir", digitando o contado.',
        ],
        capacidade: 'estoque.ver',
      },
    ],
    perguntas: [
      {
        p: 'O que é o "mínimo"?',
        r: 'O saldo abaixo do qual o item aparece como "no mínimo": em "Precisa comprar" aqui, na seção Acabando do Painel e na bolinha do menu. É por item e por loja. Item sem mínimo só avisa quando zera.',
      },
      {
        p: 'Apareceu "saldo diferente da soma do histórico". O que é?',
        r: 'Defeito, não erro de contagem: o saldo foi mexido por fora do sistema. Chame o suporte — não corrija à mão antes.',
      },
      {
        p: 'Por que não aparece "corrigir" nem "transferir"?',
        r: 'Ou você está no consolidado (escolha uma loja no alto), ou não tem a permissão de ajustar estoque. Transferir ainda pede o módulo Mais de uma unidade.',
      },
    ],
    palavras: ['saldo', 'entrada de mercadoria', 'dar entrada', 'nota do fornecedor', 'inventário', 'balanço', 'contagem', 'corrigir', 'ajuste', 'perda', 'quebra', 'transferência', 'transferir', 'mínimo', 'acabando', 'acabou', 'ruptura', 'vai faltar', 'reposição', 'fornecedor', 'movimentação'],
  },

  // ── Preços ──
  {
    chave: 'precos',
    titulo: 'Preços',
    caminho: '/precos',
    abre: ['produto.preco'],
    oQueE:
      'Custo contra preço, item a item: margem (o que sobra do preço), markup (quanto se põe sobre o custo) e o preço sugerido para a margem alvo. Lista o que está abaixo do custo, abaixo do alvo e sem custo, e quanto cada item saiu em 30 dias. O preço se muda na ficha do produto. Exige a permissão de mexer em preço; margem e markup são do Balcão para cima, preço sugerido do Assistente.',
    comoFazer: [
      {
        titulo: 'Ler margem e markup',
        passos: [
          'Margem = (preço − custo) ÷ preço: a parte do preço que sobra.',
          'Markup = (preço − custo) ÷ custo: quanto se pôs em cima do custo.',
          'Cada item mostra os dois e quanto saiu em 30 dias — para você olhar primeiro o que gira.',
          'Sem custo cadastrado não há conta: cadastre o custo na ficha do produto ou na entrada de mercadoria.',
        ],
        capacidade: 'produto.preco',
        plano: 'precos.margem',
      },
      {
        titulo: 'Achar o que está abaixo do custo ou do alvo',
        passos: [
          'Defina a margem alvo no campo do topo (o padrão é 40%).',
          'As listas separam: abaixo do custo (prejuízo em cada venda), abaixo do alvo, sem custo.',
          'Para corrigir, abra o produto e mude o preço na ficha — esta tela não grava preço.',
        ],
        capacidade: 'produto.preco',
        plano: 'precos.margem',
      },
      {
        titulo: 'Usar o preço sugerido',
        passos: [
          'Do plano Assistente para cima: para cada item, o preço que dá a margem alvo sobre o custo atual.',
          'Compare com o preço de hoje e decida — a sugestão é conta, não ordem.',
          'Ajuste na ficha do produto (Produtos › editar).',
        ],
        capacidade: 'produto.preco',
        plano: 'precos.sugestao',
      },
    ],
    perguntas: [
      {
        p: 'Margem e markup são a mesma coisa?',
        r: 'Não. Numa peça que custa 60 e vende a 100, a margem é 40% (40 de 100) e o markup é 67% (40 sobre 60). A tela mostra os dois para você falar a língua do fornecedor e a do contador.',
      },
      {
        p: 'A tela aparece trancada. Por quê?',
        r: 'No plano Grátis a tela existe trancada, com o nome do plano que a abre e o botão "Ver os planos". Margem e markup são do Balcão para cima; o preço sugerido, do Assistente.',
      },
      {
        p: 'Não vejo Preços no menu.',
        r: 'A tela exige a permissão de mexer em preço: dono e gerente. Quem não pode mudar o preço não precisa ver o custo.',
      },
    ],
    palavras: ['precificação', 'precificar', 'margem', 'markup', 'lucro', 'preço sugerido', 'abaixo do custo', 'margem alvo', 'quanto cobrar', 'reajuste'],
  },

  // ── Clientes ──
  {
    chave: 'clientes',
    titulo: 'Clientes',
    caminho: '/clientes',
    abre: ['cliente.ver'],
    oQueE:
      'Quem compra: nome, WhatsApp, quanto gastou, quantas compras, há quanto tempo não vem, pontos e dívida no crediário. Filtros por quem some há 60+ dias, quem nunca comprou, cadastrados há 30 dias, aniversariantes do mês, com pontos, devendo. A ficha mostra as compras mês a mês, o que a pessoa mais leva, vales de troca, parcelas e o extrato de pontos.',
    comoFazer: [
      {
        titulo: 'Cadastrar um cliente',
        passos: [
          '"+ Novo cliente" — ou no próprio Balcão, com nome e WhatsApp, sem sair da venda.',
          'Só o nome é obrigatório. O WhatsApp é o que mais importa: é por ele que sai a mensagem de cobrança (você manda, pelo botão da ficha) e que o assistente fala, e é ele que impede a mesma pessoa de virar quatro cadastros.',
          'CPF só para nota fiscal e crediário; o sistema confere os dígitos. Endereço só se você entrega ou emite nota.',
          'Telefone já usado avisa quem já o tem e leva à ficha dela.',
          '"Observações" é o que a equipe precisa lembrar — o assistente também lê.',
        ],
        capacidade: 'cliente.editar',
      },
      {
        titulo: 'Achar quem sumiu e mandar mensagem',
        passos: [
          'Ficha "sumidos há 60+ dias": compraram e não voltam.',
          'Ordene por "quem mais gasta" ou "compra mais recente" — são as duas perguntas de quem vai mandar mensagem.',
          'Abra a ficha; o telefone no alto abre a conversa no WhatsApp.',
          '"aniversário em [mês]" e "com pontos" são os outros dois motivos de mensagem que a loja mais tem.',
        ],
        capacidade: 'cliente.ver',
      },
      {
        titulo: 'Ver e usar os pontos',
        passos: [
          'Na ficha, "Pontos": o saldo agora e o extrato — ganhou, usou, ajuste — com o saldo depois de cada linha.',
          'Usar é no Balcão: com o cliente escolhido e o mínimo alcançado, a oferta aparece sozinha.',
          'Ligar e desenhar o programa é em Configurações › Cliente junta pontos.',
        ],
        capacidade: 'cliente.ver',
      },
      {
        titulo: 'Cobrar o crediário pela ficha',
        passos: [
          'Na ficha, "Crediário · deve R$ X" lista as parcelas em aberto, com "atrasada" ou "em dia".',
          '"Cobrar pelo WhatsApp" abre a mensagem pronta com as parcelas vencidas.',
          'Receber é na tela Crediário — o link está embaixo da lista.',
        ],
        capacidade: 'crediario.ver',
      },
      {
        titulo: 'Baixar a planilha',
        passos: [
          '"Planilha" no alto baixa a lista de clientes em CSV.',
          'Com uma busca aplicada, baixa só o resultado dela.',
          'A lista da tela mostra os 200 primeiros — para o resto, busque ou baixe a planilha.',
        ],
        capacidade: 'cliente.ver',
      },
    ],
    perguntas: [
      {
        p: 'Posso apagar um cliente?',
        r: 'Não se apaga: desmarque "Cliente ativo" no cadastro. Ele some da busca do balcão e continua no histórico de tudo que comprou.',
      },
      {
        p: 'Para que serve o aniversário?',
        r: 'Para a ficha "aniversário em [mês]" na lista — é a deixa para mandar um recado.',
      },
      {
        p: 'O que o assistente lê da ficha?',
        r: 'As observações ("o que a equipe precisa lembrar") e o histórico de compras — última compra, o que costuma levar, há quanto tempo sumiu.',
      },
    ],
    palavras: ['cadastro de cliente', 'cadastrar cliente', 'freguês', 'whatsapp', 'telefone', 'cpf', 'aniversário', 'aniversariante', 'pontos', 'fidelidade', 'sumido', 'sumiu', 'histórico de compras', 'planilha', 'contato'],
  },

  // ── Equipe ──
  {
    chave: 'equipe',
    titulo: 'Equipe',
    caminho: '/equipe',
    abre: ['equipe.ver'],
    oQueE:
      'Quem tem acesso, com que papel e em qual loja; os convites esperando; metas e comissão por vendedor (módulo Metas); e o desempenho em estrelas (plano Assistente para cima). Tirar o acesso não apaga a pessoa: a venda que ela fez e as linhas dela no livro continuam com o nome dela.',
    comoFazer: [
      {
        titulo: 'Convidar alguém',
        passos: [
          '"+ Convidar": e-mail, papel e loja (ou todas as lojas).',
          '"Criar convite". O link aparece UMA vez — copie agora e mande. O sistema guarda só o resumo dele; nem o suporte recupera.',
          'O link vale 7 dias e serve uma vez. A pessoa abre, escolhe a senha e entra já com o papel que você deu.',
          'Você só concede papéis que pode: o gerente convida balcão, na loja dele; só o dono cria dono, gerente, financeiro e contador, e só quem tem todas as lojas convida para "todas as lojas".',
          'Cadastrar gente é de graça em todo plano. O plano limita quantas ficam dentro ao mesmo tempo.',
        ],
        capacidade: 'equipe.gerir',
      },
      {
        titulo: 'Trocar papel, tirar e devolver acesso',
        passos: [
          'Na linha da pessoa, escolha o papel novo (ou "Sem acesso"). Ela precisará entrar de novo.',
          '"Tirar acesso" desativa a conta: ela sai do sistema na próxima tela que abrir. "Devolver" reativa.',
          'Ninguém muda o próprio acesso, e a empresa nunca fica sem dono — o sistema recusa.',
          'Mexer em alguém exige poder dar o acesso que ele tem: o gerente troca, tira e devolve o acesso do balcão da loja dele — não o de outro gerente, nem o da dona.',
          'Convite pendente que não serve mais: "Cancelar" em "Convites esperando".',
        ],
        capacidade: 'equipe.gerir',
      },
      {
        titulo: 'Os papéis e o que cada um pode',
        passos: [
          'Dono: tudo, em todas as lojas.',
          'Gerente: toca a operação da loja — vende, cancela, dá desconto acima do teto, opera o caixa, cadastra produto e preço, ajusta estoque, cadastra cliente, cobra e recebe crediário, gere equipe e tarefas, lê financeiro, relatório e auditoria. Não lança no financeiro, não configura a empresa nem o assistente.',
          'Balcão: vende, opera o caixa, vê produto e estoque, cadastra cliente, recebe parcela do crediário, vê o quadro e dá baixa nas próprias tarefas. Não mexe em preço, não vê financeiro nem painel.',
          'Financeiro: lança e vê o dinheiro, cobra e recebe crediário, vê vendas, caixa, relatório e auditoria. Não vende nem mexe em produto.',
          'Contador: só lê financeiro e relatório (painel, análise, fechamento).',
        ],
      },
      {
        titulo: 'Definir meta e comissão',
        passos: [
          'Com o módulo Metas e comissão ligado, a seção "Metas e comissão" abre no mês atual; as setas trocam o mês.',
          'Na linha da pessoa, digite a meta (R$) e a comissão (%) e "Salvar". A comissão vai de 0 a 50%.',
          'A própria meta ninguém define — é outra pessoa que define a sua. O gerente define a de quem ele poderia dar o acesso: gente da loja dele, e não outro gerente nem a dona.',
          'Mês sem linha herda a do mês anterior — a tela marca "meta herdada".',
          'O vendido é líquido de devolução. A comissão é a porcentagem sobre o líquido.',
          'A comissão não vira lançamento sozinha: no fechamento da folha, lance em Financeiro na categoria "Comissão".',
        ],
        capacidade: 'equipe.gerir',
      },
      {
        titulo: 'Ler o desempenho em estrelas',
        passos: [
          'De 0 a 5 estrelas por pessoa e por mês: 50% meta batida + 30% tarefas entregues no prazo + 20% dias presente.',
          'Quando falta um insumo (a pessoa não tem meta, ou não tem tarefa), os pesos são redistribuídos entre os que existem.',
          'Na Direção, a leitura é completa: tendência de 3 meses e comparação por loja.',
        ],
        plano: 'desempenho.basico',
      },
    ],
    perguntas: [
      {
        p: 'Perdi o link do convite. Como recupero?',
        r: 'Não recupera — o sistema guarda só o resumo dele. Cancele o convite em "Convites esperando" e crie outro para o mesmo e-mail.',
      },
      {
        p: 'Quantas pessoas posso cadastrar?',
        r: 'À vontade, em todo plano. O que o plano limita é quantas ficam dentro ao mesmo tempo — está em Assinatura.',
      },
      {
        p: 'Como escolho quem vendeu no balcão?',
        r: 'Com o módulo Metas ligado, o campo Vendedor (Alt+F) no Balcão lista quem pode vender na loja. É para esse nome que vai a meta e a comissão.',
      },
    ],
    palavras: ['funcionário', 'vendedor', 'colaborador', 'convite', 'convidar', 'acesso', 'papel', 'permissão', 'dono', 'gerente', 'balconista', 'contador', 'meta', 'comissão', 'desempenho', 'estrelas', 'demitir', 'desativar', 'usuário', 'login de funcionário'],
  },

  // ── Tarefas ──
  {
    chave: 'tarefas',
    titulo: 'Tarefas',
    caminho: '/tarefas',
    abre: ['tarefa.ver'],
    oQueE:
      'Quadros de tarefas por loja ou da empresa, com grupos ("Esta semana", "Este mês"…). Cada tarefa tem título, responsável, situação (A fazer / Em andamento / Parado / Feito), linha do tempo, prazo e prioridade em cinco estrelas. Quem só vê o quadro dá baixa nas próprias tarefas; criar quadro e atribuir tarefa é de quem gere.',
    comoFazer: [
      {
        titulo: 'Criar um quadro e a primeira tarefa',
        passos: [
          'Crie o quadro: da loja ou da empresa inteira. No Grátis é um quadro só; do Balcão para cima, vários.',
          'Dentro de um grupo, "+ Adicionar tarefa" no fim da lista.',
          'Título; e, do Balcão para cima, responsável, prazo e prioridade em 5 estrelas.',
          'A tarefa nasce em "A fazer".',
        ],
        capacidade: 'tarefa.gerir',
        plano: 'tarefas.quadro',
      },
      {
        titulo: 'Dar baixa e mudar a situação',
        passos: [
          'Clique na pílula colorida da situação para trocar: A fazer → Em andamento → Parado → Feito.',
          'Quem só vê o quadro muda só as próprias tarefas — as que têm o nome dela como responsável.',
          '"Minhas tarefas" filtra o que é seu.',
        ],
        capacidade: 'tarefa.ver',
        plano: 'tarefas.quadro',
      },
      {
        titulo: 'Usar um modelo pronto',
        passos: [
          'Do Assistente para cima: Abertura e fechamento da loja, Inventário do mês, Campanha, Chegada de mercadoria.',
          'O modelo cria o quadro com grupos e tarefas já escritos.',
          'Ajuste responsável e prazo nas tarefas e apague o que não se aplica.',
        ],
        capacidade: 'tarefa.gerir',
        plano: 'tarefas.modelos',
      },
      {
        titulo: 'Acompanhar a linha do tempo e a rede',
        passos: [
          'Do Assistente para cima, cada tarefa mostra a barra de progresso do início ao prazo.',
          'Na Direção, o quadro da rede inteira mostra as lojas lado a lado.',
          'Tarefa entregue no prazo entra no desempenho em estrelas da pessoa (tela Equipe).',
        ],
        plano: 'tarefas.linhaDoTempo',
      },
    ],
    perguntas: [
      {
        p: 'O que cabe no plano Grátis?',
        r: 'Um quadro e 30 tarefas em aberto, sem responsável, prazo nem prioridade. O Balcão abre vários quadros com responsável, prazo e prioridade; o Assistente traz a linha do tempo e os modelos; a Direção, o quadro da rede.',
      },
      {
        p: 'A balconista vê as tarefas?',
        r: 'Sim. O papel Balcão vê o quadro e dá baixa no que é dela — a lista de abertura da loja é trabalho de quem abre a loja. Criar tarefa para os outros é do gerente.',
      },
      {
        p: 'Tarefa entra no desempenho?',
        r: 'Sim: tarefas entregues no prazo pesam 30% das estrelas de cada pessoa, na tela Equipe.',
      },
    ],
    palavras: ['quadro', 'to-do', 'checklist', 'lista de abertura', 'afazeres', 'pendências', 'responsável', 'prazo', 'prioridade', 'kanban', 'modelo', 'inventário do mês', 'campanha', 'situação', 'feito'],
  },

  // ── Financeiro ──
  {
    chave: 'financeiro',
    titulo: 'Financeiro',
    caminho: '/financeiro',
    abre: ['financeiro.ver'],
    oQueE:
      'As contas a pagar (vencidas, hoje, próximos 15 dias), os lançamentos do mês com busca e filtros, e o resultado do mês — o DRE: receita das vendas, devoluções, custo da mercadoria vendida, despesas por grupo, taxas de maquininha e o que sobrou. Venda não vira lançamento: o DRE puxa direto das vendas. As contas que se repetem (aluguel, internet, contador) se cadastram uma vez e o lançamento de cada mês nasce sozinho. Fechar o mês, guiado, fica no botão do alto.',
    comoFazer: [
      {
        titulo: 'Lançar uma conta',
        passos: [
          '"+ Lançar conta". Escolha "Conta a pagar" (despesa) ou "Receita".',
          'O que é, categoria (é ela que decide a linha do resultado), valor, vencimento, fornecedor e de onde saiu (caixa da loja, conta do banco).',
          'Marque "Já foi pago" se o dinheiro já saiu. Sem isso, entra como conta a pagar.',
          '"Lançar". A conta aparece em "A vencer" e nos lançamentos do mês do vencimento.',
        ],
        capacidade: 'financeiro.lancar',
      },
      {
        titulo: 'Dar baixa numa conta',
        passos: [
          '"Paguei" na linha da conta — em "A vencer" ou na lista de lançamentos.',
          'A data do pagamento é hoje.',
          'As despesas contam no resultado pelo mês em que foram PAGAS, não pelo que venceu — é o que bate com o extrato.',
        ],
        capacidade: 'financeiro.lancar',
      },
      {
        titulo: 'Ler o resultado do mês (DRE)',
        passos: [
          'As setas ← → trocam o mês.',
          'Em cima: resultado (sobrou ou faltou) e margem. Abaixo, o demonstrativo linha a linha, com os itens de cada grupo.',
          'Compra de mercadoria fica FORA do resultado: comprar não é despesa — vira custo (CMV) quando a peça vende.',
          'As taxas de cartão e Pix são descontadas sozinhas, venda a venda, se estiverem escritas em Configurações.',
          '"Entrou × saiu" mostra os últimos 6 meses; "Para onde foi o dinheiro" fatia as saídas do mês.',
        ],
        capacidade: 'financeiro.ver',
      },
      {
        titulo: 'Achar um lançamento',
        passos: [
          'Busque por descrição, fornecedor ou número do documento.',
          'Fichas: em aberto ou pagos; só despesas ou só receitas; por categoria.',
          'O rodapé do cartão soma despesas e receitas do que está listado.',
        ],
        capacidade: 'financeiro.ver',
      },
      {
        titulo: 'Cadastrar uma conta que se repete',
        passos: [
          'Em "Contas que se repetem", "+ Conta que se repete".',
          'O que é, categoria, valor, dia do vencimento (31 em mês curto cai no último dia: 28 ou 29 em fevereiro, 30 em abril), fornecedor e, se tiver fim, "até quando".',
          '"Cadastrar". Ao abrir o Financeiro, o lançamento do mês e o do próximo nascem sozinhos, em aberto, marcados "↻ recorrente" — e aparecem em "A vencer" no tempo certo. Olhando um mês futuro, o daquele mês também aparece.',
          'Vencimento que já tinha passado no dia do cadastro não é criado: esse, se ainda não foi pago, lance à mão.',
          'Abrir a tela duas vezes não duplica nada: cada conta tem um lançamento por mês.',
        ],
        capacidade: 'financeiro.lancar',
      },
      {
        titulo: 'Mudar ou pausar uma conta que se repete',
        passos: [
          '"Mudar" na linha da conta: o aluguel subiu, o dia mudou.',
          'Salvar acerta também os lançamentos dela que ainda estão em aberto, de hoje em diante. O que já foi pago fica como está.',
          '"Pausar" para de gerar e tira de "A vencer" os lançamentos futuros em aberto dela; "Retomar" volta a gerar.',
          'Comissão da equipe (tela Equipe) se lança na categoria "Comissão", no mês em que pagar; a conta do fornecedor de mercadoria pode nascer na entrada de estoque (Estoque › Dar entrada).',
        ],
        capacidade: 'financeiro.lancar',
      },
    ],
    perguntas: [
      {
        p: 'Por que a venda não aparece nos lançamentos?',
        r: 'Receita de venda mora em Vendas, e o DRE puxa de lá. Lançar de novo dobraria o faturamento do mês.',
      },
      {
        p: 'O que é CMV?',
        r: 'Custo da mercadoria vendida: o custo de cada item na hora em que vendeu. É por isso que o custo na ficha do produto e na entrada de mercadoria importa — sem ele, o resultado sai maior do que é.',
      },
      {
        p: 'Quem pode lançar?',
        r: 'Dono e financeiro. Gerente e contador veem o financeiro, mas não lançam — nem cadastram conta recorrente. Os lançamentos das recorrentes nascem sozinhos para quem abre a tela.',
      },
      {
        p: 'O sinal de encomenda aparece aqui?',
        r: 'Sim, como receita paga no dia em que foi recebido, na categoria de outras receitas e com o código da encomenda (ENC-...). Não lance de novo; na entrega, só o que falta vira venda no Balcão.',
      },
    ],
    palavras: ['contas a pagar', 'despesa', 'receita', 'boleto', 'conta', 'lançamento', 'lançar', 'dar baixa', 'pagar', 'paguei', 'dre', 'resultado', 'lucro', 'prejuízo', 'cmv', 'taxa', 'fluxo de caixa', 'recorrente', 'recorrentes', 'conta fixa', 'todo mês', 'mensalidade', 'aluguel', 'internet', 'contador', 'salário', 'fornecedor'],
  },

  // ── Fechamento de mês ──
  {
    chave: 'fechamento',
    titulo: 'Fechamento do mês',
    caminho: '/financeiro/fechamento',
    abre: ['financeiro.ver'],
    oQueE:
      'A lista do que conferir antes de dar o mês por fechado — a que a contadora faria por telefone —, com o número de cada pendência e o link para onde se resolve: todo caixa fechado, gaveta batendo, contas pagas, taxa da maquininha no cálculo, fiado cobrado (se a loja usa crediário) e o resultado. Não tranca nada: lançamento atrasado continua entrando, e o número se refaz.',
    comoFazer: [
      {
        titulo: 'Fechar o mês',
        passos: [
          'Financeiro › "Fechar o mês". A tela abre no mês passado; as setas levam a outros. Mês que ainda não terminou não fecha.',
          'Leia as linhas de cima para baixo: verde é pronto, âmbar é "olhe", vermelho é "falta".',
          'Cada linha diz o número, por que importa, e leva para onde se resolve: Caixa, Financeiro, Configurações, Crediário.',
          'Com as linhas de cima resolvidas, o resultado embaixo é o número do mês.',
        ],
        capacidade: 'financeiro.ver',
      },
      {
        titulo: 'O que cada linha confere',
        passos: [
          'Caixas: nenhum turno do mês continua aberto. Caixa aberto não tem conferência de gaveta.',
          'Gaveta: a soma das diferenças dos turnos fechados. Até R$ 20 é troco (âmbar); acima pede conferência (vermelho).',
          'Contas: nenhuma conta vencida em aberto — juro e multa correm enquanto ficam.',
          'Taxa: se recebeu em cartão ou Pix, precisa ter taxa escrita em Configurações; sem ela o lucro sai maior do que foi.',
          'Fiado: parcelas vencidas, só para quem usa crediário.',
          'Resultado: negativo fica vermelho; mês sem venda fica âmbar.',
        ],
        capacidade: 'financeiro.ver',
      },
      {
        titulo: 'Ler o DRE do mês fechado',
        passos: [
          'A tabela embaixo é o mesmo demonstrativo do Financeiro, no mês escolhido.',
          'No alto: o resultado do mês, quantas conferências estão prontas e quanto deu de taxa de máquina.',
          '"Abrir o DRE" leva ao Financeiro, com os lançamentos daquele mês.',
        ],
        capacidade: 'financeiro.ver',
      },
    ],
    perguntas: [
      {
        p: 'Existe botão de "fechar" o mês?',
        r: 'Não, de propósito. A tela diz o que falta; não impede lançar uma nota atrasada. Trancar o mês viraria chamado de suporte no dia em que alguém precisasse.',
      },
      {
        p: 'Quem vê o fechamento?',
        r: 'Quem vê o financeiro — inclusive o contador, que é para quem a lista foi desenhada.',
      },
    ],
    palavras: ['fechar o mês', 'fechamento mensal', 'conferência do mês', 'contador', 'contabilidade', 'pendências do mês', 'checklist do mês', 'fim do mês', 'balancete'],
  },

  // ── Análise ──
  {
    chave: 'analise',
    titulo: 'Análise',
    caminho: '/analise',
    abre: ['relatorio.ver'],
    oQueE:
      'Três leituras que o Painel não dá, do plano Direção para cima: as lojas lado a lado (vendas, o que entrou, margem, ticket, sem saída); a curva ABC dos produtos; o dinheiro parado — estoque que não vende há 30 dias ou mais; e a escala dos turnos de caixa. Sem seletor de loja, de propósito: compara tudo que você pode ver.',
    comoFazer: [
      {
        titulo: 'Comparar as lojas',
        passos: [
          'Escolha o período no alto. A comparação segue a janela; o "sem saída" é o custo do que não vendeu nela.',
          'Tabela por loja: vendas, o que entrou, margem em R$ e em %, ticket e sem saída.',
          '"Quem vendeu mais" desenha as lojas em barras.',
          'Com uma loja só, não há o que comparar — a seção diz isso e espera a segunda.',
        ],
        capacidade: 'relatorio.ver',
        plano: 'REDE',
      },
      {
        titulo: 'Ler a curva ABC',
        passos: [
          'Os produtos ordenados pelo que trouxeram no período.',
          'A = os que formam os primeiros 80% do faturamento — nunca podem faltar. B = até 95%. C = a cauda: cada um sozinho não paga a prateleira que ocupa.',
          'Colunas: saiu (com a medida — quilo é quilo, peça é peça), entrou, margem, fatia e acumulado. Quem edita produto clica no nome para abrir a ficha; para os outros, o nome é só texto.',
          'Item avulso não entra: não tem produto e não se recompra. Mostra os 60 primeiros.',
        ],
        plano: 'REDE',
      },
      {
        titulo: 'Achar o dinheiro parado',
        passos: [
          'Peças com estoque que não vendem há 30 dias ou mais, a preço de custo.',
          '"Sem vender há 90+ dias" e "nunca vendeu" são as candidatas a promoção.',
          'Não segue o período de cima, de propósito: parado é característica do produto, não do recorte que você escolheu para ler.',
        ],
        plano: 'REDE',
      },
      {
        titulo: 'Turnos de caixa (a escala)',
        passos: [
          'É o que existe hoje de escala: os turnos de CAIXA, não um ponto eletrônico. Não há registro de entrada e saída de quem não abre o caixa; os dias em que cada pessoa entrou no sistema aparecem só na nota de Desempenho, em Equipe.',
          'Cada turno de caixa do período: quem abriu, a loja, quando, quanto tempo ficou, vendas, o que saiu e o que faltou ou sobrou na gaveta.',
          'Pede a permissão de ver o caixa além da de relatório — o contador lê o resultado e não vê quem abriu a gaveta.',
          'Diferença de R$ 20 ou mais fica vermelha.',
        ],
        capacidade: 'caixa.ver',
        plano: 'REDE',
      },
    ],
    perguntas: [
      {
        p: 'Meu plano não abre a Análise. E aí?',
        r: 'Ela é da Direção para cima. A tela explica as três leituras e leva a Assinatura para comparar planos.',
      },
      {
        p: 'A curva ABC é do período escolhido?',
        r: 'Sim, e a comparação entre lojas também. O dinheiro parado não: é sempre 30 dias sem venda.',
      },
    ],
    palavras: ['relatório', 'relatórios', 'comparar lojas', 'entre lojas', 'curva abc', 'abc', 'dinheiro parado', 'encalhado', 'escala', 'turnos', 'turno de caixa', 'direção', 'rede', 'filial'],
  },

  // ── Assistente ──
  {
    chave: 'agente',
    titulo: 'Assistente',
    caminho: '/agente',
    abre: ['agente.configurar'],
    oQueE:
      'O agente da loja: nome, jeito de falar, o manual (o que ele sabe de cor), os poderes (o que pode consultar e o que pode propor), os tetos (valor máximo de uma proposta, desconto máximo, gasto de IA por dia, mensagens por dia) e a chave de ligar. Em cima, o balanço do mês — o que ele trouxe contra o que custou — e as propostas esperando o seu sim. Módulo Agente, plano Assistente para cima: com o plano sem o assistente, ou com o módulo desligado, a tela diz só isso e o caminho — ligar em Configurações › O que sua empresa usa, ou trocar de plano em Assinatura.',
    comoFazer: [
      {
        titulo: 'Criar ou ajustar o assistente',
        passos: [
          'Nome (até 40 letras), primeira frase e "Como ele fala". Isso decide o JEITO dele, e só isso — texto nunca dá permissão.',
          'O manual da loja: horário, troca, formas de pagamento, e o que fazer quando não souber a resposta. Isto ele não descobre sozinho.',
          'Marque os poderes: Consultar não muda nada no sistema; Agir sempre monta uma proposta com o número e espera o seu sim.',
          'Até onde ele vai: valor máximo de uma proposta, desconto máximo (%), gasto de IA por dia (R$) e mensagens por dia. Esses números moram no banco; nenhuma mensagem muda.',
          '"Deixar funcionando" e "Salvar". Cada mudança de poder ou teto vai para o livro de auditoria com antes e depois.',
        ],
        capacidade: 'agente.configurar',
      },
      {
        titulo: 'Responder uma proposta',
        passos: [
          'Em "Esperando você", leia a frase — ela já tem o número dentro.',
          '"Não" ou "Confirmar", com o mesmo peso.',
          'Quem confirma precisa ter a permissão daquela ação; o teto é conferido de novo na hora do sim.',
          'Proposta vale 24 horas. Depois disso o estoque e o preço já são outros, e ele precisa propor de novo.',
        ],
        capacidade: 'agente.configurar',
      },
      {
        titulo: 'Ler o balanço e o gasto do dia',
        passos: [
          '"Trouxe de volta": a soma dos recibos. Hoje nasce recibo de UM jeito, e só com conta que dá para refazer: a reposição que ele propôs no aviso de "vai faltar" e alguém confirmou. Trinta dias depois do sim, conta-se o que aquela peça vendeu além do saldo que havia no aviso — limitado ao que foi pedido e ao que de fato entrou no estoque — e o recibo é a margem dessas vendas (preço cobrado menos custo). Sem entrada, sem venda além do saldo ou sem custo, não há recibo.',
          'Enquanto nada disso aconteceu, a tela mostra só o custo de IA e o crédito — sem "Trouxe de volta" em zero.',
          '"Custou de IA": só o que ele consumiu. A mensalidade paga o sistema inteiro e não entra aqui.',
          'Embaixo, quanto ele gastou hoje contra o teto do dia. Passou do teto, ele para de responder até amanhã.',
        ],
        capacidade: 'agente.configurar',
      },
      {
        titulo: 'O crédito de IA',
        passos: [
          'Vem no plano: R$ 100 por mês no Assistente, R$ 300 na Direção, combinado em contrato no Corporativo.',
          'Cada conversa desconta da carteira. Acabou, o assistente para até recarregar.',
          'Recarregar e ver o extrato é em Assinatura › Crédito do assistente.',
        ],
      },
    ],
    perguntas: [
      {
        p: 'O assistente já responde no WhatsApp?',
        r: 'O canal do WhatsApp ainda não está conectado — é o próximo passo, e depende de contratar o canal. A configuração feita aqui já vale para quando ele ligar.',
      },
      {
        p: 'Por que alguns poderes aparecem apagados?',
        r: '"em breve" é poder ainda não construído. "precisa do crediário" depende de ligar o módulo em Configurações.',
      },
      {
        p: 'Uma mensagem pode convencer o assistente a dar 90% de desconto?',
        r: 'Não. Os poderes são uma lista fechada, os tetos moram no banco e são conferidos no servidor depois da resposta, e toda ação que mexe em dinheiro, preço ou estoque vira proposta que uma pessoa confirma.',
      },
    ],
    palavras: ['assistente', 'agente', 'inteligência artificial', 'whatsapp', 'robô', 'bot', 'proposta', 'propostas', 'poderes', 'teto', 'crédito de ia', 'personalidade', 'manual da loja', 'chatbot'],
  },

  // ── Auditoria ──
  {
    chave: 'auditoria',
    titulo: 'Auditoria',
    caminho: '/auditoria',
    abre: ['auditoria.ver'],
    oQueE:
      'O livro de tudo que mexeu no sistema: quem fez, o que fez, quando, em qual loja, com valor e motivo — venda, caixa, produto, estoque, cliente, crediário, equipe, tarefas, empresa, plano, assistente e financeiro. Não se edita nem se apaga, nem por nós.',
    comoFazer: [
      {
        titulo: 'Achar quem fez algo',
        passos: [
          'Busque pelo nome de quem fez, pelo nome do alvo (produto, cliente) ou pelo motivo escrito.',
          'Fichas por assunto: vendas, caixa, produtos e estoque, clientes, equipe e acessos, tarefas, empresa.',
          'Período e loja no alto.',
          'O alvo que tem tela vira link: venda, produto, cliente, caixa, equipe.',
        ],
        capacidade: 'auditoria.ver',
      },
      {
        titulo: 'Ler o antes → depois',
        passos: [
          'Linhas de alteração mostram o que mudou em uma frase: preço antigo → novo, esperado → contado no fechamento.',
          'A coluna Valor traz o dinheiro da ação: venda, sangria, diferença de caixa, parcela recebida.',
          'O que o assistente propôs e alguém confirmou aparece com "assistente" embaixo do nome de quem confirmou.',
        ],
        capacidade: 'auditoria.ver',
      },
      {
        titulo: 'O que o suporte fez',
        passos: [
          'O acesso de suporte (nosso) é só leitura, com prazo e motivo obrigatórios.',
          'Tudo que ele fizer aparece aqui como qualquer pessoa — a tira "pessoas diferentes" conta ele também.',
          'Mostra os 500 mais recentes por consulta; aperte o período ou o filtro para o resto.',
        ],
        capacidade: 'auditoria.ver',
      },
    ],
    perguntas: [
      {
        p: 'Quem vê a auditoria?',
        r: 'Dono, gerente, financeiro e suporte. Balcão e contador não.',
      },
      {
        p: 'Dá para apagar uma linha errada?',
        r: 'Não. O banco recusa editar e apagar o livro, inclusive para nós. Se algo foi feito errado, o conserto entra como uma linha nova (cancelar a venda, corrigir o estoque com motivo).',
      },
    ],
    palavras: ['livro', 'histórico', 'quem fez', 'quem mexeu', 'registro', 'log', 'rastro', 'alteração', 'rastreabilidade', 'segurança'],
  },

  // ── Assinatura ──
  {
    chave: 'lojas',
    titulo: 'Lojas',
    caminho: '/lojas',
    abre: ['empresa.configurar'],
    oQueE:
      'As lojas da empresa: abrir uma nova com o ramo dela, editar nome, endereço, telefone, CNPJ e horário, marcar depósito, fechar e reabrir. Cada loja tem o próprio estoque, caixa e balcão. Em cima, quantas lojas o plano comporta e quantas estão abertas.',
    comoFazer: [
      {
        titulo: 'Abrir outra loja',
        passos: [
          'Em "Abrir outra loja", dê o nome e escolha o RAMO desta loja — pode ser diferente do da empresa (uma sorveteria numa empresa de roupa).',
          'Se for só estoque, marque "É um depósito": ele recebe e transfere mercadoria, mas não tem balcão.',
          'Endereço, contato e horário são opcionais; o assistente responde com o horário.',
          '"Abrir a loja". Ela nasce com as categorias e os eixos do ramo que ainda não existiam na empresa (ex.: Picolé, Massa, Açaí e o eixo Sabor), sem mexer no que já existe.',
          'Depois, na ficha de cada produto, diga em "Vendido em" se ele é vendido na loja nova.',
        ],
        capacidade: 'empresa.configurar',
      },
      {
        titulo: 'Editar os dados de uma loja',
        passos: [
          '"Editar" no cartão da loja.',
          'Mude o que precisar e "Salvar". Trocar o ramo acrescenta as categorias do ramo novo; nada do antigo é apagado.',
          'O "Nome no comprovante" é o que sai impresso para o cliente.',
        ],
        capacidade: 'empresa.configurar',
      },
      {
        titulo: 'Fechar e reabrir uma loja',
        passos: [
          '"Fechar a loja" no cartão. Ela some do balcão e dos seletores; vendas, estoque e caixa antigos continuam guardados.',
          'Não fecha com o caixa aberto — feche o caixa antes, para a gaveta ser conferida.',
          'A última loja aberta não fecha: a empresa precisa de pelo menos uma.',
          '"Reabrir" conta na cota do plano, igual a abrir uma nova.',
        ],
        capacidade: 'empresa.configurar',
      },
    ],
    perguntas: [
      {
        p: 'O plano não deixa abrir mais uma loja. E agora?',
        r: 'A tela diz quantas o plano comporta. Para abrir mais, troque de plano em Assinatura — ou feche uma loja que não usa mais.',
      },
      {
        p: 'Tenho uma loja de roupa e uma sorveteria. O balcão mistura os produtos?',
        r: 'Não, se cada produto disser onde é vendido: na ficha, em "Vendido em", deixe a camiseta só na loja de roupa e o sorvete só na sorveteria. O balcão de cada loja mostra só o que é dela, e o servidor recusa venda de produto de outra loja.',
      },
      {
        p: 'Posso ter duas empresas separadas, com CNPJ e financeiro diferentes?',
        r: 'Cada empresa no Norte tem o próprio endereço e os próprios dados, e nada é compartilhado entre elas. Lojas dentro da mesma empresa dividem o catálogo e o financeiro; empresas diferentes, não.',
      },
    ],
    palavras: ['loja', 'lojas', 'filial', 'unidade', 'depósito', 'abrir loja', 'nova loja', 'endereço', 'horário', 'ramo', 'nicho'],
  },
  {
    chave: 'assinatura',
    titulo: 'Assinatura',
    caminho: '/assinatura',
    abre: ['empresa.configurar', 'financeiro.ver'],
    oQueE:
      'O plano da empresa e o uso: lojas, pessoas cadastradas (à vontade), quantas podem estar dentro ao mesmo tempo (é isso que o plano limita), o crédito de IA e quanto dura. Recarga de crédito; trocar de plano vendo antes o preço, o que ganha, o que perde e o que impede; e a comparação item por item.',
    comoFazer: [
      {
        titulo: 'Entender vagas e cadastro',
        passos: [
          'Cadastrar gente é de graça em todo plano.',
          'O que se paga é quanta gente fica DENTRO ao mesmo tempo: Grátis 1, Balcão 3, Assistente 5, Direção e Corporativo sem limite. Plano cheio, a próxima pessoa espera uma vaga soltar — ainda não dá para comprar vaga avulsa pela tela; o caminho é subir de plano.',
          'Quem para 10 minutos sem mexer solta a vaga sozinho. A tela de entrar mostra quem está ocupando e há quanto tempo cada um parou.',
          'Cobrar por vaga, e não por conta, é o que evita senha emprestada — e senha emprestada faz o livro de auditoria mentir.',
        ],
      },
      {
        titulo: 'Trocar de plano',
        passos: [
          'Cada cartão mostra o preço, a diferença por mês, o que passa a ter e o que deixa de ter — antes do clique.',
          'Descer com mais lojas do que o plano de baixo aceita é recusado: feche lojas antes, na tela Lojas. Vaga a mais não impede, só aperta.',
          '"Mudar para este" ou "Voltar para este". Só quem configura a empresa troca.',
          'O Corporativo é fechado por conversa: "Falar com a gente" abre o WhatsApp do Norte.',
        ],
        capacidade: 'empresa.configurar',
      },
      {
        titulo: 'Recarregar crédito de IA',
        passos: [
          'Em "Crédito do assistente": saldo, gasto em 30 dias e quantos dias dura no seu ritmo. A barra compara com a cota do mês.',
          'Digite o valor em reais (ou um atalho: R$ 20, 50, 100, 200) e "Adicionar". Até R$ 5.000 por vez.',
          'A recarga entra no extrato com o seu nome. Enquanto o pagamento automático não existe, ela é lançada aqui.',
        ],
        capacidade: 'empresa.configurar',
      },
      {
        titulo: 'O que cada plano abre',
        passos: [
          'Grátis (R$ 0): 1 loja, 1 pessoa dentro, 300 vendas por mês (a partir da 301ª o balcão recusa até o mês virar). Balcão e caixa, produto com grade, estoque, cliente, financeiro com DRE, contas a pagar e recorrentes, fechamento de mês, 1 quadro de tarefas, relatório simples, auditoria.',
          'Balcão (R$ 100/mês): até 3 lojas, 3 dentro. Tudo do Grátis mais encomenda, programa de pontos, preços (margem e markup), vários quadros com responsável, prazo e prioridade, estoque e caixa por loja.',
          'Assistente (R$ 350/mês): até 5 lojas, 5 dentro. Tudo do Balcão mais o agente no WhatsApp com R$ 100 de crédito de IA, metas e comissão, desempenho básico, preço sugerido, linha do tempo e modelos de quadro.',
          'Direção (R$ 1.500/mês): lojas e pessoas sem limite. Tudo do Assistente mais crediário, análise (lojas, ABC, dinheiro parado, escala), previsão de ruptura, desempenho completo, quadro da rede, R$ 300 de crédito.',
          'Corporativo: sob consulta — a operação inteira com a gente junto, crédito no contrato.',
        ],
      },
    ],
    perguntas: [
      {
        p: 'O que perco ao descer de plano?',
        r: 'Os módulos que o plano de baixo não tem somem da tela (os dados ficam guardados) e as vagas apertam. O cartão diz "Deixa de ter" antes do clique.',
      },
      {
        p: 'Quem vê a Assinatura?',
        r: 'Quem configura a empresa e quem vê o financeiro. Só quem configura troca de plano e recarrega.',
      },
      {
        p: 'O período de teste acabou. E agora?',
        r: 'Os avisos no alto da tela dizem quantos dias faltam e quando passou. Com a assinatura suspensa, ninguém da empresa entra até regularizar.',
      },
    ],
    palavras: ['plano', 'planos', 'mensalidade', 'preço do sistema', 'upgrade', 'trocar de plano', 'vagas', 'limite', 'crédito', 'recarga', 'recarregar', 'teste', 'grátis', 'direção', 'corporativo', 'pagamento do norte', 'quanto custa'],
  },

  // ── Configurações ──
  {
    chave: 'configuracoes',
    titulo: 'Configurações',
    caminho: '/configuracoes',
    abre: ['empresa.configurar'],
    oQueE:
      'O que a empresa usa: os módulos (crediário, nota fiscal, mais de uma unidade, agente no WhatsApp, metas e comissão, encomenda) e o jeito de vender no balcão (botões ou etiqueta); o programa de pontos; as taxas de maquininha e Pix; as regras do crediário; e os dados da empresa. Só quem configura a empresa mexe.',
    comoFazer: [
      {
        titulo: 'Ligar e desligar módulos',
        passos: [
          'Em "O que sua empresa usa", marque o que vale e "Salvar".',
          'Desligar não apaga nada: os dados continuam guardados, só somem da tela, do menu e do que o assistente sabe fazer.',
          'Módulo que o plano não inclui não liga — veja Assinatura.',
          '"Vender tocando em botões" troca o balcão entre a grade de botões por categoria e a busca por etiqueta. O ramo escolheu o padrão; aqui você desdiz.',
        ],
        capacidade: 'empresa.configurar',
      },
      {
        titulo: 'Programa de pontos',
        passos: [
          'É do plano Balcão para cima: no Grátis, ligar é recusado.',
          'Ligue "Cliente junta pontos comprando".',
          'Pontos por R$ 1, quanto vale 1 ponto (em reais), e o mínimo para usar.',
          'A tela mostra na hora quanto isso devolve: em % e em reais sobre o faturamento do último mês. Acima de 5% costuma passar da margem de roupa; acima de 50% o sistema recusa.',
          '"Salvar". Mudar o valor do ponto não mexe no saldo de ninguém — muda o que ele passa a valer daqui para frente.',
        ],
        capacidade: 'empresa.configurar',
      },
      {
        titulo: 'Taxas da maquininha e do Pix',
        passos: [
          'Quatro números, em % por venda: Pix, cartão de débito, crédito à vista, crédito parcelado (2× ou mais).',
          '"Salvar". O resultado do mês passa a descontar as taxas sozinho, venda a venda, na linha Financeiras do DRE.',
          'Se você lança a taxa à mão pelo extrato da maquininha, deixe tudo em zero — senão conta duas vezes.',
          'A tela diz quanto as taxas de hoje já custaram no mês corrente.',
        ],
        capacidade: 'empresa.configurar',
      },
      {
        titulo: 'Regras do crediário',
        passos: [
          'Aparece com o módulo Crediário ligado.',
          'Juro de atraso ao mês (só sobre parcela vencida), em até quantas vezes, e dias entre as parcelas.',
          '"Salvar". Vale para as vendas daqui para frente.',
        ],
        capacidade: 'empresa.configurar',
      },
      {
        titulo: 'Dados da empresa',
        passos: [
          'O cartão mostra nome, razão social, CNPJ, inscrição estadual, regime, telefone, WhatsApp, e-mail e o nome do assistente — campo em branco aparece como pendência.',
          'Esses dados foram preenchidos no cadastro inicial (Começar).',
          'Dados de conta bancária, maquininha e certificado digital não ficam aqui: terão tela própria, com registro de quem mexeu.',
        ],
        capacidade: 'empresa.configurar',
      },
    ],
    perguntas: [
      {
        p: 'Desligar um módulo apaga os dados?',
        r: 'Não. Continuam guardados; a tela, o item do menu e os poderes do assistente que dependem dele somem até você ligar de novo.',
      },
      {
        p: 'Mudar o valor do ponto muda o saldo dos clientes?',
        r: 'Não. Muda só o que cada ponto passa a valer nas próximas vendas.',
      },
      {
        p: 'Onde mudo o nome que aparece na tela?',
        r: 'Ele foi definido no cadastro inicial. Hoje não há campo de edição em Configurações — os dados da empresa aparecem para leitura; fale com o suporte para alterar.',
      },
    ],
    palavras: ['ajustes', 'módulos', 'ligar módulo', 'desligar módulo', 'pontos', 'fidelidade', 'taxa da maquininha', 'maquininha', 'pix', 'cartão', 'crediário', 'juros', 'dados da empresa', 'cnpj', 'grade de botões', 'preferências', 'nota fiscal'],
  },

  // ── Começar ──
  {
    chave: 'comecar',
    titulo: 'Começar',
    caminho: '/comecar',
    abre: ['empresa.configurar'],
    oQueE:
      'O cadastro inicial, no primeiro acesso: nome da empresa, razão social, CNPJ, regime, ramo (que prepara eixos de variação, categorias, medida e o manual do assistente), contato, a primeira unidade, como você trabalha, os módulos e o nome do assistente. Leva dois minutos, e tudo muda depois em Configurações.',
    comoFazer: [
      {
        titulo: 'Terminar o cadastro',
        passos: [
          'Só quem configura a empresa vê o formulário; os outros veem "a empresa ainda está sendo configurada".',
          'Preencha o nome que aparece na tela. O resto é opcional — dá para voltar depois.',
          'Escolha o ramo: ele sugere módulos, cria os eixos (Tamanho, Cor, Numeração, Sabor…) e as categorias, e define se o balcão vende por botão ou por etiqueta.',
          'Marque os módulos que a empresa usa. O que ficar desmarcado não aparece no sistema, e liga depois em Configurações.',
          'Com o módulo do agente marcado, dê um nome ao assistente e escolha a cor da marca.',
          '"Começar a usar".',
          'Entrou com a conta errada? "Sair", no alto da tela, volta para a tela de entrar.',
        ],
        capacidade: 'empresa.configurar',
      },
      {
        titulo: 'O que o ramo prepara',
        passos: [
          'Roupas e acessórios: eixos Tamanho e Cor, categorias como Blusas e Calças, balcão por etiqueta, sugere crediário e metas.',
          'Calçados: eixo Numeração, medida em par. Bijuteria: eixo Cor.',
          'Sorveteria e açaí, lanchonete, padaria, mercearia, floricultura, serviço: balcão por botões, e a medida que o ramo usa (quilo, unidade).',
          'Pet shop, papelaria, brinquedos, autopeças, construção, distribuidora: categorias prontas e o manual do assistente com o que NÃO fazer no ramo.',
          '"Outro" começa vazio. Nada disso é caminho no código: é só o que a empresa encontra pronto no primeiro dia.',
        ],
      },
      {
        titulo: 'Depois do cadastro',
        passos: [
          'Cadastre os primeiros produtos em Produtos e dê entrada no estoque.',
          'Abra o caixa no Balcão e venda.',
          'Convide a equipe em Equipe — cada pessoa com o papel dela.',
          'Ajuste módulos, pontos e taxas em Configurações quando precisar.',
        ],
      },
    ],
    perguntas: [
      {
        p: 'Posso refazer o cadastro inicial?',
        r: 'Não. Depois de configurada, a tela Começar leva a Configurações — é lá que se muda módulos, pontos, taxas e crediário.',
      },
      {
        p: 'Entrei e vi "a empresa ainda está sendo configurada".',
        r: 'Quem configura a empresa ainda não terminou o cadastro inicial. Assim que terminar, o seu acesso aparece.',
      },
    ],
    palavras: ['primeiro acesso', 'cadastro inicial', 'onboarding', 'ramo', 'começar', 'configurar a empresa', 'setup', 'implantação', 'início'],
  },

  // ── Entrar, sair, tela trancada e tema ──
  {
    chave: 'entrar',
    titulo: 'Entrar, sair e a tela trancada',
    caminho: '/entrar',
    oQueE:
      'Cada empresa entra pelo próprio endereço, com e-mail e senha. O plano limita quantas pessoas ficam dentro ao mesmo tempo, e a vaga solta com 10 minutos parada. Trinta minutos sem mexer, a tela tranca e pede a senha de novo — sem perder a venda em andamento. Quem só vende entra direto no Balcão; os outros, no Painel. "Sair" fica no rodapé do menu; o tema claro/escuro, no alto da tela.',
    comoFazer: [
      {
        titulo: 'Entrar',
        passos: [
          'Abra o endereço da empresa (/nome-da-empresa) e digite e-mail e senha.',
          'E-mail ou senha errados dão o mesmo recado, de propósito. Errou muitas vezes seguidas, espere alguns minutos.',
          'Quem só vende (sem acesso ao painel) cai direto no Balcão; os outros, no Painel.',
          'A sessão dura 12 horas, ou até alguém mexer no seu acesso (trocar papel, tirar acesso): aí a sessão morre na próxima tela.',
        ],
      },
      {
        titulo: 'Quando o plano está cheio',
        passos: [
          'A tela diz "a senha está certa, mas o plano está cheio agora" e lista quem está dentro e há quanto tempo cada um parou.',
          'Peça para alguém sair — ou espere: 10 minutos sem mexer soltam a vaga, e aí é só entrar de novo.',
          'Cabe mais gente ao mesmo tempo? É em Assinatura.',
        ],
      },
      {
        titulo: 'A tela trancou',
        passos: [
          'Trinta minutos sem mexer, aparece o aviso "A tela vai trancar em Ns" por um minuto. Qualquer toque cancela.',
          'Trancou: digite a sua senha em "Destrancar". O que estava aberto continua onde estava — inclusive a venda no balcão.',
          'Cinco senhas erradas seguidas: o sistema sai sozinho.',
          '"Não sou eu" sai para outra pessoa entrar.',
        ],
      },
      {
        titulo: 'Sair e trocar o tema',
        passos: [
          '"Sair" fica no rodapé do menu — a barra lateral no computador, o menu ☰ no celular. Sair devolve a vaga na hora.',
          'Tema: ☀ claro ou ☾ escuro, na chave do alto da tela, ao lado de "Simples | Avançado". O padrão é o claro.',
          'A escolha vale por um ano neste navegador, e a página já abre na cor certa.',
        ],
      },
    ],
    perguntas: [
      {
        p: 'Esqueci a senha.',
        r: 'Ainda não há "esqueci a senha" na tela. Fale com quem responde pela empresa ou com o suporte do Norte.',
      },
      {
        p: 'Fui derrubado do sistema do nada. Por quê?',
        r: 'Ou a sessão de 12 horas venceu, ou alguém mexeu no seu acesso (papel, loja, desativação) — a sessão morre na próxima tela. Ou a tela trancou por 30 minutos parada. Em todos os casos, é só entrar de novo.',
      },
      {
        p: 'O sistema abre claro de dia e escuro de noite sozinho?',
        r: 'Não. O tema é sempre uma escolha: claro (o padrão) ou escuro, na chave do alto da tela. Não segue o computador nem o celular.',
      },
    ],
    palavras: ['login', 'logar', 'senha', 'sair', 'logout', 'tela trancada', 'trancou', 'bloqueou', 'destrancar', 'tema', 'escuro', 'claro', 'modo noturno', 'sessão', 'vaga', 'plano cheio', 'esqueci a senha', 'acesso'],
  },
]

// ─────────────────────────────────────────────────────────────
// A TELA ATUAL
// ─────────────────────────────────────────────────────────────

/**
 * A entrada da tela em que a pessoa está, pelo caminho sem o slug.
 *
 * Casa o prefixo mais longo por segmento: '/financeiro/fechamento' acha o
 * fechamento, '/financeiro/qualquer-coisa' acha o financeiro,
 * '/produtos/abc/etiquetas' acha produtos. '' e '/' são o painel — e só
 * eles: caminho desconhecido devolve nada, em vez de fingir que é o painel.
 */
export function entradaDaTela(caminhoSemSlug: string): Entrada | undefined {
  const c = caminhoSemSlug.replace(/\/+$/, '')
  let melhor: Entrada | undefined
  for (const e of GUIA) {
    const casa = e.caminho === '' ? c === '' : c === e.caminho || c.startsWith(`${e.caminho}/`)
    if (casa && (!melhor || e.caminho.length > melhor.caminho.length)) melhor = e
  }
  return melhor
}

// ─────────────────────────────────────────────────────────────
// A BUSCA
// ─────────────────────────────────────────────────────────────

/** Sem acento, caixa baixa. "Crediário" e "crediario" são a mesma coisa. */
export const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// As palavras que a pergunta traz e não dizem nada sobre a resposta. Já sem
// acento, porque a comparação acontece depois de normalizar.
const VAZIAS = new Set([
  'de', 'do', 'da', 'dos', 'das', 'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'e', 'ou', 'em', 'no', 'na', 'nos', 'nas', 'com', 'sem', 'por', 'para', 'pra', 'pro',
  'que', 'como', 'onde', 'qual', 'quais', 'quando', 'quem',
  'eu', 'voce', 'vc', 'ele', 'ela', 'me', 'mim', 'meu', 'minha', 'meus', 'minhas',
  'quero', 'queria', 'preciso', 'posso', 'consigo', 'gostaria', 'devo', 'tenho',
  'faz', 'fazer', 'faco', 'fazendo', 'feito',
  'se', 'ao', 'isso', 'isto', 'esse', 'essa', 'este', 'esta', 'aqui', 'ali', 'la',
  'ser', 'ter', 'tem', 'esta', 'estou', 'sao', 'foi', 'ja', 'nao', 'sim', 'mais', 'muito',
  'dar', 'ver', 'saber', 'ajuda', 'favor',
])

/** As palavras que valem: normalizadas, com 3 letras ou mais, fora da lista de vazias. */
export function tokenizar(texto: string): string[] {
  const vistas = new Set<string>()
  for (const t of normalizar(texto).split(/[^a-z0-9]+/)) {
    if (t.length >= 3 && !VAZIAS.has(t)) vistas.add(t)
  }
  return [...vistas]
}

/**
 * A palavra da pergunta casa com o texto?
 *
 * Casa por pedaço: "produto" acha "produtos". E para palavra longa casa
 * também pela raiz de seis letras: "cadastrar" acha "cadastro", "devolver"
 * acha "devolução", "transferir" acha "transferência". Seis, e não cinco,
 * porque com cinco "crediário" achava "crédito".
 */
function casa(textoNormalizado: string, token: string): boolean {
  if (textoNormalizado.includes(token)) return true
  if (token.length >= 7) return textoNormalizado.includes(token.slice(0, 6))
  return false
}

export type ResultadoBusca = {
  entrada: Entrada
  /** Os como-fazer que casaram com a pergunta, os do título primeiro. */
  passos: Passo[]
  pontos: number
}

type Indexada = {
  entrada: Entrada
  titulo: string
  palavras: string[]
  titulosDosPassos: string[]
  corposDosPassos: string[]
  corpo: string
}

// O texto normalizado de cada entrada, uma vez só. Normalizar o manual
// inteiro a cada tecla digitada seria trabalho repetido no navegador.
let indice: Indexada[] | null = null

function indexar(): Indexada[] {
  if (indice) return indice
  indice = GUIA.map((e) => ({
    entrada: e,
    titulo: normalizar(e.titulo),
    palavras: e.palavras.map(normalizar),
    titulosDosPassos: e.comoFazer.map((c) => normalizar(c.titulo)),
    corposDosPassos: e.comoFazer.map((c) => normalizar(c.passos.join(' '))),
    corpo: normalizar(
      [e.oQueE, ...e.comoFazer.flatMap((c) => c.passos), ...e.perguntas.flatMap((q) => [q.p, q.r])].join(' '),
    ),
  }))
  return indice
}

/**
 * Quem está lendo o Guia: as capacidades que tem (em alguma loja) e os
 * módulos que a empresa ligou. Vem pronto do servidor — o Guia roda no
 * navegador e não tem a sessão.
 */
export type QuemLe = { capacidades: readonly Capacidade[]; modulos: readonly string[] }

/**
 * Esta pessoa abre esta tela? A régua é a da própria página. Pura.
 *
 * Sem isto, a busca da balconista por "planos" levava a Assinatura, e o
 * clique caía em "este endereço não abre" — ajuda que manda para uma parede.
 */
export function telaAbre(e: Pick<Entrada, 'abre' | 'modulo'>, quem: QuemLe): boolean {
  if (e.modulo && !quem.modulos.includes(e.modulo)) return false
  return !e.abre || e.abre.some((c) => quem.capacidades.includes(c))
}

/**
 * As cinco telas que melhor respondem à pergunta — só as que `quem` abre,
 * quando `quem` vem.
 *
 * Pontua por onde a palavra casou: título da tela e sinônimos valem 3,
 * título de um como-fazer vale 2, o corpo (passos e perguntas) vale 1 — uma
 * vez por palavra em cada lugar, para uma tela cheia de "venda" não ganhar
 * só por repetir. A tela em que a pessoa está ganha 2, se casou com algo:
 * quem pergunta "como corrijo o saldo" dentro do Estoque quer o Estoque.
 */
export function buscarNoGuia(pergunta: string, telaAtual?: string, quem?: QuemLe): ResultadoBusca[] {
  const tokens = tokenizar(pergunta)
  if (tokens.length === 0) return []
  const atual = telaAtual === undefined ? undefined : entradaDaTela(telaAtual)

  const resultados: ResultadoBusca[] = []
  for (const i of indexar()) {
    if (quem && !telaAbre(i.entrada, quem)) continue
    let pontos = 0
    const casadosNoTitulo = new Set<number>()
    const casadosNoCorpo = new Set<number>()

    for (const t of tokens) {
      if (casa(i.titulo, t)) pontos += 3
      if (i.palavras.some((p) => casa(p, t))) pontos += 3
      let noTitulo = false
      i.titulosDosPassos.forEach((tit, n) => {
        if (casa(tit, t)) {
          noTitulo = true
          casadosNoTitulo.add(n)
        }
      })
      if (noTitulo) pontos += 2
      i.corposDosPassos.forEach((corpo, n) => {
        if (casa(corpo, t)) casadosNoCorpo.add(n)
      })
      if (casa(i.corpo, t)) pontos += 1
    }

    if (pontos === 0) continue
    if (atual && atual.chave === i.entrada.chave) pontos += 2

    const ordem = [
      ...[...casadosNoTitulo].sort((a, b) => a - b),
      ...[...casadosNoCorpo].filter((n) => !casadosNoTitulo.has(n)).sort((a, b) => a - b),
    ]
    const passos = ordem.slice(0, 4).map((n) => i.entrada.comoFazer[n]!)

    resultados.push({ entrada: i.entrada, passos, pontos })
  }

  // Ordenação estável: empate fica na ordem do manual, que é a ordem do menu.
  return resultados.sort((a, b) => b.pontos - a.pontos).slice(0, 5)
}

// ─────────────────────────────────────────────────────────────
// O MANUAL EM TEXTO CORRIDO
// ─────────────────────────────────────────────────────────────

/**
 * O manual inteiro como texto, para virar contexto de IA.
 *
 * É o que a ação `perguntarAoGuiaAcao` manda como sistema quando há chave.
 * E é o mesmo texto que, no futuro, o agente do WhatsApp pode receber para
 * explicar o sistema a quem pergunta por lá — hoje não está ligado; fica
 * anotado para não nascer um segundo manual.
 */
export function manualComoTexto(): string {
  const partes: string[] = ['# Guia do Norte — o manual do sistema', '']
  for (const e of GUIA) {
    partes.push(`## ${e.titulo} (tela: ${e.caminho === '' ? 'início' : e.caminho})`)
    partes.push(e.oQueE)
    partes.push('', 'Como fazer:')
    for (const c of e.comoFazer) {
      const notas: string[] = []
      if (c.capacidade) notas.push(`quem pode: ${NOME_DA_CAPACIDADE[c.capacidade]}`)
      if (c.plano) notas.push(`plano: ${rotuloDoPlano(c.plano)}`)
      partes.push(`- ${c.titulo}${notas.length ? ` [${notas.join('; ')}]` : ''}`)
      c.passos.forEach((p, n) => partes.push(`  ${n + 1}. ${p}`))
    }
    partes.push('', 'Perguntas frequentes:')
    for (const q of e.perguntas) partes.push(`- P: ${q.p}`, `  R: ${q.r}`)
    partes.push('')
  }
  return partes.join('\n')
}
