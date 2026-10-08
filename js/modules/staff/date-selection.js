/** A manual choice survives trips to check-in / LIVE, scoped to this tab, event and account. */
import { EVENT } from '../../config.js';
const choices = new Map();
const keyOf = uid => `staff-date:${EVENT.id}:${uid}`;

export function readDateChoice(uid) {
  const key = keyOf(uid);
  let date = choices.get(key);
  try { date = sessionStorage.getItem(key) ?? date; } catch { /* memory fallback */ }
  return EVENT.dates.includes(date) ? date : null;
}

export function saveDateChoice(uid, date) {
  const key = keyOf(uid);
  if (EVENT.dates.includes(date)) choices.set(key, date);
  else choices.delete(key);
  try {
    if (EVENT.dates.includes(date)) sessionStorage.setItem(key, date);
    else sessionStorage.removeItem(key);
  } catch { /* blocked storage must not prevent date switching */ }
}
