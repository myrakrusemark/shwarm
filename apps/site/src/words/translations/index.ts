// Written by the localize tool (localize/ at the repo root) when a language is added: one JSON file per language.
// Don't edit by hand.
import type { Translation } from '../index'
import fr from './fr.json'
import de from './de.json'
import zh_Hans from './zh-Hans.json'

export const translations: Record<string, Translation> = { fr, de, 'zh-Hans': zh_Hans }
