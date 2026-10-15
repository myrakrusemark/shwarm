// The `shwarm` executable: main() with the real process. The shebang is added by the build (scripts/build.mjs).
import { createInterface } from 'node:readline'
import { main } from './cli'

// A reader that stops early (| head) closes the pipe: that ends the command quietly, not with a stack trace.
for (const stream of [process.stdout, process.stderr])
  stream.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code !== 'EPIPE') throw e
    process.exit(process.exitCode ?? 0)
  })

const ac = new AbortController()
// Ctrl-C stops --follow cleanly (exit 0); anything else gets the usual interrupt.
if (process.argv.includes('--follow')) process.once('SIGINT', () => ac.abort())

async function stdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of process.stdin) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  stdout: s => void process.stdout.write(s + '\n'),
  stderr: s => void process.stderr.write(s + '\n'),
  stdin,
  signal: ac.signal,
  lines: () => createInterface({ input: process.stdin, crlfDelay: Infinity }),
})

// `shwarm mcp` ends when its client closes standard input; a DM poll the server is still holding open (go-live 7.18)
// mustn't keep the process alive after that.
if (process.argv[2] === 'mcp') process.exit()
