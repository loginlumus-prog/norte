import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { ehSuporteDoNorte, pode, podeVerPlanos } from '@/servidor/permissao'
import { assinaturaDe } from '@/servidor/assinatura'
import { eventosDePedido, pedidosParaTela, type Pedido } from '@/servidor/pedidos'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Aviso, Situacao } from '@/ui/base'
import { Numero, Secao, brl } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Planos } from './Planos'
import { Respostas } from './Respostas'
import { Comparar } from './Comparar'
import { plural } from '@/ui/texto'
import { PLANOS, PRECOS, milhar, mudanca } from '@/servidor/planos'
import type { Assinatura } from '@/servidor/assinatura'

export const metadata: Metadata = { title: 'Assinatura' }

// A tela da assinatura.
//
// Ela responde três perguntas, nesta ordem, porque é a ordem em que elas
// aparecem na cabeça de quem abre:
//
//   1. quanto eu pago por mês, e por quê? (a conta, linha por linha)
//   2. quantas respostas do assistente ainda tenho este mês?
//   3. e se eu quiser mudar? (ligar ou desligar o assistente, assinar)
//
// ── a conta, linha por linha ─────────────────────────────────
// Desde a tabela de 02/10/2026 a mensalidade é uma soma: a primeira loja,
// cada loja a mais, e as chaves da empresa (o assistente, a fábrica, o Farol).
// A tela mostra a soma aberta, e não só o total, pela regra de ouro de
// `planos.ts`: o cliente nunca descobre a cobrança na fatura. Quem abre a
// terceira loja e vê o total subir precisa ver, na mesma tela, de onde veio.
//
// A carteira de IA em reais saiu daqui: ela virou trava nossa de custo, e o
// que a loja lê é resposta (ver planos.ts).

const SITUACAO: Record<string, { texto: string; nivel: 'bom' | 'atencao' | 'critico' | 'neutro' }> = {
  TESTE: { texto: 'em teste', nivel: 'atencao' },
  ATIVA: { texto: 'ativa', nivel: 'bom' },
  INADIMPLENTE: { texto: 'pagamento em aberto', nivel: 'critico' },
  SUSPENSA: { texto: 'suspensa', nivel: 'critico' },
  CANCELADA: { texto: 'cancelada', nivel: 'critico' },
}

const diaMes = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d)

/** Plano de contrato: tem conta de tabela, mas o valor é o combinado. */
const deContrato = (a: Assinatura) => !PLANOS[a.plano].aVenda && a.plano !== 'GRATIS'

/** O nome que a loja lê: o plano é um só, o assistente é uma chave dele. */
const nomeDoPlano = (a: Assinatura) =>
  a.plano === 'BALCAO' || a.plano === 'BALCAO_AGENTE' ? PLANOS.BALCAO.titulo : a.titulo

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
  // O suporte do Norte, mesmo no modo edição, só olha a Assinatura.
  const podeMexer = pode(sessao, 'empresa.configurar') && !ehSuporteDoNorte(sessao)
  const comAssistente = PLANOS[a.plano].modulos.includes('agente')

  const sit = SITUACAO[a.situacao] ?? { texto: a.situacao, nivel: 'neutro' as const }

  // O pedido feito aqui (assinar, ligar o assistente, um pacote) espera a
  // equipe do Norte. Sem esta linha, a loja clicava, lia "pedido registrado"
  // uma vez e depois não tinha como saber se alguém viu — nem por que foi
  // recusado.
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
      {/* Os avisos vêm antes de tudo, e o crítico pulsa: respostas acabadas
          significam assistente parado agora, e teste acabando significa
          acesso parado depois de amanhã. */}
      {a.alertas.map((al) => (
        <Aviso key={al.texto} nivel={al.nivel} pulsa={al.nivel === 'critico'}>
          {al.texto}
        </Aviso>
      ))}

      {a.situacao === 'TESTE' && a.testeAte && <QuadroDoTeste a={a} />}

      <Secao titulo="O que você tem">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            principal
            rotulo="Plano"
            valor={nomeDoPlano(a)}
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
          {/* Lojas de VENDA: o depósito não entra na conta (menos no Grátis,
              que é de uma unidade só, seja ela qual for). */}
          <Numero
            rotulo="Lojas"
            valor={
              a.limite.unidades !== null && a.mensal.porExtra === null
                ? `${a.uso.unidades} de ${a.limite.unidades}`
                : String(a.uso.unidades)
            }
            detalhe={a.mensal.porExtra === null ? 'é o que o plano comporta' : 'depósito não entra na conta'}
            nivel={
              a.limite.unidades !== null && a.mensal.porExtra === null && a.uso.unidades >= a.limite.unidades
                ? 'atencao'
                : undefined
            }
          />
          {/* Cadastrar gente é de graça em todo plano. Quanto fica dentro ao
              mesmo tempo só tem limite no Grátis. */}
          <Numero
            rotulo="Equipe"
            valor={plural(a.uso.usuarios, 'pessoa', 'pessoas')}
            detalhe={a.limite.vagas === null ? 'sem limite, sem custo' : `até ${a.limite.vagas} dentro por vez`}
          />
          <Numero
            rotulo="Assistente"
            valor={
              !comAssistente
                ? 'Desligado'
                : a.respostas.restam === null
                  ? 'No contrato'
                  : `${milhar(a.respostas.restam)} respostas`
            }
            detalhe={
              !comAssistente
                ? `ligue por +${brl(PRECOS.assistente)}/mês`
                : a.respostas.restam === null
                  ? `${milhar(a.respostas.usadas)} respostas este mês`
                  : a.respostas.periodo === 'teste'
                    ? 'faltam no teste'
                    : 'faltam este mês'
            }
            nivel={
              !comAssistente ? undefined : a.respostas.acabou || a.credito.travou ? 'critico' : a.respostas.baixo ? 'atencao' : 'bom'
            }
          />
        </div>
        <ContaDoMes a={a} />
      </Secao>

      {comAssistente && (
        <Secao titulo="Respostas do assistente">
          {pedidos.respostas && <AvisoDoPedido pedido={pedidos.respostas} />}
          {pedidos.credito && <AvisoDoPedido pedido={pedidos.credito} />}
          <Cartao>
            <Respostas
              slug={slug}
              total={a.respostas.total}
              usadas={a.respostas.usadas}
              restam={a.respostas.restam}
              pacotes={a.respostas.pacotes}
              periodo={a.respostas.periodo}
              renovaEm={a.respostas.renovaEm?.toISOString() ?? null}
              pacote={{ respostas: PRECOS.pacoteRespostas, preco: PRECOS.pacotePreco }}
              podeComprar={podeMexer && a.situacao !== 'TESTE'}
              pedidoAberto={pedidos.respostas?.estado === 'aberto'}
            />
          </Cartao>
        </Secao>
      )}

      <Secao titulo={a.situacao === 'TESTE' || a.plano === 'GRATIS' ? 'Assinar' : 'Mudar'}>
        {pedidos.plano && <AvisoDoPedido pedido={pedidos.plano} />}
        <Cartao>
          <Planos
            slug={slug}
            atual={a.plano}
            situacao={a.situacao}
            mensalHoje={a.mensal.total}
            semAssistente={mudanca(a.plano, 'BALCAO', a.uso)}
            comAssistente={mudanca(a.plano, 'BALCAO_AGENTE', a.uso)}
            podeTrocar={podeMexer}
            // O número é nosso, não da empresa cliente, e vem do ambiente: número
            // escrito no código é número que ninguém lembra de trocar.
            whatsapp={process.env.NORTE_WHATSAPP ?? null}
          />
        </Cartao>

        {/* Recolhida: é consulta, não notícia. Quem quer saber "o crediário
            vem no Norte?" abre; quem não quer não rola trinta linhas. */}
        <details className="group rounded-norte border border-borda bg-superficie">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-tinta [&::-webkit-details-marker]:hidden">
            O que vem no {PLANOS.BALCAO.titulo}, item por item
            <span aria-hidden className="ml-2 text-tinta-3 group-open:hidden">+</span>
          </summary>
          <div className="border-t border-borda-suave px-1 pb-3">
            <Comparar atual={a.plano} />
          </div>
        </details>
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
  const oQue = pedido.tipo === 'credito' ? `de ${pedido.oQue}` : `do ${pedido.oQue}`
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
          — vai até {diaMes(a.testeAte!)}. Está tudo ligado: a loja inteira e o assistente, com{' '}
          {milhar(PRECOS.respostasDoTeste)} respostas para conhecer.
        </p>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          <li>
            <b className="text-tinta">Assinando,</b> nada muda: o que foi lançado continua, e com o assistente
            ligado o mês passa a ter {milhar(PRECOS.respostasDoAssistente)} respostas. Escolha em &ldquo;Assinar&rdquo;,
            mais abaixo.
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
 * A conta do mês, aberta: a primeira loja, as lojas a mais, o assistente, a
 * fábrica e o Farol.
 *
 * As parcelas saem de `mensalidade` — a mesma conta que o servidor usa. Se um
 * dia elas não fecharem com o total (um plano novo com outra regra), a tela
 * mostra só o total em vez de uma soma que não bate.
 */
function ContaDoMes({ a }: { a: Assinatura }) {
  const { total, extras, porExtra, assistente, fabricas, fabrica, farol, farolMarcas } = a.mensal

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
    const sem = mudanca(a.plano, 'BALCAO', a.uso).novoMensal ?? 0
    const com = mudanca(a.plano, 'BALCAO_AGENTE', a.uso).novoMensal ?? 0
    return (
      <Cartao titulo="A conta do mês">
        <p className="text-sm leading-relaxed text-tinta-2">
          O {a.titulo} não tem mensalidade. Com as suas lojas, o {PLANOS.BALCAO.titulo} sai por{' '}
          <b className="numero text-tinta">{brl(sem)}</b> por mês, ou{' '}
          <b className="numero text-tinta">{brl(com)}</b> com o assistente.
        </p>
      </Cartao>
    )
  }

  const linhas: [string, string | null, number][] = [['Primeira loja', null, PRECOS.primeiraLoja]]
  if (extras > 0 && porExtra !== null) {
    linhas.push([extras === 1 ? '1 loja a mais' : `${extras} lojas a mais`, `× ${brl(porExtra)}`, extras * porExtra])
  }
  if (assistente > 0) {
    linhas.push(['Assistente', `${milhar(PRECOS.respostasDoAssistente)} respostas/mês`, assistente])
  }
  if (fabrica > 0) {
    linhas.push(['Fábrica', fabricas === 1 ? '1 unidade' : `${fabricas} unidades, uma parcela só`, fabrica])
  }
  // O Farol é contratado à parte, por marca: sem esta linha a conta "não
  // fechava" e a tela escondia todas as parcelas, mostrando só o total.
  if (farol > 0) {
    linhas.push(['Farol', farolMarcas === 1 ? '1 marca' : `${farolMarcas} marcas`, farol])
  }
  const fecha = linhas.reduce((soma, [, , v]) => soma + v, 0) === total
  const pacotes = a.respostas.pacotes

  return (
    <Cartao titulo="A conta do mês">
      <dl className="flex max-w-md flex-col text-sm">
        {fecha &&
          linhas.map(([rotulo, detalhe, valor]) => (
            <div key={rotulo} className="flex items-baseline gap-3 border-b border-borda-suave py-1.5">
              <dt className="min-w-0 flex-1 text-tinta-2">
                {rotulo}
                {detalhe && <span className="numero ml-1.5 text-xs text-tinta-3">{detalhe}</span>}
              </dt>
              <dd className="numero text-right text-tinta tabular-nums">{brl(valor)}</dd>
            </div>
          ))}
        <div className="flex items-baseline gap-3 py-1.5">
          <dt className="flex-1 font-semibold text-tinta">{deContrato(a) ? 'Pela tabela, por mês' : 'Por mês'}</dt>
          <dd className="numero text-right font-bold text-tinta tabular-nums">{brl(total)}</dd>
        </div>
        {pacotes > 0 && (
          <div className="flex items-baseline gap-3 border-t border-borda-suave py-1.5 text-xs text-tinta-3">
            <dt className="flex-1">
              Avulso este mês: {pacotes === 1 ? '1 pacote' : `${pacotes} pacotes`} de +{milhar(PRECOS.pacoteRespostas)} respostas
            </dt>
            <dd className="numero text-right tabular-nums">{brl(pacotes * PRECOS.pacotePreco)}</dd>
          </div>
        )}
      </dl>
      <p className="mt-1 text-xs leading-relaxed text-tinta-3">
        {deContrato(a)
          ? 'Pela tabela, só para referência: vale o valor do contrato.'
          : a.situacao === 'TESTE'
            ? 'É o que passa a valer quando o teste virar assinatura. Durante o teste, nada é cobrado.'
            : 'Cada loja a mais soma ao mês. Depósito não entra na conta.'}
      </p>
    </Cartao>
  )
}
