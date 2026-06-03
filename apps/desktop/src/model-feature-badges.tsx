import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";

interface ModelFeatureBadgesProps {
  readonly runtime?: RuntimeSnapshot;
  readonly provider?: string;
  readonly modelId?: string;
}

export function ModelFeatureBadges({ runtime, provider, modelId }: ModelFeatureBadgesProps) {
  if (!runtime || !provider || !modelId) {
    return null;
  }

  const currentModel = runtime.models.find(
    (m) => m.providerId === provider && m.modelId === modelId,
  );

  if (!currentModel) {
    return null;
  }

  const badges: Array<{ key: string; label: string; title: string }> = [];

  // Codex pool badge — show when using an openai-codex provider
  if (provider === "openai-codex" || provider.startsWith("openai-codex/")) {
    badges.push({
      key: "codex-pool",
      label: "codex pool",
      title: "Using codex pool",
    });
  }

  // Vision proxy badge — show when current model does not support images
  if (!currentModel.supportsImages) {
    badges.push({
      key: "vision-proxy",
      label: "vision proxy",
      title: "Images are routed through a vision-capable fallback model",
    });
  }

  if (badges.length === 0) {
    return null;
  }

  return (
    <>
      {badges.map((badge) => (
        <span key={badge.key} className="model-feature-badge" title={badge.title}>
          {badge.label}
        </span>
      ))}
    </>
  );
}
