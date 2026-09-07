'use client'

// Lançar uma conta e dar baixa.
//
// O formulário nasce FECHADO. A tela do financeiro é para conferir o que
// vence e o que sobrou; lançar é o que se faz de vez em quando. Formulário
// grande aberto o tempo todo empurra a informação para baixo da dobra, e a
// pessoa passa a rolar todo dia para ver o que já devia estar na cara dela.

import { useActionState, useState, useTransition } from 'react'
import { Botao, Campo, Selecao, Marcar, Aviso, Cartao } from '@/ui/base'
import { novoLancamento, pagar, type EstadoLanc } from './acoes'

const hojeISO = () => new Date().toISOString().slice(0, 10)

export function Lancar({
  slug,
  categorias,
  contas,
  unidadeId,
}: {
  slug: string
  categorias: { id: string; nome: string; tipo: string }[]
  contas: { id: string; nome: string }[]
  unidadeId: string | null
}) {
  const [aberto, setAberto] = useState(false)
  const [tipo, setTipo] = useState<'DESPESA' | 'RECEITA'>('DESPESA')

  const acao = novoLancamento.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoLanc, FormData>(acao, {})

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
        <button
          type="button"
          onClick={() => setAberto(false)}
          className="text-xs text-tinta-3 hover:text-tinta"
        >
          fechar
        </button>
      }
    >
      <form action={agir} className="flex flex-col gap-4">
        <input type="hidden" name="unidadeId" value={unidadeId ?? ''} />
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
          <Campo rotulo="Vencimento" name="vencimento" type="date" required defaultValue={hojeISO()} />
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

export function Pagar({ slug, id }: { slug: string; id: string }) {
  const [indo, comecar] = useTransition()
  return (
    <Botao
      tom="confirmar"
      carregando={indo}
      onClick={() => comecar(() => pagar(slug, id))}
      className="px-2 py-1 text-xs"
    >
      Paguei
    </Botao>
  )
}
