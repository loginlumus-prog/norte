'use client'

// Mudar a assinatura.
//
// ── um plano, chaves por cima ────────────────────────────────
// Desde a tabela de 02/10/2026 só se vende o Norte, por loja. O que muda a
// conta é LIGAR coisas: o assistente (aqui), a fábrica (abrindo a unidade de
// fábrica em Lojas) e o Farol (pela equipe, no contrato). Por isso a tela
// deixou de ser uma fileira de cartões de plano para comparar: é uma frase
// com o número — "sua conta passa de X para Y" — e um botão.
//
// Por baixo, ligar o assistente continua sendo trocar de BALCAO para
// BALCAO_AGENTE (ver planos.ts): o pedido, os módulos e o livro são os de
// sempre.
//
// ── os casos ─────────────────────────────────────────────────
//   • em teste, ou no Grátis: assinar o Norte, com ou sem o assistente — é
//     pedido; a gente confirma o pagamento e nada do que foi lançado se perde
//   • no Norte sem assistente: ligar (pedido, porque passa a custar mais)
//   • no Norte com assistente: desligar (na hora, perguntando antes o que sai)
//   • contrato e Corporativo: a troca é conversa, não clique
//
// O preço é sempre o DESTA empresa (`mudanca` usa `mensalidade`, com as lojas,
// a fábrica e o Farol dela), nunca o de vitrine.

import { useActionState, type ReactNode } from 'react'
import type { Plano, Situacao } from '@prisma/client'
import { MODULOS, type Modulo } from '@/servidor/modulos'
import { PLANOS, PRECOS, milhar, type Mudanca } from '@/servidor/planos'
import { Botao, Aviso } from '@/ui/base'
import { Confirmar } from '@/ui/Confirmar'
import { trocar, type EstadoAssinatura } from './acoes'

/** Os nomes dos módulos, para gente: "Campanhas", e não "campanhas". */
const nomes = (lista: string[]) => lista.map((x) => MODULOS[x as Modulo]?.titulo ?? x).join(', ')

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)

/** Uma linha: o que é, quanto fica por mês, e o botão — número alinhado à direita. */
function Linha({ titulo, detalhe, valor, children }: { titulo: string; detalhe: string; valor: number | null; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-borda-suave py-3 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-tinta">{titulo}</p>
        <p className="text-xs leading-snug text-tinta-3">{detalhe}</p>
      </div>
      {valor !== null && (
        <p className="numero w-28 shrink-0 text-right text-sm font-bold text-tinta">
          {brl(valor)}
          <span className="font-normal text-tinta-3">/mês</span>
        </p>
      )}
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function Planos({
  slug,
  atual,
  situacao,
  mensalHoje,
  semAssistente,
  comAssistente,
  podeTrocar,
  whatsapp,
}: {
  slug: string
  atual: Plano
  situacao: Situacao
  /** A conta de hoje, pela tabela. `null` = sob consulta. */
  mensalHoje: number | null
  /** O quadro de ir para o Norte sem o assistente, e com ele. */
  semAssistente: Mudanca
  comAssistente: Mudanca
  podeTrocar: boolean
  /** Nosso WhatsApp comercial. Sem ele, o contato vai pelo suporte. */
  whatsapp: string | null
}) {
  const acao = trocar.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoAssinatura, FormData>(acao, {})

  const emTeste = situacao === 'TESTE'
  const deContrato = atual === 'REDE' || atual === 'CORPORATIVO'

  const contato = (texto: string, rotulo = 'Falar com a gente') =>
    whatsapp ? (
      <a
        href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(texto)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center rounded-norte border border-borda bg-superficie px-3 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
      >
        {rotulo}
      </a>
    ) : (
      <span className="text-sm text-tinta-3">Fale com o suporte.</span>
    )

  const botao = (para: Plano, rotulo: string, principal = false) => (
    <form action={agir}>
      <input type="hidden" name="plano" value={para} />
      <Botao
        type="submit"
        tom={principal ? 'principal' : 'secundario'}
        disabled={!podeTrocar || pendente}
        carregando={pendente}
      >
        {rotulo}
      </Botao>
    </form>
  )

  return (
    <div className="flex flex-col gap-3">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      {deContrato ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm leading-relaxed text-tinta-2">
            {atual === 'CORPORATIVO'
              ? 'O Corporativo é fechado em contrato. Para mudar o que está combinado, fale com a gente.'
              : `O ${PLANOS[atual].titulo} é combinado em contrato. Para mudar, fale com a gente.`}
          </p>
          {contato(`Olá! Tenho o plano ${PLANOS[atual].titulo} e quero conversar sobre a assinatura.`)}
        </div>
      ) : emTeste || atual === 'GRATIS' ? (
        <>
          <Linha
            titulo={`${PLANOS.BALCAO.titulo} com o assistente`}
            detalhe={`Tudo da loja e o assistente no WhatsApp, com ${milhar(PRECOS.respostasDoAssistente)} respostas por mês.`}
            valor={comAssistente.novoMensal}
          >
            {botao('BALCAO_AGENTE', 'Assinar', true)}
          </Linha>
          <Linha
            titulo={PLANOS.BALCAO.titulo}
            detalhe="Tudo da loja, sem o assistente. Dá para ligar depois."
            valor={semAssistente.novoMensal}
          >
            {botao('BALCAO', 'Assinar')}
          </Linha>
          {/* Uma loja a mais no Grátis não cabe: o impedimento é dito, não escondido. */}
          {[...semAssistente.impedimentos].map((i) => (
            <p key={i} className="rounded-norte bg-atencao-fundo px-2.5 py-1.5 text-xs text-atencao">{i}</p>
          ))}
          <p className="text-xs leading-relaxed text-tinta-3">
            Assinar é um pedido: a gente confirma o pagamento com você e
            {emTeste ? ' o teste vira assinatura' : ' o que desligou volta'}, com tudo o que já foi lançado.
          </p>
        </>
      ) : atual === 'BALCAO' ? (
        <Linha
          titulo="Ligar o assistente"
          detalhe={`+${brl(PRECOS.assistente)} por mês para a empresa inteira, com ${milhar(PRECOS.respostasDoAssistente)} respostas. Sua conta passa de ${mensalHoje !== null ? brl(mensalHoje) : '—'} para:`}
          valor={comAssistente.novoMensal}
        >
          {botao('BALCAO_AGENTE', 'Ligar o assistente', true)}
        </Linha>
      ) : (
        <Linha
          titulo="Desligar o assistente"
          detalhe={`Sai ${brl(PRECOS.assistente)} da conta. Sua conta passa de ${mensalHoje !== null ? brl(mensalHoje) : '—'} para:`}
          valor={semAssistente.novoMensal}
        >
          {podeTrocar ? (
            // Desligar vale NA HORA — e era um clique só. Agora pergunta,
            // dizendo o que sai.
            <Confirmar
              tom="secundario"
              tomSim="perigo"
              pergunta={
                <span className="block text-left">
                  O assistente para de responder agora
                  {semAssistente.perde.length > 0 ? `, e sai: ${nomes(semAssistente.perde)}` : ''}. Trocar mesmo?
                </span>
              }
              sim="Sim, desligar"
              aoConfirmar={() => {
                const fd = new FormData()
                fd.set('plano', 'BALCAO')
                agir(fd)
              }}
            >
              Desligar
            </Confirmar>
          ) : (
            <Botao tom="secundario" disabled>
              Desligar
            </Botao>
          )}
        </Linha>
      )}

      {!deContrato && (
        <p className="text-xs leading-relaxed text-tinta-3">
          Rede grande, várias marcas ou operação especial? O Corporativo é montado com você.{' '}
          {whatsapp ? (
            <a
              href={`https://wa.me/${whatsapp}?text=${encodeURIComponent('Olá! Quero conversar sobre o plano Corporativo do Norte.')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-marca underline-offset-2 hover:underline"
            >
              Falar com a gente
            </a>
          ) : (
            'Fale com o suporte.'
          )}
        </p>
      )}
      {!podeTrocar && <Aviso nivel="neutro">Só quem responde pela empresa muda a assinatura.</Aviso>}
    </div>
  )
}
