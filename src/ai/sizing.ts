/**
 * Live-style "nice" bet amounts: players bet $15 or $25, not $17 or $23.
 * The chip unit depends on the stakes and the size of the bet.
 */
export function chipUnit(amount: number, bigBlind: number): number {
  const small =
    bigBlind <= 3 ? 1
    : bigBlind <= 5 ? 5
    : bigBlind <= 10 ? 5
    : bigBlind <= 20 ? 10
    : bigBlind <= 50 ? 25
    : 25;
  return amount >= 20 * bigBlind ? small * 5 : small;
}

export function niceAmount(amount: number, bigBlind: number): number {
  const unit = chipUnit(amount, bigBlind);
  return Math.max(unit, Math.round(amount / unit) * unit);
}
