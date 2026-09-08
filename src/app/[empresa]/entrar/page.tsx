import { notFound } from 'next/navigation'
import { acharOrgPorSlug } from '@/servidor/banco'
import { Aviso } from '@/ui/base'
import { Marca } from '@/ui/Marca'
import { Traco } from '@/ui/Traco'
import { Formulario } from './Formulario'

// A tela de entrar é a primeira coisa que o cliente vê todo dia de manhã, e
// era a mais sem graça do sistema: um quadrado colorido, um nome e dois
// campos soltos no branco.
//
// Ela é dividida ao meio de propósito. À esquerda o azul-noite com a marca —
// é o que diz "isto é um produto, tem gente por trás". À direita o branco com
// o formulário. No celular a metade azul vira uma faixa fina em cima: a
// mesma ideia, sem roubar a tela de quem só quer digitar a senha.
export default async function Entrar({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa } = await params
  const org = await acharOrgPorSlug(empresa)
  if (!org) notFound()

  const suspensa = org.situacao === 'SUSPENSA' || org.situacao === 'CANCELADA'

  return (
    <main className="flex min-h-dvh flex-col md:flex-row">
      {/* ── lado da marca ── */}
      <aside className="nav-fundo relative flex flex-col justify-between gap-8 overflow-hidden p-6 md:w-[42%] md:max-w-md md:p-10">
        {/* METADE da bussola, cortada exatamente no eixo.

            O centro dela fica em cima da costura entre o azul e o papel
            (`right-0` mais `translate-x-1/2`), e o `overflow-hidden` do
            painel corta o resto. Meia bussola no fio da divisao le como
            instrumento encostado na borda; a bussola inteira, centrada,
            leria como um segundo logo competindo com o de cima.

            Grande de proposito, ocupando o painel de cima a baixo. A
            chamada passa por cima dela, e aqui isso pode: a 17% num
            blend `screen`, o traco e mais claro que o degrade e mais
            escuro que o texto branco. A regra de nao por desenho atras
            de texto vale para DADO — numero e tabela, onde a pessoa le
            digito por digito. Chamada de capa e outra coisa. */}
        <Traco
          arte="bussola"
          sobre="escuro"
          opacidade={0.17}
          className="pointer-events-none absolute top-1/2 right-0 w-[43rem] max-w-none -translate-y-1/2 translate-x-1/2"
        />

        {/* `relative` em cada bloco: o desenho e absoluto, e sem isto ele
            passaria POR CIMA do texto — irmao posicionado pinta depois. */}
        <div className="relative">
          <Marca tamanho={30} nu claro />
        </div>

        <div className="relative hidden flex-col gap-3 md:flex">
          <h2 className="text-[26px] leading-tight font-extrabold tracking-tight text-nav-tinta">
            A empresa inteira
            <br />
            numa tela só.
          </h2>
          <p className="text-sm leading-relaxed text-nav-tinta-2">
            Produto, estoque, balcão, caixa e o resultado do mês. E um assistente
            no WhatsApp que sabe de tudo isso.
          </p>
        </div>

        <p className="relative hidden text-xs text-nav-tinta-2 md:block">
          Cada empresa entra pelo próprio endereço.
        </p>
      </aside>

      {/* ── lado do trabalho ── */}
      {/* O formulario num cartao sobre o papel, e nao chapado no branco: sem
          a diferenca entre os dois, este lado da tela e uma folha em branco
          com campos soltos, que e exatamente a cara de formulario. */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-fundo p-6">
        {/* A montanha. Uma arte de cada lado da costura: a bussola diz onde
            voce esta, o relevo diz para onde sobe.

            `sobre="tema"` porque ESTE lado troca de cor junto com a pessoa —
            e creme no claro e quase preto no escuro. Com a positiva fixa, ela
            multiplicava escuro sobre escuro e sumia no tema escuro. */}
        <Traco
          arte="relevo"
          sobre="tema"
          opacidade={0.09}
          className="pointer-events-none absolute inset-x-0 -bottom-10 w-full max-w-none"
        />
        <div className="realce-alto relative flex w-full max-w-sm flex-col gap-6 rounded-norte border border-borda bg-superficie p-7">
          <header className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-5 w-1.5 shrink-0 rounded-full"
                style={{ background: org.corMarca || 'var(--marca)' }}
              />
              <span className="text-lg font-bold tracking-tight text-tinta">{org.nome}</span>
            </div>
            <p className="text-sm text-tinta-2">Entre para continuar.</p>
          </header>

          {suspensa ? (
            <Aviso nivel="critico">
              O acesso desta empresa está suspenso. Fale com o responsável pela conta.
            </Aviso>
          ) : (
            <Formulario empresa={empresa} />
          )}
        </div>
      </div>
    </main>
  )
}
