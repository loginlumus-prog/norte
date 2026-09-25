'use client'

// O formulário do modelo novo e o botão de apagar.
//
// A tela ajuda a acertar de primeira, porque cada recusa da Meta custa uma
// volta de análise: mostra as variáveis que o texto usa e pede um exemplo para
// cada uma (a Meta aprova olhando os exemplos), avisa do começo/fim com
// variável e dos tamanhos. O servidor confere tudo de novo (`montarModelo`).

import { useActionState, useMemo, useState, useTransition } from 'react'
import { Aviso, Botao, Campo, Selecao, cx } from '@/ui/base'
import { criarModeloAcao, apagarModeloAcao, type RespostaModelo } from './acoes'

const campo = 'w-full min-w-0 rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3'

/** As variáveis que o texto usa, na ordem ({{1}} → 1), sem repetir. */
const variaveis = (t: string) => [...new Set([...t.matchAll(/\{\{\s*(\d{1,2})\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)

export function NovoModelo({ slug, imagens }: { slug: string; imagens: { id: string; nome: string; previa: string | null }[] }) {
  const [estado, agir, pendente] = useActionState<RespostaModelo, FormData>(criarModeloAcao.bind(null, slug), {})
  const [corpo, setCorpo] = useState('')
  const [cabecalho, setCabecalho] = useState<'nenhum' | 'texto' | 'imagem'>('nenhum')
  const [midiaId, setMidiaId] = useState(imagens[0]?.id ?? '')
  const vars = useMemo(() => variaveis(corpo), [corpo])
  const sequencia = vars.every((n, i) => n === i + 1)
  const bordaVariavel = /^\s*\{\{\s*\d+\s*\}\}/.test(corpo) || /\{\{\s*\d+\s*\}\}[.!?\s]*$/.test(corpo)
  const escolhida = imagens.find((i) => i.id === midiaId)

  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo
          rotulo="Nome"
          name="nome"
          required
          maxLength={120}
          placeholder="oferta_de_verao"
          pattern="[a-z0-9_ ]+"
          spellCheck={false}
          dica="Minúsculas sem acento, números e sublinhado. Não aparece para o cliente."
        />
        <Selecao
          rotulo="Categoria"
          name="categoria"
          defaultValue="MARKETING"
          opcoes={[
            { valor: 'MARKETING', titulo: 'Marketing — oferta, novidade, convite' },
            { valor: 'UTILITY', titulo: 'Utilidade — pedido, entrega, lembrete de compra' },
          ]}
          dica="Oferta em modelo de utilidade é recusada (ou reclassificada) pela Meta."
        />
      </div>

      <Selecao
        rotulo="Título (opcional)"
        name="cabecalho"
        value={cabecalho}
        onChange={(e) => setCabecalho(e.target.value as 'nenhum' | 'texto' | 'imagem')}
        opcoes={[
          { valor: 'nenhum', titulo: 'Sem título' },
          { valor: 'texto', titulo: 'Texto' },
          ...(imagens.length ? [{ valor: 'imagem', titulo: 'Imagem (da biblioteca das campanhas)' }] : []),
        ]}
      />
      {cabecalho === 'texto' && <Campo rotulo="Texto do título" name="cabecalhoTexto" maxLength={60} placeholder="Novidades da semana" />}
      {cabecalho === 'imagem' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Selecao
              rotulo="Imagem do título"
              name="midiaId"
              value={midiaId}
              onChange={(e) => setMidiaId(e.target.value)}
              opcoes={imagens.map((i) => ({ valor: i.id, titulo: i.nome }))}
              dica="JPG ou PNG. Para usar outra, suba na tela de uma campanha (bloco de foto)."
            />
          </div>
          {escolhida?.previa && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={escolhida.previa} alt="" className="size-16 shrink-0 rounded-norte border border-borda object-cover" />
          )}
        </div>
      )}

      <label className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-medium text-tinta">Texto da mensagem</span>
        <textarea
          name="corpo"
          required
          rows={5}
          maxLength={1024}
          value={corpo}
          onChange={(e) => setCorpo(e.target.value)}
          placeholder={'Oi, {{1}}! Chegou a coleção nova e separamos um desconto de {{2}} para você. Quer ver as peças?'}
          className={campo}
        />
        <span className="text-xs text-tinta-3">
          Use {'{{1}}'}, {'{{2}}'}... para o que muda de pessoa para pessoa. {corpo.length}/1024
        </span>
      </label>
      {!sequencia && <Aviso nivel="atencao">As variáveis precisam ser {'{{1}}'}, {'{{2}}'}, {'{{3}}'}... em sequência, sem pular número.</Aviso>}
      {bordaVariavel && <Aviso nivel="atencao">O texto não pode começar nem terminar com uma variável — a Meta recusa.</Aviso>}

      {vars.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {vars.map((n) => (
            <Campo
              key={n}
              rotulo={`Exemplo para {{${n}}}`}
              name={`exemplo_${n}`}
              required
              maxLength={200}
              placeholder={n === 1 ? 'Ana' : ''}
            />
          ))}
        </div>
      )}

      <Campo rotulo="Rodapé (opcional)" name="rodape" maxLength={60} placeholder="Responda SAIR para não receber mais" />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-tinta">Botões de resposta rápida (opcional, até 3)</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <input key={i} name={`botao_${i}`} maxLength={25} placeholder={i === 1 ? 'Quero ver' : i === 2 ? 'Agora não' : ''} className={cx(campo)} aria-label={`Botão ${i}`} />
          ))}
        </div>
        <span className="text-xs text-tinta-3">O que a pessoa tocar chega como mensagem — dá para usar na condição da campanha.</span>
      </fieldset>

      <div>
        <Botao type="submit" carregando={pendente} disabled={!sequencia || bordaVariavel}>
          Enviar para aprovação
        </Botao>
      </div>
    </form>
  )
}

export function ApagarModelo({ slug, nome }: { slug: string; nome: string }) {
  const [confirmar, setConfirmar] = useState(false)
  const [indo, comecar] = useTransition()
  const [r, setR] = useState<RespostaModelo>({})
  return (
    <div className="flex flex-col items-start gap-2 lg:items-end">
      {!confirmar ? (
        <Botao tom="discreto" onClick={() => setConfirmar(true)}>
          Apagar
        </Botao>
      ) : (
        <span className="flex flex-wrap items-center gap-2 text-sm text-tinta-2">
          Apagar na Meta? Campanha que usa este modelo para de mandá-lo.
          <Botao tom="perigo" carregando={indo} onClick={() => comecar(async () => setR(await apagarModeloAcao(slug, nome)))}>
            Apagar mesmo
          </Botao>
          <Botao tom="discreto" onClick={() => setConfirmar(false)}>
            Cancelar
          </Botao>
        </span>
      )}
      {r.erro && <Aviso nivel="critico">{r.erro}</Aviso>}
    </div>
  )
}
