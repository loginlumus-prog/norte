import { Esqueleto } from '@/ui/Esqueleto'

// O balcão usa a lateral recolhida (só ícones): o esqueleto dele também, senão
// a troca pula de 240px para 68px quando a tela chega.
export default function Carregando() {
  return <Esqueleto recolhida />
}
