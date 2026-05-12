# Security Policy

This MCP server hands an AI agent a live hot wallet (`GAME_WALLET_KEY`) that can sign transactions on Base mainnet. Vulnerabilities can result in real funds being drained from operators of this software. Please disclose privately.

## Reporting a Vulnerability

**Preferred:** [GitHub Private Vulnerability Reporting](https://github.com/jimbo530/baselings-mcp/security/advisories/new) — opens a private advisory thread.

**Fallback:** _Add a contact email here (e.g. `security@carbon-counting-club.com` or DM `@memefortrees.base.eth`)._

### Please include

- Affected file/function and line numbers
- Attack scenario: who runs the server, what input triggers the issue, what the agent ends up doing
- Whether the issue is a prompt-injection vector, an over-permissive approval, an auth bypass, etc.
- Reproduction steps if possible

### What to expect

- Acknowledgement within 72 hours
- Severity triage within 7 days
- Coordinated disclosure once a fix is shipped to `main`

## Scope

**In scope:**

- `mcp-server.js` — tool dispatch and JSON-RPC handling
- `actions.js` — every write tool that signs a transaction
- `state.js` — read endpoints (if they leak something they shouldn't)
- `api-routes.js` — HTTP surface including `verifyWallet` (when wired up)
- `contracts.js` — contract address constants and ABIs

**Out of scope:**

- Issues in `ethers` or other npm dependencies (file with the upstream)
- Issues in the underlying Baselings game contracts (separate repo / address space)
- Issues that require physical access to the operator's machine
- Issues that depend on the operator pasting a malicious private key

## High-leverage areas for review

- Any path that calls `tx = await contracts.X.method(...); await waitForTx(tx)` from a tool-dispatch handler — these spend funds
- Token approvals in `ensureApprovals` (currently MAX_UINT256 to multiple contracts)
- The signed-message flow in `verifyWallet` (currently nonce-less; planned for future writes)

## Security-relevant operator practices

Recommended for anyone running this server:

- Use a hot wallet funded only with what you'd lose in a worst case
- Set spending caps via env vars if you've added that feature locally
- Run with `BASELINGS_MODE=read` in development
- Log every transaction to an append-only file

Thank you for helping keep baselings-mcp safe.
