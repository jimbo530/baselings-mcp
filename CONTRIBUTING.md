# Contributing

Thanks for wanting to contribute! This is a small project — keep things friendly, keep PRs focused, and we'll get along great.

## Reporting issues

- **Bugs / questions / feature ideas:** open a [GitHub issue](https://github.com/jimbo530/baselings-mcp/issues).
- **Security findings:** _don't_ open a public issue — see [SECURITY.md](./SECURITY.md).

## Quick start

```bash
npm install
npm test                # smoke test the MCP surface (no funds required)
# To run the server against a real wallet:
GAME_WALLET_KEY=0x... node mcp-server.js
```

CI runs `npm test` on every PR. If you change the tool set in `mcp-server.js`, update `EXPECTED_TOOLS` in `test/smoke.test.js`.

## Pull requests

- One concern per PR. A focused 20-line change is easier to merge than a sprawling one.
- Link the issue (`Resolves #N` or `Refs #N`) in the PR body when relevant.
- Keep diffs reviewable: no drive-by reformatting or renames in a feature PR.
- New files should match the existing style in the repo.

## Style

- This project is MIT licensed. Contributions are accepted under the same license.
- Be kind in reviews and replies. Assume good intent.

## Maintainer

[`@jimbo530`](https://github.com/jimbo530) — [memefortrees.base.eth](https://memefortrees.com) — Carbon Counting Club, Meadville PA.