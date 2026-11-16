import type { AiSpeed, TableSettings } from '../../table/controller';

interface Props {
  settings: TableSettings;
  bigBlind: number;
  onChange: (patch: Partial<TableSettings>) => void;
  onClose: () => void;
}

const SPEEDS: Array<[AiSpeed, string]> = [
  ['slow', 'Slow'],
  ['normal', 'Normal'],
  ['fast', 'Fast'],
  ['instant', 'Instant'],
];

const DEALS: Array<[number | null, string]> = [
  [null, 'When I click Deal'],
  [5000, 'After 5 seconds'],
  [2500, 'After 2.5 seconds'],
  [1000, 'After 1 second'],
];

export function SettingsPanel({ settings, bigBlind, onChange, onClose }: Props) {
  const toggle = (key: keyof TableSettings, label: string, hint?: string) => (
    <label className="toggle">
      <input type="checkbox" checked={settings[key] as boolean} onChange={(e) => onChange({ [key]: e.target.checked })} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings" role="dialog" aria-label="Table settings" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>Table settings</h2>
          <button onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <fieldset>
          <legend>Computer player speed</legend>
          <div className="seg">
            {SPEEDS.map(([v, l]) => (
              <button key={v} className={settings.aiSpeed === v ? 'on' : ''} onClick={() => onChange({ aiSpeed: v })}>{l}</button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>Deal the next hand</legend>
          <div className="seg">
            {DEALS.map(([v, l]) => (
              <button key={String(v)} className={settings.autoDealMs === v ? 'on' : ''} onClick={() => onChange({ autoDealMs: v })}>{l}</button>
            ))}
          </div>
        </fieldset>

        {toggle('pauseAfterMyShowdown', 'Wait for me after showdowns I play', 'So you can look at the cards')}
        {toggle('autoFastForward', 'Fast-forward after I fold', 'Skip to the end of hands you are out of')}
        {toggle('practiceMode', 'Practice mode: show all hole cards after each hand')}
        {toggle('straddle', `Straddle ($${2 * bigBlind}) when I'm under the gun`)}
        {toggle('showHandStrength', 'Show my current hand (e.g. "two pair")')}
        {toggle('fourColorDeck', 'Four-color deck', 'Clubs green, diamonds blue')}
      </div>
    </div>
  );
}
