'use client'

// A ficha do cliente: cadastrar e editar usam a mesma tela.
//
// ── o que é obrigatório, e por quê ───────────────────────────
// Só o nome. CPF não, endereço não, nem telefone. No comércio de bairro
// quase ninguém pede CPF, e exigir campo para cadastrar faz a vendedora
// desistir e vender sem cliente — e aí não existe histórico, não existe
// "cliente sumido", e o assistente não tem a quem escrever.
//
// O telefone é o campo que MAIS importa mesmo não sendo obrigatório: é por
// ele que o assistente fala, é por ele que a cobrança sai, e é ele que
// impede a mesma pessoa de virar quatro cadastros.

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Botao, Campo, Marcar, Aviso, Cartao, Selecao } from '@/ui/base'
import { criar, editar, type EstadoCliente } from './acoes'

/**
 * As ofertas no WhatsApp, como a ficha mostra. Os textos vêm prontos do
 * servidor (src/servidor/ofertas.ts): a versão do texto que a pessoa ouviu é
 * a que vai para o livro, e ela mora num lugar só.
 */
export type OfertasNaTela = {
  atual: 'SIM' | 'NAO' | 'NAO_PERGUNTADO'
  /** "Aceitou em 25/09/2026, no balcão, anotado por Ana." — nulo se ninguém perguntou. */
  resumo: string | null
  /** O que perguntar, com o nome da loja. */
  pergunta: string
  /** O que a bolinha "Aceitou" quer dizer. */
  textoAceite: string
  origens: { valor: string; titulo: string }[]
  /** O número está na lista de quem não recebe? A frase, e se só a pessoa tira. */
  lista: { frase: string; soAPessoa: boolean } | null
}

export type ClienteNaTela = {
  id: string
  nome: string
  telefone: string
  documento: string
  email: string
  nascimento: string
  endereco: string
  numero: string
  bairro: string
  cidade: string
  estado: string
  cep: string
  observacoes: string
  ativo: boolean
}

export function Editor({ slug, cliente, ofertas }: { slug: string; cliente?: ClienteNaTela; ofertas: OfertasNaTela }) {
  const acao = cliente ? editar.bind(null, slug, cliente.id) : criar.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoCliente, FormData>(acao, {})
  const [escolha, setEscolha] = useState(ofertas.atual)
  // "Aceitou" por cima de um PARAR não existe: só a pessoa desfaz, mandando VOLTAR.
  const simTravado = !!ofertas.lista?.soAPessoa

  return (
    <form action={agir} className="flex max-w-3xl flex-col gap-5">
      {estado.erro && (
        <Aviso nivel="critico">
          <span className="flex flex-wrap items-center gap-2">
            {estado.erro}
            {estado.jaExisteId && (
              <Link
                href={`/${slug}/clientes/${estado.jaExisteId}`}
                className="font-semibold underline underline-offset-2"
              >
                Abrir {estado.jaExisteNome}
              </Link>
            )}
          </span>
        </Aviso>
      )}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <Cartao titulo="Quem é">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome" name="nome" required defaultValue={cliente?.nome ?? ''} placeholder="Maria da Silva" />
          <Campo
            rotulo="WhatsApp"
            name="telefone"
            inputMode="tel"
            defaultValue={cliente?.telefone ?? ''}
            placeholder="(71) 99999-0000"
            dica="É por aqui que o assistente fala e a cobrança sai."
          />
          <Campo
            rotulo="CPF"
            name="documento"
            inputMode="numeric"
            defaultValue={cliente?.documento ?? ''}
            placeholder="Opcional"
            dica="Só é obrigatório para nota fiscal e crediário."
          />
          <Campo rotulo="E-mail" name="email" type="email" defaultValue={cliente?.email ?? ''} placeholder="Opcional" />
          <Campo
            rotulo="Aniversário"
            name="nascimento"
            type="date"
            defaultValue={cliente?.nascimento ?? ''}
            dica="Serve para o assistente lembrar você de mandar um recado."
          />
        </div>
      </Cartao>

      <Cartao titulo="Onde mora">
        <p className="mb-3 text-sm text-tinta-2">
          Só precisa quando você entrega ou emite nota. Deixe em branco se não usa.
        </p>
        <div className="grid gap-4 sm:grid-cols-6">
          <div className="sm:col-span-4">
            <Campo rotulo="Rua" name="endereco" defaultValue={cliente?.endereco ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <Campo rotulo="Número" name="numero" defaultValue={cliente?.numero ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <Campo rotulo="Bairro" name="bairro" defaultValue={cliente?.bairro ?? ''} />
          </div>
          <div className="sm:col-span-2">
            <Campo rotulo="Cidade" name="cidade" defaultValue={cliente?.cidade ?? ''} />
          </div>
          <div className="sm:col-span-1">
            <Campo rotulo="UF" name="estado" maxLength={2} defaultValue={cliente?.estado ?? ''} />
          </div>
          <div className="sm:col-span-1">
            <Campo rotulo="CEP" name="cep" inputMode="numeric" defaultValue={cliente?.cep ?? ''} />
          </div>
        </div>
      </Cartao>

      <Cartao titulo="Observações">
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Observações</span>
          <textarea
            name="observacoes"
            rows={3}
            defaultValue={cliente?.observacoes ?? ''}
            placeholder="Prefere ser avisada de manhã. Usa 38. Sempre leva conjunto."
            className="rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
          />
          <span className="text-xs text-tinta-3">
            O que a equipe precisa lembrar. O assistente também lê isto.
          </span>
        </label>
      </Cartao>

      <Cartao titulo="Ofertas no WhatsApp">
        {/* O texto da pergunta, na tela, do lado da escolha: consentimento
            que ninguém leu não é "informado" (LGPD art. 8º). */}
        <div className="flex flex-col gap-1 rounded-norte border border-borda bg-superficie-2 px-3 py-2.5 text-sm">
          <span className="text-xs font-semibold text-tinta-3">Pergunte com estas palavras</span>
          <span className="text-tinta">“{ofertas.pergunta}”</span>
          <span className="text-xs text-tinta-3">
            Só marque &quot;aceitou&quot; se a pessoa disser sim. Sem aceite, a loja não começa conversa de oferta com ela
            — responder quando ela escreve continua valendo.
          </span>
        </div>
        {ofertas.resumo && <p className="text-sm text-tinta-2">{ofertas.resumo}</p>}
        {ofertas.lista && (
          <Aviso nivel="atencao">
            {ofertas.lista.frase}
            {ofertas.lista.soAPessoa
              ? ' Só volta a receber se a própria pessoa mandar VOLTAR para o WhatsApp da loja.'
              : ''}
          </Aviso>
        )}
        <div role="radiogroup" aria-label="A pessoa aceita receber ofertas no WhatsApp?" className="grid gap-2 sm:grid-cols-3">
          {ofertas.atual === 'NAO_PERGUNTADO' && (
            <Marcar
              type="radio"
              name="ofertas"
              value="NAO_PERGUNTADO"
              checked={escolha === 'NAO_PERGUNTADO'}
              onChange={() => setEscolha('NAO_PERGUNTADO')}
              titulo="Ainda não perguntei"
              resumo="Não é aceite. Nenhuma oferta começa por conta da loja."
            />
          )}
          <Marcar
            type="radio"
            name="ofertas"
            value="SIM"
            checked={escolha === 'SIM'}
            onChange={() => setEscolha('SIM')}
            disabled={simTravado && ofertas.atual !== 'SIM'}
            titulo="Aceitou"
            resumo={ofertas.textoAceite}
          />
          <Marcar
            type="radio"
            name="ofertas"
            value="NAO"
            checked={escolha === 'NAO'}
            onChange={() => setEscolha('NAO')}
            titulo="Não aceitou"
            resumo="O número entra na lista de quem não recebe ofertas, e sai de qualquer campanha."
          />
        </div>
        {escolha !== ofertas.atual && escolha !== 'NAO_PERGUNTADO' && (
          <div className="max-w-xs">
            <Selecao
              rotulo="Como a pessoa respondeu"
              name="ofertasOrigem"
              defaultValue="balcao"
              opcoes={ofertas.origens}
              dica="Fica gravado com a data e o seu nome — é a prova do aceite."
            />
          </div>
        )}
      </Cartao>

      {cliente && (
        <Cartao titulo="Situação">
          <Marcar
            name="ativo"
            defaultChecked={cliente.ativo}
            titulo="Cliente ativo"
            resumo="Desmarcado, some da busca do balcão — e continua no histórico de tudo que já comprou."
          />
        </Cartao>
      )}

      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/${slug}/clientes`}
          className="text-sm font-medium text-tinta-3 underline-offset-2 hover:text-tinta hover:underline"
        >
          Voltar
        </Link>
        <Botao type="submit" tom="confirmar" carregando={pendente}>
          {pendente ? 'Salvando...' : cliente ? 'Salvar' : 'Cadastrar'}
        </Botao>
      </div>
    </form>
  )
}
