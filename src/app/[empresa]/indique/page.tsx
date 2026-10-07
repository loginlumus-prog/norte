import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { ehSuporteDoNorte, pode } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { mostrar } from '@/servidor/dinheiro'
import { PRECOS } from '@/servidor/planos'
import { enderecoPublico } from '@/servidor/requisicao'
import {
  CARENCIA_DIAS,
  DESCONTO_PRIMEIRA_PCT,
  DIA_DO_REPASSE,
  FAIXAS,
  MESES_DE_COMISSAO,
  NIVEL2_PCT,
  painelDoParceiro,
  parceiroDaEmpresa,
} from '@/servidor/parceiros'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso, Cartao, Situacao } from '@/ui/base'
import { Numero, Secao } from '@/ui/painel'
import { BotaoDaLinha } from '@/ui/premium'
import type { Tema } from '@/ui/TrocaTema'
import { Ativar } from './Ativar'
import { abrirPainelAcao } from './acoes'

export const metadata: Metadata = { title: 'Indique e ganhe' }

// O programa de parceiros do lado de quem já é cliente: o dono indica o Norte
// para outras lojas e recebe a comissão no Pix — as mesmas regras de quem é
// parceiro de fora (src/servidor/parceiros.ts). Aqui fica o resumo e o link;
// o painel completo (comissões linha a linha, rede, Pix) é o de /parceiros.

const SITUACAO = {
  teste: { nivel: 'neutro', texto: 'Em teste' },
  pagando: { nivel: 'bom', texto: 'Pagando' },
  parou: { nivel: 'atencao', texto: 'Parou' },
} as const

export default async function Indique({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  if (!pode(sessao, 'empresa.configurar')) semAcesso(slug, 'cargo')

  const parceiroId = await parceiroDaEmpresa(sessao.orgId)
  const p = parceiroId ? await painelDoParceiro(parceiroId) : null
  const u = await comoOrg(sessao.orgId, (db) => db.usuario.findUnique({ where: { id: sessao.usuarioId }, select: { email: true } }))
  const base = (await enderecoPublico()) ?? 'https://gestornorte.com'
  const suporte = ehSuporteDoNorte(sessao)
  const min = FAIXAS[0]!.pct
  const max = FAIXAS[FAIXAS.length - 1]!.pct

  return (
    <Estrutura empresa={empresa} sessao={sessao} itens={MENU(slug)} ativo={`/${slug}/indique`} tema={tema} titulo="Indique e ganhe">
      <Secao titulo="Como funciona">
        <Cartao>
          <ul className="flex flex-col gap-2 text-sm text-tinta-2">
            <li>
              Você manda o seu link para outra loja. Ela testa o Norte {PRECOS.diasDeTeste} dias grátis e, quando assina, paga{' '}
              <b className="text-tinta">metade da primeira mensalidade</b> ({DESCONTO_PRIMEIRA_PCT}% de desconto).
            </li>
            <li>
              Você recebe <b className="text-tinta">de {min}% a {max}%</b> de cada mensalidade que ela pagar, nos primeiros{' '}
              {MESES_DE_COMISSAO} meses — a porcentagem sobe com o número de lojas suas pagando.
            </li>
            <li>
              O dinheiro libera {CARENCIA_DIAS} dias depois do pagamento e cai no seu Pix todo dia {DIA_DO_REPASSE}. Trazendo
              outros parceiros, você ganha mais {NIVEL2_PCT}% sobre as lojas deles.
            </li>
          </ul>
          <span className="mt-3 inline-block">
            <BotaoDaLinha comRotulo externo href="/parceiros" icone="ver" rotulo="Ver todas as regras e exemplos" />
          </span>
        </Cartao>
      </Secao>

      {!p ? (
        <Secao titulo="Ativar">
          {suporte ? (
            <Aviso>Só o dono da empresa ativa o Indique e ganhe.</Aviso>
          ) : (
            <Cartao caixa>
              <Ativar slug={slug} email={u?.email ?? ''} />
            </Cartao>
          )}
        </Secao>
      ) : (
        <>
          <Secao titulo="O seu resultado">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Numero
                principal
                rotulo="Sua porcentagem"
                valor={`${p.faixa.pct}%`}
                detalhe={p.faixa.proxima ? `faltam ${p.faixa.proxima.faltam} lojas para ${p.faixa.proxima.pct}%` : 'faixa mais alta'}
              />
              <Numero rotulo="Liberado" valor={mostrar(p.totais.liberadoCent)} detalhe={`sai no Pix do dia ${DIA_DO_REPASSE}`} />
              <Numero rotulo="Em carência" valor={mostrar(p.totais.carenciaCent)} detalhe={`${CARENCIA_DIAS} dias após o pagamento`} />
              <Numero
                rotulo="Já recebido"
                valor={mostrar(p.totais.pagoCent)}
                detalhe={p.parceiro.pixChave ? 'no seu Pix' : 'falta cadastrar o Pix'}
                nivel={p.parceiro.pixChave ? undefined : 'atencao'}
              />
            </div>
          </Secao>

          <Secao titulo="Seu link">
            <Cartao>
              <code className="block truncate rounded-norte bg-superficie-2 px-3 py-2 text-sm">{`${base}/?ref=${p.parceiro.codigo}`}</code>
              <p className="mt-2 text-xs text-tinta-3">
                Código: <b>{p.parceiro.codigo}</b> — quem preferir pode digitar no cadastro.
              </p>
              {!suporte && (
                <form action={abrirPainelAcao.bind(null, slug)} className="mt-3">
                  <button type="submit" className="botao-marca rounded-norte px-4 py-2 text-sm font-semibold text-marca-tinta">
                    Abrir o painel completo: copiar link, Pix e comissões
                  </button>
                </form>
              )}
            </Cartao>
          </Secao>

          <Secao titulo="Lojas que você indicou">
            {p.indicacoes.length === 0 ? (
              <Aviso>Ainda nenhuma. Mande o link para uma loja que você conhece.</Aviso>
            ) : (
              <ul className="flex flex-col divide-y divide-borda rounded-norte border border-borda bg-superficie">
                {p.indicacoes.slice(0, 10).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="font-medium">{i.empresa}</span>
                    <span className="flex items-center gap-3">
                      <Situacao nivel={SITUACAO[i.situacao].nivel}>{SITUACAO[i.situacao].texto}</Situacao>
                      <span className="tabular-nums text-tinta-2">{mostrar(i.ganhoCent)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
        </>
      )}
    </Estrutura>
  )
}
