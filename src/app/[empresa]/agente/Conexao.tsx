'use client'

// A conexão do assistente com o mundo, dita sem rodeio.
//
// A tela diz o PRIMEIRO problema, não uma lista de dez luzes: "sem chave de
// IA" resolve-se antes de "sem canal", que se resolve antes de "desligado".
// Uma pessoa não técnica consegue seguir uma frase; não consegue seguir um
// painel de avião.
//
// O endereço do webhook aparece UMA vez, como resposta do botão. Ele é a
// senha da porta — impresso na página, ficaria em todo print de tela que a
// loja mandasse para o suporte.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Cartao, Situacao } from '@/ui/base'
import type { EstadoConexao } from '@/servidor/assistente/conexao'
import { conectar, desconectar, testar, type EstadoConexaoAcao } from './acoes'

// Em palavras de loja, não de servidor: "chave de IA", "segredo do webhook" e
// "instância" não dizem nada a quem vende. O Z-API fica nomeado só onde a
// pessoa precisa ir até ele.
const FRASE: Record<EstadoConexao['situacao'], { nivel: 'bom' | 'atencao' | 'critico' | 'neutro'; titulo: string; texto: string }> = {
  sem_agente: { nivel: 'neutro', titulo: 'Sem assistente', texto: 'Crie o assistente no formulário abaixo antes de conectar.' },
  sem_chave: {
    nivel: 'critico',
    titulo: 'Inteligência artificial desligada',
    texto: 'O Norte ainda não ligou a inteligência artificial desta conta. Sem ela o assistente não responde nada — só avisa que alguém da loja vai responder. Isto é com o suporte do Norte.',
  },
  sem_canal: {
    nivel: 'critico',
    titulo: 'Sem linha do WhatsApp',
    texto: 'Ainda não há uma linha do WhatsApp (Z-API) ligada a esta conta. As conversas ficam só no histórico; nada sai para o WhatsApp. Isto é com o suporte do Norte.',
  },
  sem_webhook: {
    nivel: 'critico',
    titulo: 'Entrada sem proteção',
    texto: 'Falta a senha que protege o endereço por onde as mensagens chegam. Sem ela, a porta fica fechada. Isto é com o suporte do Norte.',
  },
  desconectado: {
    nivel: 'atencao',
    titulo: 'Desconectado',
    texto: 'Tudo pronto do nosso lado. Falta conectar: gere o endereço e cole no painel do Z-API.',
  },
  desligado: {
    nivel: 'atencao',
    titulo: 'Conectado, mas desligado',
    texto: 'A conexão está feita, mas o assistente está desligado no formulário abaixo. Ligue para ele começar a responder.',
  },
  pronto: { nivel: 'bom', titulo: 'Pronto', texto: 'Conectado e ligado. Ele responde no WhatsApp e manda as rotinas marcadas abaixo.' },
}

export function Conexao({ slug, estado }: { slug: string; estado: EstadoConexao }) {
  const [resposta, setResposta] = useState<EstadoConexaoAcao>({})
  const [qual, setQual] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  const rodar = (nome: string, acao: () => Promise<EstadoConexaoAcao>) => {
    setQual(nome)
    setResposta({})
    comecar(async () => {
      setResposta(await acao())
      setQual(null)
      router.refresh()
    })
  }

  const f = FRASE[estado.situacao]
  const podeConectar = estado.situacao !== 'sem_agente' && estado.segredoWebhook

  return (
    <Cartao titulo="Conexão">
      <div className="flex flex-col gap-3">
        <Aviso nivel={f.nivel}>
          <span className="flex flex-col gap-0.5">
            <b>{f.titulo}</b>
            <span>{f.texto}</span>
          </span>
        </Aviso>

        <ul className="flex flex-wrap gap-2">
          <li><Situacao nivel={estado.chaveIA ? 'bom' : 'critico'}>inteligência artificial</Situacao></li>
          <li><Situacao nivel={estado.canalReal ? 'bom' : 'critico'}>linha do WhatsApp</Situacao></li>
          <li><Situacao nivel={estado.segredoWebhook ? 'bom' : 'critico'}>entrada protegida</Situacao></li>
          <li><Situacao nivel={estado.conectado ? 'bom' : 'atencao'}>{estado.conectado ? 'conectado' : 'desconectado'}</Situacao></li>
          <li><Situacao nivel={estado.rotinasSegredo ? 'bom' : 'atencao'}>horário das rotinas</Situacao></li>
        </ul>

        {resposta.erro && <Aviso nivel="critico">{resposta.erro}</Aviso>}
        {resposta.ok && (
          <Aviso nivel="bom">
            <span className="flex flex-col gap-1.5">
              <span>{resposta.ok}</span>
              {resposta.endereco && (
                <>
                  <code className="block overflow-x-auto rounded bg-superficie px-2 py-1.5 font-mono text-xs break-all text-tinta">
                    {resposta.endereco}
                  </code>
                  <span className="text-xs">
                    Este endereço é a senha da porta: quem tiver ele consegue falar com o assistente
                    fingindo ser qualquer número. Cole no Z-API e não mande por e-mail nem em grupo.
                  </span>
                </>
              )}
            </span>
          </Aviso>
        )}

        <div className="flex flex-wrap gap-2">
          <Botao
            tom={estado.conectado ? 'secundario' : 'principal'}
            disabled={!podeConectar}
            carregando={indo && qual === 'conectar'}
            onClick={() => rodar('conectar', () => conectar(slug))}
          >
            {estado.conectado ? 'Mostrar o endereço de novo' : 'Conectar e gerar o endereço'}
          </Botao>
          <Botao
            tom="secundario"
            disabled={estado.situacao === 'sem_agente'}
            carregando={indo && qual === 'testar'}
            onClick={() => rodar('testar', () => testar(slug))}
          >
            Enviar mensagem de teste para mim
          </Botao>
          {estado.conectado && (
            <Botao
              tom="discreto"
              carregando={indo && qual === 'desconectar'}
              onClick={() => rodar('desconectar', () => desconectar(slug))}
            >
              Desconectar
            </Botao>
          )}
        </div>
        <p className="text-xs text-tinta-3">
          {estado.meuTelefone
            ? `O teste vai para o seu telefone cadastrado, ${estado.meuTelefone}.`
            : 'Para receber o teste e os relatórios, cadastre o seu telefone com DDD na tela Equipe.'}
        </p>
      </div>
    </Cartao>
  )
}
