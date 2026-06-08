import { useEffect, useState, useCallback } from "react";
import Graph from "graphology";
import { SigmaContainer, useLoadGraph, useSigma } from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";

import type { PiDesktopApi } from "../ipc";

// ── Community color palette ─────────────────────────────────────────────────

const COMMUNITY_COLORS = [
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4",
  "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990", "#dcbeff",
  "#9A6324", "#fffac8", "#800000", "#aaffc3", "#808000", "#ffd8b1",
  "#000075", "#a9a9a9", "#e6beff", "#1abc9c", "#2ecc71", "#3498db",
  "#9b59b6", "#34495e", "#16a085", "#27ae60", "#2980b9", "#8e44ad",
  "#2c3e50", "#f39c12", "#e74c3c", "#ecf0f1", "#95a5a6", "#d35400",
  "#c0392b", "#bdc3c7", "#7f8c8d", "#1abc9c", "#2ecc71", "#3498db",
  "#16a085", "#27ae60", "#2980b9", "#8e44ad", "#2c3e50", "#f1c40f",
  "#e67e22", "#e74c3c", "#ecf0f1", "#95a5a6", "#f39c12", "#d35400",
  "#c0392b", "#bdc3c7", "#7f8c8d", "#2ecc71", "#3498db", "#9b59b6",
  "#34495e", "#1abc9c", "#27ae60", "#2980b9", "#8e44ad", "#f1c40f",
  "#e67e22", "#e74c3c", "#16a085", "#2c3e50", "#d35400", "#c0392b",
  "#95a5a6", "#7f8c8d", "#bdc3c7", "#f39c12", "#3cb44b", "#ffe119",
  "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#bfef45",
  "#fabed4", "#469990", "#dcbeff", "#9A6324", "#fffac8", "#800000",
  "#aaffc3", "#808000", "#ffd8b1", "#000075", "#a9a9a9", "#e6beff",
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4",
  "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990", "#dcbeff",
  "#9A6324", "#fffac8", "#800000", "#aaffc3", "#808000", "#ffd8b1",
  "#000075", "#a9a9a9", "#e6beff", "#e6194b", "#3cb44b", "#ffe119",
  "#4363d8", "#f58231", "#911eb4", "#42d4f4", "#f032e6", "#bfef45",
  "#fabed4", "#469990", "#dcbeff", "#9A6324", "#fffac8", "#800000",
  "#aaffc3", "#808000", "#ffd8b1", "#000075", "#a9a9a9", "#e6beff",
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4",
];

// ── Data types ──────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label?: string;
  community?: number;
  source_file?: string;
  file_type?: string;
}

interface GraphLink {
  source: string;
  target: string;
  relation?: string;
  weight?: number;
}

interface GraphData {
  nodes?: GraphNode[];
  edges?: GraphLink[];
  links?: GraphLink[];
}

// ── Search bar ──────────────────────────────────────────────────────────────

function SearchBar() {
  const sigma = useSigma();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!query.trim()) {
      // Show all nodes
      sigma.getGraph().forEachNode((node) => {
        sigma.getGraph().setNodeAttribute(node, "hidden", false);
      });
      sigma.refresh();
      return;
    }
    const lower = query.toLowerCase();
    sigma.getGraph().forEachNode((node, attrs) => {
      const label = (attrs.label ?? node).toLowerCase();
      const match = label.includes(lower);
      sigma.getGraph().setNodeAttribute(node, "hidden", !match);
    });
    sigma.refresh();
  }, [query, sigma]);

  return (
    <div className="graph-surface__search">
      <input
        type="text"
        placeholder="Search nodes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="graph-surface__search-input"
      />
    </div>
  );
}

// ── Node info panel ─────────────────────────────────────────────────────────

function NodeInfoPanel() {
  const sigma = useSigma();
  const [selected, setSelected] = useState<{ id: string; label: string; community?: number; file?: string } | null>(null);

  useEffect(() => {
    const handler = (event: { node: string }) => {
      const nodeId = event.node;
      const attrs = sigma.getGraph().getNodeAttributes(nodeId);
      setSelected({
        id: nodeId,
        label: attrs.label ?? nodeId,
        community: attrs.community,
        file: attrs.source_file,
      });
    };
    sigma.on("clickNode", handler);
    return () => { sigma.off("clickNode", handler); };
  }, [sigma]);

  // Click stage to deselect
  useEffect(() => {
    const handler = () => setSelected(null);
    sigma.on("clickStage", handler);
    return () => { sigma.off("clickStage", handler); };
  }, [sigma]);

  if (!selected) return null;

  return (
    <div className="graph-surface__info">
      <strong>{selected.label}</strong>
      {selected.community !== undefined && <span>Community {selected.community}</span>}
      {selected.file && <span className="graph-surface__info-file">{selected.file}</span>}
      <button type="button" className="graph-surface__info-close" onClick={() => setSelected(null)}>×</button>
    </div>
  );
}

// ── Graph loader ────────────────────────────────────────────────────────────

function GraphLoader({ data }: { data: GraphData }) {
  const loadGraph = useLoadGraph();

  useEffect(() => {
    const graph = new Graph();
    const links = data.edges ?? data.links ?? [];

    // Add nodes — assign random initial positions (required by Sigma.js)
    for (const node of data.nodes ?? []) {
      const community = node.community ?? 0;
      graph.addNode(node.id, {
        label: node.label ?? node.id,
        size: 6,
        color: COMMUNITY_COLORS[community % COMMUNITY_COLORS.length],
        community,
        source_file: node.source_file,
        file_type: node.file_type,
        x: Math.random() * 1000,
        y: Math.random() * 1000,
      });
    }

    // Add edges (skip duplicates)
    for (const link of links) {
      if (graph.hasNode(link.source) && graph.hasNode(link.target)) {
        const key = `${link.source}::${link.target}`;
        if (!graph.hasEdge(key)) {
          graph.addEdgeWithKey(key, link.source, link.target, {
            size: 1,
            color: "#33333330",
            label: link.relation ?? "",
          });
        }
      }
    }

    loadGraph(graph);
  }, [data, loadGraph]);

  return null;
}

// ── Main surface ────────────────────────────────────────────────────────────

interface GraphSurfaceProps {
  readonly api: PiDesktopApi;
  readonly rootWorkspaceId: string | undefined;
}

export function GraphSurface({ api, rootWorkspaceId }: GraphSurfaceProps) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadGraph = useCallback(async () => {
    if (!rootWorkspaceId) {
      setError("No workspace selected");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const result = await api.readGraphifyGraph(rootWorkspaceId) as GraphData & { error?: string };
      if (result.error) {
        setError(result.error);
      } else {
        setData(result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api, rootWorkspaceId]);

  useEffect(() => { void loadGraph(); }, [loadGraph]);

  if (loading) {
    return (
      <div className="graph-surface graph-surface--loading">
        <div className="graph-surface__spinner" />
        <span>Loading graph…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="graph-surface graph-surface--error">
        <p>{error ?? "Failed to load graph"}</p>
        <button type="button" onClick={() => void loadGraph()}>Retry</button>
      </div>
    );
  }

  const nodeCount = data.nodes?.length ?? 0;
  const edgeCount = data.edges?.length ?? data.links?.length ?? 0;

  return (
    <div className="graph-surface">
      <div className="graph-surface__header">
        <h2>Project Map</h2>
        <span className="graph-surface__stats">{nodeCount} nodes · {edgeCount} edges</span>
      </div>
      <div className="graph-surface__canvas">
        <SigmaContainer
          style={{ width: "100%", height: "100%" }}
          settings={{
            renderEdgeLabels: false,
            defaultEdgeType: "arrow",
            labelFont: "var(--font-sans)",
            labelSize: 11,
            labelColor: { color: "#ccc" },
            labelRenderedSizeThreshold: 8,
            zoomingRatio: 1.3,
            minCameraRatio: 0.05,
            maxCameraRatio: 3,
          }}
        >
          <GraphLoader data={data} />
          <SearchBar />
          <NodeInfoPanel />
        </SigmaContainer>
      </div>
    </div>
  );
}
