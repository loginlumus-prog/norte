'use client'

// O WhatsApp OFICIAL (Meta, Cloud API), pelo Cadastro incorporado.
//
// O SDK da Meta (connect.facebook.net) só é carregado AQUI, nesta tela, e só
// quando o servidor tem o app da Meta configurado. A política de segurança
// (src/proxy.ts) abre os domínios da Meta só para esta rota — no resto do
// sistema, script de fora continua proibido.
//
// O caminho, do lado do navegador:
//   1. o SDK carrega assim que a tela abre (o clique precisa abrir a janela
//      NA HORA: janela aberta depois de um `await` é bloqueada como pop-up);
//   2. o clique chama FB.login com o config_id e `response_type: 'code'` — a
//      janela da Meta abre, a loja entra, escolhe a conta e o número;
//   3. a janela manda os ids por `postMessage` (conferimos que veio de
//      facebook.com) e o FB.login devolve o CÓDIGO;
//   4. código + ids vão para a Server Action. O código vale 30 segundos e só
//      vira token no servidor, com a chave do app que o navegador nunca vê.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Situacao } from '@/ui/base'
import type { EstadoMeta } from '@/servidor/assistente/meta-conexao'
import { lerFimDoCadastro, origemDaMeta, type FimDoCadastro } from '@/servidor/assistente/meta-cadastro'
import { conectarMeta, desconectarMetaAcao, recriarModelosAcao, type MetaAcao } from './acoes'

type RespostaLogin = { authResponse?: { code?: string } | null; status?: string }
type SdkFacebook = {
  init: (o: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void
  login: (cb: (r: RespostaLogin) => void, o: Record<string, unknown>) => void
}

declare global {
  interface Window {
    FB?: SdkFacebook
    fbAsyncInit?: () => void
  }
}

/** Uma carga só por página, mesmo que o componente monte duas vezes. */
let carregando: Promise<SdkFacebook> | null = null

function carregarSdk(appId: string, versao: string): Promise<SdkFacebook> {
  if (window.FB) return Promise.resolve(window.FB)
  carregando ??= new Promise<SdkFacebook>((resolver, falhar) => {
    const desiste = setTimeout(() => falhar(new Error('prazo')), 20_000)
    window.fbAsyncInit = () => {
      clearTimeout(desiste)
      if (!window.FB) return falhar(new Error('sem FB'))
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: versao })
      resolver(window.FB)
    }
    const s = document.createElement('script')
    s.src = 'https://connect.facebook.net/pt_BR/sdk.js'
    s.async = true
    s.defer = true
    s.crossOrigin = 'anonymous'
    s.onerror = () => {
      clearTimeout(desiste)
      carregando = null
      falhar(new Error('não carregou'))
    }
    document.body.appendChild(s)
  })
  return carregando
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function ConexaoMeta({ slug, meta }: { slug: string; meta: EstadoMeta }) {
  const router = useRouter()
  const [sdk, setSdk] = useState<'carregando' | 'pronto' | 'falhou'>('carregando')
  const [coexistencia, setCoexistencia] = useState(false)
  const [pin, setPin] = useState('')
  const [indo, setIndo] = useState<null | 'conectar' | 'desconectar' | 'modelos'>(null)
  const [resposta, setResposta] = useState<MetaAcao>({})
  const [confirmarSaida, setConfirmarSaida] = useState(false)
  const fim = useRef<FimDoCadastro | null>(null)

  const precisaSdk = meta.disponivel && !!meta.appId && !!meta.configId && !!meta.versao

  // O SDK, só nesta tela e só com a Meta ligada no servidor.
  useEffect(() => {
    if (!precisaSdk) return
    let vivo = true
    carregarSdk(meta.appId!, meta.versao!).then(
      () => vivo && setSdk('pronto'),
      () => vivo && setSdk('falhou'),
    )
    return () => {
      vivo = false
    }
  }, [precisaSdk, meta.appId, meta.versao])

  // O recado da janela da Meta com os ids (ou o cancelamento).
  useEffect(() => {
    if (!precisaSdk) return
    const ouvir = (ev: MessageEvent) => {
      if (!origemDaMeta(ev.origin)) return
      const f = lerFimDoCadastro(ev.data)
      if (f.tipo !== 'outro') fim.current = f
    }
    window.addEventListener('message', ouvir)
    return () => window.removeEventListener('message', ouvir)
  }, [precisaSdk])

  const pinOk = coexistencia || /^\d{6}$/.test(pin)

  const conectar = () => {
    const FB = window.FB
    if (!FB || !meta.configId) return
    fim.current = null
    setResposta({})
    setIndo('conectar')
    // Sem `await` antes daqui: a janela precisa abrir dentro do clique.
    FB.login(
      (r) => {
        const code = r?.authResponse?.code
        if (!code) {
          const f = fim.current as FimDoCadastro | null
          setIndo(null)
          setResposta({
            erro:
              f?.tipo === 'cancelado' && f.erro
                ? `A Meta interrompeu o cadastro: ${f.erro}`
                : 'O cadastro foi fechado antes do fim. Nada mudou — tente de novo quando quiser.',
          })
          return
        }
        void terminar(code)
      },
      {
        config_id: meta.configId,
        response_type: 'code',
        override_default_response_type: true,
        // v4: os produtos vêm da configuração no painel da Meta. A
        // coexistência (número que continua no app WhatsApp Business) ainda
        // é pedida por `featureType`.
        extras: coexistencia ? { setup: {}, featureType: 'whatsapp_business_app_onboarding' } : { setup: {} },
      },
    )
  }

  const terminar = async (code: string) => {
    // O recado com os ids às vezes chega depois do código: até 5 s.
    for (let i = 0; i < 25 && fim.current?.tipo !== 'fim'; i++) await esperar(200)
    const f = fim.current
    if (!f || f.tipo !== 'fim') {
      setIndo(null)
      setResposta({ erro: 'A Meta não disse qual conta e número foram escolhidos. Tente conectar de novo.' })
      return
    }
    const r = await conectarMeta(slug, {
      code,
      wabaId: f.wabaId,
      phoneNumberId: f.phoneNumberId,
      coexistencia: coexistencia || f.coexistencia,
      pin: coexistencia ? null : pin,
    })
    setPin('')
    setIndo(null)
    setResposta(r)
    router.refresh()
  }

  const rodar = async (qual: 'desconectar' | 'modelos', acao: () => Promise<MetaAcao>) => {
    setIndo(qual)
    setResposta({})
    const r = await acao()
    setIndo(null)
    setConfirmarSaida(false)
    setResposta(r)
    router.refresh()
  }

  const quando = meta.conectadoEm
    ? new Date(meta.conectadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
    : null

  return (
    <section className="flex flex-col gap-3 rounded-norte border border-borda p-3" aria-labelledby="meta-titulo">
      <div className="flex flex-col gap-0.5">
        <b id="meta-titulo" className="text-sm text-tinta">
          WhatsApp oficial (Meta)
        </b>
        <span className="text-xs text-tinta-3">
          A conexão oficial do WhatsApp Business, sem risco de bloqueio por aparelho não oficial. Você entra com a conta do
          Facebook da loja, escolhe o número e pronto. Para quem não escreveu à loja nas últimas 24 horas, só sai modelo
          aprovado pela Meta — e a Meta cobra cada modelo entregue direto na conta de vocês.
        </span>
      </div>

      {!meta.disponivel ? (
        <Aviso nivel="atencao">A conexão oficial ainda não está ligada neste servidor — fale com o suporte do Norte.</Aviso>
      ) : (
        <>
          {resposta.erro && <Aviso nivel="critico">{resposta.erro}</Aviso>}
          {resposta.ok && <Aviso nivel="bom">{resposta.ok}</Aviso>}
          {resposta.avisos?.map((a) => (
            <Aviso key={a} nivel="atencao">
              {a}
            </Aviso>
          ))}
          {!meta.cifra && (
            <Aviso nivel="atencao">
              O servidor ainda não tem a chave de cifra configurada, então não dá para guardar o acesso com segurança. Isto é
              com o suporte do Norte.
            </Aviso>
          )}
          {meta.guardado && !meta.tokenAbre && (
            <Aviso nivel="critico">O acesso guardado não abre com a chave deste servidor. Conecte de novo.</Aviso>
          )}

          {meta.ligado ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Situacao nivel="bom">
                  Conectado{meta.numero ? `: ${meta.numero}` : ''}
                </Situacao>
                {quando && <span className="text-xs text-tinta-3">desde {quando}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Botao tom="secundario" carregando={indo === 'modelos'} disabled={!!indo} onClick={() => rodar('modelos', () => recriarModelosAcao(slug))}>
                  Recriar modelos
                </Botao>
                <a
                  href={`/${slug}/campanhas/modelos`}
                  className="inline-flex items-center rounded-norte px-3 py-2 text-sm font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta"
                >
                  Modelos de mensagem
                </a>
                {!confirmarSaida ? (
                  <Botao tom="discreto" disabled={!!indo} onClick={() => setConfirmarSaida(true)}>
                    Desconectar
                  </Botao>
                ) : null}
              </div>
              <p className="text-xs text-tinta-3">
                &quot;Recriar modelos&quot; manda de novo para aprovação os avisos automáticos do Norte (relatório do dia e
                avisos para a equipe), se algum sumiu da conta.
              </p>
              {confirmarSaida && (
                <Aviso nivel="atencao">
                  <span className="flex flex-col gap-2">
                    <span>
                      O Norte para de usar este número e apaga o acesso guardado. O número continua na conta da loja na Meta
                      (WhatsApp Manager) — para tirá-lo de lá, é no painel da Meta.
                    </span>
                    <span className="flex flex-wrap gap-2">
                      <Botao tom="perigo" carregando={indo === 'desconectar'} onClick={() => rodar('desconectar', () => desconectarMetaAcao(slug))}>
                        Desconectar mesmo
                      </Botao>
                      <Botao tom="discreto" onClick={() => setConfirmarSaida(false)}>
                        Cancelar
                      </Botao>
                    </span>
                  </span>
                </Aviso>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {meta.guardado && (
                <p className="text-xs text-tinta-3">
                  Há um número oficial guardado{meta.numero ? ` (${meta.numero})` : ''}, mas o canal ligado agora é outro.
                  Conectar de novo passa a usar o oficial.
                </p>
              )}
              <label className="flex items-start gap-2 text-sm text-tinta">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--marca)]"
                  checked={coexistencia}
                  onChange={(e) => setCoexistencia(e.target.checked)}
                />
                <span>
                  Este número já é usado no app <b>WhatsApp Business</b> e deve continuar nele
                  <span className="block text-xs text-tinta-3">
                    A equipe segue respondendo pelo celular; o Norte fala pela API no mesmo número.
                  </span>
                </span>
              </label>
              {!coexistencia && (
                <div className="max-w-xs">
                  <Campo
                    rotulo="PIN de 6 números"
                    name="pin"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    dica="A verificação em duas etapas do número na API. Se ele já tem PIN, use o mesmo; se não, escolha um e guarde."
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Botao
                  tom="principal"
                  disabled={sdk !== 'pronto' || !pinOk || !meta.cifra || !!indo}
                  carregando={indo === 'conectar'}
                  onClick={conectar}
                >
                  Conectar pelo WhatsApp oficial (Meta)
                </Botao>
                {sdk === 'carregando' && <span className="text-xs text-tinta-3">Carregando a Meta…</span>}
              </div>
              {sdk === 'falhou' && (
                <Aviso nivel="atencao">
                  Não deu para carregar a janela da Meta. Confira se algum bloqueador de anúncios está barrando o Facebook
                  nesta página e recarregue.
                </Aviso>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
