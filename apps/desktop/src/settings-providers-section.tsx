import { useEffect, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { CustomProviderConfig } from "./ipc";
import { filterProviders, ProviderRow, SettingsGroup } from "./settings-utils";

interface SettingsProvidersSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly onLoginProvider: (providerId: string) => void;
  readonly onLogoutProvider: (providerId: string) => void;
  readonly onSetProviderApiKey: (providerId: string, apiKey: string) => Promise<string | undefined>;
  readonly onRemoveProviderApiKey: (providerId: string) => Promise<string | undefined>;
  readonly onAddCustomProvider: (config: CustomProviderConfig) => Promise<string | undefined>;
  readonly onRemoveCustomProvider: (providerId: string) => Promise<string | undefined>;
}

export function SettingsProvidersSection({
  runtime,
  onLoginProvider,
  onLogoutProvider,
  onSetProviderApiKey,
  onRemoveProviderApiKey,
  onAddCustomProvider,
  onRemoveCustomProvider: _onRemoveCustomProvider,
}: SettingsProvidersSectionProps) {
  const [providerQuery, setProviderQuery] = useState("");
  const [apiKeyProviderId, setApiKeyProviderId] = useState<string | undefined>();
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | undefined>();
  const [apiKeyPending, setApiKeyPending] = useState(false);
  const [showCustomDialog, setShowCustomDialog] = useState(false);

  const providers = runtime?.providers ?? [];
  const connectedProviders = providers.filter((p) => p.hasAuth);
  const oauthProviders = providers.filter((p) => p.oauthSupported);
  const filteredProviders = filterProviders(providers, providerQuery);
  const isSearching = providerQuery.trim().length > 0;
  const apiKeyProvider = apiKeyProviderId ? providers.find((provider) => provider.id === apiKeyProviderId) : undefined;

  useEffect(() => {
    setApiKeyDraft("");
    setApiKeyError(undefined);
    setApiKeyPending(false);
  }, [apiKeyProviderId]);

  const closeApiKeyDialog = () => {
    if (apiKeyPending) return;
    setApiKeyProviderId(undefined);
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyProvider) return;
    setApiKeyPending(true);
    setApiKeyError(undefined);
    const nextError = await onSetProviderApiKey(apiKeyProvider.id, apiKeyDraft.trim());
    if (nextError) {
      setApiKeyPending(false);
      setApiKeyError(nextError);
      return;
    }
    setApiKeyProviderId(undefined);
  };

  const handleRemoveApiKey = async () => {
    if (!apiKeyProvider) return;
    setApiKeyPending(true);
    setApiKeyError(undefined);
    const nextError = await onRemoveProviderApiKey(apiKeyProvider.id);
    if (nextError) {
      setApiKeyPending(false);
      setApiKeyError(nextError);
      return;
    }
    setApiKeyProviderId(undefined);
  };

  return (
    <>
      {/* Always-visible search bar */}
      <SettingsGroup>
        <div className="settings-row">
          <input
            aria-label="Search providers"
            className="settings-search"
            placeholder="Search providers by name or ID"
            value={providerQuery}
            onChange={(event) => setProviderQuery(event.target.value)}
          />
        </div>
        <div className="settings-row">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => setShowCustomDialog(true)}
          >
            + Add custom provider
          </button>
        </div>
      </SettingsGroup>

      {/* Search results (shown when searching) */}
      {isSearching ? (
        <SettingsGroup title="Search results" description={`${filteredProviders.length} provider${filteredProviders.length !== 1 ? "s" : ""} matching "${providerQuery}".`}>
          {filteredProviders.length > 0 ? (
            filteredProviders.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                onLoginProvider={onLoginProvider}
                onLogoutProvider={onLogoutProvider}
                onConfigureApiKey={(entry) => setApiKeyProviderId(entry.id)}
              />
            ))
          ) : (
            <div className="settings-row">
              <span className="settings-row__description">
                No providers found. Try a different search, or add a custom provider above.
              </span>
            </div>
          )}
        </SettingsGroup>
      ) : null}

      {/* Connected providers (hidden during search) */}
      {!isSearching ? (
        <SettingsGroup title="Connected" description="Connected providers are used first for picking models.">
          {connectedProviders.length > 0 ? (
            connectedProviders.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                onLoginProvider={onLoginProvider}
                onLogoutProvider={onLogoutProvider}
                onConfigureApiKey={(entry) => setApiKeyProviderId(entry.id)}
              />
            ))
          ) : (
            <div className="settings-row">
              <span className="settings-row__description">No providers connected yet.</span>
            </div>
          )}
        </SettingsGroup>
      ) : null}

      {/* OAuth sign-in (hidden during search) */}
      {!isSearching ? (
        <SettingsGroup title="Sign in" description="OAuth-capable providers can sign in directly from the desktop app.">
          {oauthProviders.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              onLoginProvider={onLoginProvider}
              onLogoutProvider={onLogoutProvider}
              onConfigureApiKey={(entry) => setApiKeyProviderId(entry.id)}
            />
          ))}
        </SettingsGroup>
      ) : null}

      {/* All providers (hidden during search, in disclosure) */}
      {!isSearching ? (
        <SettingsGroup title="All providers" description="Browse the full provider inventory.">
          <details className="settings-disclosure">
            <summary className="settings-disclosure__summary">
              <span>Browse all providers</span>
              <span>{providers.length}</span>
            </summary>
            <div className="settings-disclosure__body">
              <div className="settings-list">
                {providers.map((provider) => (
                  <ProviderRow
                    key={provider.id}
                    provider={provider}
                    onLoginProvider={onLoginProvider}
                    onLogoutProvider={onLogoutProvider}
                    onConfigureApiKey={(entry) => setApiKeyProviderId(entry.id)}
                  />
                ))}
              </div>
            </div>
          </details>
        </SettingsGroup>
      ) : null}

      {/* API key dialog */}
      {apiKeyProvider ? (
        <ProviderApiKeyDialog
          provider={apiKeyProvider}
          draft={apiKeyDraft}
          error={apiKeyError}
          pending={apiKeyPending}
          onChangeDraft={setApiKeyDraft}
          onClose={closeApiKeyDialog}
          onRemove={apiKeyProvider.authSource === "auth_file" ? handleRemoveApiKey : undefined}
          onSave={handleSaveApiKey}
        />
      ) : null}

      {/* Custom provider dialog */}
      {showCustomDialog ? (
        <CustomProviderDialog
          onClose={() => setShowCustomDialog(false)}
          onSave={onAddCustomProvider}
        />
      ) : null}
    </>
  );
}

/* ── API key dialog (existing) ──────────────────────────── */

function ProviderApiKeyDialog({
  provider,
  draft,
  error,
  pending,
  onChangeDraft,
  onClose,
  onRemove,
  onSave,
}: {
  readonly provider: RuntimeSnapshot["providers"][number];
  readonly draft: string;
  readonly error?: string;
  readonly pending: boolean;
  readonly onChangeDraft: (value: string) => void;
  readonly onClose: () => void;
  readonly onRemove?: () => Promise<void>;
  readonly onSave: () => Promise<void>;
}) {
  const title = provider.authSource === "auth_file" ? "Manage API key" : "Set API key";
  const body =
    provider.authSource === "auth_file"
      ? `Replace or remove the saved API key for ${provider.name}.`
      : `Save an API key locally for ${provider.name}.`;

  return (
    <div className="extension-dialog-backdrop">
      <div className="extension-dialog" data-testid="provider-api-key-dialog">
        <div className="extension-dialog__title">{title}</div>
        <p className="extension-dialog__body">{body}</p>
        <input
          aria-label={`${provider.name} API key`}
          autoFocus
          className="settings-search"
          disabled={pending}
          placeholder="Enter API key"
          type="password"
          value={draft}
          onChange={(event) => onChangeDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
              return;
            }
            if (event.key === "Enter" && draft.trim()) {
              event.preventDefault();
              void onSave();
            }
          }}
        />
        {error ? <p className="extension-dialog__body settings-warning">{error}</p> : null}
        <div className="extension-dialog__actions">
          <button className="button button--secondary" disabled={pending} type="button" onClick={onClose}>
            Cancel
          </button>
          {onRemove ? (
            <button className="button button--secondary" disabled={pending} type="button" onClick={() => void onRemove()}>
              Remove saved key
            </button>
          ) : null}
          <button
            className="button"
            disabled={pending || draft.trim().length === 0}
            type="button"
            onClick={() => void onSave()}
          >
            {provider.authSource === "auth_file" ? "Save key" : "Set API key"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Custom provider dialog ─────────────────────────────── */

type CustomProviderStep = "config" | "models";

const API_TYPES = [
  { value: "openai-completions" as const, label: "OpenAI Completions (v1/chat/completions)" },
  { value: "openai-responses" as const, label: "OpenAI Responses (v1/responses)" },
  { value: "anthropic-messages" as const, label: "Anthropic Messages" },
];

interface DiscoveredModel {
  readonly id: string;
  readonly name: string;
  readonly selected: boolean;
}

function CustomProviderDialog({
  onClose,
  onSave,
}: {
  readonly onClose: () => void;
  readonly onSave: (config: CustomProviderConfig) => Promise<string | undefined>;
}) {
  const [step, setStep] = useState<CustomProviderStep>("config");
  const [providerId, setProviderId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [api, setApi] = useState<CustomProviderConfig["api"]>("openai-completions");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | undefined>();
  const [manualModelId, setManualModelId] = useState("");

  const canProceed = providerId.trim() && baseUrl.trim() && apiKey.trim();

  const handleDiscoverModels = async () => {
    setDiscovering(true);
    setDiscoveryError(undefined);
    try {
      const normalizedUrl = baseUrl.trim().replace(/\/+$/, "");
      const modelsUrl = `${normalizedUrl}/models`;
      const response = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (!response.ok) {
        setDiscoveryError(`Failed to fetch models (${response.status}). You can add models manually below.`);
        setDiscovering(false);
        return;
      }
      const data = await response.json() as { data?: Array<{ id: string; name?: string }> };
      const models = (data.data ?? []).map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        selected: true,
      }));
      if (models.length === 0) {
        setDiscoveryError("No models returned by the API. You can add models manually below.");
      }
      setDiscoveredModels(models);
    } catch {
      setDiscoveryError("Could not connect to the API. You can add models manually below.");
    }
    setDiscovering(false);
  };

  const handleToggleModel = (index: number) => {
    setDiscoveredModels((prev) =>
      prev.map((m, i) => (i === index ? { ...m, selected: !m.selected } : m)),
    );
  };

  const handleAddManualModel = () => {
    const id = manualModelId.trim();
    if (!id) return;
    if (discoveredModels.some((m) => m.id === id)) return;
    setDiscoveredModels((prev) => [...prev, { id, name: id, selected: true }]);
    setManualModelId("");
  };

  const handleSave = async () => {
    const selectedModels = discoveredModels.filter((m) => m.selected);
    if (selectedModels.length === 0) {
      setError("Select at least one model.");
      return;
    }
    setPending(true);
    setError(undefined);
    const config: CustomProviderConfig = {
      providerId: providerId.trim(),
      displayName: displayName.trim() || providerId.trim(),
      baseUrl: baseUrl.trim(),
      api,
      apiKey: apiKey.trim(),
      models: selectedModels.map((m) => ({
        id: m.id,
        name: m.name,
        reasoning: false,
        input: ["text" as const],
        contextWindow: 128000,
        maxTokens: 32000,
      })),
    };
    const nextError = await onSave(config);
    if (nextError) {
      setPending(false);
      setError(nextError);
      return;
    }
    onClose();
  };

  return (
    <div className="extension-dialog-backdrop">
      <div className="extension-dialog extension-dialog--wide" data-testid="custom-provider-dialog">
        {/* Step 1: Provider config */}
        {step === "config" ? (
          <>
            <div className="extension-dialog__title">Add custom provider</div>
            <p className="extension-dialog__body">
              Configure an OpenAI-compatible or Anthropic-compatible API endpoint.
            </p>

            <label className="custom-provider-label">
              <span>Provider ID</span>
              <input
                className="settings-search"
                placeholder="e.g. my-llama-server"
                value={providerId}
                onChange={(event) => setProviderId(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
              />
              <span className="custom-provider-hint">Lowercase letters, numbers, and hyphens only.</span>
            </label>

            <label className="custom-provider-label">
              <span>Display name</span>
              <input
                className="settings-search"
                placeholder="e.g. My Llama Server"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>

            <label className="custom-provider-label">
              <span>Base URL</span>
              <input
                className="settings-search"
                placeholder="e.g. https://api.example.com/v1"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
              <span className="custom-provider-hint">The API base URL (without /models or /chat/completions).</span>
            </label>

            <label className="custom-provider-label">
              <span>API type</span>
              <select
                className="settings-select"
                value={api}
                onChange={(event) => setApi(event.target.value as CustomProviderConfig["api"])}
              >
                {API_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>

            <label className="custom-provider-label">
              <span>API key</span>
              <input
                className="settings-search"
                placeholder="Enter API key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>

            {error ? <p className="extension-dialog__body settings-warning">{error}</p> : null}

            <div className="extension-dialog__actions">
              <button className="button button--secondary" disabled={pending} type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="button"
                disabled={!canProceed}
                type="button"
                onClick={() => setStep("models")}
              >
                Next: Choose models
              </button>
            </div>
          </>
        ) : null}

        {/* Step 2: Model selection */}
        {step === "models" ? (
          <>
            <div className="extension-dialog__title">Choose models for {displayName || providerId}</div>
            <p className="extension-dialog__body">
              Auto-discover models from the API, or add them manually. Select which ones to enable.
            </p>

            <div className="custom-provider-model-actions">
              <button
                className="button button--secondary"
                disabled={discovering}
                type="button"
                onClick={() => void handleDiscoverModels()}
              >
                {discovering ? "Discovering..." : "Auto-discover models"}
              </button>
            </div>

            {discoveryError ? (
              <p className="extension-dialog__body settings-hint">{discoveryError}</p>
            ) : null}

            {discoveredModels.length > 0 ? (
              <div className="custom-provider-model-list">
                {discoveredModels.map((model, index) => (
                  <label className="settings-toggle settings-toggle--row" key={model.id}>
                    <input
                      checked={model.selected}
                      type="checkbox"
                      onChange={() => handleToggleModel(index)}
                    />
                    <span>
                      <strong>{model.id}</strong>
                      {model.name !== model.id ? <span className="settings-list__meta"> · {model.name}</span> : null}
                    </span>
                  </label>
                ))}
              </div>
            ) : null}

            <div className="custom-provider-model-actions">
              <input
                className="settings-search"
                placeholder="Add model ID manually"
                value={manualModelId}
                onChange={(event) => setManualModelId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddManualModel();
                  }
                }}
              />
              <button
                className="button button--secondary"
                disabled={!manualModelId.trim()}
                type="button"
                onClick={handleAddManualModel}
              >
                Add
              </button>
            </div>

            {error ? <p className="extension-dialog__body settings-warning">{error}</p> : null}

            <div className="extension-dialog__actions">
              <button
                className="button button--secondary"
                disabled={pending}
                type="button"
                onClick={() => setStep("config")}
              >
                Back
              </button>
              <button className="button button--secondary" disabled={pending} type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="button"
                disabled={pending || discoveredModels.filter((m) => m.selected).length === 0}
                type="button"
                onClick={() => void handleSave()}
              >
                {pending ? "Saving..." : "Save provider"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
