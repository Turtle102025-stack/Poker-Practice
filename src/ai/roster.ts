import { STYLES, type Archetype, type StyleParams } from './archetypes';

/**
 * The 50 regulars and visitors of the card room. Descriptions are what you
 * would notice sitting at the table; the style is hidden.
 */
export type BuyInHabit = 'min' | 'mid' | 'max' | 'deep' | 'random';

export interface RosterPlayer {
  id: string;
  name: string;
  archetype: Archetype;
  description: string;
  buyIn: BuyInHabit;
  /** Typical session length in hands. */
  sessionHands: number;
  /** Optional per-stake multipliers on the style's stake preference ($1/$3 … $50/$100). */
  stakeBias?: number[];
}

const P = (
  id: string, name: string, archetype: Archetype, buyIn: BuyInHabit, sessionHands: number,
  description: string, stakeBias?: number[],
): RosterPlayer => ({ id, name, archetype, buyIn, sessionHands, description, stakeBias });

export const ROSTER: RosterPlayer[] = [
  // Nits
  P('harold', 'Harold', 'nit', 'max', 260, 'Retired, cardigan over a golf shirt, reading glasses on a chain. Sips hot tea and stacks his chips in perfect towers. Mentions how many years he has been playing here.'),
  P('walt', 'Walt', 'nit', 'mid', 240, 'Veterans cap, black coffee, newspaper folded on the rail. Checks his cards once and guards them with a lucky silver dollar.'),
  P('doris', 'Doris', 'nit', 'max', 220, 'Silver bob, big purse on the chair beside her, diet soda with lime. Watches everyone closely and folds quickly.'),
  P('lou', 'Lou', 'nit', 'mid', 200, 'Windbreaker and a thermos of decaf. Complains that the dealer shuffles too slowly. Takes a long time before playing any hand.'),
  P('grace', 'Grace', 'nit', 'max', 240, 'Neat blouse, water with no ice, sits very still. Polite and quiet; mostly speaks to say "nice hand."'),
  P('stan', 'Stan', 'nit', 'random', 200, 'Fishing vest with lots of pockets, tall iced tea. Asks for a new deck and talks about "waiting for aces."'),

  // Semi-nits
  P('mark', 'Mark', 'semiNit', 'max', 180, 'Polo shirt with a tech-company logo, sparkling water. Scrolls his phone between hands and mentions a poker podcast.'),
  P('priya', 'Priya', 'semiNit', 'max', 200, 'Hoodie and earbuds, green tea. Pays close attention to the action but rarely chats.'),
  P('dale', 'Dale', 'semiNit', 'mid', 170, "Canvas work jacket, light beer. Friendly, talks about his kids' baseball games."),
  P('elena', 'Elena', 'semiNit', 'max', 190, 'Blazer over a T-shirt, cappuccino. Taps notes into her phone between hands.'),
  P('russ', 'Russ', 'semiNit', 'mid', 170, 'Bald with a gray goatee, Hawaiian shirt, club soda. Says he "only plays premium hands, mostly."'),
  P('kim', 'Kim', 'semiNit', 'random', 180, 'Fleece vest, chamomile tea, reading glasses pushed up on her head. Chats with the dealer and plays carefully.'),

  // Tight passive
  P('earl', 'Earl', 'tightPassive', 'mid', 200, 'Overalls and a seed-company cap, coffee with three sugars. Quiet; nods when he calls.'),
  P('bernice', 'Bernice', 'tightPassive', 'mid', 180, 'Sunday-lunch outfit, tote bag with knitting, lemonade. Says "oh, I\'ll just call" a lot.'),
  P('ray', 'Ray', 'tightPassive', 'random', 160, 'Sports-team jacket, ginger ale. Says "I knew it" when he loses a hand.'),
  P('tomoko', 'Tomoko', 'tightPassive', 'mid', 190, 'Neat sweater, jasmine tea. Very polite; her bets are small and apologetic.'),
  P('gil', 'Gil', 'tightPassive', 'mid', 180, 'Plaid shirt, root beer, bifocals. Takes forever to decide, then usually just calls.'),
  P('marisol', 'Marisol', 'tightPassive', 'random', 150, 'Scrubs after a night shift, iced coffee. Cautious and a little tired.'),

  // Loose passive recreational
  P('bigmike', 'Big Mike', 'loosePassive', 'random', 140, 'Huge guy in a football jersey, bucket of beers on the rail. Loves to "see a cheap flop" and talks about his fantasy team.'),
  P('brenda', 'Brenda', 'loosePassive', 'mid', 110, 'Sequined top, cosmopolitan, celebrating a birthday with friends at the bar. "I just want to have fun!"'),
  P('hector', 'Hector', 'loosePassive', 'mid', 130, 'Construction boots, energy drink. Says "gotta see it" and calls.'),
  P('sully', 'Sully', 'loosePassive', 'max', 150, 'Golf shirt, rum and Coke. Tells long stories about his boat.', [0.6, 1, 1.4, 1.4, 1.2]),
  P('tammy', 'Tammy', 'loosePassive', 'random', 120, 'Leopard-print jacket, white wine. Plays a lot of hands and seems to enjoy every one.'),
  P('vinnie', 'Vinnie', 'loosePassive', 'max', 140, 'Gold chain, track suit, espresso. Chatty; calls raises "to keep you honest."', [0.7, 1, 1.4, 1.3, 1]),
  P('june', 'June', 'loosePassive', 'mid', 100, 'Visor and fanny pack, on vacation, strawberry daiquiri. Asks the dealer which hands are good.'),
  P('pete', 'Pete', 'loosePassive', 'random', 120, 'Faded band T-shirt, two beers in. Shows his cards even when he loses.'),
  P('lorraine', 'Lorraine', 'loosePassive', 'mid', 160, 'Players-club lanyard, coffee with cream. Plays like she plays the slots: lots of hands, small bets.'),

  // Loose aggressive recreational
  P('tyler', 'Tyler', 'looseAggressive', 'max', 120, 'Flat-brim hat, sunglasses indoors, vodka and energy drink. Talks trash after winning a pot.'),
  P('jasmine', 'Jasmine', 'looseAggressive', 'deep', 110, 'Designer jacket, champagne. Plays fast and loud and buys back in without blinking.', [0.3, 0.7, 1.5, 2.2, 3]),
  P('ronnie', 'Ronnie', 'looseAggressive', 'random', 120, 'Sports-betting slips in his pocket, double whiskey. Gets very loud after losing a pot.'),
  P('chase', 'Chase', 'looseAggressive', 'max', 100, 'Fraternity sweatshirt, beer. "Let\'s gamble!"'),
  P('dmitri', 'Dmitri', 'looseAggressive', 'deep', 130, 'Leather jacket, vodka on the rocks. Likes big pots and stares down whoever is in the hand.', [0.3, 0.6, 1.5, 2, 2.5]),
  P('gina', 'Gina', 'looseAggressive', 'random', 90, 'Bachelorette sash, tequila shots with her friends. Laughs at every bet.'),
  P('kenny', 'Kenny', 'looseAggressive', 'deep', 120, 'Crypto T-shirt, cold brew. Talks about his portfolio and slams chips into the pot.', [0.5, 1, 1.5, 2, 2]),

  // Overly aggressive regulars
  P('josh', 'Josh', 'aggroReg', 'max', 220, 'Hoodie, headphones around his neck, energy drink. Talks about "ranges" and "blockers."'),
  P('andre', 'Andre', 'aggroReg', 'max', 200, 'Compression shirt, protein shake. Plays fast and sighs loudly when he gets called.'),
  P('kat', 'Kat', 'aggroReg', 'max', 210, 'Puffer vest, cold brew, hair in a bun. Confident, quick with her chips.'),
  P('bryce', 'Bryce', 'aggroReg', 'max', 190, 'College sweatshirt, chewing gum. Watches poker videos on his phone between hands.'),
  P('lena', 'Lena', 'aggroReg', 'max', 200, 'Gym clothes, green juice. Rarely checks when it is checked to her.'),

  // Good regulars
  P('sam', 'Sam', 'goodReg', 'max', 260, 'Plain gray hoodie, water bottle. Quiet and focused; gives nothing away.', [0.3, 0.8, 1, 1.4, 2]),
  P('nadia', 'Nadia', 'goodReg', 'max', 240, 'Black turtleneck, sparkling water. Calm and patient; watches every hand, even the ones she folds.'),
  P('victor', 'Victor', 'goodReg', 'max', 250, 'Button-down shirt, black coffee. Plays several days a week, friendly with the dealers, hard to read.', [1.2, 1.5, 1.2, 0.8, 0.5]),
  P('owen', 'Owen', 'goodReg', 'deep', 240, 'Baseball cap, earbuds in with no music. Adjusts his chips the same way every hand.'),
  P('mei', 'Mei', 'goodReg', 'max', 230, 'Cardigan and glasses, herbal tea. Studies the table before she plays a hand.'),

  // Short stackers
  P('eddie', 'Eddie', 'shortStacker', 'min', 90, 'Windbreaker, scratch tickets in his pocket. Keeps a short stack in front of him.'),
  P('rosa', 'Rosa', 'shortStacker', 'min', 80, 'Hospital lanyard, diet cola. Small stack; rebuys quickly when she busts.'),
  P('dutch', 'Dutch', 'shortStacker', 'min', 100, 'Old denim jacket, cheap beer. Pushes his chips in with both hands.'),
  P('benny', 'Benny', 'shortStacker', 'min', 90, 'Lucky rabbit\'s foot on his keychain, coffee. "All or nothing, baby."'),
  P('trish', 'Trish', 'shortStacker', 'min', 80, 'Visor, iced tea, steps outside on every break. Buys in short every time.'),
  P('moe', 'Moe', 'shortStacker', 'min', 70, 'Sweatpants, energy drink. Counts his chips constantly.'),
];

export const ROSTER_BY_ID = new Map(ROSTER.map((p) => [p.id, p]));

/** A stable number in [0, 1) from a string (so each player's quirks are the same every visit). */
export function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 0x1_0000_0000;
}

const THRESHOLDS = new Set(['valueThreshold', 'callThreshold', 'raiseThreshold']);

/**
 * The player's own version of their style: each number is nudged up to ±15%
 * (thresholds ±0.04), the same way every time for that player.
 */
export function personalStyle(player: RosterPlayer): StyleParams {
  const base = STYLES[player.archetype];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === 'number') {
      const r = hash01(`${player.id}:${key}`) * 2 - 1;
      out[key] = THRESHOLDS.has(key) ? value + 0.04 * r : value * (1 + 0.15 * r);
    } else if (key === 'betSize') {
      const b = value as StyleParams['betSize'];
      const r = hash01(`${player.id}:betSize`) * 2 - 1;
      out[key] = { value: b.value * (1 + 0.12 * r), bluff: b.bluff * (1 + 0.12 * r), small: b.small * (1 + 0.1 * r) };
    } else {
      out[key] = value;
    }
  }
  return out as unknown as StyleParams;
}
