import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import Link from 'next/link'
import { acharAgente, apurarRecibos, balanco, podeGastarHoje } from '@/servidor/agente'
import { PODERES_SUGERIDOS } from '@/servidor/poderes'
import { comoOrg } from '@/servidor/banco'
import { pode, podeVerPlanos } from '@/servidor/permissao'
import { reais } from '@/servidor/dinheiro'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Aviso, Vazio } from '@/ui/base'
import { Numero, Secao, brl } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Formulario, type AgenteNaTela } from './Formulario'
import { Propostas } from './Propostas'
import { Conexao } from './Conexao'
import { Rotinas } from './Rotinas'
import { Conversas } from './Conversas'
import {
  estadoDaConexao,
  gatilhosDaTela,
  conversasRecentes,
  ROTINAS_NA_TELA,
} from '@/servidor/assistente/conexao'
import { plural } from '@/ui/texto'
import { moduloLigado } from '@/servidor/modulos'
import { ORDEM, doPlano, planoLibera } from '@/servidor/planos'
import { diaEmSP, inicioDoDiaEmSP, primeiroDoMes, somarDias } from '@/servidor/dia'

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
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'agente.configurar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // ── o assistente existe nesta empresa? ──
  // Duas chaves, e as duas precisam estar ligadas: o PLANO tem de incluir o
  // assistente, e a empresa tem de ter ligado o módulo. Antes a tela abria
  // inteira com as duas desligadas — dava para configurar, ver "esperando
  // você" e ligar a chave do formulário, e nada disso funcionava, porque a
  // rotina e o WhatsApp conferem as duas (ver `empresaApta`).
  const { plano } = await comoOrg(sessao.orgId, (db) =>
    db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { plano: true } }),
  )
  if (!planoLibera(plano, 'agente') || !moduloLigado(empresa, 'agente')) {
    const doPlanoDela = planoLibera(plano, 'agente')
    const quemAbre = ORDEM.find((p) => planoLibera(p, 'agente'))
    return (
      <Estrutura
        empresa={empresa}
        sessao={sessao}
        itens={MENU(slug)}
        ativo={`/${slug}/agente`}
        tema={tema}
        titulo="Assistente"
      >
        <Cartao titulo={doPlanoDela ? 'O assistente está desligado' : 'O assistente não faz parte do seu plano'}>
          <div className="flex flex-col gap-3 text-sm text-tinta-2">
            <p>
              O assistente responde pelo WhatsApp, manda o relatório do dia e avisa o que vai
              faltar — com a proposta de reposição para você confirmar.
            </p>
            {doPlanoDela ? (
              <p>
                Seu plano inclui o assistente, mas ele não está ligado nesta empresa. Para ligar:{' '}
                {pode(sessao, 'empresa.configurar') ? (
                  <Link href={`/${slug}/configuracoes`} className="font-medium text-marca underline-offset-2 hover:underline">
                    Configurações › O que sua empresa usa
                  </Link>
                ) : (
                  <b className="text-tinta">Configurações › O que sua empresa usa</b>
                )}
                , marque &quot;Agente no WhatsApp&quot; e salve.
              </p>
            ) : (
              <p>
                Ele existe {quemAbre ? `${doPlano(quemAbre)} para cima` : 'em planos acima do seu'}.{' '}
                {podeVerPlanos(sessao) ? (
                  <Link href={`/${slug}/assinatura`} className="font-medium text-marca underline-offset-2 hover:underline">
                    Ver os planos em Assinatura
                  </Link>
                ) : (
                  'Quem responde pela empresa troca de plano em Assinatura.'
                )}
              </p>
            )}
          </div>
        </Cartao>
      </Estrutura>
    )
  }

  // O mês é o de São Paulo: na virada, às 21h do último dia, o relógio da
  // máquina em UTC já mostrava o balanço do mês seguinte — zerado.
  const agora = new Date()
  const mesSP = primeiroDoMes(diaEmSP(agora))
  const de = inicioDoDiaEmSP(mesSP)
  const ate = new Date(inicioDoDiaEmSP(primeiroDoMes(somarDias(mesSP, 32))).getTime() - 1)

  // Os recibos que já dá para medir nascem antes do balanço ser lido — a
  // conta está em `apurarRecibos`, e ela é idempotente. Falha aqui não tira a
  // tela do ar: o recibo espera a próxima visita ou a rotina das 9h.
  try {
    await apurarRecibos(sessao.orgId, agora)
  } catch (e) {
    console.error('[agente] apurar recibos:', e instanceof Error ? e.message : e)
  }

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

  // A conexão com o mundo. Em série, e fora do Promise.all de cima: cada uma
  // abre a sua transação, e três de uma vez disputariam o pool pequeno do
  // plano grátis sem ganhar nada visível.
  const conexao = await estadoDaConexao(sessao)
  const gatilhos = agente ? await gatilhosDaTela(sessao) : []
  const conversas = agente ? await conversasRecentes(sessao) : []
  const saldo = bal.trouxe - bal.custou

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menu}
      ativo={`/${slug}/agente`}
      tema={tema}
      titulo={agente ? `Assistente · ${agente.nome}` : 'Assistente'}
    >
      {!agente && (
        <Aviso nivel="neutro">
          Você ainda não criou o assistente da sua loja. Dê um nome a ele, diga o que ele
          pode fazer e até onde vai — nada começa a funcionar antes disso.
        </Aviso>
      )}

      {agente && (
        <Secao titulo="O que o assistente fez este mês">
          {/* "Trouxe de volta" só aparece quando trouxe alguma coisa. Com ele
              em zero, a tela dizia todo mês "saldo contra" — que é a conta
              certa de um recibo que ainda não é emitido, e a leitura errada
              do que o assistente faz. Aí o que importa é o crédito. */}
          {bal.trouxe <= 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Numero
                rotulo="Custou de IA"
                valor={brl(bal.custou)}
                detalhe="neste mês, do seu crédito"
              />
              <Numero
                rotulo="Crédito disponível"
                valor={brl(reais(gasto.saldoCent))}
                detalhe="recarga e extrato em Assinatura"
                nivel={gasto.saldoCent <= 0 ? 'critico' : undefined}
              />
            </div>
          ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <Numero
              rotulo="Trouxe de volta"
              valor={brl(bal.trouxe)}
              detalhe={bal.porTipo.length === 0 ? 'ainda nada' : plural(bal.porTipo.length, 'tipo', 'tipos')}
              nivel={bal.trouxe > 0 ? 'bom' : undefined}
            />
            <Numero
              rotulo="Custou de IA"
              valor={brl(bal.custou)}
              detalhe="só o que o assistente consumiu"
            />
            <Numero
              rotulo="Saldo"
              valor={brl(saldo)}
              detalhe={saldo >= 0 ? 'a favor' : 'contra'}
              nivel={saldo > 0 ? 'bom' : saldo < 0 ? 'atencao' : undefined}
            />
          </div>
          )}

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
              Hoje o assistente gastou <b className="numero text-tinta">{brl(reais(gasto.gastoCent))}</b> de
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

      {/* A conexão vem antes do formulário: "ele está funcionando?" é a
          pergunta de quem abre a tela, e a resposta cabe numa frase. */}
      <Secao titulo="No WhatsApp">
        <Conexao slug={slug} estado={conexao} />
        {agente && <Rotinas slug={slug} rotinas={ROTINAS_NA_TELA} itens={gatilhos} />}
        {agente && <Conversas itens={conversas} nome={agente.nome} />}
      </Secao>

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
  RUPTURA_EVITADA: 'Margem do que a reposição proposta vendeu',
  DIVERGENCIA_ACHADA: 'Diferença de caixa que ninguém tinha visto',
}