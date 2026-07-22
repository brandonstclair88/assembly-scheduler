// Shared formatting / parsing helpers used by the desktop app and mobile viewer.
export function splitIds(s: string) { return (s || '').split(/[\n,;\s]+/).map(x => x.trim()).filter(Boolean); }
export function normalizeSearchQuery(value: any) { return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
export function assemblySearchText(item: any) { return normalizeSearchQuery(`${item?.partNumber || ''} ${item?.description || ''} ${item?.notes || ''} ${item?.type || item?.category || ''}`); }
export function projectSearchText(item: any) { return normalizeSearchQuery(`${item?.projectId || ''} ${item?.name || ''} ${item?.customer || ''}`); }
export function matchesAssemblySearch(item: any, query: string) { const q = normalizeSearchQuery(query); if (!q) return true; const hay = assemblySearchText(item); return q.split(' ').every(token => hay.includes(token)); }
export function dateOnly(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function fmtDate(value: any) { if (!value) return ''; const raw = String(value); const datePart = raw.includes('T') ? raw.split('T')[0] : raw; const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (!m) return raw; return `${Number(m[2])}/${Number(m[3])}/${m[1]}`; }
export function fmtDateTime(value: any) { if (!value) return ''; const raw = String(value); const [d, t = ''] = raw.split('T'); const hhmm = t.slice(0, 5); return hhmm ? `${fmtDate(d)} ${hhmm}` : fmtDate(d); }
