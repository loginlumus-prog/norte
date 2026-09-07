import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { comoOrg } from '@/servidor/banco'
import { pode, PODERES } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao } from '@/ui/base'
import { Tabela } from '@/ui/Tabela'
import type { Tema } from '@/ui/TrocaTema'


export default async function Painel({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug)

  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // Tudo daqui para baixo passa por comoOrg: mesmo sem filtro escrito, o banco
  // só devolve o que é desta empresa.
  const { unidades, equipe, livro } = await comoOrg(sessao.orgId, async (db) => ({
    unidades: await db.unidade.findMany({
      where: { ativa: true },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, ehDeposito: true, documento: true },
    }),
    equipe: pode(sessao, 'equipe.ver')
      ? await db.usuario.findMany({
          where: { ativo: true },
          orderBy: { nome: 'asc' },
          select: { id: true, nome: true, email: true, acessos: { select: { papel: true } } },
        })
      : [],
    livro: pode(sessao, 'auditoria.ver')
      ? await db.auditoria.findMany({
          orderBy: { criadoEm: 'desc' },
          take: 8,
          select: { id: true, quem: true, acao: true, criadoEm: true, autor: true },
        })
      : [],
  }))

  const menu = MENU(slug).map((i) =>
    i.href === `/${slug}/equipe` ? { ...i, contagem: equipe.length } : i,
  )

  const hora = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menu}
      ativo={`/${slug}`}
      tema={tema}
      titulo="Painel"
    >
      <Cartao titulo="Unidades">
        <Tabela
          colunas={[
            { chave: 'nome', titulo: 'Unidade', celula: (u) => u.nome },
            {
              chave: 'tipo',
              titulo: 'Tipo',
              celula: (u) =>
                u.ehDeposito ? (
                  <Situacao nivel="neutro">Depósito</Situacao>
                ) : (
                  <Situacao nivel="bom">Loja</Situacao>
                ),
            },
            {
              chave: 'doc',
              titulo: 'CNPJ',
              celula: (u) => u.documento ?? <span className="text-tinta-3">não informado</span>,
            },
          ]}
          linhas={unidades}
          chave={(u) => u.id}
          vazio="Nenhuma unidade cadastrada ainda."
        />
      </Cartao>

      {pode(sessao, 'equipe.ver') && (
        <Cartao titulo="Equipe">
          <Tabela
            colunas={[
              { chave: 'nome', titulo: 'Pessoa', celula: (p) => p.nome },
              { chave: 'email', titulo: 'E-mail', celula: (p) => p.email },
              {
                chave: 'papeis',
                titulo: 'Papéis',
                celula: (p) => (
                  <span className="flex flex-wrap gap-1">
                    {p.acessos.map((a, i) => (
                      <Situacao key={i} nivel="neutro">
                        {a.papel}
                      </Situacao>
                    ))}
                  </span>
                ),
              },
            ]}
            linhas={equipe}
            chave={(p) => p.id}
            vazio="Ninguém cadastrado ainda."
          />
        </Cartao>
      )}

      {pode(sessao, 'auditoria.ver') && (
        <Cartao titulo="Últimos registros do livro">
          <Tabela
            colunas={[
              { chave: 'quando', titulo: 'Quando', largura: '7rem', celula: (l) => hora(l.criadoEm) },
              { chave: 'quem', titulo: 'Quem', celula: (l) => l.quem },
              {
                chave: 'acao',
                titulo: 'O que fez',
                celula: (l) => <span className="font-mono text-xs">{l.acao}</span>,
              },
              {
                chave: 'autor',
                titulo: 'Origem',
                celula: (l) => (
                  <Situacao nivel={l.autor === 'AGENTE' ? 'atencao' : 'neutro'}>
                    {l.autor === 'AGENTE' ? 'Agente' : l.autor === 'SISTEMA' ? 'Sistema' : 'Pessoa'}
                  </Situacao>
                ),
              },
            ]}
            linhas={livro}
            chave={(l) => l.id}
            vazio="O livro está vazio."
          />
        </Cartao>
      )}

      <Cartao titulo="O que você pode fazer aqui">
        <div className="flex flex-wrap gap-1.5">
          {sessao.acessos.flatMap((a) =>
            PODERES[a.papel].map((c) => (
              <span
                key={`${a.papel}-${c}`}
                className="rounded bg-superficie-2 px-1.5 py-0.5 font-mono text-xs text-tinta-2"
              >
                {c}
              </span>
            )),
          )}
        </div>
        <p className="mt-3 text-xs text-tinta-3">
          O menu à esquerda nasce desta lista: quem não pode, não vê o item.
        </p>
      </Cartao>
    </Estrutura>
  )
}
