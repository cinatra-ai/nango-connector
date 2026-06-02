import Link from "next/link";
import { getNangoSettings, getNangoStatus } from "./nango";

function normalizeDashboardUrl(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function NangoOperationsCard() {
  const settings = getNangoSettings();
  const status = getNangoStatus();
  const dashboardUrl = normalizeDashboardUrl(settings.serverUrl);

  return (
    <div className="soft-panel rounded-panel px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
              <p className="text-lg font-semibold text-foreground">Nango</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Open the connection service dashboard to inspect integrations, connections, and environment settings.
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {dashboardUrl ? `Dashboard URL: ${dashboardUrl}` : "Save the connection service URL in LLM first."}
          </p>
        </div>
        <span className="badge rounded-full px-3 py-1 text-xs uppercase">
          {status.status === "connected" ? "Connected" : "Setup required"}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {dashboardUrl ? (
          <Link
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-control bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-surface-strong hover:text-foreground"
          >
            Open dashboard
          </Link>
        ) : (
          <Link
            href="/configuration/environment?tab=connections"
            className="inline-flex items-center justify-center rounded-control border border-line bg-surface-strong px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-surface-muted"
          >
            Configure Nango
          </Link>
        )}
      </div>
    </div>
  );
}
