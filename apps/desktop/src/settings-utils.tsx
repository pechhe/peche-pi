import type { ReactNode } from "react";
import type { RuntimeSettingsSnapshot, RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import { Button } from "@/components/ui/button";

export type SettingsSection = "appearance" | "general" | "providers" | "models" | "notifications" | "sounds" | "actions";

export const THINKING_LEVELS: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>[] = [
  "low",
  "medium",
  "high",
  "xhigh",
];

export function settingsPill(active: boolean): string {
  return `settings-pill${active ? " settings-pill--active" : ""}`;
}

/** Single-choice pill group for 1-of-N settings. */
export function PillGroup<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label?: string;
}) {
  return (
    <div aria-label={label} className="flex flex-wrap items-center gap-1.5" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={option.value === value}
          className={settingsPill(option.value === value)}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function labelForThinking(level: NonNullable<RuntimeSettingsSnapshot["defaultThinkingLevel"]>): string {
  if (level === "xhigh") {
    return "Extra High";
  }
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function sectionTitle(section: SettingsSection): string {
  switch (section) {
    case "appearance":
      return "Appearance";
    case "providers":
      return "Providers";
    case "models":
      return "Models";
    case "notifications":
      return "Notifications";
    case "sounds":
      return "Sounds";
    case "actions":
      return "Actions";
    default:
      return "General";
  }
}

export function filterProviders(
  providers: readonly RuntimeSnapshot["providers"][number][],
  query: string,
): readonly RuntimeSnapshot["providers"][number][] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return providers;
  }
  return providers.filter((provider) =>
    [provider.id, provider.name, provider.authType].some((value) => value.toLowerCase().includes(normalized)),
  );
}

export function filterModels(
  models: readonly RuntimeSnapshot["models"][number][],
  query: string,
): readonly RuntimeSnapshot["models"][number][] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return models;
  }
  return models.filter((model) =>
    [model.providerId, model.providerName, model.modelId, model.label].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}

/* ── Layout components ────────────────────────────────── */

export function SettingsGroup({
  title,
  description,
  children,
}: {
  readonly title?: string;
  readonly description?: string;
  readonly children: ReactNode;
}) {
  const searchable = [title, description].filter(Boolean).join(" ");
  return (
    <div className="settings-section grid gap-2" data-searchable={searchable || undefined}>
      {title ? (
        <h3 className="settings-section__title m-0 text-[15px] font-semibold tracking-tight text-foreground">{title}</h3>
      ) : null}
      {description ? (
        <p className="settings-section__description m-0 -mt-1 text-[13px] text-muted-foreground">{description}</p>
      ) : null}
      <div className="settings-group overflow-hidden rounded-xl border border-border bg-card shadow-xs divide-y divide-border/60">
        {children}
      </div>
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  stacked,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  /** Render the control under the label instead of beside it (for wide controls like pill groups). */
  readonly stacked?: boolean;
  readonly children?: ReactNode;
}) {
  const searchable = [title, description].filter(Boolean).join(" ");
  return (
    <div
      className={
        stacked
          ? "settings-row flex flex-col items-start gap-2.5 px-4 py-3"
          : "settings-row flex items-center justify-between gap-6 px-4 py-3 max-sm:flex-col max-sm:items-start"
      }
      data-searchable={searchable || undefined}
    >
      <div className="settings-row__label min-w-0 flex-1">
        <div className="settings-row__title text-sm font-medium text-foreground">{title}</div>
        {description ? (
          <div className="settings-row__description mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {children ? (
        <div className={stacked ? "settings-row__control w-full" : "settings-row__control flex shrink-0 items-center gap-2"}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function SettingsInfoRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="settings-row flex items-center justify-between gap-6 px-4 py-2.5" data-searchable={`${label} ${value}`}>
      <div className="settings-row__label min-w-0 flex-1">
        <div className="settings-row__title text-sm font-medium text-foreground">{label}</div>
      </div>
      <div className="settings-row__control shrink-0">
        <span className="settings-row__value text-[13px] text-muted-foreground">{value}</span>
      </div>
    </div>
  );
}

export function ProviderRow({
  provider,
  onLoginProvider,
  onLogoutProvider,
  onConfigureApiKey,
}: {
  readonly provider: RuntimeSnapshot["providers"][number];
  readonly onLoginProvider: (providerId: string) => void;
  readonly onLogoutProvider: (providerId: string) => void;
  readonly onConfigureApiKey: (provider: RuntimeSnapshot["providers"][number]) => void;
}) {
  const action = resolveProviderAction(provider, onLoginProvider, onLogoutProvider, onConfigureApiKey);
  return (
    <div className="settings-row flex items-center justify-between gap-6 px-4 py-3">
      <div className="settings-row__label min-w-0 flex-1">
        <div className="settings-row__title text-sm font-medium text-foreground">{provider.name}</div>
        <div className="settings-row__description mt-0.5 text-[12.5px] text-muted-foreground">
          {describeProviderStatus(provider)}
        </div>
      </div>
      <div className="settings-row__control shrink-0">
        <Button disabled={action.disabled} size="sm" type="button" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      </div>
    </div>
  );
}

function describeProviderStatus(provider: RuntimeSnapshot["providers"][number]): string {
  switch (provider.authSource) {
    case "oauth":
      return "OAuth · connected";
    case "auth_file":
      return "API key · connected";
    case "env":
      return "Environment variable · connected";
    case "external":
      return provider.hasAuth ? "Configured externally · connected" : "Configure externally";
    default:
      if (provider.oauthSupported) {
        return "OAuth";
      }
      if (provider.apiKeySetupSupported) {
        return "API key";
      }
      return provider.authType === "api_key" ? "API key" : "Built in";
  }
}

function resolveProviderAction(
  provider: RuntimeSnapshot["providers"][number],
  onLoginProvider: (providerId: string) => void,
  onLogoutProvider: (providerId: string) => void,
  onConfigureApiKey: (provider: RuntimeSnapshot["providers"][number]) => void,
): {
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick?: () => void;
} {
  if (provider.authSource === "oauth") {
    return {
      disabled: false,
      label: "Logout",
      onClick: () => onLogoutProvider(provider.id),
    };
  }

  if (provider.oauthSupported && provider.authSource === "none") {
    return {
      disabled: false,
      label: "Login",
      onClick: () => onLoginProvider(provider.id),
    };
  }

  if (provider.apiKeySetupSupported && (provider.authSource === "none" || provider.authSource === "auth_file")) {
    return {
      disabled: false,
      label: provider.authSource === "auth_file" ? "Manage" : "Set API key",
      onClick: () => onConfigureApiKey(provider),
    };
  }

  return {
    disabled: true,
    label: provider.authSource === "env" || provider.authSource === "external" ? "Managed externally" : "Configure externally",
  };
}
