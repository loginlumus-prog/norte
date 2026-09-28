import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { comoOrg } from '@/servidor/banco'
import { NOME_DO_PAPEL } from '@/servidor/guia'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Secao } from '@/ui/painel'
import { Cartao } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { TrocarSenha } from './TrocarSenha'
import { TrocarNome } from './TrocarNome'

// Minha conta: quem eu sou aqui, e trocar a minha senha.
//
// Abre para TODO mundo que entrou — não é tela de gestão, é a da própria
// pessoa. Chega-se clicando no próprio nome, no rodapé do menu. A senha de
// OUTRA pessoa não se troca aqui: quem gere a equipe gera um link para ela na
// tela Equipe (ver servidor/conta.ts, `gerarLinkDeSenha`).

export const metadata: Metadata = { title: 'Minha conta' }

const dia = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(d)

export default async function MinhaConta({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const eu = await comoOrg(sessao.orgId, (db) =>
    db.usuario.findUnique({
      where: { id: sessao.usuarioId },
      select: { nome: true, email: true, criadoEm: true },
    }),
  )
  const papeis = [...new Set(sessao.acessos.map((a) => NOME_DO_PAPEL[a.papel]))].join(', ')
  const soSuporte = sessao.acessos.length > 0 && sessao.acessos.every((a) => a.papel === 'SUPORTE')

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/conta`}
      tema={tema}
      titulo="Minha conta"
    >
      <Secao titulo="Você no Norte">
        <dl className="grid max-w-xl gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-tinta-3">Nome</dt>
          <dd className="font-semibold text-tinta">{eu?.nome ?? sessao.nome}</dd>
          <dt className="text-tinta-3">E-mail</dt>
          <dd className="break-all text-tinta">{eu?.email}</dd>
          <dt className="text-tinta-3">Papel</dt>
          <dd className="text-tinta">{papeis || '—'}</dd>
          {eu?.criadoEm && (
            <>
              <dt className="text-tinta-3">Conta desde</dt>
              <dd className="numero text-tinta">{dia(eu.criadoEm)}</dd>
            </>
          )}
        </dl>
        <p className="max-w-xl text-xs leading-relaxed text-tinta-3">
          O papel quem muda é quem administra a equipe, na tela Equipe. O e-mail é o seu login e não muda
          por aqui: para usar outro, quem administra a equipe convida o e-mail novo e tira o acesso deste.
        </p>
      </Secao>

      {!soSuporte && (
        <Secao titulo="Meu nome" resumo="É como você aparece nas vendas, nas tarefas e no livro de auditoria.">
          <Cartao caixa>
            <TrocarNome slug={slug} nome={eu?.nome ?? sessao.nome} />
          </Cartao>
        </Secao>
      )}

      <Secao
        titulo="Trocar minha senha"
        resumo="Com a senha atual. Esqueceu a atual? Saia e use “Esqueci a senha” na tela de entrar."
      >
        <Cartao caixa>
          <TrocarSenha slug={slug} email={eu?.email ?? ''} />
        </Cartao>
      </Secao>
    </Estrutura>
  )
}
