'use server'

// Server Action é endereço público: tudo que chega é conferido de novo aqui e
// dentro de `servidor/lojas.ts` (`empresa.configurar`, cota do plano).

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/servidor/pagina'
import { criarLoja, editarLoja, mudarSituacaoLoja, LojaRecusada, type DadosLoja } from '@/servidor/lojas'
import { SemCota } from '@/servidor/assinatura'
import { SemPermissao } from '@/servidor/permissao'
import { PLANOS } from '@/servidor/planos'
import { RAMOS, type Ramo } from '@/servidor/modulos'

export type EstadoLoja = { erro?: string; ok?: string }

const texto = (f: FormData, k: string) => String(f.get(k) ?? '')

function dadosDo(form: FormData): DadosLoja {
  return {
    nome: texto(form, 'nome'),
    apelido: texto(form, 'apelido'),
    documento: texto(form, 'documento'),
    ramo: texto(form, 'ramo') || null,
    ehDeposito: form.get('ehDeposito') === 'on',
    telefone: texto(form, 'telefone'),
    endereco: texto(form, 'endereco'),
    numero: texto(form, 'numero'),
    complemento: texto(form, 'complemento'),
    bairro: texto(form, 'bairro'),
    cidade: texto(form, 'cidade'),
    estado: texto(form, 'estado'),
    cep: texto(form, 'cep'),
    horario: texto(form, 'horario'),
  }
}

function recado(e: unknown): string {
  if (e instanceof LojaRecusada) return e.message
  if (e instanceof SemCota) {
    return `${e.motivo} Para abrir mais uma, o caminho é o plano ${PLANOS[e.sugestao].titulo} — veja em Assinatura.`
  }
  if (e instanceof SemPermissao) return 'Só quem configura a empresa mexe nas lojas.'
  return 'Não deu para salvar. Tente de novo em alguns segundos.'
}

/** "Criou 3 categorias (Picolé, Massa, Açaí) e o eixo Sabor." — ou nada. */
function oQueNasceu(r: { novasCategorias: string[]; novosEixos: string[] }): string {
  const partes: string[] = []
  if (r.novasCategorias.length) partes.push(`as categorias ${r.novasCategorias.join(', ')}`)
  if (r.novosEixos.length) partes.push(`${r.novosEixos.length === 1 ? 'o eixo' : 'os eixos'} ${r.novosEixos.join(', ')}`)
  return partes.length ? ` Já deixei prontas ${partes.join(' e ')}.` : ''
}

export async function criarLojaAcao(slug: string, _anterior: EstadoLoja, form: FormData): Promise<EstadoLoja> {
  try {
    const sessao = await exigirSessao(slug)
    const r = await criarLoja(sessao, dadosDo(form))
    revalidatePath(`/${slug}`, 'layout')
    const ramo = r.loja.ramo && r.loja.ramo in RAMOS ? RAMOS[r.loja.ramo as Ramo].titulo : null
    return {
      ok:
        `${r.loja.nome} aberta${ramo ? ` como ${ramo.toLowerCase()}` : ''}.` +
        oQueNasceu(r) +
        ' Agora diga, na ficha de cada produto, se ele é vendido nela.',
    }
  } catch (e) {
    return { erro: recado(e) }
  }
}

export async function editarLojaAcao(
  slug: string,
  id: string,
  _anterior: EstadoLoja,
  form: FormData,
): Promise<EstadoLoja> {
  try {
    const sessao = await exigirSessao(slug)
    const r = await editarLoja(sessao, id, dadosDo(form))
    revalidatePath(`/${slug}`, 'layout')
    return { ok: 'Salvo.' + oQueNasceu(r) }
  } catch (e) {
    return { erro: recado(e) }
  }
}

export async function situacaoLojaAcao(slug: string, id: string, ativa: boolean): Promise<EstadoLoja> {
  try {
    const sessao = await exigirSessao(slug)
    await mudarSituacaoLoja(sessao, id, ativa)
    revalidatePath(`/${slug}`, 'layout')
    return { ok: ativa ? 'Loja reaberta.' : 'Loja fechada. O histórico dela continua guardado.' }
  } catch (e) {
    return { erro: recado(e) }
  }
}
