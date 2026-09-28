import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { moduloLigado } from '@/servidor/modulos'
import { pode } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { comoOrg } from '@/servidor/banco'
import { mostrarTelefone } from '@/servidor/cliente'
import { inicioDoDiaEmSP } from '@/servidor/dia'
import { vocabularioDaEmpresa } from '@/servidor/vocabulario'
import {
  NIVEL_AGENDA,
  ROTULO_AGENDA,
  acharHorario,
  diaCurtoSP,
  diaEmSP,
  horaEmSP,
  horarioDaLoja,
  horariosLivres,
  listarAgenda,
  ocupa,
  profissionaisDaLoja,
  resumirDia,
  servicosDaLoja,
  somarDias,
  type HorarioNaAgenda,
} from '@/servidor/agenda'
import { linkWhatsApp } from '@/servidor/encomenda'
import { ROTULO_LEMBRETE } from '@/servidor/lembretes'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Fichas, enderecoCom } from '@/ui/Busca'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Tira } from '@/ui/painel'
import { Aviso, FAIXA, Situacao, Vazio, cx } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { Formulario } from './Formulario'
import { AcoesHorario } from './Linha'

export const metadata: Metadata = { title: 'Agenda' }

// Agenda: quem vem, com quem, a que horas.
//
// O DIA se lê em colunas, uma por profissional — é como a recepção pensa ("a
// Bia está livre às 16h?"). Cada coluna tem os horários marcados e, embaixo,
// os livres que ainda cabem: tocar num livre abre o "Novo horário" já com a
// profissional, o dia e a hora. No celular as colunas viram uma embaixo da
// outra; no tablet, lado a lado.
//
// A SEMANA é a grade de sete dias, para ver o movimento e achar um dia com
// vaga. Tocar no dia abre o dia.
//
// Tudo no endereço: `?dia=`, `?ver=semana`, `?unidade=`, `?profissional=`
// (na semana), `?editar=<id>` (remarcar), `?livre=<profissional>&hora=`.

const diaValido = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
const rotuloDoDia = (dia: string) => diaCurtoSP(new Date(`${dia}T15:00:00Z`))

export default async function Agenda({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{
    unidade?: string
    dia?: string
    ver?: string
    editar?: string
    profissional?: string
    livre?: string
    hora?: string
  }>
}) {
  const { empresa: slug } = await params
  const q = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'agenda.ver' })
  if (!moduloLigado(empresa, 'agenda')) notFound()

  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const agora = new Date()
  const hoje = diaEmSP(agora)
  const dia = diaValido(q.dia) ? q.dia : hoje
  const semana = q.ver === 'semana'

  // A agenda é sempre DE UMA loja: as colunas são as profissionais dela.
  const onde = await escolherUnidade(sessao, empresa, q.unidade, 'agenda.ver')
  const unidadeId = onde.unidadeId ?? onde.opcoes[0]?.id ?? null
  const vocab = await vocabularioDaEmpresa(sessao.orgId)

  const base = { empresa, sessao, itens: MENU(slug), ativo: `/${slug}/agenda`, tema, titulo: 'Agenda' }
  if (!unidadeId) {
    return (
      <Estrutura {...base}>
        <Aviso nivel="atencao">Você não tem acesso à agenda de nenhuma loja. Peça para quem responde pela empresa liberar.</Aviso>
      </Estrutura>
    )
  }

  // Uma consulta de cada vez: cada uma abre a própria transação.
  const profs = await profissionaisDaLoja(sessao, unidadeId)
  const servicos = await servicosDaLoja(sessao, unidadeId)
  const { texto: horarioTexto, horario } = await horarioDaLoja(sessao, unidadeId)
  const segunda = somarDias(dia, -((new Date(`${dia}T12:00:00Z`).getUTCDay() + 6) % 7))
  const de = semana ? segunda : dia
  const ate = semana ? somarDias(segunda, 7) : somarDias(dia, 1)
  const profFiltro = semana && q.profissional && profs.some((p) => p.id === q.profissional) ? q.profissional : null
  const lista = await listarAgenda(sessao, {
    unidadeIds: [unidadeId],
    de: inicioDoDiaEmSP(de),
    ate: inicioDoDiaEmSP(ate),
    colaboradorId: profFiltro,
  })
  const editando = q.editar && /^[\w-]{1,64}$/.test(q.editar) ? await acharHorario(sessao, q.editar) : null
  const org = await comoOrg(sessao.orgId, (db) =>
    db.org.findUnique({ where: { id: sessao.orgId }, select: { lembreteAtivo: true } }),
  )

  const podeMarcar = pode(sessao, 'agenda.marcar', unidadeId)
  const podeVender = pode(sessao, 'venda.criar', unidadeId)
  const podeBuscarCliente = pode(sessao, 'cliente.ver')
  const podeEquipe = pode(sessao, 'equipe.gerir', unidadeId)
  const materialUsado = moduloLigado(empresa, 'compras') && pode(sessao, 'estoque.consumir', unidadeId)

  const atuais = { unidade: onde.unidadeId, dia: dia === hoje ? null : dia, ver: semana ? 'semana' : null, profissional: profFiltro }
  const link = (m: Record<string, string | null>) => enderecoCom(`/${slug}/agenda`, atuais, m)
  const resumo = resumirDia(lista, profs, horario, dia, agora)

  const preenchido =
    !semana && q.livre && profs.some((p) => p.id === q.livre) && q.hora && /^\d{2}:\d{2}$/.test(q.hora)
      ? { colaboradorId: q.livre, dia, hora: q.hora }
      : null

  const palavras = { Pessoa: vocab.Pessoa, pessoas: vocab.pessoas, avisoObservacao: vocab.avisoObservacao }
  const lojasParaMarcar = onde.opcoes.filter((u) => u.id === unidadeId)

  // ── um horário, como cartão ──
  const cartao = (a: HorarioNaAgenda, compacto = false) => {
    const wa = linkWhatsApp(a.telefone)
    const nivel = NIVEL_AGENDA[a.situacao]
    return (
      <li
        key={a.id}
        className={cx(
          'flex flex-col gap-2 rounded-norte border border-borda bg-superficie p-3',
          FAIXA[nivel],
          !ocupa(a.situacao) && 'opacity-70',
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="numero text-sm font-bold text-tinta">
            {horaEmSP(a.inicio)}
            <span className="font-normal text-tinta-3">–{horaEmSP(a.fim)}</span>
          </span>
          <Situacao nivel={NIVEL_AGENDA[a.situacao]}>{ROTULO_AGENDA[a.situacao]}</Situacao>
        </div>
        <span className="flex min-w-0 flex-col">
          <span className={cx('truncate font-semibold text-tinta', a.situacao === 'CANCELADO' && 'line-through')}>{a.clienteNome}</span>
          <span className="truncate text-sm text-tinta-2">{a.servico}</span>
          {wa && !compacto && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-marca underline-offset-2 hover:underline">
              {mostrarTelefone(a.telefone)} · WhatsApp
            </a>
          )}
        </span>
        {a.observacao && !compacto && <p className="text-xs whitespace-pre-line text-tinta-3">{a.observacao}</p>}
        {a.situacao === 'CANCELADO' && a.motivo && <p className="text-xs text-tinta-3">Desmarcado: {a.motivo}</p>}
        {a.vendaId && pode(sessao, 'venda.ver', unidadeId) && (
          <Link href={`/${slug}/vendas/${a.vendaId}`} className="text-xs font-medium text-bom underline-offset-2 hover:underline">
            Cobrado · ver a venda
          </Link>
        )}
        {a.lembrete && ROTULO_LEMBRETE[a.lembrete] && <span className="text-xs text-tinta-3">{ROTULO_LEMBRETE[a.lembrete]}</span>}
        <AcoesHorario
          slug={slug}
          id={a.id}
          resumo={`${a.clienteNome} — ${a.servico}, ${horaEmSP(a.inicio)}`}
          situacao={a.situacao}
          cobrado={!!a.vendaId}
          podeMexer={podeMarcar}
          cobrarEm={podeVender ? `/${slug}/balcao?unidade=${unidadeId}&agendamento=${a.id}` : null}
          remarcarEm={link({ editar: a.id, dia: diaEmSP(a.inicio) === hoje ? null : diaEmSP(a.inicio), ver: null })}
          compacto={compacto}
        />
      </li>
    )
  }

  const navegar = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Link
          href={link({ dia: somarDias(dia, semana ? -7 : -1) === hoje ? null : somarDias(dia, semana ? -7 : -1) })}
          className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
          aria-label={semana ? 'Semana anterior' : 'Dia anterior'}
        >
          ‹
        </Link>
        <Link
          href={link({ dia: null })}
          aria-current={dia === hoje ? 'true' : undefined}
          className={cx(
            'rounded-norte border px-3 py-1.5 text-sm font-semibold',
            dia === hoje ? 'border-marca/40 bg-marca-suave text-marca' : 'border-borda bg-superficie text-tinta hover:bg-superficie-2',
          )}
        >
          Hoje
        </Link>
        <Link
          href={link({ dia: somarDias(dia, semana ? 7 : 1) === hoje ? null : somarDias(dia, semana ? 7 : 1) })}
          className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
          aria-label={semana ? 'Próxima semana' : 'Próximo dia'}
        >
          ›
        </Link>
        <span className="ml-1 text-[15px] font-bold text-tinta">
          {semana ? `Semana de ${rotuloDoDia(segunda)}` : dia === hoje ? `Hoje, ${rotuloDoDia(dia)}` : rotuloDoDia(dia)}
        </span>
      </div>
      <Fichas
        opcoes={[
          { valor: null, rotulo: 'Dia' },
          { valor: 'semana', rotulo: 'Semana' },
        ]}
        atual={semana ? 'semana' : null}
        linkDe={(v) => link({ ver: v, profissional: null })}
      />
    </div>
  )

  return (
    <Estrutura
      {...base}
      acao={onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={unidadeId} /> : undefined}
    >
      {navegar}

      {!semana && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <Tira
            itens={[
              { rotulo: 'para atender', quantos: resumo.total - resumo.atendidos, nivel: 'neutro' },
              { rotulo: 'confirmados', um: 'confirmado', quantos: resumo.confirmados, nivel: 'bom' },
              { rotulo: 'atendidos', um: 'atendido', quantos: resumo.atendidos, nivel: 'bom' },
              { rotulo: 'faltas', um: 'falta', quantos: resumo.faltas, nivel: 'critico' },
              { rotulo: 'desmarcados', um: 'desmarcado', quantos: resumo.desmarcados, nivel: 'neutro' },
            ]}
          />
          {materialUsado && (
            <Link href={`/${slug}/compras/consumo?unidade=${unidadeId}`} className="text-sm font-semibold text-marca underline-offset-2 hover:underline">
              Anotar material usado →
            </Link>
          )}
        </div>
      )}

      {profs.length === 0 ? (
        <Vazio
          acao={
            podeEquipe && (
              <Link href={`/${slug}/funcionarios`} className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2">
                Cadastrar quem atende
              </Link>
            )
          }
        >
          Ninguém atende com horário marcado nesta loja ainda. Em Funcionários, cadastre quem atende e marque “atende com horário
          marcado” — cada pessoa vira uma coluna aqui.
        </Vazio>
      ) : (
        <>
          {editando && editando.unidadeId === unidadeId && podeMarcar && ocupa(editando.situacao) && editando.situacao !== 'ATENDIDO' ? (
            <Formulario
              key={editando.id}
              slug={slug}
              lojas={lojasParaMarcar}
              lojaAtual={unidadeId}
              profissionais={profs}
              servicos={servicos}
              hoje={hoje}
              podeBuscarCliente={podeBuscarCliente}
              palavras={palavras}
              voltarPara={link({ editar: null })}
              inicial={{
                id: editando.id,
                unidadeNome: editando.unidadeNome,
                colaboradorId: editando.colaboradorId,
                clienteId: editando.clienteId,
                clienteNome: editando.clienteNome,
                telefone: editando.telefone,
                produtoId: editando.produtoId,
                servico: editando.servico,
                dia: diaEmSP(editando.inicio),
                hora: horaEmSP(editando.inicio),
                duracao: Math.round((editando.fim.getTime() - editando.inicio.getTime()) / 60_000),
                observacao: editando.observacao,
              }}
            />
          ) : q.editar ? (
            <Aviso nivel="neutro">Esse horário não pode mais ser mudado — ou não é desta loja.</Aviso>
          ) : (
            podeMarcar && (
              <div id="novo">
                <Formulario
                  key={preenchido ? `${preenchido.colaboradorId}-${preenchido.hora}` : 'novo'}
                  slug={slug}
                  lojas={lojasParaMarcar}
                  lojaAtual={unidadeId}
                  profissionais={profs}
                  servicos={servicos}
                  hoje={dia < hoje ? hoje : dia}
                  podeBuscarCliente={podeBuscarCliente}
                  palavras={palavras}
                  preenchido={preenchido}
                  voltarPara={link({})}
                />
              </div>
            )
          )}

          {semana ? (
            <>
              {profs.length > 1 && (
                <Fichas
                  rotulo="Quem atende"
                  opcoes={[{ valor: null, rotulo: 'todos' }, ...profs.map((p) => ({ valor: p.id, rotulo: p.nome }))]}
                  atual={profFiltro}
                  linkDe={(v) => link({ profissional: v })}
                />
              )}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                {Array.from({ length: 7 }, (_, i) => somarDias(segunda, i)).map((d) => {
                  const doDia = lista.filter((a) => diaEmSP(a.inicio) === d)
                  const vivos = doDia.filter((a) => ocupa(a.situacao))
                  return (
                    <section key={d} className={cx('flex min-w-0 flex-col gap-2 rounded-norte border border-borda p-2.5', d === hoje ? 'bg-marca-suave/40' : 'bg-superficie')}>
                      <Link href={link({ ver: null, dia: d === hoje ? null : d, profissional: null })} className="flex items-baseline justify-between gap-2 hover:underline">
                        <span className="text-sm font-bold text-tinta">{rotuloDoDia(d)}</span>
                        <span className="numero text-xs text-tinta-3">{vivos.length}</span>
                      </Link>
                      {doDia.length === 0 ? (
                        <p className="text-xs text-tinta-3">Livre</p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {doDia.map((a) => (
                            <li
                              key={a.id}
                              className={cx('flex flex-col rounded border-l-[3px] bg-superficie-2 px-2 py-1 text-xs', {
                                MARCADO: 'border-l-borda',
                                CONFIRMADO: 'border-l-bom-vivo',
                                ATENDIDO: 'border-l-bom-vivo',
                                FALTOU: 'border-l-critico-vivo',
                                CANCELADO: 'border-l-borda opacity-60',
                              }[a.situacao])}
                            >
                              <span className="numero font-semibold text-tinta">
                                {horaEmSP(a.inicio)} <span className={cx('font-normal', a.situacao === 'CANCELADO' && 'line-through')}>{a.clienteNome}</span>
                              </span>
                              <span className="truncate text-tinta-3">
                                {a.servico}
                                {!profFiltro && profs.length > 1 && ` · ${a.colaboradorNome}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )
                })}
              </div>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))]">
              {profs.map((p) => {
                const dela = lista.filter((a) => a.colaboradorId === p.id)
                const vivos = dela.filter((a) => ocupa(a.situacao))
                const livres =
                  dia >= hoje
                    ? horariosLivres({ horario, dia, ocupados: vivos, duracaoMin: 30 }, agora)
                    : []
                return (
                  <section key={p.id} className="flex min-w-0 flex-col gap-3">
                    <header className="flex items-baseline justify-between gap-2 border-b border-borda pb-2">
                      <span className="flex min-w-0 flex-col">
                        <h2 className="truncate text-[15px] font-bold text-tinta">{p.nome}</h2>
                        {p.cargo && <span className="truncate text-xs text-tinta-3">{p.cargo}</span>}
                      </span>
                      <span className="numero shrink-0 text-xs text-tinta-3">
                        {vivos.length} {vivos.length === 1 ? 'horário' : 'horários'}
                      </span>
                    </header>
                    {dela.length === 0 ? (
                      <p className="rounded-norte bg-superficie-2 px-3 py-2.5 text-sm text-tinta-3">Nada marcado.</p>
                    ) : (
                      <ul className="flex flex-col gap-2">{dela.map((a) => cartao(a))}</ul>
                    )}
                    {livres.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[11px] font-bold tracking-[0.06em] text-tinta-3 uppercase">Livre</span>
                        <div className="flex flex-wrap gap-1">
                          {livres.map((h) =>
                            podeMarcar ? (
                              <Link
                                key={h.getTime()}
                                href={`${link({ livre: p.id, hora: horaEmSP(h) })}#novo`}
                                className="numero rounded-full border border-borda bg-superficie px-2.5 py-1 text-xs font-semibold text-tinta-2 hover:border-marca/40 hover:bg-marca-suave hover:text-marca"
                                title={`Marcar com ${p.nome} às ${horaEmSP(h)}`}
                              >
                                {horaEmSP(h)}
                              </Link>
                            ) : (
                              <span key={h.getTime()} className="numero rounded-full bg-superficie-2 px-2.5 py-1 text-xs text-tinta-3">
                                {horaEmSP(h)}
                              </span>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )}
        </>
      )}

      <p className="text-xs text-tinta-3">
        {horarioTexto
          ? `Os horários livres seguem o funcionamento da loja: ${horarioTexto}.`
          : 'A loja não tem horário de funcionamento escrito (em Lojas): os livres vão das 8h às 20h.'}{' '}
        “Atender e cobrar” abre o Balcão com o serviço e o {vocab.pessoa} já na venda.
        {org?.lembreteAtivo
          ? ` O lembrete no WhatsApp está ligado: sai só para quem aceitou receber mensagens.`
          : ''}
      </p>
    </Estrutura>
  )
}
