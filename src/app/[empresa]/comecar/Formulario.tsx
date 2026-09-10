'use client'

import { useActionState, useState } from 'react'
import { Botao, Campo, Selecao, Marcar, Aviso, Cartao } from '@/ui/base'
import { PORTES, CATALOGOS, CANAIS, DORES } from '@/servidor/cadastro'
import { MODULOS, RAMOS, TODOS, type Ramo } from '@/servidor/modulos'
import { terminarCadastro, type EstadoComeco } from './acoes'

const REGIMES = [
  { valor: '', titulo: 'Não sei / depois' },
  { valor: 'MEI', titulo: 'MEI' },
  { valor: 'SIMPLES', titulo: 'Simples Nacional' },
  { valor: 'PRESUMIDO', titulo: 'Lucro Presumido' },
  { valor: 'REAL', titulo: 'Lucro Real' },
]

export function Formulario({ empresa, nomeAtual }: { empresa: string; nomeAtual: string }) {
  const [estado, agir, pendente] = useActionState<EstadoComeco, FormData>(terminarCadastro, {})

  const [ramo, setRamo] = useState<Ramo>('outro')
  // O ramo só SUGERE. Depois que a pessoa mexeu, a sugestão para de mandar —
  // nada pior que um formulário que desmarca o que você acabou de marcar.
  const [mexeu, setMexeu] = useState(false)
  const [ligados, setLigados] = useState<string[]>([])

  const sugeridos = RAMOS[ramo].sugere as readonly string[]
  const marcado = (m: string) => (mexeu ? ligados.includes(m) : sugeridos.includes(m))

  function trocarRamo(novo: Ramo) {
    setRamo(novo)
    if (!mexeu) setLigados([...RAMOS[novo].sugere])
  }

  function alternar(m: string, ligado: boolean) {
    setMexeu(true)
    setLigados((atual) => {
      const base = mexeu ? atual : [...sugeridos]
      return ligado ? [...new Set([...base, m])] : base.filter((x) => x !== m)
    })
  }

  return (
    <form action={agir} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />

      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <Cartao titulo="A empresa">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome que aparece na tela" name="nome" defaultValue={nomeAtual} required
                 dica="É o que a equipe e os clientes veem." />
          <Campo rotulo="Razão social" name="razaoSocial" dica="Como está no CNPJ. Pode deixar em branco." />
          <Campo rotulo="CNPJ ou CPF" name="documento" inputMode="numeric" />
          <Campo rotulo="Inscrição estadual" name="inscricaoEstadual" dica="Só se você emite nota." />
          <Selecao rotulo="Regime tributário" name="regime" opcoes={REGIMES}
                   dica="Seu contador sabe. Dá para preencher depois." />
          <Selecao
            rotulo="Ramo"
            name="ramo"
            value={ramo}
            onChange={(e) => trocarRamo(e.target.value as Ramo)}
            opcoes={Object.entries(RAMOS).map(([v, r]) => ({ valor: v, titulo: r.titulo }))}
            dica="Só adianta o preparo. Você muda tudo depois."
          />
        </div>
      </Cartao>

      <Cartao titulo="Contato">
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Telefone" name="telefone" type="tel" />
          <Campo rotulo="WhatsApp" name="whatsapp" type="tel" dica="Onde o cliente fala com você." />
          <Campo rotulo="E-mail" name="email" type="email" />
        </div>
      </Cartao>

      <Cartao titulo="Onde fica">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Nome desta unidade" name="unidadeNome" placeholder="Loja Centro"
                   dica="Se você tem uma só, use o nome da empresa." />
            <Campo rotulo="CEP" name="cep" inputMode="numeric" />
            <Campo rotulo="Bairro" name="bairro" />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_6rem_1fr]">
            <Campo rotulo="Endereço" name="endereco" />
            <Campo rotulo="Número" name="numero" />
            <Campo rotulo="Complemento" name="complemento" />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_6rem_1.4fr]">
            <Campo rotulo="Cidade" name="cidade" />
            <Campo rotulo="Estado" name="estado" maxLength={2} placeholder="BA" />
            <Campo rotulo="Horário de funcionamento" name="horario"
                   placeholder="Seg a sex 9h-18h, sáb 9h-13h"
                   dica="O assistente responde com isto quando perguntarem." />
          </div>
        </div>
      </Cartao>

      {/* ── COMO VOCÊ TRABALHA ──
          Quatro perguntas que não identificam ninguém e mudam tudo: elas
          decidem o que o painel destaca no primeiro mês, o que o assistente
          já sabe da loja, e se a gente oferece importar por planilha antes de
          a pessoa desistir de digitar.

          Todas OPCIONAIS. Cadastro que trava por causa de pergunta de pesquisa
          é cadastro que a pessoa abandona — e aí a gente não fica nem com o
          dado nem com o cliente. */}
      <Cartao titulo="Como você trabalha hoje">
        <p className="mb-4 text-sm text-tinta-2">
          Nada aqui é obrigatório, e nada aqui é sobre dinheiro. É o que faz o
          sistema chegar já com a sua cara em vez de uma tela vazia.
        </p>

        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Selecao
              rotulo="Quantas pessoas mexem no sistema?"
              name="porte"
              defaultValue=""
              opcoes={[{ valor: '', titulo: 'Prefiro não dizer' }, ...PORTES]}
            />
            <Selecao
              rotulo="Quantos produtos, mais ou menos?"
              name="catalogo"
              defaultValue=""
              opcoes={[{ valor: '', titulo: 'Não sei ainda' }, ...CATALOGOS]}
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="pb-2 text-sm font-medium text-tinta">
              Por onde você vende? <span className="text-tinta-3">Marque quantas quiser.</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {CANAIS.map((c) => (
                <Marcar
                  key={c.valor}
                  name="comoVende"
                  value={c.valor}
                  titulo={c.titulo}
                  resumo={c.resumo}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="pb-2 text-sm font-medium text-tinta">
              O que mais te incomoda hoje? <span className="text-tinta-3">Escolha uma.</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {DORES.map((d) => (
                <Marcar
                  key={d.valor}
                  type="radio"
                  name="dor"
                  value={d.valor}
                  titulo={d.titulo}
                  resumo={d.resumo}
                />
              ))}
            </div>
          </fieldset>
        </div>
      </Cartao>

      <Cartao
        titulo="O que você usa"
        acao={
          <span className="numero rounded-full bg-bom-fundo px-2 py-0.5 text-xs font-bold text-bom">
            {TODOS.filter((m) => marcado(m)).length} de {TODOS.length}
          </span>
        }
      >
        <p className="mb-3 text-sm text-tinta-2">
          O que ficar desmarcado <b>não aparece no sistema</b>. Nada some para sempre — dá
          para ligar depois em Configurações, quando o negócio mudar.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {TODOS.map((m) => (
            <Marcar
              key={m}
              name={`modulo_${m}`}
              titulo={MODULOS[m].pergunta}
              resumo={MODULOS[m].resumo}
              checked={marcado(m)}
              onChange={(e) => alternar(m, e.target.checked)}
            />
          ))}
        </div>
      </Cartao>

      {marcado('agente') && (
        <Cartao titulo="Seu assistente">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              rotulo="Como ele se chama?"
              name="agenteNome"
              placeholder="Bia, Léo, Central..."
              dica="É o nome com que ele se apresenta no WhatsApp. O assistente é seu — quem batiza é você."
            />
            <Campo rotulo="Cor da sua marca" name="corMarca" type="color" defaultValue="#0D4A57"
                   dica="Aparece na barra lateral e nos comprovantes." />
          </div>
        </Cartao>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-tinta-3">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-marca" />
          Dados de pagamento e certificado digital não entram aqui — eles têm tela própria,
          e só você digita.
        </p>
        <Botao type="submit" tom="confirmar" carregando={pendente}>
          {pendente ? 'Salvando...' : 'Começar a usar'}
        </Botao>
      </div>
    </form>
  )
}
