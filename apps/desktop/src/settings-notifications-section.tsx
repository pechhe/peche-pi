import type { DesktopNotificationPermissionStatus } from "./ipc";
import type { NotificationPreferences } from "./desktop-state";
import { SettingsGroup, SettingsRow } from "./settings-utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { playButtonClick } from "./button-click-sound";

interface SettingsNotificationsSectionProps {
  readonly notificationPreferences: NotificationPreferences;
  readonly notificationPermissionStatus: DesktopNotificationPermissionStatus;
  readonly notificationPermissionPending: boolean;
  readonly onSetNotificationPreferences: (preferences: Partial<NotificationPreferences>) => void;
  readonly onRequestNotificationPermission: () => void;
  readonly onOpenSystemNotificationSettings: () => void;
}

export function SettingsNotificationsSection({
  notificationPreferences,
  notificationPermissionStatus,
  notificationPermissionPending,
  onSetNotificationPreferences,
  onRequestNotificationPermission,
  onOpenSystemNotificationSettings,
}: SettingsNotificationsSectionProps) {
  const statusLabel = labelForPermissionStatus(notificationPermissionStatus);
  const statusDescription = descriptionForPermissionStatus(notificationPermissionStatus);
  const showAskMacOs = notificationPermissionStatus === "default";
  const showOpenSystemSettings = notificationPermissionStatus === "denied";
  const showRecoveryActions = showAskMacOs || showOpenSystemSettings;

  return (
    <>
      <SettingsGroup title="System" description="macOS decides whether pi-gui can show desktop notifications at all.">
        <SettingsRow title="macOS notification access" description={statusDescription}>
          <span className="settings-row__value text-[13px] font-medium text-muted-foreground">{statusLabel}</span>
        </SettingsRow>
        {showRecoveryActions ? (
          <SettingsRow
            title="Turn on notifications"
            description={
              showAskMacOs
                ? "pi-gui asks macOS when active work first moves into the background. You can also ask now."
                : "macOS notifications are already turned off for pi-gui. Open System Settings to enable them again."
            }
          >
            <div className="settings-row__actions">
              {showAskMacOs ? (
                <Button
                  disabled={notificationPermissionPending}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => { playButtonClick(); onRequestNotificationPermission(); }}
                >
                  Ask macOS
                </Button>
              ) : null}
              {showOpenSystemSettings ? (
                <Button
                  disabled={notificationPermissionPending}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => { playButtonClick(); onOpenSystemNotificationSettings(); }}
                >
                  Open System Settings
                </Button>
              ) : null}
            </div>
          </SettingsRow>
        ) : null}
      </SettingsGroup>

      <SettingsGroup title="In-app alerts" description="Choose which background events should try to notify once macOS access is enabled.">
        <SettingsRow title="Background completion" description="Notify when a background session finishes.">
          <Switch
            aria-label="Background completion"
            checked={notificationPreferences.backgroundCompletion}
            onCheckedChange={(checked) => onSetNotificationPreferences({ backgroundCompletion: checked })}
          />
        </SettingsRow>
        <SettingsRow title="Background failures" description="Notify when a background session fails.">
          <Switch
            aria-label="Background failures"
            checked={notificationPreferences.backgroundFailure}
            onCheckedChange={(checked) => onSetNotificationPreferences({ backgroundFailure: checked })}
          />
        </SettingsRow>
        <SettingsRow title="Needs input or approval" description="Notify when input is needed to continue.">
          <Switch
            aria-label="Needs input or approval"
            checked={notificationPreferences.attentionNeeded}
            onCheckedChange={(checked) => onSetNotificationPreferences({ attentionNeeded: checked })}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}

function labelForPermissionStatus(status: DesktopNotificationPermissionStatus): string {
  switch (status) {
    case "granted":
      return "Enabled";
    case "denied":
      return "Turned off";
    case "default":
      return "Not enabled yet";
    case "unsupported":
      return "Unavailable";
    default:
      return "Checking…";
  }
}

function descriptionForPermissionStatus(status: DesktopNotificationPermissionStatus): string {
  switch (status) {
    case "granted":
      return "macOS will allow pi-gui to show desktop notifications for background thread updates.";
    case "denied":
      return "macOS notifications are turned off for pi-gui. Enable them in System Settings to receive background completion alerts.";
    case "default":
      return "pi-gui has not asked macOS for desktop notification access yet.";
    case "unsupported":
      return "Desktop notifications are unavailable on this system.";
    default:
      return "Checking whether macOS notifications are available for pi-gui.";
  }
}
