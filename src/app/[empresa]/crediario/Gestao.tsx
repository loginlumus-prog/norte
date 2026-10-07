'use client'

// A gestão do crediário de UMA cliente, na tela do Crediário (o lado da
// gerente): quitou tudo, pausar a cobrança, lançar dívida na mão, as
// anotações da ficha e juntar a ficha repetida. Receber continua no botão
// "Receber parcela" (e o "já pagou fora" por seleção ou valor fica lá).
//
// Cada pedaço é um <details>: a tela abre fechada, com o resumo da cliente à
// vista, e a gerente abre só o que vai fazer. Os que mexem em dinheiro ou em
// ficha pedem confirmação (ou o PIN) antes de gravar.
//
// Depois de gravar, quem atualiza a tela é o `revalidatePath` da própria ação
// (acoesGestao.ts) — sem `router.refresh()` a mais: dois desenhos da página ao
// mesmo tempo são o dobro de consultas, e no banco do laptop uma briga entre
// elas.

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { Aviso, Botao, Campo, Situacao, cx } from '@/ui/base'
import { BotaoDaLinha, IconeDaAcao, classeDaAcao } from '@/ui/premium'
import { CampoDoPin, MotivosProntos } from '@/ui/Assinar'
import type { FichaDeGestao } from '@/servidor/crediario-gestao'
import {
  anotarAcao,
  juntarFichasAcao,
  lancarDividaAcao,
  pausarCobrancaAcao,
  procurarFichasAcao,
  quitouTudoAcao,
  type EstadoGestao,
} from './acoesGestao'

const brlC = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const quando = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d))

export function Gestao({
  slug,
  ficha,
  lojasQueCobra,
  lojaAtual,
  hoje,
  primeiroVencimento,
}: {
  slug: string
  ficha: FichaDeGestao
  /** As lojas em que quem olha negocia o crediário (pode quitar e lançar dívida). */
  lojasQueCobra: { id: string; nome: string }[]
  lojaAtual: string | null
  /** "AAAA-MM-DD" de hoje em São Paulo. */
  hoje: string
  /** O 1º vencimento que a tela sugere para a dívida lançada. */
  primeiroVencimento: string
}) {
  const c = ficha.cliente
  const cobraEm = (u: string) => lojasQueCobra.some((l) => l.id === u)

  if (ficha.juntadaNa) {
    return (
      <Aviso nivel="neutro">
        Esta ficha foi juntada na de{' '}
        <Link href={`/${slug}/crediario?cliente=${ficha.juntadaNa.id}`} className="font-semibold underline underline-offset-2">
          {ficha.juntadaNa.nome}
        </Link>
        . Vendas, parcelas e recibos estão lá.
      </Aviso>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ── o resumo ── */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {ficha.lojas.length === 0 ? (
          <span className="text-tinta-2">Não deve nada nas lojas que você vê.</span>
        ) : (
          ficha.lojas.map((l) => (
            <span key={l.unidadeId} className="rounded-full border border-borda bg-superficie px-3 py-1">
              <b className="numero">{brlC(l.devendoC)}</b> em {l.nome}
              {l.vencidoC > 0 && <span className="numero font-semibold text-critico"> · {brlC(l.vencidoC)} vencido</span>}
            </span>
          ))
        )}
        {ficha.pausa ? (
          <Situacao nivel="atencao">cobrança pausada</Situacao>
        ) : (
          <Situacao nivel="neutro">cobrança normal</Situacao>
        )}
      </div>
      {ficha.pausa && (
        <p className="text-xs text-tinta-2">
          Pausada em {quando(ficha.pausa.desde)}
          {ficha.pausa.por ? ` por ${ficha.pausa.por}` : ''}
          {ficha.pausa.motivo ? ` — ${ficha.pausa.motivo}` : ''}. A dívida continua no carnê; ela só sai da lista de quem cobrar.
        </p>
      )}

      {ficha.parecidas.length > 0 && ficha.pode.juntar && (
        <Aviso nivel="atencao">
          Parece haver outra ficha da mesma pessoa:{' '}
          {ficha.parecidas.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <b>{p.nome}</b> (mesmo {p.por}
              {p.devendoC > 0 ? `, deve ${brlC(p.devendoC)}` : ''})
            </span>
          ))}
          . Confira e junte em “Juntar com outra ficha”.
        </Aviso>
      )}

      <div className="flex flex-col gap-2">
        {ficha.pode.cobrar &&
          ficha.lojas
            .filter((l) => cobraEm(l.unidadeId))
            .map((l) => (
              <Painel key={l.unidadeId} titulo={`Quitou tudo em ${l.nome} (${brlC(l.devendoC)})`}>
                <QuitouTudo slug={slug} clienteId={c.id} unidadeId={l.unidadeId} devendoC={l.devendoC} hoje={hoje} />
              </Painel>
            ))}
        {ficha.pode.cobrar && (
          <Painel titulo={ficha.pausa ? 'Retomar a cobrança' : 'Pausar a cobrança desta pessoa'}>
            <Pausar slug={slug} clienteId={c.id} pausada={!!ficha.pausa} />
          </Painel>
        )}
        {ficha.pode.cobrar && lojasQueCobra.length > 0 && (
          <Painel titulo="Lançar dívida na mão">
            <LancarDivida slug={slug} clienteId={c.id} lojas={lojasQueCobra} lojaAtual={lojaAtual} primeiroVencimento={primeiroVencimento} />
          </Painel>
        )}
        <Painel titulo={`Anotações da ficha${ficha.notas.length ? ` (${ficha.notas.length})` : ''}`} aberto={ficha.notas.length > 0}>
          <Notas slug={slug} clienteId={c.id} notas={ficha.notas} podeAnotar={ficha.pode.anotar} />
        </Painel>
        {ficha.pode.juntar && (
          <Painel titulo="Juntar com outra ficha (a mesma pessoa cadastrada duas vezes)">
            <Juntar slug={slug} cliente={{ id: c.id, nome: c.nome }} parecidas={ficha.parecidas} />
          </Painel>
        )}
      </div>
    </div>
  )
}

function Painel({ titulo, aberto, children }: { titulo: string; aberto?: boolean; children: ReactNode }) {
  return (
    <details open={aberto} className="rounded-norte border border-borda-suave bg-superficie px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold text-tinta">{titulo}</summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  )
}

function Resposta({ estado }: { estado: EstadoGestao }) {
  if (estado.erro) return <Aviso nivel="critico">{estado.erro}</Aviso>
  if (estado.ok) return <Aviso nivel="bom">{estado.ok}</Aviso>
  return null
}

// ── quitou tudo ──────────────────────────────────────────────

function QuitouTudo({ slug, clienteId, unidadeId, devendoC, hoje }: { slug: string; clienteId: string; unidadeId: string; devendoC: number; hoje: string }) {
  const [referencia, setReferencia] = useState('')
  const [pagoEm, setPagoEm] = useState(hoje)
  const [pin, setPin] = useState('')
  const [pedePin, setPedePin] = useState(false)
  const [certeza, setCerteza] = useState(false)
  const [estado, setEstado] = useState<EstadoGestao>({})
  const [indo, comecar] = useTransition()

  function enviar() {
    setEstado({})
    comecar(async () => {
      const r = await quitouTudoAcao(slug, { clienteId, unidadeId, referencia, pagoEm, pin: pin || null })
      setPin('')
      setEstado(r)
      if (r.precisaPin) setPedePin(true)
    })
  }

  if (estado.ok) return <Resposta estado={estado} />
  return (
    <>
      <p className="text-[13px] text-tinta-2">
        Para o acordo fechado ou o pagamento feito <b>fora daqui</b> (no outro sistema, na conta da loja): dá baixa no carnê
        inteiro desta loja. Não entra no caixa nem no resultado — o dinheiro não passou por aqui.
      </p>
      <Resposta estado={estado} />
      <MotivosProntos excecao="crediario.quitou" atual={referencia} aoEscolher={setReferencia} />
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Campo rotulo="De onde veio" name="referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="acordo de quitação, recibo 123 do outro sistema" maxLength={120} />
        <Campo rotulo="Pago em" name="pagoEm" type="date" max={hoje} value={pagoEm} onChange={(e) => setPagoEm(e.target.value)} />
      </div>
      {pedePin && <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} aoEnviar={enviar} />}
      <label className="flex items-center gap-2 text-sm text-tinta">
        <input type="checkbox" checked={certeza} onChange={(e) => setCerteza(e.target.checked)} />
        Confere: ela pagou os {brlC(devendoC)} (ou fechou acordo) e não deve mais nada nesta loja.
      </label>
      <div>
        <Botao tom="confirmar" carregando={indo} disabled={!certeza || referencia.trim().length < 3} onClick={enviar}>
          Dar baixa de tudo ({brlC(devendoC)})
        </Botao>
      </div>
    </>
  )
}

// ── pausar ───────────────────────────────────────────────────

function Pausar({ slug, clienteId, pausada }: { slug: string; clienteId: string; pausada: boolean }) {
  const [motivo, setMotivo] = useState('')
  const [estado, setEstado] = useState<EstadoGestao>({})
  const [indo, comecar] = useTransition()
  return (
    <>
      <p className="text-[13px] text-tinta-2">
        {pausada
          ? 'Ela volta para a lista de quem cobrar (o “fiado vencido” do painel e “quem cobrar primeiro”).'
          : 'Acordo em andamento, advogado, doença na família: a dívida continua no carnê, mas ela sai da lista de quem cobrar — em todas as lojas.'}
      </p>
      <Resposta estado={estado} />
      <Campo
        rotulo={pausada ? 'Por que retomar (opcional)' : 'Por que pausar'}
        name="motivo"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder={pausada ? 'acordo não foi cumprido' : 'fechou acordo para pagar em novembro'}
        maxLength={200}
      />
      <div>
        <Botao
          tom={pausada ? 'principal' : 'secundario'}
          carregando={indo}
          disabled={!pausada && motivo.trim().length < 3}
          onClick={() =>
            comecar(async () => {
              const r = await pausarCobrancaAcao(slug, clienteId, !pausada, motivo)
              setEstado(r)
              if (r.ok) setMotivo('')
            })
          }
        >
          {pausada ? 'Retomar a cobrança' : 'Pausar a cobrança'}
        </Botao>
      </div>
    </>
  )
}

// ── lançar dívida ────────────────────────────────────────────

function LancarDivida({
  slug,
  clienteId,
  lojas,
  lojaAtual,
  primeiroVencimento,
}: {
  slug: string
  clienteId: string
  lojas: { id: string; nome: string }[]
  lojaAtual: string | null
  primeiroVencimento: string
}) {
  const [unidadeId, setUnidadeId] = useState(lojaAtual && lojas.some((l) => l.id === lojaAtual) ? lojaAtual : (lojas[0]?.id ?? ''))
  const [valor, setValor] = useState('')
  const [parcelas, setParcelas] = useState('1')
  const [venc, setVenc] = useState(primeiroVencimento)
  const [descricao, setDescricao] = useState('')
  const [motivo, setMotivo] = useState('')
  const [estado, setEstado] = useState<EstadoGestao>({})
  const [indo, comecar] = useTransition()

  if (estado.ok) {
    return (
      <span className="flex flex-col gap-2">
        <Resposta estado={estado} />
        {estado.vendaId && (
          <span className="self-start">
            <BotaoDaLinha href={`/${slug}/vendas/${estado.vendaId}/carne`} icone="imprimir" rotulo="Imprimir o carnê" comRotulo />
          </span>
        )}
      </span>
    )
  }
  return (
    <>
      <p className="text-[13px] text-tinta-2">
        A dívida que nunca passou por sistema nenhum (o caderno, o conserto, o combinado). Vira um carnê com as parcelas,
        como o saldo trazido do sistema anterior: não mexe no estoque e não entra como venda nem como receita do mês.
      </p>
      <Resposta estado={estado} />
      <div className="grid gap-3 sm:grid-cols-4">
        {lojas.length > 1 && (
          <label className="flex flex-col gap-1.5 text-sm font-medium text-tinta">
            Deve para
            <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta">
              {lojas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        <Campo rotulo="Quanto (R$)" name="valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="350,00" />
        <Campo rotulo="Em quantas vezes" name="parcelas" type="number" min={1} max={24} value={parcelas} onChange={(e) => setParcelas(e.target.value)} />
        <Campo rotulo="1º vencimento" name="vencimento" type="date" value={venc} onChange={(e) => setVenc(e.target.value)} />
      </div>
      <Campo rotulo="O que é (sai no carnê)" name="descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="caderno de 2025" maxLength={120} />
      <Campo rotulo="De onde vem a dívida (fica no livro)" name="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="compras anotadas no caderno da loja" maxLength={200} />
      <div>
        <Botao
          carregando={indo}
          disabled={!valor.trim() || motivo.trim().length < 3 || !unidadeId}
          onClick={() =>
            comecar(async () => {
              const r = await lancarDividaAcao(slug, { clienteId, unidadeId, valor, parcelas: Number(parcelas), primeiroVencimento: venc, descricao, motivo })
              setEstado(r)
                    })
          }
        >
          Lançar a dívida
        </Botao>
      </div>
    </>
  )
}

// ── anotações ────────────────────────────────────────────────

function Notas({
  slug,
  clienteId,
  notas,
  podeAnotar,
}: {
  slug: string
  clienteId: string
  notas: FichaDeGestao['notas']
  podeAnotar: boolean
}) {
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState<EstadoGestao>({})
  const [indo, comecar] = useTransition()
  return (
    <>
      {podeAnotar && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Campo rotulo="Nova anotação" name="nota" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="ligou, vai pagar dia 10" maxLength={300} />
          </div>
          <Botao
            tom="secundario"
            carregando={indo}
            disabled={texto.trim().length < 2}
            onClick={() =>
              comecar(async () => {
                const r = await anotarAcao(slug, clienteId, texto)
                setEstado(r.erro ? r : {})
                if (r.ok) setTexto('')
              })
            }
          >
            Anotar
          </Botao>
        </div>
      )}
      <Resposta estado={estado} />
      {notas.length === 0 ? (
        <p className="text-sm text-tinta-3">Nenhuma anotação ainda.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-borda-suave text-sm">
          {notas.map((n, i) => (
            <li key={i} className="py-1.5">
              {n.dia && <span className="numero text-xs text-tinta-3">{n.dia}</span>}
              {n.quem && <span className="text-xs font-semibold text-tinta-2"> · {n.quem}</span>}
              <span className={cx('block text-tinta', !n.dia && 'text-tinta-2')}>{n.texto}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

// ── juntar fichas ────────────────────────────────────────────

type Achada = { id: string; nome: string; telefone: string | null; documento?: string | null }

function Juntar({ slug, cliente, parecidas }: { slug: string; cliente: { id: string; nome: string }; parecidas: FichaDeGestao['parecidas'] }) {
  const [termo, setTermo] = useState('')
  const [achadas, setAchadas] = useState<Achada[]>([])
  const [outra, setOutra] = useState<Achada | null>(null)
  const [ficaEsta, setFicaEsta] = useState(true)
  const [motivo, setMotivo] = useState('')
  const [pin, setPin] = useState('')
  const [estado, setEstado] = useState<EstadoGestao>({})
  const [indo, comecar] = useTransition()

  // Espera a digitação parar: buscar a cada tecla faz a lista piscar.
  useEffect(() => {
    const t = setTimeout(() => {
      if (termo.trim().length < 2) return setAchadas([])
      procurarFichasAcao(slug, termo, cliente.id).then(setAchadas)
    }, 250)
    return () => clearTimeout(t)
  }, [termo, slug, cliente.id])

  if (estado.ok) {
    return (
      <span className="flex flex-col gap-2">
        <Resposta estado={estado} />
        {estado.fica && estado.fica !== cliente.id && (
          <span className="self-start">
            <BotaoDaLinha principal href={`/${slug}/crediario?cliente=${estado.fica}`} icone="abrir" rotulo="Abrir a ficha que ficou" />
          </span>
        )}
      </span>
    )
  }

  const fica = ficaEsta ? cliente : outra
  const sai = ficaEsta ? outra : cliente
  return (
    <>
      <p className="text-[13px] text-tinta-2">
        Leva vendas, parcelas, recibos, vales, pontos, encomendas e horários da ficha que sai para a que fica. A que sai fica
        inativa, apontando para a outra. Mexe na dívida de uma pessoa: pede o seu PIN, sempre.
      </p>
      <Resposta estado={estado} />
      {!outra ? (
        <>
          {parecidas.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {parecidas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setOutra({ id: p.id, nome: p.nome, telefone: p.telefone })}
                  className="rounded-full border border-borda px-3 py-1 text-xs font-medium text-tinta-2 hover:bg-superficie-2"
                >
                  {p.nome} · mesmo {p.por}
                </button>
              ))}
            </div>
          )}
          <Campo rotulo="Procurar a outra ficha" name="outra" value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="nome, telefone ou CPF" />
          {achadas.length > 0 && (
            <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda-suave">
              {achadas.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setOutra(a)} className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-superficie-2">
                    <span className="font-semibold text-tinta">{a.nome}</span>
                    <span className="text-xs text-tinta-3">{[a.telefone, a.documento].filter(Boolean).join(' · ') || 'sem telefone nem CPF'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold text-tinta">Qual ficha fica?</span>
            <label className="flex items-center gap-2">
              <input type="radio" checked={ficaEsta} onChange={() => setFicaEsta(true)} />
              Fica <b>{cliente.nome}</b> (esta) — a outra entra nela
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={!ficaEsta} onChange={() => setFicaEsta(false)} />
              Fica <b>{outra.nome}</b> — esta entra nela
            </label>
            <button type="button" onClick={() => setOutra(null)} className={cx(classeDaAcao({ jeito: 'pilula' }), 'self-start')}>
              <IconeDaAcao icone="trocar" tamanho={15} />
              Escolher outra ficha
            </button>
          </div>
          <MotivosProntos excecao="cliente.juntar" atual={motivo} aoEscolher={setMotivo} />
          <Campo rotulo="Por que são a mesma pessoa" name="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
          <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} foco={false} />
          <div>
            <Botao
              tom="perigo"
              carregando={indo}
              disabled={motivo.trim().length < 3 || pin.length < 4 || !fica || !sai}
              onClick={() =>
                comecar(async () => {
                  const r = await juntarFichasAcao(slug, { ficaId: fica!.id, saiId: sai!.id, motivo, pin })
                  setPin('')
                  setEstado(r)
                            })
              }
            >
              Juntar: “{sai?.nome}” entra em “{fica?.nome}”
            </Botao>
          </div>
        </>
      )}
    </>
  )
}
