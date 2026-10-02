// Que desenho vai no lugar da foto, quando o produto não tem foto.
//
// O produto sem foto continua no catálogo; no lugar da foto entra um desenho
// simples do que ele É — o cabide na blusa, o sapato na sandália, o picolé no
// picolé —, na cor da loja. Escolhido pela categoria primeiro (é o que a loja
// organizou) e, sem pista nela, pelo nome do produto. Puro: a vitrine e o
// teste usam o mesmo.

export type IconeDoProduto =
  | 'roupa'
  | 'calcado'
  | 'acessorio'
  | 'bebida'
  | 'sorvete'
  | 'doce'
  | 'mercearia'
  | 'beleza'
  | 'pet'
  | 'papelaria'
  | 'brinquedo'
  | 'flor'
  | 'etiqueta'

const chave = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// A ordem importa: a primeira que casa ganha. Calçado e acessório vêm antes
// da roupa ("bolsa jeans" é bolsa, "sandália da moda" é sandália); "massa"
// é a do sorvete (a categoria "Massa" da sorveteria).
const REGRAS: [IconeDoProduto, RegExp][] = [
  ['calcado', /\b(calcados?|tenis|sandalias?|sapatos?|sapatilhas?|chinelos?|botas?|rasteirinhas?|tamancos?|scarpins?|mocassins?|babuches?|papetes?)\b/],
  ['acessorio', /\b(acessorios?|bijuterias?|brincos?|colares?|aneis|anel|bolsas?|pulseiras?|relogios?|oculos|cintos?|carteiras?|mochilas?|joias?)\b/],
  ['roupa', /\b(roupas?|blusas?|calcas?|vestidos?|camisas?|camisetas?|saias?|shorts?|bermudas?|jaquetas?|casacos?|moletons?|macacao|macacoes|cropped|body|bodies|biquinis?|maios?|lingeries?|pijamas?|regatas?|t-?shirts?|conjuntos?|blazers?|leggings?|jeans|moda)\b/],
  ['sorvete', /\b(sorvetes?|picoles?|acai|gelatos?|milk ?shakes?|casquinhas?|massa)\b/],
  ['bebida', /\b(bebidas?|aguas?|sucos?|refrigerantes?|refris?|cervejas?|vinhos?|cafes?|chas?|energeticos?|drinks?)\b/],
  ['doce', /\b(paes|pao|bolos?|doces?|salgados?|tortas?|brigadeiros?|biscoitos?|cookies?|confeitaria|padaria|sobremesas?|chocolates?)\b/],
  ['mercearia', /\b(mercearia|mercado|alimentos?|graos?|arroz|feijao|cesta|hortifruti|frios|enlatados?)\b/],
  ['beleza', /\b(beleza|esmaltes?|cabelos?|esteticas?|maquiagem|batons?|perfumes?|cremes?|shampoos?|cosmeticos?|unhas?|skin ?care)\b/],
  ['pet', /\b(pets?|racao|racoes|petiscos? (?:para )?(?:caes|gatos)|caes|gatos|coleiras?)\b/],
  ['papelaria', /\b(papelaria|escolar|cadernos?|canetas?|lapis|estojos?|agendas?)\b/],
  ['brinquedo', /\b(brinquedos?|bonecas?|carrinhos?|pelucias?|jogos?|quebra-cabecas?)\b/],
  ['flor', /\b(flores|flor|plantas?|vasos?|buques?|orquideas?|suculentas?|jardim)\b/],
]

function pelo(texto: string | null | undefined): IconeDoProduto | null {
  if (!texto) return null
  const t = chave(texto)
  for (const [icone, re] of REGRAS) if (re.test(t)) return icone
  return null
}

/** O desenho do produto sem foto: pela categoria, depois pelo nome; sem pista, a etiqueta. */
export function iconeDoProduto(nome: string, categoria?: string | null): IconeDoProduto {
  return pelo(categoria) ?? pelo(nome) ?? 'etiqueta'
}

/** O texto que a cliente manda para a loja pedindo a foto. Sem dado dela. */
export function textoPedirFoto(nome: string, preco: string): string {
  return `Olá! Vi no catálogo o produto *${nome}* (${preco}) e gostaria de ver uma foto. 😊`
}

/** O link do WhatsApp da LOJA com o pedido de foto pronto; nulo se a loja não tem WhatsApp. */
export function linkPedirFoto(whatsappDaLoja: string | null | undefined, nome: string, preco: string): string | null {
  const numero = (whatsappDaLoja ?? '').replace(/\D/g, '')
  if (!numero) return null
  return `https://wa.me/${numero}?text=${encodeURIComponent(textoPedirFoto(nome, preco))}`
}
