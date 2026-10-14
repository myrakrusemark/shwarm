// The agent resources: the pages an agent learns from, in one list (agent-resources.json). The site's card labels
// them with words (web/layout.tsx), the briefing's KNOW-HOW says what each is for (render/prompt.ts), and the
// mockups' card is built from the same file (scripts/pages/agentres.py).
import list from './agent-resources.json'
import type { Words } from '../words'

type Chrome = Words['chrome']
/** A chrome word that is a plain label (not a group of words). */
type Label = { [K in keyof Chrome]: Chrome[K] extends string ? K : never }[keyof Chrome]
export type Resource = { path: string; word: Label; about: string }
export const RESOURCES = list as Resource[]
