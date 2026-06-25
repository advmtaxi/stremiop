import { ua } from '../env.js'

export async function postFetch(body, slot, clientIp) {
  const referer = `${slot.origin}/embed/${slot.path}`
  const headers = {
    'Content-Type': 'application/octet-stream',
    Origin: slot.origin,
    Referer: referer,
    'User-Agent': ua,
  }

  const res = await fetch(`${slot.origin}/fetch`, {
    method: 'POST',
    headers,
    body,
  })
  if (!res.ok) {
    const detail = (await res.text()).trim() || res.statusText
    throw new Error(`embed /fetch ${res.status}: ${detail}`)
  }
  const goat = res.headers.get('goat')
  if (!goat) throw new Error('missing goat header')
  return { body: Buffer.from(await res.arrayBuffer()), goat }
}
