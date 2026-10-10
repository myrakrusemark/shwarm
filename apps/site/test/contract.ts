// Contract tests against docs/openapi.yaml (prd-api API-6; go-live 7.4): a response body validates against the schema
// the spec gives it, with the spec's own $refs. The spec is OpenAPI 3.1, whose schemas are JSON Schema 2020-12.
import { readFileSync } from 'node:fs'
import { Validator, type OutputUnit } from '@cfworker/json-schema'
import { parse } from 'yaml'

const SPEC = parse(readFileSync(new URL('../../../docs/openapi.yaml', import.meta.url), 'utf8')) as {
  paths: Record<string, Record<string, { operationId?: string; responses?: Record<string, unknown> }>>
  components: Record<string, any>
}

export const spec = SPEC

const validators = new Map<string, Validator>()

/** The errors from validating `body` against components.schemas[name]; empty when it conforms. */
export function schemaErrors(name: string, body: unknown): string[] {
  if (!SPEC.components.schemas[name]) throw new Error(`openapi.yaml has no schema ${name}`)
  let v = validators.get(name)
  if (!v) validators.set(name, (v = new Validator({ $ref: `#/components/schemas/${name}`, components: SPEC.components } as any, '2020-12', false)))
  const r = v.validate(body)
  return r.valid ? [] : r.errors.map((e: OutputUnit) => `${e.instanceLocation} ${e.keyword}: ${e.error}`)
}

/** The schema an operation's response with this status points at (through a components/responses $ref too). */
export function responseSchema(operationId: string, status: number): string {
  for (const ops of Object.values(SPEC.paths))
    for (const op of Object.values(ops)) {
      if (op?.operationId !== operationId) continue
      let res: any = op.responses?.[String(status)]
      if (!res) throw new Error(`${operationId} has no ${status} response in openapi.yaml`)
      if (res.$ref) res = SPEC.components.responses[res.$ref.split('/').pop()]
      const schema = res.content?.['application/json']?.schema
      const ref: string | undefined = schema?.$ref ?? schema?.oneOf?.[0]?.$ref
      if (!ref) throw new Error(`${operationId} ${status} has no JSON schema`)
      return ref.split('/').pop()!
    }
  throw new Error(`openapi.yaml has no operation ${operationId}`)
}

/** Whether openapi.yaml lists this status for the operation (a refusal the spec doesn't name is a contract break). */
export function hasResponse(operationId: string, status: number): boolean {
  for (const ops of Object.values(SPEC.paths)) for (const op of Object.values(ops)) if (op?.operationId === operationId) return String(status) in (op.responses ?? {})
  return false
}
