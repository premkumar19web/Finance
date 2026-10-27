// Display formatting. Money arrives as decimal strings and is formatted without
// converting to floating point, so large amounts never lose paise.

/** "1234567.5" → "₹12,34,567.50" (Indian digit grouping). */
export function formatMoney(value: string | number | null | undefined, opts: { symbol?: boolean } = {}): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = typeof value === 'number' ? value.toFixed(2) : value;
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return text;
  const [, sign, whole, fraction = ''] = match;
  const last3 = whole!.slice(-3);
  const rest = whole!.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  const paise = fraction.padEnd(2, '0').slice(0, 2);
  return `${sign}${opts.symbol === false ? '' : '₹'}${grouped}.${paise}`;
}

/** Compact money for stat tiles: ₹12.3L, ₹4.5Cr. */
export function formatMoneyShort(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return formatMoney(value);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-26" → "26 Oct 2026" (no time-zone conversion for calendar dates). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return Number(value).toLocaleString('en-IN');
}

export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return `${Number(value).toFixed(1)}%`;
}

const ACRONYMS = new Set(['upi', 'id', 'pan', 'csv']);

/** "BANK_TRANSFER" → "Bank transfer", "UPI" → "UPI" */
export function labelize(value: string | null | undefined): string {
  if (!value) return '—';
  const words = value.replace(/[_.]/g, ' ').toLowerCase().split(' ');
  const s = words.map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w)).join(' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Local calendar date as 'YYYY-MM-DD'. */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return isoDate(new Date(y, m - 1, d + days));
}

/** First day of the week containing `date`. */
export function startOfWeek(date: string, weekStartsOn: 'MONDAY' | 'SUNDAY' = 'MONDAY'): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  const offset = weekStartsOn === 'MONDAY' ? (day + 6) % 7 : day;
  return addDays(date, -offset);
}
