import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { acharAgente, balanco, podeGastarHoje } from '@/servidor/agente'
import { PODERES_SUGERIDOS } from '@/servidor/poderes'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
import { reais } from '@/servidor/dinheiro'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Aviso, Vazio } from '@/ui/base'
import { Numero, Secao, brl } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Formulario, type AgenteNaTela } from './Formulario'
import { Propostas } from './Propostas'

// O agente, numa tela só.
//
// Em cima o BALANÇO — o que ele trouxe contra o que ele custou. Fica antes da
// configuração de propósito: quem abre esta tela no segundo mês quer saber se
// vale a pena, não mexer no nome dele. E é esse número que segura a renovação.
//
// Depois as PROPOSTAS esperando. Elas vêm antes do formulário porque são a
// única coisa aqui que tem prazo: proposta parada é decisão que ninguém tomou.

const NOVO: AgenteNaTela = {
  nome: '',
  personalidade: null,
  saudacao: null,
  manual: null,
  poderes: [...PODERES_SUGERIDOS],
  descontoMaxPct: 5,
  valorMax: 500,
  gastoDia: 10,
  mensagensDia: 300,
  ativo: false,
}

export default async function TelaAgente({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const agora = new Date()
  const de = new Date(agora.getFullYear(), agora.getMonth(), 1)
  const ate = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59)

  const [agente, bal, gasto] = await Promise.all([
    acharAgente(sessao.orgId),
    balanco(sessao.orgId, de, ate),
    podeGastarHoje(sessao.orgId),
  ])

  const propostas = agente
    ? await comoOrg(sessao.orgId, (db) =>
        db.propostaAgente.findMany({
          where: { situacao: 'AGUARDANDO', expiraEm: { gt: agora } },
          orderBy: { criadaEm: 'asc' },
          take: 20,
          select: { id: true, poder: true, resumo: true, valor: true, expiraEm: true },
        }),
      )
    : []

  const menu = MENU(slug).map((i) =>
    i.href === `/${slug}/agente` && propostas.length > 0
      ? {
          ...i,
          aviso: { quantos: propostas.length, nivel: 'atencao' as const, titulo: 'esperando você' },
        }
      : i,
  )

  const naTela: AgenteNaTela = agente
    ? {
        nome: agente.nome,
        personalidade: agente.personalidade,
        saudacao: agente.saudacao,
        manual: agente.manual,
        poderes: agente.poderes,
        descontoMaxPct: Number(agente.descontoMaxPct),
        valorMax: reais(agente.valorMaxCent),
        gastoDia: reais(agente.gastoDiaCent),
        mensagensDia: agente.mensagensDia,
        ativo: agente.ativo,
      }
    : NOVO

  const podeConfigurar = pode(sessao, 'agente.configurar')
  const saldo = bal.trouxe - bal.custou

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menu}
      ativo={`/${slug}/agente`}
      tema={tema}
      titulo={agente ? agente.nome : 'Assistente'}
    >
      {!agente && (
        <Aviso nivel="neutro">
          Você ainda não criou o assistente da sua loja. Dê um nome a ele, diga o que ele
          pode fazer e até onde vai — nada começa a funcionar antes disso.
        </Aviso>
      )}

      {agente && (
        <Secao titulo="O que ele fez este mês">
          <div className="grid gap-2 sm:grid-cols-3">
            <Numero
              rotulo="Trouxe de volta"
              valor={brl(bal.trouxe)}
              detalhe={bal.porTipo.length === 0 ? 'ainda nada' : `${bal.porTipo.length} tipo(s)`}
              nivel={bal.trouxe > 0 ? 'bom' : undefined}
            />
            <Numero
              rotulo="Custou de IA"
              valor={brl(bal.custou)}
              detalhe="só o que ele consumiu"
            />
            <Numero
              rotulo="Saldo"
              valor={brl(saldo)}
              detalhe={saldo >= 0 ? 'a favor' : 'contra'}
              nivel={saldo > 0 ? 'bom' : saldo < 0 ? 'atencao' : undefined}
            />
          </div>

          {bal.porTipo.length > 0 && (
            <Cartao titulo="De onde veio">
              <ul className="flex flex-col">
                {bal.porTipo.map((t) => (
                  <li
                    key={t.tipo}
                    className="flex items-center justify-between gap-3 border-b border-borda-suave py-2 last:border-0"
                  >
                    <span className="text-sm text-tinta">{ROTULO[t.tipo] ?? t.tipo}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-tinta-3">{t.quantos}×</span>
                      <span className="numero w-24 text-sm font-semibold text-bom">
                        {brl(t.valor)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Cartao>
          )}

          {/* Não é `Tira`: ela conta COISAS, e aqui o número é dinheiro com
              centavo. Contagem e valor no mesmo componente sai errado. */}
          <p className="flex items-center gap-2 text-xs text-tinta-2">
            <span
              aria-hidden
              className={gasto.pode ? 'size-2 rounded-full bg-bom-vivo' : 'size-2 rounded-full bg-critico-vivo'}
            />
            <span>
              Hoje ele gastou <b className="numero text-tinta">{brl(reais(gasto.gastoCent))}</b> de
              IA, de um teto de <b className="numero text-tinta">{brl(reais(gasto.tetoCent))}</b>.
              {!gasto.pode && ' Ele parou de responder até amanhã.'}
            </span>
          </p>
        </Secao>
      )}

      {propostas.length > 0 && (
        <Secao titulo="Esperando você">
          {/* Pulsa: proposta parada e coisa que ESPERA resposta, e ela
              expira em 24h. Some sozinho quando a pessoa responde. */}
          <Aviso nivel="atencao" pulsa>
            {propostas.length} proposta{propostas.length === 1 ? '' : 's'} parada
            {propostas.length === 1 ? '' : 's'}. Elas valem por 24 horas — depois disso o
            estoque e o preço já são outros, e ele precisa propor de novo.
          </Aviso>
          <Propostas
            slug={slug}
            itens={propostas.map((p) => ({
              id: p.id,
              poder: p.poder,
              resumo: p.resumo,
              valor: p.valor != null ? Number(p.valor) : null,
              expiraEm: p.expiraEm.toISOString(),
            }))}
          />
        </Secao>
      )}

      <Secao titulo={agente ? 'Ajustar' : 'Criar o assistente'}>
        {podeConfigurar ? (
          <Formulario slug={slug} agente={naTela} modulos={empresa.modulos} />
        ) : (
          <Vazio>
            Só quem administra a empresa configura o assistente. Peça para o responsável.
          </Vazio>
        )}
      </Secao>

      {agente && !agente.ativo && (
        <Aviso nivel="neutro">
          <b>{agente.nome} está desligado.</b> Ele continua configurado e simplesmente não
          responde nem age. Ligar é a última chave do formulário.
        </Aviso>
      )}
    </Estrutura>
  )
}

const ROTULO: Record<string, string> = {
  COBRANCA_RECUPERADA: 'Crediário atrasado que voltou',
  CLIENTE_VOLTOU: 'Cliente sumido que comprou de novo',
  ESTOQUE_DESTRAVADO: 'Peça encalhada que saiu',
  RUPTURA_EVITADA: 'Reposição feita antes de acabar',
  DIVERGENCIA_ACHADA: 'Diferença de caixa que ninguém tinha visto',
}