// As empresas de demonstração, uma por ramo.
//
//   npm run demonstracoes                    cria as que faltam (as que existem ficam como estão)
//   npm run demonstracoes -- --recriar       apaga e recria as de demonstração (só as demo-*)
//   npm run demonstracoes -- --so beleza     só uma delas (roupa, sorveteria, padaria, petshop, beleza, saude, escola)
//   npm run demonstracoes -- --producao      no banco hospedado (.env.producao), com confirmação digitada
//
// ── para que serve ───────────────────────────────────────────
// Quem vende o Norte precisa MOSTRAR que a loja de roupa, a sorveteria e a
// clínica entram no mesmo sistema e cada uma encontra a própria cara: o menu,
// o painel, o balcão e as palavras mudam com o ramo. Com uma empresa vazia
// isso não aparece — painel de zeros não convence ninguém. Aqui cada ramo
// ganha uma empresa com dois meses de movimento de verdade: vendas com o
// ritmo do ramo (a padaria de manhã cedo, a sorveteria à tarde e no fim de
// semana), devolução, cancelamento, crediário, agenda, ponto, compras,
// contas a pagar e o quadro de tarefas.
//
// ── como cada empresa nasce ──────────────────────────────────
// 1. O que o CADASTRO INICIAL faria (src/app/[empresa]/comecar/acoes.ts):
//    ramo, módulos sugeridos pelo ramo (só os que o plano abre), o balcão em
//    grade ou busca, as grades e as gavetas do catálogo — por `semearRamo`,
//    a mesma função da tela de Lojas.
// 2. O cadastro por cima, pelas MESMAS funções das telas: produto
//    (criarProduto), cliente com o aceite de ofertas (criarCliente), quem
//    trabalha (salvarColaborador), contas do financeiro (lancar), metas,
//    quadros, encomendas, horários da agenda, ponto, pedidos de compra.
// 3. O passado — sessenta dias de venda — por gravação direta, porque toda
//    função de venda carimba AGORA e o painel precisa de ontem, da semana
//    passada e do mês passado. Essa parte respeita as mesmas contas que o
//    sistema confere: cada venda baixa o estoque com o movimento que a
//    justifica (e o saldo final é a soma dos movimentos), cada turno de
//    caixa fecha com o esperado = abertura + dinheiro + recebido − sangria,
//    as parcelas do crediário somam o valor fiado, a devolução em dinheiro
//    sai da gaveta como sangria, o horário atendido aponta para a venda que
//    o cobrou. E grava com o papel da APLICAÇÃO, dentro da empresa (RLS e o
//    gatilho de chave entre empresas valendo), não com a credencial de admin.
// 4. Por último, uma venda de agora pelo `registrarVenda` de verdade, em cima
//    do que foi gravado: se o passado tivesse deixado estoque, caixa ou
//    numeração fora do lugar, é ali que quebraria.
//
// A credencial de ADMIN só entra para o que acontece fora de uma empresa:
// criar a empresa (ela ainda não existe) e apagar as de demonstração.
//
// ── as senhas ────────────────────────────────────────────────
// Cada pessoa ganha uma senha sorteada na hora. Ela não aparece na tela nem
// vai para o git: fica em .video/demonstracoes-senhas.txt (ou
// ...-producao.txt), que está no .gitignore. Na tela sai só o caminho.
//
// ── o que este script nunca faz ──────────────────────────────
// Não toca em empresa que não seja uma das demo-* daqui. O --recriar apaga
// pelo endereço exato de cada uma (demo-roupa, demo-sorveteria...), e ainda
// confere o prefixo antes de apagar.
//
// ── escola ───────────────────────────────────────────────────
// A escola tem um passo a mais, `escolaAoVivo`: turmas, alunos com o
// responsável, matrículas espalhadas nos últimos meses (com bolsa, trancada,
// cancelada e concluída) e as mensalidades — geradas pela mesma função da
// rotina e recebidas pela mesma função da secretaria, cada uma NA DATA em que
// foi paga, com o juro e a multa que a regra sugeria naquele dia.
//
// ── o que cada ramo mostra de coerente ───────────────────────
// O material de uso (a acetona, a luva) nasce marcado como tal pela gaveta do
// ramo e nunca é vendido; o que a padaria faz no dia nasce "feito no dia" e
// zera à noite sem virar "acabou"; e a equipe tem o telefone já confirmado,
// para o assistente reconhecer quem fala na demonstração.

import { createInterface } from 'node:readline/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { carregarAmbiente } from './ambiente'
import type { Catalogo, Dor, FormaPagamento, Medida, Papel, Plano, Porte, Regime, SituacaoAgendamento, SituacaoTarefa, TipoMovimento } from '@prisma/client'
import type { Sessao } from '../src/servidor/permissao'
import type { BancoDaOrg } from '../src/servidor/banco'
import type { Modulo, Ramo } from '../src/servidor/modulos'

// ── antes de tudo: onde estamos ──────────────────────────────
const pedeProducao = process.argv.includes('--producao')
if (pedeProducao && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
  console.error('\n  RECUSADO: --producao num ambiente de produção. Isto roda do laptop de quem opera.\n')
  process.exit(1)
}
const { producao, arquivo } = carregarAmbiente()

const { limparSegredos } = await import('../src/servidor/operacao')
// Toda saída passa pelo filtro: erro de driver traz a URL do banco com a senha.
for (const saida of [process.stdout, process.stderr]) {
  const escrever = saida.write.bind(saida) as (...a: unknown[]) => boolean
  saida.write = ((pedaco: unknown, ...resto: unknown[]) =>
    escrever(
      typeof pedaco === 'string'
        ? limparSegredos(pedaco, process.env)
        : Buffer.isBuffer(pedaco)
          ? limparSegredos(pedaco.toString('utf8'), process.env)
          : pedaco,
      ...resto,
    )) as typeof saida.write
}

const { PrismaClient } = await import('@prisma/client')
const { PrismaPg } = await import('@prisma/adapter-pg')
const { fechar } = await import('../src/servidor/banco')
const { RAMOS, marcasDaGaveta } = await import('../src/servidor/modulos')
const { planoLibera } = await import('../src/servidor/planos')
const { guardarSenha } = await import('../src/servidor/senha')
const { semearRamo } = await import('../src/servidor/lojas')
const { lerHorario } = await import('../src/servidor/campanhas/horario')
const { diaEmSP, somarDias, colunaDoDia, inicioDoDiaEmSP, primeiroDoMes, diaDaColuna } = await import('../src/servidor/dia')
const { centavos, reais, multiplicar } = await import('../src/servidor/dinheiro')
const { montarParcelas, diasDeAtraso, jurosDeAtraso } = await import('../src/servidor/crediario')
const { gerarCodigoDeVale, valorDevolvidoCent, VALE_DIAS } = await import('../src/servidor/devolucao')
const { criarProduto } = await import('../src/servidor/produto')
const { criarCliente } = await import('../src/servidor/cliente')
const { prepararFinanceiro, lancar } = await import('../src/servidor/financeiro')
const { salvarTaxas, taxaDe } = await import('../src/servidor/taxas')
const { salvarMeta } = await import('../src/servidor/metas')
const { criarQuadro, criarTarefa, criarDeModelo, moverTarefa } = await import('../src/servidor/tarefas')
const { criarEncomenda, mudarSituacao } = await import('../src/servidor/encomenda')
const { salvarColaborador, baterPonto, ajustarPonto } = await import('../src/servidor/ponto')
const { marcarHorario, mudarSituacaoAgenda } = await import('../src/servidor/agenda')
const { salvarFornecedor, criarPedido, enviarPedido, receberPedido, registrarConsumo } = await import('../src/servidor/compras')
const { registrarVenda } = await import('../src/servidor/venda')
const { chaveTelefone } = await import('../src/servidor/assistente/telefone')
const { salvarAgente } = await import('../src/servidor/agente')
const { criarTurma, matricular, mudarMatricula, salvarResponsavel } = await import('../src/servidor/escola')
const { salvarConfigMensalidade, gerarNaTransacao, listarMensalidades, receberMensalidade, dispensarMensalidade } = await import('../src/servidor/mensalidades')
const { comoOrg } = await import('../src/servidor/banco')
type Horario = import('../src/servidor/campanhas/horario').Horario

function argumento(nome: string) {
  const i = process.argv.indexOf(`--${nome}`)
  if (i === -1) return null
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : null
}

const recriar = process.argv.includes('--recriar')
const so = argumento('so')

const recusar = (motivo: string): never => {
  console.error(`\n  RECUSADO: ${motivo}\n`)
  process.exit(1)
}

// ─────────────────────────────────────────────────────────────
// AS DEFINIÇÕES — o que cada ramo tem de próprio
// ─────────────────────────────────────────────────────────────

/** Um item do catálogo, como o dono cadastraria. */
type ProdutoDemo = {
  nome: string
  categoria: string
  medida: Medida
  vista: number
  cartao?: number
  crediario?: number
  custo?: number
  marca?: string
  /** eixo → opções usadas. Na ordem das grades da empresa. */
  eixos?: Record<string, string[]>
  servico?: boolean
  duracaoMin?: number
  prazo?: number
  minimo?: number
  /** Quanto sai no balcão, relativo aos outros. Zero = não se vende (insumo). */
  peso: number
  /** Quantidade por venda: [mín, máx]. No quilo, em kg. */
  qtd?: [number, number]
  /** Feito no dia (padaria): entra de manhã como produção, a sobra sai à noite como perda. Vira `Produto.feitoNoDia`. */
  producao?: boolean
  /**
   * Material de uso (não vende). Sem isto, vale o padrão da gaveta do ramo
   * (`marcasDaGaveta`) — como a ficha de produto faz.
   */
  uso?: boolean
  /** Material de uso: quanto sai por semana, em unidades. */
  consumo?: number
  /** Variações (pelas opções, "M · Preto") que terminam zeradas / abaixo do mínimo. */
  acabou?: string[]
  pouco?: string[]
}

type LojaDemo = {
  nome: string
  endereco: string
  numero: string
  bairro: string
  cidade: string
  estado: string
  telefone: string
  horario: string
  /** Quanto do movimento é desta loja. */
  fatia: number
}

type PessoaDemo = { papel: Papel; nome: string; login: string; loja?: number }

/** A escola: turmas, alunos e a regra da mensalidade. */
type EscolaDemo = {
  regra: { multaPct: number; jurosMes: number; pontualidadePct: number; avisoDias: number; atrasoDias: number }
  turmas: {
    nome: string
    curso: string
    turno: 'manha' | 'tarde' | 'noite' | 'integral'
    professor: string
    dias: number[]
    de: string
    ate: string
    capacidade: number
    mensalidade: number
    vencimento: number
    /** Idade dos alunos: [mín, máx]. */
    idade: [number, number]
    /** Quantos alunos ocupam vaga (ativos + trancados). */
    alunos: number
  }[]
  /** Nomes dos alunos (o responsável sai de `responsaveis`, na mesma ordem). */
  alunos: string[]
  responsaveis: { nome: string; parentesco: string }[]
}

type DespesaDemo = {
  categoria: string
  descricao: string
  valor: number
  dia: number
  fornecedor?: string
  loja?: number
  /** A deste mês ainda não foi paga, e já venceu. */
  atrasa?: boolean
  /** Paga pelo caixa da loja, e não pelo banco. */
  caixa?: boolean
}

type TarefaDemo = {
  titulo: string
  grupo?: string
  situacao?: SituacaoTarefa
  prioridade?: number
  /** Dias a partir de hoje. */
  prazo?: number
  /** Quem responde: 'balcao', 'gerente', 'dono'. */
  quem?: 'balcao' | 'gerente' | 'dono'
  descricao?: string
}

type EncomendaDemo = {
  descricao: string
  valor: number
  sinal: number
  /** Dias a partir de hoje, e a hora. */
  dia: number
  hora: string
  entrega?: boolean
  endereco?: string
  cliente?: number
  pronta?: boolean
  /** Sai hoje, pelo balcão, com o que falta pagar (registrarVenda). */
  retiraHoje?: boolean
}

type ProfissionalDemo = {
  nome: string
  cargo: string
  servicos: string[]
  /** Dias da semana em que atende (0 = domingo) e a janela. Sem isso, o horário da loja. */
  dias?: number[]
  de?: string
  ate?: string
  /** Quanto da agenda costuma estar ocupado (0 a 1). */
  ocupacao?: number
  /** Bate ponto: minutos por dia da semana. */
  jornada?: number[]
  /** A ficha é da pessoa que tem login de balcão. */
  login?: 'balcao'
  atende?: boolean
}

type CompraDemo = {
  fornecedores: { nome: string; telefone: string; observacao?: string }[]
  /** Chegou hoje, com a conta a pagar lançada. */
  recebido: { fornecedor: number; itens: [produto: string, variacao: string | null, qtd: number][] }
  /** Chegou só uma parte. */
  parcial?: { fornecedor: number; itens: [produto: string, variacao: string | null, qtd: number, chegou: number][] }
  /** Mandado, esperando chegar. */
  aberto: { fornecedor: number; previsto: number; itens: [produto: string, variacao: string | null, qtd: number][] }
  /** O material usado hoje, lançado pela recepção (registrarConsumo). */
  consumoHoje: [produto: string, variacao: string | null, qtd: number][]
}

type Demo = {
  ramo: Ramo
  nome: string
  cor: string
  plano: Plano
  regime: Regime
  porte: Porte
  dor: Dor
  catalogo: Catalogo
  comoVende: string[]
  ddd: string
  lojas: LojaDemo[]
  pessoas: PessoaDemo[]
  /** Opções acrescentadas às grades do ramo (os sabores da sorveteria) e a cor de cada uma. */
  opcoes?: Record<string, { valor: string; hex?: string }[]>
  /** O quanto cada opção pesa na escolha (o M vende mais que o PP). */
  pesoOpcao?: Record<string, number>
  produtos: ProdutoDemo[]
  clientes: { nome: string; obs?: string }[]
  /** Vendas de balcão num dia comum, somadas as lojas. */
  vendasPorDia: number
  /** Fator de domingo (0) a sábado (6). */
  semana: number[]
  /** Peso de cada hora cheia. */
  horas: Record<number, number>
  formas: [FormaPagamento, number][]
  itens: [number, number]
  comCliente: number
  cancelamentos: number
  devolucoes: number
  /** Destinos da devolução, com peso. */
  destinos?: [('VALE' | 'DINHEIRO' | 'ESTORNO'), number][]
  /** Das vendas com cliente, quanto vai para o crediário (só com o módulo). */
  crediario?: number
  /** Venda com 5% de desconto à vista (roupa). */
  desconto?: number
  despesas: DespesaDemo[]
  taxas: { debito: number; credito: number; parcelado: number; pix: number }
  quadro: { nome: string; cor: string; grupos: string[]; tarefas: TarefaDemo[] }
  metas?: { quem: 'balcao' | 'gerente'; valor: number; comissao: number }[]
  encomendas?: EncomendaDemo[]
  profissionais?: ProfissionalDemo[]
  /** Agenda: vendas de produto sem horário, por dia. */
  avulsasPorDia?: number
  /** Chance de o atendimento levar um produto junto. */
  levaProduto?: number
  compras?: CompraDemo
  observacoesAgenda?: string[]
  /** Módulos no lugar dos sugeridos pelo ramo (o plano ainda filtra). */
  modulos?: Modulo[]
  /** Dias de passado. Padrão: 60. A escola mostra quatro meses de mensalidade. */
  dias?: number
  /** O assistente já configurado, com estes poderes (desligado até conectar o WhatsApp). */
  agente?: { poderes: string[] }
  escola?: EscolaDemo
}

const SEMANA_COMERCIO = [0, 0.85, 0.85, 0.9, 1, 1.2, 1.45]

function roupa(): Demo {
  return {
    ramo: 'roupa',
    nome: 'Varal da Vila Modas',
    cor: '#8A3B5C',
    plano: 'REDE',
    regime: 'SIMPLES',
    porte: 'ATE_5',
    dor: 'ESTOQUE',
    catalogo: 'ATE_500',
    comoVende: ['BALCAO', 'WHATSAPP', 'ONLINE'],
    ddd: '75',
    lojas: [
      { nome: 'Loja Rua Nova', endereco: 'Rua Nova', numero: '214', bairro: 'Centro', cidade: 'Feira de Santana', estado: 'BA', telefone: '7530000214', horario: 'Seg a sex 9h às 18h, sáb 9h às 14h', fatia: 1 },
      { nome: 'Quiosque Galeria Central', endereco: 'Avenida das Palmeiras', numero: '1500', bairro: 'Santa Mônica', cidade: 'Feira de Santana', estado: 'BA', telefone: '7530001500', horario: 'Seg a sáb 10h às 21h, dom 14h às 20h', fatia: 0.7 },
    ],
    pessoas: [
      { papel: 'DONO', nome: 'Marisa Lemos', login: 'dono' },
      { papel: 'BALCAO', nome: 'Tainá Oliveira', login: 'balcao', loja: 0 },
      { papel: 'GERENTE', nome: 'Rodrigo Brandão', login: 'gerente', loja: 1 },
    ],
    opcoes: {
      Cor: [
        { valor: 'Preto', hex: '#1B1B1B' },
        { valor: 'Branco', hex: '#F4F1EA' },
        { valor: 'Azul', hex: '#2B5C8A' },
        { valor: 'Bege', hex: '#D8C3A5' },
      ],
    },
    pesoOpcao: { PP: 0.4, P: 0.9, M: 1.5, G: 1.2, GG: 0.6, Preto: 1.3, Branco: 1, Azul: 1, Bege: 0.8 },
    produtos: [
      { nome: 'Blusa de viscose estampada', categoria: 'Blusas', medida: 'UN', vista: 89.9, cartao: 94.9, crediario: 99.9, custo: 36, eixos: { Tamanho: ['P', 'M', 'G', 'GG'], Cor: ['Preto', 'Branco'] }, peso: 5, minimo: 2, acabou: ['M · Preto'] },
      { nome: 'Camiseta básica de algodão', categoria: 'Blusas', medida: 'UN', vista: 39.9, cartao: 42.9, crediario: 44.9, custo: 15, eixos: { Tamanho: ['P', 'M', 'G', 'GG'], Cor: ['Preto', 'Branco', 'Azul'] }, peso: 8, qtd: [1, 2], minimo: 3, pouco: ['P · Branco'] },
      { nome: 'Calça jeans mom', categoria: 'Calças', medida: 'UN', vista: 159.9, cartao: 169.9, crediario: 179.9, custo: 64, eixos: { Tamanho: ['P', 'M', 'G', 'GG'], Cor: ['Azul'] }, peso: 4, minimo: 2, acabou: ['M · Azul'] },
      { nome: 'Calça de alfaiataria', categoria: 'Calças', medida: 'UN', vista: 139.9, cartao: 149.9, crediario: 154.9, custo: 55, eixos: { Tamanho: ['P', 'M', 'G'], Cor: ['Preto', 'Bege'] }, peso: 3, minimo: 1 },
      { nome: 'Vestido midi canelado', categoria: 'Vestidos', medida: 'UN', vista: 129.9, cartao: 139.9, crediario: 144.9, custo: 48, eixos: { Tamanho: ['P', 'M', 'G'], Cor: ['Preto', 'Bege'] }, peso: 4, minimo: 2, acabou: ['G · Preto'] },
      { nome: 'Vestido longo floral', categoria: 'Vestidos', medida: 'UN', vista: 169.9, cartao: 179.9, crediario: 189.9, custo: 66, eixos: { Tamanho: ['P', 'M', 'G'], Cor: ['Azul'] }, peso: 2.5, minimo: 1 },
      { nome: 'Jaqueta jeans', categoria: 'Jaquetas', medida: 'UN', vista: 199.9, cartao: 214.9, crediario: 224.9, custo: 82, eixos: { Tamanho: ['P', 'M', 'G'], Cor: ['Azul'] }, peso: 1.5, minimo: 1, pouco: ['P · Azul'] },
      { nome: 'Cardigã de tricô', categoria: 'Jaquetas', medida: 'UN', vista: 119.9, cartao: 127.9, crediario: 134.9, custo: 44, eixos: { Tamanho: ['M', 'G'], Cor: ['Bege', 'Preto'] }, peso: 2, minimo: 1 },
      { nome: 'Bolsa transversal', categoria: 'Acessórios', medida: 'UN', vista: 99.9, cartao: 104.9, crediario: 109.9, custo: 38, eixos: { Cor: ['Preto', 'Bege'] }, peso: 2, minimo: 1 },
      { nome: 'Cinto de couro sintético', categoria: 'Acessórios', medida: 'UN', vista: 49.9, cartao: 52.9, crediario: 54.9, custo: 17, eixos: { Cor: ['Preto', 'Bege'] }, peso: 2, minimo: 2 },
    ],
    clientes: [
      { nome: 'Marta Nascimento', obs: 'Veste M. Prefere ser avisada de peça nova pelo WhatsApp.' },
      { nome: 'Rita de Cássia Alves', obs: 'Sempre leva conjunto.' },
      { nome: 'Cleide Souza' }, { nome: 'Valquíria Ribeiro', obs: 'Só vem no fim do mês.' },
      { nome: 'Nina Barros' }, { nome: 'Josefa Andrade', obs: 'Compra para as netas.' },
      { nome: 'Silvana Matos' }, { nome: 'Joelma Pinto' }, { nome: 'Adriana Queiroz' },
      { nome: 'Luciana Teles', obs: 'Gosta de alfaiataria. Veste G.' }, { nome: 'Fernanda Rocha' },
      { nome: 'Patrícia Guimarães' }, { nome: 'Kelly Cristina Dias' }, { nome: 'Daiane Moura' },
      { nome: 'Sueli Fonseca' }, { nome: 'Carla Menezes' }, { nome: 'Vanessa Lima' },
      { nome: 'Tatiane Borges' }, { nome: 'Rosângela Cunha' }, { nome: 'Érica Santana' },
      { nome: 'Gabriela Pires' }, { nome: 'Mirela Castro' }, { nome: 'Andreia Freitas' },
      { nome: 'Jussara Costa' }, { nome: 'Lorena Batista' }, { nome: 'Priscila Aragão' },
      { nome: 'Helena Vasconcelos' }, { nome: 'Bianca Moreira' },
    ],
    vendasPorDia: 13,
    semana: [0.5, 0.8, 0.8, 0.9, 1, 1.25, 1.5],
    horas: { 9: 0.6, 10: 1, 11: 1.2, 12: 0.9, 13: 0.8, 14: 1, 15: 1.2, 16: 1.3, 17: 1.4, 18: 1.2, 19: 1.1, 20: 0.8 },
    formas: [['PIX', 4], ['CREDITO', 4], ['DEBITO', 2], ['DINHEIRO', 1.5]],
    itens: [1, 3],
    comCliente: 0.55,
    cancelamentos: 0.012,
    devolucoes: 0.03,
    destinos: [['VALE', 7], ['ESTORNO', 2], ['DINHEIRO', 1]],
    crediario: 0.1,
    desconto: 0.08,
    despesas: [
      { categoria: 'Aluguel', descricao: 'Aluguel da loja da Rua Nova', valor: 3200, dia: 5, fornecedor: 'Imobiliária Casa Forte', loja: 0 },
      { categoria: 'Aluguel', descricao: 'Aluguel do quiosque', valor: 4100, dia: 10, fornecedor: 'Galeria Central — administração', loja: 1 },
      { categoria: 'Luz, água e internet', descricao: 'Energia da loja', valor: 420, dia: 12, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Energia do quiosque', valor: 310, dia: 15, loja: 1 },
      { categoria: 'Luz, água e internet', descricao: 'Internet', valor: 129.9, dia: 20 },
      { categoria: 'Salários e encargos', descricao: 'Folha da equipe', valor: 7800, dia: 5 },
      { categoria: 'Pró-labore', descricao: 'Pró-labore', valor: 5000, dia: 5 },
      { categoria: 'Comissão', descricao: 'Comissão das vendedoras', valor: 1100, dia: 7 },
      { categoria: 'Contabilidade', descricao: 'Honorários contábeis', valor: 650, dia: 10, fornecedor: 'Escritório Contábil Aurora' },
      { categoria: 'Sistema e software', descricao: 'Mensalidade do Norte', valor: 1500, dia: 10 },
      { categoria: 'Compra de mercadoria', descricao: 'Reposição da coleção', valor: 14500, dia: 18, fornecedor: 'Confecções Serra Azul' },
      { categoria: 'Compra de mercadoria', descricao: 'Jeans — pedido do mês', valor: 6200, dia: 25, fornecedor: 'Jeans Rio Claro' },
      { categoria: 'Anúncio e divulgação', descricao: 'Impulsionamento das postagens', valor: 450, dia: 15 },
      { categoria: 'Embalagem e sacola', descricao: 'Sacolas e etiquetas', valor: 280, dia: 22, fornecedor: 'Gráfica Ponto Certo', atrasa: true },
      { categoria: 'Impostos sobre venda', descricao: 'Simples Nacional', valor: 2600, dia: 20 },
    ],
    taxas: { debito: 1.39, credito: 3.19, parcelado: 4.59, pix: 0 },
    quadro: {
      nome: 'Coleção de verão',
      cor: '#8A3B5C',
      grupos: ['Esta semana', 'Este mês', 'Próximo mês'],
      tarefas: [
        { titulo: 'Montar a vitrine da coleção de verão', grupo: 'Esta semana', situacao: 'EM_ANDAMENTO', prioridade: 4, prazo: 2, quem: 'balcao' },
        { titulo: 'Conferir a grade de jeans e pedir o M que acabou', grupo: 'Esta semana', prioridade: 5, prazo: 1, quem: 'gerente' },
        { titulo: 'Ligar para as clientes com parcela vencida', grupo: 'Esta semana', prioridade: 4, prazo: 0, quem: 'balcao' },
        { titulo: 'Fotografar as peças novas para o Instagram', grupo: 'Este mês', prioridade: 3, prazo: 5, quem: 'dono' },
        { titulo: 'Etiquetar a remessa da Serra Azul', grupo: 'Esta semana', situacao: 'FEITO', prioridade: 3, prazo: -2, quem: 'balcao' },
        { titulo: 'Trocar o manequim quebrado do quiosque', grupo: 'Este mês', situacao: 'PARADO', prioridade: 2, prazo: 7, quem: 'gerente', descricao: 'Esperando o fornecedor mandar o orçamento.' },
        { titulo: 'Planejar a liquidação de inverno', grupo: 'Próximo mês', prioridade: 2, prazo: 25, quem: 'dono' },
      ],
    },
    metas: [
      { quem: 'balcao', valor: 22000, comissao: 3 },
      { quem: 'gerente', valor: 16000, comissao: 2.5 },
    ],
  }
}

function sorveteria(): Demo {
  return {
    ramo: 'sorveteria',
    nome: 'Sorveteria Brisa do Mar',
    cor: '#0E7C86',
    plano: 'REDE',
    regime: 'SIMPLES',
    porte: 'ATE_5',
    dor: 'LUCRO',
    catalogo: 'ATE_50',
    comoVende: ['BALCAO', 'ENTREGA', 'WHATSAPP'],
    ddd: '71',
    lojas: [
      { nome: 'Sorveteria Brisa do Mar', endereco: 'Rua das Gaivotas', numero: '37', bairro: 'Rio Vermelho', cidade: 'Salvador', estado: 'BA', telefone: '7130000037', horario: 'Todos os dias 11h às 22h', fatia: 1 },
    ],
    pessoas: [
      { papel: 'DONO', nome: 'Fábio Nogueira', login: 'dono' },
      { papel: 'BALCAO', nome: 'Lara Mendes', login: 'balcao', loja: 0 },
    ],
    opcoes: {
      Sabor: ['Chocolate', 'Morango', 'Creme', 'Flocos', 'Coco', 'Maracujá', 'Doce de leite', 'Pistache', 'Cajá', 'Umbu', 'Tapioca', 'Limão'].map((valor) => ({ valor })),
    },
    pesoOpcao: { Chocolate: 1.6, Morango: 1.3, Creme: 1, Flocos: 1.2, Coco: 1, Maracujá: 0.9, 'Doce de leite': 1.1, Pistache: 0.6, Cajá: 0.8, Umbu: 0.6, Tapioca: 0.7, Limão: 0.8 },
    produtos: [
      { nome: 'Sorvete de massa', categoria: 'Massa', medida: 'KG', vista: 69.9, custo: 21, eixos: { Sabor: ['Chocolate', 'Morango', 'Creme', 'Flocos', 'Coco', 'Maracujá', 'Doce de leite', 'Pistache', 'Cajá', 'Tapioca'] }, peso: 10, qtd: [0.2, 0.7], minimo: 3, acabou: ['Pistache'], pouco: ['Cajá', 'Tapioca'] },
      { nome: 'Açaí na tigela', categoria: 'Açaí', medida: 'KG', vista: 59.9, custo: 19, peso: 6, qtd: [0.3, 0.6], minimo: 5 },
      { nome: 'Picolé de fruta', categoria: 'Picolé', medida: 'UN', vista: 6, custo: 2.1, eixos: { Sabor: ['Morango', 'Limão', 'Maracujá', 'Coco', 'Cajá', 'Umbu'] }, peso: 5, qtd: [1, 3], minimo: 10, pouco: ['Umbu'] },
      { nome: 'Picolé cremoso', categoria: 'Picolé', medida: 'UN', vista: 8.5, custo: 3.2, eixos: { Sabor: ['Chocolate', 'Doce de leite', 'Pistache', 'Flocos'] }, peso: 3, qtd: [1, 2], minimo: 8 },
      { nome: 'Milk-shake 500 ml', categoria: 'Milk-shake', medida: 'UN', vista: 18, custo: 6, eixos: { Sabor: ['Chocolate', 'Morango', 'Flocos'] }, peso: 2.5, minimo: 10 },
      { nome: 'Leite condensado (porção)', categoria: 'Complementos', medida: 'UN', vista: 3, custo: 0.8, peso: 3, minimo: 20 },
      { nome: 'Granola (porção)', categoria: 'Complementos', medida: 'UN', vista: 2.5, custo: 0.6, peso: 2, minimo: 20 },
      { nome: 'Paçoca (porção)', categoria: 'Complementos', medida: 'UN', vista: 2.5, custo: 0.7, peso: 1.5, minimo: 20 },
      { nome: 'Casquinha', categoria: 'Complementos', medida: 'UN', vista: 2, custo: 0.4, peso: 1.5, minimo: 30 },
    ],
    clientes: [
      { nome: 'Davi Carneiro' }, { nome: 'Luana Serra', obs: 'Encomenda bolo de sorvete todo aniversário dos filhos.' },
      { nome: 'Igor Matos' }, { nome: 'Camila Dantas' }, { nome: 'Thiago Rezende' }, { nome: 'Aline Bastos' },
      { nome: 'Rogério Sampaio' }, { nome: 'Beatriz Leal' }, { nome: 'Mateus Lacerda' }, { nome: 'Sabrina Gama' },
      { nome: 'Otávio Pedreira' }, { nome: 'Jéssica Fraga' }, { nome: 'Caio Brito' }, { nome: 'Marina Coutinho' },
      { nome: 'Leandro Paixão' }, { nome: 'Tamires Góis' }, { nome: 'Vitor Hugo Seixas' }, { nome: 'Raquel Almeida' },
    ],
    vendasPorDia: 30,
    semana: [1.55, 0.6, 0.7, 0.8, 0.9, 1.2, 1.6],
    horas: { 11: 0.4, 12: 0.7, 13: 0.9, 14: 1.1, 15: 1.4, 16: 1.6, 17: 1.5, 18: 1.2, 19: 1.1, 20: 1, 21: 0.6 },
    formas: [['PIX', 5], ['DEBITO', 2.5], ['CREDITO', 2], ['DINHEIRO', 2]],
    itens: [1, 3],
    comCliente: 0.08,
    cancelamentos: 0.01,
    devolucoes: 0.002,
    destinos: [['DINHEIRO', 1]],
    despesas: [
      { categoria: 'Aluguel', descricao: 'Aluguel do ponto', valor: 3800, dia: 5, fornecedor: 'Imobiliária Maré Alta', loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Energia (freezers e balcão refrigerado)', valor: 1650, dia: 12, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Água', valor: 180, dia: 14, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Internet', valor: 109.9, dia: 20 },
      { categoria: 'Salários e encargos', descricao: 'Folha da equipe', valor: 5400, dia: 5 },
      { categoria: 'Pró-labore', descricao: 'Pró-labore', valor: 4000, dia: 5 },
      { categoria: 'Contabilidade', descricao: 'Honorários contábeis', valor: 480, dia: 10, fornecedor: 'Escritório Contábil Aurora' },
      { categoria: 'Sistema e software', descricao: 'Mensalidade do Norte', valor: 1500, dia: 10 },
      { categoria: 'Compra de mercadoria', descricao: 'Base e insumos de sorvete', valor: 7800, dia: 8, fornecedor: 'Laticínios Serra do Mel' },
      { categoria: 'Compra de mercadoria', descricao: 'Polpa de frutas', valor: 2100, dia: 16, fornecedor: 'Polpas do Recôncavo' },
      { categoria: 'Compra de mercadoria', descricao: 'Açaí em balde', valor: 3900, dia: 21, fornecedor: 'Açaí Pará Verde', atrasa: true },
      { categoria: 'Embalagem e sacola', descricao: 'Potes, copos e colheres', valor: 690, dia: 22, fornecedor: 'Descartáveis Litoral' },
      { categoria: 'Impostos sobre venda', descricao: 'Simples Nacional', valor: 1900, dia: 20 },
    ],
    taxas: { debito: 1.29, credito: 2.99, parcelado: 4.39, pix: 0 },
    quadro: {
      nome: 'Temporada de verão',
      cor: '#0E7C86',
      grupos: ['Esta semana', 'Este mês', 'Próximo mês'],
      tarefas: [
        { titulo: 'Pedir mais Pistache: acabou na vitrine', grupo: 'Esta semana', prioridade: 5, prazo: 0, quem: 'dono' },
        { titulo: 'Trocar a borracha da porta do freezer 2', grupo: 'Esta semana', situacao: 'EM_ANDAMENTO', prioridade: 4, prazo: 2, quem: 'dono' },
        { titulo: 'Treinar a atendente nova no balcão em grade', grupo: 'Esta semana', prioridade: 3, prazo: 3, quem: 'balcao' },
        { titulo: 'Conferir a validade das caldas e coberturas', grupo: 'Este mês', prioridade: 3, prazo: 6, quem: 'balcao' },
        { titulo: 'Montar o cardápio de verão na parede', grupo: 'Esta semana', situacao: 'FEITO', prioridade: 2, prazo: -3, quem: 'balcao' },
        { titulo: 'Orçar um segundo freezer horizontal', grupo: 'Próximo mês', situacao: 'PARADO', prioridade: 2, prazo: 30, quem: 'dono', descricao: 'Esperando a conta de energia de outubro para decidir.' },
      ],
    },
    encomendas: [
      { descricao: 'Pote de 5 L de sorvete: metade chocolate, metade morango, para aniversário', valor: 280, sinal: 100, dia: 4, hora: '15:00', entrega: true, endereco: 'Rua dos Coqueiros, 88, Ondina', cliente: 1 },
      { descricao: 'Açaí para festa: 3 kg, com complementos em potes separados', valor: 210, sinal: 0, dia: 1, hora: '17:00', cliente: 3 },
      { descricao: 'Bolo de sorvete de doce de leite, 2 kg, escrito "Parabéns, Davi"', valor: 190, sinal: 80, dia: 0, hora: '21:00', cliente: 0, pronta: true },
      { descricao: '40 picolés sortidos para festa de escola', valor: 220, sinal: 60, dia: 6, hora: '10:00' },
    ],
  }
}

function padaria(): Demo {
  return {
    ramo: 'padaria',
    nome: 'Padaria Trigo Dourado',
    cor: '#A0631C',
    plano: 'REDE',
    regime: 'SIMPLES',
    porte: 'ATE_20',
    dor: 'LUCRO',
    catalogo: 'ATE_50',
    comoVende: ['BALCAO', 'WHATSAPP', 'ENTREGA'],
    ddd: '71',
    lojas: [
      { nome: 'Padaria Trigo Dourado', endereco: 'Rua do Forno', numero: '12', bairro: 'Brotas', cidade: 'Salvador', estado: 'BA', telefone: '7130000012', horario: 'Todos os dias 6h às 20h', fatia: 1 },
    ],
    pessoas: [
      { papel: 'DONO', nome: 'Antônio Carvalho', login: 'dono' },
      { papel: 'BALCAO', nome: 'Rita Figueiredo', login: 'balcao', loja: 0 },
    ],
    produtos: [
      { nome: 'Pão francês', categoria: 'Pães', medida: 'KG', vista: 16.9, custo: 6.2, producao: true, peso: 14, qtd: [0.2, 0.9] },
      { nome: 'Pão de queijo', categoria: 'Pães', medida: 'KG', vista: 44.9, custo: 17, producao: true, peso: 4, qtd: [0.1, 0.4] },
      { nome: 'Pão delícia', categoria: 'Pães', medida: 'UN', vista: 1.5, custo: 0.45, producao: true, peso: 3, qtd: [2, 6] },
      { nome: 'Bolo de fubá (fatia)', categoria: 'Bolos', medida: 'UN', vista: 7, custo: 2, producao: true, peso: 3, qtd: [1, 2] },
      { nome: 'Bolo de chocolate inteiro', categoria: 'Bolos', medida: 'UN', vista: 45, custo: 16, producao: true, peso: 0.6 },
      { nome: 'Coxinha', categoria: 'Salgados', medida: 'UN', vista: 7, custo: 2.3, producao: true, peso: 5, qtd: [1, 3] },
      { nome: 'Esfiha de carne', categoria: 'Salgados', medida: 'UN', vista: 6.5, custo: 2, producao: true, peso: 3, qtd: [1, 3] },
      { nome: 'Queijo mussarela', categoria: 'Frios e laticínios', medida: 'KG', vista: 54.9, custo: 33, peso: 2.5, qtd: [0.15, 0.5], minimo: 3, prazo: 3, pouco: [''] },
      { nome: 'Presunto cozido', categoria: 'Frios e laticínios', medida: 'KG', vista: 44.9, custo: 26, peso: 2, qtd: [0.1, 0.4], minimo: 2, prazo: 3, acabou: [''] },
      { nome: 'Manteiga 200 g', categoria: 'Frios e laticínios', medida: 'UN', vista: 12.9, custo: 8.4, peso: 1.5, minimo: 6, prazo: 7 },
      { nome: 'Leite integral 1 L', categoria: 'Bebidas', medida: 'UN', vista: 5.49, custo: 3.9, peso: 4, qtd: [1, 3], minimo: 24, prazo: 3 },
      { nome: 'Café coado (copo)', categoria: 'Bebidas', medida: 'UN', vista: 4, custo: 0.7, producao: true, peso: 5 },
      { nome: 'Refrigerante lata 350 ml', categoria: 'Bebidas', medida: 'UN', vista: 5.5, custo: 2.8, peso: 2.5, minimo: 24, prazo: 7, pouco: [''] },
    ],
    clientes: [
      { nome: 'Dona Lurdes Nascimento', obs: 'Pão francês bem moreno. Encomenda bolo todo mês.' },
      { nome: 'Seu Jorge Amaral' }, { nome: 'Cristiane Lopes' }, { nome: 'Edvaldo Rios' }, { nome: 'Márcia Tavares' },
      { nome: 'Rafaela Couto' }, { nome: 'Wellington Sá' }, { nome: 'Neide Barreto' }, { nome: 'Gilson Pereira' },
      { nome: 'Simone Araújo' }, { nome: 'Paulo Henrique Brito' }, { nome: 'Ivone Macedo' }, { nome: 'Sandro Queiroz' },
      { nome: 'Lúcia Helena Prado' }, { nome: 'Rosana Dias' }, { nome: 'Alexandre Viana' },
    ],
    vendasPorDia: 42,
    semana: [1.25, 0.95, 0.95, 0.95, 1, 1.1, 1.35],
    horas: { 6: 1.6, 7: 1.8, 8: 1.4, 9: 1, 10: 0.7, 11: 0.7, 12: 0.6, 13: 0.5, 14: 0.5, 15: 0.7, 16: 1.1, 17: 1.5, 18: 1.4, 19: 0.9 },
    formas: [['PIX', 5], ['DEBITO', 3], ['DINHEIRO', 3], ['CREDITO', 1]],
    itens: [1, 4],
    comCliente: 0.06,
    cancelamentos: 0.008,
    devolucoes: 0,
    despesas: [
      { categoria: 'Aluguel', descricao: 'Aluguel do prédio', valor: 4200, dia: 5, fornecedor: 'Imobiliária Casa Forte', loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Energia (fornos e câmara fria)', valor: 2350, dia: 12, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Água', valor: 390, dia: 14, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Internet', valor: 99.9, dia: 20 },
      { categoria: 'Outras despesas', descricao: 'Gás dos fornos', valor: 980, dia: 8, fornecedor: 'Gás Bom Fogo', loja: 0 },
      { categoria: 'Salários e encargos', descricao: 'Folha (padeiros e balcão)', valor: 12800, dia: 5 },
      { categoria: 'Pró-labore', descricao: 'Pró-labore', valor: 5000, dia: 5 },
      { categoria: 'Contabilidade', descricao: 'Honorários contábeis', valor: 600, dia: 10, fornecedor: 'Escritório Contábil Aurora' },
      { categoria: 'Sistema e software', descricao: 'Mensalidade do Norte', valor: 1500, dia: 10 },
      { categoria: 'Compra de mercadoria', descricao: 'Farinha de trigo (30 sacos)', valor: 5100, dia: 3, fornecedor: 'Moinho Boa Safra' },
      { categoria: 'Compra de mercadoria', descricao: 'Frios e laticínios', valor: 4200, dia: 15, fornecedor: 'Laticínios Vale Verde' },
      { categoria: 'Compra de mercadoria', descricao: 'Bebidas', valor: 1300, dia: 22, fornecedor: 'Distribuidora Gelada', atrasa: true },
      { categoria: 'Embalagem e sacola', descricao: 'Sacos de pão e caixas de bolo', valor: 520, dia: 18, fornecedor: 'Descartáveis Litoral' },
      { categoria: 'Impostos sobre venda', descricao: 'Simples Nacional', valor: 2900, dia: 20 },
    ],
    taxas: { debito: 1.19, credito: 2.89, parcelado: 4.29, pix: 0 },
    quadro: {
      nome: 'Produção e encomendas',
      cor: '#A0631C',
      grupos: ['Esta semana', 'Este mês', 'Próximo mês'],
      tarefas: [
        { titulo: 'Fechar o pedido de farinha da semana', grupo: 'Esta semana', prioridade: 4, prazo: 1, quem: 'dono' },
        { titulo: 'Separar a caixa do bolo de aniversário de sábado', grupo: 'Esta semana', prioridade: 3, prazo: 2, quem: 'balcao' },
        { titulo: 'Atualizar a tabela de preço do pão francês na parede', grupo: 'Esta semana', situacao: 'EM_ANDAMENTO', prioridade: 3, prazo: 1, quem: 'balcao' },
        { titulo: 'Limpar e degelar a câmara fria', grupo: 'Esta semana', situacao: 'FEITO', prioridade: 3, prazo: -1, quem: 'balcao' },
        { titulo: 'Forno 2 assando desigual: chamar o técnico', grupo: 'Este mês', situacao: 'PARADO', prioridade: 5, prazo: 4, quem: 'dono', descricao: 'O técnico só vem na semana que vem.' },
        { titulo: 'Montar o cardápio de salgados para festa', grupo: 'Próximo mês', prioridade: 2, prazo: 20, quem: 'dono' },
      ],
    },
    encomendas: [
      { descricao: 'Bolo de aniversário 3 kg: massa branca, recheio de brigadeiro com morango, escrito "Feliz 60 anos, Dona Lurdes"', valor: 260, sinal: 100, dia: 2, hora: '10:00', cliente: 0 },
      { descricao: 'Cento de salgados sortidos (coxinha, esfiha e bolinha de queijo)', valor: 85, sinal: 40, dia: 1, hora: '15:00', cliente: 4 },
      { descricao: 'Torta de limão grande', valor: 95, sinal: 0, dia: 4, hora: '11:00' },
      { descricao: 'Bolo de cenoura com cobertura de chocolate, 2 kg', valor: 120, sinal: 50, dia: 0, hora: '09:00', cliente: 2, pronta: true, retiraHoje: true },
    ],
  }
}

function petshop(): Demo {
  return {
    ramo: 'petshop',
    nome: 'Amigo Bicho Pet Shop',
    cor: '#2F7D32',
    plano: 'REDE',
    regime: 'SIMPLES',
    porte: 'ATE_5',
    dor: 'ESTOQUE',
    catalogo: 'ATE_500',
    comoVende: ['BALCAO', 'WHATSAPP', 'ENTREGA'],
    ddd: '71',
    lojas: [
      { nome: 'Amigo Bicho Pet Shop', endereco: 'Avenida dos Ipês', numero: '901', bairro: 'Pituba', cidade: 'Salvador', estado: 'BA', telefone: '7130000901', horario: 'Seg a sex 8h às 19h, sáb 8h às 14h', fatia: 1 },
    ],
    pessoas: [
      { papel: 'DONO', nome: 'Juliana Prado', login: 'dono' },
      { papel: 'BALCAO', nome: 'Diego Santana', login: 'balcao', loja: 0 },
    ],
    pesoOpcao: { Filhote: 1, Pequeno: 1.4, Médio: 1.2, Grande: 0.8 },
    produtos: [
      { nome: 'Ração premium cães adultos 15 kg', categoria: 'Ração', medida: 'UN', vista: 219.9, cartao: 229.9, custo: 152, eixos: { Porte: ['Pequeno', 'Médio', 'Grande'] }, peso: 5, prazo: 7, minimo: 3, pouco: ['Médio'] },
      { nome: 'Ração premium filhotes 10 kg', categoria: 'Ração', medida: 'UN', vista: 184.9, cartao: 192.9, custo: 128, eixos: { Porte: ['Filhote'] }, peso: 2, prazo: 7, minimo: 2 },
      { nome: 'Ração gatos castrados 10 kg', categoria: 'Ração', medida: 'UN', vista: 169.9, cartao: 177.9, custo: 116, peso: 3, prazo: 10, minimo: 3, pouco: [''] },
      { nome: 'Ração a granel', categoria: 'Ração', medida: 'KG', vista: 16.9, custo: 9.5, peso: 5, qtd: [1, 3], prazo: 5, minimo: 15 },
      { nome: 'Sachê úmido para gatos 85 g', categoria: 'Ração', medida: 'UN', vista: 3.49, custo: 1.7, peso: 4, qtd: [2, 6], prazo: 7, minimo: 30 },
      { nome: 'Petisco bifinho 65 g', categoria: 'Petiscos', medida: 'UN', vista: 9.9, custo: 4.6, peso: 4, qtd: [1, 3], prazo: 7, minimo: 12 },
      { nome: 'Areia higiênica 4 kg', categoria: 'Higiene', medida: 'UN', vista: 24.9, custo: 13, peso: 3, prazo: 7, minimo: 8, acabou: [''] },
      { nome: 'Tapete higiênico (30 un)', categoria: 'Higiene', medida: 'UN', vista: 69.9, custo: 41, peso: 1.5, prazo: 10, minimo: 4 },
      { nome: 'Shampoo neutro 500 ml', categoria: 'Higiene', medida: 'UN', vista: 29.9, custo: 14, peso: 1, minimo: 3 },
      { nome: 'Bolinha de borracha', categoria: 'Brinquedos', medida: 'UN', vista: 14.9, custo: 5, peso: 1, minimo: 4 },
      { nome: 'Coleira ajustável', categoria: 'Acessórios', medida: 'UN', vista: 34.9, custo: 13, eixos: { Porte: ['Pequeno', 'Médio', 'Grande'] }, peso: 1, minimo: 2 },
      { nome: 'Antipulgas (pipeta)', categoria: 'Medicamentos', medida: 'UN', vista: 54.9, cartao: 57.9, custo: 31, eixos: { Porte: ['Pequeno', 'Médio', 'Grande'] }, peso: 1.5, prazo: 10, minimo: 3 },
      // O banho e a tosa: serviço com hora marcada, e o material que ele gasta.
      { nome: 'Banho (porte pequeno)', categoria: 'Banho e tosa', medida: 'UN', vista: 50, servico: true, duracaoMin: 60, peso: 0 },
      { nome: 'Banho (porte grande)', categoria: 'Banho e tosa', medida: 'UN', vista: 80, servico: true, duracaoMin: 90, peso: 0 },
      { nome: 'Banho e tosa completa', categoria: 'Banho e tosa', medida: 'UN', vista: 110, servico: true, duracaoMin: 120, peso: 0 },
      { nome: 'Tosa higiênica', categoria: 'Banho e tosa', medida: 'UN', vista: 40, servico: true, duracaoMin: 30, peso: 0 },
      { nome: 'Shampoo profissional 5 L', categoria: 'Banho e tosa', medida: 'UN', vista: 119.9, custo: 78, uso: true, peso: 0, minimo: 2, prazo: 7, consumo: 0.6, pouco: [''] },
      { nome: 'Perfume pós-banho 1 L', categoria: 'Banho e tosa', medida: 'UN', vista: 59.9, custo: 32, uso: true, peso: 0, minimo: 2, prazo: 7, consumo: 0.3 },
    ],
    clientes: [
      { nome: 'Carolina Viana', obs: 'Tem dois labradores. Leva a ração porte grande todo mês.' },
      { nome: 'Henrique Salles', obs: 'Gato castrado. Pede entrega.' },
      { nome: 'Mônica Brandão' }, { nome: 'Felipe Assis' }, { nome: 'Renata Coelho' }, { nome: 'Gustavo Leite' },
      { nome: 'Débora Maia' }, { nome: 'Rodrigo Seabra' }, { nome: 'Talita Franco' }, { nome: 'André Luiz Pacheco' },
      { nome: 'Vera Lúcia Cardoso' }, { nome: 'Marcelo Barbosa' }, { nome: 'Elaine Rangel' }, { nome: 'Fabiana Sodré' },
      { nome: 'Ricardo Magalhães' }, { nome: 'Poliana Neves' }, { nome: 'Leonardo Falcão' }, { nome: 'Sheila Martins' },
      { nome: 'Cíntia Barros' }, { nome: 'Júlio César Ramos' }, { nome: 'Nádia Ferraz' }, { nome: 'Otília Gomes' },
    ],
    vendasPorDia: 17,
    semana: SEMANA_COMERCIO,
    horas: { 8: 0.8, 9: 1, 10: 1.2, 11: 1.1, 12: 0.8, 13: 0.7, 14: 0.9, 15: 1, 16: 1.1, 17: 1.3, 18: 1.1 },
    formas: [['PIX', 4], ['CREDITO', 3], ['DEBITO', 2.5], ['DINHEIRO', 1.5]],
    itens: [1, 3],
    comCliente: 0.6,
    cancelamentos: 0.01,
    devolucoes: 0.008,
    destinos: [['DINHEIRO', 1], ['ESTORNO', 1]],
    levaProduto: 0.2,
    profissionais: [
      { nome: 'Wesley Andrade', cargo: 'Banhista e tosador', servicos: ['Banho (porte pequeno)', 'Banho (porte pequeno)', 'Banho (porte grande)', 'Banho e tosa completa', 'Tosa higiênica'], dias: [1, 2, 3, 4, 5, 6], ocupacao: 0.65 },
      { nome: 'Kátia Moura', cargo: 'Banhista', servicos: ['Banho (porte pequeno)', 'Banho (porte grande)', 'Tosa higiênica'], dias: [2, 4, 6], ocupacao: 0.55 },
    ],
    observacoesAgenda: ['Cachorro bravo: usar focinheira', 'Primeira vez no banho', 'Tutor vem buscar às 17h', 'Pele sensível: shampoo neutro', 'Pediu laço na orelha'],
    compras: {
      fornecedores: [
        { nome: 'Distribuidora Pet Sertão', telefone: '7130005566', observacao: 'Pedido até quarta, entrega na sexta.' },
        { nome: 'Pet Atacado do Nordeste', telefone: '7130007788' },
      ],
      recebido: { fornecedor: 0, itens: [['Ração premium cães adultos 15 kg', 'Médio', 6], ['Areia higiênica 4 kg', null, 10]] },
      aberto: { fornecedor: 1, previsto: 4, itens: [['Shampoo profissional 5 L', null, 3], ['Tapete higiênico (30 un)', null, 6], ['Ração gatos castrados 10 kg', null, 4]] },
      consumoHoje: [['Shampoo profissional 5 L', null, 1]],
    },
    despesas: [
      { categoria: 'Aluguel', descricao: 'Aluguel da loja', valor: 2900, dia: 5, fornecedor: 'Imobiliária Casa Forte', loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Energia', valor: 380, dia: 12, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Água', valor: 120, dia: 14, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Internet', valor: 99.9, dia: 20 },
      { categoria: 'Salários e encargos', descricao: 'Folha da equipe', valor: 4300, dia: 5 },
      { categoria: 'Pró-labore', descricao: 'Pró-labore', valor: 4500, dia: 5 },
      { categoria: 'Contabilidade', descricao: 'Honorários contábeis', valor: 450, dia: 10, fornecedor: 'Escritório Contábil Aurora' },
      { categoria: 'Sistema e software', descricao: 'Mensalidade do Norte', valor: 1500, dia: 10 },
      { categoria: 'Compra de mercadoria', descricao: 'Rações: pedido da primeira quinzena', valor: 9800, dia: 3, fornecedor: 'Distribuidora Pet Sertão' },
      { categoria: 'Compra de mercadoria', descricao: 'Rações: pedido da segunda quinzena', valor: 9800, dia: 18, fornecedor: 'Distribuidora Pet Sertão' },
      { categoria: 'Compra de mercadoria', descricao: 'Higiene e acessórios', valor: 2300, dia: 24, fornecedor: 'Pet Atacado do Nordeste', atrasa: true },
      { categoria: 'Entrega e frete', descricao: 'Motoboy das entregas', valor: 520, dia: 28, caixa: true },
      { categoria: 'Impostos sobre venda', descricao: 'Simples Nacional', valor: 1800, dia: 20 },
    ],
    taxas: { debito: 1.39, credito: 3.09, parcelado: 4.49, pix: 0 },
    quadro: {
      nome: 'Reposição e fornecedores',
      cor: '#2F7D32',
      grupos: ['Esta semana', 'Este mês', 'Próximo mês'],
      tarefas: [
        { titulo: 'Pedir ração adultos porte médio: está no mínimo', grupo: 'Esta semana', prioridade: 5, prazo: 0, quem: 'dono' },
        { titulo: 'Cobrar a Pet Atacado pela areia que veio faltando', grupo: 'Esta semana', situacao: 'EM_ANDAMENTO', prioridade: 4, prazo: 1, quem: 'dono' },
        { titulo: 'Montar a gôndola de petiscos perto do caixa', grupo: 'Esta semana', situacao: 'FEITO', prioridade: 2, prazo: -2, quem: 'balcao' },
        { titulo: 'Cadastrar a linha nova de brinquedos', grupo: 'Este mês', prioridade: 2, prazo: 6, quem: 'balcao' },
        { titulo: 'Rever o preço da ração a granel', grupo: 'Este mês', prioridade: 3, prazo: 8, quem: 'dono' },
        { titulo: 'Confirmar os banhos de amanhã pelo WhatsApp', grupo: 'Esta semana', prioridade: 4, prazo: 0, quem: 'balcao' },
      ],
    },
    encomendas: [
      { descricao: 'Ração premium adultos 15 kg (porte médio) e areia 4 kg: entregar', valor: 244.8, sinal: 0, dia: 1, hora: '10:00', entrega: true, endereco: 'Rua das Hortênsias, 45, ap. 302, Pituba', cliente: 0 },
      { descricao: 'Ração gatos castrados 10 kg: separar para retirada', valor: 169.9, sinal: 50, dia: 2, hora: '17:00', cliente: 1 },
      { descricao: 'Caminha tamanho G (pedido especial ao fornecedor)', valor: 189.9, sinal: 90, dia: 6, hora: '11:00', cliente: 4 },
    ],
  }
}

function beleza(): Demo {
  return {
    ramo: 'beleza',
    nome: 'Studio Unha & Arte',
    cor: '#B0417A',
    plano: 'REDE',
    regime: 'SIMPLES',
    porte: 'ATE_5',
    dor: 'ATENDIMENTO',
    catalogo: 'ATE_50',
    comoVende: ['BALCAO', 'WHATSAPP'],
    ddd: '71',
    lojas: [
      { nome: 'Studio Unha & Arte', endereco: 'Rua das Orquídeas', numero: '77', bairro: 'Graça', cidade: 'Salvador', estado: 'BA', telefone: '7130000077', horario: 'Ter a sáb 9h às 19h', fatia: 1 },
    ],
    pessoas: [
      { papel: 'DONO', nome: 'Patrícia Moreira', login: 'dono' },
      { papel: 'BALCAO', nome: 'Bruna Lopes', login: 'balcao', loja: 0 },
    ],
    opcoes: {
      Cor: [
        { valor: 'Vermelho', hex: '#B3122E' },
        { valor: 'Nude', hex: '#D9B39B' },
        { valor: 'Rosa', hex: '#E58FA8' },
        { valor: 'Branco', hex: '#F5F5F0' },
        { valor: 'Preto', hex: '#1B1B1B' },
        { valor: 'Vinho', hex: '#5E1224' },
        { valor: 'Coral', hex: '#F2735B' },
      ],
    },
    pesoOpcao: { Vermelho: 1.5, Nude: 1.4, Rosa: 1.1, Branco: 0.9, Preto: 0.7, Vinho: 1, Coral: 0.8 },
    produtos: [
      { nome: 'Manicure', categoria: 'Unhas', medida: 'UN', vista: 35, servico: true, duracaoMin: 40, peso: 0 },
      { nome: 'Pedicure', categoria: 'Unhas', medida: 'UN', vista: 40, servico: true, duracaoMin: 50, peso: 0 },
      { nome: 'Pé e mão', categoria: 'Unhas', medida: 'UN', vista: 70, servico: true, duracaoMin: 90, peso: 0 },
      { nome: 'Esmaltação em gel', categoria: 'Unhas', medida: 'UN', vista: 90, servico: true, duracaoMin: 60, peso: 0 },
      { nome: 'Corte feminino', categoria: 'Cabelo', medida: 'UN', vista: 80, servico: true, duracaoMin: 60, peso: 0 },
      { nome: 'Escova', categoria: 'Cabelo', medida: 'UN', vista: 55, servico: true, duracaoMin: 45, peso: 0 },
      { nome: 'Hidratação', categoria: 'Cabelo', medida: 'UN', vista: 90, servico: true, duracaoMin: 60, peso: 0 },
      { nome: 'Coloração (retoque de raiz)', categoria: 'Cabelo', medida: 'UN', vista: 140, servico: true, duracaoMin: 90, peso: 0 },
      { nome: 'Design de sobrancelha', categoria: 'Estética', medida: 'UN', vista: 40, servico: true, duracaoMin: 30, peso: 0 },
      { nome: 'Design com henna', categoria: 'Estética', medida: 'UN', vista: 55, servico: true, duracaoMin: 45, peso: 0 },
      // Material de uso: a gaveta já marca "não vende" — o esmalte da manicure
      // não aparece no balcão; sai pelo "Material usado".
      { nome: 'Esmalte cremoso 8 ml', categoria: 'Material de uso', medida: 'UN', vista: 9.9, custo: 4.2, eixos: { Cor: ['Vermelho', 'Nude', 'Rosa', 'Branco', 'Preto', 'Vinho', 'Coral'] }, peso: 0, minimo: 2, prazo: 5, consumo: 1.1, acabou: ['Vinho'], pouco: ['Nude'] },
      { nome: 'Acetona 500 ml', categoria: 'Material de uso', medida: 'UN', vista: 14.9, custo: 7.5, peso: 0, minimo: 3, prazo: 5, consumo: 1.5 },
      { nome: 'Algodão 250 g', categoria: 'Material de uso', medida: 'UN', vista: 12.9, custo: 6.9, peso: 0, minimo: 4, prazo: 5, consumo: 2, pouco: [''] },
      { nome: 'Lixa de unha (pacote com 12)', categoria: 'Material de uso', medida: 'UN', vista: 18.9, custo: 8, peso: 0, minimo: 3, prazo: 5, consumo: 1, pouco: [''] },
      { nome: 'Kit shampoo e condicionador 300 ml', categoria: 'Produtos para revenda', medida: 'UN', vista: 79.9, cartao: 84.9, custo: 38, peso: 1, minimo: 2 },
      { nome: 'Óleo reparador de pontas 60 ml', categoria: 'Produtos para revenda', medida: 'UN', vista: 49.9, cartao: 52.9, custo: 21, peso: 1, minimo: 2 },
    ],
    clientes: [
      { nome: 'Amanda Ferraz', obs: 'Prefere a cadeira perto da janela.' },
      { nome: 'Luciene Prates', obs: 'Sempre esmalte vermelho.' },
      { nome: 'Rebeca Monteiro' }, { nome: 'Tânia Correia' }, { nome: 'Isabela Duarte' }, { nome: 'Karina Pimentel' },
      { nome: 'Sônia Mara Reis' }, { nome: 'Letícia Sampaio' }, { nome: 'Gisele Moura' }, { nome: 'Cláudia Neri' },
      { nome: 'Viviane Portela' }, { nome: 'Denise Farias' }, { nome: 'Juliana Brito' }, { nome: 'Ana Paula Silveira' },
      { nome: 'Mariana Galvão' }, { nome: 'Roberta Lins' }, { nome: 'Paula Quintela' }, { nome: 'Elisângela Rocha' },
      { nome: 'Flávia Nogueira' }, { nome: 'Natália Carvalhal' }, { nome: 'Cristina Paim' }, { nome: 'Lívia Teixeira' },
      { nome: 'Heloísa Sena' }, { nome: 'Joana Mascarenhas' }, { nome: 'Valéria Costa' }, { nome: 'Irene Bittencourt' },
    ],
    vendasPorDia: 0,
    semana: [0, 0, 0.9, 0.9, 1, 1.2, 1.3],
    horas: { 9: 1, 10: 1, 11: 1, 12: 0.8, 13: 0.8, 14: 1, 15: 1, 16: 1.1, 17: 1.2, 18: 1 },
    formas: [['PIX', 5], ['CREDITO', 2.5], ['DEBITO', 2], ['DINHEIRO', 1.5]],
    itens: [1, 2],
    comCliente: 0.5,
    cancelamentos: 0.005,
    devolucoes: 0,
    avulsasPorDia: 1.2,
    levaProduto: 0.1,
    profissionais: [
      { nome: 'Jaqueline Santos', cargo: 'Manicure e pedicure', servicos: ['Manicure', 'Pedicure', 'Pé e mão', 'Esmaltação em gel'], ocupacao: 0.8 },
      { nome: 'Rose Almeida', cargo: 'Manicure', servicos: ['Manicure', 'Pé e mão', 'Esmaltação em gel', 'Pedicure'], ocupacao: 0.7 },
      { nome: 'Camila Rocha', cargo: 'Cabeleireira', servicos: ['Corte feminino', 'Escova', 'Hidratação', 'Coloração (retoque de raiz)'], ocupacao: 0.65 },
      { nome: 'Luana Freire', cargo: 'Designer de sobrancelha', servicos: ['Design de sobrancelha', 'Design com henna'], dias: [3, 5, 6], ocupacao: 0.55 },
      { nome: 'Bruna Lopes', cargo: 'Recepção', servicos: [], login: 'balcao', atende: false },
    ],
    observacoesAgenda: ['Primeira vez no salão', 'Vem com a filha', 'Pediu para confirmar na véspera', 'Prefere a cadeira perto da janela', 'Vai trazer o esmalte dela'],
    despesas: [
      { categoria: 'Aluguel', descricao: 'Aluguel do salão', valor: 2600, dia: 5, fornecedor: 'Imobiliária Casa Forte', loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Energia', valor: 340, dia: 12, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Água', valor: 150, dia: 14, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Internet', valor: 99.9, dia: 20 },
      { categoria: 'Salários e encargos', descricao: 'Salário da recepção', valor: 1900, dia: 5 },
      { categoria: 'Comissão', descricao: 'Repasse das profissionais', valor: 6200, dia: 5 },
      { categoria: 'Pró-labore', descricao: 'Pró-labore', valor: 4000, dia: 5 },
      { categoria: 'Contabilidade', descricao: 'Honorários contábeis', valor: 400, dia: 10, fornecedor: 'Escritório Contábil Aurora' },
      { categoria: 'Sistema e software', descricao: 'Mensalidade do Norte', valor: 1500, dia: 10 },
      { categoria: 'Compra de mercadoria', descricao: 'Produtos de cabelo', valor: 1400, dia: 17, fornecedor: 'Casa do Cabeleireiro Atacado' },
      { categoria: 'Anúncio e divulgação', descricao: 'Impulsionamento das postagens', valor: 300, dia: 15, atrasa: true },
      { categoria: 'Impostos sobre venda', descricao: 'Simples Nacional', valor: 1100, dia: 20 },
    ],
    taxas: { debito: 1.39, credito: 3.19, parcelado: 4.59, pix: 0 },
    quadro: {
      nome: 'Rotina do salão',
      cor: '#B0417A',
      grupos: ['Esta semana', 'Este mês', 'Próximo mês'],
      tarefas: [
        { titulo: 'Confirmar as clientes de amanhã pelo WhatsApp', grupo: 'Esta semana', prioridade: 4, prazo: 0, quem: 'balcao' },
        { titulo: 'Conferir o registro da autoclave (alicates esterilizados)', grupo: 'Esta semana', prioridade: 5, prazo: 1, quem: 'balcao' },
        { titulo: 'Postar os trabalhos da semana no Instagram', grupo: 'Esta semana', situacao: 'EM_ANDAMENTO', prioridade: 3, prazo: 2, quem: 'dono' },
        { titulo: 'Organizar a prateleira de esmaltes por cor', grupo: 'Esta semana', situacao: 'FEITO', prioridade: 2, prazo: -2, quem: 'balcao' },
        { titulo: 'Trocar a lâmpada da bancada 2', grupo: 'Este mês', situacao: 'PARADO', prioridade: 2, prazo: 5, quem: 'dono', descricao: 'A lâmpada certa está em falta na loja de material.' },
        { titulo: 'Montar o pacote de noivas para o fim do ano', grupo: 'Próximo mês', prioridade: 3, prazo: 30, quem: 'dono' },
      ],
    },
    compras: {
      fornecedores: [
        { nome: 'Distribuidora Bela Cor', telefone: '7130004455', observacao: 'Entrega em até 3 dias úteis. Pedido mínimo de R$ 200.' },
        { nome: 'Casa do Cabeleireiro Atacado', telefone: '7130006677' },
      ],
      recebido: { fornecedor: 0, itens: [['Esmalte cremoso 8 ml', 'Vermelho', 6], ['Esmalte cremoso 8 ml', 'Rosa', 6], ['Acetona 500 ml', null, 6]] },
      aberto: { fornecedor: 0, previsto: 3, itens: [['Esmalte cremoso 8 ml', 'Vinho', 6], ['Esmalte cremoso 8 ml', 'Nude', 6], ['Algodão 250 g', null, 10], ['Lixa de unha (pacote com 12)', null, 5]] },
      consumoHoje: [['Algodão 250 g', null, 1], ['Acetona 500 ml', null, 1]],
    },
  }
}

function saude(): Demo {
  return {
    ramo: 'saude',
    nome: 'Clínica Ipê Amarelo',
    cor: '#1F5AA6',
    plano: 'REDE',
    regime: 'SIMPLES',
    porte: 'ATE_20',
    dor: 'ATENDIMENTO',
    catalogo: 'ATE_50',
    comoVende: ['BALCAO', 'WHATSAPP'],
    ddd: '71',
    lojas: [
      { nome: 'Clínica Ipê Amarelo', endereco: 'Avenida Sete Colinas', numero: '410, sala 12', bairro: 'Barra', cidade: 'Salvador', estado: 'BA', telefone: '7130000410', horario: 'Seg a sex 7h às 19h, sáb 7h às 12h', fatia: 1 },
    ],
    pessoas: [
      { papel: 'DONO', nome: 'Renata Farias', login: 'dono' },
      { papel: 'BALCAO', nome: 'Priscila Nunes', login: 'balcao', loja: 0 },
    ],
    produtos: [
      { nome: 'Consulta de clínica geral', categoria: 'Consultas', medida: 'UN', vista: 220, servico: true, duracaoMin: 30, peso: 0 },
      { nome: 'Consulta pediátrica', categoria: 'Consultas', medida: 'UN', vista: 250, servico: true, duracaoMin: 30, peso: 0 },
      { nome: 'Consulta de nutrição', categoria: 'Consultas', medida: 'UN', vista: 180, servico: true, duracaoMin: 45, peso: 0 },
      { nome: 'Sessão de fisioterapia', categoria: 'Procedimentos', medida: 'UN', vista: 120, servico: true, duracaoMin: 50, peso: 0 },
      { nome: 'Aplicação de injetável', categoria: 'Procedimentos', medida: 'UN', vista: 35, servico: true, duracaoMin: 15, peso: 0 },
      { nome: 'Eletrocardiograma', categoria: 'Exames', medida: 'UN', vista: 90, servico: true, duracaoMin: 20, peso: 0 },
      { nome: 'Luva de procedimento (caixa com 100)', categoria: 'Insumos', medida: 'UN', vista: 39.9, custo: 32, peso: 0, minimo: 4, prazo: 5, consumo: 3 },
      { nome: 'Seringa descartável 5 ml (caixa com 100)', categoria: 'Insumos', medida: 'UN', vista: 69.9, custo: 55, peso: 0, minimo: 2, prazo: 7, consumo: 0.7 },
      { nome: 'Gaze estéril (pacote com 10)', categoria: 'Insumos', medida: 'UN', vista: 8.9, custo: 5, peso: 0, minimo: 20, prazo: 5, consumo: 8, pouco: [''] },
      { nome: 'Álcool 70% 1 L', categoria: 'Insumos', medida: 'UN', vista: 14.9, custo: 9, peso: 0, minimo: 6, prazo: 5, consumo: 3 },
      { nome: 'Papel lençol (rolo de 70 m)', categoria: 'Insumos', medida: 'UN', vista: 24.9, custo: 17, peso: 0, minimo: 8, prazo: 5, consumo: 4, pouco: [''] },
      { nome: 'Eletrodo descartável (pacote com 50)', categoria: 'Insumos', medida: 'UN', vista: 49.9, custo: 36, peso: 0, minimo: 2, prazo: 7, consumo: 0.5 },
      { nome: 'Máscara descartável (caixa com 50)', categoria: 'Insumos', medida: 'UN', vista: 29.9, custo: 19, peso: 0, minimo: 3, prazo: 5, consumo: 1 },
    ],
    clientes: [
      { nome: 'Maria das Graças Oliveira', obs: 'Prefere horário pela manhã.' },
      { nome: 'José Roberto Cunha', obs: 'Pede recibo no nome da esposa para reembolso.' },
      { nome: 'Lucas Andrade Menezes', obs: 'Vem com a mãe (responsável).' },
      { nome: 'Sofia Ramos Lima', obs: 'Vem com o pai (responsável).' },
      { nome: 'Antônia Ferreira' }, { nome: 'Carlos Eduardo Pinheiro' }, { nome: 'Fátima Regina Souza' },
      { nome: 'Gabriel Nunes Rocha' }, { nome: 'Hilda Santana' }, { nome: 'Ivan Batista' }, { nome: 'Jurema Costa' },
      { nome: 'Laura Mendes Vieira' }, { nome: 'Miguel Araújo' }, { nome: 'Nair Conceição' }, { nome: 'Osvaldo Teles' },
      { nome: 'Paula Regina Matos' }, { nome: 'Raimundo Nonato Silva' }, { nome: 'Sandra Lemos' }, { nome: 'Tereza Cristina Góes' },
      { nome: 'Ulisses Freire' }, { nome: 'Valdirene Santos' }, { nome: 'Wagner Moreira' }, { nome: 'Yasmin Carvalho' },
      { nome: 'Zilda Barreto' }, { nome: 'Alice Fontes' }, { nome: 'Bernardo Sá' }, { nome: 'Célia Monteiro' },
      { nome: 'Diogo Albuquerque' }, { nome: 'Eunice Prado' }, { nome: 'Francisco Assis Neto' },
    ],
    vendasPorDia: 0,
    semana: [0, 1, 1, 1, 1, 1, 0.6],
    horas: { 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 13: 1, 14: 1, 15: 1, 16: 1, 17: 1, 18: 1 },
    formas: [['PIX', 5], ['CREDITO', 3], ['DEBITO', 2], ['DINHEIRO', 1]],
    itens: [1, 1],
    comCliente: 0.85,
    cancelamentos: 0.004,
    devolucoes: 0,
    profissionais: [
      { nome: 'Dra. Helena Duarte', cargo: 'Clínica geral', servicos: ['Consulta de clínica geral', 'Consulta de clínica geral', 'Consulta de clínica geral', 'Eletrocardiograma'], dias: [1, 2, 3, 4, 5], de: '07:30', ate: '13:00', ocupacao: 0.75 },
      { nome: 'Dr. Marcos Pires', cargo: 'Pediatria', servicos: ['Consulta pediátrica'], dias: [2, 4, 6], de: '08:00', ate: '12:00', ocupacao: 0.7 },
      { nome: 'Juliana Freitas', cargo: 'Nutricionista', servicos: ['Consulta de nutrição'], dias: [1, 3, 5], de: '13:00', ate: '18:00', ocupacao: 0.6 },
      { nome: 'Rafael Moura', cargo: 'Fisioterapeuta', servicos: ['Sessão de fisioterapia'], dias: [1, 2, 3, 4, 5], de: '13:00', ate: '19:00', ocupacao: 0.75 },
      { nome: 'Sônia Ramos', cargo: 'Técnica de enfermagem', servicos: ['Aplicação de injetável', 'Eletrocardiograma'], dias: [1, 2, 3, 4, 5], de: '07:00', ate: '13:00', ocupacao: 0.3, jornada: [0, 360, 360, 360, 360, 360, 0] },
      { nome: 'Priscila Nunes', cargo: 'Recepção', servicos: [], login: 'balcao', atende: false, jornada: [0, 480, 480, 480, 480, 480, 240] },
      { nome: 'Cláudio Reis', cargo: 'Serviços gerais', servicos: [], atende: false, jornada: [0, 480, 480, 480, 480, 480, 240] },
    ],
    observacoesAgenda: ['Primeira consulta', 'Pediu recibo para reembolso do plano', 'Vem acompanhada', 'Prefere ser chamada pelo sobrenome', 'Retorno de rotina'],
    despesas: [
      { categoria: 'Aluguel', descricao: 'Aluguel das salas', valor: 5200, dia: 5, fornecedor: 'Centro Médico Sete Colinas — condomínio', loja: 0 },
      { categoria: 'Condomínio e IPTU', descricao: 'Condomínio', valor: 780, dia: 8, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Energia', valor: 690, dia: 12, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Água', valor: 210, dia: 14, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Internet e telefone', valor: 149.9, dia: 20 },
      { categoria: 'Salários e encargos', descricao: 'Folha (recepção, enfermagem e serviços gerais)', valor: 9800, dia: 5 },
      { categoria: 'Comissão', descricao: 'Repasse aos profissionais', valor: 18500, dia: 6 },
      { categoria: 'Pró-labore', descricao: 'Pró-labore', valor: 6000, dia: 5 },
      { categoria: 'Contabilidade', descricao: 'Honorários contábeis', valor: 900, dia: 10, fornecedor: 'Escritório Contábil Aurora' },
      { categoria: 'Sistema e software', descricao: 'Mensalidade do Norte', valor: 1500, dia: 10 },
      { categoria: 'Outras despesas', descricao: 'Coleta de resíduos de saúde', valor: 320, dia: 15, fornecedor: 'Ambiental Coleta Segura', atrasa: true },
      { categoria: 'Impostos sobre venda', descricao: 'Simples Nacional', valor: 3100, dia: 20 },
    ],
    taxas: { debito: 1.39, credito: 3.19, parcelado: 4.59, pix: 0 },
    quadro: {
      nome: 'Rotina da clínica',
      cor: '#1F5AA6',
      grupos: ['Esta semana', 'Este mês', 'Próximo mês'],
      tarefas: [
        { titulo: 'Confirmar os horários de amanhã por telefone', grupo: 'Esta semana', prioridade: 4, prazo: 0, quem: 'balcao' },
        { titulo: 'Conferir a validade dos insumos da sala de procedimentos', grupo: 'Esta semana', prioridade: 4, prazo: 2, quem: 'balcao' },
        { titulo: 'Renovar o contrato da coleta de resíduos', grupo: 'Este mês', situacao: 'EM_ANDAMENTO', prioridade: 5, prazo: 5, quem: 'dono' },
        { titulo: 'Organizar a escala de sábado', grupo: 'Esta semana', situacao: 'FEITO', prioridade: 3, prazo: -2, quem: 'dono' },
        { titulo: 'Revisar o ar-condicionado da recepção', grupo: 'Este mês', situacao: 'PARADO', prioridade: 2, prazo: 9, quem: 'dono', descricao: 'Aguardando a visita do técnico.' },
      ],
    },
    compras: {
      fornecedores: [
        { nome: 'Cirúrgica Vale do Sol', telefone: '7130008899', observacao: 'Entrega às terças e sextas.' },
        { nome: 'Descartáveis Hospitalares Aliança', telefone: '7130002211' },
      ],
      recebido: { fornecedor: 0, itens: [['Luva de procedimento (caixa com 100)', null, 10], ['Álcool 70% 1 L', null, 12], ['Máscara descartável (caixa com 50)', null, 5]] },
      parcial: { fornecedor: 1, itens: [['Seringa descartável 5 ml (caixa com 100)', null, 4, 2]] },
      aberto: { fornecedor: 0, previsto: 2, itens: [['Gaze estéril (pacote com 10)', null, 40], ['Papel lençol (rolo de 70 m)', null, 20], ['Eletrodo descartável (pacote com 50)', null, 2]] },
      consumoHoje: [['Luva de procedimento (caixa com 100)', null, 1], ['Álcool 70% 1 L', null, 1]],
    },
  }
}

/**
 * A escola de cursos livres: inglês, reforço, ballet e robótica numa sede.
 *
 * Quase todo o dinheiro entra pela MENSALIDADE (o passo `escolaAoVivo`, lá
 * embaixo); o balcão — a secretaria — vende pouco: apostila e uniforme.
 * Quem estuda não tem telefone: o contato é o do responsável.
 */
function escola(): Demo {
  return {
    ramo: 'escola',
    nome: 'Escola Aprender Mais',
    cor: '#3B5BA9',
    plano: 'REDE',
    regime: 'SIMPLES',
    porte: 'ATE_20',
    dor: 'COBRANCA',
    catalogo: 'ATE_50',
    comoVende: ['BALCAO', 'WHATSAPP'],
    ddd: '71',
    modulos: ['escola', 'ponto', 'agente'],
    dias: 125,
    lojas: [
      { nome: 'Sede', endereco: 'Rua dos Jasmins', numero: '120', bairro: 'Stiep', cidade: 'Salvador', estado: 'BA', telefone: '7130000120', horario: 'Seg a sex 7h30 às 19h, sáb 8h às 12h', fatia: 1 },
    ],
    pessoas: [
      { papel: 'DONO', nome: 'Helena Barros', login: 'dono' },
      { papel: 'BALCAO', nome: 'Simone Araújo', login: 'balcao', loja: 0 },
      { papel: 'FINANCEIRO', nome: 'Ricardo Teles', login: 'financeiro' },
    ],
    pesoOpcao: { '6': 1, '8': 1.3, '10': 1.3, '12': 1, '14': 0.8, P: 0.6, M: 0.4 },
    produtos: [
      { nome: 'Apostila de inglês (semestre)', categoria: 'Material', medida: 'UN', vista: 89.9, custo: 38, peso: 1.2, minimo: 5, prazo: 15 },
      { nome: 'Caderno de atividades do reforço', categoria: 'Material', medida: 'UN', vista: 34.9, custo: 14, peso: 0.8, minimo: 4, prazo: 10 },
      { nome: 'Kit de peças de robótica', categoria: 'Material', medida: 'UN', vista: 149.9, custo: 82, peso: 0.3, minimo: 2, prazo: 20, pouco: [''] },
      { nome: 'Camiseta do uniforme', categoria: 'Uniforme', medida: 'UN', vista: 49.9, cartao: 52.9, custo: 21, eixos: { Tamanho: ['6', '8', '10', '12', '14', 'P', 'M'] }, peso: 2, minimo: 2, prazo: 20, acabou: ['10'], pouco: ['8'] },
      { nome: 'Collant de ballet', categoria: 'Uniforme', medida: 'UN', vista: 69.9, cartao: 74.9, custo: 30, eixos: { Tamanho: ['4', '6', '8', '10'] }, peso: 0.6, minimo: 1, prazo: 20 },
      { nome: 'Aula avulsa de reforço', categoria: 'Cursos livres', medida: 'UN', vista: 45, servico: true, duracaoMin: 60, peso: 0 },
    ],
    // Os alunos nascem no passo da escola, sem telefone e com o responsável.
    clientes: [],
    vendasPorDia: 1.4,
    semana: [0, 1, 1, 1, 1, 1, 0.8],
    horas: { 8: 0.8, 9: 1, 10: 0.8, 13: 1, 14: 1.3, 15: 1.2, 16: 1.1, 17: 1.2, 18: 0.8 },
    formas: [['PIX', 5], ['CREDITO', 2], ['DEBITO', 1.5], ['DINHEIRO', 1]],
    itens: [1, 2],
    comCliente: 0,
    cancelamentos: 0.01,
    devolucoes: 0.02,
    destinos: [['DINHEIRO', 1], ['ESTORNO', 1]],
    profissionais: [
      { nome: 'Carla Mendes', cargo: 'Professora de inglês', servicos: [], atende: false, de: '13:45', jornada: [0, 210, 210, 210, 210, 0, 0] },
      { nome: 'Otávio Lins', cargo: 'Professor do reforço', servicos: [], atende: false, de: '07:45', jornada: [0, 150, 0, 150, 0, 150, 0] },
      { nome: 'Rafael Nogueira', cargo: 'Professor de robótica', servicos: [], atende: false, de: '14:45', jornada: [0, 0, 0, 0, 0, 120, 0] },
      { nome: 'Lia Paiva', cargo: 'Professora de ballet', servicos: [], atende: false, de: '08:45', jornada: [0, 0, 0, 0, 0, 0, 90] },
      { nome: 'Simone Araújo', cargo: 'Secretária', servicos: [], login: 'balcao', atende: false, jornada: [0, 480, 480, 480, 480, 480, 240] },
    ],
    despesas: [
      { categoria: 'Aluguel', descricao: 'Aluguel da sede', valor: 4800, dia: 5, fornecedor: 'Imobiliária Casa Forte', loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Energia', valor: 620, dia: 12, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Água', valor: 180, dia: 14, loja: 0 },
      { categoria: 'Luz, água e internet', descricao: 'Internet', valor: 129.9, dia: 20 },
      { categoria: 'Salários e encargos', descricao: 'Folha (professores e secretaria)', valor: 11800, dia: 5 },
      { categoria: 'Pró-labore', descricao: 'Pró-labore', valor: 5500, dia: 5 },
      { categoria: 'Contabilidade', descricao: 'Honorários contábeis', valor: 700, dia: 10, fornecedor: 'Escritório Contábil Aurora' },
      { categoria: 'Sistema e software', descricao: 'Mensalidade do Norte', valor: 1500, dia: 10 },
      { categoria: 'Compra de mercadoria', descricao: 'Apostilas e material didático', valor: 1900, dia: 18, fornecedor: 'Editora Passo a Passo' },
      { categoria: 'Outras despesas', descricao: 'Limpeza e manutenção das salas', valor: 650, dia: 25, loja: 0, atrasa: true },
      { categoria: 'Anúncio e divulgação', descricao: 'Anúncio da rematrícula', valor: 350, dia: 15 },
      { categoria: 'Impostos sobre venda', descricao: 'Simples Nacional', valor: 2300, dia: 20 },
    ],
    taxas: { debito: 1.39, credito: 3.19, parcelado: 4.59, pix: 0 },
    quadro: {
      nome: 'Secretaria',
      cor: '#3B5BA9',
      grupos: ['Esta semana', 'Este mês', 'Próximo mês'],
      tarefas: [
        { titulo: 'Ligar para os responsáveis com mensalidade em atraso', grupo: 'Esta semana', prioridade: 5, prazo: 0, quem: 'balcao' },
        { titulo: 'Avisar a lista de espera da Inglês Kids quando abrir vaga', grupo: 'Esta semana', prioridade: 3, prazo: 3, quem: 'balcao' },
        { titulo: 'Pedir camisetas do uniforme tamanho 10', grupo: 'Esta semana', situacao: 'EM_ANDAMENTO', prioridade: 4, prazo: 2, quem: 'dono' },
        { titulo: 'Conferir a frequência de setembro com os professores', grupo: 'Este mês', prioridade: 3, prazo: 5, quem: 'dono' },
        { titulo: 'Imprimir os carnês do segundo semestre', grupo: 'Esta semana', situacao: 'FEITO', prioridade: 2, prazo: -2, quem: 'balcao' },
        { titulo: 'Consertar o ar-condicionado da sala 2', grupo: 'Este mês', situacao: 'PARADO', prioridade: 3, prazo: 6, quem: 'dono', descricao: 'O técnico pediu a peça; chega na semana que vem.' },
        { titulo: 'Montar a apresentação de ballet de dezembro', grupo: 'Próximo mês', prioridade: 2, prazo: 40, quem: 'dono' },
      ],
    },
    agente: { poderes: ['ver.resumo', 'explicar.sistema', 'mensalidades.atrasadas', 'turmas.consultar', 'pagamentos.consultar', 'ponto.consultar'] },
    escola: {
      regra: { multaPct: 2, jurosMes: 1, pontualidadePct: 5, avisoDias: 3, atrasoDias: 5 },
      turmas: [
        { nome: 'Inglês Kids', curso: 'Inglês para crianças', turno: 'tarde', professor: 'Carla Mendes', dias: [1, 3], de: '14:00', ate: '15:00', capacidade: 12, mensalidade: 320, vencimento: 10, idade: [6, 9], alunos: 12 },
        { nome: 'Inglês Teens', curso: 'Inglês intermediário', turno: 'tarde', professor: 'Carla Mendes', dias: [2, 4], de: '16:00', ate: '17:00', capacidade: 15, mensalidade: 360, vencimento: 10, idade: [12, 15], alunos: 10 },
        { nome: 'Reforço 3º ano', curso: 'Reforço escolar', turno: 'manha', professor: 'Otávio Lins', dias: [1, 3, 5], de: '08:00', ate: '10:00', capacidade: 10, mensalidade: 280, vencimento: 5, idade: [8, 9], alunos: 8 },
        { nome: 'Ballet infantil', curso: 'Ballet', turno: 'manha', professor: 'Lia Paiva', dias: [6], de: '09:00', ate: '10:00', capacidade: 12, mensalidade: 250, vencimento: 10, idade: [6, 10], alunos: 8 },
        { nome: 'Robótica', curso: 'Robótica e programação', turno: 'tarde', professor: 'Rafael Nogueira', dias: [5], de: '15:00', ate: '16:30', capacidade: 8, mensalidade: 420, vencimento: 15, idade: [10, 14], alunos: 7 },
      ],
      alunos: [
        'Pedro Almeida', 'Luísa Barbosa', 'Davi Santos', 'Maria Clara Souza', 'Arthur Lima', 'Helena Costa', 'Gabriel Rocha',
        'Alice Ferreira', 'Miguel Carvalho', 'Laura Ribeiro', 'Heitor Gomes', 'Valentina Dias', 'Bernardo Martins', 'Sophia Araújo',
        'Théo Cardoso', 'Manuela Teixeira', 'Lucas Pinto', 'Isabela Moreira', 'Enzo Correia', 'Beatriz Nunes', 'Samuel Mendes',
        'Lorena Freitas', 'Rafael Vieira', 'Cecília Monteiro', 'Benício Castro', 'Júlia Farias', 'Gustavo Pires', 'Lívia Duarte',
        'Matheus Barros', 'Giovanna Melo', 'Joaquim Lopes', 'Antonella Batista', 'Nicolas Ramos', 'Yasmin Cunha', 'Vicente Moura',
        'Ana Júlia Sales', 'Daniel Brito', 'Clara Fontes', 'Murilo Tavares', 'Marina Queiroz', 'Caio Rezende', 'Lara Macedo',
        'Pietro Campos', 'Eduarda Lacerda',
      ],
      responsaveis: [
        { nome: 'Maria Almeida', parentesco: 'mãe' }, { nome: 'Jorge Barbosa', parentesco: 'pai' }, { nome: 'Fernanda Santos', parentesco: 'mãe' },
        { nome: 'Paulo Souza', parentesco: 'pai' }, { nome: 'Cláudia Lima', parentesco: 'mãe' }, { nome: 'Renato Costa', parentesco: 'pai' },
        { nome: 'Patrícia Rocha', parentesco: 'mãe' }, { nome: 'Sérgio Ferreira', parentesco: 'pai' }, { nome: 'Juliana Carvalho', parentesco: 'mãe' },
        { nome: 'Márcio Ribeiro', parentesco: 'pai' }, { nome: 'Adriana Gomes', parentesco: 'mãe' }, { nome: 'Rodrigo Dias', parentesco: 'pai' },
        { nome: 'Luciana Martins', parentesco: 'mãe' }, { nome: 'Fábio Araújo', parentesco: 'pai' }, { nome: 'Carolina Cardoso', parentesco: 'mãe' },
        { nome: 'Eduardo Teixeira', parentesco: 'pai' }, { nome: 'Vanessa Pinto', parentesco: 'mãe' }, { nome: 'Alexandre Moreira', parentesco: 'pai' },
        { nome: 'Tatiana Correia', parentesco: 'mãe' }, { nome: 'Leonardo Nunes', parentesco: 'pai' }, { nome: 'Camila Mendes', parentesco: 'mãe' },
        { nome: 'Marcelo Freitas', parentesco: 'pai' }, { nome: 'Aline Vieira', parentesco: 'mãe' }, { nome: 'Gustavo Monteiro', parentesco: 'pai' },
        { nome: 'Daniela Castro', parentesco: 'mãe' }, { nome: 'Rogério Farias', parentesco: 'pai' }, { nome: 'Sandra Pires', parentesco: 'avó' },
        { nome: 'Thiago Duarte', parentesco: 'pai' }, { nome: 'Priscila Barros', parentesco: 'mãe' }, { nome: 'André Melo', parentesco: 'pai' },
        { nome: 'Bianca Lopes', parentesco: 'mãe' }, { nome: 'Felipe Batista', parentesco: 'pai' }, { nome: 'Renata Ramos', parentesco: 'mãe' },
        { nome: 'Vinícius Cunha', parentesco: 'pai' }, { nome: 'Cristina Moura', parentesco: 'mãe' }, { nome: 'Roberto Sales', parentesco: 'avô' },
        { nome: 'Elaine Brito', parentesco: 'mãe' }, { nome: 'Henrique Fontes', parentesco: 'pai' }, { nome: 'Mônica Tavares', parentesco: 'mãe' },
        { nome: 'Carlos Queiroz', parentesco: 'pai' }, { nome: 'Silvia Rezende', parentesco: 'mãe' }, { nome: 'Ivan Macedo', parentesco: 'pai' },
        { nome: 'Débora Campos', parentesco: 'mãe' }, { nome: 'Rafaela Lacerda', parentesco: 'tia' },
      ],
    },
  }
}

const DEMOS: Record<string, () => Demo | null> = { roupa, sorveteria, padaria, petshop, beleza, saude, escola }
const DEMOS_ORDEM = Object.keys(DEMOS)
const slugDe = (ramo: string) => `demo-${ramo}`

// ─────────────────────────────────────────────────────────────
// O SORTEIO — com semente, para a demonstração sair igual a cada vez
// ─────────────────────────────────────────────────────────────

type Dado = {
  (): number
  entre(a: number, b: number): number
  inteiro(a: number, b: number): number
  chance(p: number): boolean
  um<T>(lista: readonly T[]): T
  pesado<T>(lista: readonly T[], peso: (x: T) => number): T
}

function sorteio(semente: string): Dado {
  let h = 2166136261
  for (const c of semente) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  let x = h >>> 0
  const d = (() => {
    x = (x + 0x6d2b79f5) >>> 0
    let t = x
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }) as Dado
  d.entre = (a, b) => a + d() * (b - a)
  d.inteiro = (a, b) => a + Math.floor(d() * (b - a + 1))
  d.chance = (p) => d() < p
  d.um = (lista) => lista[Math.floor(d() * lista.length)]!
  d.pesado = (lista, peso) => {
    const total = lista.reduce((s, x) => s + Math.max(0, peso(x)), 0)
    let r = d() * total
    for (const x of lista) {
      r -= Math.max(0, peso(x))
      if (r <= 0) return x
    }
    return lista[lista.length - 1]!
  }
  return d
}

const novoId = () => randomUUID().replace(/-/g, '')
const r3 = (n: number) => Math.round(n * 1000) / 1000
const minutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return h * 60 + m
}
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
/** O instante de um minuto do dia, no relógio de São Paulo. */
const em = (dia: string, min: number) => new Date(inicioDoDiaEmSP(dia).getTime() + min * 60_000)
const semanaDe = (dia: string) => new Date(`${dia}T12:00:00Z`).getUTCDay()

// ─────────────────────────────────────────────────────────────
// AS CONEXÕES
// ─────────────────────────────────────────────────────────────

const urlAdmin = process.env.DATABASE_URL_ADMIN
const urlApp = process.env.DATABASE_URL
if (!urlAdmin) recusar(`falta DATABASE_URL_ADMIN em ${arquivo}.`)
if (!urlApp) recusar(`falta DATABASE_URL em ${arquivo}.`)

/** Admin: só para criar e apagar a empresa, e para a lista do começo. */
const admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: urlAdmin!, max: 1 }) })

/**
 * A credencial da APLICAÇÃO, presa a uma empresa — o mesmo que `comoOrg`
 * faz (src/servidor/banco.ts), com prazo maior: gravar dois meses de venda
 * de uma vez passa dos 5 s de uma requisição. Ficou aqui, e não num
 * parâmetro do `comoOrg`, porque transação longa é coisa de script: na
 * aplicação ela seguraria uma conexão do pool que o balcão precisa.
 */
const app = new PrismaClient({ adapter: new PrismaPg({ connectionString: urlApp!, max: 1 }) })
async function naEmpresa<T>(orgId: string, fn: (db: BancoDaOrg) => Promise<T>): Promise<T> {
  return app.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('set local role app_norte')
      await tx.$queryRaw`select set_config('app.org_id', ${orgId}, true)`
      return fn(tx as unknown as BancoDaOrg)
    },
    { timeout: 180_000, maxWait: 60_000 },
  )
}

/** createMany em fatias: um INSERT de dez mil linhas trava o banco local de uma conexão. */
async function emFatias<T>(lista: T[], gravar: (fatia: T[]) => Promise<unknown>, tamanho = 400) {
  for (let i = 0; i < lista.length; i += tamanho) await gravar(lista.slice(i, i + tamanho))
}

// ─────────────────────────────────────────────────────────────
// O MOLDE DE UMA EMPRESA EM CONSTRUÇÃO
// ─────────────────────────────────────────────────────────────

type Loja = { id: string; nome: string; horario: Horario | null; fatia: number }
type Pessoa = { id: string; nome: string; email: string; papel: Papel; loja: number | null; senha: string; sessao: Sessao }
type Var = {
  id: string
  produto: ProdutoDemo
  produtoId: string
  rotulo: string
  descricao: string
  codigo: string | null
  opcoes: string[]
  peso: number
}
type Cli = { id: string; nome: string; telefone: string; peso: number; desde: number; ate: number }
type Colab = { id: string; demo: ProfissionalDemo }

type Ctx = {
  demo: Demo
  slug: string
  orgId: string
  modulos: Modulo[]
  lojas: Loja[]
  pessoas: Pessoa[]
  dono: Pessoa
  balcao: Pessoa
  gerente: Pessoa | null
  dado: Dado
  agora: Date
  hoje: string
  inicio: string
  vars: Var[]
  clientes: Cli[]
  colabs: Colab[]
  categoriaFin: Map<string, string>
  contas: { banco: string; caixa: string }
  /** Dias de passado desta empresa. */
  dias: number
}

const DIAS_PADRAO = 60

// ─────────────────────────────────────────────────────────────
// 1. A EMPRESA, A EQUIPE E O CADASTRO INICIAL
// ─────────────────────────────────────────────────────────────

async function nascer(demo: Demo, slug: string): Promise<Ctx> {
  const agora = new Date()
  const hoje = diaEmSP(agora)
  const dias = demo.dias ?? DIAS_PADRAO
  const inicio = somarDias(hoje, -dias)
  const dado = sorteio(slug)

  // Só os módulos que o cadastro inicial deixaria marcados: os sugeridos pelo
  // ramo que o plano abre, mais "mais de uma unidade" quando há duas lojas.
  const sugeridos = [...(demo.modulos ?? RAMOS[demo.ramo].sugere)] as Modulo[]
  if (demo.lojas.length > 1) sugeridos.push('multiUnidade')
  const modulos = [...new Set(sugeridos)].filter((m) => planoLibera(demo.plano, m))

  const orgId = novoId()
  const criadaEm = em(somarDias(inicio, -7), 10 * 60)
  const emailDono = `dono@${slug}.test`

  await admin.org.create({
    data: {
      id: orgId,
      nome: demo.nome,
      slug,
      email: emailDono,
      ramo: demo.ramo,
      plano: demo.plano,
      situacao: 'ATIVA',
      criadaEm,
    },
  })

  const lojas: Loja[] = []
  const pessoas: Pessoa[] = []
  await naEmpresa(orgId, async (db) => {
    // O que o `terminarCadastro` grava na empresa.
    await db.org.update({
      where: { id: orgId },
      data: {
        nome: demo.nome,
        ramo: demo.ramo,
        modulos,
        regime: demo.regime,
        email: emailDono,
        telefone: demo.lojas[0]!.telefone,
        whatsapp: demo.lojas[0]!.telefone,
        corMarca: demo.cor,
        balcaoGrade: RAMOS[demo.ramo].balcao === 'grade',
        porte: demo.porte,
        dor: demo.dor,
        catalogo: demo.catalogo,
        comoVende: demo.comoVende,
        configuradaEm: new Date(criadaEm.getTime() + 20 * 60_000),
      },
    })
    for (const l of demo.lojas) {
      const u = await db.unidade.create({
        data: {
          orgId,
          nome: l.nome,
          endereco: l.endereco,
          numero: l.numero,
          bairro: l.bairro,
          cidade: l.cidade,
          estado: l.estado,
          telefone: l.telefone,
          horario: l.horario,
          ramo: demo.ramo,
          criadaEm,
        },
        select: { id: true },
      })
      lojas.push({ id: u.id, nome: l.nome, horario: lerHorario(l.horario), fatia: l.fatia })
    }
    // As grades e as gavetas do ramo — o mesmo que o cadastro inicial semeia.
    await semearRamo(db, orgId, demo.ramo)
    await db.auditoria.create({
      data: {
        orgId, quem: 'script', autor: 'SISTEMA', acao: 'empresa.configurou', alvoTipo: 'org', alvoId: orgId, alvoNome: demo.nome,
        depois: { ramo: demo.ramo, modulos, origem: 'demonstracao' }, criadoEm: criadaEm,
      },
    })
  })

  // A equipe. Senha sorteada agora, guardada só no arquivo do laptop.
  // O celular de cada um já vem CONFIRMADO (a chave do número, com data): é o
  // que a pessoa faria na primeira conversa com o assistente — e sem isso a
  // demonstração pelo WhatsApp começaria por "confirme o seu número".
  for (const [n, p] of demo.pessoas.entries()) {
    const senha = randomBytes(12).toString('base64url')
    const hash = await guardarSenha(senha)
    const email = `${p.login}@${slug}.test`
    const loja = p.loja ?? null
    const telefone = `${demo.ddd}98${String(DEMOS_ORDEM.indexOf(demo.ramo) + 1).padStart(2, '0')}0000${n + 1}`
    const id = await naEmpresa(orgId, async (db) => {
      const u = await db.usuario.create({
        data: {
          orgId, nome: p.nome, email, senhaHash: hash, criadoEm: criadaEm, sessoesDesde: criadaEm,
          telefone, telefoneConfirmado: chaveTelefone(telefone), telefoneConfirmadoEm: criadaEm,
        },
        select: { id: true },
      })
      await db.acesso.create({
        data: { orgId, usuarioId: u.id, unidadeId: loja === null ? null : lojas[loja]!.id, papel: p.papel, criadoEm: criadaEm },
      })
      return u.id
    })
    pessoas.push({
      id, nome: p.nome, email, papel: p.papel, loja, senha,
      sessao: { orgId, usuarioId: id, nome: p.nome, acessos: [{ papel: p.papel, unidadeId: loja === null ? null : lojas[loja]!.id }] },
    })
  }

  const dono = pessoas.find((p) => p.papel === 'DONO')!
  const balcao = pessoas.find((p) => p.papel === 'BALCAO')!
  const gerente = pessoas.find((p) => p.papel === 'GERENTE') ?? null

  return {
    demo, slug, orgId, modulos, lojas, pessoas, dono, balcao, gerente, dado, agora, hoje, inicio,
    vars: [], clientes: [], colabs: [], categoriaFin: new Map(), contas: { banco: '', caixa: '' }, dias,
  }
}

// ─────────────────────────────────────────────────────────────
// 2. O CADASTRO: catálogo, clientes, quem trabalha, financeiro
// ─────────────────────────────────────────────────────────────

async function cadastrar(c: Ctx) {
  const { demo, orgId, dono } = c

  // As opções que o dono acrescenta às grades do ramo (os sabores), e a cor
  // de cada uma — a bolinha colorida no balcão.
  const eixos = await naEmpresa(orgId, async (db) => {
    for (const [nomeEixo, opcoes] of Object.entries(demo.opcoes ?? {})) {
      const eixo = await db.eixo.findFirst({ where: { nome: nomeEixo }, select: { id: true } })
      if (!eixo) throw new Error(`O ramo ${demo.ramo} não semeou a grade "${nomeEixo}".`)
      for (const [i, o] of opcoes.entries()) {
        const ja = await db.opcao.findFirst({ where: { eixoId: eixo.id, valor: o.valor }, select: { id: true } })
        if (ja) await db.opcao.update({ where: { id: ja.id }, data: { hex: o.hex ?? null } })
        else await db.opcao.create({ data: { orgId, eixoId: eixo.id, valor: o.valor, ordem: 100 + i, hex: o.hex ?? null } })
      }
    }
    return db.eixo.findMany({ orderBy: { ordem: 'asc' }, select: { id: true, nome: true, opcoes: { select: { id: true, valor: true } } } })
  })
  const categorias = await naEmpresa(orgId, (db) => db.categoria.findMany({ select: { id: true, nome: true } }))
  const catId = new Map(categorias.map((x) => [x.nome, x.id]))

  // O catálogo, pela função da tela de produto.
  const produtoIds = new Map<string, string>()
  for (const p of demo.produtos) {
    const escolhidos = eixos
      .filter((e) => p.eixos?.[e.nome])
      .map((e) => ({
        eixoId: e.id,
        opcaoIds: p.eixos![e.nome]!.map((v) => {
          const o = e.opcoes.find((x) => x.valor === v)
          if (!o) throw new Error(`Opção "${v}" não existe na grade ${e.nome}.`)
          return o.id
        }),
      }))
    const categoriaId = catId.get(p.categoria)
    if (!categoriaId) throw new Error(`A categoria "${p.categoria}" não existe no ramo ${demo.ramo}.`)
    // O padrão da gaveta, como a ficha de produto marca sozinha; o item diz
    // se é diferente. Material que "vende" seria a incoerência que isto veio
    // tirar: o script recusa.
    const marcas = marcasDaGaveta([demo.ramo], p.categoria)
    const usoInterno = p.uso ?? marcas.usoInterno
    if (usoInterno && p.peso > 0) throw new Error(`${p.nome} é material de uso e não pode ter venda (peso ${p.peso}).`)
    const r = await criarProduto(
      dono.sessao,
      {
        nome: p.nome, marca: p.marca ?? null, categoriaId, medida: p.medida,
        precoVista: p.vista, precoCartao: p.cartao ?? p.vista, precoCrediario: p.crediario ?? p.cartao ?? p.vista,
        custo: p.custo ?? null, prazoReposicaoDias: p.prazo ?? null, servico: !!p.servico, duracaoMin: p.duracaoMin ?? null,
        usoInterno, feitoNoDia: !!p.producao,
      },
      escolhidos,
    )
    if (!r.ok) throw new Error(`criarProduto(${p.nome}): ${r.motivo}`)
    produtoIds.set(p.nome, r.produtoId)
  }

  // As variações, com o rótulo das opções na ordem das grades ("M · Preto").
  const ordemEixo = new Map(eixos.map((e, i) => [e.nome, i]))
  const linhas = await naEmpresa(orgId, async (db) => {
    await db.produto.updateMany({ data: { criadoEm: em(c.inicio, 7 * 60) } })
    return db.variacao.findMany({
      select: {
        id: true, produtoId: true, codigo: true,
        opcoes: { select: { opcao: { select: { valor: true, eixo: { select: { nome: true } } } } } },
      },
    })
  })
  const porNome = new Map(demo.produtos.map((p) => [produtoIds.get(p.nome)!, p]))
  c.vars = linhas.map((v) => {
    const produto = porNome.get(v.produtoId)!
    const opcoes = v.opcoes
      .map((o) => ({ valor: o.opcao.valor, ordem: ordemEixo.get(o.opcao.eixo.nome) ?? 0 }))
      .sort((a, b) => a.ordem - b.ordem)
      .map((o) => o.valor)
    const rotulo = opcoes.join(' · ')
    const peso = produto.peso * opcoes.reduce((s, o) => s * (demo.pesoOpcao?.[o] ?? 1), 1) / Math.max(1, contarVariacoes(produto))
    return {
      id: v.id, produto, produtoId: v.produtoId, rotulo, opcoes, codigo: v.codigo, peso,
      descricao: rotulo ? `${produto.nome} — ${rotulo}` : produto.nome,
    }
  })

  // Quem trabalha: as profissionais da agenda e a equipe do ponto.
  for (const p of demo.profissionais ?? []) {
    const usuario = p.login === 'balcao' ? c.balcao.id : null
    const r = await salvarColaborador(dono.sessao, {
      nome: p.nome, cargo: p.cargo, unidadeId: c.lojas[0]!.id, usuarioId: usuario,
      atende: p.atende ?? true, jornadaMin: p.jornada ?? [],
    })
    if (!r.ok) throw new Error(`salvarColaborador(${p.nome}): ${r.erro}`)
    c.colabs.push({ id: r.id, demo: p })
  }

  // Clientes, pela ficha da tela — com o aceite de ofertas no WhatsApp
  // variado de propósito: quem aceitou, quem recusou (e foi para a lista de
  // quem não recebe) e quem ninguém perguntou ainda, que é o caso comum.
  const d = c.dado
  for (const [i, cl] of demo.clientes.entries()) {
    const telefone = `${demo.ddd}90000${String(i + 1).padStart(4, '0')}`
    const r = d()
    const aceite =
      r < 0.45 ? { valor: 'SIM' as const, origem: d.chance(0.7) ? 'balcao' : 'telefone' }
      : r < 0.62 ? { valor: 'NAO' as const, origem: 'balcao' }
      : null
    const desde = d.inteiro(0, 20)
    const quando = em(somarDias(c.inicio, desde), 10 * 60)
    const res = await criarCliente(
      dono.sessao,
      {
        nome: cl.nome,
        telefone,
        observacoes: cl.obs ?? null,
        email: d.chance(0.3) ? `${cl.nome.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${i + 1}@email.test` : null,
        nascimento: d.chance(0.35) ? colunaDoDia(`${d.inteiro(1958, 2004)}-${String(d.inteiro(1, 12)).padStart(2, '0')}-${String(d.inteiro(1, 28)).padStart(2, '0')}`) : null,
        cidade: demo.lojas[0]!.cidade,
        estado: demo.lojas[0]!.estado,
      },
      aceite,
      quando,
    )
    if (!res.ok) throw new Error(`criarCliente(${cl.nome}): ${res.motivo}`)
    // Quem "sumiu" compra só no começo; quem é novo, só no fim.
    const sumido = i % 7 === 3
    const novo = i % 9 === 5
    c.clientes.push({
      id: res.clienteId, nome: cl.nome, telefone,
      peso: i < 3 ? 4 : i < 8 ? 2 : 1,
      desde: novo ? c.dias - 12 : desde,
      ate: sumido ? 22 : c.dias,
    })
    await naEmpresa(c.orgId, (db) => db.cliente.update({ where: { id: res.clienteId }, data: { criadoEm: quando } }))
  }

  // O financeiro nasce com as categorias e contas de toda empresa.
  await prepararFinanceiro(dono.sessao)
  const fin = await naEmpresa(orgId, async (db) => ({
    cats: await db.categoriaFinanceira.findMany({ select: { id: true, nome: true } }),
    contas: await db.contaFinanceira.findMany({ select: { id: true, tipo: true } }),
  }))
  c.categoriaFin = new Map(fin.cats.map((x) => [x.nome, x.id]))
  c.contas = {
    banco: fin.contas.find((x) => x.tipo === 'BANCO')!.id,
    caixa: fin.contas.find((x) => x.tipo === 'CAIXA')!.id,
  }

  // O que a maquininha cobra: é o que faz o DRE descontar a taxa sozinho.
  await salvarTaxas(dono.sessao, [
    { forma: 'PIX', parcelas: 1, percentual: demo.taxas.pix },
    { forma: 'DEBITO', parcelas: 1, percentual: demo.taxas.debito },
    { forma: 'CREDITO', parcelas: 1, percentual: demo.taxas.credito },
    { forma: 'CREDITO', parcelas: 2, percentual: demo.taxas.parcelado },
  ])
}

function contarVariacoes(p: ProdutoDemo) {
  return Object.values(p.eixos ?? {}).reduce((n, o) => n * o.length, 1)
}

// ─────────────────────────────────────────────────────────────
// 3. O PASSADO — sessenta dias de movimento
// ─────────────────────────────────────────────────────────────

type Evento = { quando: Date; variacaoId: string; unidade: number; delta: number; tipo: TipoMovimento; motivo: string; referencia: string | null; quem: Pessoa | null }

type ItemV = { id: string; v: Var; qtd: number; precoCent: number; totalCent: number }
type VendaV = {
  id: string
  loja: number
  dia: string
  quando: Date
  numero: number
  vendedor: Pessoa
  cliente: Cli | null
  itens: ItemV[]
  subtotalCent: number
  descontoCent: number
  totalCent: number
  pagamentos: { forma: FormaPagamento; valorCent: number; parcelas: number }[]
  cancelada: { quando: Date; motivo: string } | null
  caixa: string
  agendamento?: string
}
type Turno = {
  id: string
  loja: number
  dia: string
  abre: Date
  fecha: Date | null
  quem: Pessoa
  abertura: number
  sangrias: { quando: Date; valorCent: number; motivo: string; quem: string }[]
  dinheiroCent: number
  recebidoCent: number
}

/** As janelas de funcionamento da loja num dia, em minutos. */
function janelas(loja: Loja, dia: string): [number, number][] {
  if (!loja.horario) return [[8 * 60, 20 * 60]]
  return [...(loja.horario[semanaDe(dia)] ?? [])].sort((a, b) => a[0] - b[0])
}

async function historico(c: Ctx) {
  const { demo, dado: d, lojas, agora, hoje } = c
  const agoraMs = agora.getTime()
  const eventos: Evento[] = []
  const vendas: VendaV[] = []
  const turnos = new Map<string, Turno>()
  // Só quem vende: o financeiro da escola não abre caixa nem faz venda.
  const vendedores = (loja: number) => {
    const daLoja = c.pessoas.filter((p) => (p.papel === 'BALCAO' || p.papel === 'GERENTE') && (p.loja === null || p.loja === loja))
    return [...daLoja.flatMap((p) => [p, p, p]), c.dono]
  }
  const dias: string[] = []
  for (let i = 0; i <= c.dias; i++) dias.push(somarDias(c.inicio, i))

  // ── os turnos de caixa: um por loja por dia aberto ──
  for (const dia of dias) {
    for (const [li, loja] of lojas.entries()) {
      const js = janelas(loja, dia)
      if (js.length === 0) continue
      const abre = em(dia, js[0]![0] - 15)
      if (abre.getTime() > agoraMs) continue
      const fechaMin = js[js.length - 1]![1] + 10
      // O turno de hoje só fica aberto se a loja ainda está aberta: rodando à
      // noite, a gaveta de hoje já foi contada e fechada, como na loja.
      const fechaEm = em(dia, fechaMin)
      const fecha = fechaEm.getTime() > agoraMs ? null : fechaEm
      const quem = d.chance(0.8) ? d.um(vendedores(li).filter((p) => p.papel !== 'DONO')) ?? c.dono : c.dono
      turnos.set(`${li}|${dia}`, {
        id: novoId(), loja: li, dia, abre, fecha, quem, abertura: demo.ramo === 'padaria' ? 200 : demo.ramo === 'sorveteria' ? 100 : 150,
        sangrias: [], dinheiroCent: 0, recebidoCent: 0,
      })
    }
  }
  /** Um minuto de venda dentro do horário, com o peso das horas do ramo. */
  const minutoDeVenda = (loja: Loja, dia: string): number | null => {
    const js = janelas(loja, dia)
    if (js.length === 0) return null
    const candidatos: number[] = []
    for (const [a, b] of js) for (let m = a; m < b; m += 15) candidatos.push(m)
    const m = d.pesado(candidatos, (x) => demo.horas[Math.floor(x / 60)] ?? 0.3)
    return m + d.inteiro(0, 14)
  }

  const escolherCliente = (i: number): Cli | null => {
    const vivos = c.clientes.filter((x) => i >= x.desde && i <= x.ate)
    return vivos.length ? d.pesado(vivos, (x) => x.peso) : null
  }
  // Serviço vende pela agenda; material de uso não vende (peso zero, conferido no cadastro).
  const vendaveis = c.vars.filter((v) => v.peso > 0 && !v.produto.servico)
  const formaSorteada = () => d.pesado(demo.formas, (f) => f[1])[0]

  const montarItens = (lista: { v: Var; qtd: number }[], tabela: 'vista' | 'cartao' | 'crediario'): ItemV[] =>
    lista.map(({ v, qtd }) => {
      const p = v.produto
      const preco = tabela === 'crediario' ? (p.crediario ?? p.cartao ?? p.vista) : tabela === 'cartao' ? (p.cartao ?? p.vista) : p.vista
      const precoCent = centavos(preco)
      return { id: novoId(), v, qtd, precoCent, totalCent: multiplicar(precoCent, qtd) }
    })

  const quantidade = (v: Var) => {
    const [a, b] = v.produto.qtd ?? [1, 1]
    if (v.produto.medida === 'KG') return r3(d.entre(a, b))
    return d.chance(0.8) ? a : d.inteiro(a, b)
  }

  const novaVenda = (li: number, dia: string, quando: Date, itensEscolhidos: { v: Var; qtd: number }[], cliente: Cli | null, opcoes: { vendedor?: Pessoa; agendamento?: string } = {}): VendaV | null => {
    const turno = turnos.get(`${li}|${dia}`)
    if (!turno || quando < turno.abre || quando.getTime() > agoraMs - 60_000) return null
    let forma = formaSorteada()
    const fiado = !!cliente && c.modulos.includes('crediario') && d.chance(demo.crediario ?? 0)
    if (fiado) forma = 'CREDIARIO'
    const tabela = forma === 'CREDIARIO' ? 'crediario' : forma === 'CREDITO' ? 'cartao' : 'vista'
    const itens = montarItens(itensEscolhidos, tabela)
    const subtotalCent = itens.reduce((s, i) => s + i.totalCent, 0)
    const descontoCent = tabela === 'vista' && d.chance(demo.desconto ?? 0) ? Math.floor(subtotalCent * 0.05) : 0
    const totalCent = subtotalCent - descontoCent
    let pagamentos: VendaV['pagamentos']
    if (forma === 'CREDIARIO') {
      pagamentos = [{ forma, valorCent: totalCent, parcelas: Math.min(d.inteiro(2, 5), 6) }]
    } else if (forma === 'CREDITO') {
      pagamentos = [{ forma, valorCent: totalCent, parcelas: totalCent > 15_000 && d.chance(0.5) ? d.inteiro(2, 3) : 1 }]
    } else if (tabela === 'vista' && totalCent > 3_000 && d.chance(0.05)) {
      // Metade no Pix, o resto em dinheiro: a lista de pagamentos existe por isso.
      const pix = Math.floor(totalCent / 2 / 100) * 100
      pagamentos = [{ forma: 'PIX', valorCent: pix, parcelas: 1 }, { forma: 'DINHEIRO', valorCent: totalCent - pix, parcelas: 1 }]
    } else {
      pagamentos = [{ forma, valorCent: totalCent, parcelas: 1 }]
    }
    const v: VendaV = {
      id: novoId(), loja: li, dia, quando, numero: 0,
      vendedor: opcoes.vendedor ?? d.um(vendedores(li)),
      cliente, itens, subtotalCent, descontoCent, totalCent, pagamentos,
      cancelada: null, caixa: turno.id, agendamento: opcoes.agendamento,
    }
    vendas.push(v)
    return v
  }

  // ── a agenda do passado (salão, clínica): cada horário atendido vira venda ──
  type HorarioV = { id: string; colab: Colab; loja: number; cliente: Cli | null; nome: string; telefone: string | null; v: Var; inicio: Date; fim: Date; situacao: SituacaoAgendamento; motivo: string | null; obs: string | null; venda: string | null; quem: Pessoa }
  const horarios: HorarioV[] = []
  const servicoDe = new Map(c.vars.filter((v) => v.produto.servico).map((v) => [v.produto.nome, v]))
  const avulsos = ['Cliente sem cadastro', 'Visitante', 'Encaixe do dia']
  const turnoDoColab = (colab: Colab, dia: string, loja: Loja): [number, number][] => {
    const p = colab.demo
    if (p.dias && !p.dias.includes(semanaDe(dia))) return []
    const js = janelas(loja, dia)
    if (js.length === 0) return []
    if (!p.de || !p.ate) return js
    return js.map(([a, b]) => [Math.max(a, minutos(p.de!)), Math.min(b, minutos(p.ate!))] as [number, number]).filter(([a, b]) => b - a >= 15)
  }
  const deixarParaAgora: { colab: Colab; dia: string; min: number }[] = []
  let reservado = false
  for (const [i, dia] of dias.entries()) {
    for (const colab of c.colabs) {
      if (!colab.demo.servicos.length || colab.demo.atende === false) continue
      const loja = lojas[0]!
      for (const [a, b] of turnoDoColab(colab, dia, loja)) {
        let cursor = a + d.inteiro(0, 2) * 15
        while (cursor < b) {
          const v = servicoDe.get(d.um(colab.demo.servicos))
          if (!v) break
          const dur = v.produto.duracaoMin ?? 30
          if (cursor + dur > b) break
          const inicio = em(dia, cursor)
          const fim = em(dia, cursor + dur)
          if (fim.getTime() > agoraMs - 5 * 60_000) {
            // Daqui para frente é agenda de verdade, marcada pela tela.
            if (dia === hoje) deixarParaAgora.push({ colab, dia, min: cursor })
            break
          }
          if (!d.chance(colab.demo.ocupacao ?? 0.7)) {
            cursor += 15 * d.inteiro(1, 3)
            continue
          }
          const cliente = d.chance(demo.comCliente) ? escolherCliente(i) : null
          const r = d()
          const situacao: SituacaoAgendamento = r < 0.84 ? 'ATENDIDO' : r < 0.91 ? 'FALTOU' : 'CANCELADO'
          const h: HorarioV = {
            id: novoId(), colab, loja: 0, cliente,
            nome: cliente?.nome ?? d.um(avulsos), telefone: cliente?.telefone ?? null,
            v, inicio, fim, situacao,
            motivo: situacao === 'CANCELADO' ? d.um(['A cliente remarcou', 'Imprevisto no trabalho', 'Desmarcou pelo WhatsApp']) : null,
            obs: d.chance(0.12) ? d.um(demo.observacoesAgenda ?? ['']) || null : null,
            venda: null, quem: d.chance(0.8) ? c.balcao : c.dono,
          }
          // O último atendimento que acabou de sair hoje fica confirmado e sem
          // cobrar: é o que a venda de agora cobra, pelo "Atender e cobrar".
          if (situacao === 'ATENDIDO' && dia === hoje && !reservado && fim.getTime() > agoraMs - 90 * 60_000) {
            reservado = true
            h.situacao = 'CONFIRMADO'
          } else if (situacao === 'ATENDIDO') {
            const lista: { v: Var; qtd: number }[] = [{ v, qtd: 1 }]
            if (d.chance(demo.levaProduto ?? 0) && vendaveis.length) {
              const extra = d.pesado(vendaveis, (x) => x.peso)
              lista.push({ v: extra, qtd: 1 })
            }
            const venda = novaVenda(0, dia, new Date(fim.getTime() + d.inteiro(1, 6) * 60_000), lista, cliente, { vendedor: d.chance(0.85) ? c.balcao : c.dono, agendamento: h.id })
            if (venda) h.venda = venda.id
            else h.situacao = 'CONFIRMADO' // passou da hora de fechar o caixa: fica para cobrar agora
          }
          horarios.push(h)
          cursor += dur + d.um([0, 0, 0, 10, 15])
        }
      }
    }
  }

  // ── o balcão ──
  for (const [i, dia] of dias.entries()) {
    for (const [li, loja] of lojas.entries()) {
      if (!turnos.has(`${li}|${dia}`)) continue
      // Quem vive de agenda (salão, clínica) tem poucas vendas avulsas no dia;
      // o pet shop tem o banho na agenda E o balcão cheio de ração.
      const avulsas = demo.avulsasPorDia !== undefined
      const base = avulsas ? demo.avulsasPorDia! : demo.vendasPorDia * loja.fatia / lojas.reduce((s, l) => s + l.fatia, 0)
      const fatorSemana = demo.semana[semanaDe(dia)] ?? 1
      const quantas = Math.round(base * (avulsas ? 1 : fatorSemana) * d.entre(0.75, 1.25))
      for (let k = 0; k < quantas; k++) {
        const min = minutoDeVenda(loja, dia)
        if (min === null) continue
        const quando = em(dia, min)
        const n = d.inteiro(demo.itens[0], demo.itens[1])
        const lista: { v: Var; qtd: number }[] = []
        for (let j = 0; j < n; j++) {
          const v = d.pesado(vendaveis, (x) => x.peso)
          if (lista.some((x) => x.v.id === v.id)) continue
          lista.push({ v, qtd: quantidade(v) })
        }
        if (!lista.length) continue
        novaVenda(li, dia, quando, lista, d.chance(demo.comCliente) ? escolherCliente(i) : null)
      }
    }
  }

  // ── numeração: sequencial por loja, na ordem em que aconteceu ──
  vendas.sort((a, b) => a.quando.getTime() - b.quando.getTime())
  const proxima = lojas.map(() => 1)
  for (const v of vendas) v.numero = proxima[v.loja]!++

  const turnoDe = (li: number, dia: string) => turnos.get(`${li}|${dia}`)
  /** O próximo instante com a loja aberta, a partir de um dia (para devolver, receber). */
  const proximoAberto = (li: number, desde: string, depoisDe: Date): { dia: string; quando: Date } | null => {
    for (let k = 0; k < 20; k++) {
      const dia = somarDias(desde, k)
      if (dia > hoje) return null
      const t = turnoDe(li, dia)
      if (!t) continue
      const js = janelas(lojas[li]!, dia)
      const [a, b] = d.um(js)
      const quando = em(dia, d.inteiro(a + 10, Math.max(a + 10, b - 20)))
      if (quando <= depoisDe || quando.getTime() > agoraMs - 60_000) continue
      return { dia, quando }
    }
    return null
  }

  // ── cancelamentos: a venda lançada errado, desfeita minutos depois ──
  for (const v of vendas) {
    if (v.agendamento || !d.chance(demo.cancelamentos)) continue
    const quando = new Date(v.quando.getTime() + d.inteiro(3, 25) * 60_000)
    if (quando.getTime() > agoraMs - 60_000) continue
    v.cancelada = { quando, motivo: d.um(['Cliente desistiu na hora de pagar', 'Lançada em dobro', 'Valor passado errado na maquininha', 'Item errado no pedido']) }
  }

  // ── devoluções e trocas: parte da sacola volta, dias depois ──
  type DevolucaoV = { id: string; venda: VendaV; quando: Date; dia: string; destino: 'VALE' | 'DINHEIRO' | 'ESTORNO'; itens: { item: ItemV; qtd: number; valorCent: number }[]; valorCent: number; motivo: string; vale: { id: string; codigo: string; validade: Date } | null }
  const devolucoes: DevolucaoV[] = []
  const codigos = new Set<string>()
  for (const v of vendas) {
    if (v.cancelada || v.agendamento || v.pagamentos.some((p) => p.forma === 'CREDIARIO')) continue
    if (!d.chance(demo.devolucoes)) continue
    const devolviveis = v.itens.filter((i) => !i.v.produto.servico && i.v.produto.medida !== 'KG')
    if (!devolviveis.length) continue
    const alvo = proximoAberto(v.loja, somarDias(v.dia, d.inteiro(1, 8)), v.quando)
    if (!alvo) continue
    const item = d.um(devolviveis)
    const qtd = 1
    const fator = v.subtotalCent > 0 ? v.totalCent / v.subtotalCent : 1
    const valorCent = valorDevolvidoCent(item.precoCent, qtd, fator)
    const destinos: NonNullable<Demo['destinos']> = demo.destinos ?? [['DINHEIRO', 1]]
    let destino = d.pesado(destinos, (x) => x[1])[0]
    if (destino === 'VALE' && !v.cliente) destino = 'ESTORNO'
    let vale: DevolucaoV['vale'] = null
    if (destino === 'VALE') {
      let codigo = gerarCodigoDeVale(d)
      while (codigos.has(codigo)) codigo = gerarCodigoDeVale(d)
      codigos.add(codigo)
      vale = { id: novoId(), codigo, validade: colunaDoDia(somarDias(alvo.dia, VALE_DIAS)) }
    }
    const dev: DevolucaoV = {
      id: novoId(), venda: v, quando: alvo.quando, dia: alvo.dia, destino, itens: [{ item, qtd, valorCent }], valorCent, vale,
      motivo: d.um(demo.ramo === 'roupa' ? ['Não serviu, trocou pelo tamanho maior', 'Não gostou do caimento', 'Presente: trocou por outra cor'] : ['Produto errado: levou o porte errado', 'Embalagem veio aberta', 'Cliente se arrependeu']),
    }
    devolucoes.push(dev)
    if (destino === 'DINHEIRO') {
      turnoDe(v.loja, alvo.dia)!.sangrias.push({ quando: alvo.quando, valorCent, motivo: `Devolução da venda ${v.numero}`, quem: c.balcao.nome })
    }
  }

  // ── crediário: as parcelas nascem da venda, e o recebimento vem depois ──
  type ParcelaV = { id: string; venda: VendaV; numero: number; de: number; vencimento: Date; valorCent: number; pagoCent: number; jurosCent: number; jurosAte: Date | null; quitadaEm: Date | null }
  type RecebimentoV = { id: string; parcela: ParcelaV; caixa: string | null; forma: FormaPagamento; valorCent: number; jurosCent: number; quando: Date; quem: string }
  const parcelas: ParcelaV[] = []
  const recebimentos: RecebimentoV[] = []
  for (const v of vendas) {
    const fiado = v.pagamentos.find((p) => p.forma === 'CREDIARIO')
    if (!fiado || v.cancelada) continue
    for (const x of montarParcelas(fiado.valorCent, fiado.parcelas, v.quando, 30)) {
      const p: ParcelaV = { id: novoId(), venda: v, numero: x.numero, de: x.de, vencimento: x.vencimento, valorCent: x.valorCent, pagoCent: 0, jurosCent: 0, jurosAte: null, quitadaEm: null }
      parcelas.push(p)
      const venc = x.vencimento.toISOString().slice(0, 10)
      if (venc > hoje) continue
      // Quem paga em dia, quem paga atrasado (com juros) e quem ainda deve.
      const r = d()
      if (r > 0.85) continue
      const atraso = r < 0.7 ? d.inteiro(-3, 0) : d.inteiro(5, 25)
      const alvo = proximoAberto(v.loja, somarDias(venc, atraso), v.quando)
      if (!alvo) continue
      const parcial = d.chance(0.06)
      const principal = parcial ? Math.floor(p.valorCent / 2) : p.valorCent
      const juros = jurosDeAtraso(principal, diasDeAtraso(x.vencimento, alvo.quando), 3)
      const forma: FormaPagamento = d.chance(0.5) ? 'DINHEIRO' : 'PIX'
      const turno = turnoDe(v.loja, alvo.dia)!
      recebimentos.push({ id: novoId(), parcela: p, caixa: forma === 'DINHEIRO' ? turno.id : null, forma, valorCent: principal + juros, jurosCent: juros, quando: alvo.quando, quem: turno.quem.nome })
      if (forma === 'DINHEIRO') turno.recebidoCent += principal + juros
      p.pagoCent = principal
      p.jurosCent = juros
      // Até onde o juro já foi cobrado: o próximo conta daqui (crediario.ts).
      if (juros > 0) p.jurosAte = colunaDoDia(alvo.dia)
      p.quitadaEm = parcial ? null : alvo.quando
    }
  }

  // ── o estoque: cada venda, cancelamento e devolução deixa o seu movimento ──
  const quemDe = (v: VendaV) => v.vendedor
  for (const v of vendas) {
    for (const it of v.itens) {
      if (it.v.produto.servico) continue
      eventos.push({ quando: v.quando, variacaoId: it.v.id, unidade: v.loja, delta: -it.qtd, tipo: 'VENDA', motivo: `Venda ${v.numero}`, referencia: v.id, quem: quemDe(v) })
      if (v.cancelada) {
        eventos.push({ quando: v.cancelada.quando, variacaoId: it.v.id, unidade: v.loja, delta: it.qtd, tipo: 'DEVOLUCAO', motivo: `Cancelamento da venda ${v.numero}`, referencia: v.id, quem: quemDe(v) })
      }
    }
  }
  for (const dv of devolucoes) {
    for (const x of dv.itens) {
      eventos.push({ quando: dv.quando, variacaoId: x.item.v.id, unidade: dv.venda.loja, delta: x.qtd, tipo: 'DEVOLUCAO', motivo: `Devolução da venda ${dv.venda.numero}`, referencia: dv.venda.id, quem: c.balcao })
    }
  }

  // ── o material de uso: sai toda semana, pela recepção ──
  for (const v of c.vars.filter((x) => x.produto.consumo)) {
    const porVar = (v.produto.consumo ?? 0) * (demo.pesoOpcao?.[v.opcoes[0] ?? ''] ?? 1)
    for (const dia of dias) {
      if (semanaDe(dia) !== 6 || dia === hoje) continue
      const q = Math.max(0, Math.round(porVar * d.entre(0.6, 1.4)))
      if (q <= 0) continue
      const t = turnoDe(0, dia)
      if (!t) continue
      eventos.push({ quando: new Date(t.abre.getTime() + 30 * 60_000), variacaoId: v.id, unidade: 0, delta: -q, tipo: 'CONSUMO', motivo: 'Material usado na semana', referencia: null, quem: c.balcao })
    }
  }

  // ── a produção do dia (padaria): entra de manhã, a sobra sai à noite ──
  const produzidos = c.vars.filter((v) => v.produto.producao)
  if (produzidos.length) {
    for (const [li] of lojas.entries()) {
      for (const dia of dias) {
        const t = turnoDe(li, dia)
        if (!t) continue
        for (const v of produzidos) {
          const doDia = eventos.filter((e) => e.variacaoId === v.id && e.unidade === li && e.quando >= t.abre && diaEmSP(e.quando) === dia)
          // A produção cobre o que SAIU no dia (inclusive o que foi cancelado
          // depois e voltou): senão o saldo ficaria negativo no meio da tarde.
          const saiu = -doDia.filter((e) => e.delta < 0).reduce((s, e) => s + e.delta, 0)
          const vendido = -doDia.reduce((s, e) => s + e.delta, 0)
          const kg = v.produto.medida === 'KG'
          const feito = kg ? Math.ceil(Math.max(1, saiu * d.entre(1.05, 1.18)) * 2) / 2 : Math.ceil(Math.max(2, saiu * d.entre(1.05, 1.2)))
          const cedo = new Date(t.abre.getTime() - 30 * 60_000)
          eventos.push({ quando: cedo, variacaoId: v.id, unidade: li, delta: feito, tipo: 'ENTRADA', motivo: 'Produção do dia', referencia: null, quem: c.dono })
          if (t.fecha) {
            const sobra = r3(feito - vendido)
            if (sobra > 0) eventos.push({ quando: new Date(t.fecha.getTime() - 5 * 60_000), variacaoId: v.id, unidade: li, delta: -sobra, tipo: 'PERDA', motivo: 'Sobra do dia (doada)', referencia: null, quem: t.quem })
          }
        }
      }
    }
  }

  // ── a carga inicial e a reposição do meio do mês ──
  // O saldo de cada item termina onde a demonstração precisa (o M preto
  // acabou, o Cajá está no fim, o resto folgado), e para isso a entrada é
  // calculada DEPOIS das saídas: carga = o que saiu até a reposição; a
  // reposição = o que saiu depois + o saldo final desejado. Assim o saldo
  // nunca fica negativo no caminho, como numa loja de verdade.
  const meio = somarDias(c.inicio, Math.floor(c.dias / 2))
  const fornecedorDe: Record<string, string> = {
    roupa: 'Confecções Serra Azul', sorveteria: 'Laticínios Serra do Mel', padaria: 'Laticínios Vale Verde',
    petshop: 'Distribuidora Pet Sertão', beleza: 'Distribuidora Bela Cor', saude: 'Cirúrgica Vale do Sol',
    escola: 'Uniformes Bom Aluno',
  }
  const saldosFinais: { variacaoId: string; unidade: number; quantidade: number; minimo: number | null }[] = []
  for (const v of c.vars) {
    if (v.produto.servico) continue
    for (const [li] of lojas.entries()) {
      const minimo = v.produto.minimo ?? null
      if (v.produto.producao) {
        const saldo = r3(eventos.filter((e) => e.variacaoId === v.id && e.unidade === li).reduce((s, e) => s + e.delta, 0))
        saldosFinais.push({ variacaoId: v.id, unidade: li, quantidade: saldo, minimo })
        continue
      }
      const meus = eventos.filter((e) => e.variacaoId === v.id && e.unidade === li)
      const corteMeio = em(meio, 6 * 60)
      const antes = meus.filter((e) => e.quando < corteMeio)
      const depois = meus.filter((e) => e.quando >= corteMeio)
      // O pior ponto de cada metade (a maior saída acumulada) é o que a entrada tem de cobrir.
      const pior = (lista: Evento[]) => {
        let s = 0
        let min = 0
        for (const e of [...lista].sort((a, b) => a.quando.getTime() - b.quando.getTime())) {
          s += e.delta
          if (s < min) min = s
        }
        return { fundo: -min, liquido: s }
      }
      const a = pior(antes)
      const b = pior(depois)
      const kg = v.produto.medida === 'KG'
      const rot = v.rotulo
      const alvoFinal =
        v.produto.acabou?.includes(rot) ? 0
        : v.produto.pouco?.includes(rot) ? (minimo ? (kg ? r3(minimo * d.entre(0.2, 0.6)) : Math.max(1, Math.floor(minimo * d.entre(0.3, 0.7)))) : 1)
        : minimo ? (kg ? r3(minimo * d.entre(2.5, 5)) : Math.ceil(minimo * d.entre(2, 4))) : kg ? 8 : d.inteiro(4, 10)
      // O que termina zerado ou no fim não ganha folga: a folga sobraria no saldo.
      const apertado = !!(v.produto.acabou?.includes(rot) || v.produto.pouco?.includes(rot))
      const folga = apertado ? 0 : kg ? r3(d.entre(0.5, 2)) : d.inteiro(1, 3)
      const carga = r3(a.fundo + folga)
      // saldo na virada = carga + a.liquido; a reposição cobre o pior da segunda metade e deixa o alvo.
      const naVirada = r3(carga + a.liquido)
      const reposicao = r3(Math.max(b.fundo - naVirada, 0, alvoFinal - naVirada - b.liquido))
      const inicioEm = em(c.inicio, 6 * 60 + li)
      eventos.push({ quando: inicioEm, variacaoId: v.id, unidade: li, delta: kg ? carga : Math.ceil(carga), tipo: 'ENTRADA', motivo: 'Estoque de abertura (contagem inicial)', referencia: null, quem: c.dono })
      if (reposicao > 0) {
        eventos.push({ quando: corteMeio, variacaoId: v.id, unidade: li, delta: kg ? reposicao : Math.ceil(reposicao), tipo: 'ENTRADA', motivo: `Entrada de mercadoria — ${fornecedorDe[demo.ramo] ?? 'fornecedor'}`, referencia: null, quem: c.dono })
      }
      const saldo = r3(eventos.filter((e) => e.variacaoId === v.id && e.unidade === li).reduce((s, e) => s + e.delta, 0))
      saldosFinais.push({ variacaoId: v.id, unidade: li, quantidade: saldo, minimo })
    }
  }

  // ── fechar os turnos: depósito no banco e a contagem da gaveta ──
  for (const v of vendas) {
    if (v.cancelada) continue
    const t = turnos.get(`${v.loja}|${v.dia}`)!
    t.dinheiroCent += v.pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((s, p) => s + p.valorCent, 0)
  }
  const caixaMovs: { id: string; caixaId: string; tipo: 'SANGRIA' | 'SUPRIMENTO'; valorCent: number; motivo: string; quem: string; quando: Date }[] = []
  const caixas: { id: string; unidadeId: string; aberto: boolean; abertoPorId: string; abertoPor: string; abertoEm: Date; saldoAbertura: number; fechadoPor: string | null; fechadoEm: Date | null; saldoEsperado: number | null; saldoContado: number | null; observacoes: string | null }[] = []
  for (const t of turnos.values()) {
    const aberturaCent = centavos(t.abertura)
    let sangriaCent = t.sangrias.reduce((s, x) => s + x.valorCent, 0)
    for (const s of t.sangrias) caixaMovs.push({ id: novoId(), caixaId: t.id, tipo: 'SANGRIA', valorCent: s.valorCent, motivo: s.motivo, quem: s.quem, quando: s.quando })
    let esperadoCent = aberturaCent + t.dinheiroCent + t.recebidoCent - sangriaCent
    let contadoCent: number | null = null
    let obs: string | null = null
    if (t.fecha) {
      const sobra = esperadoCent - aberturaCent
      if (sobra > 30_000) {
        const deposito = Math.floor(sobra / 5_000) * 5_000
        caixaMovs.push({ id: novoId(), caixaId: t.id, tipo: 'SANGRIA', valorCent: deposito, motivo: 'Depósito no banco', quem: t.quem.nome, quando: new Date(t.fecha.getTime() - 12 * 60_000) })
        sangriaCent += deposito
        esperadoCent -= deposito
      }
      const r = d()
      const dif = r < 0.82 ? 0 : r < 0.9 ? -d.um([50, 100, 200, 500]) : r < 0.96 ? d.um([25, 50, 150]) : -d.um([1_000, 2_000])
      contadoCent = Math.max(0, esperadoCent + dif)
      if (dif < 0) obs = d.um(['Faltou troco em moeda', 'Diferença pequena, conferido duas vezes', 'Troco dado a mais numa venda do fim da tarde'])
      if (dif > 0) obs = 'Sobrou troco de moeda'
    }
    caixas.push({
      id: t.id, unidadeId: lojas[t.loja]!.id, aberto: !t.fecha, abertoPorId: t.quem.id, abertoPor: t.quem.nome, abertoEm: t.abre,
      saldoAbertura: t.abertura, fechadoPor: t.fecha ? t.quem.nome : null, fechadoEm: t.fecha,
      saldoEsperado: t.fecha ? reais(esperadoCent) : null, saldoContado: contadoCent === null ? null : reais(contadoCent), observacoes: obs,
    })
  }

  // ── gravar: uma transação por grupo, na ordem das chaves ──
  const orgId = c.orgId
  const uni = (i: number) => lojas[i]!.id
  await naEmpresa(orgId, async (db) => {
    await emFatias(caixas, (f) => db.caixa.createMany({ data: f.map((x) => ({ ...x, orgId })) }))
    await emFatias(caixaMovs, (f) => db.caixaMovimento.createMany({
      data: f.map((x) => ({ id: x.id, orgId, caixaId: x.caixaId, tipo: x.tipo, valor: reais(x.valorCent), motivo: x.motivo, quem: x.quem, criadoEm: x.quando })),
    }))
  })
  await naEmpresa(orgId, async (db) => {
    await emFatias(vendas, (f) => db.venda.createMany({
      data: f.map((v) => ({
        id: v.id, orgId, unidadeId: uni(v.loja), caixaId: v.caixa, numero: v.numero, clienteId: v.cliente?.id ?? null,
        vendedorId: v.vendedor.id, vendedorNome: v.vendedor.nome, situacao: v.cancelada ? 'CANCELADA' as const : 'CONCLUIDA' as const,
        subtotal: reais(v.subtotalCent), desconto: reais(v.descontoCent), total: reais(v.totalCent),
        criadaEm: v.quando, concluidaEm: v.quando, canceladaEm: v.cancelada?.quando ?? null, motivoCancelamento: v.cancelada?.motivo ?? null,
      })),
    }))
    const itens = vendas.flatMap((v) => v.itens.map((i) => ({ v, i })))
    await emFatias(itens, (f) => db.vendaItem.createMany({
      data: f.map(({ v, i }) => ({
        id: i.id, orgId, vendaId: v.id, variacaoId: i.v.id, descricao: i.v.descricao, codigo: i.v.codigo, medida: i.v.produto.medida,
        quantidade: i.qtd, precoUnit: reais(i.precoCent), desconto: 0, total: reais(i.totalCent),
        custoUnit: i.v.produto.custo ?? null,
      })),
    }))
    // A taxa da maquininha fica gravada no pagamento, como o balcão faz: o DRE
    // do mês passado não muda quando a taxa mudar.
    const taxas = [
      { forma: 'PIX' as const, parcelas: 1, percentual: demo.taxas.pix },
      { forma: 'DEBITO' as const, parcelas: 1, percentual: demo.taxas.debito },
      { forma: 'CREDITO' as const, parcelas: 1, percentual: demo.taxas.credito },
      { forma: 'CREDITO' as const, parcelas: 2, percentual: demo.taxas.parcelado },
    ]
    const pags = vendas.flatMap((v) => v.pagamentos.map((p) => ({ v, p })))
    await emFatias(pags, (f) => db.pagamento.createMany({
      data: f.map(({ v, p }) => ({
        id: novoId(), orgId, vendaId: v.id, forma: p.forma, valor: reais(p.valorCent), parcelas: p.parcelas,
        taxaPct: taxaDe(taxas, p.forma, p.parcelas), criadoEm: v.quando,
      })),
    }))
  })
  await naEmpresa(orgId, async (db) => {
    await emFatias(horarios, (f) => db.agendamento.createMany({
      data: f.map((h) => ({
        id: h.id, orgId, unidadeId: uni(h.loja), colaboradorId: h.colab.id, clienteId: h.cliente?.id ?? null, clienteNome: h.nome, telefone: h.telefone,
        produtoId: h.v.produtoId, servico: h.v.produto.nome, inicio: h.inicio, fim: h.fim, situacao: h.situacao, observacao: h.obs, motivo: h.motivo,
        vendaId: h.venda, quemId: h.quem.id, quem: h.quem.nome, criadoEm: new Date(h.inicio.getTime() - d.inteiro(1, 10) * 86_400_000),
      })),
    }), 200)
    const vales = devolucoes.filter((x) => x.vale)
    if (vales.length) {
      await db.vale.createMany({
        data: vales.map((x) => ({
          id: x.vale!.id, orgId, codigo: x.vale!.codigo, clienteId: x.venda.cliente?.id ?? null, valor: reais(x.valorCent), saldo: reais(x.valorCent),
          validade: x.vale!.validade, quem: c.balcao.nome, criadoEm: x.quando,
        })),
      })
    }
    for (const x of devolucoes) {
      await db.devolucao.create({
        data: {
          id: x.id, orgId, vendaId: x.venda.id, unidadeId: uni(x.venda.loja), destino: x.destino, valor: reais(x.valorCent), motivo: x.motivo,
          quem: c.balcao.nome, usuarioId: c.balcao.id, valeId: x.vale?.id ?? null, criadaEm: x.quando,
          itens: { create: x.itens.map((i) => ({ orgId, vendaItemId: i.item.id, quantidade: i.qtd, valor: reais(i.valorCent) })) },
        },
      })
    }
    await emFatias(parcelas, (f) => db.parcela.createMany({
      data: f.map((p) => ({
        id: p.id, orgId, vendaId: p.venda.id, clienteId: p.venda.cliente!.id, unidadeId: uni(p.venda.loja), numero: p.numero, de: p.de,
        vencimento: p.vencimento, valor: reais(p.valorCent), pago: reais(p.pagoCent), juros: reais(p.jurosCent), jurosAte: p.jurosAte, quitadaEm: p.quitadaEm, criadaEm: p.venda.quando,
      })),
    }))
    await emFatias(recebimentos, (f) => db.recebimento.createMany({
      data: f.map((r) => ({ id: r.id, orgId, parcelaId: r.parcela.id, caixaId: r.caixa, forma: r.forma, valor: reais(r.valorCent), juros: reais(r.jurosCent), quem: r.quem, criadoEm: r.quando })),
    }))
  })

  // O estoque: movimentos em ordem, com o saldo andando, e o saldo final igual à soma.
  eventos.sort((a, b) => a.quando.getTime() - b.quando.getTime())
  const saldo = new Map<string, number>()
  const movs = eventos.map((e) => {
    const k = `${e.variacaoId}|${e.unidade}`
    const s = r3((saldo.get(k) ?? 0) + e.delta)
    if (s < -1e-9) throw new Error(`Estoque negativo no passado: ${k} ${e.motivo} (${s}). A conta da carga está errada.`)
    saldo.set(k, s)
    return {
      id: novoId(), orgId, variacaoId: e.variacaoId, unidadeId: uni(e.unidade), tipo: e.tipo, quantidade: r3(e.delta), saldoDepois: s,
      motivo: e.motivo, referencia: e.referencia, usuarioId: e.quem?.id ?? null, quem: e.quem?.nome ?? 'sistema', criadoEm: e.quando,
    }
  })
  for (const f of saldosFinais) {
    const s = saldo.get(`${f.variacaoId}|${f.unidade}`) ?? 0
    if (Math.abs(s - f.quantidade) > 1e-6) throw new Error(`Saldo final diverge dos movimentos em ${f.variacaoId}.`)
  }
  await naEmpresa(orgId, async (db) => {
    await emFatias(movs, (f) => db.movimentoEstoque.createMany({ data: f }), 500)
    await emFatias(saldosFinais, (f) => db.estoque.createMany({
      data: f.map((x) => ({ orgId, variacaoId: x.variacaoId, unidadeId: uni(x.unidade), quantidade: x.quantidade, minimo: x.minimo })),
    }))
    // A numeração continua de onde o passado parou: a próxima venda de verdade não repete número.
    for (const [li, loja] of lojas.entries()) {
      await db.unidade.update({ where: { id: loja.id }, data: { proximaVenda: proxima[li]! } })
    }
  })

  return {
    vendas: vendas.length,
    canceladas: vendas.filter((v) => v.cancelada).length,
    devolucoes: devolucoes.length,
    parcelas: parcelas.length,
    horarios: horarios.length,
    movimentos: movs.length,
    deixarParaAgora,
  }
}

// ─────────────────────────────────────────────────────────────
// 4. O PRESENTE — pelas funções das telas
// ─────────────────────────────────────────────────────────────

async function financeiro(c: Ctx) {
  const { demo, dono, hoje, dado: d } = c
  let n = 0
  const mesAtual = primeiroDoMes(hoje)
  for (const mesesAtras of [2, 1, 0]) {
    const [ano, mes] = mesAtual.split('-').map(Number) as [number, number]
    const base = new Date(Date.UTC(ano, mes - 1 - mesesAtras, 1))
    const prefixo = base.toISOString().slice(0, 7)
    for (const x of demo.despesas) {
      const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate()
      const dia = `${prefixo}-${String(Math.min(x.dia, ultimo)).padStart(2, '0')}`
      if (dia < c.inicio) continue
      const variavel = /Energia|Água|Simples|Comissão|mercadoria|Gás|Repasse/i.test(x.descricao + x.categoria)
      const valor = Math.round(x.valor * (variavel ? d.entre(0.88, 1.12) : 1) * 100) / 100
      const vencido = dia < hoje
      const pago = vencido && !(mesesAtras === 0 && x.atrasa)
      const pagoDia = somarDias(dia, d.chance(0.8) ? 0 : d.inteiro(1, 3))
      const pagoEm = pago ? colunaDoDia(pagoDia > hoje ? hoje : pagoDia) : null
      const categoriaId = c.categoriaFin.get(x.categoria)
      if (!categoriaId) throw new Error(`Categoria financeira "${x.categoria}" não existe.`)
      await lancar(dono.sessao, {
        categoriaId, contaId: x.caixa ? c.contas.caixa : c.contas.banco, unidadeId: x.loja === undefined ? null : c.lojas[x.loja]!.id,
        tipo: 'DESPESA', descricao: x.descricao, valor, vencimento: colunaDoDia(dia), pagoEm, fornecedor: x.fornecedor,
      })
      n++
    }
  }
  return n
}

async function tarefas(c: Ctx) {
  const { demo, dono } = c
  const quem = { balcao: c.balcao.id, gerente: c.gerente?.id ?? c.balcao.id, dono: dono.id }
  // O modelo de abertura e fechamento, como a tela oferece.
  await criarDeModelo(dono.sessao, 'abertura', c.lojas[0]!.id)
  const q = await criarQuadro(dono.sessao, { nome: demo.quadro.nome, cor: demo.quadro.cor, grupos: demo.quadro.grupos, unidadeId: null })
  let n = 0
  for (const t of demo.quadro.tarefas) {
    const r = await criarTarefa(dono.sessao, {
      quadroId: q.id, grupo: t.grupo ?? '', titulo: t.titulo, descricao: t.descricao ?? null,
      responsavelId: t.quem ? quem[t.quem] : null, prioridade: t.prioridade ?? 0,
      prazo: t.prazo === undefined ? null : somarDias(c.hoje, t.prazo),
    })
    if (t.situacao && t.situacao !== 'A_FAZER') await moverTarefa(dono.sessao, r.id, t.situacao)
    n++
  }
  return n
}

/** O assistente já com os poderes da demonstração — desligado até conectar o WhatsApp. */
async function assistente(c: Ctx) {
  if (!c.demo.agente || !c.modulos.includes('agente')) return 0
  await salvarAgente(c.dono.sessao, {
    nome: 'Norte', manual: RAMOS[c.demo.ramo].manual, poderes: c.demo.agente.poderes,
    descontoMaxPct: 0, valorMaxCent: 0, gastoDiaCent: 500, mensagensDia: 150, ativo: false,
  })
  return c.demo.agente.poderes.length
}

async function metas(c: Ctx) {
  if (!c.demo.metas || !c.modulos.includes('metas')) return 0
  let n = 0
  const mes = c.hoje.slice(0, 7)
  const anterior = somarDias(primeiroDoMes(c.hoje), -1).slice(0, 7)
  for (const m of c.demo.metas) {
    const p = m.quem === 'gerente' ? c.gerente : c.balcao
    if (!p) continue
    for (const x of [anterior, mes]) {
      await salvarMeta(c.dono.sessao, { usuarioId: p.id, mes: x, valor: m.valor, comissaoPct: m.comissao })
      n++
    }
  }
  return n
}

async function encomendas(c: Ctx) {
  if (!c.demo.encomendas || !c.modulos.includes('encomenda')) return { n: 0, retirada: null as string | null }
  let n = 0
  let retirada: string | null = null
  for (const e of c.demo.encomendas) {
    const cli = e.cliente !== undefined ? c.clientes[e.cliente] : undefined
    const dia = somarDias(c.hoje, e.dia)
    const r = await criarEncomenda(c.balcao.sessao, {
      unidadeId: c.lojas[0]!.id, clienteId: cli?.id ?? null, clienteNome: cli ? null : 'Cliente do balcão', telefone: null,
      descricao: e.descricao, valor: e.valor, sinal: e.sinal, sinalForma: e.sinal ? 'PIX' : null, dia, hora: e.hora, entrega: !!e.entrega, endereco: e.endereco ?? null,
      confirmarPassado: true,
    }, e.dia === 0 ? new Date(Math.min(c.agora.getTime(), em(dia, minutos(e.hora)).getTime() - 3 * 86_400_000)) : undefined)
    if (!r.ok) throw new Error(`criarEncomenda: ${r.erro}`)
    if (e.pronta) {
      const m = await mudarSituacao(c.balcao.sessao, r.id, { para: 'PRONTA' })
      if (!m.ok) throw new Error(`mudarSituacao: ${m.erro}`)
    }
    if (e.retiraHoje) retirada = r.id
    n++
  }
  return { n, retirada }
}

async function agendaFutura(c: Ctx, hojeLivres: { colab: Colab; dia: string; min: number }[]) {
  if (!c.modulos.includes('agenda') || !c.colabs.length) return 0
  const { dado: d } = c
  const loja = c.lojas[0]!
  let n = 0
  const servicoDe = new Map(c.vars.filter((v) => v.produto.servico).map((v) => [v.produto.nome, v]))
  for (let k = 0; k <= 6; k++) {
    const dia = somarDias(c.hoje, k)
    for (const colab of c.colabs) {
      const p = colab.demo
      if (!p.servicos.length || p.atende === false) continue
      if (p.dias && !p.dias.includes(semanaDe(dia))) continue
      const js = janelas(loja, dia)
      for (const [a0, b0] of js) {
        const a = p.de ? Math.max(a0, minutos(p.de)) : a0
        const b = p.ate ? Math.min(b0, minutos(p.ate)) : b0
        let cursor = k === 0 ? Math.max(a, hojeLivres.find((x) => x.colab.id === colab.id)?.min ?? a) : a
        // Hoje só dali para frente; o que já passou foi gravado no histórico.
        if (k === 0) {
          const agoraMin = Math.ceil((c.agora.getTime() - inicioDoDiaEmSP(dia).getTime()) / 60_000 / 15) * 15
          cursor = Math.max(cursor, agoraMin)
        }
        // Quanto mais longe, mais vazia: a agenda enche perto do dia.
        const ocupacao = (p.ocupacao ?? 0.7) * (k === 0 ? 0.9 : k === 1 ? 0.85 : k <= 3 ? 0.6 : 0.35)
        while (cursor < b) {
          const v = servicoDe.get(d.um(p.servicos))
          if (!v) break
          const dur = v.produto.duracaoMin ?? 30
          if (cursor + dur > b) break
          if (!d.chance(ocupacao)) {
            cursor += 15 * d.inteiro(1, 3)
            continue
          }
          const cli = d.chance(c.demo.comCliente) ? d.pesado(c.clientes, (x) => x.peso) : null
          const r = await marcarHorario(c.balcao.sessao, {
            unidadeId: loja.id, colaboradorId: colab.id, clienteId: cli?.id ?? null, clienteNome: cli ? null : d.um(['Encaixe por telefone', 'Cliente nova (indicação)', 'Visitante']),
            telefone: null, produtoId: v.produtoId, dia, hora: hhmm(cursor), observacao: d.chance(0.12) ? d.um(c.demo.observacoesAgenda ?? ['']) || null : null,
          })
          if (r.ok) {
            n++
            if (k <= 1 && d.chance(0.55)) await mudarSituacaoAgenda(c.balcao.sessao, r.id, { para: 'CONFIRMADO' })
          }
          cursor += dur + d.um([0, 0, 15])
        }
      }
    }
  }
  return n
}

async function ponto(c: Ctx) {
  if (!c.modulos.includes('ponto')) return 0
  const { dado: d } = c
  const equipe = c.colabs.filter((x) => x.demo.jornada?.some((m) => m > 0))
  const loja = c.lojas[0]!
  let n = 0
  const primeiro = primeiroDoMes(c.hoje)
  let esqueceu = false
  for (const colab of equipe) {
    const propria = colab.demo.login === 'balcao'
    const sessao = propria ? c.balcao.sessao : c.dono.sessao
    for (let dia = primeiro; dia <= c.hoje; dia = somarDias(dia, 1)) {
      const jornada = colab.demo.jornada![semanaDe(dia)] ?? 0
      if (jornada <= 0) continue
      const js = janelas(loja, dia)
      if (!js.length) continue
      // Quem tem hora própria (o professor da tarde) entra nela; o resto, na abertura.
      const entra = (colab.demo.de ? minutos(colab.demo.de) : js[0]![0]) + d.inteiro(-12, 8)
      // Jornada longa tem almoço: quatro batidas; curta, duas.
      const batidas: [number, 'ENTRADA' | 'SAIDA'][] =
        jornada > 360
          ? [[entra, 'ENTRADA'], [entra + 240 + d.inteiro(-5, 10), 'SAIDA'], [entra + 300 + d.inteiro(-5, 10), 'ENTRADA'], [entra + 60 + jornada + d.inteiro(-5, 20), 'SAIDA']]
          : [[entra, 'ENTRADA'], [entra + jornada + d.inteiro(-5, 20), 'SAIDA']]
      // Um dia, alguém esqueceu de bater a saída — e o gestor ajusta no dia seguinte, com motivo.
      const esquecer = !esqueceu && !propria && dia >= somarDias(primeiro, 5) && dia < somarDias(c.hoje, -2) && d.chance(0.2)
      for (const [i, [min, tipo]] of batidas.entries()) {
        const quando = em(dia, min)
        if (quando.getTime() > c.agora.getTime() - 60_000) break // o turno de hoje fica aberto
        if (esquecer && i === batidas.length - 1) {
          esqueceu = true
          const r = await ajustarPonto(c.dono.sessao, {
            colaboradorId: colab.id, tipo: 'SAIDA', dia, hora: hhmm(min), motivo: 'Esqueceu de bater a saída; conferido com a câmera da recepção',
          }, em(somarDias(dia, 1), js[0]![0] - 30))
          if (!r.ok) throw new Error(`ajustarPonto: ${r.erro}`)
          n++
          continue
        }
        const r = await baterPonto(sessao, { colaboradorId: colab.id, esperado: tipo, unidadeId: loja.id }, quando)
        if (!r.ok) throw new Error(`baterPonto(${colab.demo.nome} ${dia} ${hhmm(min)}): ${r.erro}`)
        n++
      }
    }
  }
  return n
}

async function compras(c: Ctx) {
  const x = c.demo.compras
  if (!x || !c.modulos.includes('compras')) return 0
  const loja = c.lojas[0]!.id
  const fornecedores: string[] = []
  for (const f of x.fornecedores) {
    const r = await salvarFornecedor(c.dono.sessao, { nome: f.nome, telefone: f.telefone, observacao: f.observacao ?? null })
    if (!r.ok) throw new Error(`salvarFornecedor: ${r.erro}`)
    fornecedores.push(r.id)
  }
  const varDe = (produto: string, rotulo: string | null) => {
    const v = c.vars.find((y) => y.produto.nome === produto && (rotulo === null ? y.rotulo === '' : y.rotulo === rotulo))
    if (!v) throw new Error(`Compra: não achei ${produto} ${rotulo ?? ''}`)
    return v
  }
  const pedir = async (fornecedor: number, itens: [string, string | null, number][], previsto: number | null, obs: string | null) => {
    const r = await criarPedido(c.dono.sessao, {
      unidadeId: loja, fornecedorId: fornecedores[fornecedor], observacao: obs, previsto: previsto === null ? null : somarDias(c.hoje, previsto),
      itens: itens.map(([p, rot, q]) => ({ variacaoId: varDe(p, rot).id, quantidade: q, custoUnit: varDe(p, rot).produto.custo ?? null })),
    })
    if (!r.ok) throw new Error(`criarPedido: ${r.erro}`)
    const e = await enviarPedido(c.dono.sessao, r.id, new Date(c.agora.getTime() - 3 * 86_400_000))
    if (!e.ok) throw new Error(`enviarPedido: ${e.erro}`)
    return r.id
  }
  const categoriaId = c.categoriaFin.get('Compra de mercadoria')!
  const receber = async (id: string, quanto: (itemId: string, variacaoId: string, pedido: number) => number) => {
    const itens = await naEmpresa(c.orgId, (db) => db.itemCompra.findMany({ where: { pedidoId: id }, select: { id: true, variacaoId: true, quantidade: true } }))
    const r = await receberPedido(c.dono.sessao, id, {
      chave: randomBytes(8).toString('hex'),
      itens: itens.map((i) => ({ itemId: i.id, quantidade: quanto(i.id, i.variacaoId, Number(i.quantidade)) })).filter((i) => i.quantidade > 0),
      conta: { categoriaId, vencimento: colunaDoDia(somarDias(c.hoje, 15)), jaPago: false },
    })
    if (!r.ok) throw new Error(`receberPedido: ${r.erro}`)
  }

  const recebido = await pedir(x.recebido.fornecedor, x.recebido.itens, -1, 'Reposição do material de uso')
  await receber(recebido, (_i, _v, q) => q)
  if (x.parcial) {
    const chegou = new Map(x.parcial.itens.map(([p, rot, , ch]) => [varDe(p, rot).id, ch]))
    const parcial = await pedir(x.parcial.fornecedor, x.parcial.itens.map(([p, rot, q]) => [p, rot, q]), 1, 'O fornecedor mandou metade; o resto chega na próxima entrega')
    await receber(parcial, (_i, v) => chegou.get(v) ?? 0)
  }
  await pedir(x.aberto.fornecedor, x.aberto.itens, x.aberto.previsto, 'O que está acabando — conferir na chegada')

  // O material usado hoje, anotado pela recepção.
  const saldos = await naEmpresa(c.orgId, (db) => db.estoque.findMany({ where: { unidadeId: loja }, select: { variacaoId: true, quantidade: true } }))
  const tem = new Map(saldos.map((s) => [s.variacaoId, Number(s.quantidade)]))
  const itens = x.consumoHoje.map(([p, rot, q]) => ({ variacaoId: varDe(p, rot).id, quantidade: q })).filter((i) => (tem.get(i.variacaoId) ?? 0) >= i.quantidade)
  if (itens.length) {
    const r = await registrarConsumo(c.balcao.sessao, { unidadeId: loja, itens, motivo: 'Material do atendimento da manhã' })
    if (!r.ok) throw new Error(`registrarConsumo: ${r.erro}`)
  }
  return 3
}

/**
 * A escola: turmas, alunos com o responsável, matrículas e mensalidades —
 * tudo pelas funções das telas, na data em que aconteceu.
 *
 * A história das mensalidades nasce pela mesma geração da rotina
 * (`gerarNaTransacao`) e é recebida pela mesma função da secretaria
 * (`receberMensalidade`), com o `agora` do dia do pagamento: o juro, a multa e
 * o desconto de pontualidade são os que a regra sugeria NAQUELE dia (lidos de
 * `listarMensalidades` com o mesmo `agora`). Dinheiro só hoje, e só com o
 * caixa aberto: pagamento em dinheiro vai para a gaveta do turno aberto, e
 * turno do passado já foi contado e fechado.
 */
type ResumoEscola = { turmas: number; alunos: number; matriculas: number; mensalidades: number; recebimentos: number; atrasados: number }

async function escolaAoVivo(c: Ctx): Promise<ResumoEscola | null> {
  const e = c.demo.escola
  if (!e || !c.modulos.includes('escola')) return null
  const { dado: d, dono, hoje } = c
  const sede = c.lojas[0]!
  const secretaria = c.balcao
  const financeiro = c.pessoas.find((p) => p.papel === 'FINANCEIRO') ?? dono
  const agoraMs = c.agora.getTime()
  const mesMais = (mes: string, k: number) => {
    const [a, m] = mes.split('-').map(Number) as [number, number]
    return new Date(Date.UTC(a, m - 1 + k, 1)).toISOString().slice(0, 7)
  }
  const mesDeHoje = hoje.slice(0, 7)
  /** Um instante de expediente num dia; hoje, sempre antes de agora. */
  const noExpediente = (dia: string) => {
    const q = em(dia, d.inteiro(8 * 60 + 30, 18 * 60))
    return q.getTime() < agoraMs - 30 * 60_000 ? q : new Date(agoraMs - d.inteiro(30, 120) * 60_000)
  }

  // ── 1. a regra da mensalidade e o aviso ao responsável ──
  await salvarConfigMensalidade(dono.sessao, { ...e.regra, avisoAtivo: true })

  // ── 2. as turmas, com quem dá aula ──
  const profId = new Map(c.colabs.map((x) => [x.demo.nome, x.id]))
  const turmas: { id: string; def: EscolaDemo['turmas'][number] }[] = []
  for (const t of e.turmas) {
    const r = await criarTurma(dono.sessao, {
      unidadeId: sede.id, nome: t.nome, curso: t.curso, turno: t.turno, professorId: profId.get(t.professor) ?? null,
      dias: t.dias, horaInicio: t.de, horaFim: t.ate, capacidade: t.capacidade, mensalidade: t.mensalidade, diaVencimento: t.vencimento,
    })
    if (!r.ok) throw new Error(`criarTurma(${t.nome}): ${r.erro}`)
    turmas.push({ id: r.id, def: t })
  }

  // ── 3. os alunos: sem telefone, com o responsável e o aceite do aviso ──
  type Aluno = { id: string; nome: string; idade: number; turmas: number }
  const alunos: Aluno[] = []
  const anoHoje = Number(hoje.slice(0, 4))
  const novoAluno = async (faixa: [number, number]): Promise<Aluno> => {
    const i = alunos.length
    const nome = e.alunos[i]
    const resp = e.responsaveis[i]
    if (!nome || !resp) throw new Error('A escola ficou sem nomes de aluno: acrescente em escola().')
    const idade = d.inteiro(faixa[0], faixa[1])
    // Fez `idade` anos em algum dia dos últimos onze meses.
    const nascimento = colunaDoDia(somarDias(`${anoHoje - idade}${hoje.slice(4)}`, -d.inteiro(1, 330)))
    const quando = em(somarDias(c.inicio, d.inteiro(0, 25)), 10 * 60)
    const r = await criarCliente(secretaria.sessao, { nome, nascimento, cidade: c.demo.lojas[0]!.cidade, estado: c.demo.lojas[0]!.estado }, null, quando)
    if (!r.ok) throw new Error(`criarCliente(${nome}): ${r.motivo}`)
    await naEmpresa(c.orgId, (db) => db.cliente.update({ where: { id: r.clienteId }, data: { criadoEm: quando } }))
    // Seis em dez aceitaram o aviso da mensalidade no WhatsApp, ali na secretaria.
    const x = d()
    const avisos = x < 0.6 ? { valor: 'SIM' as const, origem: 'balcao' } : x < 0.7 ? { valor: 'NAO' as const, origem: 'balcao' } : null
    const primeiro = nome.split(' ')[0]!.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const rr = await salvarResponsavel(secretaria.sessao, r.clienteId, {
      nome: resp.nome, parentesco: resp.parentesco,
      telefone: `${c.demo.ddd}98700${String(i + 1).padStart(4, '0')}`,
      email: d.chance(0.35) ? `resp.${primeiro}.${i + 1}@email.test` : null,
      avisos,
    }, quando)
    if (!rr.ok) throw new Error(`salvarResponsavel(${nome}): ${rr.erro}`)
    const a = { id: r.clienteId, nome, idade, turmas: 0 }
    alunos.push(a)
    return a
  }

  // ── 4. as matrículas: quem, em que turma, desde quando — e o que acontece depois ──
  type Saida = { para: 'TRANCADA' | 'CANCELADA' | 'CONCLUIDA'; dia: string; motivo: string }
  type Mat = { id: string; aluno: Aluno; turma: (typeof turmas)[number]; inicio: string; saida: Saida | null; bolsa: boolean; venceHoje?: boolean }
  const mats: Mat[] = []
  const matricularAluno = async (turma: (typeof turmas)[number], inicio: string, opcoes: { vencimento?: number; bolsa?: { pct: number; motivo: string } } = {}) => {
    const naTurma = new Set(mats.filter((m) => m.turma.id === turma.id).map((m) => m.aluno.id))
    const [ini, fim] = turma.def.idade
    const podem = alunos.filter((a) => a.idade >= ini && a.idade <= fim && a.turmas < 2 && !naTurma.has(a.id))
    // Um em cada três já estuda aqui em outra turma (o irmão do ballet faz inglês).
    const aluno = podem.length > 0 && d.chance(0.35) ? d.um(podem) : await novoAluno(turma.def.idade)
    // A bolsa é da dona: só quem gere a escola dá desconto.
    const quem = opcoes.bolsa ? dono : secretaria
    const r = await matricular(quem.sessao, {
      alunoId: aluno.id, turmaId: turma.id, inicio, diaVencimento: opcoes.vencimento ?? null,
      descontoPct: opcoes.bolsa?.pct ?? null, descontoMotivo: opcoes.bolsa?.motivo ?? null,
    })
    if (!r.ok) throw new Error(`matricular(${aluno.nome} em ${turma.def.nome}): ${r.erro}`)
    aluno.turmas++
    const m: Mat = { id: r.id, aluno, turma, inicio, saida: null, bolsa: !!opcoes.bolsa }
    mats.push(m)
    return m
  }
  // Os últimos três a seis meses: a maioria veio no começo do semestre.
  const inicioSorteado = () => somarDias(hoje, -(d.chance(0.7) ? d.inteiro(95, 170) : d.inteiro(25, 94)))
  const diaDeHoje = Math.min(Number(hoje.slice(8, 10)), 28)
  let venceHoje = 0
  let novato: Mat | null = null
  for (const [ti, t] of turmas.entries()) {
    for (let k = 0; k < t.def.alunos; k++) {
      // O último da turma de ballet chegou esta semana: a primeira mensalidade
      // dele a escola dispensa (ver abaixo).
      if (t.def.nome.startsWith('Ballet') && k === t.def.alunos - 1) {
        novato = await matricularAluno(t, somarDias(hoje, -3))
        continue
      }
      // Dois do Inglês Teens vencem HOJE (o dia do vencimento deles é o de hoje).
      const venc = ti === 1 && venceHoje < 2 && k >= 2 ? diaDeHoje : undefined
      if (venc !== undefined) venceHoje++
      const bolsa = d.chance(0.15) ? (d.chance(0.66) ? { pct: 10, motivo: 'Irmão matriculado na escola' } : { pct: 50, motivo: 'Bolsa de mérito' }) : undefined
      const m = await matricularAluno(t, inicioSorteado(), { vencimento: venc, bolsa })
      if (venc !== undefined) m.venceHoje = true
    }
  }
  // Quem saiu: trancou (volta depois), cancelou (com motivo) e o que concluiu.
  const porNome = (n: string) => turmas.find((t) => t.def.nome === n)!
  const saidas: [string, Saida['para'], string][] = [
    ['Inglês Kids', 'TRANCADA', 'Viagem longa da família; volta no mês que vem'],
    ['Inglês Teens', 'TRANCADA', 'Cirurgia no joelho; pausa até se recuperar'],
  ]
  for (const [nome, para, motivo] of saidas) {
    const cand = mats.filter((m) => m.turma.def.nome === nome && !m.saida && m !== novato && !m.venceHoje && m.inicio <= somarDias(hoje, -60))
    const m = cand[cand.length - 1]
    if (m) m.saida = { para, motivo, dia: somarDias(hoje, -d.inteiro(12, 35)) }
  }
  const extras: [string, Saida['para'], string][] = [
    ['Inglês Teens', 'CANCELADA', 'Mudou de cidade com a família'],
    ['Ballet infantil', 'CANCELADA', 'O horário não bate com a escola nova'],
    ['Reforço 3º ano', 'CONCLUIDA', 'Concluiu o reforço: passou de ano sem recuperação'],
  ]
  for (const [nome, para, motivo] of extras) {
    const m = await matricularAluno(porNome(nome), somarDias(hoje, -d.inteiro(110, 160)))
    const dia = para === 'CONCLUIDA' ? somarDias(`${mesDeHoje}-01`, -1) : somarDias(hoje, -d.inteiro(20, 45))
    m.saida = { para, motivo, dia }
  }

  // ── 5. a história: quatro meses para trás, o de agora e o próximo ──
  const meses = [4, 3, 2, 1].map((k) => mesMais(mesDeHoje, -k)).concat([mesDeHoje, mesMais(mesDeHoje, 1)])
  await comoOrg(c.orgId, (db) => gerarNaTransacao(db, c.orgId, meses, { usuarioId: null, nome: 'Mensalidades do mês' }))

  // ── 6. quem deve: cinco alunos, de um ou dois meses ──
  const todas = await listarMensalidades(dono.sessao, { unidadeIds: [sede.id] }, c.agora)
  const matDe = new Map(mats.map((m) => [`${m.aluno.id}|${m.turma.id}`, m]))
  const vencidas = (m: Mat) =>
    todas.filter((x) => x.alunoId === m.aluno.id && x.turmaId === m.turma.id && diaDaColuna(x.vencimento) < hoje).sort((a, b) => b.mes.localeCompare(a.mes))
  const devem = new Set<string>()
  const candidatosAtraso = mats.filter((m) => !m.saida && m !== novato && !m.venceHoje && vencidas(m).length >= 2)
  for (const [i, m] of candidatosAtraso.filter((_, i) => i % 7 === 3).slice(0, 5).entries()) {
    for (const x of vencidas(m).slice(0, i < 2 ? 2 : 1)) devem.add(x.id)
  }

  // ── 7. os recebimentos, cada um no dia dele ──
  const formaSorteada = (): FormaPagamento => d.pesado([['PIX', 70], ['TRANSFERENCIA', 14], ['CREDITO', 8], ['DEBITO', 8]] as const, (x) => x[1])[0]
  const caixaAberto = await naEmpresa(c.orgId, (db) => db.caixa.findFirst({ where: { unidadeId: sede.id, aberto: true }, select: { id: true } }))
  let emDinheiroHoje = caixaAberto ? 2 : 0
  let recebimentos = 0
  const receber = async (id: string, alunoId: string, mes: string, quando: Date, jeito: { forma: FormaPagamento; metade?: boolean; pontualidade?: boolean; semMulta?: boolean }) => {
    const [x] = (await listarMensalidades(secretaria.sessao, { unidadeIds: [sede.id], alunoId, mes }, quando)).filter((y) => y.id === id)
    if (!x || x.resta <= 0) return
    const quem = d.chance(0.8) ? secretaria : financeiro
    let pedido
    if (jeito.pontualidade && x.abonoHoje > 0) {
      pedido = { valor: reais(centavos(x.resta) - centavos(x.abonoHoje)), juros: 0, multa: 0, pontualidade: true }
    } else if (jeito.metade) {
      pedido = { valor: reais(Math.floor(centavos(x.resta) / 2)), juros: 0, multa: 0 }
    } else {
      const multa = jeito.semMulta ? 0 : x.multaHoje
      pedido = { valor: reais(centavos(x.resta) + centavos(x.jurosHoje) + centavos(multa)), juros: x.jurosHoje, multa }
    }
    const r = await receberMensalidade(quem.sessao, { mensalidadeId: id, forma: jeito.forma, ...pedido }, quando)
    if (!r.ok) throw new Error(`receberMensalidade(${x.aluno}, ${mes}): ${r.motivo}`)
    recebimentos++
  }
  for (const x of [...todas].sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime())) {
    const m = matDe.get(`${x.alunoId}|${x.turmaId}`)
    if (!m || devem.has(x.id) || x.situacao === 'cancelada') continue
    if (m === novato && x.mes <= mesDeHoje) continue // a primeira dele a escola dispensa
    if (m.venceHoje && x.mes === mesDeHoje) continue // vence hoje, ainda não pagou
    // Depois da saída não se paga: a mensalidade é dispensada ao sair.
    if (m.saida && x.mes > m.saida.dia.slice(0, 7)) continue
    const venc = diaDaColuna(x.vencimento)
    const desde = m.inicio
    if (venc >= hoje) {
      // Ainda não venceu: um terço paga adiantado, com o desconto de pontualidade.
      if (x.mes !== mesDeHoje || !d.chance(0.35)) continue
      const dia = somarDias(hoje, -d.inteiro(1, 6))
      await receber(x.id, x.alunoId, x.mes, noExpediente(dia < desde ? desde : dia), { forma: formaSorteada(), pontualidade: true })
      continue
    }
    // Hoje, com o caixa aberto: dois pagam em dinheiro, na secretaria — atrasado, com juro e multa.
    if (emDinheiroHoje > 0 && x.mes === mesDeHoje && !m.bolsa) {
      emDinheiroHoje--
      await receber(x.id, x.alunoId, x.mes, new Date(agoraMs - d.inteiro(5, 40) * 60_000), { forma: 'DINHEIRO' })
      continue
    }
    const r = d()
    const limite = (dia: string) => (dia < desde ? desde : dia > hoje ? hoje : dia)
    if (r < 0.5) {
      // Em dia; metade deles leva o desconto de pontualidade.
      await receber(x.id, x.alunoId, x.mes, noExpediente(limite(somarDias(venc, -d.inteiro(0, 5)))), { forma: formaSorteada(), pontualidade: d.chance(0.5) })
    } else if (r < 0.78) {
      // Poucos dias depois: juro pequeno, e às vezes a secretaria dispensa a multa.
      await receber(x.id, x.alunoId, x.mes, noExpediente(limite(somarDias(venc, d.inteiro(1, 4)))), { forma: formaSorteada(), semMulta: d.chance(0.35) })
    } else if (r < 0.93) {
      // Atrasado de verdade: multa e juro do dia.
      await receber(x.id, x.alunoId, x.mes, noExpediente(limite(somarDias(venc, d.inteiro(6, 22)))), { forma: formaSorteada() })
    } else {
      // Metade no vencimento, o resto depois — com o juro do resto.
      const antes = limite(somarDias(venc, -d.inteiro(0, 3)))
      const depois = limite(somarDias(venc, d.inteiro(8, 18)))
      await receber(x.id, x.alunoId, x.mes, noExpediente(antes), { forma: formaSorteada(), metade: true })
      if (depois > antes) await receber(x.id, x.alunoId, x.mes, noExpediente(depois), { forma: 'PIX' })
    }
  }

  // ── 8. as saídas, no dia em que aconteceram ──
  for (const m of mats.filter((x) => x.saida)) {
    const s = m.saida!
    const r = await mudarMatricula(s.para === 'TRANCADA' ? secretaria.sessao : dono.sessao, m.id, { para: s.para, motivo: s.motivo, dia: s.dia }, em(s.dia, 11 * 60))
    if (!r.ok) throw new Error(`mudarMatricula(${m.aluno.nome}): ${r.erro}`)
  }

  // ── 9. a primeira do novato, dispensada com motivo ──
  if (novato) {
    const [primeira] = (await listarMensalidades(financeiro.sessao, { unidadeIds: [sede.id], alunoId: novato.aluno.id }, c.agora))
      .filter((x) => x.turmaId === novato!.turma.id && x.situacao !== 'paga')
      .sort((a, b) => a.mes.localeCompare(b.mes))
    if (primeira) {
      const r = await dispensarMensalidade(financeiro.sessao, primeira.id, 'Entrou no fim do mês: a primeira mensalidade fica por conta da escola')
      if (!r.ok) throw new Error(`dispensarMensalidade: ${r.erro}`)
    }
  }

  const n = await naEmpresa(c.orgId, (db) => db.mensalidade.count())
  const atrasados = new Set(todas.filter((x) => devem.has(x.id)).map((x) => x.alunoId)).size
  return { turmas: turmas.length, alunos: alunos.length, matriculas: mats.length, mensalidades: n, recebimentos, atrasados }
}

/**
 * Uma venda de agora, pelo `registrarVenda` de verdade — a prova de que o
 * passado gravado por fora deixou tudo no lugar (caixa aberto, saldo,
 * numeração). Na clínica e no salão ela cobra um horário de hoje ("Atender e
 * cobrar"); na padaria entrega a encomenda do bolo.
 */
async function vendaDeAgora(c: Ctx, retirada: string | null) {
  const loja = c.lojas[0]!.id
  const aberto = await naEmpresa(c.orgId, (db) => db.caixa.findFirst({ where: { unidadeId: loja, aberto: true }, select: { id: true } }))
  if (!aberto) return 'sem caixa aberto agora (loja fechada neste horário) — nenhuma venda ao vivo'

  if (retirada) {
    const e = await naEmpresa(c.orgId, (db) => db.encomenda.findUnique({ where: { id: retirada }, select: { valor: true, sinal: true } }))
    const falta = Number(e!.valor) - Number(e!.sinal)
    const r = await registrarVenda(c.balcao.sessao, { unidadeId: loja, itens: [], encomendaId: retirada, pagamentos: [{ forma: 'PIX', valor: falta }] })
    if (!r.ok) throw new Error(`registrarVenda (encomenda): ${JSON.stringify(r)}`)
  }

  const pendente = await naEmpresa(c.orgId, (db) =>
    db.agendamento.findFirst({ where: { situacao: 'CONFIRMADO', vendaId: null, fim: { lt: new Date() } }, orderBy: { inicio: 'asc' }, select: { id: true, produtoId: true, clienteId: true } }),
  )
  if (pendente?.produtoId) {
    const v = c.vars.find((x) => x.produtoId === pendente.produtoId)!
    const r = await registrarVenda(c.balcao.sessao, {
      unidadeId: loja, clienteId: pendente.clienteId, agendamentoId: pendente.id,
      itens: [{ variacaoId: v.id, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: v.produto.vista }],
    })
    if (!r.ok) throw new Error(`registrarVenda (agenda): ${JSON.stringify(r)}`)
    return `venda ${r.numero} (atender e cobrar)`
  }

  const saldos = await naEmpresa(c.orgId, (db) => db.estoque.findMany({ where: { unidadeId: loja, quantidade: { gt: 2 } }, select: { variacaoId: true } }))
  const com = new Set(saldos.map((s) => s.variacaoId))
  const v = c.vars.filter((x) => x.peso > 0 && !x.produto.servico && com.has(x.id)).sort((a, b) => b.peso - a.peso)[0]
  if (!v) return 'nada com saldo para vender agora'
  const qtd = v.produto.medida === 'KG' ? 0.5 : 1
  const r = await registrarVenda(c.balcao.sessao, {
    unidadeId: loja, itens: [{ variacaoId: v.id, quantidade: qtd }], pagamentos: [{ forma: 'PIX', valor: reais(multiplicar(centavos(v.produto.vista), qtd)) }],
  })
  if (!r.ok) throw new Error(`registrarVenda: ${JSON.stringify(r)}`)
  return `venda ${r.numero} (${v.descricao})`
}

/** Confere as contas que o sistema confere. Se alguma não bate, o script para. */
async function conferir(c: Ctx) {
  const problemas = await naEmpresa(c.orgId, async (db) => {
    const erros: string[] = []
    const estoque = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from estoque e
       where e.quantidade <> coalesce((select sum(m.quantidade) from movimentos_estoque m
                                        where m.variacao_id = e.variacao_id and m.unidade_id = e.unidade_id), 0)
          or e.quantidade < 0`
    if (Number(estoque[0]!.n) > 0) erros.push(`${estoque[0]!.n} saldo(s) de estoque não batem com os movimentos`)
    const pagamento = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from vendas v
       where v.total <> coalesce((select sum(p.valor) from pagamentos p where p.venda_id = v.id), 0)`
    if (Number(pagamento[0]!.n) > 0) erros.push(`${pagamento[0]!.n} venda(s) com pagamento que não fecha`)
    const itens = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from vendas v
       where v.subtotal <> coalesce((select sum(i.total) from venda_itens i where i.venda_id = v.id), 0)
          or v.total <> v.subtotal - v.desconto - v.desconto_pontos`
    if (Number(itens[0]!.n) > 0) erros.push(`${itens[0]!.n} venda(s) com itens que não somam`)
    const fiado = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from vendas v join pagamentos p on p.venda_id = v.id and p.forma = 'CREDIARIO'
       where v.situacao = 'CONCLUIDA'
         and p.valor <> coalesce((select sum(x.valor) from parcelas x where x.venda_id = v.id), 0)
         and not exists (select 1 from devolucoes d where d.venda_id = v.id)`
    if (Number(fiado[0]!.n) > 0) erros.push(`${fiado[0]!.n} crediário(s) com parcelas que não somam o fiado`)
    const caixa = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from caixas c
       where not c.aberto and c.saldo_esperado <> c.saldo_abertura
         + coalesce((select sum(p.valor) from pagamentos p join vendas v on v.id = p.venda_id
                      where v.caixa_id = c.id and v.situacao = 'CONCLUIDA' and p.forma = 'DINHEIRO'), 0)
         + coalesce((select sum(r.valor) from recebimentos r where r.caixa_id = c.id and r.forma = 'DINHEIRO'), 0)
         + coalesce((select sum(m.valor) from caixa_movimentos m where m.caixa_id = c.id and m.tipo = 'SUPRIMENTO'), 0)
         - coalesce((select sum(m.valor) from caixa_movimentos m where m.caixa_id = c.id and m.tipo = 'SANGRIA'), 0)`
    if (Number(caixa[0]!.n) > 0) erros.push(`${caixa[0]!.n} turno(s) de caixa com o esperado errado`)
    const recebido = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from parcelas x
       where x.pago <> coalesce((select sum(r.valor - r.juros) from recebimentos r where r.parcela_id = x.id), 0)
          or x.juros <> coalesce((select sum(r.juros) from recebimentos r where r.parcela_id = x.id), 0)`
    if (Number(recebido[0]!.n) > 0) erros.push(`${recebido[0]!.n} parcela(s) com recebimento que não bate`)
    const horario = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from agendamentos a where a.situacao = 'ATENDIDO' and a.venda_id is null`
    if (Number(horario[0]!.n) > 0) erros.push(`${horario[0]!.n} horário(s) atendido(s) sem venda`)
    // A mensalidade é a soma dos recebimentos dela: o que abateu (sem juro e
    // multa), o juro, a multa e o desconto de pontualidade.
    const mensalidade = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from mensalidades x
        left join lateral (
          select coalesce(sum(p.valor - p.juros - p.multa), 0) as pago, coalesce(sum(p.juros), 0) as juros,
                 coalesce(sum(p.multa), 0) as multa, coalesce(sum(p.abono), 0) as abono
            from pagamentos_mensalidade p where p.mensalidade_id = x.id
        ) s on true
       where x.pago <> s.pago or x.juros <> s.juros or x.multa <> s.multa or x.abono <> s.abono`
    if (Number(mensalidade[0]!.n) > 0) erros.push(`${mensalidade[0]!.n} mensalidade(s) com recebimento que não bate`)
    const quitada = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from mensalidades x
       where (x.quitada_em is not null) <> (x.pago + x.abono >= x.valor - x.desconto)
          or (x.cancelada_em is not null and x.pago > 0)`
    if (Number(quitada[0]!.n) > 0) erros.push(`${quitada[0]!.n} mensalidade(s) com a situação trocada (quitada ou dispensada)`)
    const saiu = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from mensalidades x join matriculas m on m.id = x.matricula_id
       where m.situacao in ('CANCELADA', 'CONCLUIDA') and m.fim is not null
         and x.mes > to_char(m.fim, 'YYYY-MM') and x.cancelada_em is null and x.pago = 0`
    if (Number(saiu[0]!.n) > 0) erros.push(`${saiu[0]!.n} mensalidade(s) cobrando aluno que já saiu`)
    const dinheiro = await db.$queryRaw<{ n: bigint }[]>`
      select count(*) as n from pagamentos_mensalidade p where p.forma = 'DINHEIRO' and p.caixa_id is null`
    if (Number(dinheiro[0]!.n) > 0) erros.push(`${dinheiro[0]!.n} mensalidade(s) em dinheiro fora do caixa`)
    return erros
  })
  if (problemas.length) throw new Error(`Conferência reprovou ${c.slug}:\n    · ${problemas.join('\n    · ')}`)
}

// ─────────────────────────────────────────────────────────────
// AS SENHAS — só no arquivo do laptop
// ─────────────────────────────────────────────────────────────

const ARQUIVO_SENHAS = producao ? '.video/demonstracoes-senhas-producao.txt' : '.video/demonstracoes-senhas.txt'

function lerSenhas(): Map<string, string[]> {
  const porEmpresa = new Map<string, string[]>()
  if (!existsSync(ARQUIVO_SENHAS)) return porEmpresa
  for (const linha of readFileSync(ARQUIVO_SENHAS, 'utf8').split('\n')) {
    const slug = linha.trim().split(/\s+/)[0]
    if (!slug?.startsWith('demo-')) continue
    porEmpresa.set(slug, [...(porEmpresa.get(slug) ?? []), linha.trimEnd()])
  }
  return porEmpresa
}

function gravarSenhas(porEmpresa: Map<string, string[]>) {
  mkdirSync(dirname(ARQUIVO_SENHAS), { recursive: true })
  const cabeca = [
    `# Empresas de demonstração do Norte — ${producao ? 'PRODUÇÃO' : 'banco local'}.`,
    '# Gerado por `npm run demonstracoes`. Não vai para o git (.video/ está no .gitignore).',
    '# Não mande este arquivo por mensagem: passe a senha de uma pessoa, na hora.',
    '#',
    '# endereço            papel     e-mail                               senha',
  ]
  const linhas = [...porEmpresa.keys()].sort().flatMap((k) => porEmpresa.get(k)!)
  writeFileSync(ARQUIVO_SENHAS, [...cabeca, ...linhas, ''].join('\n'), { encoding: 'utf8', mode: 0o600 })
}

// ─────────────────────────────────────────────────────────────
// A EXECUÇÃO
// ─────────────────────────────────────────────────────────────

const escolhidos = Object.keys(DEMOS).filter((r) => !so || r === so)
if (so && escolhidos.length === 0) recusar(`não conheço o ramo "${so}". Os daqui: ${Object.keys(DEMOS).join(', ')}.`)
for (const r of escolhidos) if (!Object.hasOwn(RAMOS, r)) recusar(`o ramo "${r}" não existe em RAMOS (src/servidor/modulos.ts).`)

const slugs = escolhidos.map(slugDe)
if (slugs.some((s) => !s.startsWith('demo-'))) recusar('endereço de demonstração sem o prefixo demo-.')

const existentes = await admin.org.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true, nome: true } })

console.log(`\n  Empresas de demonstração   [banco: ${producao ? 'PRODUÇÃO (' + arquivo + ')' : 'local'}]\n`)
if (recriar && existentes.length) {
  console.log(`  Vão ser APAGADAS e recriadas (e só elas):`)
  for (const o of existentes) console.log(`    · /${o.slug}  ${o.nome}`)
  console.log('')
}

// Em produção, a confirmação é digitada — como na ferramenta de operação.
if (producao) {
  if (!process.stdin.isTTY) recusar('em produção a confirmação é digitada. Rode num terminal.')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const digitado = (await rl.question('  PRODUÇÃO. Digite o prefixo das empresas de demonstração (demo-) para continuar: ')).trim()
    if (digitado !== 'demo-') recusar('não confere. Nada foi feito.')
  } finally {
    rl.close()
  }
}

const senhas = lerSenhas()
const resumo: string[][] = []
let falhou = false

try {
  for (const ramo of escolhidos) {
    const slug = slugDe(ramo)
    const demo = DEMOS[ramo]!()
    if (!demo) {
      console.log(`  ${slug.padEnd(18)} pulada: o ramo ${ramo} não tem definição neste script`)
      continue
    }
    const ja = existentes.find((o) => o.slug === slug)
    if (ja && !recriar) {
      console.log(`  ${slug.padEnd(18)} já existe — não foi tocada (use --recriar para refazer)`)
      if (!senhas.has(slug)) console.log(`  ${''.padEnd(18)} (a senha dela não está em ${ARQUIVO_SENHAS}; --recriar gera novas)`)
      continue
    }
    if (ja) {
      if (!ja.slug.startsWith('demo-') || !slugs.includes(ja.slug)) recusar(`${ja.slug} não é uma empresa de demonstração.`)
      await admin.org.delete({ where: { id: ja.id } })
    }

    const t0 = Date.now()
    process.stdout.write(`  ${slug.padEnd(18)} `)
    const c = await nascer(demo, slug)
    // O arquivo de senhas sai já aqui: se algo quebrar depois, ninguém fica trancado para fora.
    senhas.set(slug, c.pessoas.map((p) => `${slug.padEnd(20)} ${p.papel.padEnd(9)} ${p.email.padEnd(36)} ${p.senha}`))
    gravarSenhas(senhas)
    await cadastrar(c)
    process.stdout.write('cadastro · ')
    const h = await historico(c)
    process.stdout.write('passado · ')
    const nFin = await financeiro(c)
    const nTar = await tarefas(c)
    const nMet = await metas(c)
    const enc = await encomendas(c)
    const nAg = await agendaFutura(c, h.deixarParaAgora)
    const nPonto = await ponto(c)
    await compras(c)
    const nPoderes = await assistente(c)
    const esc = await escolaAoVivo(c)
    const aoVivo = await vendaDeAgora(c, enc.retirada)
    await conferir(c)
    const s = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`pronto em ${s} s`)
    const partes = [
      `${h.vendas} vendas (${h.canceladas} canceladas, ${h.devolucoes} devoluções)`,
      h.parcelas ? `${h.parcelas} parcelas de crediário` : '',
      h.horarios || nAg ? `${h.horarios} horários no passado, ${nAg} marcados` : '',
      nPonto ? `${nPonto} batidas de ponto` : '',
      enc.n ? `${enc.n} encomendas` : '',
      `${nFin} lançamentos`, `${nTar} tarefas`, nMet ? `${nMet} metas` : '',
      esc ? `${esc.turmas} turmas, ${esc.alunos} alunos, ${esc.matriculas} matrículas, ${esc.mensalidades} mensalidades (${esc.recebimentos} recebimentos)` : `${c.clientes.length} ${c.demo.ramo === 'saude' ? 'pacientes' : 'clientes'}`,
      nPoderes ? `assistente com ${nPoderes} poderes` : '',
    ].filter(Boolean)
    console.log(`  ${''.padEnd(18)} ${partes.join(' · ')}`)
    console.log(`  ${''.padEnd(18)} ao vivo: ${aoVivo}`)
    resumo.push([slug, demo.nome, c.pessoas.map((p) => `${p.papel.toLowerCase()}: ${p.email}`).join(', ')])
  }
} catch (e) {
  falhou = true
  console.error(`\n\n  Deu problema: ${(e as Error).stack ?? e}\n`)
} finally {
  await admin.$disconnect()
  await app.$disconnect()
  await fechar()
}

if (resumo.length) {
  console.log('\n  Quem entra (a senha de cada um está no arquivo, não aqui):\n')
  for (const [slug, nome, quem] of resumo) console.log(`    /${slug}  ${nome}\n      ${quem}`)
}
console.log(`\n  Senhas: ${ARQUIVO_SENHAS}\n`)
if (falhou) process.exit(1)
