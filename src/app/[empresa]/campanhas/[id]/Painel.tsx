'use client'

// O formulário do bloco escolhido. Um formulário por tipo, curto, com a
// frase de ajuda do lado — quem desenha a campanha é o dono da loja, não um
// técnico. O que se digita aqui muda o desenho na hora; gravar é o "Salvar"
// lá de cima.

import { useRef, useState, useTransition, type ReactNode } from 'react'
import { Aviso, Botao, cx } from '@/ui/base'
import {
  DIGITANDO_MAX_SEG,
  ROTULO_NO,
  type DadosPorTipo,
  type Gatilho,
  type No,
  type Reentrada,
  type TipoNo,
  type UnidadeTempo,
} from '@/servidor/campanhas/tipos'
import type { Pendencia } from '@/servidor/campanhas/grafo'
import { ACEITA, MB, conferirArquivo } from '@/servidor/campanhas/midia-regras'
import { subirMidiaAcao } from '../acoes'

type MidiaNaTela = { id: string; nome: string; tipo: string; tamanho: number; previa: string | null }

const campo = 'w-full min-w-0 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3'

function Rotulo({ titulo, dica, children }: { titulo: string; dica?: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-tinta">{titulo}</span>
      {children}
      {dica && <span className="text-xs text-tinta-3">{dica}</span>}
    </label>
  )
}

const linhas = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean)
const novoId = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`

function Tempo({
  quantidade,
  unidade,
  aoMudar,
}: {
  quantidade: number
  unidade: UnidadeTempo
  aoMudar: (q: number, u: UnidadeTempo) => void
}) {
  return (
    <div className="flex gap-2">
      <input
        type="number"
        min={1}
        max={999}
        value={quantidade}
        onChange={(e) => aoMudar(Math.max(1, Math.min(999, Number(e.target.value) || 1)), unidade)}
        className={cx(campo, 'w-24')}
        aria-label="Quanto"
      />
      <select value={unidade} onChange={(e) => aoMudar(quantidade, e.target.value as UnidadeTempo)} className={campo} aria-label="Unidade">
        <option value="min">minutos</option>
        <option value="h">horas</option>
        <option value="d">dias</option>
      </select>
    </div>
  )
}

/** Os três "coringas" do texto, num clique. */
function Coringas({ aoInserir }: { aoInserir: (t: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-tinta-3">
      Inserir:
      {['{primeiro_nome}', '{nome}', '{resposta}'].map((c) => (
        <button key={c} type="button" onClick={() => aoInserir(c)} className="rounded-full border border-borda px-2 py-0.5 font-mono text-[11px] text-tinta-2 hover:border-marca/50">
          {c}
        </button>
      ))}
    </div>
  )
}

export function PainelDoBloco({
  slug,
  no,
  gatilho,
  aoMudarGatilho,
  aoMudar,
  aoApagar,
  outras,
  equipe,
  midias,
  aoSubirMidia,
  horario,
  pendencias,
}: {
  slug: string
  no: No
  gatilho: Gatilho
  aoMudarGatilho: (g: Gatilho) => void
  aoMudar: (d: DadosPorTipo[TipoNo]) => void
  aoApagar: () => void
  outras: { id: string; nome: string }[]
  equipe: { id: string; nome: string; temTelefone: boolean; dono: boolean }[]
  midias: MidiaNaTela[]
  aoSubirMidia: (m: MidiaNaTela) => void
  horario: { texto: string | null; entendido: boolean }
  pendencias: Pendencia[]
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-bold text-tinta">{ROTULO_NO[no.tipo]}</h3>
        {no.tipo !== 'inicio' && (
          <Botao tom="discreto" onClick={aoApagar}>
            Apagar bloco
          </Botao>
        )}
      </div>
      {pendencias.map((p, i) => (
        <Aviso key={i} nivel={p.nivel === 'erro' ? 'critico' : 'atencao'}>
          {p.texto}
        </Aviso>
      ))}
      <Formulario
        slug={slug}
        no={no}
        gatilho={gatilho}
        aoMudarGatilho={aoMudarGatilho}
        aoMudar={aoMudar}
        outras={outras}
        equipe={equipe}
        midias={midias}
        aoSubirMidia={aoSubirMidia}
        horario={horario}
      />
    </div>
  )
}

function Formulario(p: {
  slug: string
  no: No
  gatilho: Gatilho
  aoMudarGatilho: (g: Gatilho) => void
  aoMudar: (d: DadosPorTipo[TipoNo]) => void
  outras: { id: string; nome: string }[]
  equipe: { id: string; nome: string; temTelefone: boolean; dono: boolean }[]
  midias: MidiaNaTela[]
  aoSubirMidia: (m: MidiaNaTela) => void
  horario: { texto: string | null; entendido: boolean }
}) {
  const { no } = p
  switch (no.tipo) {
    case 'inicio':
      return <FormInicio g={p.gatilho} aoMudar={p.aoMudarGatilho} />
    case 'mensagem':
      return <FormMensagem d={no.dados} aoMudar={p.aoMudar} />
    case 'midia':
      return <FormMidia slug={p.slug} d={no.dados} aoMudar={p.aoMudar} midias={p.midias} aoSubir={p.aoSubirMidia} />
    case 'intervalo': {
      const d = no.dados
      return (
        <div className="flex flex-col gap-3">
          <Rotulo titulo="Esperar">
            <Tempo quantidade={d.quantidade} unidade={d.unidade} aoMudar={(q, u) => p.aoMudar({ ...d, quantidade: q, unidade: u })} />
          </Rotulo>
          <label className="flex items-start gap-2 text-sm text-tinta">
            <input type="checkbox" className="mt-1 accent-[var(--marca)]" checked={d.soHorarioLoja} onChange={(e) => p.aoMudar({ ...d, soHorarioLoja: e.target.checked })} />
            <span>
              Só continuar com a loja aberta
              <span className="block text-xs text-tinta-3">
                {p.horario.texto
                  ? p.horario.entendido
                    ? `Horário da loja: ${p.horario.texto}`
                    : `Não entendemos o horário "${p.horario.texto}" (Lojas). A espera vai ignorar o horário.`
                  : 'A loja não tem horário cadastrado (Lojas). A espera vai ignorar o horário.'}
              </span>
            </span>
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-tinta">Se a pessoa escrever durante a espera</legend>
            {(
              [
                ['esperar', 'Continua esperando o tempo todo'],
                ['continuar', 'Segue para o próximo bloco na hora'],
              ] as const
            ).map(([v, t]) => (
              <label key={v} className="flex items-center gap-2 text-sm text-tinta">
                <input type="radio" name={`resp-${no.id}`} className="accent-[var(--marca)]" checked={d.aoResponder === v} onChange={() => p.aoMudar({ ...d, aoResponder: v })} />
                {t}
              </label>
            ))}
          </fieldset>
        </div>
      )
    }
    case 'aguardar_resposta': {
      const d = no.dados
      return (
        <div className="flex flex-col gap-3">
          <Rotulo titulo="Esperar a resposta por até" dica="Respondeu: sai por “respondeu”, e o que ela escreveu vira {resposta}. Passou o prazo: sai por “não respondeu”.">
            <Tempo quantidade={d.quantidade} unidade={d.unidade} aoMudar={(q, u) => p.aoMudar({ ...d, quantidade: q, unidade: u })} />
          </Rotulo>
        </div>
      )
    }
    case 'condicao': {
      const d = no.dados
      return (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-tinta-2">
            Olha a última resposta da pessoa. A primeira regra que tiver uma das palavras decide o caminho; nenhuma, vai por “qualquer outra coisa”. Sem acento e sem maiúscula.
          </p>
          {d.regras.map((r, i) => (
            <div key={r.id} className="flex flex-col gap-2 rounded-norte border border-borda p-2.5">
              <div className="flex gap-2">
                <input
                  value={r.rotulo}
                  maxLength={40}
                  placeholder={`Caminho ${i + 1}`}
                  aria-label="Nome do caminho"
                  onChange={(e) => p.aoMudar({ regras: d.regras.map((x) => (x.id === r.id ? { ...x, rotulo: e.target.value } : x)) })}
                  className={campo}
                />
                <Botao tom="discreto" onClick={() => p.aoMudar({ regras: d.regras.filter((x) => x.id !== r.id) })} aria-label="Tirar caminho">
                  ×
                </Botao>
              </div>
              <input
                defaultValue={r.palavras.join(', ')}
                placeholder="sim, quero, 1"
                aria-label="Palavras"
                onChange={(e) =>
                  p.aoMudar({
                    regras: d.regras.map((x) =>
                      x.id === r.id ? { ...x, palavras: e.target.value.split(',').map((w) => w.trim()).filter(Boolean).slice(0, 20) } : x,
                    ),
                  })
                }
                className={campo}
              />
            </div>
          ))}
          {d.regras.length < 10 && (
            <Botao tom="secundario" onClick={() => p.aoMudar({ regras: [...d.regras, { id: novoId('r'), rotulo: '', palavras: [] }] })}>
              + Caminho
            </Botao>
          )}
        </div>
      )
    }
    case 'distribuidor': {
      const d = no.dados
      const total = d.ramos.reduce((s, r) => s + r.peso, 0)
      return (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-tinta-2">
            Divide quem passa por aqui, pelos pesos — para comparar duas mensagens. A mesma pessoa cai sempre no mesmo caminho.
          </p>
          {d.ramos.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <input
                value={r.rotulo}
                maxLength={30}
                aria-label="Nome do caminho"
                onChange={(e) => p.aoMudar({ ramos: d.ramos.map((x) => (x.id === r.id ? { ...x, rotulo: e.target.value } : x)) })}
                className={campo}
              />
              <input
                type="number"
                min={0}
                max={100}
                value={r.peso}
                aria-label="Peso"
                onChange={(e) => p.aoMudar({ ramos: d.ramos.map((x) => (x.id === r.id ? { ...x, peso: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } : x)) })}
                className={cx(campo, 'w-20')}
              />
              <span className="w-10 text-right text-xs tabular-nums text-tinta-3">{total ? Math.round((r.peso / total) * 100) : 0}%</span>
              {d.ramos.length > 2 && (
                <Botao tom="discreto" aria-label="Tirar caminho" onClick={() => p.aoMudar({ ramos: d.ramos.filter((x) => x.id !== r.id) })}>
                  ×
                </Botao>
              )}
            </div>
          ))}
          {d.ramos.length < 6 && (
            <Botao
              tom="secundario"
              onClick={() => p.aoMudar({ ramos: [...d.ramos, { id: novoId('c'), rotulo: String.fromCharCode(65 + d.ramos.length), peso: 50 }] })}
            >
              + Caminho
            </Botao>
          )}
        </div>
      )
    }
    case 'passar_para_pessoa': {
      const d = no.dados
      return (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-tinta-2">
            Manda para a equipe o nome, o WhatsApp e a última mensagem da pessoa, e encerra a campanha. Por 24 horas nenhuma campanha fala com esse número.
          </p>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-sm font-medium text-tinta">Quem recebe</legend>
            <label className="flex items-center gap-2 text-sm text-tinta">
              <input type="radio" name={`para-${no.id}`} className="accent-[var(--marca)]" checked={d.para === 'donos'} onChange={() => p.aoMudar({ ...d, para: 'donos' })} />
              Os donos
            </label>
            <label className="flex items-center gap-2 text-sm text-tinta">
              <input type="radio" name={`para-${no.id}`} className="accent-[var(--marca)]" checked={d.para === 'pessoas'} onChange={() => p.aoMudar({ ...d, para: 'pessoas' })} />
              Pessoas que eu escolher
            </label>
          </fieldset>
          {d.para === 'pessoas' && (
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {p.equipe.map((u) => (
                <li key={u.id}>
                  <label className={cx('flex items-center gap-2 text-sm', u.temTelefone ? 'text-tinta' : 'text-tinta-3')}>
                    <input
                      type="checkbox"
                      className="accent-[var(--marca)]"
                      disabled={!u.temTelefone}
                      checked={d.usuarioIds.includes(u.id)}
                      onChange={(e) =>
                        p.aoMudar({ ...d, usuarioIds: e.target.checked ? [...d.usuarioIds, u.id] : d.usuarioIds.filter((x) => x !== u.id) })
                      }
                    />
                    {u.nome}
                    {!u.temTelefone && <span className="text-xs">(sem telefone em Equipe)</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {d.para === 'donos' && !p.equipe.some((u) => u.dono && u.temTelefone) && (
            <Aviso nivel="atencao">Nenhum dono tem telefone cadastrado em Equipe: ninguém seria avisado.</Aviso>
          )}
          <Rotulo titulo="Mensagem para a pessoa (opcional)" dica="Ex.: “Já chamei alguém da loja, {primeiro_nome}. Um instante!”">
            <textarea rows={3} maxLength={1000} value={d.mensagemContato} onChange={(e) => p.aoMudar({ ...d, mensagemContato: e.target.value })} className={campo} />
          </Rotulo>
        </div>
      )
    }
    case 'conectar': {
      const d = no.dados
      return (
        <div className="flex flex-col gap-3">
          <Rotulo titulo="Ir para a campanha" dica="Esta campanha termina aqui e a pessoa começa a outra, do Início dela. A outra precisa estar ativa.">
            <select value={d.campanhaId ?? ''} onChange={(e) => p.aoMudar({ campanhaId: e.target.value || null })} className={campo}>
              <option value="">Escolha…</option>
              {p.outras.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nome}
                </option>
              ))}
            </select>
          </Rotulo>
        </div>
      )
    }
    case 'fim': {
      const d = no.dados
      return (
        <div className="flex flex-col gap-3">
          <Rotulo titulo="Última mensagem (opcional)" dica="Depois do fim, nada mais é enviado para a pessoa por esta campanha.">
            <textarea rows={4} maxLength={4000} value={d.texto} onChange={(e) => p.aoMudar({ texto: e.target.value })} className={campo} />
          </Rotulo>
        </div>
      )
    }
  }
}

// ─────────────────────────────────────────────────────────────

function FormInicio({ g, aoMudar }: { g: Gatilho; aoMudar: (g: Gatilho) => void }) {
  const [frases, setFrases] = useState(g.frases.join('\n'))
  const [anuncios, setAnuncios] = useState(g.anuncioIds.join('\n'))
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-sm font-medium text-tinta">Como a pessoa entra</legend>
        <label className="flex items-center gap-2 text-sm text-tinta">
          <input type="radio" name="tipo-gatilho" className="accent-[var(--marca)]" checked={g.tipo === 'frase'} onChange={() => aoMudar({ ...g, tipo: 'frase' })} />
          Escrevendo uma frase (ou pelo anúncio)
        </label>
        <label className="flex items-center gap-2 text-sm text-tinta">
          <input type="radio" name="tipo-gatilho" className="accent-[var(--marca)]" checked={g.tipo === 'manual'} onChange={() => aoMudar({ ...g, tipo: 'manual' })} />
          Só vindo de outra campanha (ou no teste)
        </label>
      </fieldset>
      {g.tipo === 'frase' && (
        <>
          <Rotulo titulo="Frases, uma por linha" dica="Entra quem escrever a frase, em qualquer parte da mensagem, sem ligar para acento ou maiúscula. Frase com menos de 3 letras é ignorada.">
            <textarea
              rows={4}
              value={frases}
              placeholder={'quero o catálogo\npromoção de verão'}
              onChange={(e) => {
                setFrases(e.target.value)
                aoMudar({ ...g, frases: linhas(e.target.value).slice(0, 50) })
              }}
              className={campo}
            />
          </Rotulo>
          <Rotulo titulo="Anúncios (opcional), um id por linha" dica="O id do anúncio de clique para WhatsApp, quando o número está ligado a ele. Tem prioridade sobre a frase.">
            <textarea
              rows={2}
              value={anuncios}
              onChange={(e) => {
                setAnuncios(e.target.value)
                aoMudar({ ...g, anuncioIds: linhas(e.target.value).slice(0, 50) })
              }}
              className={cx(campo, 'font-mono text-xs')}
            />
          </Rotulo>
        </>
      )}
      <Rotulo titulo="Quem já passou pode entrar de novo?">
        <select
          value={g.reentrada}
          onChange={(e) => {
            const r = e.target.value as Reentrada
            aoMudar({ ...g, reentrada: r, ...(r === 'depois' ? { reentradaDias: g.reentradaDias ?? 7 } : {}) })
          }}
          className={campo}
        >
          <option value="nunca">Não — uma vez por pessoa</option>
          <option value="depois">Sim, depois de alguns dias</option>
          <option value="sempre">Sim, sempre que escrever a frase</option>
        </select>
      </Rotulo>
      {g.reentrada === 'depois' && (
        <Rotulo titulo="Dias até poder entrar de novo">
          <input
            type="number"
            min={1}
            max={365}
            value={g.reentradaDias ?? 7}
            onChange={(e) => aoMudar({ ...g, reentradaDias: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
            className={cx(campo, 'w-28')}
          />
        </Rotulo>
      )}
    </div>
  )
}

function FormMensagem({ d, aoMudar }: { d: DadosPorTipo['mensagem']; aoMudar: (d: DadosPorTipo['mensagem']) => void }) {
  const refs = useRef<(HTMLTextAreaElement | null)[]>([])
  const [foco, setFoco] = useState(0)
  const mudarTexto = (i: number, t: string) => aoMudar({ ...d, textos: d.textos.map((x, j) => (j === i ? t : x)) })
  const inserir = (c: string) => {
    const el = refs.current[foco]
    const atual = d.textos[foco] ?? ''
    const ini = el?.selectionStart ?? atual.length
    const fim = el?.selectionEnd ?? atual.length
    mudarTexto(foco, atual.slice(0, ini) + c + atual.slice(fim))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(ini + c.length, ini + c.length)
    })
  }
  return (
    <div className="flex flex-col gap-3">
      {d.textos.map((t, i) => (
        <Rotulo key={i} titulo={i === 0 ? 'Mensagem' : `Variação ${i}`}>
          <div className="flex gap-2">
            <textarea
              ref={(el) => {
                refs.current[i] = el
              }}
              rows={i === 0 ? 5 : 3}
              maxLength={4000}
              value={t}
              onFocus={() => setFoco(i)}
              onChange={(e) => mudarTexto(i, e.target.value)}
              className={campo}
            />
            {i > 0 && (
              <Botao tom="discreto" aria-label="Tirar variação" onClick={() => aoMudar({ ...d, textos: d.textos.filter((_, j) => j !== i) })}>
                ×
              </Botao>
            )}
          </div>
        </Rotulo>
      ))}
      <Coringas aoInserir={inserir} />
      {d.textos.length < 5 && (
        <Botao tom="secundario" onClick={() => aoMudar({ ...d, textos: [...d.textos, ''] })}>
          + Variação
        </Botao>
      )}
      <p className="text-xs text-tinta-3">Com variações, cada pessoa recebe uma delas — sempre a mesma para a mesma pessoa.</p>
      <Rotulo titulo={`Esperar antes de mandar: ${d.digitandoSeg} s`} dica="Uma pausa curta faz a mensagem parecer escrita na hora. Acima de 4 segundos, ela sai no próximo minuto.">
        <input
          type="range"
          min={0}
          max={DIGITANDO_MAX_SEG}
          value={d.digitandoSeg}
          onChange={(e) => aoMudar({ ...d, digitandoSeg: Number(e.target.value) })}
          className="accent-[var(--marca)]"
        />
      </Rotulo>
    </div>
  )
}

function FormMidia({
  slug,
  d,
  aoMudar,
  midias,
  aoSubir,
}: {
  slug: string
  d: DadosPorTipo['midia']
  aoMudar: (d: DadosPorTipo['midia']) => void
  midias: MidiaNaTela[]
  aoSubir: (m: MidiaNaTela) => void
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const atual = midias.find((m) => m.id === d.midiaId)

  const escolher = (m: MidiaNaTela) =>
    aoMudar({ ...d, midiaId: m.id, tipo: m.tipo as DadosPorTipo['midia']['tipo'], nome: m.nome, comoGravado: m.tipo === 'audio' ? d.comoGravado : false })

  const subir = (arquivo: File) => {
    setErro(null)
    const c = conferirArquivo(arquivo.type, arquivo.size)
    if (!c.ok) {
      setErro(c.erro)
      return
    }
    comecar(async () => {
      const f = new FormData()
      f.set('arquivo', arquivo)
      const r = await subirMidiaAcao(slug, f)
      if (r.erro || !r.midia) {
        setErro(r.erro ?? 'Não deu para subir o arquivo.')
        return
      }
      const m = { ...r.midia, previa: r.previa ?? null }
      aoSubir(m)
      escolher(m)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {atual ? (
        <div className="flex flex-col gap-2 rounded-norte border border-borda p-2.5">
          {atual.previa && atual.tipo === 'imagem' && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={atual.previa} alt="" className="max-h-40 w-full rounded-norte object-contain" />
          )}
          {atual.previa && atual.tipo === 'audio' && <audio src={atual.previa} controls className="w-full" />}
          {atual.previa && atual.tipo === 'video' && <video src={atual.previa} controls className="max-h-40 w-full" />}
          <p className="text-xs text-tinta-2">
            {atual.nome} · {(atual.tamanho / MB).toFixed(1).replace('.', ',')} MB
          </p>
        </div>
      ) : (
        <p className="text-sm text-tinta-2">Nenhum arquivo escolhido.</p>
      )}
      <Rotulo titulo="Subir arquivo" dica="Imagem até 5 MB (JPG, PNG, WEBP). Vídeo MP4 e áudio (OGG, MP3, M4A, AAC, AMR) até 16 MB.">
        <input
          type="file"
          accept={ACEITA}
          disabled={indo}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) subir(f)
            e.target.value = ''
          }}
          className="text-sm text-tinta-2 file:mr-3 file:rounded-norte file:border file:border-borda file:bg-superficie-2 file:px-3 file:py-1.5 file:text-sm file:text-tinta"
        />
      </Rotulo>
      {indo && <p className="text-xs text-tinta-2">Subindo…</p>}
      {erro && <Aviso nivel="critico">{erro}</Aviso>}
      {midias.length > 0 && (
        <Rotulo titulo="Ou use um que já subiu">
          <select
            value={d.midiaId ?? ''}
            onChange={(e) => {
              const m = midias.find((x) => x.id === e.target.value)
              if (m) escolher(m)
            }}
            className={campo}
          >
            <option value="">Escolha…</option>
            {midias.map((m) => (
              <option key={m.id} value={m.id}>
                {m.tipo} · {m.nome}
              </option>
            ))}
          </select>
        </Rotulo>
      )}
      {d.tipo === 'audio' ? (
        <label className="flex items-center gap-2 text-sm text-tinta">
          <input type="checkbox" className="accent-[var(--marca)]" checked={d.comoGravado} onChange={(e) => aoMudar({ ...d, comoGravado: e.target.checked })} />
          Mandar como áudio gravado (nota de voz)
        </label>
      ) : (
        <Rotulo titulo="Legenda (opcional)">
          <textarea rows={3} maxLength={1000} value={d.legenda} onChange={(e) => aoMudar({ ...d, legenda: e.target.value })} className={campo} />
        </Rotulo>
      )}
    </div>
  )
}
