// Senha guardada com scrypt, que vem embutido no Node — sem dependência nova,
// sem módulo nativo para compilar no Windows.
//
// scrypt é caro de propósito: gasta CPU E memória, o que torna ataque em placa
// de vídeo muito mais lento do que contra algoritmos só de CPU.
//
// O hash guardado carrega a versão e os parâmetros:
//
//   scrypt$16384$8$1$<sal em base64>$<derivado em base64>
//
// Isso permite endurecer os parâmetros depois sem invalidar as senhas antigas:
// `conferirSenha` lê os parâmetros de dentro do próprio hash, e `precisaTrocar`
// avisa quando vale regravar no login seguinte.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derivar = promisify(scrypt) as (
  senha: string,
  sal: Buffer,
  tamanho: number,
  opcoes: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

/** Parâmetros de hoje. Aumente o N quando o hardware permitir. */
const N = 16384 // custo de CPU e memória (~16 MB)
const R = 8
const P = 1
const TAMANHO = 32
const SAL = 16

const maxmem = (n: number, r: number) => 256 * n * r * 2 // folga sobre o mínimo

export async function guardarSenha(senha: string): Promise<string> {
  exigirSenhaRazoavel(senha)
  const sal = randomBytes(SAL)
  const derivado = await derivar(senha, sal, TAMANHO, { N, r: R, p: P, maxmem: maxmem(N, R) })
  return ['scrypt', N, R, P, sal.toString('base64'), derivado.toString('base64')].join('$')
}

export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const partes = guardado.split('$')
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false

  const n = Number(partes[1])
  const r = Number(partes[2])
  const p = Number(partes[3])
  if (!n || !r || !p) return false

  const sal = Buffer.from(partes[4]!, 'base64')
  const esperado = Buffer.from(partes[5]!, 'base64')

  let derivado: Buffer
  try {
    derivado = await derivar(senha, sal, esperado.length, { N: n, r, p, maxmem: maxmem(n, r) })
  } catch {
    return false
  }
  // comparação de tempo constante: não vaza quanto do hash bateu
  return derivado.length === esperado.length && timingSafeEqual(derivado, esperado)
}

/** True quando o hash foi feito com parâmetros mais fracos que os de hoje. */
export function precisaTrocar(guardado: string): boolean {
  const [algo, n, r, p] = guardado.split('$')
  if (algo !== 'scrypt') return true
  return Number(n) < N || Number(r) < R || Number(p) < P
}

/**
 * Hash falso, para gastar o mesmo tempo quando o usuário nem existe.
 * Sem isso, "e-mail não cadastrado" responde na hora e "senha errada" demora —
 * e essa diferença de tempo entrega quem tem conta na empresa.
 */
export const HASH_ISCA =
  'scrypt$16384$8$1$aXNjYWlzY2Fpc2NhaXNjYQ==$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

const MINIMO = 8

function exigirSenhaRazoavel(senha: string) {
  if (senha.length < MINIMO) {
    throw new Error(`A senha precisa de pelo menos ${MINIMO} caracteres.`)
  }
  // scrypt ignora o que passa de 72 bytes em algumas implementações; aqui não
  // ignora, mas senha gigante é vetor de gasto de CPU à toa.
  if (Buffer.byteLength(senha) > 200) {
    throw new Error('Senha longa demais.')
  }
}
