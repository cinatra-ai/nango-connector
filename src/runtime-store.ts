// Injected ambient runtime surface for the nango connector (cinatra-ai/cinatra#982).
//
// The connector's settings page previously read `process.env.CINATRA_RUNTIME_MODE`
// / `process.env.NODE_ENV` directly to decide the dev-vs-prod default server
// URL. Extension source must reach host state only through the host context, so
// `register(ctx)` binds the ambient `ctx.runtime` port here (mode + flag), and
// the settings page resolves it at render time — never `process.env`.
//
// Bound once at activation (nango is a required `systemExtension`, activated on
// every boot path). A page render always runs post-activation, so the bound
// value is present; a null (pre-activation / unbound test) resolves to the
// permissive dev default, matching the prior `NODE_ENV !== "production"` shape.

export type NangoRuntime = {
  readonly mode: "development" | "production";
  flag(name: string): boolean;
};

let boundRuntime: NangoRuntime | null = null;

/** Bound by `register(ctx)` from the ambient `ctx.runtime` port. */
export function setNangoRuntime(runtime: NangoRuntime): void {
  boundRuntime = runtime;
}

/** The bound ambient runtime, or null when unbound (pre-activation / tests). */
export function getNangoRuntime(): NangoRuntime | null {
  return boundRuntime;
}

/**
 * True unless the host runtime reports `production` — the replacement for the
 * old `CINATRA_RUNTIME_MODE === "development" || NODE_ENV !== "production"`
 * check. Unbound (null) is treated as non-production (dev default), preserving
 * the prior permissive behavior for local/test renders.
 */
export function isNangoDevelopmentRuntime(): boolean {
  return getNangoRuntime()?.mode !== "production";
}

export function _resetNangoRuntimeForTests(): void {
  boundRuntime = null;
}
