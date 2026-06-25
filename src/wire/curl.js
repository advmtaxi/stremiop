import { ua } from '../env.js'

function hdrs(slot) {
  return {
    Referer: `${slot.origin}/`,
    Origin: slot.origin,
    'User-Agent': ua,
    Accept: '*/*',
  }
}

export async function pull(url, slot) {
  const headers = hdrs(slot)
  const res = await fetch(url, {
    headers,
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  const buf = await res.arrayBuffer()
  return Buffer.from(buf)
}
