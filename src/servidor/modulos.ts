// O que cada empresa usa.
//
// Quem não vende fiado não vê Crediário. Não é menu escondido: é o módulo
// desligado, e ele some do menu, dos relatórios e do que o agente sabe fazer.
// A chave para ligar depois mora em Configurações — some da vista de quem não
// usa, continua existindo para quando o negócio mudar.
//
// ── por que só seis ──────────────────────────────────────────
// Cada chave dobra as combinações possíveis do sistema. Com seis são 64
// configurações, que ainda dá para raciocinar. Com trinta seriam mais de um
// bilhão, e aí ninguém consegue afirmar que o sistema funciona — porque
// ninguém testou a combinação do cliente.
//
// Então módulo é GROSSO. Preferência miúda ("mostrar coluna de custo") é
// configuração de tela, não módulo.

export const MODULOS = {
  crediario: {
    titulo: 'Crediário',
    resumo: 'Vender fiado, com parcelas, juros de atraso e a lista de quem deve.',
    pergunta: 'Você vende fiado (crediário próprio)?',
  },
  notaFiscal: {
    titulo: 'Nota fiscal',
    // Em breve: depende do emissor contratado e do certificado A1 de cada loja
    // (ver `RECURSOS` em planos.ts). Até lá, ligar a chave não emite nada.
    resumo: 'Em breve: emitir NFC-e no balcão e NF-e.',
    pergunta: 'Você emite nota fiscal?',
  },
  multiUnidade: {
    titulo: 'Mais de uma unidade',
    resumo: 'Lojas, filiais e depósitos, cada um com seu estoque.',
    pergunta: 'Você tem mais de uma loja ou depósito?',
  },
  agente: {
    titulo: 'Agente no WhatsApp',
    resumo: 'Perguntar pelo WhatsApp e receber relatório sozinho.',
    pergunta: 'Quer um assistente atendendo pelo WhatsApp?',
  },
  metas: {
    titulo: 'Metas e comissão',
    resumo: 'Meta por vendedor, ranking e comissão.',
    pergunta: 'Você paga comissão ou acompanha meta de vendedor?',
  },
  encomenda: {
    titulo: 'Encomenda',
    resumo: 'Pedido que a pessoa retira ou recebe depois.',
    pergunta: 'Você trabalha com encomenda ou entrega?',
  },
} as const

export type Modulo = keyof typeof MODULOS

export const TODOS = Object.keys(MODULOS) as Modulo[]

/** Empresa desta requisição — só o que decide visibilidade. */
export type ComModulos = { modulos: string[] }

export function moduloLigado(empresa: ComModulos, modulo: Modulo): boolean {
  return empresa.modulos.includes(modulo)
}

/**
 * O que o ramo já deixa pronto.
 *
 * IMPORTANTE: o ramo escolhe o que é SEMEADO, nunca o caminho do código. Não
 * existe "tela de estoque de sorveteria" — existe uma tela de estoque que
 * mostra quilo porque o produto está em quilo, e mostra Sabor porque a empresa
 * criou o eixo Sabor. Se o ramo virasse um `if` no código, o primeiro cliente
 * misto (loja de roupa com cafeteria dentro) quebraria o sistema.
 *
 * Por isso tudo aqui é sugestão inicial, e o dono muda depois sem ficar preso.
 *
 * ── por que tantos ramos, e por que isso não custa caro ──────
 * Ramo novo é uma entrada nesta tabela. Não é deploy diferente, não é tela
 * nova, não é mais um caminho para testar. O que ele muda é o que a empresa
 * encontra pronto no primeiro dia — e é isso que separa "entrei e vi uma tela
 * vazia pedindo que eu imaginasse" de "entrei e já estava com a minha cara".
 *
 * ── o que cada campo faz ─────────────────────────────────────
 * `eixos`      as grades de variação (Cor, Numeração, Sabor)
 * `medida`     como o ramo costuma vender (UN, KG, PAR) — referência para a
 *              página de venda; o cadastro NÃO semeia isto, cada produto
 *              escolhe a sua medida
 * `sugere`     módulos já marcados no cadastro inicial — só os que o plano tem
 * `categorias` as gavetas do catálogo, criadas no cadastro inicial
 * `manual`     o manual que o assistente recebe, se ele for ligado no cadastro
 * `balcao`     'grade' = vende tocando em botões por categoria (quem não
 *              etiqueta: sorveteria, lanchonete, floricultura, serviço);
 *              'busca' = vende bipando a etiqueta (quem tem leitor e grade
 *              de tamanho/cor). É só o PADRÃO — o dono troca em Configurações.
 *
 * O `manual` é o campo mais fácil de escrever errado. Ele não é propaganda do
 * ramo: é o que evita a resposta errada. Por isso quase todo um deles termina
 * dizendo o que NÃO fazer — a autopeça que não deduz compatibilidade, o pet
 * shop que não indica remédio, a floricultura que não combina data sozinha.
 * O dono reescreve depois; o que está aqui é o que impede vexame no dia um.
 */
export const RAMOS = {
  roupa: {
    titulo: 'Roupas e acessórios',
    eixos: [
      { nome: 'Tamanho', ehCor: false, opcoes: ['PP', 'P', 'M', 'G', 'GG'] },
      { nome: 'Cor', ehCor: true, opcoes: ['Preto', 'Branco', 'Azul', 'Bege'] },
    ],
    medida: 'UN',
    sugere: ['crediario', 'metas'],
    balcao: 'busca' as const,
    categorias: ['Blusas', 'Calças', 'Vestidos', 'Jaquetas', 'Acessórios'],
    manual:
      'Peça é vendida por unidade e tem grade de tamanho e cor — quando perguntarem por uma peça, confira o tamanho E a cor antes de dizer que tem. ' +
      'Nunca prometa reserva sem confirmar com a loja. Troca segue a política da loja; se não souber qual é, diga que vai confirmar.',
  },
  calcados: {
    titulo: 'Calçados',
    eixos: [{ nome: 'Numeração', ehCor: false, opcoes: ['34', '35', '36', '37', '38', '39', '40'] }],
    medida: 'PAR',
    sugere: ['crediario', 'metas'],
    balcao: 'busca' as const,
    categorias: ['Tênis', 'Sandálias', 'Sapatos', 'Botas', 'Chinelos', 'Infantil'],
    manual:
      'Calçado é vendido por PAR e o que decide é a numeração: sempre pergunte o número antes de responder se tem. ' +
      'Número esgotado é a pergunta mais comum do dia — diga com clareza que acabou naquele número, e só ofereça o número vizinho se a loja trabalhar assim.',
  },
  bijuteria: {
    titulo: 'Bijuteria e acessórios',
    eixos: [{ nome: 'Cor', ehCor: true, opcoes: ['Dourado', 'Prateado', 'Rosé'] }],
    medida: 'UN',
    sugere: [],
    balcao: 'busca' as const,
    categorias: ['Brincos', 'Colares', 'Anéis', 'Pulseiras', 'Relógios'],
    manual:
      'Peça pequena, giro rápido e muita variação de cor: confira a cor antes de confirmar que tem. ' +
      'Se perguntarem se escurece ou se é antialérgico, responda o que estiver no cadastro do produto — e nada além disso.',
  },
  sorveteria: {
    titulo: 'Sorveteria e açaí',
    eixos: [{ nome: 'Sabor', ehCor: false, opcoes: [] }],
    medida: 'KG',
    sugere: ['encomenda'],
    balcao: 'grade' as const,
    categorias: ['Picolé', 'Massa', 'Açaí', 'Milk-shake', 'Complementos'],
    manual:
      'A venda sai por QUILO na maior parte dos casos, e o eixo que importa é o SABOR. ' +
      'Sabor que acabou é a pergunta do dia: responda direto e ofereça o que tem. ' +
      'Encomenda de bolo ou de pote grande precisa de prazo — nunca combine data sem a loja confirmar.',
  },
  lanchonete: {
    titulo: 'Lanchonete e cafeteria',
    eixos: [],
    medida: 'UN',
    sugere: ['encomenda'],
    balcao: 'grade' as const,
    categorias: ['Lanches', 'Porções', 'Bebidas', 'Cafés', 'Sobremesas'],
    manual:
      'O movimento é por horário: no pico, resposta curta vale mais que resposta completa. ' +
      'Pedido para retirada só existe com horário combinado. ' +
      'Nunca confirme item que saiu do cardápio — confira antes de responder.',
  },
  padaria: {
    titulo: 'Padaria e confeitaria',
    eixos: [],
    medida: 'KG',
    sugere: ['encomenda'],
    balcao: 'grade' as const,
    categorias: ['Pães', 'Bolos', 'Salgados', 'Frios e laticínios', 'Bebidas'],
    manual:
      'Boa parte sai por QUILO e é produção do dia: o que existe de manhã pode não existir à tarde. ' +
      'Encomenda de bolo é o pedido mais comum e o mais delicado — anote sabor, tamanho, data e hora, e nunca prometa prazo curto sem a loja confirmar.',
  },
  mercearia: {
    titulo: 'Mercearia e conveniência',
    eixos: [],
    medida: 'UN',
    sugere: ['notaFiscal'],
    balcao: 'busca' as const,
    categorias: ['Bebidas', 'Mercearia', 'Limpeza', 'Higiene', 'Frios', 'Hortifrúti'],
    manual:
      'Catálogo grande e giro rápido. A pergunta quase sempre é "tem?" e "quanto é?" — responda as duas de uma vez. ' +
      'Preço mudar aqui é normal: use sempre o preço do sistema, nunca um que tenha aparecido numa conversa anterior.',
  },
  petshop: {
    titulo: 'Pet shop',
    eixos: [{ nome: 'Porte', ehCor: false, opcoes: ['Filhote', 'Pequeno', 'Médio', 'Grande'] }],
    medida: 'UN',
    sugere: ['encomenda'],
    balcao: 'busca' as const,
    categorias: ['Ração', 'Petiscos', 'Higiene', 'Brinquedos', 'Acessórios', 'Medicamentos'],
    manual:
      'Ração é o carro-chefe, e o que muda tudo é o PORTE e a idade do animal — pergunte isso antes de indicar qualquer coisa. ' +
      'Cliente de pet shop volta em ciclo, quando o saco acaba. ' +
      'Nunca dê orientação veterinária nem indique medicamento: encaminhe para a loja ou para um veterinário.',
  },
  papelaria: {
    titulo: 'Papelaria',
    eixos: [],
    medida: 'UN',
    sugere: [],
    balcao: 'busca' as const,
    categorias: ['Escolar', 'Escritório', 'Arte', 'Papelaria criativa', 'Impressão'],
    manual:
      'Existe uma temporada que decide o ano: a lista de material escolar. Nessa época a pergunta chega por item de lista, e responder rápido o que tem vale mais do que responder tudo. ' +
      'Se a loja fizer impressão ou encadernação, prazo e preço saem do cadastro — não estime de cabeça.',
  },
  brinquedos: {
    titulo: 'Brinquedos',
    eixos: [{ nome: 'Faixa etária', ehCor: false, opcoes: ['0-2', '3-5', '6-8', '9-12', '12+'] }],
    medida: 'UN',
    sugere: ['encomenda'],
    balcao: 'busca' as const,
    categorias: ['Bebê', 'Educativos', 'Bonecas', 'Carrinhos', 'Jogos', 'Ar livre'],
    manual:
      'A pergunta quase nunca é o produto: é "para criança de tal idade, o que serve?". A FAIXA ETÁRIA é o eixo que importa — e ela também é segurança, então nunca indique brinquedo abaixo da idade recomendada.',
  },
  floricultura: {
    titulo: 'Floricultura',
    eixos: [],
    medida: 'UN',
    sugere: ['encomenda'],
    balcao: 'grade' as const,
    categorias: ['Buquês', 'Arranjos', 'Plantas', 'Vasos', 'Cestas', 'Coroas'],
    manual:
      'Quase tudo aqui é ENCOMENDA com data e hora — aniversário, casamento, velório — e a data é o que não pode falhar. ' +
      'Pergunte sempre: o que é, para quando, para onde e para quem. ' +
      'Assunto delicado pede resposta curta e respeitosa, e encaminhamento para a loja em vez de sugestão.',
  },
  autopecas: {
    titulo: 'Autopeças',
    eixos: [],
    medida: 'UN',
    sugere: [],
    balcao: 'busca' as const,
    categorias: ['Motor', 'Freios', 'Suspensão', 'Elétrica', 'Filtros', 'Óleos', 'Acessórios'],
    manual:
      'Peça errada aqui custa caro para os dois lados. Antes de dizer que tem, confirme MARCA, MODELO e ANO do carro — e o código da peça, se a loja usar. ' +
      'Na dúvida sobre compatibilidade, diga que vai confirmar. Nunca deduza.',
  },
  construcao: {
    titulo: 'Material de construção',
    eixos: [],
    medida: 'UN',
    sugere: ['notaFiscal', 'encomenda'],
    balcao: 'busca' as const,
    categorias: [
      'Cimento e argamassa',
      'Hidráulica',
      'Elétrica',
      'Tintas',
      'Ferramentas',
      'Acabamento',
    ],
    manual:
      'Aqui se vende por medida: metro, saco, litro, caixa. Diga sempre a UNIDADE junto do preço — "R$ 40" e "R$ 40 o saco" são conversas diferentes. ' +
      'Quantidade grande costuma pedir orçamento e entrega: passe para a loja em vez de fechar sozinho.',
  },
  distribuidora: {
    titulo: 'Distribuidora e atacado',
    eixos: [],
    medida: 'UN',
    sugere: ['notaFiscal', 'multiUnidade', 'crediario'],
    balcao: 'busca' as const,
    categorias: ['Bebidas', 'Alimentos', 'Descartáveis', 'Limpeza', 'Embalagens'],
    manual:
      'Quem compra aqui é revendedor, não consumidor final: fala em CAIXA e em FARDO, não em unidade. ' +
      'O preço costuma mudar por quantidade, então nunca cite preço de varejo. ' +
      'Pedido em aberto e prazo de entrega são as duas perguntas mais frequentes.',
  },
  servico: {
    titulo: 'Serviços',
    eixos: [],
    medida: 'UN',
    sugere: ['encomenda'],
    balcao: 'grade' as const,
    categorias: ['Serviços', 'Peças e materiais', 'Mão de obra'],
    manual:
      'O que se vende é tempo e trabalho, então PRAZO é a informação mais importante da conversa. ' +
      'Nunca combine data sem a loja confirmar a agenda, e nunca estime valor de serviço que não esteja cadastrado.',
  },
  outro: {
    titulo: 'Outro',
    eixos: [],
    medida: 'UN',
    sugere: [],
    balcao: 'busca' as const,
    categorias: [],
    manual:
      'Responda a partir do que estiver no sistema: catálogo, preço e saldo. ' +
      'Quando não souber, diga que vai confirmar com a loja — nunca invente informação sobre produto, prazo ou preço.',
  },
} as const

export type Ramo = keyof typeof RAMOS
