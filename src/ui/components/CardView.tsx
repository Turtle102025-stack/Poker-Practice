import { rankOf, RANK_CHARS, suitOf, SUIT_CHARS, SUIT_SYMBOLS, type Card } from '../../engine/cards';

const SUIT_NAMES = ['clubs', 'diamonds', 'hearts', 'spades'];

export interface CardViewProps {
  card: Card | null;
  size?: 'sm' | 'md' | 'lg';
  fourColor?: boolean;
  /** Greyed out (e.g. a folded hand revealed in practice mode). */
  dim?: boolean;
  /** Part of the winning five cards. */
  highlight?: boolean;
}

/** A playing card drawn with CSS. `card === null` draws a face-down card. */
export function CardView({ card, size = 'md', fourColor, dim, highlight }: CardViewProps) {
  if (card === null) return <span className={`card ${size} back`} aria-label="face-down card" />;
  const suit = suitOf(card);
  const rank = RANK_CHARS[rankOf(card)];
  const color = fourColor ? `s4-${SUIT_CHARS[suit]}` : suit === 1 || suit === 2 ? 'red' : 'black';
  const cls = ['card', size, color, dim ? 'dim' : '', highlight ? 'hl' : ''].filter(Boolean).join(' ');
  const rankText = rank === 'T' ? '10' : rank;
  return (
    <span className={cls} aria-label={`${rankText} of ${SUIT_NAMES[suit]}`} title={`${rankText} of ${SUIT_NAMES[suit]}`}>
      <span className="r">{rankText}</span>
      <span className="s">{SUIT_SYMBOLS[suit]}</span>
    </span>
  );
}

export function EmptyCardSlot({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`card ${size} slot`} aria-hidden="true" />;
}
