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
export const REVISADO_EM = '25 de setembro de 2026'

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
//
// ── a regra para mexer nesta lista ───────────────────────────
// Cada linha tem de bater com o código e com o que está de fato no ar. A
// hospedagem está em mudança (Oracle Cloud em São Paulo é o destino; a Vercel
// é o caminho documentado no README; o render.yaml sobe no Render, na
// Virgínia): as três ficam aqui como `decidido: false` até o dono confirmar
// qual está no ar. Confirmada uma, ela vira `decidido: true` e as outras
// SAEM da lista — fornecedor que não toca no dado não entra na política.
//
// O que ainda não está decidido aparece na tela com a etiqueta "em
// definição". Não é esconder: é dizer que a linha ainda pode mudar.

export type Subprocessador = {
  nome: string
  paraQue: string
  /** Onde o dado é tratado, em português de gente: cidade/país. */
  onde: string
  /** Falso enquanto a escolha do fornecedor (ou da região) não foi confirmada. */
  decidido: boolean
  /** O dado sai do Brasil? Muda a conversa de transferência internacional. */
  foraDoBrasil: boolean
  /** Só entra em cena em certo caso — "só se o assistente estiver ligado". */
  quando?: string
}

export const SUBPROCESSADORES: Subprocessador[] = [
  {
    nome: 'Supabase',
    paraQue:
      'Guarda o banco de dados: produtos, vendas, clientes, usuários, o livro de auditoria, as conversas de WhatsApp, as fotos, vídeos e áudios das campanhas e a sessão do WhatsApp conectado por QR Code (esta, cifrada).',
    onde: 'São Paulo, Brasil',
    decidido: true,
    foraDoBrasil: false,
  },
  {
    nome: 'Oracle Cloud',
    paraQue:
      'Hospedagem: roda o sistema e o conector do WhatsApp por QR Code. Vê os dados de passagem, enquanto monta uma página ou repassa uma mensagem; o banco não mora aqui.',
    onde: 'São Paulo, Brasil',
    decidido: false,
    foraDoBrasil: false,
  },
  {
    nome: 'Vercel',
    paraQue:
      'Hospedagem (alternativa): roda o sistema e entrega as telas. Vê os dados de passagem, enquanto monta a página; não os guarda.',
    onde: 'São Paulo, Brasil',
    decidido: false,
    foraDoBrasil: false,
  },
  {
    nome: 'Render',
    paraQue:
      'Hospedagem (alternativa): roda o sistema. Vê os dados de passagem, enquanto monta a página; não os guarda.',
    onde: 'Estados Unidos (Virgínia)',
    decidido: false,
    foraDoBrasil: true,
  },
  {
    nome: 'Anthropic',
    paraQue:
      'É o modelo de linguagem por trás do assistente. Recebe só as conversas da sua equipe com o assistente, e os dados que a pergunta exige — o saldo de uma peça, o total de um dia. Mensagem de cliente da loja nunca chega ao modelo.',
    onde: 'Estados Unidos',
    decidido: true,
    foraDoBrasil: true,
    quando: 'Só se o assistente estiver ligado.',
  },
  {
    nome: 'Meta Platforms (WhatsApp Business Platform)',
    paraQue:
      'Entrega e recebe as mensagens da loja pelo caminho oficial do WhatsApp. Vê o número de telefone, o nome de perfil e o conteúdo das mensagens. A conta de WhatsApp é da loja, e as mensagens cobradas pela Meta são pagas pela loja direto a ela.',
    onde: 'Fora do Brasil (servidores da Meta)',
    decidido: true,
    foraDoBrasil: true,
    quando: 'Só se a loja conectar o WhatsApp pelo caminho oficial.',
  },
  {
    nome: 'WhatsApp, pela conexão por QR Code',
    paraQue:
      'A loja conecta o próprio WhatsApp lendo um QR Code, como no WhatsApp Web. As mensagens passam pela conta de WhatsApp da loja, pelo nosso conector (serviço nosso, na nossa hospedagem, que não grava texto de mensagem em registro) e pela rede do WhatsApp, operada pela Meta sob os termos que a loja aceitou com o WhatsApp.',
    onde: 'Rede do WhatsApp, fora do Brasil',
    decidido: true,
    foraDoBrasil: true,
    quando: 'Só se a loja escolher a conexão por QR Code.',
  },
  {
    nome: 'Z-API',
    paraQue:
      'Caminho antigo, mantido para quem já usava: entrega e recebe as mensagens por uma conta no Z-API contratada pela própria loja. O Norte guarda as chaves dessa conta cifradas.',
    onde: 'Brasil (a confirmar com o fornecedor)',
    decidido: false,
    foraDoBrasil: false,
    quando: 'Só para a loja que colou a própria conta do Z-API.',
  },
  {
    nome: 'Meio de pagamento',
    paraQue:
      'Cobra a mensalidade. Recebe os dados de cobrança direto de você — eles não passam pelo Norte nem ficam guardados aqui.',
    onde: 'a definir',
    decidido: false,
    foraDoBrasil: false,
  },
]
