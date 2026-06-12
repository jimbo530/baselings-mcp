# baselings-mcp

**Your AI agent earns yield on Base chain. 49 tools. No API key. $0.10 safety cap.**

```
npx baselings-mcp
```

MCP server for AI agents — guardrailed DeFi swaps, token launches with permanently locked liquidity, autonomous reactor burns, and a yield-generating pet game. Every action burns MfT supply.

## Your agent earns real money

- **Power plant workers** burn POOP + meme tokens → yield **USDC, ETH, or BTC** (your choice)
- **Garden workers** turn POOP into LP positions — deepening liquidity permanently
- V2 LP fees auto-compound in the vault, growing LP value and increasing POOP mint rate over time
- ~1 POOP earned per penny spent on food — POOP flows through gardens and power plant

**How it works:**
| Step | What happens |
|------|-------------|
| Buy food | Spend USDC on food (LP tokens) — $0.01 per meal |
| Feed pet | LP locks in baseling vault forever, you earn ~1 POOP per penny spent |
| Use POOP | Deposit to gardens (earn food/tokens) or power plant (burn for yield) |
| Workers | Assign baselings to jobs — keeper auto-harvests every 2.4 hours |

**Impact bonus** (free PR, same pipeline): CHAR connects burns toward carbon retirement. TGN funds environmental projects. BURGERS feeds people IRL.

## Why buy MfT

MfT (MemeForTrees) is **deflationary**. Every game action burns MfT supply:

- Buying food → buys MfT for LP (permanently locked)
- Feeding pets → mints POOP → gardens sell POOP for MfT → burn
- NFT purchases → 1% MfT buy + burn
- 6 headless V3 burn machines run 24/7 on WETH, USDC, cbBTC

More players = more burns = less supply. Play the game, earn yield, AND hold the asset whose supply every action reduces.

## Security model — thin pipe over forever vaults

The game wallet is a **hot relay**, not a safe. Keep it lean.

- **Vault LP is immutable.** Once deposited into a baseling, LP is locked in the NFT contract forever. No admin key can touch it. V2 LP fees auto-compound, growing LP value and increasing POOP mint rate over time.
- **NFTs belong in your main wallet.** The baseling NFT IS the vault. Whoever holds it owns the stacked yield. Transfer NFTs out of the game wallet.
- **Yields go to main wallet.** Blue chip yields (USDC/ETH/BTC) from the power plant route to your main wallet, not the game wallet.
- **Game server is centralized.** A breach could lose in-game POOP or pending claims. It cannot touch your vault LP, your NFTs, or your blue chip yields.
- **Recommendation:** Dedicated game wallet, small USDC balance, sweep yields and NFTs to main wallet regularly. The game is a thin pipe — your vaults and wallet are the safe.

## Quick start — MCP server

```bash
# Game wallet (optional — omit for read-only mode)
export GAME_WALLET_KEY=0x...

# Trade wallet for swaps (optional — omit for quote-only mode)
export TRADE_WALLET_KEY=0x...

# Run the MCP server (stdin/stdout JSON-RPC)
npx baselings-mcp
```

> **v1.1.0**: Adds `swap_token`, `swap_quote`, `swap_status` tools. Swap guardrails enforced: $0.10 max, 60s cooldown.
>
> **v1.2.0**: Adds `reactor_timing`, `portfolio_value`, `mft_price`, `get_reactor_list`, `arb_signal`, `liquidity_depth`. Expanded swap allowlist. DCA automation.
>
> **v1.4.0**: Launch tools renamed to `unrugable_*` (old `mycopad_*` names kept as deprecated aliases). Dead discovery endpoints pruned; live endpoints documented.

### Claude Desktop / Claude Code config

```json
{
  "mcpServers": {
    "baselings": {
      "command": "npx",
      "args": ["baselings-mcp"],
      "env": {
        "GAME_WALLET_KEY": "0x...",
        "TRADE_WALLET_KEY": "0x..."
      }
    }
  }
}
```

## Configuration

All configuration is via environment variables. Both keys are optional — with neither set, the server starts in read-only mode and every read tool works.

| Variable | Required | Purpose |
|----------|----------|---------|
| `GAME_WALLET_KEY` | No | Base-chain private key used for game write actions (buy/feed/claim/assign, etc.). Without it, write tools return a clear "read-only mode" error instead of failing silently. `AGENT_TEST_KEY` is accepted as a fallback name. |
| `TRADE_WALLET_KEY` | No | Separate private key used only for `swap_token` execution. Quotes (`swap_quote`, `swap_status`) work without it. Keep this wallet separate from the game wallet. `TRADE_PRIVATE_KEY` is accepted as a fallback name. |
| `BASELING_API_URL` | No | Override the REST base URL. Defaults to `https://tasern.quest/api/baseling`. |

No API key, sign-up, or account is needed for read tools. The server speaks MCP over stdio (JSON-RPC on stdin/stdout) and requires Node.js 18+.

## Agent discovery endpoints (no auth)

| Endpoint | What it returns |
|----------|----------------|
| [`/api/unrugable/tokenomics`](https://tasern.quest/api/unrugable/tokenomics) | Network data: infrastructure tokens, strategies, contracts |
| [`/api/unrugable/all`](https://tasern.quest/api/unrugable/all) | Full combined network dataset |
| [`/llms.txt`](https://tasern.quest/llms.txt) | AI-readable full documentation |
| [`/.well-known/agents.json`](https://tasern.quest/.well-known/agents.json) | Machine-readable capability manifest |

## Token swap tools (NEW in v1.1.0)

Guardrailed Uniswap V3 swaps on Base:

```
swap_status  → Check cooldown, daily spend, allowed tokens
swap_quote   → Get price quote (read-only, no execution)
swap_token   → Execute swap ($0.10 max, 60s cooldown)
```

**Safety limits (non-negotiable):**
- Max per swap: $0.10
- Min cooldown: 60 seconds
- Max daily: $5.00 per wallet
- Allowlisted tokens only (17 tokens including MfT, USDC, WETH, cbBTC, POOP, CHAR, EARTH, and more)
- Exact approvals (never unlimited)
- Separate TRADE_WALLET_KEY (game wallet cannot swap)

## Quick start — SDK

```javascript
const baselings = require('baselings-mcp');

const ctx = baselings.createContext(process.env.GAME_WALLET_KEY);

// Read state
const balances = await baselings.state.getBalances(ctx);
const pets = await baselings.state.getMyBaselings(ctx);

// Strategy playbooks
const strats = baselings.strategies.listStrategies();
// → green (impact), meme, bluechip, broad, custom

// Take actions
await baselings.actions.buyEgg(ctx, 'random');
await baselings.actions.feedBaseling(ctx, tokenId, 'burgers', amount);
await baselings.actions.claimPoop(ctx, [tokenId]);
```

## REST API (no wallet needed for reads)

Live at `https://tasern.quest/api/baseling/agent/`

| Endpoint | Description |
|----------|-------------|
| `GET /agent/guide` | Game overview + all endpoints |
| `GET /agent/status/:wallet` | Balances + baseling summary |
| `GET /agent/baselings/:wallet` | All owned baselings |
| `GET /agent/baseling/:tokenId` | On-chain baseling state |
| `GET /agent/food/:wallet` | Food stock in cupboard |
| `GET /agent/gardens` | All garden pool statuses |
| `GET /agent/assignments/:wallet` | Worker assignments |
| `GET /agent/houses/:wallet` | Owned houses |
| `GET /agent/poop/:wallet` | Pending POOP to claim |
| `GET /agent/prices` | Current egg prices |
| `GET /agent/stats` | Global game statistics |
| `GET /agent/tokenomics/flywheel` | MfT burn engine model |
| `GET /agent/tokenomics/metrics` | Live on-chain metrics |
| `GET /agent/tokenomics/pitch` | Why buy MfT |
| `GET /agent/economy/rules` | Economy constraints + build order |
| `GET /agent/economy/feeding/:job` | What food to feed for a target job |
| `GET /agent/economy/phase/:wallet` | Current economy build phase |

## MCP tools (49 tools)

**Read** (10): `get_balances`, `get_my_baselings`, `get_baseling`, `get_food_stock`, `get_garden_status`, `get_assignments`, `get_houses`, `get_pending_poop`, `get_egg_prices`, `get_global_stats`

**Write** (14): `buy_egg`, `hatch_egg`, `buy_food`, `feed_baseling`, `claim_poop`, `assign_worker`, `unassign_worker`, `deposit_garden`, `buy_house`, `assign_to_house`, `freeze_baseling`, `unfreeze_baseling`, `resurrect_baseling`, `ensure_approvals`

**Strategy** (3): `welcome`, `choose_strategy`, `next_actions`

**Tokenomics** (3): `mft_flywheel`, `tokenomics_metrics`, `why_mft`

**Economy** (3): `build_phase`, `feeding_guide`, `economy_rules`

**Info** (1): `game_guide`

**Unrugable Launch** (5): `unrugable_info`, `unrugable_launch`, `unrugable_check_reactor`, `unrugable_recent`, `unrugable_invite_link` — launch a token paired into permanently locked Uniswap V3 liquidity and wired to a reactor that burns and compounds fees. (The former `mycopad_*` names still work as deprecated aliases so existing callers don't break.)

**Reactor** (3): `fire_reactor`, `get_reactor_list`, `reactor_timing` — permissionless execute() on any reactor, triggers burn+compound cascade; list all reactors with fire-readiness; predict fire windows and Prime imminence

**Swap** (4): `swap_status`, `swap_quote`, `swap_token`, `arb_signal`

**Price** (1): `mft_price` — current MfT/USD price via Uniswap V3 Quoter (read-only)

**Portfolio** (1): `portfolio_value` — total holdings in USD across all 17 allowed tokens (read-only)

**Depth** (1): `liquidity_depth` — measure V3 pool depth in USD before X% impact; health classification (deep/thin/dry); max profitable trade sizing (read-only)

## Strategy playbooks

Pick a school of thought at the door:

| Strategy | Focus | Food families |
|----------|-------|---------------|
| **green** | Impact assets, carbon credits | TGN, BURGERS, CHAR |
| **meme** | Meme token yield | BRETT, BUSTER, BURGERS |
| **bluechip** | Blue chip pairs | WETH, cbBTC |
| **broad** | Balanced (50% impact, 25% blue, 25% meme) | All |
| **custom** | Agent decides | Agent picks |

## Token addresses (Base chain)

- **MfT**: `0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3`
- **POOP**: `0x126555aecBAC290b25644e4b7f29c016aE95f4dc`
- **BaselingNFT**: `0xFCb825491490284189C75fD330Fd08Df5E9217b9`

## ElizaOS integration (zero custom code)

ElizaOS agents can use all 49 tools via the Fleek MCP plugin:

```bash
npm install @fleek-platform/eliza-plugin-mcp
```

In your character config:
```json
{
  "plugins": ["@fleek-platform/eliza-plugin-mcp"],
  "settings": {
    "mcp": {
      "servers": {
        "baselings": {
          "type": "stdio",
          "command": "npx",
          "args": ["baselings-mcp"],
          "env": {
            "GAME_WALLET_KEY": "0x...",
            "TRADE_WALLET_KEY": "0x..."
          }
        }
      }
    }
  }
}
```

All 49 tools become native ElizaOS actions automatically.

## Links

- Game: https://tasern.quest/baseling
- API: https://tasern.quest/api/baseling/agent/guide
- Tokenomics: https://tasern.quest/api/unrugable/tokenomics
- llms.txt: https://tasern.quest/llms.txt
- Chain: Base (8453)
- npm: https://www.npmjs.com/package/baselings-mcp
