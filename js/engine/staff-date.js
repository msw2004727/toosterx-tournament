/** Pure date selection. The caller supplies time; assignment.date is not an access boundary. */
export function eventDateAt(nowMs, dates, timezone) {
  if (!Array.isArray(dates) || !dates.length) return null;
  const ordered = [...new Set(dates)].sort();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(nowMs));
  return ordered.find(date => date >= today) ?? ordered.at(-1);
}

export function selectedEventDate({ nowMs, dates, timezone, manualDate = null }) {
  return dates.includes(manualDate) ? manualDate : eventDateAt(nowMs, dates, timezone);
}
