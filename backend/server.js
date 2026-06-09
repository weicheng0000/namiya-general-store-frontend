import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.PORT || 3001)
const ADMIN_ACCOUNT = process.env.ADMIN_ACCOUNT || 'keeper'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'namiya123'
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'namiya-admin-token'

const dataDir = join(process.cwd(), 'data')
const lettersFile = join(dataDir, 'letters.json')

async function ensureStorage() {
  await mkdir(dataDir, { recursive: true })

  if (!existsSync(lettersFile)) {
    await writeFile(lettersFile, '[]\n', 'utf8')
  }
}

async function readLetters() {
  await ensureStorage()
  const raw = await readFile(lettersFile, 'utf8')
  return JSON.parse(raw)
}

async function writeLetters(letters) {
  await ensureStorage()
  await writeFile(lettersFile, JSON.stringify(letters, null, 2) + '\n', 'utf8')
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  })
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req) {
  const chunks = []

  for await (const chunk of req) {
    chunks.push(chunk)
  }

  if (chunks.length === 0) {
    return {}
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function notFound(res) {
  sendJson(res, 404, { message: 'Not found.' })
}

function unauthorized(res) {
  sendJson(res, 401, { message: 'Unauthorized.' })
}

function requireAdmin(req, res) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace('Bearer ', '')

  if (token !== ADMIN_TOKEN) {
    unauthorized(res)
    return false
  }

  return true
}

function mapPublicLetter(letter) {
  return {
    id: letter.id,
    content: letter.content,
    status: letter.status,
    createdAt: letter.createdAt,
    repliedAt: letter.repliedAt || null,
    reply: letter.reply || null
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true })
    return
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const body = await readJsonBody(req)

      if (body.account === ADMIN_ACCOUNT && body.password === ADMIN_PASSWORD) {
        sendJson(res, 200, {
          message: 'Login successful.',
          token: ADMIN_TOKEN
        })
        return
      }

      unauthorized(res)
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/letters') {
      const body = await readJsonBody(req)
      const content = String(body.content || '').trim()

      if (!content) {
        sendJson(res, 400, { message: 'Letter content is required.' })
        return
      }

      const letters = await readLetters()
      const newLetter = {
        id: randomUUID(),
        content,
        status: 'received',
        createdAt: new Date().toISOString(),
        reply: null,
        repliedAt: null
      }

      letters.unshift(newLetter)
      await writeLetters(letters)

      sendJson(res, 201, {
        message: 'Letter received.',
        letter: mapPublicLetter(newLetter)
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/letters') {
      if (!requireAdmin(req, res)) {
        return
      }

      const letters = await readLetters()
      sendJson(res, 200, { letters })
      return
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/admin/letters/')) {
      if (!requireAdmin(req, res)) {
        return
      }

      const parts = url.pathname.split('/').filter(Boolean)
      const letterId = parts[3]

      if (!letterId || parts[4] !== 'reply') {
        notFound(res)
        return
      }

      const body = await readJsonBody(req)
      const reply = String(body.reply || '').trim()

      if (!reply) {
        sendJson(res, 400, { message: 'Reply content is required.' })
        return
      }

      const letters = await readLetters()
      const letter = letters.find((item) => item.id === letterId)

      if (!letter) {
        notFound(res)
        return
      }

      letter.reply = reply
      letter.status = 'replied'
      letter.repliedAt = new Date().toISOString()

      await writeLetters(letters)

      sendJson(res, 200, {
        message: 'Reply saved.',
        letter
      })
      return
    }

    notFound(res)
  } catch (error) {
    sendJson(res, 500, {
      message: 'Server error.',
      error: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

await ensureStorage()

server.listen(PORT, () => {
  console.log(`Namiya backend running at http://localhost:${PORT}`)
})
