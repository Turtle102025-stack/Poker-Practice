import type { Card } from './cards';
import { parseCards } from './cards';
import { secureRng, shuffle, type Rng } from './rng';

export function orderedDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

export function shuffledDeck(rng: Rng = secureRng): Card[] {
  return shuffle(orderedDeck(), rng);
}

/**
 * Builds a deck whose top cards are exactly `top` (in dealing order), followed by
 * the remaining cards. Used by tests to set up exact deals.
 */
export function stackedDeck(top: Card[] | string): Card[] {
  const first = typeof top === 'string' ? parseCards(top) : top;
  const seen = new Set<Card>();
  for (const c of first) {
    if (seen.has(c)) throw new Error('Duplicate card in stacked deck');
    seen.add(c);
  }
  return [...first, ...orderedDeck().filter((c) => !seen.has(c))];
}
