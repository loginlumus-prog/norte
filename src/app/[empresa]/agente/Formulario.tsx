'use client'

// A tela que cria o assistente da empresa.
//
// A ordem das seções é a ordem em que a pessoa pensa, não a do banco:
// primeiro QUEM ELE É (nome, jeito de falar), depois O QUE ELE SABE (o manual
// da loja), depois O QUE ELE PODE (poderes), e só então ATÉ ONDE (os tetos).
//
// Os tetos ficam por último de propósito, logo abaixo dos poderes: eles só
// fazem sentido depois de a pessoa ter escolhido o que ele faz, e ficam na
// mesma tela porque separar "o que pode" de "até quanto" em duas telas é como
// se perde o controle de um agente.

import { useActionState, useState } from 'react'
import { Botao, Campo, Marcar, Aviso, Cartao, cx } from '@/ui/base'
import { PODERES, TODOS_PODERES, type ChavePoder, type Poder } from '@/servidor/poderes'
import { salvar, type EstadoAgente } from './acoes'

export type AgenteNaTela = {
  nome: string
  personalidade: string | null
  saudacao: string | null
  manual: string | null
  poderes: string[]
  descontoMaxPct: number
  valorMax: number
  gastoDia: number
  mensagensDia: number
  ativo: boolean
}

const CONSULTAR = TODOS_PODERES.filter((p) => !(PODERES[p] as Poder).escreve)
const AGIR = TODOS_PODERES.filter((p) => (PODERES[p] as Poder).escreve)

export function Formulario({
  slug,
  agente,
  modulos,
}: {
  slug: string
  agente: AgenteNaTela
  modulos: string[]
}) {
  const acao = salvar.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoAgente, FormData>(acao, {})

  const [ligados, setLigados] = useState<string[]>(agente.poderes)
  const [nome, setNome] = useState(agente.nome)

  const alterna = (p: string, on: boolean) =>
    setLigados((atual) => (on ? [...atual, p] : atual.filter((x) => x !== p)))

  const escreveAlgo = AGIR.some((p) => ligados.includes(p))
  const nomeUsado = nome.trim() || 'o assistente'

  return (
    <form action={agir} className="flex max-w-3xl flex-col gap-5">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      {/* ── quem ele é ── */}
      <Cartao titulo="Quem é o assistente">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Nome"
            name="nome"
            required
            maxLength={40}
            defaultValue={agente.nome}
            onChange={(e) => setNome(e.currentTarget.value)}
            placeholder="Aurora"
            dica="É o nome que o cliente vê no WhatsApp. Ele é da sua loja."
          />
          <Campo
            rotulo="Primeira frase"
            name="saudacao"
            defaultValue={agente.saudacao ?? ''}
            placeholder="Oi! Aqui é a Aurora, da loja. Em que posso ajudar?"
          />
        </div>

        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-sm font-medium text-tinta">Jeito de falar</span>
          <textarea
            name="personalidade"
            rows={3}
            defaultValue={agente.personalidade ?? ''}
            placeholder="Direto, educado e sem enrolação. Trata todo mundo por você. Não usa emoji."
            className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
          />
          <span className="text-xs text-tinta-3">
            Isto decide o <b>jeito</b> dele, e só isso. O que ele pode fazer é a lista
            abaixo — texto nunca dá permissão a ninguém.
          </span>
        </label>
      </Cartao>

      {/* ── o que ele sabe ── */}
      <Cartao titulo="O manual da loja">
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Manual da loja</span>
          <textarea
            name="manual"
            rows={6}
            defaultValue={agente.manual ?? ''}
            placeholder={
              'Abrimos de segunda a sábado, das 9h às 18h.\n' +
              'Troca em até 7 dias com a etiqueta e o comprovante.\n' +
              'Aceitamos Pix, cartão e dinheiro.\n' +
              'Quando não souber responder, avise que alguém da loja responde em seguida.'
            }
            className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
          />
          <span className="text-xs text-tinta-3">
            O que {nomeUsado} precisa saber de cor: horário, troca, formas de pagamento, e
            o que fazer quando não souber a resposta. Isto ele não descobre sozinho.
          </span>
        </label>
      </Cartao>

      {/* ── o que ele pode ── */}
      <Cartao
        titulo="O que o assistente pode fazer"
        acao={
          <span className="numero text-xs font-semibold text-tinta-3">
            {ligados.length} de {TODOS_PODERES.length}
          </span>
        }
      >
        <p className="mb-3 text-sm text-tinta-2">
          Consultar não muda nada no sistema. <b>Agir</b> sempre passa por você: ele monta a
          proposta com o número e espera o seu sim.
        </p>

        <Grupo titulo="Consultar" itens={CONSULTAR} ligados={ligados} modulos={modulos} alterna={alterna} />
        <Grupo titulo="Agir (sempre com a sua confirmação)" itens={AGIR} ligados={ligados} modulos={modulos} alterna={alterna} />
      </Cartao>

      {/* ── até onde ── */}
      <Cartao titulo="Até onde ele vai">
        <p className="mb-3 text-sm text-tinta-2">
          Estes números moram no banco, não na conversa. Nenhuma mensagem que chegue no
          WhatsApp muda qualquer um deles.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Valor máximo de uma proposta"
            name="valorMax"
            type="number"
            step={10}
            min={0}
            defaultValue={agente.valorMax}
            dica="Acima disso ele nem propõe — ele avisa e pede para você resolver."
          />
          <Campo
            rotulo="Desconto máximo (%)"
            name="descontoMaxPct"
            type="number"
            step={0.5}
            min={0}
            max={100}
            defaultValue={agente.descontoMaxPct}
            dica="Vale para quando o desconto pelo assistente for liberado."
          />
          <Campo
            rotulo="Gasto de IA por dia (R$)"
            name="gastoDia"
            type="number"
            step={1}
            min={0}
            defaultValue={agente.gastoDia}
            dica="Passou disso, ele para e avisa. É o freio contra defeito em laço de madrugada."
          />
          <Campo
            rotulo="Mensagens por dia"
            name="mensagensDia"
            type="number"
            step={10}
            min={0}
            defaultValue={agente.mensagensDia}
            dica="Somando todo mundo. Evita que um problema vire cem mensagens ao mesmo tempo."
          />
        </div>

        {escreveAlgo && (
          <div className="mt-4">
            <Aviso nivel="atencao">
              Você ligou pelo menos uma ação que mexe no sistema. Nada acontece sem a sua
              confirmação — mas quem confirma precisa ter a permissão daquela ação, e tudo
              fica assinado no livro.
            </Aviso>
          </div>
        )}
      </Cartao>

      {/* ── ligar ── */}
      <Cartao titulo="Ligar">
        <Marcar
          name="ativo"
          defaultChecked={agente.ativo}
          titulo={`Deixar ${nomeUsado} funcionando`}
          resumo="Desligado, ele continua configurado e simplesmente não responde nem age."
        />
        <p className="mt-3 text-xs text-tinta-3">
          O WhatsApp ainda não está conectado — isso é o próximo passo, e depende de
          contratar o canal. Enquanto isso ele já responde aqui pela tela.
        </p>
      </Cartao>

      <div className="flex justify-end">
        <Botao type="submit" tom="confirmar" carregando={pendente}>
          {pendente ? 'Salvando...' : 'Salvar'}
        </Botao>
      </div>
    </form>
  )
}

function Grupo({
  titulo,
  itens,
  ligados,
  modulos,
  alterna,
}: {
  titulo: string
  itens: ChavePoder[]
  ligados: string[]
  modulos: string[]
  alterna: (p: string, on: boolean) => void
}) {
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="mb-2 text-xs font-bold tracking-wide text-tinta-3 uppercase">{titulo}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {itens.map((chave) => {
          const p: Poder = PODERES[chave]
          const semModulo = p.modulo ? !modulos.includes(p.modulo) : false

          // Duas razões diferentes para não poder ligar, e a pessoa precisa
          // saber qual é: uma ela resolve em Configurações agora, a outra
          // depende da gente construir.
          if (!p.disponivel || semModulo) {
            return (
              <div
                key={chave}
                className="flex items-start gap-3 rounded-norte border border-dashed border-borda p-3 opacity-70"
              >
                <span aria-hidden className="mt-1 size-4 shrink-0 rounded-sm bg-superficie-2" />
                <span className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold text-tinta-3">{p.titulo}</span>
                    <span
                      className={cx(
                        'shrink-0 rounded border px-1 py-px text-[9px] font-bold tracking-wide whitespace-nowrap uppercase',
                        semModulo
                          ? 'border-atencao-vivo text-atencao'
                          : 'border-borda text-tinta-3',
                      )}
                    >
                      {semModulo ? 'precisa do crediário' : 'em breve'}
                    </span>
                  </span>
                  <span className="text-xs text-tinta-3">{p.resumo}</span>
                </span>
              </div>
            )
          }

          return (
            <Marcar
              key={chave}
              name={`poder_${chave}`}
              defaultChecked={ligados.includes(chave)}
              onChange={(e) => alterna(chave, e.currentTarget.checked)}
              titulo={p.titulo}
              resumo={p.resumo}
            />
          )
        })}
      </div>
    </section>
  )
}
