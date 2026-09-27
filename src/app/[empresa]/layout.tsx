import type { Metadata, Viewport } from 'next'
import { empresaDoEndereco, montarTitulo } from '@/servidor/titulo'

// A moldura de metadados de toda tela de uma empresa. Não desenha nada: cada
// tela monta a própria Estrutura (menu, cabeçalho), porque o menu depende da
// sessão, que só a tela lê.
//
// Três coisas moram aqui porque valem para TODA tela da empresa:
//   • o título: cada tela diz só o nome dela (`title: 'Vendas'`) e o modelo
//     completa "· Comércio Exemplo · Norte";
//   • o manifesto do "instalar como app" (tablet do balcão), por empresa — o
//     app instalado abre no endereço DELA, com o nome dela;
//   • `noindex`: tela de empresa (inclusive a de entrar) não é página para
//     buscador. Sem isto, o Google indexava /padaria-do-ze/entrar e entregava
//     a lista de clientes do Norte a quem procurasse.
export async function generateMetadata({ params }: { params: Promise<{ empresa: string }> }): Promise<Metadata> {
  const { empresa: slug } = await params
  const empresa = await empresaDoEndereco(slug)
  if (!empresa) return { title: 'Norte', robots: { index: false, follow: false } }
  return {
    title: { template: `%s · ${montarTitulo(null, empresa.nome)}`, default: montarTitulo(null, empresa.nome) },
    robots: { index: false, follow: false },
    manifest: `/${empresa.slug}/manifest.webmanifest`,
    appleWebApp: { capable: true, title: empresa.nome, statusBarStyle: 'default' },
    icons: { apple: '/marca/norte-app-192.png' },
  }
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#090d16' },
  ],
}

export default function LayoutDaEmpresa({ children }: { children: React.ReactNode }) {
  return children
}
