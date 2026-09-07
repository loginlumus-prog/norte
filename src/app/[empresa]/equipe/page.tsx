import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { listarEquipe } from '@/servidor/equipe'
import { listarConvites } from '@/servidor/convite'
import { comoOrg } from '@/servidor/banco'
import { pode, podeConceder, type Papel } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Secao, Tira } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Equipe, type PessoaNaTela, type ConviteNaTela } from './Equipe'

const TODOS_PAPEIS: Papel[] = ['DONO', 'GERENTE', 'BALCAO', 'FINANCEIRO', 'CONTADOR']

const dia = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(d)

export default async function TelaEquipe({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const podeGerir = pode(sessao, 'equipe.gerir')

  const [pessoas, convites, unidades] = await Promise.all([
    listarEquipe(sessao),
    podeGerir ? listarConvites(sessao) : Promise.resolve([]),
    comoOrg(sessao.orgId, (db) =>
      db.unidade.findMany({ where: { ativa: true }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }),
    ),
  ])

  // Só os papéis que ESTA pessoa pode conceder. O gerente contrata balconista;
  // só o dono cria outro dono. Mostrar o que não dá para escolher só ensina
  // a pessoa o que ela está perdendo.
  const papeisQuePosso = TODOS_PAPEIS.filter((p) => podeConceder(sessao, p))

  const naTela: PessoaNaTela[] = pessoas.map((p) => {
    const a = p.acessos[0]
    return {
      id: p.id,
      nome: p.nome,
      email: p.email,
      ativo: p.ativo,
      ultimoLogin: p.ultimoLogin ? dia(p.ultimoLogin) : null,
      papel: a?.papel ?? null,
      unidadeId: a?.unidadeId ?? null,
      unidadeNome: a?.unidadeNome ?? null,
      souEu: p.id === sessao.usuarioId,
    }
  })

  const agora = new Date()
  const convitesNaTela: ConviteNaTela[] = convites.map((c) => ({
    id: c.id,
    email: c.email,
    papel: c.papel,
    expiraEm: dia(c.expiraEm),
    vencido: c.expiraEm < agora,
  }))

  const ativos = naTela.filter((p) => p.ativo).length
  const semAcesso = naTela.filter((p) => p.ativo && !p.papel).length

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/equipe`}
      tema={tema}
      titulo="Equipe"
    >
      <Tira
        itens={[
          { rotulo: 'com acesso', quantos: ativos - semAcesso, nivel: 'bom' },
          { rotulo: 'convite esperando', quantos: convitesNaTela.length, nivel: 'atencao' },
          { rotulo: 'sem acesso', quantos: naTela.length - ativos + semAcesso, nivel: 'neutro' },
        ]}
      />

      <Secao titulo="Equipe">
        <Equipe
          slug={slug}
          pessoas={naTela}
          convites={convitesNaTela}
          unidades={unidades}
          papeisQuePosso={papeisQuePosso}
          podeGerir={podeGerir}
        />
      </Secao>
    </Estrutura>
  )
}
