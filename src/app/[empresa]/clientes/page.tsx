import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { listarClientes, mostrarTelefone } from '@/servidor/cliente'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Vazio } from '@/ui/base'
import { Tira, brl } from '@/ui/painel'
import { Tabela } from '@/ui/Tabela'
import type { Tema } from '@/ui/TrocaTema'

// A lista de clientes.
//
// Ela mostra quanto a pessoa gastou e há quanto tempo não aparece, porque
// nome e telefone sozinhos fazem uma agenda — e agenda não vende nada. É o
// "sumiu há 90 dias" que vira conversa, e é dele que sai o cliente que o
// assistente vai buscar.

const DIAS_SUMIDO = 60

const diasDesde = (d: Date | null) =>
  d ? Math.floor((Date.now() - d.getTime()) / 864e5) : null

export default async function Clientes({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ q?: string }>
}) {
  const { empresa: slug } = await params
  const { q } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const clientes = await listarClientes(sessao, q)
  const podeEditar = pode(sessao, 'cliente.editar')

  const sumidos = clientes.filter((c) => {
    const d = diasDesde(c.ultimaCompra)
    return c.compras > 0 && d !== null && d >= DIAS_SUMIDO
  })
  const semCompra = clientes.filter((c) => c.compras === 0)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/clientes`}
      tema={tema}
      titulo="Clientes"
      acao={
        podeEditar ? (
          <Link
            href={`/${slug}/clientes/novo`}
            className="botao-marca rounded-norte px-3 py-1.5 text-sm font-semibold text-marca-tinta"
          >
            + Novo cliente
          </Link>
        ) : undefined
      }
    >
      <Tira
        itens={[
          { rotulo: 'compraram', quantos: clientes.length - semCompra.length, nivel: 'bom' },
          { rotulo: `sumidos há ${DIAS_SUMIDO}+ dias`, quantos: sumidos.length, nivel: 'atencao' },
          { rotulo: 'nunca compraram', quantos: semCompra.length, nivel: 'neutro' },
        ]}
      />

      {/* A busca vive no endereço, não em estado escondido: assim o link da
          busca pode ser mandado para outra pessoa e abre igual. */}
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Nome, telefone ou CPF"
          aria-label="Buscar cliente"
          className="flex-1 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
        />
        <button
          type="submit"
          className="rounded-norte border border-borda bg-superficie px-4 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
        >
          Buscar
        </button>
        {q && (
          <Link
            href={`/${slug}/clientes`}
            className="flex items-center px-2 text-sm text-tinta-3 hover:text-tinta"
          >
            limpar
          </Link>
        )}
      </form>

      <Cartao
        titulo={q ? `Resultado de “${q}”` : `${clientes.length} cliente(s)`}
        acao={
          clientes.length >= 200 ? (
            <span className="text-xs text-tinta-3">
              mostrando os 200 primeiros — use a busca
            </span>
          ) : undefined
        }
      >
        {clientes.length === 0 ? (
          <Vazio
            acao={
              podeEditar && !q ? (
                <Link
                  href={`/${slug}/clientes/novo`}
                  className="botao-marca rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta"
                >
                  Cadastrar o primeiro
                </Link>
              ) : undefined
            }
          >
            {q ? 'Ninguém com esse nome, telefone ou CPF.' : 'Nenhum cliente cadastrado ainda.'}
          </Vazio>
        ) : (
          <Tabela
            colunas={[
              {
                chave: 'nome',
                titulo: 'Cliente',
                celula: (c) => (
                  <Link
                    href={`/${slug}/clientes/${c.id}`}
                    className="flex min-w-0 flex-col hover:underline"
                  >
                    <span
                      className={
                        c.ativo ? 'truncate text-sm text-tinta' : 'truncate text-sm text-tinta-3'
                      }
                    >
                      {c.nome}
                    </span>
                    <span className="text-xs text-tinta-3">
                      {mostrarTelefone(c.telefone) || 'sem telefone'}
                    </span>
                  </Link>
                ),
              },
              {
                chave: 'compras',
                titulo: 'Compras',
                numero: true,
                largura: '6rem',
                celula: (c) => <span className="numero text-sm text-tinta-2">{c.compras}</span>,
              },
              {
                chave: 'gastou',
                titulo: 'Gastou',
                numero: true,
                largura: '8rem',
                celula: (c) => (
                  <span className="numero text-sm font-semibold text-tinta">{brl(c.gastou)}</span>
                ),
              },
              {
                chave: 'quando',
                titulo: 'Última compra',
                numero: true,
                largura: '10rem',
                celula: (c) => {
                  const d = diasDesde(c.ultimaCompra)
                  if (d === null) return <Situacao nivel="neutro">nunca comprou</Situacao>
                  if (d >= DIAS_SUMIDO) return <Situacao nivel="atencao">há {d} dias</Situacao>
                  return <Situacao nivel="bom">há {d} dia(s)</Situacao>
                },
              },
            ]}
            linhas={clientes}
            chave={(c) => c.id}
            vazio="Ninguém aqui."
          />
        )}
      </Cartao>
    </Estrutura>
  )
}
