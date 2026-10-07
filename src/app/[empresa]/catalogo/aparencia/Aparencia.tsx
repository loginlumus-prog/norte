'use client'

// A aparência do catálogo de uma loja, no painel. Cinco blocos, na ordem em
// que a dona pensa: a cara (logo e tema), a data especial, o que postar, e o
// que as clientes disseram. Cada gesto salva na hora — não há "Salvar" no fim
// para esquecer.

import { useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { AparenciaDaLoja } from '@/servidor/vitrine'
import { Aviso, Botao, cx } from '@/ui/base'
import { Secao } from '@/ui/painel'
import { AcoesDaLinha, classeDaAcao, IconeDaAcao } from '@/ui/premium'
import { reduzirFoto } from '../../produtos/[id]/FotoDoProduto'
import { Destaques } from './Destaques'
import { Perfil } from './Perfil'
import { dataAcao, esconderAvaliacaoAcao, postarAcao, responderAvaliacaoAcao, temaAcao, tirarPostagemAcao } from './acoes'

type Resposta = { ok: true } | { ok: false; erro: string }

const dia = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function Estrelas({ nota }: { nota: number }) {
  return (
    <span className="text-[#f5a524]" aria-label={`${nota} de 5 estrelas`} role="img">
      {'★'.repeat(nota)}
      <span className="text-borda">{'★'.repeat(5 - nota)}</span>
    </span>
  )
}

export function Aparencia({
  slug,
  empresaNome,
  lojas,
  loja,
  dados,
  produtos,
}: {
  slug: string
  empresaNome: string
  lojas: { id: string; nome: string; ativo: boolean }[]
  loja: { id: string; endereco: string; ativo: boolean }
  dados: AparenciaDaLoja
  produtos: { id: string; nome: string }[]
}) {
  const router = useRouter()
  const [indo, comecar] = useTransition()
  const [recado, setRecado] = useState<{ nivel: 'bom' | 'critico'; texto: string } | null>(null)

  /** Roda a ação, mostra o erro (ou o ok) e atualiza a tela. */
  const agir = (f: () => Promise<Resposta>, ok?: string) =>
    comecar(async () => {
      setRecado(null)
      const r = await f().catch(() => ({ ok: false as const, erro: 'Sem conexão. Tente de novo.' }))
      if (!r.ok) setRecado({ nivel: 'critico', texto: r.erro })
      else {
        if (ok) setRecado({ nivel: 'bom', texto: ok })
        router.refresh()
      }
    })

  const corAtual = dados.corTema ?? dados.temas.find((t) => t.chave === dados.tema)?.cor ?? dados.corMarca ?? '#1f4fd1'

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center gap-3">
        {lojas.length > 1 ? (
          <nav aria-label="Loja" className="flex flex-wrap gap-1 rounded-norte border border-borda bg-superficie p-0.5">
            {lojas.map((l) => (
              <Link
                key={l.id}
                href={`/${slug}/catalogo/aparencia?loja=${l.id}`}
                aria-current={l.id === loja.id ? 'page' : undefined}
                className={cx('rounded-[5px] px-3 py-1.5 text-sm font-semibold', l.id === loja.id ? 'bg-marca text-marca-tinta' : 'text-tinta-2 hover:bg-superficie-2')}
              >
                {l.nome}
              </Link>
            ))}
          </nav>
        ) : null}
        <a
          href={`/${slug}/catalogo/${loja.endereco}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
        >
          Ver como a cliente vê
        </a>
        {!loja.ativo ? <span className="text-sm text-atencao">O catálogo desta loja está fechado: as mudanças aparecem quando abrir.</span> : null}
      </div>

      {recado ? <Aviso nivel={recado.nivel}>{recado.texto}</Aviso> : null}

      {/* ── A CARA ── */}
      <Secao titulo="A cara do catálogo" resumo="A logo vale para todas as lojas. A capa e a cor são deste catálogo.">
        <Perfil
          slug={slug}
          unidadeId={loja.id}
          nome={empresaNome}
          loja={lojas.find((l) => l.id === loja.id)?.nome ?? ''}
          capa={dados.capa}
          logo={dados.logoUrl}
          cor={corAtual}
          agir={agir}
          indo={indo}
        />
        <div>
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-tinta">Cor do tema</p>
            <div className="flex flex-wrap gap-2.5">
              <Amostra
                nome="Da marca"
                cor={dados.corMarca ?? '#1f4fd1'}
                ativa={!dados.tema && !dados.corTema}
                onClick={() => agir(() => temaAcao(slug, loja.id, null, null))}
              />
              {dados.temas.map((t) => (
                <Amostra key={t.chave} nome={t.nome} cor={t.cor} ativa={dados.tema === t.chave && !dados.corTema} onClick={() => agir(() => temaAcao(slug, loja.id, t.chave, null))} />
              ))}
              <label className="flex w-[74px] cursor-pointer flex-col items-center gap-1.5 text-center">
                <span
                  className={cx('relative h-12 w-12 overflow-hidden rounded-full ring-offset-2 ring-offset-fundo', dados.corTema ? 'ring-2 ring-tinta' : 'ring-1 ring-borda')}
                  style={{ background: dados.corTema ?? 'conic-gradient(#d93d72, #ffd43b, #0f9b77, #1765c9, #6b2c91, #d93d72)' }}
                >
                  <input
                    type="color"
                    defaultValue={corAtual}
                    aria-label="Escolher outra cor"
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    onChange={(e) => {
                      const cor = e.target.value
                      // Espera a pessoa largar o seletor (o change dispara a cada arrasto).
                      window.clearTimeout((window as unknown as { __cor?: number }).__cor)
                      ;(window as unknown as { __cor?: number }).__cor = window.setTimeout(() => agir(() => temaAcao(slug, loja.id, dados.tema, cor)), 600)
                    }}
                  />
                </span>
                <span className="text-xs text-tinta-2">Outra cor</span>
              </label>
            </div>
          </div>
        </div>
      </Secao>

      {/* ── OS DESTAQUES ── */}
      <Secao titulo="Destaques" resumo="As bolinhas do topo do catálogo, como os destaques do Instagram. Tocar abre o que tem dentro, um produto por tela.">
        <Destaques slug={slug} unidadeId={loja.id} dados={dados} produtos={produtos} agir={agir} indo={indo} />
      </Secao>

      {/* ── A DATA ── */}
      <Secao titulo="Datas especiais" resumo="Natal, São João, Halloween… O catálogo ganha a cor e a arte da data, e um recado no topo. Sai sozinho depois.">
        <div className="flex flex-col gap-3">
          {dados.especial ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-norte border border-bom-borda bg-bom-fundo px-4 py-3">
              <p className="text-sm text-tinta">
                <b>Tema de {dados.especial.nome}</b> ligado até {dia(dados.especial.ate)}.
              </p>
              <Botao tom="secundario" disabled={indo} onClick={() => agir(() => dataAcao(slug, loja.id, null))}>
                Desligar
              </Botao>
            </div>
          ) : null}
          {dados.sugestoes.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {dados.sugestoes.map((s) => (
                <li key={s.chave} className="flex flex-wrap items-center justify-between gap-3 rounded-norte border border-borda bg-superficie px-4 py-3">
                  <span className="flex items-center gap-3">
                    <span aria-hidden className="h-8 w-8 rounded-full" style={{ background: s.cor }} />
                    <span className="text-sm text-tinta">
                      <b>{s.nome}</b> {s.jaComecou ? `· até ${dia(s.ate)}` : `· chega logo (até ${dia(s.ate)})`}
                    </span>
                  </span>
                  <Botao disabled={indo} onClick={() => agir(() => dataAcao(slug, loja.id, s.chave), `Tema de ${s.nome} ligado.`)}>
                    Ligar tema de {s.nome}
                  </Botao>
                </li>
              ))}
            </ul>
          ) : !dados.especial ? (
            <p className="text-sm text-tinta-3">Nenhuma data por perto agora. Quando chegar uma (uma semana antes), a sugestão aparece aqui.</p>
          ) : null}
        </div>
      </Secao>

      {/* ── POSTAR ── */}
      <Secao titulo="Postagens" resumo="A novidade, a promoção, o sabor do dia. Aparece nas bolinhas do topo (os stories) e no mural de Novidades.">
        <NovaPostagem slug={slug} unidadeId={loja.id} produtos={produtos} agir={agir} indo={indo} />
        {dados.postagens.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dados.postagens.map((p) => (
              <li key={p.id} className="flex gap-3 rounded-norte border border-borda bg-superficie p-3">
                <span className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-superficie-2">
                  {p.foto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.foto} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-xs text-tinta-3">sem foto</span>
                  )}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate text-sm font-semibold text-tinta">{p.titulo}</p>
                  <p className="text-xs text-tinta-3">
                    {p.nosStories ? (p.storiesAte ? `Nas bolinhas até ${quando(p.storiesAte)}` : 'Nas bolinhas') : 'Só no mural'}
                    {p.produto ? ` · “Quero esse”: ${p.produto}` : ''}
                  </p>
                  <button
                    type="button"
                    disabled={indo}
                    onClick={() => agir(() => tirarPostagemAcao(slug, p.id))}
                    className={cx(classeDaAcao({ jeito: 'pilula', tom: 'perigo' }), 'mt-auto self-start')}
                    aria-label={`Tirar do catálogo: ${p.titulo}`}
                  >
                    <IconeDaAcao icone="excluir" tamanho={15} />
                    Tirar do catálogo
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Secao>

      {/* ── AVALIAÇÕES ── */}
      <Secao
        titulo="Avaliações"
        resumo="Quem recebeu o pedido do catálogo avalia pelo link de acompanhar. Você pode responder ou esconder (fica registrado), mas não editar."
      >
        {dados.avaliacoes.length === 0 ? (
          <p className="text-sm text-tinta-3">Ainda sem avaliações. Elas chegam depois que os pedidos do catálogo forem entregues.</p>
        ) : (
          <>
            {dados.media !== null ? (
              <p className="text-sm text-tinta-2">
                Média <b className="text-tinta">{dados.media.toLocaleString('pt-BR', { minimumFractionDigits: 1 })}</b> de 5
              </p>
            ) : null}
            <ul className="flex flex-col gap-3">
              {dados.avaliacoes.map((a) => (
                <Avaliacao key={a.id} slug={slug} a={a} agir={agir} indo={indo} />
              ))}
            </ul>
          </>
        )}
      </Secao>
    </div>
  )
}

function Amostra({ nome, cor, ativa, onClick }: { nome: string; cor: string; ativa: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativa} className="flex w-[74px] flex-col items-center gap-1.5 text-center">
      <span className={cx('h-12 w-12 rounded-full ring-offset-2 ring-offset-fundo', ativa ? 'ring-2 ring-tinta' : 'ring-1 ring-borda')} style={{ background: cor }} />
      <span className={cx('text-xs', ativa ? 'font-semibold text-tinta' : 'text-tinta-2')}>{nome}</span>
    </button>
  )
}

function NovaPostagem({
  slug,
  unidadeId,
  produtos,
  agir,
  indo,
}: {
  slug: string
  unidadeId: string
  produtos: { id: string; nome: string }[]
  agir: (f: () => Promise<Resposta>, ok?: string) => void
  indo: boolean
}) {
  const [foto, setFoto] = useState<Blob | null>(null)
  const [previa, setPrevia] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  return (
    <form
      ref={form}
      className="grid gap-4 rounded-norte border border-borda bg-superficie p-4 sm:grid-cols-[140px_1fr]"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        fd.delete('arquivo')
        if (foto) fd.set('foto', foto)
        agir(async () => {
          const r = await postarAcao(slug, unidadeId, fd)
          if (r.ok) {
            form.current?.reset()
            setFoto(null)
            setPrevia(null)
          }
          return r
        }, 'Postado.')
      }}
    >
      <label className="relative flex aspect-[4/5] cursor-pointer items-center justify-center overflow-hidden rounded-norte border border-dashed border-borda bg-superficie-2 text-center text-xs text-tinta-3 hover:bg-superficie-3">
        {previa ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previa} alt="Prévia" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="px-3">Toque para pôr uma foto (de pé fica melhor)</span>
        )}
        <input
          name="arquivo"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            try {
              const b = await reduzirFoto(f)
              setFoto(b)
              setPrevia(URL.createObjectURL(b))
            } catch {
              agir(async () => ({ ok: false, erro: 'Não deu para ler essa foto. Tente outra.' }))
            }
          }}
        />
      </label>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-tinta">Título</span>
          <input name="titulo" required maxLength={80} placeholder="Sabor novo: pistache" className="rounded-norte border border-borda bg-superficie px-3 py-2 text-tinta" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-tinta">Texto (opcional)</span>
          <textarea name="texto" maxLength={400} rows={2} placeholder="Só esta semana, cremoso e com pedacinhos." className="resize-none rounded-norte border border-borda bg-superficie px-3 py-2 text-tinta" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-tinta">Botão “Quero esse” (opcional)</span>
            <select name="produtoId" defaultValue="" className="rounded-norte border border-borda bg-superficie px-3 py-2 text-tinta">
              <option value="">Sem botão</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-tinta">Nas bolinhas do topo</span>
            <select name="stories" defaultValue="dia" className="rounded-norte border border-borda bg-superficie px-3 py-2 text-tinta">
              <option value="dia">Por 24 horas</option>
              <option value="sempre">Até eu tirar</option>
              <option value="nao">Não, só no mural</option>
            </select>
          </label>
        </div>
        <Botao type="submit" disabled={indo} carregando={indo} className="w-fit">
          Postar
        </Botao>
      </div>
    </form>
  )
}

function Avaliacao({
  slug,
  a,
  agir,
  indo,
}: {
  slug: string
  a: AparenciaDaLoja['avaliacoes'][number]
  agir: (f: () => Promise<Resposta>, ok?: string) => void
  indo: boolean
}) {
  const [respondendo, setRespondendo] = useState(false)
  const [resposta, setResposta] = useState(a.resposta ?? '')
  return (
    <li className={cx('flex flex-col gap-2 rounded-norte border bg-superficie p-4', a.oculta ? 'border-dashed border-borda opacity-70' : 'border-borda')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm">
          <b className="text-tinta">{a.nome}</b>
          <Estrelas nota={a.nota} />
          <span className="text-xs text-tinta-3">pedido {a.pedido} · {quando(a.criadaEm)}</span>
        </span>
        {a.oculta ? <span className="text-xs font-semibold text-tinta-3">Escondida: {a.ocultaMotivo}</span> : null}
      </div>
      {a.texto ? <p className="text-sm text-tinta-2">{a.texto}</p> : null}
      {a.resposta && !respondendo ? (
        <p className="rounded-norte bg-superficie-2 px-3 py-2 text-sm text-tinta-2">
          <b className="text-tinta">Sua resposta:</b> {a.resposta}
        </p>
      ) : null}
      {respondendo ? (
        <div className="flex flex-col gap-2">
          <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} maxLength={300} rows={2} className="resize-none rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta" />
          <div className="flex gap-2">
            <Botao
              disabled={indo}
              onClick={() => {
                agir(() => responderAvaliacaoAcao(slug, a.id, resposta))
                setRespondendo(false)
              }}
            >
              Publicar resposta
            </Botao>
            <Botao tom="discreto" onClick={() => setRespondendo(false)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : (
        <AcoesDaLinha solta>
          <button type="button" onClick={() => setRespondendo(true)} className={classeDaAcao({ jeito: 'pilula' })}>
            <IconeDaAcao icone={a.resposta ? 'editar' : 'responder'} tamanho={15} />
            {a.resposta ? 'Mudar resposta' : 'Responder'}
          </button>
          {a.oculta ? (
            <button type="button" disabled={indo} onClick={() => agir(() => esconderAvaliacaoAcao(slug, a.id, null))} className={classeDaAcao({ jeito: 'pilula' })}>
              <IconeDaAcao icone="ver" tamanho={15} />
              Mostrar de novo
            </button>
          ) : (
            <button
              type="button"
              disabled={indo}
              onClick={() => {
                const motivo = window.prompt('Por que esconder esta avaliação? (fica registrado)')
                if (motivo) agir(() => esconderAvaliacaoAcao(slug, a.id, motivo))
              }}
              className={classeDaAcao({ jeito: 'pilula', tom: 'perigo' })}
            >
              {/* Não há o olho riscado: a caixa diz "guardar fora da vista". */}
              <IconeDaAcao icone="esconder" tamanho={15} />
              Esconder
            </button>
          )}
        </AcoesDaLinha>
      )}
    </li>
  )
}
