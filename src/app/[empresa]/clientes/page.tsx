import { diaEmSP } from '@/servidor/dia'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { lerModo } from '@/servidor/modo'
import { listarClientes, mostrarTelefone } from '@/servidor/cliente'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Vazio } from '@/ui/base'
import { Tira, brl } from '@/ui/painel'
import { Tabela } from '@/ui/Tabela'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import type { Tema } from '@/ui/TrocaTema'
import { plural } from '@/ui/texto'

type Quem = 'sumidos' | 'nunca' | 'ativos' | 'novos' | 'aniversario' | 'pontos' | 'devendo'
type Ordem = 'nome' | 'gastou' | 'recente'
const QUEM: Quem[] = ['sumidos', 'nunca', 'ativos', 'novos', 'aniversario', 'pontos', 'devendo']
const MES_NOME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

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
  searchParams: Promise<{ q?: string; quem?: string; ordem?: string }>
}) {
  const { empresa: slug } = await params
  const { q, quem: quemPedido, ordem: ordemPedida } = await searchParams
  const quem: Quem | null = QUEM.find((x) => x === quemPedido) ?? null
  const ordem: Ordem = ordemPedida === 'gastou' || ordemPedida === 'recente' ? ordemPedida : 'nome'
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'cliente.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  // No simples ficam os quatro recortes que viram mensagem no WhatsApp
  // (todos, sumidos, aniversário, devendo); ordenação, planilha e os
  // recortes de cadastro são do avançado. Filtro já escolhido nunca some.
  const simples = (await lerModo()) === 'simples'

  const clientes = await listarClientes(sessao, q)
  const podeEditar = pode(sessao, 'cliente.editar')

  const ehSumido = (c: (typeof clientes)[number]) => {
    const d = diasDesde(c.ultimaCompra)
    return c.compras > 0 && d !== null && d >= DIAS_SUMIDO
  }
  const sumidos = clientes.filter(ehSumido)
  const semCompra = clientes.filter((c) => c.compras === 0)
  // O mês de São Paulo, e o mês da coluna `date` lido em UTC: com getMonth()
  // local, quem nasceu no dia 1º aparecia no mês anterior (a meia-noite UTC
  // do dia 1º é 21h do último dia do mês em São Paulo).
  const mesAtual = Number(diaEmSP().slice(5, 7)) - 1
  const trintaDias = Date.now() - 30 * 864e5
  const aniversariantes = clientes.filter((c) => c.nascimento && c.nascimento.getUTCMonth() === mesAtual)
  const comPontos = clientes.filter((c) => c.pontos > 0)
  const devendo = clientes.filter((c) => c.devendo > 0)
  const novos = clientes.filter((c) => c.criadoEm.getTime() >= trintaDias)

  // ── quem a pessoa quer ver, e em que ordem ───────────────
  // A tira de cima ja dizia "14 sumidos" e nao dava para clicar — a pessoa
  // lia o numero e tinha que procurar um por um na lista. Agora cada numero e
  // um filtro. E a ordem importa mais aqui do que em qualquer outra lista:
  // "quem mais gasta" e "quem comprou por ultimo" sao as duas perguntas de
  // quem vai mandar mensagem, e por nome e so para achar alguem.
  //
  // Aniversariante do mes, quem tem ponto para gastar e quem deve sao os
  // tres motivos de mandar mensagem que a loja mais tem — e nenhum tinha filtro.
  const listados = clientes
    .filter((c) =>
      quem === 'sumidos' ? ehSumido(c)
      : quem === 'nunca' ? c.compras === 0
      : quem === 'ativos' ? c.compras > 0 && !ehSumido(c)
      : quem === 'novos' ? c.criadoEm.getTime() >= trintaDias
      : quem === 'aniversario' ? !!c.nascimento && c.nascimento.getUTCMonth() === mesAtual
      : quem === 'pontos' ? c.pontos > 0
      : quem === 'devendo' ? c.devendo > 0
      : true,
    )
    .sort((a, b) =>
      ordem === 'gastou'
        ? b.gastou - a.gastou
        : ordem === 'recente'
          ? (b.ultimaCompra?.getTime() ?? 0) - (a.ultimaCompra?.getTime() ?? 0)
          : a.nome.localeCompare(b.nome),
    )

  const atuais = { q, quem, ordem: ordem === 'nome' ? null : ordem }
  const link = (mudanca: Record<string, string | null>) =>
    enderecoCom(`/${slug}/clientes`, atuais, mudanca)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/clientes`}
      tema={tema}
      titulo="Clientes"
      acao={
        <span className="flex flex-wrap items-center gap-2">
          {!simples && (
            <a
              href={`/${slug}/clientes/exportar${q ? `?q=${encodeURIComponent(q)}` : ''}`}
              className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
              title="Baixar a lista em planilha"
            >
              Planilha
            </a>
          )}
          {podeEditar && (
            <Link
              href={`/${slug}/clientes/novo`}
              className="botao-marca rounded-norte px-3 py-1.5 text-sm font-semibold text-marca-tinta"
            >
              + Novo cliente
            </Link>
          )}
        </span>
      }
    >
      <Tira
        itens={[
          { rotulo: 'compraram', um: 'comprou', quantos: clientes.length - semCompra.length, nivel: 'bom' },
          { rotulo: `sumidos há ${DIAS_SUMIDO}+ dias`, um: `sumido há ${DIAS_SUMIDO}+ dias`, quantos: sumidos.length, nivel: 'atencao' },
          { rotulo: 'devendo no crediário', quantos: devendo.length, nivel: devendo.some((c) => c.vencido > 0) ? 'critico' : 'atencao' },
          { rotulo: `aniversário em ${MES_NOME[mesAtual]}`, quantos: aniversariantes.length, nivel: 'bom' },
          { rotulo: 'nunca compraram', um: 'nunca comprou', quantos: semCompra.length, nivel: 'neutro' },
        ]}
      />

      <div className="flex flex-col gap-2">
        <Busca
          valor={q}
          placeholder="Nome, telefone ou CPF"
          rotulo="Buscar cliente"
          manter={{ quem, ordem: atuais.ordem }}
          limparEm={link({ q: null })}
        />
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <Fichas
            opcoes={(
              [
                { valor: null, rotulo: 'todos', quantos: clientes.length },
                { valor: 'ativos', rotulo: 'compram', quantos: clientes.length - semCompra.length - sumidos.length, avancado: true },
                { valor: 'sumidos', rotulo: `sumidos há ${DIAS_SUMIDO}+ dias`, quantos: sumidos.length },
                { valor: 'novos', rotulo: 'cadastrados há 30 dias', quantos: novos.length, avancado: true },
                { valor: 'aniversario', rotulo: `aniversário em ${MES_NOME[mesAtual]}`, quantos: aniversariantes.length },
                { valor: 'pontos', rotulo: 'com pontos', quantos: comPontos.length, avancado: true },
                { valor: 'devendo', rotulo: 'devendo', quantos: devendo.length },
                { valor: 'nunca', rotulo: 'nunca compraram', quantos: semCompra.length, avancado: true },
              ] as { valor: Quem | null; rotulo: string; quantos: number; avancado?: boolean }[]
            ).filter((o) => !simples || !o.avancado || o.valor === quem)}
            atual={quem}
            linkDe={(v) => link({ quem: v })}
          />
          {(!simples || ordem !== 'nome') && (
          <Fichas
            rotulo="Ordenar por"
            opcoes={[
              { valor: null, rotulo: 'nome' },
              { valor: 'gastou', rotulo: 'quem mais gasta' },
              { valor: 'recente', rotulo: 'compra mais recente' },
            ]}
            atual={ordem === 'nome' ? null : ordem}
            linkDe={(v) => link({ ordem: v })}
          />
          )}
        </div>
      </div>

      <Cartao
        titulo={
          q
            ? `Resultado de “${q}”`
            : quem
              ? `${listados.length} de ${plural(clientes.length, 'cliente', 'clientes')}`
              : plural(clientes.length, 'cliente', 'clientes')
        }
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
                  return <Situacao nivel="bom">{d === 0 ? 'hoje' : `há ${plural(d, 'dia', 'dias')}`}</Situacao>
                },
              },
              ...(devendo.length > 0 || comPontos.length > 0
                ? [
                    {
                      chave: 'extra',
                      titulo: '',
                      largura: '9rem',
                      celula: (c: (typeof clientes)[number]) => (
                        <span className="flex flex-col items-end gap-0.5">
                          {c.devendo > 0 && (
                            <Situacao nivel={c.vencido > 0 ? 'critico' : 'atencao'}>
                              deve {brl(c.devendo)}
                            </Situacao>
                          )}
                          {c.pontos > 0 && <span className="numero text-xs text-tinta-3">{c.pontos} pontos</span>}
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
            linhas={listados}
            chave={(c) => c.id}
            vazio={
              quem === 'sumidos' ? 'Ninguém sumido — bom sinal.'
              : quem === 'nunca' ? 'Todo mundo cadastrado já comprou.'
              : quem === 'devendo' ? 'Ninguém devendo.'
              : quem === 'aniversario' ? `Ninguém faz aniversário em ${MES_NOME[mesAtual]} — ou a data de nascimento não foi cadastrada.`
              : quem === 'pontos' ? 'Ninguém com pontos para usar.'
              : 'Ninguém aqui.'
            }
          />
        )}
      </Cartao>
    </Estrutura>
  )
}
