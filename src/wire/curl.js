import { execFile } from 'child_process'
import { promisify } from 'util'
import { ua } from '../env.js'

const execFileAsync = promisify(execFile)

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
  const args = ['-s', '-f', '-L']
  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`)
  }
  args.push(url)

  try {
    const { stdout } = await execFileAsync('curl', args, { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 })
    return stdout
  } catch (err) {
    throw new Error(`upstream failed: ${err.message || 'unknown'}`)
  }
}
