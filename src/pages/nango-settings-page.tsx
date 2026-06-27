import { saveNangoConnectionAction } from "../actions";
import { getNangoSettings } from "../nango";
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { LinkIcon } from "lucide-react";
import { Input } from "../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { Field, FieldDescription, FieldLabel } from "../components/ui/field";
import { Label } from "../components/ui/label";
import { Link } from "../components/ui/link";

type SettingsNangoPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
  redirectTo?: string;
};

function pickSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

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

function getDefaultServerUrl(settingsServerUrl?: string) {
  if (settingsServerUrl?.trim()) {
    return settingsServerUrl;
  }
  if (process.env.NANGO_SERVER_URL?.trim()) {
    return process.env.NANGO_SERVER_URL;
  }
  if (process.env.CINATRA_RUNTIME_MODE === "development" || process.env.NODE_ENV !== "production") {
    return "http://localhost:3003";
  }
  return "";
}

async function checkNangoConnection({
  secretKey,
  serverUrl,
}: {
  secretKey?: string;
  serverUrl: string;
}): Promise<{ status: "connected" | "not_connected" | "error"; label: string; detail: string }> {
  if (!secretKey?.trim()) {
    return {
      status: "not_connected",
      label: "Not configured",
      detail: "Add a secret key to enable API and OAuth connections.",
    };
  }

  const baseUrl = serverUrl.trim() || "https://api.nango.dev";
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/integrations`, {
      headers: { Authorization: `Bearer ${secretKey.trim()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    if (response.ok) {
      return {
        status: "connected",
        label: "Connected",
        detail: "Secret key accepted by the connection service.",
      };
    }

    return {
      status: "error",
      label: "Check failed",
      detail: `Connection service responded with HTTP ${response.status}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reach the connection service.";
    return {
      status: "error",
      label: "Check failed",
      detail: message,
    };
  }
}

export async function NangoSettingsSection({ searchParams, redirectTo = "/configuration/environment?tab=connections" }: SettingsNangoPageProps) {
  const resolvedSearchParams: Record<string, string | string[] | undefined> =
    await (searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>));
  const settings = getNangoSettings();
  const dashboardUrl = normalizeDashboardUrl(settings.serverUrl);
  const errorMessage = pickSearchParam(resolvedSearchParams.error);
  const saved = pickSearchParam(resolvedSearchParams.saved) === "1";
  const serverUrlDefault = getDefaultServerUrl(settings.serverUrl);
  const status = await checkNangoConnection({
    secretKey: settings.secretKey,
    serverUrl: serverUrlDefault,
  });

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Alert
        variant={status.status === "connected" ? "success" : status.status === "error" ? "destructive" : "default"}
        className="rounded-panel"
      >
        <AlertTitle>{status.label}</AlertTitle>
        <AlertDescription>{status.detail}</AlertDescription>
      </Alert>

      {errorMessage ? (
        <div className="rounded-control border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{errorMessage}</div>
      ) : null}

      {saved ? (
        <div className="rounded-control border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          Nango administration were saved.
        </div>
      ) : null}

      <Card className="border-line bg-surface backdrop-blur-none rounded-card">
        <CardContent className="p-6">
          <form action={saveNangoConnectionAction} className="grid gap-4">
            <Input type="hidden" name="redirectTo" value={redirectTo} />
            <p className="text-sm leading-6 text-muted-foreground">
              Configure the shared connection service Cinatra uses to store and reuse external API credentials and OAuth
              connections.
            </p>
            <Label className="grid gap-2">
              Secret key
              <Input
                name="secretKey"
                type="password"
                defaultValue={process.env.NANGO_SECRET_KEY ? "" : (settings.secretKey ?? "")}
                required={!process.env.NANGO_SECRET_KEY && !settings.secretKey}
              />
              {process.env.NANGO_SECRET_KEY || settings.secretKey ? (
                <span className="text-xs font-normal text-muted-foreground">Leave blank to keep the current saved key.</span>
              ) : null}
            </Label>
            <Field>
              <FieldLabel>Server URL</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <LinkIcon aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  name="serverUrl"
                  type="url"
                  defaultValue={process.env.NANGO_SERVER_URL ? "" : serverUrlDefault}
                  placeholder="http://localhost:3003"
                />
              </InputGroup>
              <FieldDescription>
                Local development defaults to the local Nango server.
              </FieldDescription>
            </Field>
            <div className="flex flex-wrap gap-3">
              {dashboardUrl ? (
                <Button asChild variant="outline">
                  <Link href={dashboardUrl} target="_blank" rel="noreferrer">Open dashboard</Link>
                </Button>
              ) : null}
              <Button type="submit">Save credentials</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export async function NangoSettingsPage({ searchParams }: SettingsNangoPageProps) {
  return (
    <main className="min-h-screen px-5 py-8 sm:px-8 lg:px-6 lg:py-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <NangoSettingsSection searchParams={searchParams} redirectTo="/configuration/environment?tab=connections" />
      </div>
    </main>
  );
}
