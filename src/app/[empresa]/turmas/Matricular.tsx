'use client'

// Matricular: achar o aluno no cadastro e pôr na turma.
//
// O aluno é a ficha de Alunos de sempre — quem ainda não tem ficha é
// cadastrado lá antes (só o nome basta). O valor e o vencimento vêm da
// turma: preço diferente e bolsa são de quem gere a escola, depois, em
// "Valor e bolsa". Turma cheia não trava a secretaria: pergunta "é isso mesmo".

import { useActionState, useEffect, useRef, useState } from 'react'
import { Aviso, Botao, Campo, Cartao, Marcar } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import { BotaoDaLinha, DicaDaAcao, IconeDaAcao, classeDaAcao } from '@/ui/premium'
import { buscarAlunosAcao, matricularAcao, type EstadoEscola } from './acoes'

type Achado = { id: string; nome: string; nascimento: string | null }

const idade = (nascimento: string | null, hoje: string) => {
  if (!nascimento) return null
  const [a, m, d] = nascimento.split('-').map(Number) as [number, number, number]
  const [ha, hm, hd] = hoje.split('-').map(Number) as [number, number, number]
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0)
}

export function Matricular({
  slug,
  turmaId,
  hoje,
  palavra,
}: {
  slug: string
  turmaId: string
  /** "AAAA-MM-DD" em São Paulo — o início padrão. */
  hoje: string
  /** "aluno", "paciente"… — a palavra do ramo. */
  palavra: { pessoa: string; novo: string }
}) {
  const [aberto, setAberto] = useState(false)
  const acao = matricularAcao.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoEscola, FormData>(acao, {})
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<Achado[]>([])
  const [aluno, setAluno] = useState<Achado | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset()
      setAluno(null)
      setTermo('')
    }
  }, [estado.vez, estado.ok])

  useEffect(() => {
    if (aluno || termo.trim().length < 2) {
      setAchados([])
      return
    }
    const t = setTimeout(() => {
      buscarAlunosAcao(slug, termo).then(setAchados).catch(() => setAchados([]))
    }, 250)
    return () => clearTimeout(t)
  }, [termo, aluno, slug])

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Botao onClick={() => setAberto(true)}>+ Matricular</Botao>
        {estado.ok && <span className="text-sm font-medium text-bom">{estado.ok}</span>}
      </div>
    )
  }

  return (
    <Cartao
      caixa
      titulo="Matricular nesta turma"
      acao={
        <button type="button" onClick={() => setAberto(false)} className={classeDaAcao()} aria-label="Fechar">
          <IconeDaAcao icone="fechar" />
          <DicaDaAcao>Fechar</DicaDaAcao>
        </button>
      }
    >
      <form ref={formRef} action={agir} onSubmit={semApagar(agir)} className="flex flex-col gap-4">
        <input type="hidden" name="turmaId" value={turmaId} />
        <input type="hidden" name="alunoId" value={aluno?.id ?? ''} />
        {estado.erro && <Aviso nivel={estado.pedeConfirmacao ? 'atencao' : 'critico'}>{estado.erro}</Aviso>}
        {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

        {aluno ? (
          <div className="flex items-center justify-between gap-3 rounded-norte border border-marca bg-marca-suave px-3 py-2 text-sm">
            <span>
              <b className="text-tinta">{aluno.nome}</b>
              {idade(aluno.nascimento, hoje) !== null && <span className="text-tinta-3"> · {idade(aluno.nascimento, hoje)} anos</span>}
            </span>
            <button type="button" onClick={() => setAluno(null)} className={classeDaAcao()} aria-label={`Trocar ${aluno.nome} por outra pessoa`}>
              <IconeDaAcao icone="trocar" />
              <DicaDaAcao>Trocar</DicaDaAcao>
            </button>
          </div>
        ) : (
          <div className="relative flex flex-col gap-1.5">
            <Campo
              rotulo={`Qual ${palavra.pessoa}?`}
              name="busca"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder="Comece a digitar o nome"
              autoComplete="off"
              dica={`Ainda não tem ficha? Cadastre em ${palavra.novo} (só o nome basta) e volte aqui.`}
            />
            {achados.length > 0 && (
              <ul role="listbox" className="absolute top-[4.5rem] z-10 w-full overflow-hidden rounded-norte border border-borda bg-superficie shadow-lg">
                {achados.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        setAluno(a)
                        setAchados([])
                      }}
                      className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-superficie-2"
                    >
                      <span className="font-medium text-tinta">{a.nome}</span>
                      {idade(a.nascimento, hoje) !== null && <span className="text-xs text-tinta-3">{idade(a.nascimento, hoje)} anos</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <span className="self-start">
              <BotaoDaLinha comRotulo href={`/${slug}/clientes/novo`} icone="mais" rotulo={palavra.novo} />
            </span>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Começa em" name="inicio" type="date" defaultValue={hoje} dica="A mensalidade deste mês e a do próximo nascem junto." />
        </div>

        {estado.pedeConfirmacao && <Marcar name="confirmar" titulo="É isso mesmo" resumo="Matricular mesmo com a turma cheia." />}

        <div className="flex justify-end">
          <Botao type="submit" carregando={pendente} disabled={!aluno}>
            {pendente ? 'Matriculando...' : 'Matricular'}
          </Botao>
        </div>
      </form>
    </Cartao>
  )
}
