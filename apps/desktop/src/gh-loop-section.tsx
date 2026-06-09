import type { GhLoopRecord, GhRunnerState } from "./gh-types";

interface GhLoopSectionProps {
  readonly loops?: readonly GhLoopRecord[];
  readonly runnerState?: GhRunnerState;
  readonly selectedWorkspaceId?: string;
  readonly onRun: (workspaceId: string, loopNumber: number) => void;
  readonly onCancel: () => void;
}

export function GhLoopSection(props: GhLoopSectionProps) {
  const loops = props.loops ?? [];
  if (loops.length === 0) return null;
  const runner = props.runnerState;
  const busy = runner?.status === "running" || runner?.status === "cancelling";
  return (
    <div className="gh-loops" data-testid="gh-loops">
      <div className="gh-loops__header">Loops</div>
      {loops.map((l) => {
        const isActive = busy && runner?.loopNumber === l.number;
        const total = l.openSubIssues + l.closedSubIssues;
        return (
          <div key={l.number} className="gh-loop" data-testid="gh-loop">
            <div className="gh-loop__row">
              <span className="gh-loop__title" title={l.body || l.title}>#{l.number} {l.title}</span>
              <span className="gh-loop__count">{l.closedSubIssues}/{total}</span>
              {isActive ? (
                <button type="button" className="gh-loop__btn" onClick={props.onCancel} title="Stop loop" aria-label="Stop loop">■</button>
              ) : (
                <button
                  type="button"
                  className="gh-loop__btn"
                  disabled={busy || !props.selectedWorkspaceId || l.subIssues.length === 0}
                  onClick={() => { if (props.selectedWorkspaceId) props.onRun(props.selectedWorkspaceId, l.number); }}
                  title={l.subIssues.length === 0 ? "No sub-issues" : "Run this loop"}
                  aria-label="Run this loop"
                >▶</button>
              )}
            </div>
            {isActive && runner ? (
              <ul className="gh-loop__issues">
                {runner.outcomes.map((o) => (
                  <li key={o.number} className={`gh-issue gh-issue--${o.result}`} data-result={o.result}>
                    <span className="gh-issue__dot" aria-hidden="true" />
                    <span className="gh-issue__title">#{o.number} {o.title}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
