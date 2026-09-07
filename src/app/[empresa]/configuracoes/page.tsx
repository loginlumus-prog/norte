import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { Cartao, Aviso } from '@/ui/base'
import { MENU } from '@/ui/menu'
import type { Tema } from '@/ui/TrocaTema'
import { Modulos } from './Modulos'

const REGIME: Record<string, string> = {
  MEI: 'MEI', SIMPLES: 'Simples Nacional',
  PRESUMIDO: 'Lucro Presumido', REAL: 'Lucro Real',
}

export default async function Configuracoes({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const dados = await comoOrg(sessao.orgId, (db) =>
    db.org.findUnique({
      where: { id: sessao.orgId },
      select: {
        razaoSocial: true, documento: true, inscricaoEstadual: true, regime: true,
        email: true, telefone: true, whatsapp: true, agenteNome: true, ramo: true,
      },
    }),
  )

  const linha = (r: string, v?: string | null) => (
    <div className="flex justify-between gap-4 border-b border-borda-suave py-1.5 last:border-0">
      <span className="text-tinta-3">{r}</span>
      <span className="text-right font-medium text-tinta">
        {v || <span className="font-normal text-tinta-3">não informado</span>}
      </span>
    </div>
  )

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/configuracoes`}
      tema={tema}
      titulo="Configurações"
    >
      <Cartao titulo="O que sua empresa usa">
        {pode(sessao, 'empresa.configurar') ? (
          <Modulos empresa={slug} ligados={empresa.modulos} />
        ) : (
          <Aviso nivel="neutro">Só quem responde pela empresa muda isto.</Aviso>
        )}
      </Cartao>

      <Cartao titulo="Dados da empresa">
        <div className="flex flex-col text-sm">
          {linha('Nome', empresa.nome)}
          {linha('Razão social', dados?.razaoSocial)}
          {linha('CNPJ / CPF', dados?.documento)}
          {linha('Inscrição estadual', dados?.inscricaoEstadual)}
          {linha('Regime tributário', dados?.regime ? REGIME[dados.regime] : null)}
          {linha('Telefone', dados?.telefone)}
          {linha('WhatsApp', dados?.whatsapp)}
          {linha('E-mail', dados?.email)}
          {linha('Assistente', dados?.agenteNome)}
        </div>
      </Cartao>

      <Cartao titulo="Pagamento e nota fiscal">
        <Aviso nivel="atencao">
          Dados de conta bancária, maquininha e certificado digital não ficam aqui — eles
          têm tela própria, com registro de quem mexeu, e só você digita.
        </Aviso>
      </Cartao>
    </Estrutura>
  )
}
