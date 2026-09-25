'use server'

// Server Action é endereço público — ver o comentário em `balcao/acoes.ts`.
// As regras (permissão `agente.configurar`, plano e módulo das campanhas, a
// conexão oficial ligada) moram em src/servidor/assistente/meta-conexao.ts e
// são conferidas lá dentro, a cada chamada. O que chega do formulário é
// conferido de novo antes de ir à Meta (`montarModelo`).

import { revalidatePath } from 'next/cache'
import { exigirSessao, recadoDoErro } from '@/servidor/pagina'
import { apagarModeloDaLoja, criarModeloDaLoja } from '@/servidor/assistente/meta-conexao'

export type RespostaModelo = { ok?: string; erro?: string }

export async function criarModeloAcao(slug: string, _antes: RespostaModelo, form: FormData): Promise<RespostaModelo> {
  try {
    const sessao = await exigirSessao(slug)
    const exemplos = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => String(form.get(`exemplo_${i}`) ?? ''))
    const botoes = [1, 2, 3].map((i) => String(form.get(`botao_${i}`) ?? ''))
    const cabecalho = String(form.get('cabecalho') ?? 'nenhum')
    const r = await criarModeloDaLoja(sessao, {
      nome: String(form.get('nome') ?? ''),
      categoria: String(form.get('categoria') ?? ''),
      corpo: String(form.get('corpo') ?? ''),
      exemplos,
      cabecalhoTexto: cabecalho === 'texto' ? String(form.get('cabecalhoTexto') ?? '') : '',
      midiaId: cabecalho === 'imagem' ? String(form.get('midiaId') ?? '') || null : null,
      rodape: String(form.get('rodape') ?? ''),
      botoes,
    })
    revalidatePath(`/${slug}/campanhas/modelos`)
    return r.ok ? { ok: r.recado } : { erro: r.erro }
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para criar o modelo.') }
  }
}

export async function apagarModeloAcao(slug: string, nome: string): Promise<RespostaModelo> {
  try {
    const r = await apagarModeloDaLoja(await exigirSessao(slug), nome)
    revalidatePath(`/${slug}/campanhas/modelos`)
    return r.ok ? { ok: `Modelo "${nome}" apagado.` } : { erro: r.erro }
  } catch (e) {
    return { erro: recadoDoErro(e, 'Não deu para apagar o modelo.') }
  }
}
