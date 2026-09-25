import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
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

// O livro, aberto.
//
// A pergunta que traz alguém aqui quase nunca é "o que aconteceu": é "quem
// fez ISSO". Por isso a busca pega o nome de quem fez, o nome do alvo e o
// motivo — e o filtro por assunto existe para "tudo que mexeu no caixa esta
// semana" ser um clique, não uma leitura.

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d)

/**
 * Linha do NOSSO suporte (ver `registrarAcessoDeSuporte` em pagina.ts): o
 * alvo é o caminho aberto, e o motivo é o do acesso concedido.
 */
const ehDoSuporte = (l: LinhaDoLivro) => l.acao.startsWith('suporte.')

/** Para onde a linha leva, quando o alvo tem tela. */
function linkDoAlvo(slug: string, l: LinhaDoLivro): string | null {
  if (!l.alvoId) return null
  switch (l.alvoTipo) {
    case 'venda': return `/${slug}/vendas/${l.alvoId}`
    case 'produto': return `/${slug}/produtos/${l.alvoId}`
    case 'cliente': return `/${slug}/clientes/${l.alvoId}`
    case 'caixa': return `/${slug}/caixa`
    case 'usuario': return `/${slug}/equipe`
    default: return null
  }
}

/** O "antes → depois" numa frase curta, só quando dá para ler. */
function resumoDaMudanca(l: LinhaDoLivro): string | null {
  const a = l.antes as Record<string, unknown> | null
  const d = l.depois as Record<string, unknown> | null
  if (!a || !d || typeof a !== 'object' || typeof d !== 'object') return null
  const partes: string[] = []
  for (const k of Object.keys(d)) {
    if (k in a && a[k] !== d[k] && ['string', 'number', 'boolean'].includes(typeof d[k])) {
      const v = (x: unknown) => (typeof x === 'number' && /preco|custo|esperado|contado/i.test(k) ? brl(x) : String(x))
      partes.push(`${k}: ${v(a[k])} → ${v(d[k])}`)
    }
  }
  return partes.length ? partes.slice(0, 3).join(' · ') : null
}

export default async function AuditoriaPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; periodo?: string; q?: string; assunto?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, periodo: pedido, q: qBruto, assunto: assuntoPedido } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  if (!pode(sessao, 'auditoria.ver')) notFound()

  const onde = await escolherUnidade(sessao, empresa, pedida, 'auditoria.ver')
  const j = janela(lerPeriodo(pedido))
  const q = (qBruto ?? '').trim()
  const assunto = ASSUNTOS.some((a) => a.chave === assuntoPedido) ? assuntoPedido! : null

  const linhas = await listarAuditoria(sessao, {
    unidadeIds: onde.ids,
    de: j.de,
    ate: j.ate,
    q,
    assunto,
  })

  const atuais = { unidade: onde.unidadeId, periodo: j.chave, q, assunto }
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
                const href = linkDoAlvo(slug, l)
                const mudanca = resumoDaMudanca(l)
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
