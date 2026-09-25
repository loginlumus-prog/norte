import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { colunaDoDia, diaEmSP, mostrarDiaDaColuna } from '@/servidor/dia'
import { ORIGENS_SAIDA, listarSemOfertas, type LinhaSemOfertas } from '@/servidor/ofertas'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Secao } from '@/ui/painel'
import { Cartao, Situacao } from '@/ui/base'
import { Tabela } from '@/ui/Tabela'
import type { Tema } from '@/ui/TrocaTema'
import { plural } from '@/ui/texto'
import { AnotarNumero, TirarNumero } from './Lista'

// Quem não recebe oferta no WhatsApp — a lista de descadastro da empresa.
//
// Entra aqui quem mandou PARAR, o número que a loja anotou (a pessoa pediu
// por telefone, no balcão, com outras palavras), a ficha marcada "não
// aceita" e o cadastro anonimizado. Nenhuma campanha começa para quem está
// na lista — nem com a palavra-chave. Ver src/servidor/ofertas.ts.
//
// Os números aparecem MASCARADOS: a lista serve para conferir e para tirar o
// que a loja pôs por engano, não para virar agenda de quem pediu para não ser
// procurado.

const dia = (d: Date) => mostrarDiaDaColuna(colunaDoDia(diaEmSP(d)), 'longo')

export default async function SemOfertas({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'cliente.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const linhas = await listarSemOfertas(sessao)
  const podeEditar = pode(sessao, 'cliente.editar')

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/clientes`}
      tema={tema}
      titulo="Sem ofertas no WhatsApp"
    >
      <Secao
        titulo={plural(linhas.length, 'número', 'números')}
        resumo="Quem está aqui não entra em campanha nenhuma, nem mandando a palavra-chave. Quem mandou PARAR só volta mandando VOLTAR para o WhatsApp da loja."
      >
        {podeEditar && (
          <Cartao caixa titulo="Anotar um número">
            <AnotarNumero slug={slug} />
          </Cartao>
        )}

        <Tabela
          colunas={[
            {
              chave: 'numero',
              titulo: 'Número',
              largura: '10rem',
              celula: (l: LinhaSemOfertas) => <span className="numero font-medium text-tinta">{l.telefone}</span>,
            },
            {
              chave: 'por',
              titulo: 'Por quê',
              celula: (l: LinhaSemOfertas) => (
                <span className="flex flex-col">
                  <span className="text-tinta">{ORIGENS_SAIDA[l.origem] ?? l.origem}</span>
                  {l.cliente && (
                    <Link href={`/${slug}/clientes/${l.cliente.id}`} className="text-xs font-medium text-marca underline-offset-2 hover:underline">
                      {l.cliente.nome}
                    </Link>
                  )}
                </span>
              ),
            },
            {
              chave: 'desde',
              titulo: 'Desde',
              largura: '7rem',
              celula: (l: LinhaSemOfertas) => <span className="numero text-tinta-2">{dia(l.em)}</span>,
            },
            {
              chave: 'acao',
              titulo: '',
              largura: '9rem',
              celula: (l: LinhaSemOfertas) =>
                l.lojaTira ? (
                  podeEditar ? <TirarNumero slug={slug} id={l.id} /> : null
                ) : (
                  <Situacao nivel="neutro">só com VOLTAR</Situacao>
                ),
            },
          ]}
          linhas={linhas}
          chave={(l) => l.id}
          vazio="Ninguém pediu para sair das ofertas."
        />
      </Secao>
    </Estrutura>
  )
}
