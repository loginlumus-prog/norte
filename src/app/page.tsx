import type { Metadata } from 'next'
import type { CSSProperties, ComponentType, ReactNode } from 'react'
import type { Plano } from '@prisma/client'
import {
  PLANOS as LIMITES,
  PLANOS_COM_PRECO,
  RECOMENDADO,
  RECURSOS,
  ORDEM,
  doPlano,
  planoQueAbre,
  type Limite,
} from '@/servidor/planos'
import { PODERES, TODOS_PODERES } from '@/servidor/poderes'
import { Marca, Simbolo } from '@/ui/Marca'
import { AoEntrar } from '@/ui/AoEntrar'
import { ConversaFlutuante } from '@/ui/ConversaFlutuante'
import { CompararPlanos } from '@/ui/CompararPlanos'
import { Estrelas } from '@/ui/Estrelas'
import { BarraTopo } from '@/ui/venda/BarraTopo'
import { Vitrine } from '@/ui/venda/Vitrine'
import { Ramos } from '@/ui/venda/Ramos'
import { Palco } from '@/ui/venda/Palco'
import { SimplesAvancado } from '@/ui/venda/SimplesAvancado'
import { SistemaPorDentro, type TextoTela } from '@/ui/venda/demo/SistemaPorDentro'
import type { TelaId } from '@/ui/venda/demo/estado'
import { Avatar, Barra, Pilula, reais as reaisCentavos } from '@/ui/venda/Pecas'
import { COMECAR, ENTRAR, mailto } from '@/ui/venda/mapa'
import {
  IconeAbaixo,
  IconeAdiante,
  IconeAuditoria,
  IconeCorte,
  IconeExcesso,
  IconeFechamento,
  IconeFiado,
  IconeFreio,
  IconeGuia,
  IconeMais,
  IconeParedes,
  IconePessoas,
  IconePreco,
  IconeRuptura,
  IconeTranca,
  IconeVisto,
} from '@/ui/Icones'

// A página de venda.
//
// Ela existe para uma pessoa que nunca ouviu falar da gente decidir, em dois
// minutos, se vale a conversa. A ordem responde as perguntas na ordem em que
// elas aparecem na cabeça de quem chega:
//
//   1. o que é isto?            → o topo, com o produto grande logo embaixo
//   2. serve para o meu ramo?   → as fichas dos ramos, lidas da tabela real
//   3. como é por dentro?       → o exemplo clicável, oito telas que respondem
//   4. vou conseguir usar?      → simples ou avançado
//   5. o que só vocês têm?      → o assistente, e o controle sobre ele
//   6. resolve o que me dói?    → o bento das dores, cada uma com a tela
//   7. meu dado fica seguro?    → as cinco garantias
//   8. quanto custa?            → os planos e a tabela item por item
//   9. e se…?                   → as dúvidas
//
// ── em 24/09 ela virou branca ────────────────────────────────
// O dono achou a versão anterior amadora e pediu "tema branco, muito
// moderna, fácil de navegar", olhando Monday e ClickUp. O que mudou de
// desenho, e por quê:
//
// • O topo deixou de ser uma cena desenhada sobre azul-noite e passou a ser
//   o PRODUTO, grande, em HTML (`ui/venda/Vitrine.tsx`). Quem chega quer
//   saber o que é; um painel legível responde, uma ilustração sugere.
// • A aurora escura saiu de todas as seções. Azul-noite sobrou só onde é
//   detalhe: o azulejo do símbolo e o bloco pequeno das duas paredes.
// • A barra ganhou o painel "Produto", com os grupos do menu real — é o
//   mapa do sistema inteiro a um clique, em vez de oito âncoras soltas.
// • As telas viraram abas: seis seções de texto-e-figura seguidas cansam;
//   uma área onde a pessoa escolhe o que ver, não.
//
// ── três coisas que NÃO estão aqui, de propósito ─────────────
// • Logo de cliente e depoimento. Não temos ainda. Inventar isso é o tipo de
//   mentira que o primeiro cliente descobre na primeira conversa.
// • Número de mercado ("+30% de vendas"). Não medimos. Promessa que a gente
//   não sabe cumprir vira pedido de reembolso no segundo mês.
// • "O mais pedido" no plano do meio. Estava no selo — e sem cliente nenhum
//   não existe "mais pedido". O selo agora diz o que é verdade: é o plano
//   que a gente RECOMENDA (`RECOMENDADO` em `servidor/planos.ts`).
//
// ── e o "grátis para sempre", que antes estava nessa lista ───
// Ele saía porque cada cliente custava uma instância de WhatsApp desde o
// primeiro dia. Isso deixou de ser verdade: o Grátis não tem assistente
// (`modulos: []`, `creditoMensal: 0`), não custa instância nenhuma, e a
// tabela de planos diz "sem prazo para acabar". O que tem limite é o volume
// (`tetoVendasMes`), e a página diz o número.
//
// ── de onde vem cada número ──────────────────────────────────
// Preço, cota e crédito: `servidor/planos.ts`. Em que plano cada tela abre:
// `RECURSOS` e `LIBERACOES`, pelo mesmo arquivo. O que o assistente faz:
// `servidor/poderes.ts`. O que cada ramo semeia: `servidor/modulos.ts`.
// Nenhum desses aparece digitado à mão aqui — número repetido é o jeito de
// a página passar a prometer o que o sistema não entrega.

export const metadata: Metadata = {
  title: 'Norte — gestão da empresa, do balcão ao fim do mês',
  description:
    'Sistema de gestão para comércio: balcão e caixa, produto com grade, estoque por loja, financeiro com DRE, tarefas e desempenho da equipe. Modo simples para o balcão e avançado para o dono, e um assistente que propõe e espera o seu sim.',
}

/* ═══════════════════════════════════════════════════════════
   Os números, lidos da tabela
   ═══════════════════════════════════════════════════════════ */

const reais = (v: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(v)

const MENOR_MENSAL = Math.min(...PLANOS_COM_PRECO.map((p) => LIMITES[p].mensal!))

/** "Do Balcão", "Da Direção" — o `doPlano` com maiúscula, para começo de frase. */
const DoPlano = (p: Plano) => doPlano(p).replace(/^d/, 'D')

/**
 * Em que plano um recurso da tabela existe, dito em uma frase.
 *
 * Recebe o TÍTULO exato da linha em `RECURSOS`. Se alguém renomear a linha
 * lá e esquecer aqui, a página quebra na hora de montar — e é de propósito:
 * quebrar no build é melhor que mentir no ar.
 */
function desde(titulo: string): string {
  const r = RECURSOS.find((x) => x.titulo === titulo)
  if (!r) throw new Error(`A página de venda cita "${titulo}", que não existe em RECURSOS.`)
  if (r.em.length === ORDEM.length) return 'Em todos os planos, inclusive o Grátis'
  const primeiro = ORDEM.find((p) => r.em.includes(p))!
  return `${DoPlano(primeiro)} para cima`
}

/* ═══════════════════════════════════════════════════════════
   O texto de venda de cada plano
   ═══════════════════════════════════════════════════════════
   Só o que é TEXTO mora aqui. Preço, cota de loja, cota de gente e crédito
   mensal vêm de `servidor/planos.ts`, que é a mesma fonte que a tela de
   assinatura consulta para barrar a criação da sexta loja.

   O sufixo " · em breve" vira etiqueta. Toda linha que corresponde a um
   recurso com `quando: 'breve'` na tabela TEM que levar o sufixo — hoje, a
   nota fiscal e a análise do negócio. */
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
    itens: [],
    fora: [],
  },
  BALCAO: {
    conta: null,
    nota: 'o WhatsApp continua sendo você',
    itens: [
      'Tudo do Grátis, sem teto de vendas',
      'Até três lojas, cada uma com seu estoque',
      'Financeiro e o DRE do mês',
      'Fechamento de mês guiado',
      'Quadros de tarefas com responsável, prazo e prioridade',
      'Preços: margem e markup item a item',
      'Equipe sem limite de cadastro, cada pessoa com o seu papel e a sua loja',
      // Estava sem a etiqueta — e a tabela marca a nota fiscal como
      // "em breve" desde 24/09 (depende de emissor contratado e do
      // certificado A1 de cada loja). Sem a etiqueta, o cartão prometia o que
      // a tabela logo abaixo desmentia.
      'Nota fiscal no balcão · em breve',
    ],
    fora: ['Assistente', 'Desempenho da equipe em estrelas', 'Crediário próprio'],
  },
  BALCAO_AGENTE: {
    // "R$ 100 de crédito" não diz nada para quem nunca comprou token. O número
    // sai do custo medido por conversa, com cache e roteamento de modelo.
    conta: '~1.650 conversas no WhatsApp',
    // Dizia "renovado todo mês": não existe rotina que devolva o crédito na
    // virada do mês (`recarregarCredito` só é chamada pela recarga). A recarga
    // existe, pela tela de Assinatura.
    nota: 'recarga quando quiser',
    itens: [
      'Tudo do Balcão, e até cinco lojas',
      'Assistente com o nome que você der',
      // Dizia "cobrança de atraso": cobrar crediário é poder que ainda não
      // existe (`servidor/poderes.ts`), e o crediário nem é deste plano.
      'Aviso de peça acabando e relatório de manhã e à noite',
      'Linha do tempo, modelos de quadro e desempenho da equipe em estrelas',
      'Metas e comissão por vendedor',
      'Preço sugerido para a margem alvo',
      'Teto de valor e de gasto que você define',
      'Toda ação do assistente assinada no livro',
      'Análise básica: o que aconteceu no dia e no mês · em breve',
    ],
    fora: [
      'Previsão de ruptura contra o prazo do fornecedor',
      'Curva ABC e comparação entre lojas',
      'Crediário próprio',
    ],
  },
  REDE: {
    // Era "O mais pedido". Sem cliente, não existe "mais pedido" — ver o topo.
    selo: 'Recomendado',
    conta: '~5.000 conversas no WhatsApp',
    nota: 'recarga quando quiser',
    itens: [
      'Tudo do Assistente, sem limite de loja nem de gente',
      'Previsão de ruptura: quantos dias o saldo aguenta, e até quando pedir',
      'Comparação entre lojas: venda, margem e estoque parado lado a lado',
      'Curva ABC e dinheiro parado',
      'Crediário próprio: parcelas, juros de atraso e a lista de quem deve',
      'Quadro da rede inteira e desempenho completo, loja a loja',
      'Turnos de caixa por pessoa: quem abriu, quanto tempo, quanto vendeu',
      'Análise profunda: onde está perdendo e o que fazer · em breve',
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
  ['Atendimento direto', 'Uma pessoa nossa que conhece a sua operação pelo nome.'],
  ['Crédito sob medida', 'O volume de conversa de uma rede grande não cabe em número de tabela.'],
]

const cotaLojas = (l: Limite) =>
  l.unidades === null ? 'Sem limite' : l.unidades === 1 ? '1 loja' : `Até ${l.unidades}`

// O número que se paga não é quanta gente existe, é quanta gente fica dentro
// ao mesmo tempo. Cadastrar a equipe toda é de graça em qualquer plano — e
// dizer isso no cartão é o que evita a pergunta na hora da venda.
const cotaGente = (l: Limite) =>
  l.vagas === null ? 'Sem limite' : l.vagas === 1 ? '1 por vez' : `${l.vagas} ao mesmo tempo`

/* ═══════════════════════════════════════════════════════════
   O sistema por dentro
   ═══════════════════════════════════════════════════════════
   Uma chamada e três frases por tela, cada frase dizendo uma coisa que a tela
   FAZ — conferida contra o manual (`servidor/guia.ts`) e contra a tela de
   verdade. A última linha diz em que plano, lida da tabela. As telas em si
   são o exemplo clicável de `ui/venda/demo/`. */
const TEXTOS: Record<TelaId, TextoTela> = {
  painel: {
    chamada: 'O dia da loja numa olhada, e o que precisa de você.',
    frases: [
      'No simples, o painel abre pelo que precisa de você hoje — o que acabou, a conta que vence, a proposta esperando — e cada linha leva à tela que resolve.',
      'No avançado, o período que você escolher, de hoje ao mês passado, sempre contra o período anterior do mesmo tamanho.',
      'Hora a hora contra a mesma semana passada, ticket médio, margem sobre o custo e quem mais vendeu.',
    ],
    plano: `${desde('Relatório de vendas')}.`,
  },
  balcao: {
    chamada: 'Vender rápido, e fechar o caixa sem susto.',
    frases: [
      'Bipe a etiqueta e o Enter lança. Quem não etiqueta — sorveteria, lanchonete, floricultura — vende tocando em botões grandes.',
      'Várias formas de pagamento na mesma venda, troco grande na tela, e três preços por produto: à vista, no cartão e no crediário.',
      'O caixa abre, sangra e fecha conferindo a gaveta. A diferença vai para o livro — inclusive quando é zero.',
    ],
    plano: `${desde('Balcão, caixa e sangria')}.`,
  },
  estoque: {
    chamada: 'Cada loja com o seu saldo, e o aviso antes de faltar.',
    frases: [
      'Cada loja com o saldo dela. Transferir sai de uma e entra na outra na mesma operação.',
      '“Vai faltar”: quantos dias o saldo aguenta no ritmo dos últimos 30 dias, contra o prazo de reposição — e até quando pedir.',
      'O histórico é a verdade: se o saldo divergir da soma dos movimentos, o sistema acusa em vez de esconder.',
    ],
    plano: `Estoque: ${desde('Estoque, entrada de mercadoria e balanço').toLowerCase()}. “Vai faltar”: ${desde('Previsão de ruptura com prazo de reposição').toLowerCase()}.`,
  },
  financeiro: {
    chamada: 'Saber quanto sobrou, e não só quanto vendeu.',
    frases: [
      'Contas a pagar avisando o que venceu, o que vence hoje e o que vem nos próximos 15 dias.',
      'O resultado do mês puxa direto das vendas, com o custo de cada peça e a taxa da maquininha descontados venda a venda.',
      'O fechamento guiado diz o que falta conferir — caixa, gaveta, contas, taxa, fiado — antes de o número do mês valer.',
    ],
    plano: `${desde('Financeiro com DRE do mês')}.`,
  },
  clientes: {
    chamada: 'Quem compra, quanto, e há quanto tempo sumiu.',
    frases: [
      'Busca por nome, telefone ou CPF, e a ficha de cada um com o histórico de compra.',
      'Fichas prontas para o que vira ação: quem sumiu há mais de 60 dias e quem faz aniversário no mês.',
      'Programa de pontos: a venda com cliente escolhido soma os pontos na hora.',
    ],
    plano: `Ficha do cliente: ${desde('Ficha do cliente com histórico').toLowerCase()}. Pontos: ${desde('Programa de pontos').toLowerCase()}.`,
  },
  tarefas: {
    chamada: 'A equipe no mesmo quadro, e o mês em estrelas.',
    frases: [
      'O quadro no jeito que a equipe já conhece: grupos, situação colorida, responsável, prazo e linha do tempo.',
      'Meta e comissão por vendedor, contando o vendido já sem as devoluções.',
      'De 0 a 5 estrelas por pessoa e por mês: meta batida, tarefa no prazo e dias presente.',
    ],
    plano: `Quadro de tarefas: ${desde('Quadro de tarefas da equipe').toLowerCase()}. Estrelas: ${desde('Desempenho da equipe em estrelas').toLowerCase()}.`,
  },
  analise: {
    chamada: 'Onde o dinheiro está parado, e qual loja puxa a rede.',
    frases: [
      'As lojas lado a lado: vendas, o que entrou, margem, ticket e o que ficou sem saída.',
      'A curva ABC separa o que sustenta a loja do que só ocupa prateleira.',
      'O dinheiro parado em reais, a preço de custo — o que não vende há 90 dias e o que nunca vendeu são as candidatas a promoção.',
    ],
    plano: `${desde('Curva ABC e dinheiro parado')}. No menu, só no modo avançado.`,
  },
  assistente: {
    chamada: 'Um assistente que age — e que pede antes.',
    frases: [
      'Você dá o nome, o jeito de falar e o manual da loja. Ele conta como foi o dia e consulta estoque, caixa e contas.',
      'Para agir — registrar uma compra, lançar uma conta, somar ao estoque a peça que apareceu — ele monta a proposta com o número e espera o seu sim, na tela.',
      'Os tetos moram no banco: valor máximo, desconto máximo, gasto de IA e mensagens por dia. Nenhuma mensagem convence ele a passar.',
    ],
    plano: `${desde('Assistente no WhatsApp')}.`,
  },
}

/** As telas no rodapé, na ordem do menu. */
const TELAS_RODAPE: [string, TelaId][] = [
  ['Painel', 'painel'],
  ['Balcão', 'balcao'],
  ['Estoque', 'estoque'],
  ['Financeiro', 'financeiro'],
  ['Clientes', 'clientes'],
  ['Tarefas e equipe', 'tarefas'],
  ['Análise', 'analise'],
  ['Assistente', 'assistente'],
]

/* ═══════════════════════════════════════════════════════════
   O assistente
   ═══════════════════════════════════════════════════════════
   O que ele faz sai de `PODERES`, a lista FECHADA que o próprio agente
   recebe. O que ainda não foi construído (`disponivel: false`) aparece com
   a etiqueta — e não some, porque é o que a pessoa vai ver apagado na tela
   dele. */
const CONSULTA = TODOS_PODERES.filter((k) => !PODERES[k].escreve).map((k) => PODERES[k])
const AGE = TODOS_PODERES.filter((k) => PODERES[k].escreve).map((k) => PODERES[k])
// O que ele consulta sozinho na tela do exemplo: os de dentro da loja (o
// que responde CLIENTE fica de fora, que lá é outra conversa).
const CONSULTA_EXEMPLO = TODOS_PODERES.filter((k) => !PODERES[k].escreve && !('paraCliente' in PODERES[k])).map(
  (k) => ({ titulo: PODERES[k].titulo, disponivel: PODERES[k].disponivel as boolean }),
)

// "Gain full control", no desenho das referências — mas com o que é NOSSO:
// cada cartão é uma trava que existe no código, e a miniatura embaixo é a
// peça da tela onde a trava aparece.
const CONTROLE: { t: string; d: string; peca: ReactNode }[] = [
  {
    t: 'Ele propõe. Uma pessoa confirma.',
    d: 'Mexeu em dinheiro, preço ou estoque, vira proposta com o número dentro. Vale 24 horas; depois disso o estoque já é outro, e ele propõe de novo.',
    peca: (
      <div className="flex flex-col gap-2 rounded-lg border border-borda bg-superficie p-3">
        <p className="text-[12px] leading-snug text-tinta">
          Registrar a compra de 20 un. · <b className="numero">{reaisCentavos(448)}</b>
        </p>
        <span className="flex gap-1.5 text-[11px] font-semibold">
          <span className="rounded-md border border-borda px-2.5 py-0.5 text-tinta-2">Não</span>
          <span className="rounded-md bg-marca px-2.5 py-0.5 text-marca-tinta">Confirmar</span>
        </span>
      </div>
    ),
  },
  {
    t: 'Teto é número no banco.',
    d: 'Instrução de texto decide o jeito de falar, nunca o que ele pode. E o teto é conferido de novo no servidor, na hora do sim.',
    peca: (
      <dl className="flex flex-col rounded-lg border border-borda bg-superficie px-3 py-1.5 text-[12px]">
        {[
          ['Valor máximo de uma proposta', reais(1000)],
          ['Desconto máximo', '10%'],
        ].map(([t, v]) => (
          <div key={t} className="flex justify-between gap-2 border-t border-borda-suave py-1.5 first:border-t-0">
            <dt className="text-tinta-2">{t}</dt>
            <dd className="numero font-semibold text-tinta">{v}</dd>
          </div>
        ))}
      </dl>
    ),
  },
  {
    t: 'Tudo no livro, com antes e depois.',
    d: 'O que ele propôs e alguém confirmou aparece no nome de quem confirmou, com “assistente” embaixo. Enquanto a conta existir, ninguém edita nem apaga o livro.',
    peca: (
      <div className="flex flex-col gap-1.5 rounded-lg border border-borda bg-superficie p-3 text-[12px]">
        <span className="flex items-center gap-2">
          <Avatar iniciais="MC" />
          <b className="text-tinta">Marina</b>
          <span className="ml-auto text-[10.5px] text-tinta-3">hoje, 10:42</span>
        </span>
        <span className="text-tinta-2">
          Compra registrada · <b className="numero text-tinta">{reaisCentavos(448)}</b>
        </span>
        <span className="text-[10.5px] font-semibold text-marca">proposta do assistente</span>
      </div>
    ),
  },
  {
    t: 'Gasto de IA com teto por dia.',
    // Dizia "a tela mostra o que ele trouxe de volta contra o que custou" — e o
    // "trouxe de volta" ainda não soma nada (nenhuma ação dele emite recibo).
    // O custo do mês é real.
    d: 'Passou do teto do dia, ele para de responder até amanhã. E a tela mostra quanto ele custou de IA no mês.',
    peca: (
      <div className="flex flex-col gap-2 rounded-lg border border-borda bg-superficie p-3 text-[12px]">
        <span className="flex justify-between">
          <span className="text-tinta-2">Gasto de IA hoje</span>
          <span className="numero font-semibold text-tinta">
            {reaisCentavos(1.84)} de {reaisCentavos(5)}
          </span>
        </span>
        <Barra valor={37} tom="bom" />
      </div>
    ),
  },
]

/* ═══════════════════════════════════════════════════════════
   As dores, e a tela que resolve cada uma
   ═══════════════════════════════════════════════════════════
   São as dores de qualquer loja, não as de um fornecedor. O que é nosso é a
   resposta: cada cartão termina com a tela onde o número aparece e o plano
   em que ela abre — lido da tabela. Tela que não existe não entra. */
type Dor = {
  Icone: ComponentType<{ tamanho?: number; className?: string }>
  t: string
  d: string
  tela: string
  plano: string
  peca?: ReactNode
  classe: string
}

const DORES: Dor[] = [
  {
    Icone: IconeRuptura,
    t: 'A peça que acabou sem ninguém ver',
    d: 'Quantos dias o saldo aguenta no ritmo de venda, contra o prazo que o fornecedor leva — e o último dia para pedir e a peça chegar antes de faltar.',
    tela: 'Estoque › Vai faltar',
    plano: desde('Previsão de ruptura com prazo de reposição'),
    classe: 'lg:col-span-2',
    peca: (
      <ul className="flex flex-col gap-1.5">
        {(
          [
            ['Camiseta canelada · Preto · G', 'dura 2 dias · prazo 7', 'Pedir hoje', 'critico'],
            ['Tênis casual · 38', 'dura 9 dias · prazo 7', 'Pedir até 26 set', 'atencao'],
          ] as const
        ).map(([n, d, p, tom]) => (
          <li
            key={n}
            className="flex items-center justify-between gap-3 rounded-lg border border-borda bg-superficie px-3 py-2"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[12.5px] font-semibold text-tinta">{n}</span>
              <span className="numero text-[11px] text-tinta-3">{d}</span>
            </span>
            <Pilula tom={tom}>{p}</Pilula>
          </li>
        ))}
      </ul>
    ),
  },
  {
    Icone: IconeExcesso,
    t: 'Dinheiro parado na prateleira',
    d: 'A curva ABC separa o que sustenta a loja do que só ocupa espaço, e o parado aparece em reais, a preço de custo.',
    tela: 'Análise',
    plano: desde('Curva ABC e dinheiro parado'),
    classe: '',
    peca: (
      <div className="flex h-6 overflow-hidden rounded-md text-[10px] font-bold">
        <span className="grid w-[62%] place-items-center bg-marca text-marca-tinta">A</span>
        <span className="grid w-[23%] place-items-center bg-marca/45 text-tinta">B</span>
        <span className="grid w-[15%] place-items-center bg-atencao-fundo text-atencao">C</span>
      </div>
    ),
  },
  {
    Icone: IconePreco,
    t: 'Preço no chute',
    d: 'Margem e markup item a item, e o preço que a margem alvo pede. O que está abaixo do custo vem numa lista, antes de virar prejuízo.',
    tela: 'Preços',
    // Esta tela abre em dois degraus (`LIBERACOES`): a margem num plano, a
    // sugestão no seguinte. Os dois nomes vêm da escada.
    plano: `Margem ${doPlano(planoQueAbre('precos.margem').codigo)} para cima; preço sugerido ${doPlano(planoQueAbre('precos.sugestao').codigo)}`,
    classe: '',
  },
  {
    Icone: IconeFiado,
    t: 'O fiado no caderno',
    d: 'Crediário com parcelas, juros de atraso e a lista de quem deve, quanto e há quantos dias — e a venda fiada só sai com cliente escolhido.',
    tela: 'Crediário',
    plano: desde('Crediário próprio, com juros de atraso e a lista de quem deve'),
    classe: '',
  },
  {
    Icone: IconePessoas,
    t: '“De quem era isso?”',
    d: 'O quadro diz quem está com o quê e o que parou; as estrelas do mês dizem quem entregou, com número e não impressão.',
    tela: 'Tarefas e Equipe',
    plano: `Quadro ${desde('Quadro de tarefas da equipe').toLowerCase()}`,
    classe: '',
    peca: (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-borda bg-superficie px-3 py-2">
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-tinta">
          <Avatar iniciais="MC" /> Marina
        </span>
        <Estrelas valor={4.5} tamanho="sm" />
      </div>
    ),
  },
  {
    Icone: IconeFechamento,
    t: 'O fim do mês no susto',
    d: 'O fechamento guiado confere caixa, gaveta, contas, taxa da maquininha e fiado — e o resultado do mês sai no formato que o contador reconhece.',
    tela: 'Financeiro › Fechar o mês',
    plano: desde('Fechamento de mês guiado'),
    classe: 'lg:col-span-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-10',
    peca: (
      <ul className="grid gap-1.5 text-[12.5px] sm:grid-cols-2">
        {[
          ['Nenhum caixa aberto', true],
          ['Gaveta batendo', true],
          ['Taxa da maquininha no cálculo', true],
          ['Contas vencidas: 1', false],
        ].map(([t, ok]) => (
          <li
            key={t as string}
            className="flex items-center gap-2 rounded-lg border border-borda bg-superficie px-3 py-2"
          >
            <span
              className={
                'grid size-4 shrink-0 place-items-center rounded-full ' +
                (ok ? 'bg-bom-fundo text-bom' : 'bg-atencao-fundo text-atencao')
              }
            >
              {ok ? <IconeVisto tamanho={10} /> : <span className="text-[9px] font-bold">!</span>}
            </span>
            <span className="text-tinta">{t as string}</span>
          </li>
        ))}
      </ul>
    ),
  },
]

/* ═══════════════════════════════════════════════════════════
   Segurança
   ═══════════════════════════════════════════════════════════ */
const SEGURANCA: {
  Icone: ComponentType<{ tamanho?: number; className?: string }>
  t: string
  d: string
}[] = [
  {
    Icone: IconeParedes,
    t: 'Duas paredes entre empresas',
    d: 'A aplicação só fala com o banco já presa à sua empresa. E o Postgres, por baixo, se recusa a devolver linha de outra — para o dia em que a primeira falhar.',
  },
  {
    Icone: IconeAuditoria,
    t: 'O livro não se apaga',
    // Dizia "inclusive para nós" — e a política de privacidade apaga tudo em
    // até 90 dias depois do fim do contrato. As duas coisas são verdade só
    // com o "enquanto a conta existir".
    d: 'Quem mexeu, no quê, quando, de quanto para quanto. Enquanto a conta existir, ninguém edita nem apaga o livro — nem a sua equipe, nem o sistema. O banco recusa.',
  },
  {
    Icone: IconeCorte,
    t: 'Tirou o acesso, acabou na hora',
    d: 'Desativou alguém no meio do expediente? A próxima tela que ele abrir já pede login. Não espera sessão vencer.',
  },
  {
    Icone: IconeFreio,
    t: 'Porta com freio',
    d: 'Senha errada repetida trava a tentativa por alguns minutos, por conta e por origem — chute em lista não vai longe.',
  },
  {
    Icone: IconeTranca,
    t: 'A tela que tranca',
    d: 'Trinta minutos parada, ela pede a senha de novo — sem perder a venda que estava no balcão.',
  },
]

/* ═══════════════════════════════════════════════════════════
   Dúvidas
   ═══════════════════════════════════════════════════════════ */
const PERGUNTAS: { p: string; r: string }[] = [
  {
    p: 'Eu não vendo fiado. Vou ter que ver crediário na tela?',
    r: 'Não. No cadastro inicial você diz o que a sua empresa usa, e o que não usa some — do menu, dos relatórios e do que o assistente sabe fazer. Ligar depois é uma chave em Configurações.',
  },
  {
    p: 'A moça do balcão vai se perder em tanta tela?',
    r: 'Não precisa ver: o modo simples esconde as telas de análise do menu, abre o painel pelo que precisa de atenção hoje e vende por botões grandes. O modo é do aparelho — o computador do balcão fica no simples, o notebook do dono no avançado. E em toda tela o Guia do Norte explica o que ela faz.',
  },
  {
    p: 'O assistente já responde no WhatsApp?',
    // A conexão existe no código (Z-API, `servidor/assistente/canal.ts`), mas
    // com UMA instância global: uma empresa conversa por vez. Dizer "sim" a
    // todo mundo seria prometer o número de cada loja, que ainda não há.
    r: `A configuração dele — nome, jeito de falar, manual da loja, poderes e tetos — e as propostas esperando o seu sim já estão no sistema. A conversa pelo WhatsApp também já existe, e a conexão do número é montada junto com a nossa equipe — hoje uma loja de cada vez. Quando der para ligar o número de toda loja, a gente avisa; antes disso, não promete data. Ele entra ${doPlano('BALCAO_AGENTE')} para cima.`,
  },
  {
    p: 'O assistente pode dar desconto sozinho? Mexer no meu preço?',
    r: 'Sozinho, nunca: tudo que mexe em dinheiro, preço ou estoque vira proposta que uma pessoa confirma. Oferecer desconto ainda está em construção — e quando chegar, o teto de desconto é número no banco, não instrução de texto. Texto quem manda mensagem consegue tentar sobrescrever.',
  },
  {
    // Dizia "Sim, do Balcão para cima". A nota fiscal está marcada "em breve"
    // na tabela desde 24/09 — responder "sim" aqui era a mentira mais cara da
    // página, porque é a pergunta que decide a assinatura de muita loja.
    p: 'Emite nota fiscal?',
    r: `Ainda não — está marcada como “em breve” na tabela de planos. Ela depende de um emissor contratado e do certificado digital A1 de cada loja, e quando entrar vem em todo plano pago, ${doPlano('BALCAO')} para cima. Até lá, o comprovante do balcão é a via do cliente, não nota.`,
  },
  {
    p: 'Tenho várias lojas. Cada uma com o estoque dela?',
    r: 'Sim, e o consolidado num clique. O dono vê todas; o gerente de cada loja vê só a dele — inclusive se colar na barra de endereço o código de outra.',
  },
  {
    p: 'E os meus dados ficam misturados com os de outra empresa?',
    r: 'Não. O isolamento tem duas paredes: a aplicação só fala com o banco já presa à sua empresa, e o próprio Postgres se recusa a devolver linha de outra. A segunda existe justamente para o dia em que a primeira falhar.',
  },
  {
    p: 'Quanto tempo para começar a usar?',
    r: 'O cadastro inicial leva uns dois minutos, e o sistema já abre com as variações, as categorias e o jeito de vender do seu ramo. Cadastrar o catálogo é o que dá trabalho — e é onde a gente ajuda.',
  },
]

// Os ramos do rodapé: os cinco mais comuns, cada um abrindo a própria ficha.
const RAMOS_RODAPE: [string, string][] = [
  ['Moda', 'roupa'],
  ['Calçados', 'calcados'],
  ['Sorveteria e açaí', 'sorveteria'],
  ['Lanchonete', 'lanchonete'],
  ['Distribuidora', 'distribuidora'],
]

export default function Inicio() {
  return (
    <div className="flex min-h-dvh flex-col bg-superficie text-base">
      {/* O primeiro Tab de quem navega por teclado pula a barra inteira. */}
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-marca px-4 py-2 text-sm font-semibold text-marca-tinta focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>

      <BarraTopo />

      <main id="conteudo">
        {/* ── o topo ──────────────────────────────────────────────
            Centrado, curto e com o produto logo embaixo. Título de duas
            linhas, uma frase, dois botões e a letra miúda que tira o medo
            ("grátis, sem cartão"). A pílula de cima é a novidade de verdade
            desta semana — o modo simples — e leva até ela.

            ── vivo, desde 25/09 ──
            O título entra palavra por palavra e "numa tela só" ganha a cor
            que corre para a marca, com um fio de sol que atravessa de tempos
            em tempos. Atrás, a luz anda devagar (`Palco`). Embaixo, a vitrine
            é uma tarde de loja acontecendo. Tudo CSS na carga — nada espera
            JavaScript para aparecer — e tudo para quando o topo sai da tela. */}
        <Palco id="topo" className="fundo-topo relative isolate overflow-x-clip">
          <div aria-hidden className="grade-fundo pointer-events-none absolute inset-0 -z-10" />
          <div className="mx-auto max-w-6xl px-4 pt-12 pb-16 sm:px-6 md:pt-20 md:pb-24">
            <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
              <a
                href="#modos"
                className="chega group inline-flex items-center gap-2 rounded-full border border-borda bg-superficie py-1 pr-3 pl-1 text-[13px] font-medium text-tinta-2 shadow-norte hover:border-tinta-3"
              >
                <span className="rounded-full bg-marca-suave px-2 py-0.5 text-[11px] font-bold text-marca">
                  Novo
                </span>
                <span className="sm:hidden">Modo simples e avançado</span>
                <span className="hidden sm:inline">Modo simples para o balcão, avançado para o dono</span>
                <IconeAdiante tamanho={13} className="transition-transform group-hover:translate-x-0.5" />
              </a>
              <h1 className="mt-6 text-[2.5rem] leading-[1.04] text-balance sm:text-[3.4rem] lg:text-[4.1rem]">
                <Palavras texto="Do balcão ao fim do mês," />{' '}
                <span className="texto-luz" style={{ '--i': 6 } as CSSProperties}>
                  numa tela só.
                </span>
              </h1>
              <p
                className="chega mt-5 max-w-2xl text-lg leading-relaxed text-balance text-tinta-2 sm:text-xl"
                style={{ '--d': '.4s' } as CSSProperties}
              >
                Venda, estoque, dinheiro e equipe. E um assistente que pede antes de agir.
              </p>
              <div
                className="chega mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center"
                style={{ '--d': '.5s' } as CSSProperties}
              >
                <a
                  href={COMECAR}
                  className="botao-marca rounded-norte px-7 py-3.5 text-center text-[15px] font-semibold text-marca-tinta"
                >
                  Começar grátis
                </a>
                <a
                  href="#produto"
                  className="flex items-center justify-center gap-2 rounded-norte border border-borda bg-superficie px-7 py-3.5 text-[15px] font-semibold text-tinta hover:bg-superficie-2"
                >
                  Explorar o sistema por dentro
                  <IconeAbaixo tamanho={14} className="text-tinta-3" />
                </a>
              </div>
              <p className="chega mt-4 text-sm text-tinta-3" style={{ '--d': '.6s' } as CSSProperties}>
                Grátis para sempre no plano de uma loja · sem cartão
              </p>
            </div>

            <div className="mt-12 md:mt-16">
              <Vitrine />
            </div>
          </div>
        </Palco>

        {/* ── feito para o seu ramo ─────────────────────────────── */}
        <section id="ramos" className="scroll-mt-16 border-t border-borda-suave bg-superficie">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-24">
            <Titulo
              olho="Para quem é"
              titulo="Feito para o seu ramo desde o primeiro dia"
              resumo="Escolha o ramo no cadastro e o Norte já abre com as variações, as categorias e o jeito de vender de quem é do ramo. Toque num deles para ver o que muda."
            />
            <div className="mt-10">
              <Ramos />
            </div>

            <AoEntrar className="cascata mt-12 grid gap-x-8 gap-y-6 sm:grid-cols-3">
              {(
                [
                  [
                    'De uma loja à rede inteira',
                    'Quem tem uma loja nem vê o seletor de loja: ele só aparece quando nasce a segunda. A mesma tela serve às duas.',
                  ],
                  [
                    'Depósito conta como loja',
                    'Cada unidade com estoque e caixa próprios, e o painel soma tudo num clique.',
                  ],
                  [
                    'Cada gerente na sua loja',
                    'O gerente da loja 3 não vê o caixa da 5, e ninguém concede um cargo que ele mesmo não tem.',
                  ],
                ] as const
              ).map(([t, d]) => (
                <div key={t} className="flex flex-col gap-1.5 border-t border-borda pt-4">
                  <h3 className="text-lg">{t}</h3>
                  <p className="text-[15px] leading-relaxed text-tinta-2">{d}</p>
                </div>
              ))}
            </AoEntrar>
          </div>
        </section>

        {/* ── o sistema por dentro ──────────────────────────────────
            Um Norte pequeno para clicar (`ui/venda/demo/`): o menu de
            verdade, oito telas que respondem umas às outras e a chave
            Simples | Avançado no cabeçalho, onde ela mora no sistema. */}
        <section id="produto" className="scroll-mt-16 bg-superficie">
          <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 md:pb-24">
            <Titulo
              centro
              olho="O sistema por dentro"
              titulo="Uma tela para cada parte da loja. Pode mexer."
              resumo="Venda no balcão, pague uma conta, confirme uma proposta do assistente — cada tela responde às outras, como lá dentro. Os números são de exemplo."
            />
            <AoEntrar className="mt-10">
              <div className="surge">
                <SistemaPorDentro textos={TEXTOS} consulta={CONSULTA_EXEMPLO} />
              </div>
            </AoEntrar>
          </div>
        </section>

        {/* ── simples ou avançado ───────────────────────────────── */}
        <section id="modos" className="scroll-mt-16 bg-fundo">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 md:py-24 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <div className="flex flex-col gap-6">
              <Titulo
                olho="Fácil de verdade"
                titulo="Simples para o balcão. Avançado para o dono."
                resumo="A mesma ferramenta é aberta por duas pessoas muito diferentes. Uma chave decide quanto do sistema aparece de uma vez."
              />
              <ul className="flex flex-col gap-4">
                {(
                  [
                    [
                      'O simples mostra o essencial',
                      'O menu esconde Caixa, Preços, Análise e Auditoria; o painel abre pelo que precisa de você hoje; o balcão vende por botões grandes.',
                    ],
                    [
                      'O modo é do aparelho, não da pessoa',
                      'O computador do balcão fica no simples para sempre, seja quem for que sentar. O notebook do dono fica no avançado.',
                    ],
                    [
                      'Nenhum dos dois tira permissão',
                      'O modo decide o que se vê primeiro, nunca o que se pode. E quem ninguém configurou começa no simples.',
                    ],
                  ] as const
                ).map(([t, d]) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-marca-suave text-marca">
                      <IconeVisto tamanho={12} />
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-base font-semibold text-tinta">{t}</span>
                      <span className="text-[15px] leading-relaxed text-tinta-2">{d}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="flex items-start gap-3 rounded-xl border border-borda bg-superficie p-4 text-[14px] leading-relaxed text-tinta-2">
                <IconeGuia tamanho={24} className="mt-0.5 shrink-0 text-marca" />
                <span>
                  <b className="text-tinta">E o Guia do Norte em toda tela.</b> A ajuda sabe o
                  sistema inteiro: o que a tela faz, o passo a passo e as perguntas de quem está
                  nela — sem sair do lugar.
                </span>
              </p>
            </div>
            <SimplesAvancado />
          </div>
        </section>

        {/* ── o assistente ──────────────────────────────────────────
            O diferencial. Em cima, o que ele faz (da lista fechada de
            poderes) e a conversa acontecendo; embaixo, o controle — as
            quatro travas, cada uma com a peça da tela onde ela aparece. */}
        <section id="assistente" className="scroll-mt-16 bg-superficie">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-24">
            <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
              <div className="flex flex-col gap-8">
                <Titulo
                  olho="O diferencial"
                  titulo="Um assistente que age. E que pede antes."
                  resumo="Ele não é um chat de respostas prontas: lê o seu estoque, o seu caixa e as suas contas de verdade. Você dá o nome, o jeito de falar — e decide, em número, até onde ele vai."
                />
                <div className="grid gap-6 sm:grid-cols-2">
                  <ListaPoderes titulo="Consulta sozinho" poderes={CONSULTA} />
                  <ListaPoderes titulo="Propõe, e você confirma" poderes={AGE} />
                </div>
                <p className="text-[13px] leading-relaxed text-tinta-3">
                  A configuração dele e as propostas já funcionam dentro do sistema. A conversa
                  pelo WhatsApp também existe, e o número é conectado junto com a nossa equipe —
                  hoje uma loja de cada vez. {desde('Assistente no WhatsApp')}.
                </p>
              </div>

              <div className="papel-conversa rounded-3xl border border-borda-suave bg-fundo p-5 sm:p-7 lg:sticky lg:top-24">
                <ConversaFlutuante />
              </div>
            </div>

            <div className="mt-20">
              <h3 className="text-center text-[1.75rem] leading-tight sm:text-[2rem]">
                O controle é seu, e é número.
              </h3>
              <p className="mx-auto mt-3 max-w-2xl text-center text-base leading-relaxed text-tinta-2">
                Personalidade é texto; permissão não. As quatro travas moram no banco, onde
                mensagem nenhuma alcança.
              </p>
              <AoEntrar className="cascata mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {CONTROLE.map((c) => (
                  <div
                    key={c.t}
                    className="flex flex-col gap-4 rounded-2xl border border-borda-suave bg-fundo p-5"
                  >
                    <div className="flex flex-col gap-2">
                      <h4 className="font-display text-lg leading-snug font-bold text-titulo">{c.t}</h4>
                      <p className="text-[14px] leading-relaxed text-tinta-2">{c.d}</p>
                    </div>
                    <div className="mt-auto">{c.peca}</div>
                  </div>
                ))}
              </AoEntrar>
            </div>
          </div>
        </section>

        {/* ── o que resolve ───────────────────────────────────────
            Bento: a dor com mais mecânica para mostrar ganha o cartão largo
            (a ruptura, com a lista de "pedir até"), as do meio ficam em
            fileira, e o fechamento do mês — a dor que junta todas as outras
            — fecha a grade na largura inteira. Cada cartão termina com a
            tela e o plano. */}
        <section id="resolve" className="scroll-mt-16 bg-fundo">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-24">
            <Titulo
              olho="O que resolve"
              titulo="As dores do varejo, e onde cada uma é resolvida"
              resumo="Cada uma termina com o nome da tela onde o número aparece. Não é promessa de consultoria: é o lugar onde você vai olhar."
            />
            <AoEntrar className="cascata mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {DORES.map((d) => (
                <article
                  key={d.t}
                  className={'flex flex-col gap-5 rounded-2xl border border-borda bg-superficie p-6 shadow-norte ' + d.classe}
                >
                  <div className="flex flex-col gap-3">
                    <span className="grid size-11 place-items-center rounded-xl bg-marca-suave text-marca">
                      <d.Icone tamanho={28} />
                    </span>
                    <h3 className="text-xl leading-snug">{d.t}</h3>
                    <p className="text-[15px] leading-relaxed text-tinta-2">{d.d}</p>
                    <p className="text-[13px] text-tinta-3">
                      Na tela <span className="font-semibold text-tinta-2">{d.tela}</span> · {d.plano}
                    </p>
                  </div>
                  {d.peca && <div className="mt-auto">{d.peca}</div>}
                </article>
              ))}
            </AoEntrar>
          </div>
        </section>

        {/* ── segurança ───────────────────────────────────────────
            O único bloco azul-noite da página é aqui, e pequeno: o desenho
            das duas paredes. É detalhe, não seção — e o azul-noite é a cor do
            "por baixo", que é exatamente o que o desenho mostra. */}
        <section id="seguranca" className="scroll-mt-16 bg-superficie">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 md:py-24 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
            <div className="flex flex-col gap-8">
              <Titulo
                olho="Segurança"
                titulo="O que a gente faz para o seu dado não virar problema"
                resumo="Isto costuma ficar escondido no contrato. Fica aqui porque é o que separa sistema de várias empresas feito direito de sistema de uma empresa adaptado às pressas."
              />
              <div className="nav-fundo flex flex-col gap-4 rounded-2xl p-6 text-[13px]" aria-hidden>
                <span className="text-[11px] font-bold tracking-[0.14em] text-sol-claro uppercase">
                  Duas paredes
                </span>
                {[
                  ['Sua empresa', 'o pedido chega'],
                  ['A aplicação', 'só fala com o banco já presa à sua empresa'],
                  ['O Postgres', 'recusa devolver linha de outra empresa'],
                ].map(([t, d], i) => (
                  <div key={t} className="flex items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-nav-3 font-bold text-nav-tinta">
                      {i + 1}
                    </span>
                    <span className="flex flex-col leading-snug">
                      <span className="font-semibold text-nav-tinta">{t}</span>
                      <span className="text-nav-tinta-2">{d}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <AoEntrar className="cascata flex flex-col">
              {SEGURANCA.map(({ Icone, t, d }) => (
                <div key={t} className="flex gap-4 border-t border-borda py-5 first:border-t-0 first:pt-0">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-borda text-marca">
                    <Icone tamanho={26} />
                  </span>
                  <span className="flex flex-col gap-1">
                    <h3 className="text-lg">{t}</h3>
                    <span className="text-[15px] leading-relaxed text-tinta-2">{d}</span>
                  </span>
                </div>
              ))}
            </AoEntrar>
          </div>
        </section>

        {/* ── planos ──────────────────────────────────────────────
            ── o Grátis e o Corporativo em faixas próprias ──
            Quatro cartões de peso tão diferente numa fileira achatam os
            pagos: o olho compara R$ 0 com R$ 1.500 e para de comparar o que
            importa. O Grátis fica numa faixa quieta em cima; o Corporativo,
            que não tem preço de tabela nem se assina sozinho, numa faixa
            larga embaixo. Os três do meio são os que disputam de verdade.

            ── e por que o número vem do servidor ──
            A MESMA fonte que a tela de assinatura lê para barrar a sexta
            loja. Divergir aqui é prometer na venda o que o sistema não
            entrega. */}
        <section id="planos" className="scroll-mt-16 bg-fundo">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-24">
            <Titulo
              centro
              olho="Planos"
              titulo="Preço por tamanho de operação"
              resumo={`A partir de ${reais(MENOR_MENSAL)} por mês, sem taxa de implantação. Precisa de mais gente dentro ao mesmo tempo? O próximo plano abre mais vagas.`}
            />

            <div className="mx-auto mt-10 flex max-w-2xl flex-col gap-4 rounded-2xl border border-borda bg-superficie p-6 sm:flex-row sm:items-center sm:justify-between lg:max-w-none">
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h3 className="text-xl">{LIMITES.GRATIS.titulo}</h3>
                  <span className="numero text-sm font-semibold text-bom">
                    R$ 0 · {CARTOES.GRATIS.nota}
                  </span>
                </div>
                <p className="max-w-2xl text-[15px] leading-relaxed text-tinta-2">
                  Uma loja, uma pessoa por vez, até {LIMITES.GRATIS.tetoVendasMes} vendas no mês.
                  Balcão, caixa, produto, estoque, cliente e um quadro de tarefas funcionam igual. É
                  onde a loja pequena pode ficar — não uma demonstração com prazo.
                </p>
              </div>
              <a
                href={mailto('Quero começar no plano Grátis')}
                className="shrink-0 rounded-norte border border-borda px-5 py-2.5 text-center text-sm font-semibold text-tinta hover:bg-superficie-2"
              >
                Começar de graça
              </a>
            </div>

            <AoEntrar className="cascata mx-auto mt-5 grid max-w-2xl gap-5 lg:max-w-none lg:grid-cols-3 lg:items-stretch">
              {PLANOS_COM_PRECO.map((codigo) => {
                const l = LIMITES[codigo]
                const c = CARTOES[codigo]
                const eleito = codigo === RECOMENDADO
                return (
                  <div
                    key={codigo}
                    className={
                      'relative flex flex-col rounded-2xl bg-superficie p-6 ' +
                      (eleito ? 'shadow-norte-alta ring-2 ring-marca' : 'shadow-norte ring-1 ring-borda')
                    }
                  >
                    {eleito && c.selo && (
                      <span className="absolute -top-3 left-6 rounded-full bg-marca px-3 py-1 text-[11px] font-bold tracking-[0.08em] text-marca-tinta uppercase">
                        {c.selo}
                      </span>
                    )}
                    <h3 className="text-2xl">{l.titulo}</h3>
                    <p className="mt-2 min-h-[3em] text-[14px] leading-relaxed text-tinta-2">{l.resumo}</p>

                    <p className="mt-6 flex items-baseline gap-1.5">
                      <span className="numero font-display text-[2.75rem] leading-none font-bold tracking-[-0.03em] text-titulo">
                        {reais(l.mensal!)}
                      </span>
                      <span className="text-sm text-tinta-3">/mês</span>
                    </p>
                    <p className="mt-2 text-xs text-tinta-3">
                      {/* Dizia "+ R$ 40 por pessoa a mais dentro ao mesmo
                          tempo" — e a vaga extra não se compra: o login só
                          olha a cota (`ocuparVaga`). O caminho hoje é subir. */}
                      {l.vagas !== null
                        ? 'Mais gente dentro ao mesmo tempo? O próximo plano abre mais vagas.'
                        : 'Sem taxa de implantação'}
                    </p>

                    <a
                      href={mailto(`Quero o plano ${l.titulo}`)}
                      className={
                        'mt-5 rounded-norte px-4 py-2.5 text-center text-sm font-semibold ' +
                        (eleito
                          ? 'botao-marca text-marca-tinta'
                          : 'border border-borda text-tinta hover:bg-superficie-2')
                      }
                    >
                      Quero {l.artigo} {l.titulo}
                    </a>

                    <dl className="mt-6">
                      <Ficha rotulo="Lojas" valor={cotaLojas(l)} />
                      <Ficha rotulo="Pessoas dentro" valor={cotaGente(l)} />
                      <Ficha
                        rotulo="Crédito de IA"
                        valor={l.creditoMensal ? `${reais(l.creditoMensal)}/mês` : 'Sem assistente'}
                        nota={c.conta}
                        rodape={c.nota}
                      />
                    </dl>

                    <ul className="mt-5 flex flex-1 flex-col gap-2 border-t border-borda-suave pt-4">
                      {c.itens.map((x) => {
                        const breve = x.endsWith(' · em breve')
                        const texto = breve ? x.slice(0, -' · em breve'.length) : x
                        return (
                          <li key={x} className="flex gap-2 text-[13.5px] leading-snug text-tinta-2">
                            <IconeVisto
                              tamanho={14}
                              className={'mt-0.5 shrink-0 ' + (breve ? 'text-tinta-3' : 'text-bom')}
                            />
                            <span>
                              {texto}
                              {breve && <EmBreve />}
                            </span>
                          </li>
                        )
                      })}
                      {/* O que NÃO tem, no fim. Esconder o que falta é o que
                          faz o cliente descobrir depois de assinar. */}
                      {c.fora.map((x) => (
                        <li
                          key={x}
                          className="flex gap-2 text-[13.5px] leading-snug text-tinta-3 line-through decoration-tinta-3/40"
                        >
                          <IconeMais tamanho={14} className="mt-0.5 shrink-0 rotate-45 opacity-60" />
                          {x}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </AoEntrar>

            {/* O Corporativo, em faixa larga e clara. O que se contrata aqui
                é a condução do negócio junto com o sistema — por isso o lado
                direito não tem preço: tem o convite para conversar. */}
            <div className="mx-auto mt-5 flex max-w-2xl flex-col gap-8 rounded-2xl border border-borda bg-superficie p-6 sm:p-8 lg:max-w-none lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-2xl">
                <span className="flex items-center gap-2 text-[11px] font-bold tracking-[0.14em] text-marca uppercase">
                  <Simbolo tamanho={18} id="corporativo-sol" /> Para rede grande
                </span>
                <h3 className="mt-2 text-2xl">{LIMITES.CORPORATIVO.titulo}</h3>
                <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-tinta-2">
                  {LIMITES.CORPORATIVO.resumo}
                </p>
                <div className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-3">
                  {CORPORATIVO_EXTRAS.map(([t, d]) => (
                    <div key={t} className="flex flex-col gap-1 border-t border-borda pt-3">
                      <p className="text-[14px] font-bold text-tinta">{t}</p>
                      <p className="text-[13px] leading-relaxed text-tinta-2">{d}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-3 lg:w-56 lg:items-end lg:text-right">
                <p className="font-display text-2xl leading-none font-bold text-titulo">Sob consulta</p>
                <p className="text-[13px] leading-relaxed text-tinta-2">
                  Sem limite de loja nem de gente, com {CARTOES.CORPORATIVO.conta}.
                </p>
                <a
                  href={mailto('Quero conversar sobre o Corporativo')}
                  className="rounded-norte border border-borda px-6 py-3 text-center text-sm font-semibold text-tinta hover:bg-superficie-2"
                >
                  Falar com a gente
                </a>
              </div>
            </div>

            <p className="mt-5 text-center text-xs text-tinta-3">
              Valores mensais, por empresa. Cadastrar a equipe é livre em todo plano; o que se paga
              é quanta gente fica dentro ao mesmo tempo. {LIMITES.REDE.artigo === 'a' ? 'A' : 'O'}{' '}
              {LIMITES.REDE.titulo} não tem teto.
            </p>

            {/* A tabela item por item. Cartão vende, tabela decide: quem está
                com um cartão quase escolhido tem UMA pergunta específica, e
                ela responde sem ninguém do outro lado. */}
            <div className="mt-20">
              <h3 className="text-[1.75rem] leading-tight sm:text-[2rem]">Item por item</h3>
              <p className="mt-2 mb-6 max-w-[60ch] text-[15px] text-tinta-2">
                Tudo que muda de um plano para o outro, sem asterisco. O que ainda não existe está
                marcado “em breve”.
              </p>
              <CompararPlanos />
            </div>
          </div>
        </section>

        {/* ── dúvidas ─────────────────────────────────────────────
            `<details>` de verdade: abre sem JavaScript, o leitor de tela
            anuncia aberto e fechado, e o Ctrl+F do navegador acha texto
            dentro da resposta fechada. A abertura desliza onde o navegador
            sabe animar altura (ver `.perguntas` no globals). */}
        <section id="duvidas" className="scroll-mt-16 bg-superficie">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 md:py-24 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
            <div className="flex flex-col gap-5">
              <Titulo olho="Dúvidas" titulo="O que costumam perguntar antes de assinar" />
              <p className="text-[15px] leading-relaxed text-tinta-2">
                Não achou a sua?{' '}
                <a href={mailto('Tenho uma dúvida sobre o Norte')} className="font-semibold text-marca underline-offset-4 hover:underline">
                  Escreva para a gente
                </a>
                .
              </p>
            </div>
            <div className="perguntas flex flex-col">
              {PERGUNTAS.map((q) => (
                <details key={q.p} className="group border-b border-borda">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md py-5 text-left text-base font-semibold text-tinta [&::-webkit-details-marker]:hidden">
                    {q.p}
                    <span
                      aria-hidden
                      className="grid size-7 shrink-0 place-items-center rounded-full border border-borda text-tinta-2 transition-transform duration-300 group-open:rotate-45"
                    >
                      <IconeMais tamanho={14} />
                    </span>
                  </summary>
                  <p className="pb-5 text-[15px] leading-relaxed text-tinta-2">{q.r}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── o fechamento ────────────────────────────────────────
            Grande e claro: um painel no azul mais suave da marca, com o
            símbolo e uma frase. O botão principal abre um e-mail — e o texto
            diz isso antes do clique, porque ainda não existe cadastro
            sozinho: a gente monta o ambiente junto. */}
        <section id="comecar" className="scroll-mt-16 bg-superficie">
          <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 md:pb-24">
            <div className="relative isolate overflow-hidden rounded-3xl border border-borda bg-marca-suave px-6 py-14 text-center sm:px-12 md:py-20">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10"
                style={{
                  background:
                    'radial-gradient(40rem 20rem at 50% 0%, color-mix(in srgb, var(--superficie) 70%, transparent), transparent 70%), radial-gradient(30rem 18rem at 100% 100%, color-mix(in srgb, var(--sol) 12%, transparent), transparent 70%)',
                }}
              />
              <Simbolo tamanho={52} id="fim-sol" className="mx-auto" />
              <h2 className="mx-auto mt-6 max-w-2xl text-[2.25rem] leading-[1.05] text-balance sm:text-[3rem]">
                Comece pelo que dói mais.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-tinta-2">
                A gente monta o seu ambiente, sobe o catálogo junto com você e, no plano com
                assistente, liga ele com o nome que você escolher. Em duas semanas você sabe se
                vale.
              </p>
              <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
                <a
                  href={mailto('Quero começar no Norte')}
                  className="botao-marca rounded-norte px-7 py-3.5 text-[15px] font-semibold text-marca-tinta"
                >
                  Começar grátis
                </a>
                <a
                  href="#planos"
                  className="rounded-norte border border-borda bg-superficie px-7 py-3.5 text-[15px] font-semibold text-tinta hover:bg-superficie-2"
                >
                  Ver os planos
                </a>
              </div>
              <p className="mt-4 text-sm text-tinta-3">
                Grátis para sempre no plano de uma loja · sem cartão · o botão abre um e-mail para
                a gente
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* ── o rodapé ──
          Só link que existe: âncora desta página, termos, privacidade e a
          entrada. Termos e privacidade moram aqui porque é onde quem procura
          procura — e quem não acha desconfia, com razão. */}
      <footer className="border-t border-borda bg-fundo">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]">
          <div className="flex flex-col gap-4">
            <Marca tamanho={26} id="rodape-sol" />
            <p className="max-w-xs text-sm leading-relaxed text-tinta-2">
              Gestão da empresa, do balcão ao fim do mês. Cada empresa entra pelo próprio endereço;
              recebeu um convite? Use o link que chegou para você.
            </p>
          </div>
          <Coluna
            titulo="Produto"
            links={[
              ...TELAS_RODAPE.map(([nome, id]) => ({ nome, href: `#tela-${id}` })),
              { nome: 'Simples ou avançado', href: '#modos' },
              { nome: 'Segurança', href: '#seguranca' },
            ]}
          />
          <Coluna
            titulo="Para quem é"
            links={RAMOS_RODAPE.map(([nome, id]) => ({ nome, href: `#ramo-${id}` }))}
          />
          <Coluna
            titulo="Empresa"
            links={[
              { nome: 'Planos', href: '#planos' },
              { nome: 'Dúvidas', href: '#duvidas' },
              { nome: 'Falar com a gente', href: mailto('Contato pelo site') },
              { nome: 'Entrar', href: ENTRAR },
            ]}
          />
          <Coluna
            titulo="Legal"
            links={[
              { nome: 'Termos de uso', href: '/termos' },
              { nome: 'Privacidade', href: '/privacidade' },
            ]}
          />
        </div>
        <div className="border-t border-borda-suave">
          <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-tinta-3 sm:px-6">
            © {new Date().getFullYear()} Norte. Os números das telas desta página são de exemplo.
          </p>
        </div>
      </footer>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════
   Peças da página
   ═══════════════════════════════════════════════════════════ */

function Titulo({
  olho,
  titulo,
  resumo,
  centro = false,
}: {
  olho: string
  titulo: string
  resumo?: string
  centro?: boolean
}) {
  return (
    <AoEntrar className={'cascata flex max-w-2xl flex-col gap-3 ' + (centro ? 'mx-auto items-center text-center' : '')}>
      <span className="text-[13px] font-bold tracking-[0.12em] text-marca uppercase">{olho}</span>
      <h2 className="text-[2rem] leading-[1.08] text-balance sm:text-[2.5rem] lg:text-[2.75rem]">
        {titulo}
      </h2>
      {resumo && <p className="text-[17px] leading-relaxed text-tinta-2 sm:text-lg">{resumo}</p>}
    </AoEntrar>
  )
}

/**
 * O título partido em palavras, cada uma com o seu atraso (`--i`). É CSS
 * puro na carga (`.palavra` no globals): o servidor manda as palavras já no
 * lugar, e a entrada roda sozinha na primeira pintura.
 */
function Palavras({ texto, de = 0 }: { texto: string; de?: number }) {
  const partes = texto.split(' ')
  return (
    <>
      {partes.map((p, i) => (
        <span key={i}>
          <span className="palavra" style={{ '--i': de + i } as CSSProperties}>
            {p}
          </span>
          {i < partes.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

function EmBreve() {
  return (
    <span className="ml-1.5 inline-block rounded-full bg-superficie-2 px-1.5 py-0.5 align-middle text-[9.5px] font-bold tracking-wide whitespace-nowrap text-tinta-3 uppercase">
      em breve
    </span>
  )
}

function ListaPoderes({
  titulo,
  poderes,
}: {
  titulo: string
  poderes: { titulo: string; resumo: string; disponivel: boolean }[]
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] font-bold tracking-[0.12em] text-tinta-3 uppercase">{titulo}</p>
      <ul className="flex flex-col gap-3">
        {poderes.map((p) => (
          <li key={p.titulo} className="flex gap-2.5">
            <IconeVisto
              tamanho={15}
              className={'mt-1 shrink-0 ' + (p.disponivel ? 'text-bom' : 'text-tinta-3')}
            />
            <span className="flex flex-col gap-0.5">
              <span className={'text-[15px] font-semibold ' + (p.disponivel ? 'text-tinta' : 'text-tinta-2')}>
                {p.titulo}
                {!p.disponivel && <EmBreve />}
              </span>
              <span className="text-[13.5px] leading-snug text-tinta-2">{p.resumo}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Uma linha da ficha do plano: rótulo à esquerda, número à direita.
 *
 * É `<dl>` de verdade porque é exatamente isso — termo e definição. Leitor de
 * tela anuncia "Lojas, até 5"; num par de divs ele leria "até 5" solto.
 */
function Ficha({
  rotulo,
  valor,
  nota,
  rodape,
}: {
  rotulo: string
  valor: string
  nota?: string | null
  rodape?: string
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 border-t border-borda-suave py-2.5">
      <dt className="text-[13px] text-tinta-2">{rotulo}</dt>
      <dd className="numero ml-auto text-[13px] font-bold text-tinta">{valor}</dd>
      {(nota || rodape) && (
        <dd className="w-full">
          {nota && <span className="numero block pt-1 text-[11.5px] font-semibold text-bom">{nota}</span>}
          {rodape && (
            <span className="block pt-0.5 text-right text-[11px] leading-snug text-tinta-3">{rodape}</span>
          )}
        </dd>
      )}
    </div>
  )
}

function Coluna({ titulo, links }: { titulo: string; links: { nome: string; href: string }[] }) {
  return (
    <nav aria-label={titulo} className="flex flex-col gap-3">
      <p className="text-[12px] font-bold tracking-[0.12em] text-tinta uppercase">{titulo}</p>
      <ul className="flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.href + l.nome}>
            <a href={l.href} className="text-sm text-tinta-2 hover:text-marca">
              {l.nome}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
