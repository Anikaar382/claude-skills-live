import { readFileSync, writeFileSync } from "node:fs"
import { parse, stringify } from "yaml"
import {
  GraveyardFileSchema,
  SkillsFileSchema,
  type Entry,
  type GraveyardFile,
  type SkillsFile,
} from "./schema"

const YAML_OPTS = { lineWidth: 0, sortMapEntries: false } as const

export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function loadSkills(path: string): SkillsFile {
  return SkillsFileSchema.parse(parse(readFileSync(path, "utf8")))
}

export function saveSkills(path: string, data: SkillsFile): void {
  const normalised: SkillsFile = { version: 1, entries: sortEntries(data.entries) }
  writeFileSync(path, stringify(SkillsFileSchema.parse(normalised), YAML_OPTS))
}

export function loadGraveyard(path: string): GraveyardFile {
  return GraveyardFileSchema.parse(parse(readFileSync(path, "utf8")))
}

export function saveGraveyard(path: string, data: GraveyardFile): void {
  const entries = [...data.entries].sort((a, b) => (a.id < b.id ? -1 : 1))
  writeFileSync(path, stringify(GraveyardFileSchema.parse({ version: 1, entries }), YAML_OPTS))
}
