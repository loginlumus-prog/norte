// As exceções que se assinam, e os motivos prontos de cada uma.
//
// Puro, sem nada de servidor dentro: a tela importa daqui para mostrar os
// motivos como botões (e o servidor, para o rótulo do livro). A conferência
// do PIN mora em autorizacao.ts, que a tela nunca importa.
//
// ── por que motivo pronto ────────────────────────────────────
// Campo de texto livre e obrigatório produz "ok", "ajuste", "." — e o livro
// passa a ter mil linhas e nenhuma informação. Com os motivos mais comuns na
// frente, o caminho mais curto para quem está no balcão passa a ser o certo,
// e o texto livre fica para a exceção da exceção. (Os da loja de roupa vieram
// do sistema que ela usava: são as frases que a equipe já fala.)

export type Excecao =
  | 'caixa.sangria'
  | 'caixa.suprimento'
  | 'venda.cancelar'
  | 'venda.data'
  | 'crediario.baixa'
  | 'crediario.quitou'
  | 'estoque.ajuste'
  | 'estoque.perda'
  | 'produto.cadastrar'
  | 'cliente.juntar'

export const EXCECOES: Record<Excecao, { rotulo: string; motivos: readonly string[] }> = {
  'caixa.sangria': {
    rotulo: 'Tirou dinheiro do caixa',
    motivos: ['Depósito no banco', 'Pagamento de fornecedor', 'Despesa da loja', 'Troco para outro caixa', 'Retirada da dona'],
  },
  'caixa.suprimento': {
    rotulo: 'Pôs dinheiro no caixa',
    motivos: ['Troco inicial', 'Reforço de troco', 'Devolução de sangria'],
  },
  'venda.cancelar': {
    rotulo: 'Cancelou uma venda',
    motivos: ['Cliente desistiu', 'Lancei a venda errada', 'Venda duplicada', 'Erro na forma de pagamento'],
  },
  'venda.data': {
    rotulo: 'Corrigiu a data de uma venda',
    motivos: ['Venda de outro dia lançada hoje', 'Igualando ao outro sistema', 'Caixa já tinha fechado', 'Digitei a data errada'],
  },
  'crediario.baixa': {
    rotulo: 'Deu baixa no crediário (pago fora)',
    motivos: ['Pagou no outro sistema', 'Pagou por Pix na conta da loja', 'Acordo de quitação', 'Baixa lançada errada antes'],
  },
  'crediario.quitou': {
    rotulo: 'Deu o crediário por quitado',
    motivos: ['Acordo de quitação', 'Pagou tudo no outro sistema', 'Pagou tudo na conta da loja'],
  },
  'estoque.ajuste': {
    rotulo: 'Corrigiu o estoque',
    motivos: ['Contei a arara e estava diferente', 'Peça com defeito, saiu de venda', 'Peça sumiu / não achei', 'Estava lançado errado', 'Peça foi para outra loja'],
  },
  'estoque.perda': {
    rotulo: 'Lançou uma avaria',
    motivos: ['Quebrou', 'Amassou', 'Derreteu', 'Venceu a validade', 'Caiu no chão', 'Estragou', 'Uso da casa / degustação'],
  },
  'produto.cadastrar': {
    rotulo: 'Cadastrou um produto',
    motivos: ['Chegou mercadoria nova', 'Peça sem cadastro na arara'],
  },
  'cliente.juntar': {
    rotulo: 'Juntou duas fichas da mesma cliente',
    motivos: [
      'Mesma cliente cadastrada duas vezes',
      'Comprou uma vez sem CPF e outra com',
      'Ficha do sistema antigo e do novo',
      'Conferi o CPF e é a mesma pessoa',
    ],
  },
}

/** "ok", "teste", "." não são motivo: o livro precisa de uma frase. */
const VAZIOS = new Set(['ok', 'sim', 'nao', 'não', 'teste', 'test', 'asd', 'aaa', '123', 'xxx', '-', '.', '..', '...'])

export function motivoServe(motivo: string | null | undefined): boolean {
  const t = String(motivo ?? '').replace(/\s+/g, ' ').trim()
  return t.length >= 3 && !VAZIOS.has(t.toLowerCase())
}
