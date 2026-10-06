import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { moduloLigado } from '@/servidor/modulos'
import { pode, unidadesQuePodem, type Capacidade } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { mostrarTelefone } from '@/servidor/cliente'
import { diaEmSP } from '@/servidor/dia'
import {
  contasSemFicha,
  diaDoMes,
  estadoDoPonto,
  folhaDe,
  horaEmSP,
  horas,
  listarColaboradores,
  meuColaborador,
  mesValido,
  podeNoColaborador,
  resumoDoMes,
  type LinhaDoMes,
} from '@/servidor/ponto'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { enderecoCom } from '@/ui/Busca'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Aviso, Cartao, Situacao, Vazio, cx } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { Ficha } from './Ficha'
import { AbonarOutroDia, Abonar, Ajuste, Anular, BaterPonto, DesfazerAbono, Inicio } from './Ponto'

export const metadata: Metadata = { title: 'Funcionários' }

// Funcionários e ponto: quem trabalha aqui, e as horas de cada um.
//
// Uma tela para três pessoas diferentes:
//   • quem trabalha bate o PRÓPRIO ponto aqui (o botão grande em cima) e vê a
//     própria folha — e só a própria;
//   • quem gere a equipe cadastra as fichas, bate o ponto de quem não tem
//     login, lança a batida que faltou e anula a errada — sempre com motivo;
//   • o dono e o contador leem o mês de todos, para fechar a folha.
//
// Com o Ponto desligado e a Agenda ligada, a tela é só a lista de quem atende
// (as colunas da agenda) — ver modulos.ts.
//
// Endereço: `?unidade=`, `?mes=AAAA-MM`, `?pessoa=<id>` (a folha de alguém),
// `?editar=<id>` (a ficha).

const NOME_DO_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const mesFalado = (mes: string) => `${NOME_DO_MES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`
const mesVizinho = (mes: string, n: number) => {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}
const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const semanaCurta = (dia: string) => DIAS_CURTOS[new Date(`${dia}T12:00:00Z`).getUTCDay()]

export default async function Funcionarios({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; mes?: string; pessoa?: string; editar?: string }>
}) {
  const { empresa: slug } = await params
  const q = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const pontoLigado = moduloLigado(empresa, 'ponto')
  const agendaLigada = moduloLigado(empresa, 'agenda')
  if (!pontoLigado && !agendaLigada) semAcesso(slug, 'modulo-ponto')
  const capacidade: Capacidade | undefined = (['equipe.ver', 'ponto.ver', 'ponto.proprio', 'agenda.ver'] as const).find((c) => pode(sessao, c))
  if (!capacidade) semAcesso(slug, 'cargo')

  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const agora = new Date()
  const mes = mesValido(q.mes, agora)
  const hoje = diaEmSP(agora)

  const onde = await escolherUnidade(sessao, empresa, q.unidade, capacidade)
  const podeGerir = pode(sessao, 'equipe.gerir')
  const pessoas = await listarColaboradores(sessao, { unidadeIds: onde.ids, inativos: podeGerir })
  const meu = pontoLigado ? await meuColaborador(sessao) : null
  const meuEstado = meu && meu.ativo && pode(sessao, 'ponto.proprio') ? await estadoDoPonto(sessao, meu.id, agora) : null
  const verHoras = pontoLigado && pode(sessao, 'ponto.ver')
  const resumo: LinhaDoMes[] = verHoras ? await resumoDoMes(sessao, onde.ids, mes, agora) : []
  const doMes = new Map(resumo.map((r) => [r.colaboradorId, r]))
  const pessoaPedida = q.pessoa && /^[\w-]{1,64}$/.test(q.pessoa) ? q.pessoa : meu && !verHoras ? meu.id : null
  const folha = pontoLigado && pessoaPedida ? await folhaDe(sessao, pessoaPedida, mes, agora) : null
  const gereEsta = !!folha && podeNoColaborador(sessao, 'ponto.gerir', folha.colaborador)
  const editando = podeGerir && q.editar ? (pessoas.find((p) => p.id === q.editar) ?? null) : null
  const contas = podeGerir ? await contasSemFicha(sessao, editando?.usuarioId ?? null) : []
  const podeSemLoja = unidadesQuePodem(sessao, 'equipe.gerir') === 'todas'
  const lojasDaFicha = onde.opcoes.filter((u) => pode(sessao, 'equipe.gerir', u.id)).map((u) => ({ id: u.id, nome: u.nome }))

  const atuais = { unidade: onde.unidadeId, mes: q.mes ? mes : null, pessoa: q.pessoa ?? null }
  const link = (m: Record<string, string | null>) => enderecoCom(`/${slug}/funcionarios`, atuais, m)
  const gerePonto = (c: { unidadeId: string | null }) => pontoLigado && podeNoColaborador(sessao, 'ponto.gerir', c)

  const navMes = (
    <span className="flex items-center gap-1.5 text-sm">
      <Link href={link({ mes: mesVizinho(mes, -1) })} className="rounded-norte border border-borda bg-superficie px-2.5 py-1 font-semibold hover:bg-superficie-2" aria-label="Mês anterior">
        ‹
      </Link>
      <span className="font-semibold text-tinta">{mesFalado(mes)}</span>
      {mes < hoje.slice(0, 7) && (
        <Link href={link({ mes: mesVizinho(mes, 1) })} className="rounded-norte border border-borda bg-superficie px-2.5 py-1 font-semibold hover:bg-superficie-2" aria-label="Próximo mês">
          ›
        </Link>
      )}
    </span>
  )

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/funcionarios`}
      tema={tema}
      titulo="Funcionários"
      acao={onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} /> : undefined}
    >
      {/* ── o meu ponto ── */}
      {meuEstado && meu && (
        <Cartao caixa titulo="Meu ponto">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-tinta">
              {meuEstado.desde ? (
                <>
                  Você está trabalhando desde <b className="numero">{horaEmSP(meuEstado.desde)}</b>.
                </>
              ) : meuEstado.ultima ? (
                <>
                  Última batida: {meuEstado.ultima.tipo === 'ENTRADA' ? 'entrada' : 'saída'} às{' '}
                  <b className="numero">{horaEmSP(meuEstado.ultima.em)}</b>.
                </>
              ) : (
                'Nenhuma batida ainda.'
              )}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <BaterPonto slug={slug} colaboradorId={meu.id} proxima={meuEstado.proxima} grande />
              <Link href={link({ pessoa: meu.id })} className="text-sm font-semibold text-marca underline-offset-2 hover:underline">
                Minha folha do mês
              </Link>
            </div>
          </div>
        </Cartao>
      )}
      {pontoLigado && !meu && pode(sessao, 'ponto.proprio') && !verHoras && (
        <Aviso nivel="neutro">Sua conta ainda não está ligada a uma ficha de funcionário. Peça para quem gere a equipe ligar — aí você bate o seu ponto aqui.</Aviso>
      )}

      {/* ── a folha de alguém ── */}
      {folha && (
        <Cartao
          titulo={`Folha de ${folha.colaborador.nome}`}
          acao={
            <span className="flex flex-wrap items-center gap-3">
              {navMes}
              {q.pessoa && (
                <Link href={link({ pessoa: null })} className="text-xs text-tinta-3 hover:text-tinta">
                  fechar
                </Link>
              )}
            </span>
          }
        >
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Trabalhadas', horas(folha.folha.totais.trabalhado)],
              ['Combinadas até hoje', folha.folha.totais.previstoMes > 0 ? horas(folha.folha.totais.previsto) : '—'],
              ['Diferença', folha.folha.totais.previstoMes > 0 ? horas(folha.folha.totais.diferenca) : '—'],
              ['Extras', horas(folha.folha.totais.extras)],
              ['Faltas', String(folha.folha.totais.faltas)],
              ['Pendências', String(folha.folha.totais.pendencias)],
            ].map(([t, v]) => (
              <div key={t} className="flex flex-col rounded-norte bg-superficie-2 px-3 py-2">
                <dt className="text-xs text-tinta-3">{t}</dt>
                <dd className="numero text-base font-bold text-tinta">{v}</dd>
              </div>
            ))}
          </dl>
          {folha.folha.aberto && folha.folha.aberto.entrada && (
            <p className="text-sm text-bom">Trabalhando agora, desde {horaEmSP(folha.folha.aberto.entrada)}.</p>
          )}

          {gereEsta && <Inicio slug={slug} colaboradorId={folha.colaborador.id} inicio={folha.colaborador.inicio} hoje={hoje} />}

          {folha.folha.dias.some((d) => d.turnos.length > 0 || d.falta || d.abono) ? (
            <ul className="flex flex-col divide-y divide-borda-suave">
              {[...folha.folha.dias].reverse().filter((d) => d.turnos.length > 0 || d.falta || d.abono).map((d) => (
                <li key={d.dia} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-start gap-3 py-2 text-sm">
                  <span className="numero font-semibold text-tinta">
                    {semanaCurta(d.dia)} {diaDoMes(d.dia)}
                  </span>
                  <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-tinta-2">
                    {d.falta && <Situacao nivel="critico">falta</Situacao>}
                    {d.abono && <Situacao nivel="neutro">abonado: {d.abono}</Situacao>}
                    {gereEsta && d.falta && <Abonar slug={slug} colaboradorId={folha.colaborador.id} dia={d.dia} />}
                    {gereEsta && d.abono && <DesfazerAbono slug={slug} colaboradorId={folha.colaborador.id} dia={d.dia} />}
                    {d.turnos.map((t, i) => (
                      <span key={i} className="numero">
                        {t.entrada ? horaEmSP(t.entrada) : '—'} → {t.saida ? horaEmSP(t.saida) : t.situacao === 'aberto' ? 'agora' : '—'}
                        {t.situacao === 'sem_saida' && <span className="ml-1 text-xs font-semibold text-atencao">sem saída</span>}
                        {t.situacao === 'sem_entrada' && <span className="ml-1 text-xs font-semibold text-atencao">sem entrada</span>}
                        {t.saida && t.entrada && diaEmSP(t.saida) !== diaEmSP(t.entrada) && (
                          <span className="ml-1 text-xs text-tinta-3">(virou o dia)</span>
                        )}
                      </span>
                    ))}
                  </span>
                  <span className="numero text-right">
                    <span className="block font-semibold text-tinta">{horas(d.trabalhado)}</span>
                    {d.previsto > 0 && <span className="block text-xs text-tinta-3">de {horas(d.previsto)}</span>}
                    {d.extra > 0 && <span className="block text-xs text-bom">+{horas(d.extra)} extra</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Vazio>Nenhuma batida em {mesFalado(mes)}.</Vazio>
          )}

          {folha.batidas.length > 0 && (
            <details className="rounded-norte border border-borda-suave px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold text-tinta">Todas as batidas do mês ({folha.batidas.length})</summary>
              <ul className="mt-2 flex flex-col divide-y divide-borda-suave">
                {folha.batidas.map((b) => (
                  <li key={b.id} className={cx('flex flex-wrap items-center justify-between gap-2 py-2 text-sm', b.anulada && 'opacity-60')}>
                    <span className="flex min-w-0 flex-col">
                      <span className={cx('numero text-tinta', b.anulada && 'line-through')}>
                        {b.tipo === 'ENTRADA' ? 'Entrada' : 'Saída'} · {semanaCurta(diaEmSP(b.em))} {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(b.em)} às {horaEmSP(b.em)}
                      </span>
                      <span className="text-xs text-tinta-3">
                        {b.origem === 'PROPRIO' ? 'a própria pessoa' : b.origem === 'GESTOR' ? `batida por ${b.quem}` : `ajuste de ${b.quem}: ${b.motivo ?? ''}`}
                        {b.anulada && ` · anulada por ${b.anulada.por ?? '—'}: ${b.anulada.motivo ?? ''}`}
                      </span>
                    </span>
                    {!b.anulada && podeNoColaborador(sessao, 'ponto.gerir', folha.colaborador) && <Anular slug={slug} registroId={b.id} />}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {gereEsta && <Ajuste slug={slug} colaboradorId={folha.colaborador.id} hoje={hoje} />}
          {gereEsta && <AbonarOutroDia slug={slug} colaboradorId={folha.colaborador.id} hoje={hoje} />}
        </Cartao>
      )}
      {pontoLigado && q.pessoa && !folha && <Aviso nivel="neutro">Essa folha não abre para você.</Aviso>}

      {/* ── cadastro ── */}
      {podeGerir && lojasDaFicha.length + (podeSemLoja ? 1 : 0) > 0 && (
        editando ? (
          <Ficha
            key={editando.id}
            slug={slug}
            lojas={lojasDaFicha}
            contas={contas}
            podeSemLoja={podeSemLoja}
            pontoLigado={pontoLigado}
            agendaLigada={agendaLigada}
            voltarPara={link({ editar: null })}
            inicial={{
              id: editando.id,
              nome: editando.nome,
              cargo: editando.cargo,
              telefone: editando.telefone,
              unidadeId: editando.unidadeId,
              usuarioId: editando.usuarioId,
              atende: editando.atende,
              jornadaMin: editando.jornadaMin,
              ativo: editando.ativo,
            }}
          />
        ) : (
          <Ficha
            slug={slug}
            lojas={lojasDaFicha}
            contas={contas}
            podeSemLoja={podeSemLoja}
            pontoLigado={pontoLigado}
            agendaLigada={agendaLigada}
            voltarPara={link({})}
          />
        )
      )}

      {/* ── quem trabalha aqui ── */}
      <Cartao titulo={verHoras ? `Quem trabalha aqui · ${mesFalado(mes)}` : 'Quem trabalha aqui'} acao={verHoras ? navMes : undefined}>
        {pessoas.length === 0 ? (
          <Vazio>
            Ninguém cadastrado ainda.{' '}
            {podeGerir
              ? 'Cadastre quem trabalha — com ou sem login no sistema. Quem nunca vai abrir o Norte tem agenda e ponto do mesmo jeito.'
              : 'Quem gere a equipe cadastra aqui.'}
          </Vazio>
        ) : (
          <ul className="flex flex-col gap-2">
            {pessoas.map((p) => {
              const r = doMes.get(p.id)
              const podeFolha = pontoLigado && (verHoras || p.id === meu?.id)
              return (
                <li key={p.id} className={cx('flex flex-col gap-2 rounded-norte border border-borda bg-superficie p-3 md:flex-row md:items-center md:justify-between', !p.ativo && 'opacity-60')}>
                  <span className="flex min-w-0 flex-col">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-tinta">{p.nome}</span>
                      {!p.ativo && <Situacao nivel="neutro">saiu</Situacao>}
                      {r?.aberto && <Situacao nivel="bom">trabalhando desde {horaEmSP(r.aberto)}</Situacao>}
                      {agendaLigada && p.atende && <Situacao nivel="neutro">atende na agenda</Situacao>}
                    </span>
                    <span className="text-xs text-tinta-3">
                      {[p.cargo, p.unidadeNome ?? 'todas as lojas', p.usuarioNome ? `conta: ${p.usuarioNome}` : 'sem login', p.telefone ? mostrarTelefone(p.telefone) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {r && (
                    <span className="numero flex flex-wrap gap-x-4 gap-y-1 text-xs text-tinta-2">
                      <span>
                        <b className="text-sm text-tinta">{horas(r.totais.trabalhado)}</b>
                        {r.temJornada && <> de {horas(r.totais.previsto)}</>}
                      </span>
                      {r.totais.extras > 0 && <span className="text-bom">+{horas(r.totais.extras)} extra</span>}
                      {r.totais.faltas > 0 && <span className="text-critico">{r.totais.faltas} {r.totais.faltas === 1 ? 'falta' : 'faltas'}</span>}
                      {r.totais.pendencias > 0 && <span className="text-atencao">{r.totais.pendencias} a ajustar</span>}
                    </span>
                  )}
                  <span className="flex flex-wrap items-center gap-2">
                    {p.ativo && gerePonto(p) && p.id !== meu?.id && (
                      <BaterPonto slug={slug} colaboradorId={p.id} proxima={r?.aberto ? 'SAIDA' : 'ENTRADA'} rotulo={r?.aberto ? 'Bater saída' : 'Bater entrada'} />
                    )}
                    {podeFolha && (
                      <Link href={link({ pessoa: p.id })} className="text-xs font-semibold text-marca underline-offset-2 hover:underline">
                        Folha
                      </Link>
                    )}
                    {podeGerir && podeNoColaborador(sessao, 'equipe.gerir', p) && (
                      <Link href={link({ editar: p.id })} className="text-xs font-semibold text-tinta-2 underline-offset-2 hover:underline">
                        Ficha
                      </Link>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Cartao>

      {pontoLigado && (
        <p className="text-xs text-tinta-3">
          Este ponto é um controle interno da empresa: não é um registrador eletrônico de ponto certificado (REP, Portaria MTP
          671/2021) e não emite comprovante com valor de fiscalização. Nada se apaga — a batida errada é anulada com motivo e a que
          faltou entra como ajuste, com o nome de quem lançou. O turno que passa da meia-noite conta no dia em que começou.
        </p>
      )}
      {!pontoLigado && (
        <p className="text-xs text-tinta-3">
          Esta é a lista de quem atende na Agenda. Para anotar entrada e saída, ligue “Funcionários e ponto” em Configurações.
        </p>
      )}
    </Estrutura>
  )
}

