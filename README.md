# Connection Service

Cinatra's centralized credential vault, built on [Nango](https://www.nango.dev). Stores access tokens and API keys for every connector in one place, runs OAuth sign-in flows through a single hosted UI, and hands out live credentials at run time so individual connectors never manage their own token refresh. Full documentation lives in the Integrations hub at https://docs.cinatra.ai/integrations/nango/

## Works with

- Gmail
- Google Calendar
- YouTube
- GitHub
- LinkedIn
- Apollo
- Apify
- Anthropic
- OpenAI
- WordPress
- Drupal
- Tailscale

## Capabilities

- Store every connector's credentials in one centralized vault
- Run OAuth sign-in flows for every supported integration through a single hosted UI
- Refresh tokens automatically so connectors stay live without manual reconnect
- Hand out live bearer tokens to first-party connectors at run time via `buildBearerAuthHeaderFromNango`
- Maintain a local pointer index so the host can list connected accounts without a live Nango round-trip
- Disconnect a saved account in one place when access should be revoked
