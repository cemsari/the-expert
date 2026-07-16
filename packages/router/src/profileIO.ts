// The Expert — profile export/import (Phase 2).
// Lets a user carry their learned preferences between browsers/devices.
import { Profile, emptyProfile } from "./learner";

export const PROFILE_FORMAT = "the-expert-profile";
export const PROFILE_VERSION = 1;

export interface ProfileFile {
  format: string;
  version: number;
  exportedAt: string;
  profile: Profile;
}

export function exportProfile(profile: Profile): string {
  const file: ProfileFile = {
    format: PROFILE_FORMAT,
    version: PROFILE_VERSION,
    exportedAt: new Date().toISOString(),
    profile,
  };
  return JSON.stringify(file, null, 2);
}

export interface ImportResult {
  ok: boolean;
  profile?: Profile;
  error?: string;
}

/**
 * Validates and parses an exported profile. Deliberately strict: a corrupt or
 * foreign file must never silently overwrite someone's learning.
 */
export function importProfile(json: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (typeof data !== "object" || data === null)
    return { ok: false, error: "That file isn't a profile." };

  const f = data as Partial<ProfileFile>;
  if (f.format !== PROFILE_FORMAT)
    return { ok: false, error: "That's not a The Expert profile file." };
  if (typeof f.version !== "number" || f.version > PROFILE_VERSION)
    return { ok: false, error: `That profile was made by a newer version (v${f.version}). Update first.` };
  if (!f.profile || typeof f.profile !== "object")
    return { ok: false, error: "That profile file is missing its data." };

  // Merge onto a fresh profile so missing keys can't crash the app.
  const p = f.profile as Partial<Profile>;
  const safe: Profile = {
    ...emptyProfile(),
    buckets: p.buckets ?? {},
    directives: p.directives ?? {},
    noteLog: Array.isArray(p.noteLog) ? p.noteLog : [],
    experiments: p.experiments ?? {},
    effortSat: p.effortSat ?? {},
  };
  return { ok: true, profile: safe };
}

/** Human-readable summary, so a user knows what they're about to import. */
export function describeProfile(p: Profile): string {
  const buckets = Object.keys(p.buckets ?? {}).length;
  const rules = Object.keys(p.directives ?? {}).length;
  const notes = (p.noteLog ?? []).length;
  const exps = Object.keys(p.experiments ?? {}).length;
  const bits: string[] = [];
  if (buckets) bits.push(`${buckets} question type${buckets > 1 ? "s" : ""} learned`);
  if (rules) bits.push(`${rules} standing rule${rules > 1 ? "s" : ""}`);
  if (notes) bits.push(`${notes} note${notes > 1 ? "s" : ""}`);
  if (exps) bits.push(`${exps} experiment${exps > 1 ? "s" : ""}`);
  return bits.length ? bits.join(" · ") : "an empty profile";
}
