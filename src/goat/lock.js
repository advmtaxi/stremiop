import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const workerCode = "__WORKER_CODE_PLACEHOLDER__"

export function unlock(slot, goat, body) {
  return new Promise((resolve, reject) => {
    let worker;
    if (workerCode !== "__WORKER_CODE_PLACEHOLDER__") {
      worker = new Worker(workerCode, {
        eval: true,
        workerData: { slot, goat, bodyHex: body.toString('hex'), baseDir: dirname(fileURLToPath(import.meta.url)) },
      })
    } else {
      const workerUrl = join(dirname(fileURLToPath(import.meta.url)), 'lock-worker.js')
      worker = new Worker(workerUrl, {
        workerData: { slot, goat, bodyHex: body.toString('hex'), baseDir: dirname(fileURLToPath(import.meta.url)) },
      })
    }
    worker.once('message', (msg) => {
      worker.terminate().catch(() => {})
      if (msg.ok) resolve(msg.url)
      else reject(new Error(msg.error || 'lock decrypt failed'))
    })
    worker.once('error', (err) => {
      worker.terminate().catch(() => {})
      reject(err)
    })
  })
}
