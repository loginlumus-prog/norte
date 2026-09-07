import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { acharCliente, mostrarTelefone } from '@/servidor/cliente'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Vazio } from '@/ui/base'
import { Numero, Secao, brl } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Editor, type ClienteNaTela } from '../Editor'

// A ficha do cliente.
//
// O HISTÓRICO VEM ANTES DO CADASTRO. Quem abre esta tela está quase sempre
// com a pessoa na frente ou no telefone, e a pergunta é "o que ela costuma
// levar?" — não "qual o CEP dela?". Editar fica embaixo, para quando é isso
// mesmo que se quer.

const data = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d)

export default async function FichaCliente({
  params,
}: {
  params: Promise<{ empresa: string; id: string }>
}) {
  const { empresa: slug, id } = await params
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const cliente = await acharCliente(sessao, id)
  if (!cliente) notFound()

  const podeEditar = pode(sessao, 'cliente.editar')

  const gastou = cliente.vendas.reduce((s, v) => s + Number(v.total), 0)
  const ultima = cliente.vendas[0]?.criadaEm ?? null
  const dias = ultima ? Math.floor((Date.now() - ultima.getTime()) / 864e5) : null
  const ticket = cliente.vendas.length > 0 ? gastou / cliente.vendas.length : 0

  const naTela: ClienteNaTela = {
    id: cliente.id,
    nome: cliente.nome,
    telefone: mostrarTelefone(cliente.telefone),
    documento: cliente.documento ?? '',
    email: cliente.email ?? '',
    nascimento: cliente.nascimento ? cliente.nascimento.toISOString().slice(0, 10) : '',
    endereco: cliente.endereco ?? '',
    numero: cliente.numero ?? '',
    bairro: cliente.bairro ?? '',
    cidade: cliente.cidade ?? '',
    estado: cliente.estado ?? '',
    cep: cliente.cep ?? '',
    observacoes: cliente.observacoes ?? '',
    ativo: cliente.ativo,
  }

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/clientes`}
      tema={tema}
      titulo={cliente.nome}
      acao={
        cliente.telefone ? (
          <a
            href={`https://wa.me/55${cliente.telefone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-norte border border-borda px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
          >
            {mostrarTelefone(cliente.telefone)}
          </a>
        ) : undefined
      }
    >
      <Secao titulo="O que ela já comprou">
        <div className="grid gap-2 sm:grid-cols-3">
          <Numero
            rotulo="Gastou aqui"
            valor={brl(gastou)}
            detalhe={`${cliente.vendas.length} compra(s)`}
            nivel={gastou > 0 ? 'bom' : undefined}
          />
          <Numero rotulo="Ticket médio" valor={brl(ticket)} detalhe="por compra" />
          <Numero
            rotulo="Última compra"
            valor={dias === null ? '—' : `${dias}d`}
            detalhe={dias === null ? 'nunca comprou' : 'atrás'}
            nivel={dias !== null && dias >= 60 ? 'atencao' : undefined}
          />
        </div>

        <Cartao titulo="Compras">
          {cliente.vendas.length === 0 ? (
            <Vazio>
              Esta pessoa ainda não comprou nada. Escolha ela no balcão na próxima venda e o
              histórico começa aqui.
            </Vazio>
          ) : (
            <ul className="flex flex-col">
              {cliente.vendas.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-borda-suave py-2.5 last:border-0"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-tinta">
                      {v.itens.map((i) => i.descricao).join(', ')}
                    </span>
                    <span className="text-xs text-tinta-3">
                      venda {v.numero} · {data(v.criadaEm)} · {v.unidade.nome}
                    </span>
                  </span>
                  <span className="numero shrink-0 text-sm font-semibold text-tinta">
                    {brl(Number(v.total))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        {cliente.observacoes && (
          <Cartao titulo="O que a equipe precisa lembrar">
            <p className="text-sm leading-relaxed text-tinta-2">{cliente.observacoes}</p>
          </Cartao>
        )}

        {!cliente.ativo && (
          <Cartao>
            <Situacao nivel="neutro">
              Cliente inativo — some da busca do balcão e continua no histórico.
            </Situacao>
          </Cartao>
        )}
      </Secao>

      {podeEditar && (
        <Secao titulo="Cadastro">
          <Editor slug={slug} cliente={naTela} />
        </Secao>
      )}
    </Estrutura>
  )
}
