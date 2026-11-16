export function money(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US')}`;
}

export function signedMoney(n: number): string {
  return n > 0 ? `+${money(n)}` : money(n);
}
