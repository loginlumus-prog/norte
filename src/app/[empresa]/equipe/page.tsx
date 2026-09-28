import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { listarEquipe, podeMexerEm, soLeitura } from '@/servidor/equipe'
import { listarConvites } from '@/servidor/convite'
import { comoOrg } from '@/servidor/banco'
import { pode, podeConceder, podeConcederAcesso, podeVerPlanos, unidadesQuePodem, type Papel } from '@/servidor/permissao'
import { planoDaEmpresa } from '@/servidor/relatorios'
import { liberado } from '@/servidor/planos'
import {
  desempenhoDoMes,
  desempenhoPorLoja,
  tendenciaDaEquipe,
  type NotaDaLoja,
  type NotasDoMes,
  type Tendencia,
} from '@/servidor/desempenho'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Secao, Tira, Numero, brl } from '@/ui/painel'
import { Cartao } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { moduloLigado } from '@/servidor/modulos'
import { metasDoMes, mesChave, mesValido, nomeDoMes } from '@/servidor/metas'
import { outroMes } from '@/servidor/fechamento'
import { Equipe, type PessoaNaTela, type ConviteNaTela, type SuporteNaTela } from './Equipe'
import { Metas } from './Metas'
import { Desempenho, SetasDoMes } from './Desempenho'

export const metadata: Metadata = { title: 'Equipe' }

const TODOS_PAPEIS: Papel[] = ['DONO', 'GERENTE', 'BALCAO', 'FINANCEIRO', 'CONTADOR']

const dia = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d)
const diaEHora = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)

export default async function TelaEquipe({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ mes?: string }>
}) {
  const { empresa: slug } = await params
  const { mes: mesPedido } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'equipe.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const podeGerir = pode(sessao, 'equipe.gerir')
  const temMetas = moduloLigado(empresa, 'metas')
  const mes = mesValido(mesPedido) ? mesPedido : mesChave(new Date())
  const metas = temMetas ? await metasDoMes(sessao, mes) : []
  // Conta de calendário, sem instante: `new Date(ano, mes, 1)` é a meia-noite
  // da MÁQUINA, e num servidor em UTC isso já é o mês anterior em São Paulo.
  const mesAnterior = outroMes(mes, -1)
  const mesSeguinte = outroMes(mes, 1)
  const totalMeta = metas.reduce((s, m) => s + m.valor, 0)
  const totalVendido = metas.reduce((s, m) => s + m.liquido, 0)
  const totalComissao = metas.reduce((s, m) => s + m.comissao, 0)

  const [pessoas, convites, unidades] = await Promise.all([
    listarEquipe(sessao),
    podeGerir ? listarConvites(sessao) : Promise.resolve([]),
    comoOrg(sessao.orgId, (db) =>
      db.unidade.findMany({ where: { ativa: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }),
    ),
  ])

  // ── desempenho em estrelas ───────────────────────────────
  // O plano decide quanto está aberto; o que não abre aparece trancado, com
  // amostra (ver ui/Cadeado.tsx). Cada leitura abre o próprio comoOrg, uma
  // depois da outra — nunca uma dentro da outra.
  const plano = await planoDaEmpresa(sessao)
  let notas: NotasDoMes | null = null
  let tendencia: Tendencia | null = null
  let porLoja: NotaDaLoja[] | null = null
  if (liberado(plano, 'desempenho.basico')) {
    // As metas já foram lidas logo acima; não vale ler de novo.
    const opcoes = { metas: temMetas, metasProntas: temMetas ? metas : undefined }
    notas = await desempenhoDoMes(sessao, mes, opcoes)
    if (liberado(plano, 'desempenho.completo')) {
      tendencia = await tendenciaDaEquipe(sessao, mes, 3, opcoes, notas)
      const permitidas = unidadesQuePodem(sessao, 'equipe.ver')
      const lojas = unidades.filter((u) => permitidas === 'todas' || permitidas.includes(u.id))
      if (lojas.length > 1) porLoja = await desempenhoPorLoja(sessao, mes, lojas, opcoes)
    }
  }

  // Só os papéis que ESTA pessoa pode conceder. O gerente contrata balconista;
  // só o dono cria outro dono. Mostrar o que não dá para escolher só ensina
  // a pessoa o que ela está perdendo.
  const papeisQuePosso = TODOS_PAPEIS.filter((p) => podeConceder(sessao, p))

  const agora = new Date()
  const vale = (a: { expiraEm: Date | null }) => !a.expiraEm || a.expiraEm > agora

  // ── o NOSSO suporte, à parte ─────────────────────────────
  // A conta de suporte aparecia no meio da equipe, com os mesmos botões — que
  // o servidor recusava — e entrava na conta de "com acesso" (a Assinatura,
  // que não conta suporte, dizia 3 e a Equipe dizia 4). Agora ela sai da
  // lista da loja e ganha a própria caixa: quem é, até quando e por quê, com
  // o botão que a dona precisa — cortar.
  const suportes: SuporteNaTela[] = pessoas.flatMap((p) => {
    const s = p.acessos.find((a) => a.papel === 'SUPORTE' && vale(a))
    return s && p.ativo ? [{ id: p.id, nome: p.nome, ate: s.expiraEm ? diaEHora(s.expiraEm) : null, motivo: s.motivo }] : []
  })
  const podeCortarSuporte = podeGerir && podeConcederAcesso(sessao, 'DONO', null)
  const euSoLeio = soLeitura(sessao)

  const naTela: PessoaNaTela[] = pessoas
    // Quem só tem (ou só teve) SUPORTE não é da equipe da loja.
    .filter((p) => p.acessos.length === 0 || p.acessos.some((a) => a.papel !== 'SUPORTE'))
    .map((p) => {
      const a = p.acessos.find((x) => x.papel !== 'SUPORTE')
      const souEu = p.id === sessao.usuarioId
      // Os botões só aparecem onde o servidor deixa: o gerente via os da linha
      // da dona e cada clique voltava com "você não pode".
      const podeMexer = podeGerir && !souEu && podeMexerEm(sessao, p.acessos, agora)
      return {
        id: p.id,
        nome: p.nome,
        email: p.email,
        ativo: p.ativo,
        ultimoLogin: p.ultimoLogin ? dia(p.ultimoLogin) : null,
        papel: a?.papel ?? null,
        unidadeId: a?.unidadeId ?? null,
        unidadeNome: a?.unidadeNome ?? null,
        souEu,
        telefone: p.telefone ?? null,
        podeMexer,
        podeTelefone: souEu ? !euSoLeio : podeMexer,
      }
    })

  const convitesNaTela: ConviteNaTela[] = convites.map((c) => ({
    id: c.id,
    email: c.email,
    papel: c.papel,
    expiraEm: dia(c.expiraEm),
    vencido: c.expiraEm < agora,
  }))

  const comAcesso = naTela.filter((p) => p.ativo && p.papel).length
  const esperando = convitesNaTela.filter((c) => !c.vencido).length

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/equipe`}
      tema={tema}
      titulo="Equipe"
    >
      <Tira
        itens={[
          { rotulo: 'com acesso', quantos: comAcesso, nivel: 'bom' },
          { rotulo: 'convites esperando', um: 'convite esperando', quantos: esperando, nivel: 'atencao' },
          { rotulo: 'sem acesso', quantos: naTela.length - comAcesso, nivel: 'neutro' },
          { rotulo: 'acessos do suporte', um: 'acesso do suporte', quantos: suportes.length, nivel: 'atencao' },
        ]}
      />

      {temMetas && (
        <Secao
          titulo={`Metas e comissão · ${nomeDoMes(mes)}`}
          resumo="Quanto cada pessoa vendeu no mês, líquido de devolução, contra a meta dela — e a comissão que isso dá."
          acao={<SetasDoMes slug={slug} anterior={mesAnterior} seguinte={mesSeguinte} />}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <Numero
              principal
              rotulo="Vendido pela equipe"
              valor={brl(totalVendido)}
              detalhe={totalMeta > 0 ? `de ${brl(totalMeta)} de meta · ${Math.round((totalVendido / totalMeta) * 100)}%` : 'sem meta definida'}
            />
            <Numero rotulo="Comissão do mês" valor={brl(totalComissao)} detalhe="a pagar com o salário" nivel={totalComissao > 0 ? 'atencao' : undefined} />
            <Numero
              rotulo="Bateram a meta"
              valor={`${metas.filter((m) => m.progresso !== null && m.progresso >= 1).length} de ${metas.filter((m) => m.progresso !== null).length}`}
              detalhe="pessoas com meta"
            />
          </div>
          <Cartao caixa>
            <Metas slug={slug} mes={mes} metas={metas} podeGerir={podeGerir} />
          </Cartao>
          {totalComissao > 0 && (
            <p className="text-xs text-tinta-3">
              A comissão não vira lançamento sozinha: no fechamento da folha, lance em Financeiro na categoria
              &ldquo;Comissão&rdquo;. Assim o DRE conta uma vez, no mês em que foi paga.
            </p>
          )}
        </Secao>
      )}

      <Secao
        titulo={`Desempenho · ${nomeDoMes(mes)}`}
        resumo="Uma nota de 0 a 5 por pessoa: meta, tarefas no prazo e dias em que entrou no sistema. A conta fica aberta na linha."
        acao={<SetasDoMes slug={slug} anterior={mesAnterior} seguinte={mesSeguinte} />}
      >
        <Desempenho slug={slug} verPlanos={podeVerPlanos(sessao)} plano={plano} pessoas={notas?.pessoas ?? []} tendencia={tendencia} lojas={porLoja} />
      </Secao>

      <Secao titulo="Equipe">
        <Equipe
          slug={slug}
          pessoas={naTela}
          convites={convitesNaTela}
          unidades={unidades}
          papeisQuePosso={papeisQuePosso}
          podeGerir={podeGerir}
          suportes={suportes}
          podeCortarSuporte={podeCortarSuporte}
        />
      </Secao>
    </Estrutura>
  )
}
