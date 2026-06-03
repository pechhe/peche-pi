import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { SessionExtensionWidgetRecord } from "./desktop-state";
import { FLEET_WIDGET_KEY, parseFleet, type FleetAgent } from "./subagent-fleet";

// Live progress for running subagents, parsed from the extension's
// "subagent-status" widget and keyed by agent name. The inline subagent card
// consumes this to act as the live agent view (spinner, activity, stats) while
// a launch is still running.

type SubagentLiveMap = ReadonlyMap<string, FleetAgent>;

const SubagentLiveContext = createContext<SubagentLiveMap>(new Map());

export function SubagentLiveProvider({
  widgets,
  children,
}: {
  readonly widgets: readonly SessionExtensionWidgetRecord[];
  readonly children: ReactNode;
}) {
  const map = useMemo<SubagentLiveMap>(() => {
    const record = widgets.find((widget) => widget.key === FLEET_WIDGET_KEY);
    const fleet = record ? parseFleet(record.lines) : null;
    const next = new Map<string, FleetAgent>();
    for (const agent of fleet?.agents ?? []) {
      next.set(agent.name, agent);
    }
    return next;
  }, [widgets]);

  return <SubagentLiveContext.Provider value={map}>{children}</SubagentLiveContext.Provider>;
}

export function useSubagentLive(name: string): FleetAgent | undefined {
  return useContext(SubagentLiveContext).get(name);
}
