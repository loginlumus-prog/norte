import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { pode, textoDaBusca, type Capacidade, type Sessao } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { janela, lerPeriodo } from '@/servidor/periodo'
import { listarAuditoria, ASSUNTOS, type LinhaDoLivro } from '@/servidor/auditoria'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Tabela } from '@/ui/Tabela'
import { Busca, Fichas, enderecoCom } from '@/ui/Busca'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { SeletorPeriodo } from '@/ui/Periodo'
import { Secao, Tira, brl } from '@/ui/painel'
import { Situacao } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { resumoDaMudanca } from './mudanca'

export const metadata: Metadata = { title: 'Auditoria' }

// O livro, aberto.
//
// A pergunta que traz alguém aqui quase nunca é "o que aconteceu": é "quem
// fez ISSO". Por isso a busca pega o nome de quem fez, o nome do alvo e o
// motivo — e o filtro por assunto existe para "tudo que mexeu no caixa esta
// semana" ser um clique, não uma leitura.

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d)

/**
 * Linha do NOSSO suporte (ver `registrarAcessoDeSuporte` em pagina.ts): o
 * alvo é o caminho aberto, e o motivo é o do acesso concedido.
 */
const ehDoSuporte = (l: LinhaDoLivro) => l.acao.startsWith('suporte.')

/**
 * Para onde a linha leva, quando o alvo tem tela — e a pessoa pode abrir essa
 * tela. O financeiro lê o livro inteiro, mas não abre Equipe nem o cadastro
 * de produto: o link caía em "este endereço não abre", que parece defeito.
 * Cada destino pede a mesma capacidade que a tela de lá exige.
 */
const DESTINO: Record<string, { capacidade: Capacidade; endereco: (slug: string, id: string) => string }> = {
  venda: { capacidade: 'venda.ver', endereco: (s, id) => `/${s}/vendas/${id}` },
  produto: { capacidade: 'produto.editar', endereco: (s, id) => `/${s}/produtos/${id}` },
  cliente: { capacidade: 'cliente.ver', endereco: (s, id) => `/${s}/clientes/${id}` },
  caixa: { capacidade: 'caixa.ver', endereco: (s) => `/${s}/caixa` },
  usuario: { capacidade: 'equipe.ver', endereco: (s) => `/${s}/equipe` },
}

function linkDoAlvo(slug: string, sessao: Sessao, l: LinhaDoLivro): string | null {
  if (!l.alvoId || !l.alvoTipo) return null
  const d = DESTINO[l.alvoTipo]
  return d && pode(sessao, d.capacidade) ? d.endereco(slug, l.alvoId) : null
}

/** Um valor do endereço, só se for texto: `?unidade=a&unidade=b` chega como lista. */
const umTexto = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export default async function AuditoriaPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string | string[]; periodo?: string | string[]; q?: string | string[]; assunto?: string | string[] }>
}) {
  const { empresa: slug } = await params
  const busca = await searchParams
  const pedida = umTexto(busca.unidade)
  const pedido = umTexto(busca.periodo)
  const assuntoPedido = umTexto(busca.assunto)
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  if (!pode(sessao, 'auditoria.ver')) notFound()

  const onde = await escolherUnidade(sessao, empresa, pedida, 'auditoria.ver')
  const j = janela(lerPeriodo(pedido))
  // `?q=a&q=b` chegava como lista e o `.trim()` derrubava a tela.
  const q = textoDaBusca(busca.q)
  const assunto = ASSUNTOS.some((a) => a.chave === assuntoPedido) ? assuntoPedido! : null

  const linhas = await listarAuditoria(sessao, {
    unidadeIds: onde.ids,
    de: j.de,
    ate: j.ate,
    q,
    assunto,
  })

  const atuais = { unidade: onde.unidadeId, periodo: j.chave, q, assunto }
  const lojas = new Map(onde.opcoes.map((u) => [u.id, u.nome]))
  const link = (m: Record<string, string | null>) => enderecoCom(`/${slug}/auditoria`, atuais, m)

  const pessoas = new Set(linhas.map((l) => l.quem)).size
  const doAgente = linhas.filter((l) => l.autor === 'AGENTE').length
  const doSuporte = linhas.filter(ehDoSuporte).length

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/auditoria`}
      tema={tema}
      titulo="Auditoria"
      acao={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SeletorPeriodo atual={j.chave} />
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
        </div>
      }
    >
      <Secao
        titulo={`${j.rotulo} · ${onde.titulo}`}
        resumo="Tudo que mexeu no sistema, com quem e quando. Este livro não se edita nem se apaga — nem por nós."
      >
        <Tira
          itens={[
            { rotulo: 'registros', um: 'registro', quantos: linhas.length, nivel: 'neutro' },
            { rotulo: 'pessoas diferentes', um: 'pessoa', quantos: pessoas, nivel: 'bom' },
            { rotulo: 'feitos pelo assistente', um: 'feito pelo assistente', quantos: doAgente, nivel: 'atencao' },
            ...(linhas.some((l) => l.assinado)
              ? [{ rotulo: 'assinados com PIN', um: 'assinado com PIN', quantos: linhas.filter((l) => l.assinado).length, nivel: 'bom' as const }]
              : []),
            // Só aparece quando houve: acesso nosso é exceção, e a loja
            // precisa ver de longe que ele aconteceu.
            ...(doSuporte
              ? [{ rotulo: 'acessos do suporte do Norte', um: 'acesso do suporte do Norte', quantos: doSuporte, nivel: 'critico' as const }]
              : []),
          ]}
        />

        <div className="flex flex-col gap-2">
          <Busca
            valor={q}
            placeholder="Quem fez, o que mexeu, ou o motivo"
            rotulo="Buscar no livro"
            manter={{ unidade: onde.unidadeId, periodo: j.chave, assunto }}
            limparEm={link({ q: null })}
          />
          <Fichas
            opcoes={[
              { valor: null, rotulo: 'tudo' },
              ...ASSUNTOS.map((a) => ({ valor: a.chave, rotulo: a.rotulo })),
            ]}
            atual={assunto}
            linkDe={(v) => link({ assunto: v })}
          />
        </div>

        <Tabela
          colunas={[
            {
              chave: 'quando',
              titulo: 'Quando',
              largura: '7rem',
              celula: (l: LinhaDoLivro) => (
                <span className="numero whitespace-nowrap text-tinta-2">{quando(l.criadoEm)}</span>
              ),
            },
            {
              chave: 'quem',
              titulo: 'Quem',
              largura: '11rem',
              celula: (l: LinhaDoLivro) => (
                <span className="flex flex-col">
                  <span className="truncate font-medium text-tinta">{l.quem}</span>
                  {ehDoSuporte(l) && (
                    <span className="pt-0.5">
                      <Situacao nivel="atencao">suporte do Norte</Situacao>
                    </span>
                  )}
                  {/* O livro de assinaturas: feito (ou autorizado) com o PIN. */}
                  {l.assinado && (
                    <span className="pt-0.5">
                      <Situacao nivel="bom">assinado com PIN</Situacao>
                    </span>
                  )}
                  {l.autor !== 'PESSOA' && (
                    <span className="text-[11px] text-tinta-3">
                      {l.autor === 'AGENTE' ? 'assistente' : 'sistema'}
                    </span>
                  )}
                </span>
              ),
            },
            {
              chave: 'oque',
              titulo: 'O que fez',
              celula: (l: LinhaDoLivro) => {
                const href = linkDoAlvo(slug, sessao, l)
                const mudanca = resumoDaMudanca(l.antes, l.depois, lojas)
                return (
                  <span className="flex min-w-0 flex-col">
                    <span className="text-tinta">
                      {l.texto}
                      {l.alvoNome && (
                        <>
                          {' — '}
                          {href ? (
                            <Link href={href} className="font-medium text-marca underline-offset-2 hover:underline">
                              {l.alvoNome}
                            </Link>
                          ) : (
                            <span className="font-medium">{l.alvoNome}</span>
                          )}
                          {ehDoSuporte(l) && (
                            <span className="text-tinta-3"> ({l.alvoTipo === 'acao' ? 'ação' : 'tela'})</span>
                          )}
                        </>
                      )}
                    </span>
                    {(l.motivo || mudanca) && (
                      <span className="text-xs text-tinta-3">
                        {l.motivo}
                        {l.motivo && mudanca ? ' · ' : ''}
                        {mudanca}
                      </span>
                    )}
                  </span>
                )
              },
            },
            {
              chave: 'valor',
              titulo: 'Valor',
              numero: true,
              largura: '7rem',
              celula: (l: LinhaDoLivro) =>
                l.valor === null ? null : (
                  <span className={'numero font-semibold ' + (l.valor < 0 ? 'text-critico' : 'text-tinta')}>
                    {brl(l.valor)}
                  </span>
                ),
            },
            {
              chave: 'onde',
              titulo: 'Onde',
              largura: '8rem',
              celula: (l: LinhaDoLivro) =>
                l.unidade ? <Situacao nivel="neutro">{l.unidade}</Situacao> : null,
            },
          ]}
          linhas={linhas}
          chave={(l) => l.id}
          vazio={q || assunto ? 'Nada com esse filtro no período.' : 'Nada registrado no período.'}
        />
        {linhas.length === 500 && (
          <p className="text-xs text-tinta-3">
            Mostrando os 500 mais recentes. Aperte o período ou o filtro para ver o resto.
          </p>
        )}
      </Secao>
    </Estrutura>
  )
}
