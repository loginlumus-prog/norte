'use client'

// Os botões de cada encomenda: pronta, entregue, cancelar, mudar.
//
// Entregar e cancelar abrem uma pergunta ANTES de gravar, numa janela por
// cima da lista — são as duas mudanças que não voltam, e as duas mexem com
// dinheiro. Janela, e não painel dentro da linha: na tabela do modo avançado
// a célula de ações é estreita, e a pergunta espremida ali virava rolagem de
// lado.
//
// ── entregar e o balcão ──────────────────────────────────────
// O que falta pagar é recebido no Balcão, como venda. Esta tela NÃO registra
// venda nenhuma: "Receber no balcão" abre o Balcão DA LOJA da encomenda com a
// encomenda no endereço, e a linha "Encomenda ENC-…" já entra no pedido pelo
// valor que falta — só o que falta, porque o sinal já entrou no financeiro.
// A entrega é marcada pela venda, quando ela fecha (ver servidor/venda.ts):
// antes, a encomenda virava "entregue" aqui e o dinheiro podia nunca entrar.
//
// O pedido do catálogo (com produto do cadastro) só sai pelo Balcão, mesmo
// pago todo no sinal: é lá que os produtos baixam do estoque. E entregar a de
// balcão com dinheiro em aberto, sem venda, é abrir mão do que falta — pede o
// porquê e, para quem não autoriza desconto, o PIN de quem autoriza.

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Marcar, Selecao, cx } from '@/ui/base'
import { brl } from '@/ui/painel'
import { aceitarEncomendaAcao, mudarSituacaoAcao } from './acoes'

type Situacao = 'ABERTA' | 'PRONTA' | 'ENTREGUE' | 'CANCELADA'
type FormaSinal = 'DINHEIRO' | 'PIX' | 'DEBITO' | 'CREDITO' | 'TRANSFERENCIA'

/** Como o sinal volta ao cliente. Cartão se estorna na maquininha, por fora. */
const FORMAS_DEVOLUCAO: { valor: FormaSinal; titulo: string }[] = [
  { valor: 'DINHEIRO', titulo: 'Dinheiro (sai da gaveta)' },
  { valor: 'PIX', titulo: 'Pix' },
  { valor: 'TRANSFERENCIA', titulo: 'Transferência' },
  { valor: 'DEBITO', titulo: 'Estorno no débito' },
  { valor: 'CREDITO', titulo: 'Estorno no crédito' },
]

/** A janela por cima da tela. Esc ou clique fora fecha. */
function Janela({ titulo, aoFechar, children }: { titulo: string; aoFechar: () => void; children: ReactNode }) {
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => ev.key === 'Escape' && aoFechar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aoFechar])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div aria-hidden onClick={aoFechar} className="absolute inset-0 bg-nav/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="relative flex max-h-[90vh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-norte border border-borda bg-superficie p-4 shadow-norte-alta"
      >
        <h2 className="text-[15px] font-bold text-tinta">{titulo}</h2>
        {children}
      </div>
    </div>
  )
}

export function AcoesEncomenda({
  slug,
  id,
  unidadeId,
  resumo,
  situacao,
  falta,
  sinal,
  sinalForma,
  podeMexer,
  podeCancelar,
  podeVender,
  editarEm,
  simples,
  nova = false,
  comProdutos = false,
}: {
  slug: string
  id: string
  /** A loja da encomenda: o balcão abre nela. */
  unidadeId: string
  /** "Marta — Bolo de chocolate 2 kg": para a janela dizer de qual se trata. */
  resumo: string
  situacao: Situacao
  falta: number
  sinal: number
  /** Como o sinal foi pago: a devolução sugere o mesmo caminho de volta. */
  sinalForma: FormaSinal | null
  podeMexer: boolean
  podeCancelar: boolean
  /** Pode abrir o balcão (vender) nesta loja. */
  podeVender: boolean
  editarEm: string
  simples: boolean
  /** Pedido do catálogo que ninguém aceitou ainda: o primeiro botão é "Aceitar". */
  nova?: boolean
  /** Tem produto do cadastro (pedido do catálogo): sai só pelo Balcão. */
  comProdutos?: boolean
}) {
  const [painel, setPainel] = useState<null | 'entregar' | 'cancelar'>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [devolveu, setDevolveu] = useState(false)
  const [formaDevolucao, setFormaDevolucao] = useState<FormaSinal | ''>(sinalForma ?? '')
  /** "Só marcar entregue" aberto: o porquê (e o PIN, quando o servidor pede). */
  const [semBalcao, setSemBalcao] = useState(false)
  const [porque, setPorque] = useState('')
  const [pin, setPin] = useState('')
  const [pedePin, setPedePin] = useState(false)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (situacao === 'ENTREGUE' || situacao === 'CANCELADA' || (!podeMexer && !podeCancelar)) return null

  const grande = simples ? 'px-4 py-2.5 text-sm' : 'px-2.5 py-1 text-xs'
  // Na janela há espaço: botão de tamanho normal nos dois modos.
  const normal = 'px-3 py-2 text-sm'

  function mudar(m: Parameters<typeof mudarSituacaoAcao>[2], depois?: () => void) {
    setErro(null)
    comecar(async () => {
      const r = await mudarSituacaoAcao(slug, id, m)
      if (r.erro) {
        setErro(r.erro)
        if (r.pedePin) setPedePin(true)
        return
      }
      setPin('')
      setPainel(null)
      depois?.()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={cx('flex flex-wrap gap-1.5', simples && 'gap-2')}>
        {podeMexer && nova && (
          <Botao
            className={grande}
            carregando={indo}
            title="A cliente recebe o aviso de que a loja aceitou (se o WhatsApp do assistente estiver ligado)."
            onClick={() => {
              setErro(null)
              comecar(async () => {
                const r = await aceitarEncomendaAcao(slug, id)
                if (r.erro) setErro(r.erro)
              })
            }}
          >
            Aceitar pedido
          </Botao>
        )}
        {podeMexer && situacao === 'ABERTA' && (
          <Botao tom="secundario" className={grande} carregando={indo} onClick={() => mudar({ para: 'PRONTA' })}>
            Pronta
          </Botao>
        )}
        {/* Entregar vira venda (ou abre mão do saldo): é de quem vende — o
            suporte do Norte, que só anota, não vê o botão. */}
        {podeVender && (
          <Botao tom="confirmar" className={grande} onClick={() => setPainel('entregar')}>
            Entregue
          </Botao>
        )}
        {podeMexer && (
          <Link
            href={editarEm}
            className={cx(
              'inline-flex items-center justify-center rounded-norte border border-transparent font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta',
              grande,
            )}
          >
            Mudar
          </Link>
        )}
        {podeMexer && situacao === 'PRONTA' && (
          <Botao tom="discreto" className={grande} carregando={indo} onClick={() => mudar({ para: 'ABERTA' })} title="Marcou pronta por engano? Volta para a fazer.">
            Não está pronta
          </Botao>
        )}
        {podeCancelar && (
          <Botao tom="discreto" className={grande} onClick={() => setPainel('cancelar')}>
            Cancelar
          </Botao>
        )}
      </div>

      {painel === 'entregar' && (
        <Janela titulo={`Entregar: ${resumo}`} aoFechar={() => setPainel(null)}>
          {comProdutos ? (
            <>
              <p className="text-sm text-tinta">
                {falta > 0 ? (
                  <>
                    Falta receber <b className="numero">{brl(falta)}</b>.
                  </>
                ) : (
                  <>Tudo pago no sinal.</>
                )}
              </p>
              <p className="text-xs text-tinta-2">
                Pedido do catálogo sai pelo Balcão: os produtos entram no pedido pelo preço que a cliente viu, baixam do
                estoque, e o sinal já pago é descontado{falta > 0 ? '' : ' — a venda fecha em zero'}. A entrega fica marcada
                quando a venda fechar.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {podeVender && (
                  <Botao
                    tom="confirmar"
                    className={normal}
                    carregando={indo}
                    onClick={() =>
                      router.push(
                        `/${slug}/balcao?unidade=${encodeURIComponent(unidadeId)}&encomenda=${encodeURIComponent(id)}`,
                      )
                    }
                  >
                    Receber no balcão
                  </Botao>
                )}
                <Botao tom="discreto" className={normal} onClick={() => setPainel(null)}>
                  Voltar
                </Botao>
              </div>
            </>
          ) : falta > 0 ? (
            <>
              <p className="text-sm text-tinta">
                Falta receber <b className="numero">{brl(falta)}</b>.
                {sinal > 0 && (
                  <>
                    {' '}O sinal de <span className="numero">{brl(sinal)}</span> já está no financeiro.
                  </>
                )}
              </p>
              <p className="text-xs text-tinta-2">
                O cliente vai pagar agora? “Receber no balcão” abre o Balcão com a encomenda já no pedido, por{' '}
                <b className="numero">{brl(falta)}</b> — só o que falta. A entrega fica marcada quando a venda fechar.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {podeVender && (
                  <Botao
                    tom="confirmar"
                    className={normal}
                    carregando={indo}
                    onClick={() =>
                      router.push(
                        `/${slug}/balcao?unidade=${encodeURIComponent(unidadeId)}&encomenda=${encodeURIComponent(id)}`,
                      )
                    }
                  >
                    Receber no balcão
                  </Botao>
                )}
                {!semBalcao && (
                  <Botao tom="secundario" className={normal} onClick={() => setSemBalcao(true)}>
                    Só marcar entregue
                  </Botao>
                )}
                <Botao tom="discreto" className={normal} onClick={() => setPainel(null)}>
                  Voltar
                </Botao>
              </div>
              {semBalcao ? (
                <div className="flex flex-col gap-2 rounded-norte border border-borda p-3">
                  <Campo
                    rotulo="Como o resto foi pago?"
                    name={`porque-${id}`}
                    id={`porque-${id}`}
                    value={porque}
                    onChange={(ev) => setPorque(ev.currentTarget.value)}
                    placeholder="Pagou no Pix da loja ontem, a loja deu de presente..."
                    dica={`Entregar sem receber os ${brl(falta)} aqui vai para o livro, com o seu nome.`}
                    required
                  />
                  {pedePin && (
                    <Campo
                      rotulo="PIN de quem autoriza"
                      name={`pin-${id}`}
                      id={`pin-${id}`}
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={pin}
                      onChange={(ev) => setPin(ev.currentTarget.value.replace(/\D/g, '').slice(0, 12))}
                      dica="Quem pode autorizar desconto digita o PIN dela aqui."
                    />
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <Botao
                      tom="secundario"
                      className={normal}
                      carregando={indo}
                      disabled={porque.trim().length < 3 || (pedePin && pin.length < 4)}
                      onClick={() => mudar({ para: 'ENTREGUE', motivo: porque, pin: pin || null })}
                    >
                      Marcar entregue sem receber
                    </Botao>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-tinta-3">
                  “Só marcar entregue” é para quando o que faltava já foi pago de outro jeito.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm text-tinta">Tudo pago. Confirma que a encomenda saiu?</p>
              <div className="flex flex-wrap gap-1.5">
                <Botao tom="confirmar" className={normal} carregando={indo} onClick={() => mudar({ para: 'ENTREGUE' })}>
                  Confirmar entrega
                </Botao>
                <Botao tom="discreto" className={normal} onClick={() => setPainel(null)}>
                  Voltar
                </Botao>
              </div>
            </>
          )}
          {erro && <Aviso nivel="critico">{erro}</Aviso>}
        </Janela>
      )}

      {painel === 'cancelar' && (
        <Janela titulo={`Cancelar: ${resumo}`} aoFechar={() => setPainel(null)}>
          <Campo
            rotulo="Por que cancelar?"
            name={`motivo-${id}`}
            id={`motivo-${id}`}
            value={motivo}
            onChange={(ev) => setMotivo(ev.currentTarget.value)}
            placeholder="O cliente desistiu, mudou a data..."
            required
          />
          {sinal > 0 && (
            <>
              <Aviso nivel="atencao">
                Esta encomenda tem sinal de <span className="numero">{brl(sinal)}</span>. Devolva ao cliente — ou
                combine com ele que a loja fica com o sinal.
              </Aviso>
              <Marcar
                name={`devolveu-${id}`}
                id={`devolveu-${id}`}
                checked={devolveu}
                onChange={(ev) => setDevolveu(ev.currentTarget.checked)}
                titulo={`Devolvi o sinal de ${brl(sinal)}`}
                resumo="A devolução sai no financeiro de hoje. Sem marcar, o sinal fica como receita da loja."
              />
              {devolveu && (
                <Selecao
                  rotulo="Como devolveu"
                  name={`forma-devolucao-${id}`}
                  value={formaDevolucao}
                  onChange={(ev) => setFormaDevolucao(ev.currentTarget.value as FormaSinal | '')}
                  opcoes={[{ valor: '', titulo: 'Escolha…' }, ...FORMAS_DEVOLUCAO]}
                  dica={
                    formaDevolucao === 'DINHEIRO'
                      ? 'Sai da gaveta como sangria: o caixa da loja precisa estar aberto.'
                      : undefined
                  }
                />
              )}
            </>
          )}
          <div className="flex flex-wrap gap-1.5">
            <Botao
              tom="perigo"
              className={normal}
              carregando={indo}
              disabled={motivo.trim().length < 3 || (devolveu && sinal > 0 && !formaDevolucao)}
              onClick={() =>
                mudar({ para: 'CANCELADA', motivo, devolveuSinal: devolveu, formaDevolucao: formaDevolucao || null })
              }
            >
              Cancelar encomenda
            </Botao>
            <Botao tom="discreto" className={normal} onClick={() => setPainel(null)}>
              Voltar
            </Botao>
          </div>
          {erro && <Aviso nivel="critico">{erro}</Aviso>}
        </Janela>
      )}

      {erro && !painel && <Aviso nivel="critico">{erro}</Aviso>}
    </div>
  )
}
