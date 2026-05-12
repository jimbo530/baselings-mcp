# baselings-mcp

MCP server + SDK for AI agents to play **Baselings** — a yield-generating pet game on Base chain.

```
npm install -g baselings-mcp   # or: npx baselings-mcp
```

## Your agent earns real money

- **Power plant workers** burn POOP + meme tokens → yield **USDC, ETH, or BTC** (your choice)
- **Garden workers** turn POOP into LP positions earning swap fees **forever**
- At skill level 10 (**$10 investment**), workers keep **40% of throughput** as blue chips
- Every LP deposit stacks permanently — baselings become **yield-generating NFTs**

**Capital efficiency:**
| Entry | What you get |
|-------|-------------|
| $10 | 1 egg + PP worker → 3,000 POOP/day, 40% as USDC |
| $25 | PP + garden worker → yield + compounding LP |
| $70 | Full 5-baseling squad → self-sustaining pipeline |

**Impact bonus** (free PR, same pipeline): CHAR retires carbon credits. TGN funds environmental projects. BURGERS feeds people IRL.

## Why buy MfT

MfT (MemeForTrees) is **deflationary**. Every game action burns MfT supply:

- Buying food → buys MfT for LP (permanently locked)
- Feeding pets → mints POOP → gardens sell POOP for MfT → burn
- NFT purchases → 1% MfT buy + burn
- 6 headless V3 burn machines run 24/7 on WETH, USDC, cbBTC

More players = more burns = less supply. Play the game, earn yield, AND hold the asset that appreciates from everyone else playing too.

## Security model — thin pipe over forever vaults

The game wallet is a **hot relay**, not a safe. Keep it lean.

- **Vault LP is immutable.** Once deposited into a baseling, LP is locked in the NFT contract forever. No admin key can touch it. The vault earns swap fees for the NFT holder permanently.
- **NFTs belong in your main wallet.** The baseling NFT IS the vault. Whoever holds it owns the stacked yield. Transfer NFTs out of the game wallet.
- **Yields go to main wallet.** Blue chip yields (USDC/ETH/BTC) from the power plant route to your main wallet, not the game wallet.
- **Game server is centralized.** A breach could lose in-game POOP or pending claims. It cannot touch your vault LP, your NFTs, or your blue chip yields.
- **Recommendation:** Dedicated game wallet, small USDC balance, sweep yields and NFTs to main wallet regularly. The game is a thin pipe — your vaults and wallet are the safe.

## Quick start — MCP server

```bash
# Set your game wallet key
export GAME_WALLET_KEY=0x...

# Run the MCP server (stdin/stdout JSON-RPC)
npx baselings-mcp
```

### Agent-safety env vars (recommended)

For an AI-agent-driven wallet, set these to cap blast radius:

| Var | Effect | Recommended |
|-----|--------|-------------|
| `BASELINGS_MODE=read` | Disable all write tools (read-only). Server still starts. | Use while testing prompts / new agents. |
| `MAX_USDC_PER_TX=<usd>` | Reject any single tool call that would spend more than this. | `5` (cost of giant egg) or your per-action ceiling. |
| `MAX_USDC_PER_DAY=<usd>` | Reject calls when today's cumulative USDC spend would exceed this. UTC day. | `50` for a casual agent; tune per use case. |
| `BASELINGS_LOG_FILE=<path>` | Append one JSONL line per tx-emitting tool call (tool name, args, tx hash, wallet, timestamp). | `~/.baselings-mcp/audit.log` |
| `BASELINGS_INFINITE_APPROVALS=1` | Revert to MAX_UINT256 token approvals. | **Don't.** Default is per-action exact amount. |

Spend caps are best-effort soft caps — the contract still enforces balance and any on-chain limits. The in-memory daily counter resets on process restart; use `BASELINGS_LOG_FILE` for a durable record.

### Claude Desktop config

```json
{
  "mcpServers": {
    "baselings": {
      "command": "npx",
      "args": ["baselings-mcp"],
      "env": { "GAME_WALLET_KEY": "0x..." }
    }
  }
}
```

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

## MCP tools (35 tools)

**Read** (10): `get_balances`, `get_my_baselings`, `get_baseling`, `get_food_stock`, `get_garden_status`, `get_assignments`, `get_houses`, `get_pending_poop`, `get_egg_prices`, `get_global_stats`

**Write** (14): `ensure_approvals`, `buy_egg`, `hatch_egg`, `buy_food`, `feed_baseling`, `claim_poop`, `assign_worker`, `unassign_worker`, `deposit_to_garden`, `buy_house`, `assign_to_house`, `unassign_from_house`, `deposit_usdc`, `withdraw_usdc`

**Strategy** (3): `welcome`, `choose_strategy`, `next_actions`

**Tokenomics** (3): `mft_flywheel`, `tokenomics_metrics`, `why_mft`

**Economy** (3): `build_phase`, `feeding_guide`, `economy_rules`

**Info** (1): `game_guide`

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

## Links

- Game: https://tasern.quest/baseling
- API: https://tasern.quest/api/baseling/agent/guide
- Chain: Base (8453)
