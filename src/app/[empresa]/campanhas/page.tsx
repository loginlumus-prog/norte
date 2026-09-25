import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { pode, podeVerPlanos } from '@/servidor/permissao'
import { liberado } from '@/servidor/planos'
import { lerOrgParaCampanha, porQueNao } from '@/servidor/campanhas/acesso'
import { lerAjustesDaTela, listarCampanhas, type LinhaCampanha } from '@/servidor/campanhas/admin'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso, Cartao, Situacao, Vazio } from '@/ui/base'
import { Trancado } from '@/ui/Cadeado'
import type { Tema } from '@/ui/TrocaTema'
import { plural } from '@/ui/texto'
import { Nova } from './Nova'
import { AcoesDaCampanha } from './AcoesDaCampanha'
import { Limites } from './Limites'

// Campanhas: o roteiro de WhatsApp com começo e fim.
//
// A lista mostra, de cada campanha, o que o dono pergunta: está ligada? como
// se entra? quantos entraram, quantos estão dentro agora, quantos pediram uma
// pessoa, quantos chegaram ao fim. Os números são contados das execuções (o
// teste do dono não entra). Criar leva direto ao editor; o resto — pausar,
// duplicar, apagar — é da própria linha.

export default async function Campanhas({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'agente.configurar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const org = await lerOrgParaCampanha(sessao.orgId)
  const bloqueio = porQueNao(org)
  const base = { empresa, sessao, itens: MENU(slug), ativo: `/${slug}/campanhas`, tema, titulo: 'Campanhas' }

  if (bloqueio) {
    const doPlano = liberado(org.plano, 'campanhas')
    return (
      <Estrutura {...base}>
        {doPlano ? (
          <Cartao titulo="As campanhas estão desligadas">
            <p className="text-sm text-tinta-2">
              {bloqueio}{' '}
              {pode(sessao, 'empresa.configurar') && (
                <Link href={`/${slug}/configuracoes`} className="font-medium text-marca underline-offset-2 hover:underline">
                  Abrir Configurações
                </Link>
              )}
            </p>
          </Cartao>
        ) : (
          <Trancado
            chave="campanhas"
            plano={org.plano}
            slug={slug}
            verPlanos={podeVerPlanos(sessao)}
            resumo="Quem escreve uma frase no WhatsApp da loja entra num roteiro pronto — mensagem, foto, espera, pergunta — e no fim para."
          >
            <Amostra />
          </Trancado>
        )}
      </Estrutura>
    )
  }

  const campanhas = await listarCampanhas(sessao)
  const ajustes = await lerAjustesDaTela(sessao)
  const ativas = campanhas.filter((c) => c.ativa).length
  const dentro = campanhas.reduce((s, c) => s + c.dentro, 0)

  return (
    <Estrutura {...base}>
      <p className="max-w-3xl text-sm text-tinta-2">
        Quem escreve a <b className="text-tinta">frase</b> de uma campanha no WhatsApp da loja (ou chega pelo anúncio dela)
        entra num roteiro que você desenha, com começo e fim. Depois do fim, nada mais é enviado. Mensagem que não abre nem
        continua campanha fica para alguém da loja responder.
      </p>

      <Cartao titulo="Nova campanha" caixa>
        <Nova slug={slug} />
      </Cartao>

      <Cartao
        titulo={
          campanhas.length === 0
            ? 'Suas campanhas'
            : `${plural(ativas, 'ativa', 'ativas')} · ${plural(dentro, 'pessoa dentro agora', 'pessoas dentro agora')}`
        }
      >
        {campanhas.length === 0 ? (
          <Vazio>Nenhuma campanha ainda. Dê um nome acima e desenhe o roteiro — ela nasce pausada, e só entra alguém depois que você ativar.</Vazio>
        ) : (
          <ul className="flex flex-col divide-y divide-borda rounded-norte border border-borda bg-superficie">
            {campanhas.map((c) => (
              <Linha key={c.id} slug={slug} c={c} />
            ))}
          </ul>
        )}
      </Cartao>

      <Cartao titulo="Limites contra bloqueio do número">
        <Limites
          slug={slug}
          porContatoDia={ajustes.porContatoDia}
          porEmpresaDia={ajustes.porEmpresaDia}
          intervaloSeg={ajustes.intervaloSeg}
          hoje={ajustes.hojeEmpresa}
        />
      </Cartao>
    </Estrutura>
  )
}

function comoEntra(c: LinhaCampanha): string {
  if (c.gatilho.tipo === 'manual') return 'Só por outra campanha ou teste'
  const partes: string[] = []
  if (c.gatilho.frases.length) partes.push(c.gatilho.frases.map((f) => `"${f}"`).join(', '))
  if (c.gatilho.anuncioIds.length) partes.push(plural(c.gatilho.anuncioIds.length, 'anúncio', 'anúncios'))
  return partes.join(' · ') || 'Sem frase ainda'
}

function Linha({ slug, c }: { slug: string; c: LinhaCampanha }) {
  const numeros: [string, number][] = [
    ['entraram', c.entraram],
    ['dentro agora', c.dentro],
    ['passaram para pessoa', c.paraPessoa],
    ['concluíram', c.concluiram],
  ]
  return (
    <li className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/${slug}/campanhas/${c.id}`} className="truncate text-[15px] font-semibold text-tinta hover:text-marca">
            {c.nome}
          </Link>
          <Situacao nivel={c.ativa ? 'bom' : 'neutro'}>{c.ativa ? 'Ativa' : 'Pausada'}</Situacao>
          {c.pasta && <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-xs text-tinta-2">{c.pasta}</span>}
        </div>
        <p className="truncate text-xs text-tinta-2">{comoEntra(c)}</p>
        <dl className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
          {numeros.map(([rotulo, n]) => (
            <div key={rotulo} className="flex items-baseline gap-1.5">
              <dd className="text-sm font-bold tabular-nums text-tinta">{n}</dd>
              <dt className="text-xs text-tinta-3">{rotulo}</dt>
            </div>
          ))}
        </dl>
      </div>
      <AcoesDaCampanha slug={slug} id={c.id} nome={c.nome} ativa={c.ativa} dentro={c.dentro} />
    </li>
  )
}

/** Amostra para o bloco trancado: forma, não dado real. */
function Amostra() {
  const linhas = [
    { nome: 'Catálogo de verão', frase: '"catálogo"', n: [128, 6, 14, 97] },
    { nome: 'Cupom de aniversário', frase: '"aniversário"', n: [42, 1, 3, 36] },
  ]
  return (
    <ul className="flex flex-col divide-y divide-borda rounded-norte border border-borda bg-superficie">
      {linhas.map((l) => (
        <li key={l.nome} className="flex flex-col gap-1 p-4">
          <span className="text-[15px] font-semibold text-tinta">{l.nome}</span>
          <span className="text-xs text-tinta-2">{l.frase}</span>
          <span className="text-xs text-tinta-3">
            {l.n[0]} entraram · {l.n[1]} dentro agora · {l.n[2]} passaram para pessoa · {l.n[3]} concluíram
          </span>
        </li>
      ))}
      <li className="p-4">
        <Aviso nivel="neutro">Exemplo ilustrativo.</Aviso>
      </li>
    </ul>
  )
}
