'use client'

// O meu WhatsApp: o número, e a prova de que ele é meu.
//
// Dois jeitos de confirmar, porque cada loja fala por um caminho (Z-API, QR
// Code, WhatsApp oficial) e nem todo caminho consegue mandar o código a
// qualquer hora — o oficial só manda para quem escreveu para a loja nas
// últimas 24 horas:
//   1. "Confirmar pelo WhatsApp": o código chega no celular e a pessoa digita
//      aqui;
//   2. "Mandar eu mesmo": a tela mostra o código e a pessoa manda
//      "CONFIRMAR 123456" do celular para o WhatsApp da loja.
// Ver servidor/assistente/confirmacao.ts.

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Situacao } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import {
  confirmarCodigoAcao,
  pedirCodigoAcao,
  salvarMeuTelefoneAcao,
  type EstadoWhatsApp,
} from './acoes'

type Estado = 'sem_telefone' | 'falta_confirmar' | 'confirmado' | 'vencido'

/** "71999990000" → "(71) 99999-0000". O que não tiver forma de celular fica como veio. */
function mostrarTelefone(t: string | null): string {
  if (!t) return ''
  const d = t.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}

export function MeuWhatsApp({
  slug,
  telefone,
  estado,
  confirmadoEm,
  esperandoCodigo,
  podeMudar,
}: {
  slug: string
  telefone: string | null
  estado: Estado
  /** "28/09/2026", quando confirmado. */
  confirmadoEm: string | null
  esperandoCodigo: boolean
  /** Só leitura (contador) não troca o próprio telefone por aqui. */
  podeMudar: boolean
}) {
  const router = useRouter()
  const [editando, setEditando] = useState(!telefone && podeMudar)
  const [salvo, salvar, salvando] = useActionState<EstadoWhatsApp, FormData>(
    salvarMeuTelefoneAcao.bind(null, slug),
    {},
  )
  const [pedido, setPedido] = useState<EstadoWhatsApp>(esperandoCodigo ? { esperando: true } : {})
  const [pedindo, pedir] = useTransition()
  const [confirmado, confirmar, confirmando] = useActionState<EstadoWhatsApp, FormData>(
    confirmarCodigoAcao.bind(null, slug),
    {},
  )

  // Salvou: fecha o campo, e o que se pediu para o número antigo some junto.
  useEffect(() => {
    if (salvo.ok) {
      setEditando(false)
      setPedido({})
    }
  }, [salvo])

  const pedirCodigo = (modo: 'enviar' | 'mostrar') =>
    pedir(async () => {
      setPedido(await pedirCodigoAcao(slug, modo))
    })

  const falta = estado === 'falta_confirmar' || estado === 'vencido'
  const esperando = (pedido.esperando || confirmado.esperando) && !confirmado.ok

  return (
    <div className="flex max-w-xl flex-col gap-4">
      {/* ── o número ── */}
      {editando ? (
        <form
          action={salvar}
          onSubmit={semApagar(salvar)}
          className="flex flex-col gap-3"
        >
          {salvo.erro && <Aviso nivel="critico">{salvo.erro}</Aviso>}
          <Campo
            rotulo="Meu celular (WhatsApp)"
            name="telefone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(71) 99999-0000"
            defaultValue={salvo.telefone ?? mostrarTelefone(telefone)}
            key={salvo.telefone ?? telefone ?? ''}
            dica="Com DDD. Deixe vazio para apagar."
          />
          <div className="flex flex-wrap gap-2">
            <Botao type="submit" carregando={salvando}>
              {salvando ? 'Salvando…' : 'Salvar o número'}
            </Botao>
            {telefone && (
              <Botao type="button" tom="discreto" onClick={() => setEditando(false)}>
                Cancelar
              </Botao>
            )}
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {telefone ? (
            <>
              <span className="numero font-semibold text-tinta">{mostrarTelefone(telefone)}</span>
              {estado === 'confirmado' ? (
                <Situacao nivel="bom">confirmado</Situacao>
              ) : (
                <Situacao nivel="atencao">{estado === 'vencido' ? 'confirmar de novo' : 'falta confirmar'}</Situacao>
              )}
            </>
          ) : (
            <span className="text-tinta-3">Nenhum número cadastrado.</span>
          )}
          {podeMudar && (
            <button
              type="button"
              onClick={() => setEditando(true)}
              className="text-xs font-semibold text-marca hover:underline"
            >
              {telefone ? 'mudar' : '+ cadastrar'}
            </button>
          )}
        </div>
      )}
      {salvo.ok && !editando && <Aviso nivel="bom">{salvo.ok}</Aviso>}

      {estado === 'confirmado' && (
        <p className="text-xs leading-relaxed text-tinta-3">
          Confirmado{confirmadoEm ? ` em ${confirmadoEm}` : ''}. O assistente reconhece você neste número, e é para
          ele que vão os avisos e, se você é dono, o relatório do dia.
        </p>
      )}

      {/* ── a confirmação ── */}
      {telefone && falta && !editando && (
        <div className="flex flex-col gap-3 rounded-norte border border-borda bg-superficie-2 p-3">
          <p className="text-sm text-tinta">
            {estado === 'vencido'
              ? 'Este número ficou mais de 180 dias sem mandar mensagem para a loja. Confirme de novo que ele continua sendo seu.'
              : 'Falta confirmar que este número é seu. Até lá o assistente trata as mensagens dele como de um cliente — não responde, e não manda relatório nem aviso.'}
          </p>

          {pedido.erro && <Aviso nivel="critico">{pedido.erro}</Aviso>}
          {confirmado.erro && <Aviso nivel="critico">{confirmado.erro}</Aviso>}
          {pedido.ok && esperando && <Aviso nivel="bom">{pedido.ok}</Aviso>}

          {pedido.mostrar ? (
            <div className="flex flex-col gap-2 text-sm text-tinta">
              <p>
                Do seu WhatsApp ({mostrarTelefone(telefone)}), mande esta mensagem para o WhatsApp da loja
                {pedido.mostrar.numeroDaLoja ? (
                  <>
                    {' '}(<span className="numero">{mostrarTelefone(pedido.mostrar.numeroDaLoja)}</span>)
                  </>
                ) : null}
                :
              </p>
              <p className="numero rounded-norte border border-borda bg-superficie px-3 py-2 text-center text-lg font-bold tracking-widest text-tinta">
                CONFIRMAR {pedido.mostrar.codigo}
              </p>
              <p className="text-xs text-tinta-3">Vale por 10 minutos. A loja responde quando confirmar.</p>
              <div>
                <Botao type="button" tom="secundario" onClick={() => router.refresh()}>
                  Já mandei
                </Botao>
              </div>
            </div>
          ) : esperando ? (
            <form action={confirmar} onSubmit={semApagar(confirmar)} className="flex flex-wrap items-end gap-2">
              <Campo
                rotulo="Código que chegou no WhatsApp"
                name="codigo"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                placeholder="123456"
                required
              />
              <Botao type="submit" carregando={confirmando}>
                {confirmando ? 'Confirmando…' : 'Confirmar'}
              </Botao>
            </form>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Botao type="button" carregando={pedindo} onClick={() => pedirCodigo('enviar')}>
                Confirmar pelo WhatsApp
              </Botao>
            </div>
          )}

          {!pedido.mostrar && (esperando || pedido.oferecerMostrar || pedido.erro) && (
            <button
              type="button"
              disabled={pedindo}
              onClick={() => pedirCodigo('mostrar')}
              className="self-start text-xs font-semibold text-marca hover:underline"
            >
              Não chegou? Prefiro mandar o código eu mesmo
            </button>
          )}
        </div>
      )}
      {confirmado.ok && <Aviso nivel="bom">{confirmado.ok}</Aviso>}
    </div>
  )
}
