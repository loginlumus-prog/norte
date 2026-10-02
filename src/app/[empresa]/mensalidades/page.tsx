import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { pode, textoDaBusca } from '@/servidor/permissao'
import { moduloLigado } from '@/servidor/modulos'
import { diaEmSP, mostrarDiaDaColuna } from '@/servidor/dia'
import { escolherUnidade } from '@/servidor/unidade'
import { mostrarTelefone } from '@/servidor/cliente'
import { mesSeguinte, mesValido } from '@/servidor/recorrentes'
import { listarTurmas } from '@/servidor/escola'
import {
  garantirMensalidades,
  listarMensalidades,
  mesAnterior,
  mesPorExtenso,
  regraDaEmpresa,
  resumoMensalidades,
  ROTULO_SITUACAO,
  type MensalidadeNaLista,
  type SituacaoMensalidade,
} from '@/servidor/mensalidades'
import { podeExportar } from '@/servidor/exportacao'
import { vocabularioDaEmpresa } from '@/servidor/vocabulario'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Tabela } from '@/ui/Tabela'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Numero, Secao, Tira, brl } from '@/ui/painel'
import { Situacao, cx } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { Dispensar, Receber } from './Receber'

export const metadata: Metadata = { title: 'Mensalidades' }

// As mensalidades: o mês, quem pagou, quem deve — e receber.
//
// A tela abre no MÊS DE HOJE, com a pergunta de quem abre: "quanto falta
// entrar este mês, e quem está atrasado?". O atraso não tem mês — o filtro
// "em atraso" junta tudo que venceu e não foi pago, de qualquer mês, porque é
// a lista de quem cobrar.
//
// Abrir a tela é o calendário virando a folha: a mensalidade deste mês e a do
// próximo nascem aqui, se faltarem (mensalidades.ts). Nascem uma vez só.

const NIVEL: Record<SituacaoMensalidade, 'bom' | 'atencao' | 'critico' | 'neutro'> = {
  paga: 'bom',
  atrasada: 'critico',
  vence_hoje: 'atencao',
  a_receber: 'neutro',
  cancelada: 'neutro',
}

const SITUACOES = ['atrasada', 'a_receber', 'paga', 'cancelada'] as const

export default async function Mensalidades({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; mes?: string; situacao?: string; turma?: string; q?: string }>
}) {
  const { empresa: slug } = await params
  const p = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'mensalidade.ver' })
  if (!moduloLigado(empresa, 'escola')) semAcesso(slug, 'modulo-escola')
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const agora = new Date()

  await garantirMensalidades(sessao, agora)

  const hoje = diaEmSP(agora)
  const mesDeHoje = hoje.slice(0, 7)
  const limite = mesSeguinte(mesDeHoje)
  const mes = mesValido(p.mes) && p.mes <= limite ? p.mes : mesDeHoje
  const situacao = SITUACOES.find((s) => s === p.situacao) ?? null
  const q = textoDaBusca(p.q)
  const turmaId = p.turma && /^[\w-]{1,64}$/.test(p.turma) ? p.turma : null

  const onde = await escolherUnidade(sessao, empresa, p.unidade, 'mensalidade.ver')
  const [lista, resumo, regra, voc] = await Promise.all([
    listarMensalidades(sessao, { unidadeIds: onde.ids, mes, situacao, turmaId, q }, agora),
    resumoMensalidades(sessao, onde.ids, mes, agora),
    regraDaEmpresa(sessao),
    vocabularioDaEmpresa(sessao.orgId),
  ])
  // As turmas para o filtro vêm do resumo do mês: quem não vê turma (o
  // contador) filtra do mesmo jeito.
  const turmas = pode(sessao, 'escola.ver')
    ? (await listarTurmas(sessao, { unidadeIds: onde.ids, todas: true })).map((t) => ({ id: t.id, nome: t.nome }))
    : resumo.porTurma.map((t) => ({ id: t.turmaId, nome: t.turma }))
  const turmaNome = turmaId ? (turmas.find((t) => t.id === turmaId)?.nome ?? resumo.porTurma.find((t) => t.turmaId === turmaId)?.turma) : null

  const atuais = { unidade: onde.unidadeId, mes: p.mes && mes !== mesDeHoje ? mes : null, situacao, turma: turmaId, q: q || null }
  const link = (m: Record<string, string | null>) => enderecoCom(`/${slug}/mensalidades`, atuais, m)
  const exportar = enderecoCom(`/${slug}/mensalidades/exportar`, { ...atuais, mes })
  const podeBaixar = podeExportar(sessao, 'mensalidades')

  const titulo = situacao === 'atrasada' ? 'Em atraso, de todos os meses' : mesPorExtenso(mes)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/mensalidades`}
      tema={tema}
      titulo="Mensalidades"
      acao={
        <span className="flex flex-wrap items-center gap-2">
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
          {podeBaixar && (
            <a
              href={exportar}
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
              title="Baixar as mensalidades do filtro em planilha"
            >
              Baixar planilha
            </a>
          )}
        </span>
      }
    >
      <Secao titulo={`${titulo} · ${onde.titulo}`}>
        <div className="flex items-center gap-1.5 text-sm">
          <Link href={link({ mes: mesAnterior(mes), situacao: situacao === 'atrasada' ? null : situacao })} className="rounded-norte border border-borda bg-superficie px-2.5 py-1 font-semibold hover:bg-superficie-2" aria-label="Mês anterior">
            ‹
          </Link>
          <span className="font-semibold text-tinta">{mesPorExtenso(mes)}</span>
          {mes < limite && (
            <Link href={link({ mes: mesSeguinte(mes), situacao: situacao === 'atrasada' ? null : situacao })} className="rounded-norte border border-borda bg-superficie px-2.5 py-1 font-semibold hover:bg-superficie-2" aria-label="Próximo mês">
              ›
            </Link>
          )}
          {mes !== mesDeHoje && (
            <Link href={link({ mes: null })} className="ml-1 text-xs text-tinta-3 underline-offset-2 hover:underline">
              este mês
            </Link>
          )}
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            principal
            rotulo="Falta receber no mês"
            valor={brl(resumo.doMes.aReceber)}
            detalhe={`${resumo.doMes.quantas - resumo.doMes.pagas} de ${resumo.doMes.quantas} ${resumo.doMes.quantas === 1 ? 'mensalidade' : 'mensalidades'} em aberto`}
          />
          <Numero
            rotulo="Já pago do mês"
            valor={brl(resumo.doMes.recebido)}
            detalhe={`de ${brl(resumo.doMes.devido)} · ${resumo.doMes.pagas} ${resumo.doMes.pagas === 1 ? 'paga' : 'pagas'}`}
            nivel={resumo.doMes.quantas > 0 && resumo.doMes.pagas === resumo.doMes.quantas ? 'bom' : undefined}
          />
          <Numero
            rotulo="Em atraso"
            valor={brl(resumo.atraso.total)}
            detalhe={
              resumo.atraso.quantas === 0
                ? 'ninguém atrasado'
                : `${resumo.atraso.quantas} ${resumo.atraso.quantas === 1 ? 'mensalidade' : 'mensalidades'} · ${resumo.atraso.alunos} ${resumo.atraso.alunos === 1 ? voc.pessoa : voc.pessoas}`
            }
            nivel={resumo.atraso.quantas > 0 ? 'critico' : 'bom'}
          />
          <Numero
            rotulo="Entrou hoje"
            valor={brl(resumo.recebidoHoje)}
            detalhe={`${brl(resumo.recebidoNoMes)} no mês, com juro e multa`}
          />
        </div>

        {resumo.porTurma.length > 1 && !turmaId && (
          <div className="flex flex-wrap gap-1.5">
            {resumo.porTurma.map((t) => (
              <Link
                key={t.turmaId}
                href={link({ turma: t.turmaId })}
                className={cx(
                  'flex items-baseline gap-2 rounded-full border px-3 py-1 text-xs',
                  t.atrasadas > 0 ? 'border-critico-borda bg-critico-fundo text-critico' : 'border-borda bg-superficie text-tinta-2',
                )}
                title={`Do mês: ${brl(t.devido)} · pago ${brl(t.recebido)}`}
              >
                <span className="font-semibold">{t.turma}</span>
                <span className="numero">{t.aberto > 0 ? `falta ${brl(t.aberto)}` : 'tudo pago'}</span>
                {t.atrasadas > 0 && <span className="numero">· {t.atrasadas} em atraso</span>}
              </Link>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Busca
            valor={q}
            placeholder={`Nome do ${voc.pessoa} ou do responsável`}
            rotulo="Buscar nas mensalidades"
            manter={{ unidade: onde.unidadeId, mes: atuais.mes, situacao, turma: turmaId }}
            limparEm={link({ q: null })}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Fichas
              opcoes={[
                { valor: null, rotulo: 'todas do mês' },
                { valor: 'a_receber', rotulo: 'a receber' },
                { valor: 'atrasada', rotulo: 'em atraso', quantos: resumo.atraso.quantas },
                { valor: 'paga', rotulo: 'pagas' },
                { valor: 'cancelada', rotulo: 'dispensadas' },
              ]}
              atual={situacao}
              linkDe={(v) => link({ situacao: v })}
            />
            {turmaNome && (
              <Link href={link({ turma: null })} className="text-xs text-tinta-3 underline-offset-2 hover:underline">
                só {turmaNome} · ver todas as turmas
              </Link>
            )}
          </div>
        </div>

        <Tabela
          colunas={[
            {
              chave: 'aluno',
              titulo: voc.Pessoa,
              celula: (m: MensalidadeNaLista) => (
                <span className="flex flex-col">
                  <Link href={`/${slug}/clientes/${m.alunoId}`} className="font-medium text-tinta underline-offset-2 hover:underline">
                    {m.aluno}
                  </Link>
                  <span className="text-xs text-tinta-3">
                    {m.responsavel ? `${m.responsavel}${m.telefoneResponsavel ? ` · ${mostrarTelefone(m.telefoneResponsavel)}` : ''}` : 'sem responsável anotado'}
                  </span>
                </span>
              ),
            },
            {
              chave: 'turma',
              titulo: 'Turma',
              celula: (m: MensalidadeNaLista) => (
                <span className="flex flex-col text-sm text-tinta-2">
                  <span>{m.turma}</span>
                  {situacao === 'atrasada' && <span className="text-xs text-tinta-3">{mesPorExtenso(m.mes, true)}</span>}
                </span>
              ),
            },
            {
              chave: 'venc',
              titulo: 'Vence',
              largura: '8.5rem',
              celula: (m: MensalidadeNaLista) => (
                <span className="flex flex-col gap-0.5">
                  <span className="numero text-tinta">{mostrarDiaDaColuna(m.vencimento, 'curto')}</span>
                  <Situacao nivel={NIVEL[m.situacao]}>
                    {m.situacao === 'atrasada' ? `${m.diasAtraso} dia${m.diasAtraso === 1 ? '' : 's'} em atraso` : ROTULO_SITUACAO[m.situacao]}
                  </Situacao>
                  {/* Uma linha, cortada, com o motivo inteiro no "title": na
                      coluna estreita ele quebrava em quatro linhas e esticava
                      a fileira. */}
                  {m.motivoCancelamento && (
                    <span className="block max-w-full truncate text-xs text-tinta-3" title={m.motivoCancelamento}>
                      {m.motivoCancelamento}
                    </span>
                  )}
                </span>
              ),
            },
            {
              chave: 'valor',
              titulo: 'Valor',
              numero: true,
              largura: '8rem',
              celula: (m: MensalidadeNaLista) => (
                <span className="flex flex-col items-end">
                  <span className="numero text-tinta">{brl(m.devido)}</span>
                  {m.desconto > 0 && <span className="text-xs text-tinta-3">de {brl(m.valor)}</span>}
                  {m.pago > 0 && m.situacao !== 'paga' && <span className="text-xs text-tinta-3">pago {brl(m.pago)}</span>}
                  {m.juros + m.multa > 0 && <span className="text-xs text-tinta-3">+ {brl(m.juros + m.multa)} juro e multa</span>}
                  {m.abono > 0 && <span className="text-xs text-tinta-3">− {brl(m.abono)} pontualidade</span>}
                </span>
              ),
            },
            {
              chave: 'resta',
              titulo: 'Falta',
              numero: true,
              largura: '7rem',
              celula: (m: MensalidadeNaLista) =>
                m.situacao === 'paga' || m.situacao === 'cancelada' ? (
                  <span className="numero text-tinta-3">—</span>
                ) : (
                  <span className={cx('numero font-bold', m.situacao === 'atrasada' ? 'text-critico' : 'text-tinta')}>{brl(m.resta)}</span>
                ),
            },
            {
              chave: 'acoes',
              titulo: '',
              largura: '9rem',
              celula: (m: MensalidadeNaLista) => (
                <span className="flex flex-col items-end gap-1">
                  {m.situacao !== 'paga' && m.situacao !== 'cancelada' && pode(sessao, 'mensalidade.receber', m.unidadeId) && (
                    <Receber
                      slug={slug}
                      mensalidadeId={m.id}
                      resta={m.resta}
                      jurosHoje={m.jurosHoje}
                      multaHoje={m.multaHoje}
                      abonoHoje={m.abonoHoje}
                      diasAtraso={m.diasAtraso}
                      diasJuros={m.diasJuros}
                    />
                  )}
                  {m.temPagamento && (
                    <Link href={`/${slug}/mensalidades/${m.id}/recibo`} className="text-xs text-marca underline-offset-2 hover:underline">
                      Recibo
                    </Link>
                  )}
                  {!m.temPagamento && m.situacao !== 'cancelada' && m.situacao !== 'paga' && pode(sessao, 'mensalidade.ajustar', m.unidadeId) && (
                    <Dispensar slug={slug} id={m.id} />
                  )}
                </span>
              ),
            },
          ]}
          linhas={lista}
          chave={(m) => m.id}
          // O "Receber" é a última coluna: com o menu aberto, a tabela não
          // cabia e ele sumia atrás da rolagem. Estreita, cada linha vira cartão.
          empilhar
          vazio={
            q || turmaId
              ? 'Nada com esse filtro.'
              : situacao === 'atrasada'
                ? 'Ninguém em atraso. Bom sinal.'
                : situacao === 'paga'
                  ? 'Nenhuma mensalidade paga neste mês ainda.'
                  : // O filtro "a receber" vazio com mensalidade em aberto no
                    // alto da tela: não é que não haja matrícula — o que falta
                    // já venceu, e mora em "em atraso".
                    situacao === 'a_receber'
                    ? resumo.atraso.quantas > 0
                      ? 'Nada a vencer neste mês: o que falta receber já está em atraso.'
                      : 'Nada a receber neste mês.'
                    : situacao === 'cancelada'
                      ? 'Nenhuma mensalidade dispensada neste mês.'
                      : pode(sessao, 'escola.ver')
                    ? 'Nenhuma mensalidade neste mês. Elas nascem das matrículas ativas — matricule em Turmas.'
                    : 'Nenhuma mensalidade neste mês.'
          }
        />

        <Tira
          itens={[
            { rotulo: 'na lista', um: 'na lista', quantos: lista.length, nivel: 'neutro' },
            { rotulo: 'em atraso', um: 'em atraso', quantos: lista.filter((m) => m.situacao === 'atrasada').length, nivel: 'critico' },
            { rotulo: 'pagas', um: 'paga', quantos: lista.filter((m) => m.situacao === 'paga').length, nivel: 'bom' },
          ]}
        />
        <p className="text-xs text-tinta-3">
          Regra da escola: multa de {regra.multaPct.toLocaleString('pt-BR')}% (uma vez só) e juro de {regra.jurosMes.toLocaleString('pt-BR')}% ao mês, por dia de atraso
          {regra.pontualidadePct > 0 ? `; ${regra.pontualidadePct.toLocaleString('pt-BR')}% de desconto para quem paga até o vencimento` : ''}. Quem cobra é a secretaria, com o responsável — o {voc.pessoa} não é cobrado nem bloqueado.
        </p>
      </Secao>
    </Estrutura>
  )
}
