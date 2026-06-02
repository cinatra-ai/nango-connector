export * from "./nango";
export * from "./nango-connectors";
// Surface the relocated `requireExtensionAction`-gated connection action on the
// package's public index so the host's already-baselined `@/lib/nango` (`export *`)
// shim re-exports it WITHOUT core(src/) ever naming this extension directly
// (IoC doctrine: combine host->connector through the single index entry).
export { saveNangoConnectionAction } from "./actions";
export * from "./nango-connect-ui";
// The Nango connect UI primitives moved to `@cinatra-ai/sdk-ui/nango`.
// Re-exported by name here for back-compat (NOT `export *` — that would
// collide with this package's own `NangoFrontendConfig` type from `./nango`).
export { NangoUserConnectButton, NangoUserConnectCard, NangoManagedApiCard } from "@cinatra-ai/sdk-ui/nango";
export * from "./nango-operations-card";
export * from "./route-handlers";
export * from "./first-party-mcp";
