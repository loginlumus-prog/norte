import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { pode, podeVerPlanos } from '@/servidor/permissao'
import { assinaturaDe, opcoesDeTroca, extratoDeCredito } from '@/servidor/assinatura'
import { eventosDePedido, pedidosParaTela, type Pedido } from '@/servidor/pedidos'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Aviso, Situacao, Vazio } from '@/ui/base'
import { Numero, Secao, Tira, brl } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Planos } from './Planos'
import { Credito } from './Credito'
import { Comparar } from './Comparar'
import { plural } from '@/ui/texto'
import { PLANOS, PRECOS, mensalidade, type Limite } from '@/servidor/planos'
import type { Assinatura } from '@/servidor/assinatura'

export const metadata: Metadata = { title: 'Assinatura' }

// A tela da assinatura.
//
// Ela responde três perguntas, nesta ordem, porque é a ordem em que elas
// aparecem na cabeça de quem abre:
//
//   1. o que eu tenho, e quanto ele custa por mês?
//   2. quanto de crédito de IA me resta, e dura quanto?
//   3. e se eu quiser mudar?
//
// O extrato fica por último e recolhido: ele é prova, não é notícia.
//
// ── a conta, linha por linha ─────────────────────────────────
// Desde a tabela de 02/10/2026 a mensalidade é uma soma: a primeira loja,
// cada loja a mais, o assistente. A tela mostra a soma aberta, e não só o
// total, pela regra de ouro de `planos.ts`: o cliente nunca descobre a
// cobrança na fatura. Quem abre a terceira loja e vê o total subir precisa
// ver, na mesma tela, de onde veio o aumento.

const SITUACAO: Record<string, { texto: string; nivel: 'bom' | 'atencao' | 'critico' | 'neutro' }> = {
  TESTE: { texto: 'em teste', nivel: 'atencao' },
  ATIVA: { texto: 'ativa', nivel: 'bom' },
  INADIMPLENTE: { texto: 'pagamento em aberto', nivel: 'critico' },
  SUSPENSA: { texto: 'suspensa', nivel: 'critico' },
  CANCELADA: { texto: 'cancelada', nivel: 'critico' },
}

const TIPO: Record<string, string> = {
  COMPRA: 'Recarga',
  PLANO: 'Crédito do plano',
  AJUSTE: 'Ajuste',
  ESTORNO: 'Estorno',
}

const diaMes = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d)

/** Plano de contrato: tem conta de tabela, mas o valor é o combinado. */
const deContrato = (a: Assinatura) => !PLANOS[a.plano].aVenda && a.plano !== 'GRATIS'

const data = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d)

export default async function AssinaturaPagina({
  params,
}: {
  params: Promise<{ empresa: string }>
}) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // Assinatura é dinheiro da empresa. Quem opera o caixa não abre esta tela —
  // e o endereço colado no navegador também não passa.
  if (!podeVerPlanos(sessao)) semAcesso(slug, 'cargo')

  const a = await assinaturaDe(sessao)
  const podeMexer = pode(sessao, 'empresa.configurar')
  const [opcoes, extrato] = await Promise.all([
    opcoesDeTroca(sessao),
    podeMexer ? extratoDeCredito(sessao, 20) : Promise.resolve([]),
  ])

  const sit = SITUACAO[a.situacao] ?? { texto: a.situacao, nivel: 'neutro' as const }

  // O pedido feito aqui (subir de plano, pôr crédito) espera a equipe do
  // Norte. Sem esta linha, a loja clicava, lia "pedido registrado" uma vez e
  // depois não tinha como saber se alguém viu — nem por que foi recusado.
  const pedidos = pedidosParaTela(await eventosDePedido(sessao.orgId))

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/assinatura`}
      tema={tema}
      titulo="Assinatura"
      acao={<Situacao nivel={sit.nivel}>{sit.texto}</Situacao>}
    >
      {/* Os avisos vêm antes de tudo, e o crítico pulsa: crédito acabado
          significa assistente parado agora, e teste acabando significa acesso
          parado depois de amanhã. */}
      {a.alertas.map((al) => (
        <Aviso key={al.texto} nivel={al.nivel} pulsa={al.nivel === 'critico'}>
          {al.texto}
        </Aviso>
      ))}

      {a.situacao === 'TESTE' && a.testeAte && <QuadroDoTeste a={a} />}

      <Secao titulo="O que você tem">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {/* Duas colunas para o plano: "Norte + Assistente" e "Norte sob
              contrato" não cabem numa ficha de um quarto — o número encolhe
              até onde dá e depois corta. */}
          <div className="grid sm:col-span-2">
            <Numero
              principal
              rotulo="Plano"
              valor={a.titulo}
              detalhe={
                a.situacao === 'TESTE' && a.testeAte
                  ? `em teste até ${diaMes(a.testeAte)}`
                  : deContrato(a) || a.mensal.total === null
                    ? 'valor combinado em contrato'
                    : a.mensal.total === 0
                      ? 'sem mensalidade'
                      : `${brl(a.mensal.total)} por mês`
              }
            />
          </div>
          {/* Lojas de VENDA: o depósito não entra na conta (menos no Grátis,
              que é de uma unidade só, seja ela qual for). */}
          <Numero
            rotulo="Lojas"
            valor={
              a.limite.unidades !== null && a.mensal.porExtra === null
                ? `${a.uso.unidades} de ${a.limite.unidades}`
                : String(a.uso.unidades)
            }
            detalhe={
              a.mensal.porExtra === null
                ? a.limite.unidades === null
                  ? 'sem limite'
                  : 'é o que o plano comporta'
                : a.mensal.extras > 0
                  ? `${a.limite.unidades} incluída · ${a.mensal.extras} a mais`
                  : 'depósito não entra na conta'
            }
            nivel={
              a.limite.unidades !== null && a.mensal.porExtra === null && a.uso.unidades >= a.limite.unidades
                ? 'atencao'
                : undefined
            }
          />
          {/* Cadastrar gente é de graça em todo plano. Quanto fica dentro ao
              mesmo tempo só tem limite no Grátis — nos pagos, à vontade. */}
          <Numero
            rotulo="Pessoas cadastradas"
            valor={String(a.uso.usuarios)}
            detalhe="cadastrar não tem custo"
          />
          <Numero
            rotulo="Dentro ao mesmo tempo"
            valor={a.limite.vagas === null ? 'Sem limite' : `Até ${a.limite.vagas}`}
            detalhe={a.limite.vagas === null ? 'a equipe toda, à vontade' : `é o que o ${a.titulo} limita`}
          />
          <Numero
            rotulo="Crédito de IA"
            valor={brl(a.credito.saldoCent / 100)}
            detalhe={
              a.credito.diasQueDura !== null
                ? `~${plural(a.credito.diasQueDura, 'dia', 'dias')} no ritmo atual`
                : 'sem consumo ainda'
            }
            nivel={a.credito.acabou ? 'critico' : a.credito.baixo ? 'atencao' : 'bom'}
          />
        </div>
        <ContaDoMes a={a} />
      </Secao>

      <Secao titulo="Crédito do assistente">
        {pedidos.credito && <AvisoDoPedido pedido={pedidos.credito} />}
        <Cartao>
          <Credito
            slug={slug}
            saldoCent={a.credito.saldoCent}
            gasto30Cent={a.credito.gasto30Cent}
            diasQueDura={a.credito.diasQueDura}
            inclusoMensal={a.credito.inclusoMensal}
            podeMexer={podeMexer}
          />
        </Cartao>

        {podeMexer && (
          <Cartao titulo="Movimento do crédito">
            {extrato.length === 0 ? (
              <Vazio>Nenhuma recarga ainda.</Vazio>
            ) : (
              <ul className="flex flex-col">
                {extrato.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-3 border-b border-borda-suave py-2 last:border-0"
                  >
                    <span className="flex min-w-0 flex-col">
                      {/* Quebra no celular em vez de cortar: "Recarga — Recarga
                          pel…" não diz qual foi. Do `sm` para cima cabe. */}
                      <span className="text-sm text-tinta sm:truncate">
                        {TIPO[m.tipo] ?? m.tipo}
                        {m.motivo ? ` — ${m.motivo}` : ''}
                      </span>
                      <span className="text-xs text-tinta-3">
                        {/* A origem ("plano", "manual") é etiqueta de máquina:
                            aparecia como "· plano" no fim da linha. O tipo e o
                            motivo, acima, já dizem de onde veio. */}
                        {data(m.criadoEm)} · {m.quem}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-baseline gap-3">
                      <span
                        className={
                          m.centavos >= 0
                            ? 'numero text-sm font-semibold text-bom'
                            : 'numero text-sm font-semibold text-critico'
                        }
                      >
                        {m.centavos > 0 ? '+' : ''}
                        {brl(m.centavos / 100)}
                      </span>
                      <span className="numero w-20 text-right text-xs text-tinta-3 sm:w-24" title="Saldo depois deste movimento">
                        {brl(m.saldoDepois / 100)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        )}
      </Secao>

      <Secao titulo="Mudar de plano">
        {pedidos.plano && <AvisoDoPedido pedido={pedidos.plano} />}
        <Planos
          slug={slug}
          atual={a.plano}
          situacao={a.situacao}
          lojas={a.uso.unidades}
          opcoes={opcoes}
          podeTrocar={podeMexer}
          // O número é nosso, não da empresa cliente, e vem do ambiente: número
          // escrito no código é número que ninguém lembra de trocar.
          whatsapp={process.env.NORTE_WHATSAPP ?? null}
        />

        {/* Cartão vende, tabela decide. Quem está quase trocando quer a
            pergunta específica respondida, e procurar isso nos cartões é
            onde a pessoa desiste e vai perguntar no WhatsApp. */}
        <Cartao titulo="Item por item">
          <Comparar atual={a.plano} />
        </Cartao>
      </Secao>
    </Estrutura>
  )
}

// No fuso da loja, e não no do servidor: na hospedagem o relógio é UTC, e
// "enviado às 17:40" de um pedido feito às 14:40 faz a loja achar que o
// sistema está errado.
const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  }).format(d)

/** "Pedido do plano X enviado em …, aguardando confirmação" / "… recusado: motivo". */
function AvisoDoPedido({ pedido }: { pedido: Pedido }) {
  const oQue = pedido.tipo === 'plano' ? `do ${pedido.oQue}` : `de ${pedido.oQue}`
  if (pedido.estado === 'recusado') {
    return (
      <Aviso nivel="neutro">
        O pedido {oQue}, de {quando(pedido.criadoEm)}, foi recusado
        {pedido.motivoRecusa ? `: ${pedido.motivoRecusa}` : '.'}
      </Aviso>
    )
  }
  return (
    <Aviso nivel="atencao">
      Pedido {oQue} enviado em {quando(pedido.criadoEm)}, aguardando confirmação da equipe do Norte.
    </Aviso>
  )
}

/**
 * O teste: quantos dias faltam e o que acontece depois.
 *
 * As duas respostas juntas, no alto, porque são as duas perguntas de quem
 * está testando — e a segunda é a que mais assusta. "Acabou o teste, perco
 * tudo?" Não: os dados ficam, o básico continua, e o resto volta ao assinar.
 */
function QuadroDoTeste({ a }: { a: Assinatura }) {
  const dias = Math.max(0, a.diasDeTeste ?? 0)
  const g = PLANOS.GRATIS
  return (
    <Cartao caixa titulo="Teste com tudo">
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-tinta-2">
        <p>
          <b className="text-tinta">{dias === 0 ? 'O teste acaba hoje' : `Faltam ${plural(dias, 'dia', 'dias')}`}</b>{' '}
          — vai até {diaMes(a.testeAte!)}. Você está usando o {a.titulo}: tudo da loja e o assistente,
          com {brl(PRECOS.creditoDoTeste)} de crédito de IA para conhecer.
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>
            <b className="text-tinta">Assinando,</b> nada muda: o que foi lançado continua, e o crédito
            de IA passa a ser o do plano. Escolha em &ldquo;Mudar de plano&rdquo;, mais abaixo.
          </li>
          <li>
            <b className="text-tinta">Sem assinar,</b> a empresa passa para o plano {g.titulo}:{' '}
            {g.unidades === 1 ? 'uma loja' : `${g.unidades} lojas`}, {g.vagas === 1 ? 'uma pessoa por vez' : `${g.vagas} pessoas por vez`}
            {g.tetoVendasMes !== null ? `, até ${g.tetoVendasMes} vendas no mês` : ''} e sem o assistente. Os
            dados ficam todos, e o resto volta no dia em que assinar.
          </li>
        </ul>
      </div>
    </Cartao>
  )
}

/**
 * A conta do mês, aberta: a primeira loja, as lojas a mais, o assistente.
 *
 * As parcelas saem de `PRECOS`, e o total de `mensalidade` — a mesma conta
 * que o servidor usa. Se um dia as duas não fecharem (um plano novo com outra
 * regra), a tela mostra só o total em vez de uma soma que não bate.
 */
function ContaDoMes({ a }: { a: Assinatura }) {
  const p: Limite = PLANOS[a.plano]
  const { total, extras, porExtra, fabricas, porFabrica, farol, farolMarcas } = a.mensal

  // Corporativo: não há conta de tabela para mostrar.
  if (total === null) {
    return (
      <Cartao titulo="A conta do mês">
        <p className="text-sm text-tinta-2">Preço fechado em contrato, depois de olhar a operação.</p>
      </Cartao>
    )
  }

  // Grátis: não há o que somar. O útil é dizer quanto daria assinar.
  if (total === 0) {
    const lojas = Math.max(1, a.uso.unidades)
    return (
      <Cartao titulo="A conta do mês">
        <p className="text-sm leading-relaxed text-tinta-2">
          O {a.titulo} não tem mensalidade. Com {lojas === 1 ? 'uma loja' : `${lojas} lojas`}, o{' '}
          {PLANOS.BALCAO.titulo} sai por{' '}
          <b className="numero text-tinta">{brl(mensalidade('BALCAO', lojas).total ?? 0)}</b> e o{' '}
          {PLANOS.BALCAO_AGENTE.titulo} por{' '}
          <b className="numero text-tinta">{brl(mensalidade('BALCAO_AGENTE', lojas).total ?? 0)}</b> por mês.
        </p>
      </Cartao>
    )
  }

  const comAssistente = p.modulos.includes('agente')
  const linhas: [string, number][] = [['Primeira loja', PRECOS.primeiraLoja]]
  if (extras > 0 && porExtra !== null) {
    linhas.push([`${extras === 1 ? '1 loja a mais' : `${extras} lojas a mais`} × ${brl(porExtra)}`, extras * porExtra])
  }
  if (fabricas > 0 && porFabrica !== null) {
    linhas.push([`${fabricas === 1 ? 'Fábrica' : `${fabricas} fábricas`} × ${brl(porFabrica)}`, fabricas * porFabrica])
  }
  if (comAssistente) linhas.push(['Assistente, com o crédito de IA do mês', PRECOS.assistente])
  // O Farol é contratado à parte, por marca: sem esta linha a conta "não
  // fechava" e a tela escondia todas as parcelas, mostrando só o total.
  if (farol > 0) {
    linhas.push([`Farol, ${farolMarcas === 1 ? '1 marca' : `${farolMarcas} marcas`}`, farol])
  }
  const fecha = linhas.reduce((soma, [, v]) => soma + v, 0) === total

  return (
    <Cartao titulo="A conta do mês">
      <dl className="flex max-w-md flex-col text-sm">
        {fecha &&
          linhas.map(([rotulo, valor]) => (
            <div key={rotulo} className="flex items-baseline justify-between gap-4 border-b border-borda-suave py-1.5">
              <dt className="text-tinta-2">{rotulo}</dt>
              <dd className="numero text-tinta">{brl(valor)}</dd>
            </div>
          ))}
        <div className="flex items-baseline justify-between gap-4 py-1.5">
          <dt className="font-semibold text-tinta">{deContrato(a) ? 'Pela tabela, por mês' : 'Por mês'}</dt>
          <dd className="numero font-bold text-tinta">{brl(total)}</dd>
        </div>
      </dl>
      <p className="mt-1 text-xs leading-relaxed text-tinta-3">
        {deContrato(a)
          ? 'É a conta da tabela, para referência: o que você paga é o valor combinado em contrato.'
          : a.situacao === 'TESTE'
            ? 'É o que passa a valer quando o teste virar assinatura. Durante o teste, nada é cobrado.'
            : 'Cada loja a mais soma ao mês, e a tela de Lojas diz o valor antes de abrir. Depósito não entra na conta.'}
      </p>
    </Cartao>
  )
}
