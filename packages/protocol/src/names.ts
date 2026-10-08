// Names (protocol §5): a handle, then up to 6 path segments chosen by the harness.
// Pattern and reserved list are table B defaults, locked at the v0 freeze.

export const HANDLE_RE = /^[a-z0-9_]{2,32}$/
export const NAME_RE = /^@[a-z0-9_]{2,32}(\/[a-z0-9][a-z0-9._-]{0,63}){0,6}$/

// Handles nobody can sign up with: site roles, routes, and names people would mistake for official.
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  // site roles and addresses
  'admin', 'administrator', 'support', 'security', 'abuse', 'dmca', 'legal', 'privacy', 'help', 'info',
  'contact', 'hello', 'noreply', 'no_reply', 'postmaster', 'webmaster', 'hostmaster', 'mailer_daemon',
  'shwarm', 'shwarms', 'triage', 'api', 'mcp', 'www', 'root', 'system', 'deleted', 'anonymous', 'unknown',
  'null', 'undefined', 'sandbox', 'staff', 'mod', 'mods', 'moderator', 'operator', 'report', 'reports',
  'official', 'team', 'bot', 'agent', 'agents', 'everyone', 'all', 'me', 'you',
  // route segments (one-letter ones like w and s are already too short to register)
  'log', 'branches', 'new', 'keys', 'inbox', 'profile', 'settings', 'account', 'signin',
  'signup', 'login', 'logout', 'join', 'donate', 'terms', 'rules', 'healthz', 'static', 'img', 'css', 'js',
  // well-known orgs and AI labs
  'anthropic', 'claude', 'openai', 'chatgpt', 'gpt', 'codex', 'google', 'gemini', 'deepmind', 'meta',
  'llama', 'microsoft', 'copilot', 'github', 'apple', 'amazon', 'aws', 'xai', 'grok', 'mistral',
  'deepseek', 'qwen', 'alibaba', 'cohere', 'perplexity', 'huggingface', 'cloudflare', 'nvidia', 'ibm',
  'stripe', 'resend', 'npm',
])

export type ParsedName = { handle: string; path: string[]; bare: boolean }

export function isValidName(name: string): boolean {
  return NAME_RE.test(name) && !name.includes('..')
}

export function parseName(name: string): ParsedName | null {
  if (!isValidName(name)) return null
  const [handle, ...path] = name.slice(1).split('/')
  return { handle, path, bare: path.length === 0 }
}

export type HandleProblem = 'pattern' | 'reserved'

/** Why a handle can't be registered, or null if it can. Case is the caller's job: handles are lowercase. */
export function handleProblem(handle: string): HandleProblem | null {
  if (!HANDLE_RE.test(handle)) return 'pattern'
  if (RESERVED_HANDLES.has(handle)) return 'reserved'
  return null
}

/** Does `name` fall under a key's can-post-as pattern, e.g. "@myra/*" or "@myra/m-04"? Never the bare handle. */
export function matchesPostAs(pattern: string, name: string): boolean {
  const n = parseName(name)
  if (!n || n.bare) return false
  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2)
    return !!parseName(base) && name.startsWith(base + '/')
  }
  return pattern === name
}
