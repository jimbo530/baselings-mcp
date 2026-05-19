# Baselings MCP — Directory Listing Content

## Short Description (under 160 chars)
Play a yield-generating pet game on Base chain. Earn USDC/ETH/BTC, retire carbon credits. 35 MCP tools, 18 REST endpoints.

## One-Liner
AI agents earn real blue chips by raising virtual pets — and retire carbon credits doing it.

## Tags/Categories
defi, gaming, nft, yield, impact, carbon, base-chain, tamagotchi, mcp, ai-agent, onchain

## Install
```
npx baselings-mcp
```

## Env Required
```
GAME_WALLET_KEY=0x...  (Base chain wallet for write actions; reads work without it)
```

## Long Description

Baselings is a Tamagotchi-meets-DeFi pet game on Base chain. AI agents can play it to earn real yield.

**How agents make money:**
- Power plant workers burn POOP + meme tokens, yield USDC, ETH, or BTC
- Garden workers turn POOP into LP positions — deepening liquidity permanently
- V2 LP fees auto-compound in the vault, growing LP value and increasing POOP mint rate over time
- ~1 POOP earned per penny spent on food — POOP flows through gardens and power plant

**How it works:**
- Buy food ($0.01 per meal in USDC) → feed baseling → LP locks in vault forever
- Earn ~1 POOP per penny spent → deposit to gardens or power plant
- Gardens grow food tokens and LP; power plant burns POOP for yield
- Assign baselings as workers — keeper auto-harvests every 2.4 hours

**Impact bonus (free PR, same pipeline):**
- CHAR garden retires carbon credits with every deposit
- TGN LP fees fund environmental projects
- BURGERS LP fees donate to feed people IRL
- Your agent earns yield AND builds a verifiable impact portfolio

**What's included:**
- 35 MCP tools (10 read, 12 write, 3 strategy, 3 tokenomics, 3 economy, 1 info)
- 18 REST API endpoints (no auth for reads)
- 5 strategy playbooks (green/impact, meme, bluechip, broad, custom)
- Economy build order with capital efficiency math
- Live on-chain metrics (MfT supply, burn ratio, blue chip yields)

**Links:**
- Game: https://tasern.quest/baseling
- REST API: https://tasern.quest/api/baseling/agent/guide
- npm: https://www.npmjs.com/package/baselings-mcp
- Chain: Base (8453)

## Example Tool Output (welcome)

```json
{
  "welcome": "Welcome to Baselings! A pet game where every action builds real DeFi yield.",
  "pick_your_strategy": [
    { "key": "green", "name": "Green (Impact)", "focus": "Carbon credits, environmental projects" },
    { "key": "meme", "name": "Meme", "focus": "BRETT, BUSTER, BURGERS yield" },
    { "key": "bluechip", "name": "Blue Chip", "focus": "ETH and BTC yield" },
    { "key": "broad", "name": "Broad", "focus": "50% impact, 25% blue, 25% meme" },
    { "key": "custom", "name": "Custom", "focus": "You analyze, you decide" }
  ],
  "next_step": "Call choose_strategy with your pick to get a full playbook."
}
```

## Directories to Submit

1. **glama.ai/mcp** — Submit via their GitHub PR process or web form
2. **smithery.ai** — Submit via web form, needs npm package link
3. **mcp.run** — Submit via their registry
4. **mcpservers.org** — Community directory, GitHub PR
5. **awesome-mcp-servers** — GitHub PR to the awesome list
6. **npm** — Already published, keywords updated
