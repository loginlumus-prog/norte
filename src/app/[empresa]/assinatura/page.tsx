import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { assinaturaDe, opcoesDeTroca, extratoDeCredito } from '@/servidor/assinatura'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Aviso, Situacao, Vazio } from '@/ui/base'
import { Numero, Secao, Tira, brl } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Planos } from './Planos'
import { Credito } from './Credito'
import { Comparar } from './Comparar'

// A tela da assinatura.
//
// Ela responde três perguntas, nesta ordem, porque é a ordem em que elas
// aparecem na cabeça de quem abre:
//
//   1. o que eu tenho, e estou perto de estourar alguma coisa?
//   2. quanto de crédito de IA me resta, e dura quanto?
//   3. e se eu quiser mudar?
//
// O extrato fica por último e recolhido: ele é prova, não é notícia.

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

const data = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
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
  if (!pode(sessao, 'empresa.configurar') && !pode(sessao, 'financeiro.ver')) notFound()

  const a = await assinaturaDe(sessao)
  const podeMexer = pode(sessao, 'empresa.configurar')
  const [opcoes, extrato] = await Promise.all([
    opcoesDeTroca(sessao),
    podeMexer ? extratoDeCredito(sessao, 20) : Promise.resolve([]),
  ])

  const sit = SITUACAO[a.situacao] ?? { texto: a.situacao, nivel: 'neutro' as const }

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

      <Secao titulo="O que você tem">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            principal
            rotulo="Plano"
            valor={a.titulo}
            detalhe={
              a.mensal.total !== null
                ? `${brl(a.mensal.total)} por mês`
                : 'preço fechado por contrato'
            }
          />
          <Numero
            rotulo="Unidades"
            valor={
              a.limite.unidades === null
                ? String(a.uso.unidades)
                : `${a.uso.unidades} de ${a.limite.unidades}`
            }
            detalhe={
              a.mensal.extras > 0
                ? `${a.mensal.extras} extra(s) · ${brl(a.mensal.extras * (a.mensal.porExtra ?? 0))}`
                : 'dentro da cota'
            }
            nivel={
              a.limite.unidades !== null && a.uso.unidades >= a.limite.unidades
                ? 'atencao'
                : undefined
            }
          />
          {/* Dois números diferentes, e a diferença é o modelo de cobrança
              inteiro: cadastrar gente é de graça, o que se paga é quanta
              gente fica dentro ao mesmo tempo. Mostrar só um dos dois faria a
              conta parecer errada para quem tem doze cadastrados e paga por
              três. */}
          <Numero
            rotulo="Pessoas cadastradas"
            valor={String(a.uso.usuarios)}
            detalhe="cadastrar não tem custo"
          />
          <Numero
            rotulo="Dentro ao mesmo tempo"
            valor={a.limite.vagas === null ? 'Sem limite' : `Até ${a.limite.vagas}`}
            detalhe="é isto que o plano limita"
          />
          <Numero
            rotulo="Crédito de IA"
            valor={brl(a.credito.saldoCent / 100)}
            detalhe={
              a.credito.diasQueDura !== null
                ? `~${a.credito.diasQueDura} dia(s) no ritmo atual`
                : 'sem consumo ainda'
            }
            nivel={a.credito.acabou ? 'critico' : a.credito.baixo ? 'atencao' : 'bom'}
          />
        </div>
      </Secao>

      <Secao titulo="Crédito do assistente">
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
                      <span className="truncate text-sm text-tinta">
                        {TIPO[m.tipo] ?? m.tipo}
                        {m.motivo ? ` — ${m.motivo}` : ''}
                      </span>
                      <span className="text-xs text-tinta-3">
                        {data(m.criadoEm)} · {m.quem}
                        {m.origem !== 'manual' && ` · ${m.origem}`}
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
                      <span className="numero w-24 text-right text-xs text-tinta-3">
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
        <Planos
          slug={slug}
          atual={a.plano}
          opcoes={opcoes}
          podeTrocar={podeMexer}
          whatsapp="5571999990000"
        />

        {/* Cartao vende, tabela decide. Quem esta quase trocando quer a
            pergunta especifica respondida, e procurar isso em quatro cartoes
            de bala e onde a pessoa desiste e vai perguntar no WhatsApp. */}
        <Cartao titulo="Item por item">
          <Comparar atual={a.plano} />
        </Cartao>
      </Secao>
    </Estrutura>
  )
}
