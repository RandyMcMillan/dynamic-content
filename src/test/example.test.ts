import path from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'
import assert from 'node:assert/strict'

test('example runs end-to-end and syncs content', async () => {
  const script = path.join(process.cwd(), 'dist', 'index.js')
  const child = spawn(process.execPath, [script], { cwd: process.cwd() })

  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })

  const exitCode = await new Promise<number>(resolve => {
    child.on('close', code => resolve(code ?? 1))
  })

  assert.equal(exitCode, 0, output)
  assert.match(output, /client1: advertised/)
  assert.match(output, /client2: set state: \{ nerf this \}/)
})