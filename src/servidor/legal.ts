// Quem assina os documentos, e quem mais toca nos dados.
//
// Tudo que os Termos e a Política de Privacidade precisam saber sobre o mundo
// real mora AQUI, num lugar só. Espalhado pelas duas páginas, um dado mudaria
// numa e ficaria velho na outra — e documento jurídico com duas versões da
// mesma informação é pior do que documento nenhum.
//
// ── o que ainda falta, e por que isso aparece na tela ────────
// Enquanto `RAZAO_SOCIAL` ou `CNPJ` forem nulos, as duas páginas mostram uma
// tarja dizendo que o documento é rascunho. É de propósito: documento que
// PARECE pronto e não está é o jeito mais fácil de entrar dinheiro em cima de
// um contrato que não vale. A tarja some sozinha quando os campos forem
// preenchidos — não tem interruptor para desligar.

export const EMPRESA = {
  /** Razão social de quem assina o contrato. */
  razaoSocial: null as string | null,
  cnpj: null as string | null,
  /** Endereço completo, como sai no contrato social. */
  endereco: null as string | null,

  /** Para onde vai pedido de suporte, cancelamento e exercício de direito. */
  email: 'contato@usenorte.com.br' as string,

  /**
   * O encarregado pelo tratamento de dados (LGPD, art. 41). Pode ser pessoa
   * ou canal, mas precisa existir e precisa estar publicado — é obrigação
   * legal, não boa prática.
   */
  encarregado: null as string | null,
  encarregadoEmail: 'privacidade@usenorte.com.br' as string,

  /** Comarca do foro. */
  foro: 'Salvador, Bahia' as string,
}

/** O documento está pronto para valer contra alguém? */
export const IDENTIDADE_COMPLETA =
  EMPRESA.razaoSocial !== null && EMPRESA.cnpj !== null && EMPRESA.endereco !== null

/** Última revisão dos documentos. Mudou o texto, mude a data. */
export const REVISADO_EM = '10 de setembro de 2026'

// ─────────────────────────────────────────────────────────────
// QUEM MAIS TOCA NOS DADOS
// ─────────────────────────────────────────────────────────────
//
// A LGPD não exige listar suboperador com nome e sobrenome, mas a alternativa
// é dizer "parceiros de tecnologia" e não dizer nada. Um cliente que quer
// saber onde o dado dele mora merece a resposta, e a resposta cabe numa
// tabela.
//
// `paraQue` é o que aquele fornecedor VÊ, não o que ele é. Serve para a pessoa
// entender o risco sem entender a arquitetura.

export type Subprocessador = {
  nome: string
  paraQue: string
  onde: string
  /** Nulo quando a decisão ainda não foi tomada. */
  decidido: boolean
}

export const SUBPROCESSADORES: Subprocessador[] = [
  {
    nome: 'Supabase',
    paraQue: 'Guarda o banco de dados: é onde ficam produtos, vendas, clientes e usuários.',
    onde: 'São Paulo, Brasil',
    decidido: true,
  },
  {
    nome: 'Vercel',
    paraQue:
      'Roda o sistema e entrega as telas. Vê os dados de passagem, enquanto monta a página; não os guarda.',
    onde: 'São Paulo, Brasil',
    decidido: true,
  },
  {
    nome: 'Anthropic',
    paraQue:
      'É o modelo de linguagem por trás do assistente. Recebe o trecho de conversa e os dados que a pergunta exige — o saldo de uma peça, o total de um dia — para conseguir responder.',
    onde: 'Estados Unidos',
    decidido: true,
  },
  {
    nome: 'Provedor de WhatsApp',
    paraQue:
      'Entrega e recebe as mensagens do assistente. Vê o número de telefone e o conteúdo das mensagens.',
    onde: 'a definir',
    decidido: false,
  },
  {
    nome: 'Meio de pagamento',
    paraQue:
      'Cobra a mensalidade. Recebe os dados de cobrança direto de você — eles não passam pelo Norte nem ficam guardados aqui.',
    onde: 'a definir',
    decidido: false,
  },
]
