/**
 * Left-side progress rail (spec 211 § 5 / § 7). Renders the act ladder
 * with checkmarks for completed acts, an arrow for the active act,
 * and dim numbers for queued acts.
 */

import { ACTS, type ActDef } from '../acts';
import { LiveStatusBadge } from './LiveStatusBadge';

export function ProgressRail({
  activeSlug,
  completedSlugs,
}: {
  activeSlug: string | null;
  completedSlugs: Set<string>;
}) {
  return (
    <aside className="progress-rail" aria-label="Act progress">
      <p className="eyebrow">Act ladder</p>
      <ol>
        {ACTS.map((act) => (
          <RailItem
            key={act.slug}
            act={act}
            isActive={act.slug === activeSlug}
            isCompleted={completedSlugs.has(act.slug)}
          />
        ))}
      </ol>
      <p className="rail-footnote muted">
        Per spec 211 § 5. Statuses upgrade from <strong>QUEUED</strong> →{' '}
        <strong>SIMULATED</strong> → <strong>LIVE</strong> as phase 6f.* lands.
      </p>
    </aside>
  );
}

function RailItem({
  act,
  isActive,
  isCompleted,
}: {
  act: ActDef;
  isActive: boolean;
  isCompleted: boolean;
}) {
  const className = [
    'rail-item',
    isActive && 'rail-item--active',
    isCompleted && 'rail-item--done',
    act.status === 'not-started' && 'rail-item--queued',
  ]
    .filter(Boolean)
    .join(' ');

  const marker = isCompleted ? '✓' : isActive ? '▶' : String(act.id);
  const disabled = act.status === 'not-started' && !isCompleted;

  return (
    <li className={className}>
      <a
        href={`#/acts/${act.slug}`}
        aria-current={isActive ? 'step' : undefined}
        aria-disabled={disabled ? 'true' : undefined}
        tabIndex={disabled ? -1 : 0}
      >
        <span className="rail-marker">{marker}</span>
        <span className="rail-content">
          <span className="rail-title">{act.title}</span>
          <span className="rail-meta">
            <LiveStatusBadge status={act.status} />
            <span className="rail-modality">{act.modality}</span>
          </span>
        </span>
      </a>
    </li>
  );
}
