/** The five games in the card room. */
export interface Stake {
  id: string;
  index: number;
  label: string;
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  /** null = no maximum (you can buy in for any amount up to your bankroll). */
  maxBuyIn: number | null;
}

export const STAKES: Stake[] = [
  { id: '1-3', index: 0, label: '$1/$3', name: "$1/$3 No-Limit Hold'em", smallBlind: 1, bigBlind: 3, minBuyIn: 100, maxBuyIn: 500 },
  { id: '2-5', index: 1, label: '$2/$5', name: "$2/$5 No-Limit Hold'em", smallBlind: 2, bigBlind: 5, minBuyIn: 200, maxBuyIn: 500 },
  { id: '5-10', index: 2, label: '$5/$10', name: "$5/$10 No-Limit Hold'em", smallBlind: 5, bigBlind: 10, minBuyIn: 400, maxBuyIn: 1500 },
  { id: '10-20', index: 3, label: '$10/$20', name: "$10/$20 No-Limit Hold'em", smallBlind: 10, bigBlind: 20, minBuyIn: 800, maxBuyIn: null },
  { id: '50-100', index: 4, label: '$50/$100', name: "$50/$100 No-Limit Hold'em", smallBlind: 50, bigBlind: 100, minBuyIn: 5000, maxBuyIn: null },
];

export function stakeById(id: string): Stake {
  const s = STAKES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown stakes ${id}`);
  return s;
}

/** The practical top of the buy-in range: the max, or 250 big blinds at no-max tables. */
export function typicalMax(stake: Stake): number {
  return stake.maxBuyIn ?? 250 * stake.bigBlind;
}
