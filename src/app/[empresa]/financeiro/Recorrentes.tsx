'use client'

// As contas que se repetem todo mês: cadastrar, mudar, pausar.
//
// A lista mostra o que o sistema vai lançar sozinho — dia, valor, até quando
// — e o formulário nasce fechado, como o de "Lançar conta": cadastrar
// recorrente é coisa de uma vez por conta, não de todo dia.

import { startTransition, useActionState, useEffect, useState, useTransition } from 'react'
import { Aviso, Botao, Campo, Cartao, Selecao, Situacao, cx } from '@/ui/base'
import { brl } from '@/ui/painel'
import { alternarRecorrenteAcao, salvarRecorrenteAcao, type EstadoRecorrente } from './acoes'

export type RecorrenteNaTela = {
  id: string
  descricao: string
  categoriaId: string
  categoria: string
  tipo: 'RECEITA' | 'DESPESA'
  valor: number
  diaVencimento: number
  fornecedor: string | null
  unidadeId: string | null
  unidadeNome: string | null
  ativo: boolean
  /** "AAAA-MM-DD" */
  ateEm: string | null
  gerados: number
}

const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export function Recorrentes({
  slug,
  lista,
  categorias,
  lojas,
  lojaAtual,
  podeLancar,
}: {
  slug: string
  lista: RecorrenteNaTela[]
  categorias: { id: string; nome: string; tipo: string }[]
  /** Lojas onde se pode pôr a conta. Vazio = a empresa tem uma loja só, e o campo some. */
  lojas: { id: string; nome: string }[]
  lojaAtual: string | null
  podeLancar: boolean
}) {
  const [editando, setEditando] = useState<RecorrenteNaTela | 'nova' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()

  const ativas = lista.filter((r) => r.ativo)
  const totalMes = ativas.filter((r) => r.tipo === 'DESPESA').reduce((s, r) => s + r.valor, 0)

  function alternar(r: RecorrenteNaTela) {
    setErro(null)
    comecar(async () => {
      const res = await alternarRecorrenteAcao(slug, r.id, !r.ativo)
      if (res.erro) setErro(res.erro)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {erro && <Aviso nivel="critico">{erro}</Aviso>}

      <Cartao
        titulo={`${ativas.length} conta${ativas.length === 1 ? '' : 's'} que se repete${ativas.length === 1 ? '' : 'm'}`}
        acao={
          totalMes > 0 ? (
            <span className="text-xs text-tinta-3">
              por mês <b className="numero text-tinta-2">{brl(totalMes)}</b>
            </span>
          ) : undefined
        }
      >
        {lista.length === 0 ? (
          <p className="py-4 text-sm text-tinta-2">
            Aluguel, internet, contador: cadastre uma vez e o sistema lança todo mês, no dia certo, como conta a pagar.
          </p>
        ) : (
          <ul className="flex flex-col">
            {lista.map((r) => (
              <li
                key={r.id}
                className={cx(
                  'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-borda-suave py-2 last:border-0',
                  !r.ativo && 'opacity-70',
                )}
              >
                {/* min-w de verdade: sem ele, no celular o valor e os botões
                    espremiam a descrição numa coluna de uma palavra por linha.
                    Com ele, a linha quebra e os botões descem. */}
                <span className="flex min-w-[14rem] flex-1 flex-col">
                  <span className="truncate text-sm text-tinta">
                    <span aria-hidden className="mr-1 text-tinta-3">↻</span>
                    {r.descricao}
                  </span>
                  <span className="text-xs text-tinta-3">
                    todo dia {r.diaVencimento} · {r.categoria}
                    {r.fornecedor ? ` · ${r.fornecedor}` : ''}
                    {r.unidadeNome ? ` · ${r.unidadeNome}` : lojas.length > 1 ? ' · empresa inteira' : ''}
                    {r.ateEm ? ` · até ${dataCurta(r.ateEm)}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  {r.ativo ? (
                    <Situacao nivel="bom">ativa</Situacao>
                  ) : (
                    <Situacao nivel="neutro">pausada</Situacao>
                  )}
                  <span className={cx('numero w-24 text-right text-sm font-semibold', r.tipo === 'RECEITA' ? 'text-bom' : 'text-tinta')}>
                    {r.tipo === 'RECEITA' ? '+ ' : ''}
                    {brl(r.valor)}
                  </span>
                  {podeLancar && (
                    <>
                      <Botao tom="discreto" className="px-2 py-1 text-xs" onClick={() => setEditando(r)}>
                        Mudar
                      </Botao>
                      <Botao tom="secundario" className="px-2 py-1 text-xs" carregando={indo} onClick={() => alternar(r)}>
                        {r.ativo ? 'Pausar' : 'Retomar'}
                      </Botao>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      {podeLancar &&
        (editando ? (
          <FormRecorrente
            key={editando === 'nova' ? 'nova' : editando.id}
            slug={slug}
            inicial={editando === 'nova' ? null : editando}
            categorias={categorias}
            lojas={lojas}
            lojaAtual={lojaAtual}
            aoFechar={() => setEditando(null)}
          />
        ) : (
          <div>
            <Botao tom="secundario" onClick={() => setEditando('nova')}>
              + Conta que se repete
            </Botao>
          </div>
        ))}
    </div>
  )
}

function FormRecorrente({
  slug,
  inicial,
  categorias,
  lojas,
  lojaAtual,
  aoFechar,
}: {
  slug: string
  inicial: RecorrenteNaTela | null
  categorias: { id: string; nome: string; tipo: string }[]
  lojas: { id: string; nome: string }[]
  lojaAtual: string | null
  aoFechar: () => void
}) {
  const acao = salvarRecorrenteAcao.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoRecorrente, FormData>(acao, {})
  const [tipo, setTipo] = useState<'DESPESA' | 'RECEITA'>(inicial?.tipo ?? 'DESPESA')

  // Salvou: fecha. `vez` muda a cada resposta, então isto roda uma vez por envio.
  useEffect(() => {
    if (estado.ok) aoFechar()
  }, [estado.vez, estado.ok, aoFechar])

  const doTipo = categorias.filter((c) => c.tipo === tipo)

  return (
    <Cartao
      caixa
      titulo={inicial ? `Mudar: ${inicial.descricao}` : 'Conta que se repete todo mês'}
      acao={
        <button type="button" onClick={aoFechar} className="text-xs text-tinta-3 hover:text-tinta">
          fechar
        </button>
      }
    >
      {categorias.length === 0 ? (
        <Aviso nivel="atencao">Ainda não há categorias no financeiro. Recarregue a tela para criar as padrão.</Aviso>
      ) : (
        <form
          onSubmit={(ev) => {
            ev.preventDefault()
            const dados = new FormData(ev.currentTarget)
            startTransition(() => agir(dados))
          }}
          className="flex flex-col gap-4"
        >
          {inicial && <input type="hidden" name="id" value={inicial.id} />}
          {inicial && <input type="hidden" name="ativo" value={inicial.ativo ? '1' : '0'} />}
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
                {t === 'DESPESA' ? 'Conta a pagar' : 'Receita que se repete'}
              </Botao>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="O que é" name="descricao" required defaultValue={inicial?.descricao} placeholder="Aluguel da loja" />
            <Selecao
              key={tipo}
              rotulo="Categoria"
              name="categoriaId"
              required
              defaultValue={inicial && inicial.tipo === tipo ? inicial.categoriaId : ''}
              opcoes={[{ valor: '', titulo: 'Escolha...' }, ...doTipo.map((c) => ({ valor: c.id, titulo: c.nome }))]}
              dica="É ela que decide a linha do resultado do mês."
            />
            <Campo
              rotulo="Valor"
              name="valor"
              inputMode="decimal"
              required
              defaultValue={inicial ? inicial.valor.toFixed(2).replace('.', ',') : undefined}
              placeholder="0,00"
            />
            <Campo
              rotulo="Dia do vencimento"
              name="diaVencimento"
              type="number"
              min={1}
              max={31}
              step={1}
              required
              defaultValue={inicial?.diaVencimento ?? 10}
              dica="31 em mês curto cai no último dia (28 ou 29 em fevereiro, 30 em abril)."
            />
            <Campo rotulo="Fornecedor" name="fornecedor" defaultValue={inicial?.fornecedor ?? undefined} placeholder="Opcional" />
            <Campo
              rotulo="Até quando"
              name="ateEm"
              type="date"
              defaultValue={inicial?.ateEm ?? undefined}
              dica="Vazio = para sempre. Serve para financiamento e contrato com fim."
            />
            {lojas.length > 1 && (
              <Selecao
                rotulo="Loja"
                name="unidadeId"
                defaultValue={inicial ? (inicial.unidadeId ?? '') : (lojaAtual ?? '')}
                opcoes={[{ valor: '', titulo: 'Empresa inteira' }, ...lojas.map((l) => ({ valor: l.id, titulo: l.nome }))]}
              />
            )}
            {lojas.length === 1 && <input type="hidden" name="unidadeId" value={lojas[0]!.id} />}
          </div>

          <p className="text-xs text-tinta-3">
            {inicial
              ? 'Mudar aqui acerta também os lançamentos desta conta que ainda estão em aberto, de hoje em diante. O que já foi pago fica como está.'
              : 'O lançamento de cada mês nasce sozinho, em aberto, ao abrir o Financeiro: o deste mês e o do próximo. Vencimento que já passou não é criado — esse, se ainda não foi pago, lance à mão.'}
          </p>

          <div className="flex justify-end">
            <Botao type="submit" carregando={pendente}>
              {pendente ? 'Salvando...' : inicial ? 'Salvar mudanças' : 'Cadastrar'}
            </Botao>
          </div>
        </form>
      )}
    </Cartao>
  )
}
