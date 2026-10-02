import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { pode } from '@/servidor/permissao'
import { moduloLigado } from '@/servidor/modulos'
import { escolherUnidade } from '@/servidor/unidade'
import { horarioDaTurma, listarTurmas, professoresDasUnidades, quaseCheia, TURNOS, type TurmaNaLista } from '@/servidor/escola'
import { vocabularioDaEmpresa } from '@/servidor/vocabulario'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Tabela } from '@/ui/Tabela'
import { Fichas, enderecoCom } from '@/ui/Busca'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Numero, Secao, brl } from '@/ui/painel'
import { Situacao, cx } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { TurmaForm } from './TurmaForm'

export const metadata: Metadata = { title: 'Turmas' }

// As turmas da escola: quem está em cada uma e quantas vagas sobram.
//
// A pergunta de quem abre é "cabe mais um nessa turma?" — então a vaga vem
// na frente, com a cor dizendo o aperto: amarelo quase cheia, vermelho cheia.
// O aluno é a ficha de Alunos (Clientes, com a palavra do ramo); matricular é
// dentro da turma.

export default async function Turmas({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; ver?: string }>
}) {
  const { empresa: slug } = await params
  const q = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'escola.ver' })
  if (!moduloLigado(empresa, 'escola')) semAcesso(slug, 'modulo-escola')
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const onde = await escolherUnidade(sessao, empresa, q.unidade, 'escola.ver')
  const todas = q.ver === 'todas'
  const turmas = await listarTurmas(sessao, { unidadeIds: onde.ids, todas })
  const voc = await vocabularioDaEmpresa(sessao.orgId)

  const lojasDeGerir = onde.opcoes.filter((u) => !u.ehDeposito && pode(sessao, 'escola.gerir', u.id)).map((u) => ({ id: u.id, nome: u.nome }))
  // De TODAS as unidades que a pessoa gere: o formulário mostra os da
  // unidade escolhida nele (antes vinham só os da primeira).
  const professores = await professoresDasUnidades(sessao, lojasDeGerir.map((l) => l.id))

  const ativas = turmas.filter((t) => t.ativa)
  const alunos = ativas.reduce((s, t) => s + t.ativas, 0)
  const vagas = ativas.reduce((s, t) => s + (t.vagas ?? 0), 0)
  const semLimite = ativas.some((t) => t.capacidade === null)
  const cheias = ativas.filter((t) => t.capacidade !== null && t.ocupadas >= t.capacidade).length
  const apertadas = ativas.filter((t) => quaseCheia(t.ocupadas, t.capacidade)).length

  const atuais = { unidade: onde.unidadeId, ver: q.ver ?? null }
  const link = (m: Record<string, string | null>) => enderecoCom(`/${slug}/turmas`, atuais, m)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/turmas`}
      tema={tema}
      titulo="Turmas"
      acao={onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} /> : undefined}
    >
      <Secao titulo={`Turmas · ${onde.titulo}`}>
        <div className="grid gap-2 sm:grid-cols-3">
          <Numero principal rotulo="Turmas em andamento" valor={String(ativas.length)} detalhe={`${alunos} ${alunos === 1 ? voc.pessoa + ' ativo' : voc.pessoas + ' ativos'}`} />
          <Numero rotulo="Vagas sobrando" valor={semLimite && vagas === 0 ? 'sem limite' : String(vagas)} detalhe={semLimite ? 'turma sem capacidade não conta' : undefined} />
          <Numero
            rotulo="Quase cheias"
            valor={String(apertadas)}
            detalhe={cheias > 0 ? `${cheias} ${cheias === 1 ? 'cheia' : 'cheias'}` : 'nenhuma cheia'}
            nivel={cheias > 0 ? 'critico' : apertadas > 0 ? 'atencao' : undefined}
          />
        </div>

        {lojasDeGerir.length > 0 && <TurmaForm slug={slug} lojas={lojasDeGerir} professores={professores} />}

        <Fichas
          opcoes={[
            { valor: null, rotulo: 'em andamento' },
            { valor: 'todas', rotulo: 'todas, com as encerradas' },
          ]}
          atual={todas ? 'todas' : null}
          linkDe={(v) => link({ ver: v })}
        />

        <Tabela
          colunas={[
            {
              chave: 'turma',
              titulo: 'Turma',
              celula: (t: TurmaNaLista) => (
                <span className="flex flex-col">
                  <Link href={`/${slug}/turmas/${t.id}`} className="font-medium text-tinta underline-offset-2 hover:underline">
                    {t.nome}
                  </Link>
                  <span className="text-xs text-tinta-3">
                    {[t.curso, t.turno ? TURNOS[t.turno as keyof typeof TURNOS] : null, onde.opcoes.length > 1 ? t.unidade : null].filter(Boolean).join(' · ') || '—'}
                  </span>
                </span>
              ),
            },
            {
              chave: 'horario',
              titulo: 'Quando',
              celula: (t: TurmaNaLista) => <span className="text-sm text-tinta-2">{horarioDaTurma(t) || '—'}</span>,
            },
            {
              chave: 'prof',
              titulo: 'Quem dá aula',
              celula: (t: TurmaNaLista) => <span className="text-sm text-tinta-2">{t.professor ?? '—'}</span>,
            },
            {
              chave: 'vagas',
              titulo: 'Alunos',
              largura: '9rem',
              celula: (t: TurmaNaLista) => (
                <span className="flex flex-col">
                  <span className={cx('numero font-semibold', t.capacidade !== null && t.ocupadas >= t.capacidade ? 'text-critico' : quaseCheia(t.ocupadas, t.capacidade) ? 'text-atencao' : 'text-tinta')}>
                    {t.ocupadas}
                    {t.capacidade !== null ? ` de ${t.capacidade}` : ''}
                  </span>
                  <span className="text-xs text-tinta-3">
                    {t.capacidade === null ? 'sem limite' : t.vagas === 0 ? 'cheia' : `${t.vagas} ${t.vagas === 1 ? 'vaga' : 'vagas'}`}
                  </span>
                </span>
              ),
            },
            {
              chave: 'mensalidade',
              titulo: 'Mensalidade',
              numero: true,
              largura: '8rem',
              celula: (t: TurmaNaLista) => (
                <span className="flex flex-col items-end">
                  <span className="numero text-tinta">{brl(t.mensalidade)}</span>
                  <span className="text-xs text-tinta-3">vence dia {t.diaVencimento}</span>
                </span>
              ),
            },
            {
              chave: 'situacao',
              titulo: '',
              largura: '7rem',
              celula: (t: TurmaNaLista) => (t.ativa ? null : <Situacao nivel="neutro">encerrada</Situacao>),
            },
          ]}
          linhas={turmas}
          chave={(t) => t.id}
          vazio={
            lojasDeGerir.length > 0
              ? 'Nenhuma turma ainda. Crie a primeira em "+ Nova turma" — depois é só matricular.'
              : 'Nenhuma turma ainda. Quem gere a escola cria as turmas.'
          }
        />
      </Secao>
    </Estrutura>
  )
}
