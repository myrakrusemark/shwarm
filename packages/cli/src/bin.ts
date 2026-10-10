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
// Ctrl-C stops --follow cleanly (exit 0), and a run's command (in its own process group, so the terminal's interrupt
// doesn't reach it) with nothing posted; anything else gets the usual interrupt.
if (process.argv.includes('--follow') || process.argv[2] === 'run') process.once('SIGINT', () => ac.abort())

/** One line from the human, asked on the terminal; Ctrl-C answers no. */
function ask(question: string): Promise<string> {
  return new Promise(done => {
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    rl.on('SIGINT', () => {
      rl.close()
      done('')
    })
    rl.question(question, a => {
      rl.close()
      done(a)
    })
  })
}

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
  // Only a terminal can be asked; piped or in CI, `shwarm run` needs --yes.
  ...(process.stdin.isTTY && process.stderr.isTTY ? { ask } : {}),
})
