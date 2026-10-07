'use client'

// Lançar uma conta e dar baixa.
//
// O formulário nasce FECHADO. A tela do financeiro é para conferir o que
// vence e o que sobrou; lançar é o que se faz de vez em quando. Formulário
// grande aberto o tempo todo empurra a informação para baixo da dobra, e a
// pessoa passa a rolar todo dia para ver o que já devia estar na cara dela.

import { useActionState, useEffect, useRef, useState } from 'react'
import { Botao, Campo, Selecao, Marcar, Aviso, Cartao } from '@/ui/base'
import { desfazerPagamento, novoLancamento, pagar, type EstadoLanc } from './acoes'
import { semApagar } from '@/ui/formulario'
import { Confirmar } from '@/ui/Confirmar'
import { DicaDaAcao, IconeDaAcao, classeDaAcao } from '@/ui/premium'

export function Lancar({
  slug,
  categorias,
  contas,
  unidadeId,
  lojas,
  hoje,
}: {
  slug: string
  categorias: { id: string; nome: string; tipo: string }[]
  contas: { id: string; nome: string }[]
  unidadeId: string | null
  /**
   * Quando vem, a pessoa escolhe a loja do lançamento: ela olha o conjunto
   * das lojas dela e não lança na empresa inteira (conta "sem loja" é da
   * empresa, e isso só quem alcança a empresa lança).
   */
  lojas?: { id: string; nome: string }[]
  /**
   * O dia de hoje em São Paulo, vindo do servidor. Era
   * `new Date().toISOString()`, que é o dia em UTC: depois das 21h o
   * vencimento já nascia com a data de amanhã.
   */
  hoje: string
}) {
  const [aberto, setAberto] = useState(false)
  const [tipo, setTipo] = useState<'DESPESA' | 'RECEITA'>('DESPESA')

  const acao = novoLancamento.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoLanc, FormData>(acao, {})
  // Lançou: o formulário limpa para a próxima conta (a tela de lançar é de
  // várias em seguida). Com erro, NÃO limpa — ver src/ui/formulario.ts.
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (estado.ok) formRef.current?.reset()
  }, [estado])

  const doTipo = categorias.filter((c) => c.tipo === tipo)

  if (!aberto) {
    return (
      <div className="flex items-center gap-3">
        <Botao tom="secundario" onClick={() => setAberto(true)}>
          + Lançar conta
        </Botao>
        {estado.ok && <span className="text-sm font-medium text-bom">{estado.ok}</span>}
      </div>
    )
  }

  return (
    <Cartao
      titulo="Lançar"
      acao={
        <button type="button" onClick={() => setAberto(false)} className={classeDaAcao()} aria-label="Fechar">
          <IconeDaAcao icone="fechar" />
          <DicaDaAcao>Fechar</DicaDaAcao>
        </button>
      }
    >
      <form ref={formRef} action={agir} onSubmit={semApagar(agir)} className="flex flex-col gap-4">
        {!lojas?.length && <input type="hidden" name="unidadeId" value={unidadeId ?? ''} />}
        <input type="hidden" name="tipo" value={tipo} />

        {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

        <div className="flex gap-1.5">
          {(['DESPESA', 'RECEITA'] as const).map((t) => (
            <Botao
              key={t}
              type="button"
              tom={tipo === t ? 'principal' : 'secundario'}
              onClick={() => setTipo(t)}
              className="flex-1 py-1.5 text-xs"
            >
              {t === 'DESPESA' ? 'Conta a pagar' : 'Receita'}
            </Botao>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="O que é" name="descricao" required placeholder="Aluguel de outubro" />
          <Selecao
            rotulo="Categoria"
            name="categoriaId"
            required
            opcoes={[
              { valor: '', titulo: 'Escolha...' },
              ...doTipo.map((c) => ({ valor: c.id, titulo: c.nome })),
            ]}
            dica="É ela que decide onde a conta aparece no resultado do mês."
          />
          <Campo rotulo="Valor" name="valor" type="number" step={0.01} min={0} required placeholder="0,00" />
          <Campo rotulo="Vencimento" name="vencimento" type="date" required defaultValue={hoje} />
          {!!lojas?.length && (
            <Selecao
              rotulo="Loja"
              name="unidadeId"
              required
              opcoes={[{ valor: '', titulo: 'Escolha...' }, ...lojas.map((l) => ({ valor: l.id, titulo: l.nome }))]}
            />
          )}
          <Campo rotulo="Fornecedor" name="fornecedor" placeholder="Opcional" />
          <Selecao
            rotulo="Saiu de onde"
            name="contaId"
            opcoes={[{ valor: '', titulo: 'Não informar' }, ...contas.map((c) => ({ valor: c.id, titulo: c.nome }))]}
          />
        </div>

        <Marcar
          name="jaPago"
          titulo="Já foi pago"
          resumo="Marque se o dinheiro já saiu. Sem isto, entra como conta a pagar."
        />

        <div className="flex justify-end">
          <Botao type="submit" tom="confirmar" carregando={pendente}>
            {pendente ? 'Lançando...' : 'Lançar'}
          </Botao>
        </div>
      </form>
    </Cartao>
  )
}

// Pergunta antes, e pergunta O DIA: a conta paga no sábado e marcada na
// segunda entra no dia em que o dinheiro saiu — é por ele que o resultado do
// mês conta. Hoje vem escolhido. Ver src/ui/Confirmar.tsx.
export function Pagar({ slug, id, hoje }: { slug: string; id: string; hoje: string }) {
  const [dia, setDia] = useState(hoje)
  return (
    <Confirmar
      tom="confirmar"
      tomSim="confirmar"
      pergunta={
        <label className="inline-flex items-center gap-1.5">
          Pago em
          <input
            type="date"
            value={dia}
            max={hoje}
            required
            onChange={(e) => setDia(e.target.value)}
            className="rounded-norte border border-borda bg-superficie px-1.5 py-0.5 text-xs text-tinta"
          />
        </label>
      }
      sim="Sim, paguei"
      aoConfirmar={() => pagar(slug, id, dia)}
      className="px-2 py-1 text-xs"
    >
      Paguei
    </Confirmar>
  )
}

// A baixa se desfaz: um toque na conta errada não fica para sempre. A conta
// volta para "em aberto", e o livro (auditoria) guarda quem desfez.
export function DesfazerPagamento({ slug, id }: { slug: string; id: string }) {
  return (
    <Confirmar
      tom="discreto"
      tomSim="perigo"
      pergunta="Desfazer a baixa?"
      sim="Sim, desfazer"
      aoConfirmar={() => desfazerPagamento(slug, id)}
      className="px-2 py-1 text-xs"
      title="A conta volta para em aberto"
    >
      desfazer
    </Confirmar>
  )
}
