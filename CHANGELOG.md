# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.1.7
- Nango configuration now flows from the host: the secret key, server URL, and connect URL are declared as manifest environment-overrides and are no longer read from the process environment directly; the host applies manifest-sourced override precedence on the connector-config capability.
- Settings-page server-URL and runtime-mode reads come from the connector runtime context.
- Requires Cinatra 0.1.7. Note: this version is inert in the base Cinatra 0.1.7 install — the app's required-extension lock at release time still pins 0.1.6; the environment-override behavior activates once the host's post-release lock bump pins this version.

## 0.1.6
- Final connection access-scoping declaration: access is fixed to admin-only (cinatra#954).
- Declared the extension-dependency closure (`cinatra.consumes`) for closure-gate enrollment and added the connector display-name metadata.
- Release workflow pinned to the gated reusable extension-release flow (release-approval wall). No change to connector behavior.

## 0.1.5
- Declared the connector's supported Cinatra SDK ABI range in the manifest so the in-instance compatibility badge reads Compatible on a current host.
- Removed stale internal tracker references from workflow comments. No change to connector behavior.
