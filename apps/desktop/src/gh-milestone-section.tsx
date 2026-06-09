import type { GhMilestoneRecord, GhRunnerState } from "./gh-types";

interface GhMilestoneSectionProps {
  readonly milestones?: readonly GhMilestoneRecord[];
  readonly runnerState?: GhRunnerState;
  readonly selectedWorkspaceId?: string;
  readonly onRun: (workspaceId: string, milestoneNumber: number) => void;
  readonly onCancel: () => void;
}

export function GhMilestoneSection(props: GhMilestoneSectionProps) {
  const milestones = props.milestones ?? [];
  if (milestones.length === 0) return null;
  const runner = props.runnerState;
  const busy = runner?.status === "running" || runner?.status === "cancelling";
  return (
    <div className="gh-milestones" data-testid="gh-milestones">
      <div className="gh-milestones__header">Issue groups</div>
      {milestones.map((m) => {
        const isActive = busy && runner?.milestoneNumber === m.number;
        const total = m.openIssues + m.closedIssues;
        return (
          <div key={m.number} className="gh-milestone" data-testid="gh-milestone">
            <div className="gh-milestone__row">
              <span className="gh-milestone__title" title={m.description || m.title}>{m.title}</span>
              <span className="gh-milestone__count">{m.closedIssues}/{total}</span>
              {isActive ? (
                <button type="button" className="gh-milestone__btn" onClick={props.onCancel} title="Stop run" aria-label="Stop run">■</button>
              ) : (
                <button
                  type="button"
                  className="gh-milestone__btn"
                  disabled={busy || !props.selectedWorkspaceId || m.issues.length === 0}
                  onClick={() => { if (props.selectedWorkspaceId) props.onRun(props.selectedWorkspaceId, m.number); }}
                  title={m.issues.length === 0 ? "No ready-for-agent issues" : "Run this group"}
                  aria-label="Run this group"
                >▶</button>
              )}
            </div>
            {isActive && runner ? (
              <ul className="gh-milestone__issues">
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
