'use client'

// A conexão do assistente com o mundo, dita sem rodeio.
//
// A tela diz o PRIMEIRO problema, não uma lista de dez luzes: "sem chave de
// IA" resolve-se antes de "sem canal", que se resolve antes de "desligado".
// Uma pessoa não técnica consegue seguir uma frase; não consegue seguir um
// painel de avião.
//
// O endereço do webhook aparece UMA vez, como resposta do botão. Ele é a
// senha da porta — impresso na página, ficaria em todo print de tela que a
// loja mandasse para o suporte. E o banco só guarda o resumo dele: perdeu,
// gera outro (e o anterior para de abrir na hora).
//
// Os tokens do Z-API seguem a mesma regra, mais dura: entram e NÃO voltam. A
// página recebe "guardado, termina em …ab12" e nada além; o campo fica vazio
// sempre, e vazio quer dizer "manter o que está guardado".
//
// ── o oficial vem primeiro (quando o servidor tem a Meta) ────
// Com o app da Meta configurado no servidor, o caminho principal é o
// WhatsApp OFICIAL, pelo Cadastro incorporado da Meta (./ConexaoMeta.tsx):
// sem risco de bloqueio por aparelho não oficial. QR Code e Z-API ficam em
// "Outras formas de conectar".
//
// Sem a Meta no servidor, o principal é ler um QR com o celular da loja, como
// no WhatsApp Web: sem conta em fornecedor, sem token para colar. O Z-API
// continua lá, fechado em "Outras formas de conectar" — aberto só para quem
// já usa. E o bloco da Meta diz, numa linha, que ela ainda não está ligada.

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Cartao, Situacao } from '@/ui/base'
import type { CredencialNaTela, EstadoConexao, QrNaTela } from '@/servidor/assistente/conexao'
import type { EstadoMeta } from '@/servidor/assistente/meta-conexao'
import { ConexaoMeta } from './ConexaoMeta'
import {
  apagarLinha,
  conectar,
  conectarQr,
  desconectar,
  desconectarQr,
  gerarEndereco,
  salvarLinha,
  testar,
  verQr,
  type EstadoConexaoAcao,
  type QrAcao,
} from './acoes'

// Em palavras de loja, não de servidor: "chave de IA", "segredo do webhook" e
// "instância" não dizem nada a quem vende. O Z-API fica nomeado só onde a
// pessoa precisa ir até ele.
const FRASE: Record<EstadoConexao['situacao'], { nivel: 'bom' | 'atencao' | 'critico' | 'neutro'; titulo: string; texto: string }> = {
  sem_agente: { nivel: 'neutro', titulo: 'Sem assistente', texto: 'Crie o assistente no formulário abaixo antes de conectar.' },
  sem_chave: {
    nivel: 'critico',
    titulo: 'Inteligência artificial desligada',
    texto: 'O Norte ainda não ligou a inteligência artificial desta conta. Sem ela o assistente não conversa com você e a equipe. Campanhas e o recado automático para cliente não usam IA e seguem funcionando. Isto é com o suporte do Norte.',
  },
  sem_canal: {
    nivel: 'critico',
    titulo: 'Sem WhatsApp conectado',
    texto: 'Ainda não há um WhatsApp ligado a esta conta. As conversas ficam só no histórico; nada sai para o WhatsApp. Conecte o WhatsApp da loja logo abaixo.',
  },
  desconectado: {
    nivel: 'atencao',
    titulo: 'Desconectado',
    texto: 'A linha do Z-API está pronta. Falta conectar: gere o endereço e cole no painel do Z-API — ou conecte pelo QR Code.',
  },
  sem_webhook: {
    nivel: 'critico',
    titulo: 'Entrada sem endereço válido',
    texto: 'O endereço por onde as mensagens chegam não vale mais. Gere um endereço novo e cole no painel do Z-API.',
  },
  desligado: {
    nivel: 'atencao',
    titulo: 'Conectado, mas desligado',
    texto: 'A conexão está feita, mas o assistente está desligado no formulário abaixo. Ligue para ele começar a trabalhar.',
  },
  pronto: {
    nivel: 'bom',
    titulo: 'Pronto',
    texto: 'Conectado e ligado. No WhatsApp, ele conversa com você e a equipe e manda as rotinas marcadas abaixo. Com cliente, só roda as campanhas (roteiro fixo, que a pessoa começa) e o recado automático, se ligado — o resto a loja responde.',
  },
}

/** "guardado ✓ (termina em …ab12)" — nunca mais que os 4 últimos. */
function guardado(c: CredencialNaTela): string {
  if (!c.guardado) return 'nada guardado'
  return c.final ? `guardado ✓ (termina em …${c.final})` : 'guardado, mas não abre com a chave atual — cole de novo'
}

export function Conexao({ slug, estado, meta }: { slug: string; estado: EstadoConexao; meta: EstadoMeta }) {
  const [resposta, setResposta] = useState<EstadoConexaoAcao>({})
  const [qual, setQual] = useState<string | null>(null)
  const [trocando, setTrocando] = useState(false)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  const formLinha = useRef<HTMLFormElement>(null)

  const rodar = (nome: string, acao: () => Promise<EstadoConexaoAcao>, depois?: (r: EstadoConexaoAcao) => void) => {
    setQual(nome)
    setResposta({})
    setTrocando(false)
    comecar(async () => {
      const r = await acao()
      setResposta(r)
      depois?.(r)
      setQual(null)
      router.refresh()
    })
  }

  const f = FRASE[estado.situacao]
  const temAgente = estado.situacao !== 'sem_agente'
  const temLinha = estado.linha.instancia !== null || estado.linha.token.guardado
  // Quem já está no Z-API (ou tem linha guardada) vê essa parte aberta.
  const usaZapi = estado.canalLigado === 'ZAPI' || temLinha || estado.origemCanal === 'global'
  // Com a Meta no servidor, o QR também vai para "Outras formas" — e abre
  // sozinho para quem já está nele.
  const oficialPrimeiro = meta.disponivel
  const outrasAbertas = usaZapi || (oficialPrimeiro && estado.canalLigado === 'PROPRIO')

  return (
    <Cartao titulo="Conexão">
      <div className="flex flex-col gap-3">
        <Aviso nivel={f.nivel}>
          <span className="flex flex-col gap-0.5">
            <b>{f.titulo}</b>
            <span>{f.texto}</span>
          </span>
        </Aviso>

        <ul className="flex flex-wrap gap-2">
          <li><Situacao nivel={estado.chaveIA ? 'bom' : 'critico'}>inteligência artificial</Situacao></li>
          <li>
            <Situacao nivel={estado.canalReal ? 'bom' : 'critico'}>
              {estado.origemCanal === 'meta'
                ? 'WhatsApp oficial (Meta)'
                : estado.origemCanal === 'qr'
                ? 'WhatsApp pelo QR Code'
                : estado.origemCanal === 'propria'
                  ? 'linha própria do WhatsApp'
                  : estado.origemCanal === 'global'
                    ? 'linha do WhatsApp (do Norte)'
                    : 'linha do WhatsApp'}
            </Situacao>
          </li>
          {estado.canalLigado !== 'PROPRIO' && estado.canalLigado !== 'META' && (
            <li><Situacao nivel={estado.segredoWebhook ? 'bom' : 'critico'}>entrada protegida</Situacao></li>
          )}
          <li><Situacao nivel={estado.conectado ? 'bom' : 'atencao'}>{estado.conectado ? 'conectado' : 'desconectado'}</Situacao></li>
          <li><Situacao nivel={estado.rotinasSegredo ? 'bom' : 'atencao'}>horário das rotinas</Situacao></li>
        </ul>

        {resposta.erro && <Aviso nivel="critico">{resposta.erro}</Aviso>}
        {resposta.ok && (
          <Aviso nivel="bom">
            <span className="flex flex-col gap-1.5">
              <span>{resposta.ok}</span>
              {resposta.endereco && (
                <>
                  <code className="block overflow-x-auto rounded bg-superficie px-2 py-1.5 font-mono text-xs break-all text-tinta">
                    {resposta.endereco}
                  </code>
                  <span className="text-xs">
                    Este endereço é a senha da porta: quem tiver ele consegue falar com o assistente
                    fingindo ser qualquer número. Cole no Z-API e não mande por e-mail nem em grupo.
                    Ele não aparece de novo — se perder, gere outro.
                  </span>
                </>
              )}
            </span>
          </Aviso>
        )}

        {/* ── o caminho principal: o oficial (com a Meta no servidor) ou o QR Code ── */}
        {temAgente && oficialPrimeiro && <ConexaoMeta slug={slug} meta={meta} />}
        {temAgente && !oficialPrimeiro && <ConexaoQr slug={slug} estado={estado} />}
        {temAgente && !oficialPrimeiro && <ConexaoMeta slug={slug} meta={meta} />}

        <div className="flex flex-col gap-1.5">
          <div>
            <Botao
              tom="secundario"
              disabled={!temAgente}
              carregando={indo && qual === 'testar'}
              onClick={() => rodar('testar', () => testar(slug))}
            >
              Enviar mensagem de teste para mim
            </Botao>
          </div>
          <p className="text-xs text-tinta-3">
            {estado.meuTelefone
              ? `O teste vai para o seu telefone cadastrado, ${estado.meuTelefone}.`
              : 'Para receber o teste e os relatórios, cadastre o seu telefone com DDD na tela Equipe.'}
          </p>
        </div>

        {/* ── as outras formas: Z-API ── */}
        {temAgente && (
          <details className="group rounded-norte border border-borda" open={outrasAbertas}>
            <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-tinta select-none">
              {oficialPrimeiro ? 'Outras formas de conectar (QR Code e Z-API)' : 'Outras formas de conectar (Z-API)'}
            </summary>
            <div className="flex flex-col gap-3 border-t border-borda p-3">
        {oficialPrimeiro && <ConexaoQr slug={slug} estado={estado} />}
        {/* ── a linha própria no Z-API ── */}
        {temAgente && (
          <form
            ref={formLinha}
            className="flex flex-col gap-3 rounded-norte border border-borda p-3"
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault()
              const dados = new FormData(e.currentTarget)
              // Os campos de token se esvaziam na hora: o que foi colado não
              // fica na página esperando a resposta.
              e.currentTarget.querySelectorAll<HTMLInputElement>('input[type=password]').forEach((i) => (i.value = ''))
              rodar('linha', () => salvarLinha(slug, dados))
            }}
          >
            <div className="flex flex-col gap-0.5">
              <b className="text-sm text-tinta">Linha do WhatsApp (Z-API)</b>
              <span className="text-xs text-tinta-3">
                Do painel do Z-API: em Instâncias, o ID e o token da instância; em Segurança, o
                Client-Token da conta (se estiver ligado). Os tokens ficam cifrados e não voltam
                para esta tela — deixe em branco para manter o que já está guardado.
              </span>
            </div>
            {!estado.cifra && (
              <Aviso nivel="atencao">
                O servidor ainda não tem a chave de cifra configurada, então não dá para guardar a
                linha com segurança. Isto é com o suporte do Norte.
              </Aviso>
            )}
            {estado.origemCanal === 'global' && (
              <p className="text-xs text-tinta-3">
                Hoje esta conta fala pela linha do Norte. Guardando uma linha própria, ela passa a
                valer no lugar.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo
                rotulo="ID da instância"
                name="instancia"
                defaultValue={estado.linha.instancia ?? ''}
                spellCheck={false}
                disabled={!estado.cifra}
              />
              <Campo
                rotulo="Token da instância"
                name="token"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                dica={guardado(estado.linha.token)}
                disabled={!estado.cifra}
              />
              <Campo
                rotulo="Client-Token"
                name="clientToken"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                dica={guardado(estado.linha.clientToken)}
                disabled={!estado.cifra}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Botao type="submit" tom="secundario" disabled={!estado.cifra} carregando={indo && qual === 'linha'}>
                Guardar a linha
              </Botao>
              {temLinha && (
                <Botao
                  type="button"
                  tom="discreto"
                  carregando={indo && qual === 'apagar'}
                  onClick={() => rodar('apagar', () => apagarLinha(slug), (r) => r.ok && formLinha.current?.reset())}
                >
                  Remover a linha
                </Botao>
              )}
            </div>
          </form>
        )}

        {/* ── o endereço de entrada ── */}
        {trocando && (
          <Aviso nivel="atencao">
            <span className="flex flex-col gap-2">
              <span>
                O endereço atual para de funcionar <b>na hora</b>. Até você colar o novo no Z-API, as
                mensagens dos clientes não chegam ao assistente.
              </span>
              <span className="flex flex-wrap gap-2">
                <Botao tom="perigo" onClick={() => rodar('gerar', () => gerarEndereco(slug))}>
                  Trocar mesmo
                </Botao>
                <Botao tom="discreto" onClick={() => setTrocando(false)}>
                  Cancelar
                </Botao>
              </span>
            </span>
          </Aviso>
        )}

        <div className="flex flex-wrap gap-2">
          <Botao
            tom={estado.enderecoProprio ? 'secundario' : 'principal'}
            disabled={!temAgente || trocando}
            carregando={indo && qual === 'gerar'}
            onClick={() =>
              // Trocar derruba o endereço que está colado no Z-API — o próprio
              // ou o antigo. Pede confirmação; gerar o primeiro, não.
              estado.enderecoProprio || estado.conectado
                ? setTrocando(true)
                : rodar('gerar', () => gerarEndereco(slug))
            }
          >
            {estado.enderecoProprio || estado.conectado ? 'Gerar endereço novo' : 'Conectar e gerar o endereço'}
          </Botao>
          {!estado.conectado && estado.segredoWebhook && temAgente && (
            <Botao
              tom="secundario"
              carregando={indo && qual === 'conectar'}
              onClick={() => rodar('conectar', () => conectar(slug))}
            >
              Reconectar (mesmo endereço)
            </Botao>
          )}
          {estado.canalLigado === 'ZAPI' && (
            <Botao
              tom="discreto"
              carregando={indo && qual === 'desconectar'}
              onClick={() => rodar('desconectar', () => desconectar(slug))}
            >
              Desconectar o Z-API
            </Botao>
          )}
        </div>
        {(estado.canalLigado === 'PROPRIO' || estado.canalLigado === 'META') && (
          <p className="text-xs text-tinta-3">
            Hoje esta conta fala pelo{' '}
            {estado.canalLigado === 'META' ? 'WhatsApp oficial (Meta)' : 'WhatsApp conectado por QR Code'}. Conectar
            pelo Z-API passa a valer no lugar dele.
          </p>
        )}
            </div>
          </details>
        )}
      </div>
    </Cartao>
  )
}

// ─────────────────────────────────────────────────────────────
// O QR CODE
// ─────────────────────────────────────────────────────────────

/** Quanto tempo a tela fica perguntando antes de desistir (o QR expira antes). */
const PERGUNTA_MS = 2_500
const DESISTE_MS = 3 * 60_000

const esperando = (e: QrNaTela['estado'] | undefined) => e === 'aguardando_qr' || e === 'conectando'

function ConexaoQr({ slug, estado }: { slug: string; estado: EstadoConexao }) {
  const router = useRouter()
  const [qr, setQr] = useState<QrNaTela | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [pedindo, setPedindo] = useState(false)
  const [saindo, setSaindo] = useState(false)
  const [confirmarSaida, setConfirmarSaida] = useState(false)
  const desde = useRef(0)
  const falhasSeguidas = useRef(0)

  // Uma consulta que falha no meio da espera (a rede piscou, o servidor
  // demorou) não vira aviso vermelho: a próxima, 2,5 s depois, resolve. Só
  // três falhas seguidas — ou a falha de um clique — aparecem.
  const receber = useCallback(
    (r: QrAcao, deFundo = false) => {
      if ('erro' in r) {
        falhasSeguidas.current++
        if (!deFundo || falhasSeguidas.current >= 3) setErro(r.erro)
        return
      }
      falhasSeguidas.current = 0
      setErro(null)
      setQr(r)
      if (r.mudou) router.refresh()
    },
    [router],
  )

  // Ao abrir a tela: como está a conexão agora (uma consulta só).
  useEffect(() => {
    if (!estado.qr.disponivel) return
    let vivo = true
    void verQr(slug).then((r) => {
      if (!vivo) return
      if (!('erro' in r) && esperando(r.estado)) desde.current = Date.now()
      receber(r, true)
    })
    return () => {
      vivo = false
    }
  }, [slug, estado.qr.disponivel, receber])

  // Enquanto espera o celular: pergunta a cada 2,5 s, por até 3 minutos.
  const aguardando = esperando(qr?.estado)
  useEffect(() => {
    if (!aguardando) return
    const t = setInterval(() => {
      if (Date.now() - desde.current > DESISTE_MS) {
        setQr((q) => (q ? { ...q, estado: 'desconectado', imagem: null, motivo: 'O QR Code expirou. Clique para gerar outro.' } : q))
        return
      }
      void verQr(slug).then((r) => receber(r, true))
    }, PERGUNTA_MS)
    return () => clearInterval(t)
  }, [aguardando, slug, receber])

  const pedirQr = async () => {
    setPedindo(true)
    setRecado(null)
    setConfirmarSaida(false)
    desde.current = Date.now()
    receber(await conectarQr(slug))
    setPedindo(false)
  }

  const sair = async () => {
    setSaindo(true)
    const r = await desconectarQr(slug)
    setSaindo(false)
    setConfirmarSaida(false)
    if (r.erro) return setErro(r.erro)
    setRecado(r.ok ?? null)
    setQr((q) => (q ? { ...q, estado: 'desconectado', imagem: null, numero: null, motivo: null, ligado: false } : q))
    router.refresh()
  }

  const e = qr?.estado

  return (
    <section className="flex flex-col gap-3 rounded-norte border border-borda p-3" aria-labelledby="qr-titulo">
      <div className="flex flex-col gap-0.5">
        <b id="qr-titulo" className="text-sm text-tinta">
          WhatsApp da loja, pelo QR Code
        </b>
        <span className="text-xs text-tinta-3">
          Como o WhatsApp Web: você lê um código com o celular da loja e o assistente passa a usar
          esse número. Sem conta em outro serviço, sem token para colar.
        </span>
      </div>

      {!estado.qr.disponivel || e === 'sem_conector' ? (
        <Aviso nivel="atencao">
          A conexão por QR Code ainda não está ligada neste servidor — fale com o suporte do Norte.
        </Aviso>
      ) : (
        <>
          {erro && <Aviso nivel="critico">{erro}</Aviso>}
          {recado && <Aviso nivel="bom">{recado}</Aviso>}
          {e === 'fora_do_ar' && (
            <Aviso nivel="critico">
              O conector do WhatsApp não respondeu agora. Tente de novo em instantes; se continuar,
              fale com o suporte do Norte.
            </Aviso>
          )}
          {qr?.motivo && (e === 'desconectado' || e === 'expulso') && <Aviso nivel="atencao">{qr.motivo}</Aviso>}

          {e === 'aguardando_qr' && (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              {qr?.imagem ? (
                // O QR precisa de fundo branco e borda clara (a "zona quieta")
                // para a câmera achar os cantos — inclusive no tema escuro.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qr.imagem}
                  alt="QR Code para conectar o WhatsApp da loja"
                  width={280}
                  height={280}
                  className="size-[280px] shrink-0 rounded-norte bg-white p-2 [image-rendering:pixelated]"
                />
              ) : (
                <div className="flex size-[280px] shrink-0 items-center justify-center rounded-norte border border-borda text-sm text-tinta-3">
                  Gerando o código…
                </div>
              )}
              <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-tinta">
                <li>Abra o WhatsApp no celular da loja.</li>
                <li>
                  No celular: <b>WhatsApp › Aparelhos conectados › Conectar um aparelho</b> (no
                  Android, pelos três pontinhos; no iPhone, em Configurações).
                </li>
                <li>Aponte a câmera para este código.</li>
                <li className="list-none text-xs text-tinta-3">
                  O código se renova sozinho a cada poucos segundos. Esta tela avisa quando conectar.
                </li>
              </ol>
            </div>
          )}

          {e === 'conectando' && (
            <p className="text-sm text-tinta-2" role="status">
              Conectando ao WhatsApp da loja…
            </p>
          )}

          {e === 'conectado' && (
            <div className="flex flex-wrap items-center gap-2">
              <Situacao nivel="bom">Conectado{qr?.numero ? `: ${qr.numero}` : ''}</Situacao>
              {!confirmarSaida ? (
                <Botao tom="discreto" onClick={() => setConfirmarSaida(true)}>
                  Desconectar
                </Botao>
              ) : (
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  O assistente para de responder por este número.
                  <Botao tom="perigo" carregando={saindo} onClick={sair}>
                    Desconectar mesmo
                  </Botao>
                  <Botao tom="discreto" onClick={() => setConfirmarSaida(false)}>
                    Cancelar
                  </Botao>
                </span>
              )}
            </div>
          )}

          {(qr === null || e === 'desconectado' || e === 'expulso' || e === 'fora_do_ar') && (
            <div>
              <Botao tom="principal" carregando={pedindo} onClick={pedirQr}>
                {e === 'expulso' ? 'Conectar de novo pelo QR Code' : 'Conectar pelo QR Code'}
              </Botao>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-tinta-3">
        Use um número da loja. Mensagem em massa para quem não pediu pode bloquear o número — o Norte
        só responde a quem chamou.
      </p>
    </section>
  )
}
