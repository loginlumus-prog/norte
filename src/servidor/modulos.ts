// O que cada empresa usa.
//
// Quem não vende fiado não vê Crediário. Não é menu escondido: é o módulo
// desligado, e ele some do menu, dos relatórios e do que o agente sabe fazer.
// A chave para ligar depois mora em Configurações — some da vista de quem não
// usa, continua existindo para quando o negócio mudar.
//
// ── por que só dez ───────────────────────────────────────────
// Cada chave dobra as combinações possíveis do sistema. Com seis eram 64
// configurações; com nove, 512; com dez, 1.024 — e isso já passa do teto do
// que dá para raciocinar. Com trinta seriam mais de um bilhão, e aí ninguém
// consegue afirmar que o sistema funciona — porque ninguém testou a
// combinação do cliente.
//
// Então módulo é GROSSO. Preferência miúda ("mostrar coluna de custo") é
// configuração de tela, não módulo.
//
// ── e por que os três últimos valeram a conta ────────────────
// Agenda, Funcionários e ponto, e Compras chegaram juntos, quando o Norte
// passou a atender quem vende SERVIÇO (salão, clínica, escola). Cada um é uma
// tela inteira com tabelas próprias — não um detalhe de outra tela —, e o
// comerciante que não precisa dele não deveria nem ver o nome: a loja de roupa
// não marca horário, a sorveteria de uma pessoa só não bate ponto.
//
// O que mantém as 512 combinações honestas é que os três quase não se tocam, e
// onde se tocam o desenho é de mão única:
//   • a Agenda usa a ficha de quem trabalha (o colaborador), que é da tela de
//     Funcionários — mas a ficha existe com o Ponto desligado, porque ela é a
//     lista de profissionais da agenda. Desligar o Ponto some com as horas,
//     não com as pessoas;
//   • Compras recebe mercadoria pelo MESMO caminho da entrada de mercadoria
//     (entrada.ts), que existe sem o módulo. Não há um segundo jeito de o
//     estoque subir;
//   • "Atender e cobrar" abre o balcão de sempre, com o serviço já lançado.
//     Não há um segundo jeito de o dinheiro entrar.
// Nenhum deles muda regra de venda, de estoque ou de dinheiro: acrescenta uma
// porta para a mesma regra. É isso que faz a chave desligada ser só menos
// tela, e não outro sistema.
//
// ── e a décima, a Escola ─────────────────────────────────────
// Turma, matrícula e mensalidade são tabelas próprias, e a mensalidade é um
// jeito de o dinheiro entrar que não é a venda do balcão — por isso é chave, e
// não detalhe da tela de alunos. A mão continua única onde importa: o aluno é
// a ficha de cliente de sempre (com a palavra "aluno"); a mensalidade em
// dinheiro entra pela MESMA gaveta do caixa aberto (como a parcela do
// crediário); e ela aparece no DRE numa linha dela, somada pela MESMA conta
// que faz o mês, o gráfico e o fechamento (financeiro.ts). Desligar a Escola
// some com as turmas e as mensalidades da vista; o dinheiro que já entrou
// continua no DRE, porque entrou.

import type { Plano } from '@prisma/client'

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
    titulo: 'Assistente no WhatsApp',
    resumo: 'Perguntar pelo WhatsApp, receber relatório sozinho e rodar campanhas para clientes.',
    pergunta: 'Quer um assistente no WhatsApp para você e a equipe?',
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
  agenda: {
    titulo: 'Agenda',
    resumo: 'Horário marcado por profissional, com falta, cancelamento e "atender e cobrar" no balcão.',
    pergunta: 'Você atende com horário marcado?',
  },
  ponto: {
    titulo: 'Funcionários e ponto',
    resumo: 'Entrada e saída de quem trabalha, com ou sem login, e as horas do mês. Controle interno.',
    pergunta: 'Quer anotar a entrada e a saída de quem trabalha?',
  },
  compras: {
    titulo: 'Compras e fornecedores',
    resumo: 'Pedido ao fornecedor, recebimento que dá entrada no estoque e o material usado no dia a dia.',
    pergunta: 'Você compra de fornecedor e usa material no atendimento?',
  },
  escola: {
    titulo: 'Alunos e mensalidades',
    resumo: 'Turmas, matrículas com o responsável, e a mensalidade de cada mês — gerada sozinha, com multa, juros e recibo.',
    pergunta: 'Você tem alunos matriculados que pagam mensalidade?',
  },
  // A décima primeira, e pelo mesmo motivo da Escola: tabelas próprias (ficha
  // técnica, ordem de produção, pedido das lojas) e um jeito de o estoque
  // andar que não é compra nem venda — o insumo vira produto. A mão continua
  // única: a produção dá entrada pela MESMA função de estoque de tudo
  // (estoque.ts), e o envio às lojas é a MESMA transferência entre unidades.
  fabrica: {
    titulo: 'Fábrica',
    resumo: 'Ficha técnica com custo, ordem de produção com lote e validade, e o pedido das lojas à fábrica.',
    pergunta: 'Você fabrica o que vende (sorvete, pão, doce) e abastece as suas lojas?',
  },
  // CONTRATADO À PARTE: o direcionamento digital, cobrado por marca e com
  // trabalho nosso junto. Não aparece entre as chaves que a empresa liga
  // sozinha (`ESCOLHIVEIS`); quem liga é a equipe do Norte, e trocar de plano
  // pago não o desliga.
  farol: {
    titulo: 'Farol',
    resumo: 'Direcionamento digital por marca: diagnóstico, calendário, roteiros, carrosséis, comentários, anúncios e campanhas no WhatsApp, escritos com IA.',
    pergunta: 'Você quer crescer nas redes com conteúdo feito para o seu nicho?',
    contratado: true,
  },
} as const

export type Modulo = keyof typeof MODULOS

export const TODOS = Object.keys(MODULOS) as Modulo[]

/** O módulo é contratado à parte (o Farol): a empresa não liga sozinha. */
export const ehContratado = (m: Modulo): boolean => 'contratado' in MODULOS[m]

/**
 * Módulo que ainda não faz nada: a chave aparece travada, com "Em breve". A
 * nota fiscal depende do emissor e do certificado de cada loja: marcar a
 * caixa não emitia nota nenhuma, e a pessoa achava que tinha ligado.
 */
export const EM_BREVE: readonly Modulo[] = ['notaFiscal']

/** As chaves que a empresa liga e desliga sozinha, em Configurações e no cadastro inicial. */
export const ESCOLHIVEIS = TODOS.filter((m) => !ehContratado(m))

/** Empresa desta requisição — só o que decide visibilidade. */
/** A empresa como os filtros a veem. Com o `plano`, o assistente básico do Essencial também filtra (ver `planoPermitePoder`). */
export type ComModulos = { modulos: string[]; plano?: Plano }

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
 * Como o negócio chama quem ele atende (cliente, paciente, aluno) não é campo
 * daqui: mora em vocabulario.ts, num lugar só, e muda a PALAVRA na tela — o
 * cadastro e a regra continuam os mesmos.
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
    sugere: [],
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
    // Banho e tosa é hora marcada (a Agenda) e gasta material que se compra
    // de fornecedor (Compras): o pet shop que só revende desliga os dois.
    sugere: ['encomenda', 'compras', 'agenda'],
    balcao: 'busca' as const,
    categorias: ['Ração', 'Petiscos', 'Higiene', 'Brinquedos', 'Acessórios', 'Medicamentos', 'Banho e tosa'],
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
    sugere: ['encomenda', 'crediario'],
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
    sugere: ['multiUnidade', 'crediario'],
    balcao: 'busca' as const,
    categorias: ['Bebidas', 'Alimentos', 'Descartáveis', 'Limpeza', 'Embalagens'],
    manual:
      'Quem compra aqui é revendedor, não consumidor final: fala em CAIXA e em FARDO, não em unidade. ' +
      'O preço costuma mudar por quantidade, então nunca cite preço de varejo. ' +
      'Pedido em aberto e prazo de entrega são as duas perguntas mais frequentes.',
  },
  beleza: {
    titulo: 'Salão, manicure e estética',
    // O eixo que importa no material é a COR do esmalte (e da tinta): é por
    // ela que o salão sabe o que acabou. Serviço não tem eixo — a manicure é
    // uma só, e o preço é o dela.
    eixos: [{ nome: 'Cor', ehCor: true, opcoes: ['Vermelho', 'Nude', 'Rosa', 'Branco', 'Preto'] }],
    medida: 'UN',
    sugere: ['agenda', 'compras'],
    balcao: 'grade' as const,
    // Sem uma gaveta "Serviços": o serviço do salão JÁ é Unhas, Cabelo ou
    // Estética. Com ela, a manicure ia para Unhas e "Serviços" ficava vazia —
    // uma aba a mais no balcão que não leva a nada.
    categorias: ['Unhas', 'Cabelo', 'Estética', 'Produtos para revenda', 'Material de uso'],
    manual:
      'Aqui se vende serviço com HORÁRIO MARCADO e alguns produtos. Horário só existe depois de conferido na agenda: nunca diga que tem vaga sem olhar, e nunca prometa uma profissional sem confirmar. ' +
      'Esmalte, tinta e material de uso são estoque da casa — o que acabou aparece no estoque, não na conversa. ' +
      'Não indique procedimento nem produto para alergia, irritação ou problema de pele: encaminhe para a profissional.',
  },
  saude: {
    titulo: 'Clínica e consultório',
    eixos: [],
    medida: 'UN',
    sugere: ['agenda', 'ponto', 'compras'],
    balcao: 'grade' as const,
    categorias: ['Consultas', 'Procedimentos', 'Exames', 'Insumos'],
    manual:
      'Aqui se atende PACIENTE com horário marcado. Você NUNCA dá orientação médica: não comenta sintoma, diagnóstico, exame, remédio ou dose — nem para a equipe, nem "só por curiosidade"; isso é com o profissional de saúde. ' +
      'Informação de saúde é dado sensível (LGPD): não peça, não repita e não anote informação clínica em nenhum campo do sistema — o Norte não guarda prontuário. ' +
      'Horário, profissional e valor saem da agenda e do catálogo; na dúvida, diga que a recepção confirma.',
  },
  escola: {
    titulo: 'Escola e cursos',
    eixos: [{ nome: 'Tamanho', ehCor: false, opcoes: ['4', '6', '8', '10', '12', '14', 'P', 'M', 'G'] }],
    medida: 'UN',
    sugere: ['escola', 'ponto', 'agente'],
    balcao: 'grade' as const,
    categorias: ['Material', 'Uniforme', 'Cursos livres'],
    manual:
      'Aqui quem estuda é ALUNO, e muitas vezes quem paga é outra pessoa — o responsável. Informação de aluno (nota, frequência, pagamento) só se fala com a equipe; nunca a repasse para quem não é da escola. ' +
      'Uniforme vai por TAMANHO: confira antes de dizer que tem. Valor de curso e de mensalidade sai do cadastro, nunca de cabeça.',
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

/**
 * As gavetas que o ramo semeia e que têm um JEITO próprio de estoque.
 *
 * `usoInterno` — material de uso, que não se vende: a acetona do salão, a
 * luva da clínica. `feitoNoDia` — o que se produz e se vende no mesmo dia (o
 * pão, a coxinha): zerado depois de fechar é o normal, não falta.
 *
 * É só o PADRÃO da ficha de produto: cadastrar um produto numa destas
 * gavetas já traz a caixa marcada, e a pessoa desmarca se quiser. A regra
 * mora no produto (`Produto.usoInterno`, `Produto.feitoNoDia`), nunca no nome
 * da gaveta — a gaveta renomeada não muda nada do que já foi cadastrado.
 */
export const GAVETAS_MARCADAS: Partial<Record<Ramo, { usoInterno?: readonly string[]; feitoNoDia?: readonly string[] }>> = {
  beleza: { usoInterno: ['Material de uso'] },
  saude: { usoInterno: ['Insumos'] },
  padaria: { feitoNoDia: ['Pães', 'Bolos', 'Salgados'] },
  lanchonete: { feitoNoDia: ['Lanches', 'Porções', 'Sobremesas'] },
}

const chaveDeGaveta = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/**
 * O padrão da ficha para uma gaveta, pelos ramos da empresa e das lojas dela.
 * Comparado sem acento nem caixa — "Material de Uso" é a mesma gaveta.
 */
export function marcasDaGaveta(ramos: readonly (string | null | undefined)[], nome: string): { usoInterno: boolean; feitoNoDia: boolean } {
  const k = chaveDeGaveta(nome)
  let usoInterno = false
  let feitoNoDia = false
  for (const r of ramos) {
    if (!r || !Object.hasOwn(GAVETAS_MARCADAS, r)) continue
    const g = GAVETAS_MARCADAS[r as Ramo]!
    if (g.usoInterno?.some((x) => chaveDeGaveta(x) === k)) usoInterno = true
    if (g.feitoNoDia?.some((x) => chaveDeGaveta(x) === k)) feitoNoDia = true
  }
  return { usoInterno, feitoNoDia }
}
