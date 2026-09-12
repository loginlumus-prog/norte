import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { unidadesVisiveis } from '@/servidor/unidade'
import { montarFechamento } from '@/servidor/fechamento'
import { mesChave, mesValido } from '@/servidor/metas'
import { moduloLigado } from '@/servidor/modulos'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, cx } from '@/ui/base'
import { Numero, Secao, brl } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'

// O fechamento de mês.
//
// A ordem das linhas é a ordem em que o erro acontece na loja: primeiro o
// caixa (o dinheiro entra), depois a gaveta (ele é conferido), depois as
// contas (ele sai), depois a taxa (alguém desconta antes de depositar), e
// por último o resultado, que só vale depois que os quatro de cima foram
// resolvidos.
//
// Cada linha diz o número, diz POR QUE ele importa, e leva para onde se
// resolve. Sem o "por que", a lista vira burocracia e a pessoa aprende a
// clicar em tudo sem ler.

const CORES: Record<string, { ponto: string; nivel: 'bom' | 'atencao' | 'critico' }> = {
  ok: { ponto: 'bg-bom-vivo', nivel: 'bom' },
  atencao: { ponto: 'bg-atencao-vivo', nivel: 'atencao' },
  pendente: { ponto: 'bg-critico-vivo', nivel: 'critico' },
}

const ROTULO: Record<string, string> = {
  ok: 'pronto',
  atencao: 'olhe',
  pendente: 'falta',
}

/** O mês anterior ao de hoje: é ele que se fecha, não o que está correndo. */
function mesPassado(): string {
  const d = new Date()
  return mesChave(new Date(d.getFullYear(), d.getMonth() - 1, 1))
}

export default async function FechamentoDoMes({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ mes?: string }>
}) {
  const { empresa: slug } = await params
  const { mes: pedido } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'financeiro.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const mes = mesValido(pedido) ? pedido : mesPassado()
  const unidades = await unidadesVisiveis(sessao, 'financeiro.ver')
  const f = await montarFechamento(
    sessao,
    unidades.map((u) => u.id),
    mes,
    slug,
    moduloLigado(empresa, 'crediario'),
  )

  const [ano, num] = mes.split('-').map(Number)
  const anterior = mesChave(new Date(ano!, num! - 2, 1))
  const seguinte = mesChave(new Date(ano!, num!, 1))
  // Não dá para fechar um mês que ainda não terminou.
  const passouDoFim = seguinte > mesChave(new Date())

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/financeiro`}
      tema={tema}
      titulo={`Fechamento · ${f.titulo}`}
      acao={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Link
            href={`/${slug}/financeiro/fechamento?mes=${anterior}`}
            className="rounded-norte border border-borda px-2.5 py-1.5 text-sm text-tinta-2 hover:bg-superficie-2"
          >
            ← mês anterior
          </Link>
          {!passouDoFim && (
            <Link
              href={`/${slug}/financeiro/fechamento?mes=${seguinte}`}
              className="rounded-norte border border-borda px-2.5 py-1.5 text-sm text-tinta-2 hover:bg-superficie-2"
            >
              mês seguinte →
            </Link>
          )}
          <Link
            href={`/${slug}/financeiro`}
            className="rounded-norte border border-borda px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
          >
            Financeiro
          </Link>
        </div>
      }
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <Numero
          principal
          rotulo={`Resultado de ${f.titulo}`}
          valor={brl(f.dre.resultado)}
          detalhe={f.dre.margem ? `margem de ${f.dre.margem.toFixed(0)}%` : 'sem venda no mês'}
        />
        <Numero
          rotulo="Conferências prontas"
          valor={`${f.prontos} de ${f.itens.length}`}
          detalhe={f.pendentes === 0 ? 'nada travando o mês' : `${f.pendentes} ainda travam o número`}
          nivel={f.pendentes === 0 ? 'bom' : 'critico'}
        />
        <Numero
          rotulo="Taxa de máquina no mês"
          valor={brl(f.dre.taxasCalculadas)}
          detalhe={f.dre.taxasCalculadas > 0 ? 'já descontada do resultado' : 'nenhuma taxa aplicada'}
          nivel={f.dre.taxasCalculadas > 0 ? 'atencao' : undefined}
        />
      </div>

      <Secao
        titulo="O que conferir antes de dar o mês por fechado"
        resumo="Cada linha erra o resultado para cima quando fica em aberto. É por isso que elas vêm antes do número."
      >
        <Cartao caixa>
          <ul className="flex flex-col">
            {f.itens.map((i) => {
              const c = CORES[i.situacao]!
              return (
                <li
                  key={i.chave}
                  className="flex flex-col gap-1.5 border-b border-borda-suave py-3 last:border-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="flex items-baseline gap-2">
                      <span aria-hidden className={cx('size-2 shrink-0 translate-y-[-1px] rounded-full', c.ponto)} />
                      <span className="text-sm font-semibold text-tinta">{i.titulo}</span>
                    </span>
                    <span className="flex items-baseline gap-3">
                      <span className="text-sm text-tinta-2">{i.detalhe}</span>
                      <Situacao nivel={c.nivel}>{ROTULO[i.situacao]}</Situacao>
                    </span>
                  </div>
                  <p className="max-w-prose pl-4 text-xs text-tinta-3">{i.porque}</p>
                  {i.onde && (
                    <Link
                      href={i.onde.href}
                      className="pl-4 text-xs font-semibold text-marca underline-offset-2 hover:underline"
                    >
                      {i.onde.texto} →
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </Cartao>
      </Secao>

      <Secao titulo={`O resultado de ${f.titulo}, linha por linha`}>
        <Cartao caixa>
          <table className="w-full text-sm">
            <tbody>
              {f.dre.linhas.map((l) => (
                <tr
                  key={l.chave}
                  className={cx(
                    'border-b border-borda-suave last:border-0',
                    l.total && 'font-semibold text-tinta',
                    l.fora && 'text-tinta-3',
                  )}
                >
                  <td className="py-2 pr-3">{l.rotulo}</td>
                  <td className="numero py-2 pl-3">{brl(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Cartao>
        <p className="text-xs text-tinta-3">
          Este quadro não tranca nada: lançamento atrasado continua entrando, e o número se
          refaz sozinho. A lista de cima é para você saber o que ainda falta, não para impedir.
        </p>
      </Secao>
    </Estrutura>
  )
}
