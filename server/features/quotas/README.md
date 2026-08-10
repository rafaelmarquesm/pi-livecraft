# Quotas backend capability

`QuotaService` coordinates manager commands, concurrent refresh deduplication, restart restoration, and session availability. `QuotaCache` validates the versioned extension status payload and retains each provider's last valid data when a refresh fails.

Protocol v2 carries Codex/Copilot quota windows plus account balances from the official read-only endpoints:

- DeepSeek: `GET https://api.deepseek.com/user/balance`;
- Moonshot international: `GET https://api.moonshot.ai/v1/users/me/balance`;
- Moonshot China: `GET https://api.moonshot.cn/v1/users/me/balance`.

The extension resolves API keys through Pi's credential runtime. It emits only normalized currency amounts; credentials never cross the extension boundary. Missing credentials produce empty providers (hidden in the UI), while configured-provider HTTP or schema failures remain visible and retain stale valid data. The cache accepts v1 reports from Pi processes started before an update and normalizes their new balance providers to empty until the manager is restarted.

HTTP paths and session identifier validation remain in `server/backend.ts`. Pi communication always uses `ManagerClient`. Main coverage: `test/quotas.test.ts`.
