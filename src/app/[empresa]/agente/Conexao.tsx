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

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Cartao, Situacao } from '@/ui/base'
import type { CredencialNaTela, EstadoConexao } from '@/servidor/assistente/conexao'
import { apagarLinha, conectar, desconectar, gerarEndereco, salvarLinha, testar, type EstadoConexaoAcao } from './acoes'

// Em palavras de loja, não de servidor: "chave de IA", "segredo do webhook" e
// "instância" não dizem nada a quem vende. O Z-API fica nomeado só onde a
// pessoa precisa ir até ele.
const FRASE: Record<EstadoConexao['situacao'], { nivel: 'bom' | 'atencao' | 'critico' | 'neutro'; titulo: string; texto: string }> = {
  sem_agente: { nivel: 'neutro', titulo: 'Sem assistente', texto: 'Crie o assistente no formulário abaixo antes de conectar.' },
  sem_chave: {
    nivel: 'critico',
    titulo: 'Inteligência artificial desligada',
    texto: 'O Norte ainda não ligou a inteligência artificial desta conta. Sem ela o assistente não responde nada — só avisa que alguém da loja vai responder. Isto é com o suporte do Norte.',
  },
  sem_canal: {
    nivel: 'critico',
    titulo: 'Sem linha do WhatsApp',
    texto: 'Ainda não há uma linha do WhatsApp (Z-API) ligada a esta conta. As conversas ficam só no histórico; nada sai para o WhatsApp. Cole abaixo os dados da sua instância no Z-API.',
  },
  desconectado: {
    nivel: 'atencao',
    titulo: 'Desconectado',
    texto: 'A linha está pronta. Falta conectar: gere o endereço e cole no painel do Z-API.',
  },
  sem_webhook: {
    nivel: 'critico',
    titulo: 'Entrada sem endereço válido',
    texto: 'O endereço por onde as mensagens chegam não vale mais. Gere um endereço novo e cole no painel do Z-API.',
  },
  desligado: {
    nivel: 'atencao',
    titulo: 'Conectado, mas desligado',
    texto: 'A conexão está feita, mas o assistente está desligado no formulário abaixo. Ligue para ele começar a responder.',
  },
  pronto: { nivel: 'bom', titulo: 'Pronto', texto: 'Conectado e ligado. Ele responde no WhatsApp e manda as rotinas marcadas abaixo.' },
}

/** "guardado ✓ (termina em …ab12)" — nunca mais que os 4 últimos. */
function guardado(c: CredencialNaTela): string {
  if (!c.guardado) return 'nada guardado'
  return c.final ? `guardado ✓ (termina em …${c.final})` : 'guardado, mas não abre com a chave atual — cole de novo'
}

export function Conexao({ slug, estado }: { slug: string; estado: EstadoConexao }) {
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
              {estado.origemCanal === 'propria'
                ? 'linha própria do WhatsApp'
                : estado.origemCanal === 'global'
                  ? 'linha do WhatsApp (do Norte)'
                  : 'linha do WhatsApp'}
            </Situacao>
          </li>
          <li><Situacao nivel={estado.segredoWebhook ? 'bom' : 'critico'}>entrada protegida</Situacao></li>
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
          <Botao
            tom="secundario"
            disabled={!temAgente}
            carregando={indo && qual === 'testar'}
            onClick={() => rodar('testar', () => testar(slug))}
          >
            Enviar mensagem de teste para mim
          </Botao>
          {estado.conectado && (
            <Botao
              tom="discreto"
              carregando={indo && qual === 'desconectar'}
              onClick={() => rodar('desconectar', () => desconectar(slug))}
            >
              Desconectar
            </Botao>
          )}
        </div>
        <p className="text-xs text-tinta-3">
          {estado.meuTelefone
            ? `O teste vai para o seu telefone cadastrado, ${estado.meuTelefone}.`
            : 'Para receber o teste e os relatórios, cadastre o seu telefone com DDD na tela Equipe.'}
        </p>
      </div>
    </Cartao>
  )
}
