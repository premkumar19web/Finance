// Exact paise arithmetic for previews in the browser (the server re-checks everything).

export function toPaise(amount: string): bigint | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) return null;
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
}

export function fromPaise(paise: bigint): string {
  return `${paise / 100n}.${(paise % 100n).toString().padStart(2, '0')}`;
}

/** Which installments a payment would pay, oldest first (mirrors the server policy). */
export function previewAllocation(
  amount: bigint,
  installments: { installmentNumber: number; dueDate: string; outstandingAmount: string; status: string }[],
) {
  const out: { installmentNumber: number; dueDate: string; amount: string; settles: boolean }[] = [];
  let remaining = amount;
  for (const i of [...installments].sort((a, b) => a.installmentNumber - b.installmentNumber)) {
    if (remaining <= 0n) break;
    if (i.status === 'WAIVED' || i.status === 'PAID') continue;
    const open = toPaise(i.outstandingAmount) ?? 0n;
    if (open <= 0n) continue;
    const applied = remaining < open ? remaining : open;
    out.push({ installmentNumber: i.installmentNumber, dueDate: i.dueDate, amount: fromPaise(applied), settles: applied === open });
    remaining -= applied;
  }
  return out;
}
