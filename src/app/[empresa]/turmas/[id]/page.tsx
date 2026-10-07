import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { pode } from '@/servidor/permissao'
import { moduloLigado } from '@/servidor/modulos'
import { diaDaColuna, diaEmSP, mostrarDiaDaColuna } from '@/servidor/dia'
import { mostrarTelefone } from '@/servidor/cliente'
import { unidadesVisiveis } from '@/servidor/unidade'
import {
  acharTurma,
  horarioDaTurma,
  NIVEL_MATRICULA,
  professoresDasUnidades,
  quaseCheia,
  ROTULO_MATRICULA,
  TURNOS,
  type AlunoDaTurma,
} from '@/servidor/escola'
import { vocabularioDaEmpresa } from '@/servidor/vocabulario'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Tabela } from '@/ui/Tabela'
import { Numero, Secao, brl } from '@/ui/painel'
import { Situacao, cx } from '@/ui/base'
import { BotaoDaLinha } from '@/ui/premium'
import type { Tema } from '@/ui/TrocaTema'
import { TurmaForm } from '../TurmaForm'
import { Matricular } from '../Matricular'
import { MatriculaAcoes } from '../MatriculaAcoes'

export const metadata: Metadata = { title: 'Turma' }

// Uma turma: quem estuda nela, com o responsável de cada um, e matricular.
//
// A lista vem com os ATIVOS primeiro (é a chamada de hoje), depois os
// trancados, e por último quem saiu — que continua aqui, com o motivo, porque
// a história da turma não se apaga.

const idade = (n: Date | null, hoje: string) => {
  if (!n) return null
  const [a, m, d] = diaDaColuna(n).split('-').map(Number) as [number, number, number]
  const [ha, hm, hd] = hoje.split('-').map(Number) as [number, number, number]
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0)
}

export default async function TurmaPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string; id: string }>
  searchParams: Promise<{ editar?: string }>
}) {
  const { empresa: slug, id } = await params
  const q = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'escola.ver' })
  if (!moduloLigado(empresa, 'escola')) semAcesso(slug, 'modulo-escola')
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const t = await acharTurma(sessao, id)
  if (!t) notFound()
  const voc = await vocabularioDaEmpresa(sessao.orgId)
  const hoje = diaEmSP()

  const podeGerir = pode(sessao, 'escola.gerir', t.unidadeId)
  const podeMatricular = pode(sessao, 'escola.matricular', t.unidadeId)
  const verMensalidade = pode(sessao, 'mensalidade.ver', t.unidadeId)
  const editando = podeGerir && q.editar === '1'
  const lojas = editando
    ? (await unidadesVisiveis(sessao, 'escola.gerir')).filter((u) => !u.ehDeposito).map((u) => ({ id: u.id, nome: u.nome }))
    : []
  // Das unidades do formulário (a turma sem aluno ainda troca de unidade):
  // a lista acompanha a unidade escolhida nele.
  const professores = editando ? await professoresDasUnidades(sessao, [...new Set([t.unidadeId, ...lojas.map((l) => l.id)])]) : []

  const ativos = t.alunos.filter((a) => a.situacao === 'ATIVA')
  const trancados = t.alunos.filter((a) => a.situacao === 'TRANCADA')
  const bolsistas = ativos.filter((a) => a.desconto > 0).length
  const receitaMes = ativos.reduce((s, a) => s + Math.max(0, a.valor - a.desconto), 0)
  const cheia = t.capacidade !== null && t.ocupadas >= t.capacidade

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/turmas`}
      tema={tema}
      titulo={t.nome}
      acao={
        <span className="flex flex-wrap items-center gap-2">
          {podeGerir && !editando && (
            <Link href={`/${slug}/turmas/${t.id}?editar=1`} className="rounded-norte border border-borda px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2">
              Editar turma
            </Link>
          )}
          {verMensalidade && (
            <Link href={`/${slug}/mensalidades?turma=${t.id}`} className="rounded-norte border border-borda px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2">
              Mensalidades da turma
            </Link>
          )}
        </span>
      }
    >
      <Secao
        titulo={[t.curso, t.turno ? TURNOS[t.turno as keyof typeof TURNOS] : null].filter(Boolean).join(' · ') || 'A turma'}
        resumo={[horarioDaTurma(t), t.professor ? `com ${t.professor}` : null, t.unidade].filter(Boolean).join(' · ')}
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            principal
            rotulo={voc.Pessoas}
            valor={t.capacidade !== null ? `${t.ocupadas} de ${t.capacidade}` : String(t.ocupadas)}
            detalhe={`${ativos.length} ${ativos.length === 1 ? 'ativo' : 'ativos'}${trancados.length ? ` · ${trancados.length} ${trancados.length === 1 ? 'trancado' : 'trancados'}` : ''}`}
            nivel={cheia ? 'critico' : quaseCheia(t.ocupadas, t.capacidade) ? 'atencao' : undefined}
          />
          <Numero rotulo="Vagas" valor={t.vagas === null ? 'sem limite' : String(t.vagas)} detalhe={cheia ? 'cheia' : undefined} />
          <Numero rotulo="Mensalidade da turma" valor={brl(t.mensalidade)} detalhe={`vence dia ${t.diaVencimento}`} />
          {verMensalidade && (
            <Numero
              rotulo="O mês da turma"
              valor={brl(receitaMes)}
              detalhe={bolsistas ? `${bolsistas} com bolsa ou desconto` : 'ninguém com bolsa'}
            />
          )}
        </div>
        {(t.inicio || t.fim) && (
          <p className="text-sm text-tinta-2">
            Período: {t.inicio ? mostrarDiaDaColuna(t.inicio, 'longo') : '—'} a {t.fim ? mostrarDiaDaColuna(t.fim, 'longo') : 'sem fim marcado'}
            {!t.ativa && ' · turma encerrada'}
          </p>
        )}

        {editando && (
          <TurmaForm
            slug={slug}
            lojas={lojas}
            professores={professores}
            voltarPara={`/${slug}/turmas/${t.id}`}
            inicial={{
              id: t.id,
              unidadeId: t.unidadeId,
              nome: t.nome,
              curso: t.curso,
              turno: t.turno,
              professorId: t.professorId,
              dias: t.dias,
              horaInicio: t.horaInicio,
              horaFim: t.horaFim,
              capacidade: t.capacidade,
              inicio: t.inicio ? diaDaColuna(t.inicio) : null,
              fim: t.fim ? diaDaColuna(t.fim) : null,
              mensalidade: t.mensalidade,
              diaVencimento: t.diaVencimento,
              ativa: t.ativa,
            }}
          />
        )}

        {podeMatricular && t.ativa && <Matricular slug={slug} turmaId={t.id} hoje={hoje} palavra={{ pessoa: voc.pessoa, novo: voc.novo }} />}

        <Tabela
          colunas={[
            {
              chave: 'aluno',
              titulo: voc.Pessoa,
              celula: (a: AlunoDaTurma) => (
                <span className="flex flex-col">
                  <Link href={`/${slug}/clientes/${a.alunoId}`} className="font-medium text-tinta underline-offset-2 hover:underline">
                    {a.nome}
                  </Link>
                  <span className="text-xs text-tinta-3">
                    {idade(a.nascimento, hoje) !== null ? `${idade(a.nascimento, hoje)} anos · ` : ''}
                    desde {mostrarDiaDaColuna(a.inicio, 'curto')}
                  </span>
                </span>
              ),
            },
            {
              chave: 'resp',
              titulo: 'Responsável',
              celula: (a: AlunoDaTurma) =>
                a.responsavel ? (
                  <span className="flex flex-col">
                    <span className="text-sm text-tinta">{a.responsavel}</span>
                    <span className="text-xs text-tinta-3">{mostrarTelefone(a.telefoneResponsavel) || 'sem telefone'}</span>
                  </span>
                ) : (
                  <BotaoDaLinha
                    comRotulo
                    href={`/${slug}/clientes/${a.alunoId}#escola`}
                    icone="editar"
                    rotulo="Anotar o responsável"
                    dica={`Anotar o responsável de ${a.nome}`}
                  />
                ),
            },
            ...(verMensalidade
              ? [
                  {
                    chave: 'valor',
                    titulo: 'Mensalidade',
                    numero: true,
                    largura: '9rem',
                    celula: (a: AlunoDaTurma) => (
                      <span className="flex flex-col items-end">
                        <span className="numero text-tinta">{brl(Math.max(0, a.valor - a.desconto))}</span>
                        {a.desconto > 0 && (
                          <span className="text-xs text-tinta-3" title={a.descontoMotivo ?? undefined}>
                            de {brl(a.valor)} · {a.descontoMotivo ?? 'desconto'}
                          </span>
                        )}
                      </span>
                    ),
                  },
                ]
              : []),
            {
              chave: 'sit',
              titulo: 'Situação',
              largura: '9rem',
              celula: (a: AlunoDaTurma) => (
                <span className="flex flex-col gap-0.5">
                  <Situacao nivel={NIVEL_MATRICULA[a.situacao]}>{ROTULO_MATRICULA[a.situacao]}</Situacao>
                  {a.motivoSaida && <span className="text-xs text-tinta-3">{a.motivoSaida}</span>}
                  {a.fim && <span className="text-xs text-tinta-3">até {mostrarDiaDaColuna(a.fim, 'curto')}</span>}
                </span>
              ),
            },
            ...(podeMatricular || podeGerir
              ? [
                  {
                    chave: 'acoes',
                    titulo: '',
                    celula: (a: AlunoDaTurma) => (
                      <MatriculaAcoes
                        slug={slug}
                        matriculaId={a.matriculaId}
                        situacao={a.situacao}
                        podeMatricular={podeMatricular}
                        podeGerir={podeGerir}
                        valor={a.valor}
                        diaVencimento={a.diaVencimento}
                        descontoPct={a.descontoPct}
                        descontoValor={a.descontoValor}
                        descontoMotivo={a.descontoMotivo}
                      />
                    ),
                  },
                ]
              : []),
          ]}
          linhas={t.alunos}
          chave={(a) => a.matriculaId}
          vazio={podeMatricular ? `Ninguém matriculado ainda. "+ Matricular" e procure o ${voc.pessoa} pelo nome.` : 'Ninguém matriculado ainda.'}
        />
        <p className={cx('text-xs text-tinta-3')}>
          Mensagem da escola vai para o responsável, nunca para o {voc.pessoa}: o aviso da mensalidade sai para o telefone dele, e só com o aceite dele.
        </p>
      </Secao>
    </Estrutura>
  )
}
