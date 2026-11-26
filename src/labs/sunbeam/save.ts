import { isCoatKey } from './rig';
import type { Save } from './world';

export const KEY = 'lab:sunbeam';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** The saved cat, if there is a valid one. Storage can be blocked or hold an older format. */
export function loadSave(): Save | null {
  let raw: string | null;
  try { raw = localStorage.getItem(KEY); } catch { return null; }
  if (raw === null) return null;
  let data: Json;
  try { data = JSON.parse(raw); } catch { return null; }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { v, coat, seed, t, full, rest, love, bowl } = data;
  const nums = [seed, t, full, rest, love, bowl];
  if (v !== 1 || typeof coat !== 'string' || !isCoatKey(coat)) return null;
  if (!nums.every((n): n is number => typeof n === 'number' && Number.isFinite(n))) return null;
  return { v: 1, coat, seed: nums[0], t: nums[1], full: nums[2], rest: nums[3], love: nums[4], bowl: nums[5] };
}
