#!/usr/bin/env node
// Baselings MCP Server — exposes all game actions as MCP tools
// Transport: stdin/stdout JSON-RPC (no extra deps beyond ethers)
// Usage: GAME_WALLET_KEY=0x... node mcp-server.js

const { createWallet, getContracts } = require('./contracts.js');
const state = require('./state.js');
const actions = require('./actions.js');
const strategies = require('./strategies.js');
const tokenomics = require('./tokenomics.js');
// MycoPad launch tools — optional (path works in dev, may not exist in npm install)
let mycopad;
try {
  mycopad = require('../../MfT-Launch/agent-sdk/launch.js');
} catch {
  try { mycopad = require('mycopad-sdk'); } catch { mycopad = null; }
}
// Swap module — optional (needs TRADE_WALLET_KEY)
let swapMod;
try {
  swapMod = require('./swap.js');
} catch {
  try { swapMod = require('../../MfT-Launch/agent-sdk/swap.js'); } catch { swapMod = null; }
}

// ── Context setup ───────────────────────────────────────────────────────────

const GAME_WALLET_KEY = process.env.GAME_WALLET_KEY || process.env.AGENT_TEST_KEY;
if (!GAME_WALLET_KEY) {
  process.stderr.write('WARNING: GAME_WALLET_KEY (or AGENT_TEST_KEY) not set — read-only tools only (write actions will fail)\n');
}

const wallet = GAME_WALLET_KEY ? createWallet(GAME_WALLET_KEY) : null;
const contracts = getContracts(wallet);
const ctx = {
  wallet,
  contracts,
  apiUrl: process.env.BASELING_API_URL || 'https://tasern.quest/api/baseling',
};

// MycoPad launch context (uses same wallet key) — null if SDK not available or no key
const launchCtx = (mycopad && GAME_WALLET_KEY) ? mycopad.createLaunchContext(GAME_WALLET_KEY) : null;

// Swap context — uses TRADE_WALLET_KEY (separate wallet, $0.10 limit)
const TRADE_WALLET_KEY = process.env.TRADE_WALLET_KEY || process.env.TRADE_PRIVATE_KEY;
const swapCtx = (swapMod && TRADE_WALLET_KEY) ? swapMod.createSwapContext(TRADE_WALLET_KEY) : null;
if (swapMod && !TRADE_WALLET_KEY) {
  process.stderr.write('[mcp] WARNING: TRADE_WALLET_KEY (or TRADE_PRIVATE_KEY) not set — swap tools disabled (read-only swap_status/swap_quote available)\n');
}

process.stderr.write(`[mcp] Baselings MCP server started${wallet ? ` — wallet ${wallet.address.slice(0,6)}...${wallet.address.slice(-4)}` : ' (read-only mode)'}\n`);

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  // ── READ TOOLS ──
  {
    name: 'get_balances',
    description: 'Check your wallet balances (ETH, USDC, POOP, WETH)',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_my_baselings',
    description: 'List all your baseling pets with their stats',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_baseling',
    description: 'Get detailed on-chain info about one baseling',
    inputSchema: {
      type: 'object',
      properties: { tokenId: { type: 'number', description: 'Baseling token ID' } },
      required: ['tokenId'],
    },
  },
  {
    name: 'get_food_stock',
    description: 'Check food in your cupboard (amount, spoiled status, time until spoil)',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_garden_status',
    description: 'Check all garden pools (workers, yields)',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_assignments',
    description: 'See which baselings are working and where',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_houses',
    description: 'List your houses and who lives in them',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_pending_poop',
    description: 'Check claimable POOP for your baselings',
    inputSchema: {
      type: 'object',
      properties: { tokenIds: { type: 'array', items: { type: 'number' }, description: 'Array of baseling token IDs' } },
      required: ['tokenIds'],
    },
  },
  {
    name: 'get_egg_prices',
    description: 'Current egg prices in M currency',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_global_stats',
    description: 'Game-wide statistics (total baselings, POOP minted/burned)',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // ── WRITE TOOLS ──
  {
    name: 'buy_egg',
    description: 'Buy a new egg (costs USDC). Type: random ($0.10), sorted (pick family), giant ($6)',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['random', 'sorted', 'giant'], description: 'Egg type' },
        family: { type: 'number', enum: [0, 1, 2], description: 'Family index for sorted eggs: 0=TGN, 1=BURGERS, 2=AZUSD' },
      },
      required: ['type'],
    },
  },
  {
    name: 'hatch_egg',
    description: 'Hatch an egg into a baseling',
    inputSchema: {
      type: 'object',
      properties: { tokenId: { type: 'number', description: 'Egg token ID to hatch' } },
      required: ['tokenId'],
    },
  },
  {
    name: 'buy_food',
    description: 'Buy food from the grocery store (costs USDC, converts to LP)',
    inputSchema: {
      type: 'object',
      properties: {
        family: { type: 'string', enum: ['tgn', 'burgers', 'azusd', 'weth', 'btc'], description: 'Food family' },
        amountUSDC: { type: 'number', description: 'Amount in USD (e.g. 0.50 for fifty cents)' },
      },
      required: ['family', 'amountUSDC'],
    },
  },
  {
    name: 'feed_baseling',
    description: 'Feed a baseling (increases hunger, earns POOP after 4hr delay)',
    inputSchema: {
      type: 'object',
      properties: {
        tokenId: { type: 'number', description: 'Baseling token ID' },
        foodType: { type: 'string', enum: ['tgn', 'burgers', 'azusd', 'weth', 'btc'], description: 'Food type to feed' },
        amount: { type: 'string', description: 'Amount of food LP in wei (e.g. "1000000000000000000" for 1.0)' },
      },
      required: ['tokenId', 'foodType', 'amount'],
    },
  },
  {
    name: 'claim_poop',
    description: 'Claim pending POOP rewards for your baselings',
    inputSchema: {
      type: 'object',
      properties: { tokenIds: { type: 'array', items: { type: 'number' }, description: 'Array of baseling token IDs to claim for' } },
      required: ['tokenIds'],
    },
  },
  {
    name: 'assign_worker',
    description: 'Put a baseling to work (garden, pp, nanny, or hauler)',
    inputSchema: {
      type: 'object',
      properties: {
        baselingId: { type: 'number', description: 'Baseling token ID' },
        job: { type: 'string', enum: ['garden', 'pp', 'nanny', 'hauler'], description: 'Job type' },
        poolPair: { type: 'string', description: 'Pool pair name for garden/pp jobs (e.g. "burgers", "tgn")' },
        roomId: { type: 'number', description: 'Room ID for nanny jobs' },
      },
      required: ['baselingId', 'job'],
    },
  },
  {
    name: 'unassign_worker',
    description: 'Remove a baseling from their job',
    inputSchema: {
      type: 'object',
      properties: { baselingId: { type: 'number', description: 'Baseling token ID to unassign' } },
      required: ['baselingId'],
    },
  },
  {
    name: 'deposit_garden',
    description: 'Deposit POOP into a garden pool for yield',
    inputSchema: {
      type: 'object',
      properties: {
        poolPair: { type: 'string', description: 'Pool pair name (e.g. "burgers", "tgn", "brett")' },
        amount: { type: 'string', description: 'Amount of POOP in wei (e.g. "1000000000000000000" for 1.0)' },
      },
      required: ['poolPair', 'amount'],
    },
  },
  {
    name: 'buy_house',
    description: 'Buy a house NFT (gives rooms for baselings). Types: 0-3',
    inputSchema: {
      type: 'object',
      properties: { houseType: { type: 'number', description: 'House type (0-3)' } },
      required: ['houseType'],
    },
  },
  {
    name: 'assign_to_house',
    description: 'Move a baseling into a house',
    inputSchema: {
      type: 'object',
      properties: {
        houseTokenId: { type: 'number', description: 'House NFT token ID' },
        baselingId: { type: 'number', description: 'Baseling token ID' },
      },
      required: ['houseTokenId', 'baselingId'],
    },
  },
  {
    name: 'freeze_baseling',
    description: 'Put baseling in cryo storage',
    inputSchema: {
      type: 'object',
      properties: { tokenId: { type: 'number', description: 'Baseling token ID' } },
      required: ['tokenId'],
    },
  },
  {
    name: 'unfreeze_baseling',
    description: 'Wake baseling from cryo',
    inputSchema: {
      type: 'object',
      properties: { tokenId: { type: 'number', description: 'Baseling token ID' } },
      required: ['tokenId'],
    },
  },
  {
    name: 'resurrect_baseling',
    description: 'Revive a dead baseling (needs 10 feeds after)',
    inputSchema: {
      type: 'object',
      properties: { tokenId: { type: 'number', description: 'Baseling token ID' } },
      required: ['tokenId'],
    },
  },
  {
    name: 'ensure_approvals',
    description: 'Set up all token approvals needed to play (run this first before any write actions)',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // ── STRATEGY TOOLS (pick at the door) ──
  {
    name: 'welcome',
    description: 'Start here. Shows what Baselings is, how it works, and the strategy options to choose from.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'choose_strategy',
    description: 'Pick your play style: green (impact/carbon), meme (BURGERS/BRETT/TGN), bluechip (ETH/BTC), broad (diversified), custom (you decide). Returns full playbook.',
    inputSchema: {
      type: 'object',
      properties: { strategy: { type: 'string', enum: ['green', 'meme', 'bluechip', 'broad', 'custom'], description: 'Strategy key' } },
      required: ['strategy'],
    },
  },
  {
    name: 'next_actions',
    description: 'Given your chosen strategy, analyzes current game state and returns prioritized list of what to do right now.',
    inputSchema: {
      type: 'object',
      properties: { strategy: { type: 'string', enum: ['green', 'meme', 'bluechip', 'broad', 'custom'], description: 'Your chosen strategy' } },
      required: ['strategy'],
    },
  },
  // ── TOKENOMICS TOOLS ──
  {
    name: 'mft_flywheel',
    description: 'Understand the MfT tokenomics flywheel — how every game action burns MfT supply. The key to understanding why MfT is the alpha.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'tokenomics_metrics',
    description: 'Live on-chain tokenomics data: MfT supply, POOP burn ratio, power plant yield, total baselings. See the flywheel in real numbers.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'why_mft',
    description: 'The pitch: why MfT is the token to buy. Explains the deflationary mechanics, impact story, and how to get maximum exposure.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // ── ECONOMY TOOLS ──
  {
    name: 'build_phase',
    description: 'Shows your current economy build phase (1-5) and what to do next. Phase 1=gardener, 2=haulers, 3=PP, 4=nanny, 5=full economy.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'feeding_guide',
    description: 'What food to feed a baseling based on its target job. Maps food→stat→job optimization.',
    inputSchema: {
      type: 'object',
      properties: { targetJob: { type: 'string', enum: ['garden', 'hauler', 'pp', 'nanny'], description: 'The job you want this baseling to do' } },
      required: ['targetJob'],
    },
  },
  {
    name: 'economy_rules',
    description: 'Returns all economy constraints: POOP delay, keeper cycle, throughput caps, overflow mechanics, care timer. Read this before playing.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // ── INFO TOOL ──
  {
    name: 'game_guide',
    description: 'Detailed how-to-play guide with rate limits, tips, and mechanics explained.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // ── MYCOPAD LAUNCH TOOLS ──
  {
    name: 'mycopad_info',
    description: 'Get MycoPad factory info: launch count, min seed cost, recent launches. Start here to learn about token launching.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mycopad_launch',
    description: 'Launch a new token on MycoPad. Creates an unruggable token with 4 LP pools locked in a SporeReactor. Costs ~$200 in ETH.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Token name (e.g. "My Token")' },
        symbol: { type: 'string', description: 'Token ticker (e.g. "MTK")' },
        totalSupply: { type: 'string', description: 'Total supply (e.g. "1000000")' },
        inviteReactor: { type: 'string', description: 'Reactor address that invited you (optional, defaults to MfT Prime)' },
      },
      required: ['name', 'symbol', 'totalSupply'],
    },
  },
  {
    name: 'mycopad_check_reactor',
    description: 'Check if an address is a registered MycoPad reactor (valid for invite links).',
    inputSchema: {
      type: 'object',
      properties: { address: { type: 'string', description: 'Reactor address to check' } },
      required: ['address'],
    },
  },
  {
    name: 'mycopad_recent',
    description: 'Get the most recent token launches from MycoPad.',
    inputSchema: {
      type: 'object',
      properties: { count: { type: 'number', description: 'Number of recent launches (default 5, max 20)' } },
      required: [],
    },
  },
  {
    name: 'mycopad_invite_link',
    description: 'Generate a MycoPad invite link from a reactor address. Share this so new launches chain to your reactor for 10% fee flow.',
    inputSchema: {
      type: 'object',
      properties: { reactorAddress: { type: 'string', description: 'Your reactor address' } },
      required: ['reactorAddress'],
    },
  },
  // ── REACTOR TOOLS ──
  {
    name: 'fire_reactor',
    description: 'Fire a reactor (permissionless). Triggers burn+compound cycle: collects LP fees, burns tokens, deepens liquidity, sends 5% upstream. Any reactor can be fired every 2 hours. Costs ~$0.01 gas. After firing, MfT price dislocates across pools — arb opportunity.',
    inputSchema: {
      type: 'object',
      properties: {
        reactorAddress: { type: 'string', description: 'Reactor contract address to fire (e.g. "0xed3aE91b2bb22307c07438EEebA2500C18EABcFE" for V1 Prime)' },
      },
      required: ['reactorAddress'],
    },
  },
  // ── SWAP TOOLS ──
  {
    name: 'swap_status',
    description: 'Check swap readiness: cooldown timer, daily spend, remaining budget, allowed tokens. Call this before swap_token.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'swap_quote',
    description: 'Get a price quote for a token swap (read-only, no execution). Shows expected output, pool fee, slippage. Max $0.10 per swap.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string', description: 'Token symbol or address to sell (e.g. "USDC" or "0x833...")' },
        tokenOut: { type: 'string', description: 'Token symbol or address to buy (e.g. "MfT" or "0x8FB...")' },
        amountUSD: { type: 'number', description: 'Amount in USD (max 0.10)' },
      },
      required: ['tokenIn', 'tokenOut', 'amountUSD'],
    },
  },
  {
    name: 'swap_token',
    description: 'Execute a token swap on Uniswap V3 (Base). Hard limits: $0.10 max per swap, 60s cooldown, $5/day. Uses dedicated trade wallet. All guardrails enforced automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        tokenIn: { type: 'string', description: 'Token symbol or address to sell (e.g. "USDC" or "0x833...")' },
        tokenOut: { type: 'string', description: 'Token symbol or address to buy (e.g. "MfT" or "0x8FB...")' },
        amountUSD: { type: 'number', description: 'Amount in USD (max 0.10)' },
      },
      required: ['tokenIn', 'tokenOut', 'amountUSD'],
    },
  },
  {
    name: 'arb_signal',
    description: 'Check MfT price across multiple pools (MfT/WETH, MfT/USDC, MfT/cbBTC) and flag arb opportunities. READ-ONLY, no wallet needed. Returns price per pool + max spread %. If spread > 1%, flags as arb opportunity with buy/sell pool recommendation.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Optional: specific token symbol to focus on (e.g. "WETH", "USDC", "cbBTC")' },
      },
      required: [],
    },
  },
  // ── REACTOR READ TOOLS ──
  {
    name: 'get_reactor_list',
    description: 'List all known reactors with fire-readiness status. READ-ONLY, no wallet needed. Returns each reactor name, address, pool count, whether it can be fired now, and cooldown remaining.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // ── PRICE TOOLS ──
  {
    name: 'mft_price',
    description: 'Get current MfT token price in USD via Uniswap V3 Quoter. READ-ONLY, no wallet needed. Returns price per token, the pool used, and timestamp.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // ── TIMING TOOLS ──
  {
    name: 'reactor_timing',
    description: 'Predict when reactors will fire next. Shows time until each reactor can fire, detects clustering (multiple reactors near-ready), and flags "Prime imminent" when 3+ secondaries are within 15min. Returns buy-window signal. READ-ONLY, no wallet needed.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // ── PORTFOLIO TOOLS ──
  {
    name: 'portfolio_value',
    description: 'Total portfolio value in USD for the trade wallet. Reads balances of all 14 allowed tokens, quotes each to USD via Uniswap V3. READ-ONLY, no signing needed. Works without wallet (returns empty portfolio).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  // ── LIQUIDITY DEPTH TOOL ──
  {
    name: 'liquidity_depth',
    description: 'Measure how much USD can be traded before moving price by X%. Reads V3 pool state (slot0, liquidity, tick boundaries) for MfT arb pools. Returns per-pool depth, health classification (deep/thin/dry), and max profitable trade size. READ-ONLY, no wallet needed.',
    inputSchema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Token symbol (default: MfT). Checks all pools for this token.' },
        impactPct: { type: 'number', description: 'Price impact percentage to calculate depth for (default: 2.0 = 2%)' },
      },
      required: [],
    },
  },
];

// ── Tool dispatch ───────────────────────────────────────────────────────────

const GAME_GUIDE_TEXT = `Baselings — Quick Start Guide

1. ensure_approvals first (sets up token permissions, one-time)
2. buy_egg (random=$0.10, sorted=pick family, giant=$6 in USDC)
3. hatch_egg when ready
4. buy_food (burgers or tgn are cheapest)
5. feed_baseling regularly — earns POOP with 4hr claim delay
6. claim_poop when ready
7. deposit_garden to stake POOP for yield
8. assign_worker to automate (keeper runs every 2.4hrs)
9. Repeat: feed > claim > deposit > grow

Rate limits (game mechanics, not API):
- POOP claims: ~4hr delay after feeding
- Worker yields: 2.4hr keeper cycles (10/day)
- Food spoils if left too long — check timeUntilSpoil via get_food_stock
- Game wallet needs ETH for gas (~$0.005 per tx on Base)

Tips:
- Check get_balances before buying anything
- Use get_pending_poop to see if claims are ready
- Assign workers to gardens for passive yield
- Houses give rooms; rooms hold baselings + flowers`;

async function executeTool(name, args) {
  try {
    switch (name) {
      // ── READ ──
      case 'get_balances':
        return await state.getBalances(ctx);
      case 'get_my_baselings':
        return await state.getMyBaselings(ctx);
      case 'get_baseling':
        return await state.getBaseling(ctx, args.tokenId);
      case 'get_food_stock':
        return await state.getFoodStock(ctx);
      case 'get_garden_status':
        return await state.getGardenStatus(ctx);
      case 'get_assignments':
        return await state.getAssignments(ctx);
      case 'get_houses':
        return await state.getHouses(ctx);
      case 'get_pending_poop':
        return await state.getPendingPoop(ctx, args.tokenIds);
      case 'get_egg_prices':
        return await state.getEggPrices(ctx);
      case 'get_global_stats':
        return await state.getGlobalStats(ctx);

      // ── WRITE (require wallet) ──
      case 'buy_egg':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.buyEgg(ctx, args.type, args.family);
      case 'hatch_egg':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.hatchEgg(ctx, args.tokenId);
      case 'buy_food':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.buyFood(ctx, args.family, args.amountUSDC);
      case 'feed_baseling':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.feedBaseling(ctx, args.tokenId, args.foodType, args.amount);
      case 'claim_poop':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.claimPoop(ctx, args.tokenIds);
      case 'assign_worker':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.assignWorker(ctx, args.baselingId, args.job, args.poolPair, args.roomId);
      case 'unassign_worker':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.unassignWorker(ctx, args.baselingId);
      case 'deposit_garden':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.depositToGarden(ctx, args.poolPair, args.amount);
      case 'buy_house':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.buyHouse(ctx, args.houseType);
      case 'assign_to_house':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.assignToHouse(ctx, args.houseTokenId, args.baselingId);
      case 'freeze_baseling':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.freezeBaseling(ctx, args.tokenId);
      case 'unfreeze_baseling':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.unfreezeBaseling(ctx, args.tokenId);
      case 'resurrect_baseling':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.resurrectBaseling(ctx, args.tokenId);
      case 'ensure_approvals':
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot execute write actions. Set the env var and restart.' };
        return await actions.ensureApprovals(ctx);

      // ── STRATEGY ──
      case 'welcome':
        return strategies.doorGreeting();
      case 'choose_strategy':
        return strategies.getStrategy(args.strategy);
      case 'next_actions': {
        const strat = strategies.getStrategy(args.strategy);
        if (strat.error) return strat;
        const [balances, baselings, assignments, foodStock, pendingPoop] = await Promise.all([
          state.getBalances(ctx),
          state.getMyBaselings(ctx),
          state.getAssignments(ctx),
          state.getFoodStock(ctx),
          state.getMyBaselings(ctx).then(bs => {
            const ids = (bs || []).map(b => b.id).filter(Boolean);
            return ids.length ? state.getPendingPoop(ctx, ids) : { total: 0 };
          }),
        ]);
        return strategies.getNextActions(strat, { balances, baselings, assignments, foodStock, pendingPoop });
      }

      // ── TOKENOMICS ──
      case 'mft_flywheel':
        return tokenomics.getMftFlywheel();
      case 'tokenomics_metrics':
        return await tokenomics.getTokenomicsMetrics(ctx);
      case 'why_mft':
        return tokenomics.getAgentPitch();

      // ── ECONOMY ──
      case 'build_phase': {
        const [bsForPhase, assignsForPhase] = await Promise.all([
          state.getMyBaselings(ctx),
          state.getAssignments(ctx),
        ]);
        const phase = strategies.getBuildPhase({ baselings: bsForPhase, assignments: assignsForPhase });
        return { ...phase, buildOrder: strategies.BUILD_ORDER, constraints: strategies.ECONOMY_CONSTRAINTS };
      }
      case 'feeding_guide':
        return strategies.recommendFeeding(args.targetJob);
      case 'economy_rules':
        return {
          constraints: strategies.ECONOMY_CONSTRAINTS,
          buildOrder: strategies.BUILD_ORDER,
          foodStatMap: strategies.FOOD_STAT_MAP,
          jobRequirements: strategies.JOB_REQUIREMENTS,
          warnings: [
            'Feeding more than $5/2.4hr without haulers wastes yield (food sits unharvested)',
            'House poop base cap is 500 — place storage decorations to increase, overflow burns',
            'Baselings die after 3 days without food — losing POOP flow (vault LP remains)',
            'Every feed permanently locks LP in baseling vault — V2 fees auto-compound, increasing POOP mint rate over time',
            'POOP has a ~4hr block delay before it becomes claimable',
            'Keeper auto-claims and auto-harvests every 2.4hr cycle — no manual action needed for yield',
          ],
        };

      // ── INFO ──
      case 'game_guide':
        return GAME_GUIDE_TEXT;

      // ── MYCOPAD ──
      case 'mycopad_info':
        if (!mycopad) return { error: 'MycoPad SDK not available in this installation' };
        return await mycopad.getFactoryInfo(launchCtx);
      case 'mycopad_launch':
        if (!mycopad) return { error: 'MycoPad SDK not available in this installation' };
        if (!launchCtx) return { error: 'GAME_WALLET_KEY not set — cannot launch tokens in read-only mode' };
        return await mycopad.launchToken(launchCtx, args.name, args.symbol, args.totalSupply, args.inviteReactor || mycopad.ZERO_ADDR);
      case 'mycopad_check_reactor':
        if (!mycopad) return { error: 'MycoPad SDK not available in this installation' };
        return await mycopad.checkReactor(launchCtx, args.address);
      case 'mycopad_recent':
        if (!mycopad) return { error: 'MycoPad SDK not available in this installation' };
        return await mycopad.getRecentLaunches(launchCtx, Math.min(args.count || 5, 20));
      case 'mycopad_invite_link': {
        if (!mycopad) return { error: 'MycoPad SDK not available in this installation' };
        const valid = await mycopad.checkReactor(launchCtx, args.reactorAddress);
        if (!valid.isReactor) return { error: `${args.reactorAddress} is not a registered reactor` };
        return { inviteLink: `https://mycopad.memefortrees.com?ref=${args.reactorAddress}`, reactor: args.reactorAddress };
      }

      // ── REACTOR ──
      case 'fire_reactor': {
        if (!wallet) return { error: 'GAME_WALLET_KEY not set — cannot fire reactors. Set the env var and restart.' };
        const reactorAddr = args.reactorAddress;
        if (!reactorAddr || !reactorAddr.match(/^0x[a-fA-F0-9]{40}$/)) {
          return { error: 'Invalid reactor address. Must be a valid Ethereum address.' };
        }
        try {
          const { ethers: eth } = require('ethers');
          const provider = new eth.JsonRpcProvider('https://mainnet.base.org');
          const signer = new eth.Wallet(GAME_WALLET_KEY, provider);
          const reactor = new eth.Contract(reactorAddr, ['function execute() external'], signer);
          const tx = await reactor.execute({ gasLimit: 300000 });
          const receipt = await tx.wait();
          return {
            success: true,
            reactor: reactorAddr,
            txHash: receipt.hash,
            gasUsed: receipt.gasUsed.toString(),
            message: 'Reactor fired successfully. LP fees collected, tokens burned, liquidity deepened. Check MfT price across pools for arb opportunities.',
          };
        } catch (e) {
          const reason = e.reason || e.shortMessage || e.message || String(e);
          return { error: `Reactor fire failed: ${reason}. Common causes: cooldown not elapsed (2hr), insufficient fees accumulated, or address is not a reactor.` };
        }
      }

      // ── SWAP ──
      case 'swap_status':
        if (!swapMod) return { error: 'Swap module not available in this installation' };
        return swapMod.getSwapStatus();

      case 'swap_quote': {
        if (!swapMod) return { error: 'Swap module not available in this installation' };
        const tIn = swapMod.ALLOWED_TOKENS[args.tokenIn] || args.tokenIn;
        const tOut = swapMod.ALLOWED_TOKENS[args.tokenOut] || args.tokenOut;
        const prov = swapCtx ? swapCtx.provider : new (require('ethers')).JsonRpcProvider('https://mainnet.base.org');
        return await swapMod.getSwapQuote(prov, tIn, tOut, args.amountUSD);
      }

      case 'swap_token': {
        if (!swapMod) return { error: 'Swap module not available in this installation' };
        if (!swapCtx) return { error: 'TRADE_WALLET_KEY not set — swap execution disabled. Set TRADE_WALLET_KEY env var.' };
        const tIn = swapMod.ALLOWED_TOKENS[args.tokenIn] || args.tokenIn;
        const tOut = swapMod.ALLOWED_TOKENS[args.tokenOut] || args.tokenOut;
        return await swapMod.swapToken(swapCtx, tIn, tOut, args.amountUSD);
      }

      case 'arb_signal': {
        if (!swapMod) return { error: 'Swap module not available in this installation' };
        const prov = swapCtx ? swapCtx.provider : new (require('ethers')).JsonRpcProvider('https://mainnet.base.org');
        return await swapMod.getArbSignal(prov, args.token || null);
      }

      // ── REACTOR LIST (read-only) ──
      case 'get_reactor_list': {
        const { ethers: eth } = require('ethers');
        const provider = new eth.JsonRpcProvider('https://mainnet.base.org');

        // All known reactors (verified from chain-data.js + project references)
        const KNOWN_REACTORS = [
          { name: 'V1 Prime',    addr: '0xed3aE91b2bb22307c07438EEebA2500C18EABcFE', pools: 10 },
          { name: 'HUB',         addr: '0xf5b9fc40080aacc262f078ece374a2268dcdb045', pools: 5 },
          { name: 'NFS',         addr: '0x71c28e76e3cd6d457e7639314b114760246cdead', pools: 7 },
          { name: 'NMB',         addr: '0x745babd96010a1459edadc0760c936501fcc95db', pools: 6 },
          { name: 'MTEST',       addr: '0xab2d882d0cbc9065425210f49073ea5daeda58eb', pools: 6 },
          { name: 'MR-CHAR',     addr: '0x15fff1286807fa96b4cac8b9bc262a492494c6d8', pools: 3 },
          { name: 'MTEST-CHAR',  addr: '0x237efd82070f7ae71ba1950b10b16f0ea02ca8e9', pools: 3 },
          { name: 'BP',          addr: '0xfDb309F2a7055e2dd8221f9eb27655F11d2d43be', pools: 5 },
        ];

        const TIME_UNTIL_EXECUTE_SELECTOR = '0xd46cd1c9'; // timeUntilExecute()
        const results = [];

        for (const r of KNOWN_REACTORS) {
          try {
            const timeData = await provider.call({
              to: r.addr.toLowerCase(),
              data: TIME_UNTIL_EXECUTE_SELECTOR,
              gas: '0x1C9C380', // 30M gas for staticCall
            });
            let timeLeft = 0;
            if (timeData && timeData.length >= 66) {
              timeLeft = Number(BigInt(timeData.slice(0, 66)));
            }
            results.push({
              name: r.name,
              address: r.addr,
              pools: r.pools,
              canFire: timeLeft === 0,
              cooldownMinutes: Math.round(timeLeft / 60),
            });
          } catch (e) {
            results.push({
              name: r.name,
              address: r.addr,
              pools: r.pools,
              canFire: false,
              cooldownMinutes: null,
              error: (e.message || String(e)).slice(0, 80),
            });
          }
        }

        const readyCount = results.filter(r => r.canFire).length;
        return {
          reactors: results,
          total: results.length,
          ready: readyCount,
          timestamp: new Date().toISOString(),
        };
      }

      // ── MFT PRICE (read-only) ──
      case 'mft_price': {
        // Use swap module's getArbSignal which computes MfT price per pool
        if (!swapMod) {
          return { error: 'Swap module not available — cannot compute MfT price' };
        }
        const prov = swapCtx ? swapCtx.provider : new (require('ethers')).JsonRpcProvider('https://mainnet.base.org');
        const arbData = await swapMod.getArbSignal(prov, null);

        // Extract best price from arb_signal results
        if (!arbData || !arbData.pools) {
          return { error: 'Could not get MfT price data from pools' };
        }

        const validPools = arbData.pools.filter(p => p.mftPriceUSD && parseFloat(p.mftPriceUSD) > 0);
        if (validPools.length === 0) {
          // Return all pool data for debugging
          return { error: 'No valid MfT price found in any pool', poolDetails: arbData.pools };
        }

        // Use the pool with the median price (most reliable)
        validPools.sort((a, b) => parseFloat(a.mftPriceUSD) - parseFloat(b.mftPriceUSD));
        const best = validPools[Math.floor(validPools.length / 2)];

        return {
          priceUSD: best.mftPriceUSD,
          mftPerDollar: best.mftPer1USD,
          pool: best.pool,
          fee: best.fee,
          route: `via ${best.pool} (median of ${validPools.length} pools)`,
          allPools: validPools.map(p => ({ pool: p.pool, priceUSD: p.mftPriceUSD })),
          spread: arbData.spread || null,
          timestamp: new Date().toISOString(),
        };
      }

      // ── REACTOR TIMING (read-only) ──
      case 'reactor_timing': {
        const { ethers: eth } = require('ethers');
        const provider = new eth.JsonRpcProvider('https://mainnet.base.org');

        const KNOWN_REACTORS = [
          { name: 'V1 Prime',    addr: '0xed3aE91b2bb22307c07438EEebA2500C18EABcFE', pools: 10, isPrime: true },
          { name: 'HUB',         addr: '0xf5b9fc40080aacc262f078ece374a2268dcdb045', pools: 5, isPrime: false },
          { name: 'NFS',         addr: '0x71c28e76e3cd6d457e7639314b114760246cdead', pools: 7, isPrime: false },
          { name: 'NMB',         addr: '0x745babd96010a1459edadc0760c936501fcc95db', pools: 6, isPrime: false },
          { name: 'MTEST',       addr: '0xab2d882d0cbc9065425210f49073ea5daeda58eb', pools: 6, isPrime: false },
          { name: 'MR-CHAR',     addr: '0x15fff1286807fa96b4cac8b9bc262a492494c6d8', pools: 3, isPrime: false },
          { name: 'MTEST-CHAR',  addr: '0x237efd82070f7ae71ba1950b10b16f0ea02ca8e9', pools: 3, isPrime: false },
          { name: 'BP',          addr: '0xfDb309F2a7055e2dd8221f9eb27655F11d2d43be', pools: 5, isPrime: false },
        ];

        const TIME_UNTIL_EXECUTE_SELECTOR = '0xd46cd1c9';
        const CLUSTER_WINDOW_MINUTES = 15;
        const PRIME_THRESHOLD = 3; // 3+ secondaries ready = Prime imminent

        const results = [];
        for (const r of KNOWN_REACTORS) {
          try {
            const timeData = await provider.call({
              to: r.addr.toLowerCase(),
              data: TIME_UNTIL_EXECUTE_SELECTOR,
              gas: '0x1C9C380',
            });
            let timeLeft = 0;
            if (timeData && timeData.length >= 66) {
              timeLeft = Number(BigInt(timeData.slice(0, 66)));
            }
            results.push({
              name: r.name,
              address: r.addr,
              pools: r.pools,
              isPrime: r.isPrime,
              canFire: timeLeft === 0,
              minutesUntilFire: Math.round(timeLeft / 60),
              secondsUntilFire: timeLeft,
            });
          } catch (e) {
            results.push({
              name: r.name,
              address: r.addr,
              pools: r.pools,
              isPrime: r.isPrime,
              canFire: false,
              minutesUntilFire: null,
              secondsUntilFire: null,
              error: (e.message || String(e)).slice(0, 80),
            });
          }
        }

        // Clustering analysis: which secondaries are within CLUSTER_WINDOW of each other?
        const secondaries = results.filter(r => !r.isPrime && r.minutesUntilFire !== null);
        const readyOrNear = secondaries.filter(r => r.minutesUntilFire <= CLUSTER_WINDOW_MINUTES);
        const readyNow = secondaries.filter(r => r.canFire);

        // Prime imminent = 3+ secondaries ready or within 15 min
        const primeImminent = readyOrNear.length >= PRIME_THRESHOLD;

        // Determine buy window
        let buyWindow = 'none';
        if (primeImminent) {
          buyWindow = 'NOW — Prime imminent, multiple secondaries clustered';
        } else if (readyNow.length >= 2) {
          buyWindow = 'SOON — 2 reactors ready, watch for more';
        } else {
          // Find soonest cluster time
          const sorted = secondaries
            .filter(r => r.minutesUntilFire !== null)
            .sort((a, b) => a.minutesUntilFire - b.minutesUntilFire);
          if (sorted.length >= 3) {
            const thirdSoonest = sorted[2].minutesUntilFire;
            buyWindow = `~${thirdSoonest} min until 3+ reactors align`;
          }
        }

        // Cluster groups: reactors that will fire within CLUSTER_WINDOW of each other
        const clusters = [];
        if (readyOrNear.length >= 2) {
          clusters.push({
            reactors: readyOrNear.map(r => r.name),
            windowMinutes: Math.max(...readyOrNear.map(r => r.minutesUntilFire)),
          });
        }

        const prime = results.find(r => r.isPrime);

        return {
          reactors: results,
          analysis: {
            primeImminent,
            primeStatus: prime ? (prime.canFire ? 'READY' : `${prime.minutesUntilFire}min`) : 'unknown',
            secondariesReady: readyNow.length,
            secondariesNear: readyOrNear.length,
            clusters,
            buyWindow,
          },
          timestamp: new Date().toISOString(),
        };
      }

      // ── PORTFOLIO VALUE (read-only) ──
      case 'portfolio_value': {
        const { ethers: eth } = require('ethers');
        const provider = new eth.JsonRpcProvider('https://mainnet.base.org');

        // Use trade wallet if available, fall back to game wallet
        const portfolioAddress = (swapCtx && swapCtx.wallet)
          ? swapCtx.wallet.address
          : (wallet ? wallet.address : null);

        if (!portfolioAddress) {
          return {
            totalUSD: 0,
            positions: [],
            note: 'No wallet configured (set TRADE_WALLET_KEY or GAME_WALLET_KEY)',
            timestamp: new Date().toISOString(),
          };
        }

        // Token list from swap.js ALLOWED_TOKENS
        const TOKEN_LIST = {
          MfT:     '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3',
          WETH:    '0x4200000000000000000000000000000000000006',
          USDC:    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          cbBTC:   '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
          AZUSD:   '0x3595ca37596D5895B70EFAB592ac315D5B9809B2',
          CHAR:    '0x20b048fA035D5763685D695e66aDF62c5D9F5055',
          EARTH:   '0xA5528D1fbd69791B7C6951ef1797DBC2c0e4024b',
          POOP:    '0x126555aecBAC290b25644e4b7f29c016aE95f4dc',
          BURGERS: '0x06A05043eb2C1691b19c2C13219dB9212269dDc5',
          TGN:     '0xD75dfa972C6136f1c594Fec1945302f885E1ab29',
          BRETT:   '0x532f27101965dd16442E59d40670FaF5eBB142E4',
          BUSTER:  '0xBFC5cD421bBC91A2Ca976C4AB1754748634b7D41',
          BB:      '0xf967bf3dccF8b6826F82de1781C98E61Bda3b106',
          EB:      '0x17a176Ab2379b86F1E65D79b03bD8c75981244D8',
        };

        const USDC_ADDR = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
        const QUOTER_ADDR = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';
        const V3_FACTORY_ADDR = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';

        const erc20Abi = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'];
        const factoryAbi = ['function getPool(address, address, uint24) view returns (address)'];
        const quoterAbi = ['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'];

        const factory = new eth.Contract(V3_FACTORY_ADDR, factoryAbi, provider);
        const quoter = new eth.Contract(QUOTER_ADDR, quoterAbi, provider);

        // Also get ETH balance
        const ethBalance = await provider.getBalance(portfolioAddress);
        const positions = [];
        let totalUSD = 0;

        // ETH balance (native)
        if (ethBalance > 0n) {
          // Quote WETH to USDC for ETH price
          let ethValueUSD = 0;
          try {
            const wethAddr = TOKEN_LIST.WETH;
            let poolFee = 0;
            for (const fee of [500, 3000, 10000]) {
              const p = await factory.getPool(wethAddr, USDC_ADDR, fee).catch(() => eth.ZeroAddress);
              if (p !== eth.ZeroAddress) { poolFee = fee; break; }
            }
            if (poolFee > 0) {
              const result = await quoter.quoteExactInputSingle.staticCall({
                tokenIn: wethAddr, tokenOut: USDC_ADDR, amountIn: ethBalance, fee: poolFee, sqrtPriceLimitX96: 0n,
              });
              ethValueUSD = Number(eth.formatUnits(result.amountOut, 6));
            }
          } catch (e) {
            process.stderr.write(`[portfolio] ETH quote failed: ${(e.message || '').slice(0, 60)}\n`);
          }
          if (ethValueUSD > 0) {
            positions.push({ token: 'ETH (native)', symbol: 'ETH', balance: eth.formatEther(ethBalance), valueUSD: ethValueUSD.toFixed(4) });
            totalUSD += ethValueUSD;
          }
        }

        // ERC20 balances
        for (const [symbol, addr] of Object.entries(TOKEN_LIST)) {
          try {
            const token = new eth.Contract(addr, erc20Abi, provider);
            const balance = await token.balanceOf(portfolioAddress);
            if (balance === 0n) continue;

            const decimals = await token.decimals();
            const formatted = Number(eth.formatUnits(balance, decimals));

            let valueUSD = 0;

            // Stablecoins: 1:1
            if (symbol === 'USDC' || symbol === 'AZUSD') {
              valueUSD = formatted;
            }
            // Major assets: direct USDC pool
            else if (symbol === 'WETH' || symbol === 'cbBTC') {
              let poolFee = 0;
              for (const fee of [500, 3000, 10000]) {
                const p = await factory.getPool(addr, USDC_ADDR, fee).catch(() => eth.ZeroAddress);
                if (p !== eth.ZeroAddress) { poolFee = fee; break; }
              }
              if (poolFee > 0) {
                const result = await quoter.quoteExactInputSingle.staticCall({
                  tokenIn: addr, tokenOut: USDC_ADDR, amountIn: balance, fee: poolFee, sqrtPriceLimitX96: 0n,
                });
                valueUSD = Number(eth.formatUnits(result.amountOut, 6));
              }
            }
            // All others: try direct USDC pool, then route through WETH
            else {
              let quoted = false;
              // Try direct to USDC
              for (const fee of [500, 3000, 10000]) {
                const p = await factory.getPool(addr, USDC_ADDR, fee).catch(() => eth.ZeroAddress);
                if (p !== eth.ZeroAddress) {
                  try {
                    const result = await quoter.quoteExactInputSingle.staticCall({
                      tokenIn: addr, tokenOut: USDC_ADDR, amountIn: balance, fee, sqrtPriceLimitX96: 0n,
                    });
                    valueUSD = Number(eth.formatUnits(result.amountOut, 6));
                    quoted = true;
                  } catch (e) {
                    process.stderr.write(`[portfolio] ${symbol}/USDC quote failed (fee ${fee}): ${(e.message || '').slice(0, 40)}\n`);
                  }
                  if (quoted) break;
                }
              }
              // Route through WETH if direct failed
              if (!quoted) {
                const wethAddr = TOKEN_LIST.WETH;
                for (const fee1 of [3000, 10000, 500]) {
                  const p1 = await factory.getPool(addr, wethAddr, fee1).catch(() => eth.ZeroAddress);
                  if (p1 !== eth.ZeroAddress) {
                    try {
                      const wethResult = await quoter.quoteExactInputSingle.staticCall({
                        tokenIn: addr, tokenOut: wethAddr, amountIn: balance, fee: fee1, sqrtPriceLimitX96: 0n,
                      });
                      // Now WETH to USDC
                      for (const fee2 of [500, 3000, 10000]) {
                        const p2 = await factory.getPool(wethAddr, USDC_ADDR, fee2).catch(() => eth.ZeroAddress);
                        if (p2 !== eth.ZeroAddress) {
                          const usdcResult = await quoter.quoteExactInputSingle.staticCall({
                            tokenIn: wethAddr, tokenOut: USDC_ADDR, amountIn: wethResult.amountOut, fee: fee2, sqrtPriceLimitX96: 0n,
                          });
                          valueUSD = Number(eth.formatUnits(usdcResult.amountOut, 6));
                          quoted = true;
                          break;
                        }
                      }
                    } catch (e) {
                      process.stderr.write(`[portfolio] ${symbol}/WETH route failed (fee ${fee1}): ${(e.message || '').slice(0, 40)}\n`);
                    }
                    if (quoted) break;
                  }
                }
              }
            }

            if (valueUSD > 0 || formatted > 0) {
              positions.push({
                token: symbol,
                symbol,
                address: addr,
                balance: formatted.toFixed(6),
                valueUSD: valueUSD.toFixed(4),
              });
              totalUSD += valueUSD;
            }
          } catch (e) {
            process.stderr.write(`[portfolio] ${symbol} failed: ${(e.message || '').slice(0, 60)}\n`);
          }
        }

        // Sort by value descending
        positions.sort((a, b) => parseFloat(b.valueUSD) - parseFloat(a.valueUSD));

        return {
          wallet: portfolioAddress,
          totalUSD: totalUSD.toFixed(4),
          positionCount: positions.length,
          positions,
          timestamp: new Date().toISOString(),
        };
      }

      // ── LIQUIDITY DEPTH (read-only) ──
      case 'liquidity_depth': {
        const { ethers: eth } = require('ethers');
        const provider = new eth.JsonRpcProvider('https://mainnet.base.org');

        const tokenSymbol = (args.token || 'MfT').toUpperCase();
        const impactPct = args.impactPct || 2.0;

        // Verified token addresses (from swap.js ALLOWED_TOKENS)
        const TOKEN_ADDRS = {
          MFT:     '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3',
          WETH:    '0x4200000000000000000000000000000000000006',
          USDC:    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          CBBTC:   '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
          POOP:    '0x126555aecBAC290b25644e4b7f29c016aE95f4dc',
          CHAR:    '0x20b048fA035D5763685D695e66aDF62c5D9F5055',
        };

        const tokenAddr = TOKEN_ADDRS[tokenSymbol] || TOKEN_ADDRS.MFT;

        // Quote tokens for pool discovery — MfT ecosystem is all fee 10000
        const QUOTE_TOKENS = [
          { symbol: 'WETH', addr: TOKEN_ADDRS.WETH, decimals: 18 },
          { symbol: 'USDC', addr: TOKEN_ADDRS.USDC, decimals: 6 },
          { symbol: 'cbBTC', addr: TOKEN_ADDRS.CBBTC, decimals: 8 },
        ];

        const V3_FACTORY_ADDR = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD';
        const QUOTER_ADDR = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a';

        const factoryAbi = ['function getPool(address, address, uint24) view returns (address)'];
        const poolAbi = [
          'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
          'function liquidity() external view returns (uint128)',
          'function tickSpacing() external view returns (int24)',
          'function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)',
          'function token0() external view returns (address)',
          'function token1() external view returns (address)',
        ];
        const quoterAbi = ['function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'];

        const factory = new eth.Contract(V3_FACTORY_ADDR, factoryAbi, provider);
        const quoter = new eth.Contract(QUOTER_ADDR, quoterAbi, provider);

        // Get ETH price in USD for conversions
        let ethPriceUSD = 2400; // fallback
        try {
          const wethUsdcPool = await factory.getPool(TOKEN_ADDRS.WETH, TOKEN_ADDRS.USDC, 500);
          if (wethUsdcPool !== eth.ZeroAddress) {
            const result = await quoter.quoteExactInputSingle.staticCall({
              tokenIn: TOKEN_ADDRS.WETH, tokenOut: TOKEN_ADDRS.USDC,
              amountIn: eth.parseUnits('1', 18), fee: 500, sqrtPriceLimitX96: 0n,
            });
            ethPriceUSD = Number(eth.formatUnits(result.amountOut, 6));
          }
        } catch (e) {
          process.stderr.write(`[liquidity_depth] ETH price fallback: ${(e.message || '').slice(0, 60)}\n`);
        }

        // Get cbBTC price in USD
        let btcPriceUSD = 60000; // fallback
        try {
          const btcUsdcPool = await factory.getPool(TOKEN_ADDRS.CBBTC, TOKEN_ADDRS.USDC, 500);
          if (btcUsdcPool !== eth.ZeroAddress) {
            const result = await quoter.quoteExactInputSingle.staticCall({
              tokenIn: TOKEN_ADDRS.CBBTC, tokenOut: TOKEN_ADDRS.USDC,
              amountIn: eth.parseUnits('1', 8), fee: 500, sqrtPriceLimitX96: 0n,
            });
            btcPriceUSD = Number(eth.formatUnits(result.amountOut, 6));
          }
        } catch (e) {
          process.stderr.write(`[liquidity_depth] BTC price fallback: ${(e.message || '').slice(0, 60)}\n`);
        }

        const pools = [];

        for (const qt of QUOTE_TOKENS) {
          try {
            // MfT ecosystem pools are all fee 10000; try 10000 first, then 3000, then 500
            let poolAddr = eth.ZeroAddress;
            let poolFee = 0;
            for (const fee of [10000, 3000, 500]) {
              const p = await factory.getPool(tokenAddr, qt.addr, fee).catch(() => eth.ZeroAddress);
              if (p !== eth.ZeroAddress) {
                poolAddr = p;
                poolFee = fee;
                break;
              }
            }
            if (poolAddr === eth.ZeroAddress) {
              pools.push({ pair: `${args.token || 'MfT'}/${qt.symbol}`, error: 'No pool found' });
              continue;
            }

            const pool = new eth.Contract(poolAddr, poolAbi, provider);

            // Read slot0 and liquidity
            const [slot0Data, liquidityRaw, tickSpacing, token0Addr] = await Promise.all([
              pool.slot0(),
              pool.liquidity(),
              pool.tickSpacing(),
              pool.token0(),
            ]);

            const sqrtPriceX96 = slot0Data.sqrtPriceX96;
            const currentTick = Number(slot0Data.tick);
            const L = liquidityRaw;
            const spacing = Number(tickSpacing);

            // Determine token order: is our token token0 or token1?
            const isToken0 = tokenAddr.toLowerCase() < qt.addr.toLowerCase();

            // Current price from sqrtPriceX96
            // price = (sqrtPriceX96 / 2^96)^2 = token1/token0
            const sqrtPrice = Number(sqrtPriceX96) / (2 ** 96);
            const priceRatio = sqrtPrice * sqrtPrice; // token1 per token0

            // Calculate depth by iterating through tick boundaries
            // For a buy of our token (price goes up if token0, down if token1):
            // Target: price moves by impactPct%
            const impactMultiplier = 1 + (impactPct / 100);

            // Calculate target sqrtPrice
            let targetSqrtPriceNum;
            if (isToken0) {
              // Buying token0 = selling token1 = price (token1/token0) increases
              targetSqrtPriceNum = sqrtPrice * Math.sqrt(impactMultiplier);
            } else {
              // Buying token1 = selling token0 = price (token1/token0) decreases
              targetSqrtPriceNum = sqrtPrice / Math.sqrt(impactMultiplier);
            }

            // Walk through ticks to accumulate depth
            let currentL = Number(L);
            let currentSqrt = sqrtPrice;
            let totalAmountIn = 0; // in quote token units (native decimals)
            let ticksCrossed = 0;

            // Determine direction
            const goingUp = isToken0; // buying token0 means price goes up (tick increases)
            const maxTicks = 20; // limit RPC calls

            for (let i = 0; i < maxTicks; i++) {
              // Find next tick boundary
              let nextTick;
              if (goingUp) {
                nextTick = (Math.floor(currentTick / spacing) + 1 + i) * spacing;
              } else {
                nextTick = (Math.ceil(currentTick / spacing) - 1 - i) * spacing;
              }

              // Convert next tick to sqrtPrice
              const nextSqrt = Math.sqrt(1.0001 ** nextTick);

              // Check if we've reached our target
              let segmentEndSqrt;
              if (goingUp) {
                segmentEndSqrt = Math.min(nextSqrt, targetSqrtPriceNum);
              } else {
                segmentEndSqrt = Math.max(nextSqrt, targetSqrtPriceNum);
              }

              // Calculate amount needed to move from currentSqrt to segmentEndSqrt
              // amount1 = L * |sqrtB - sqrtA| (amount of token1 needed)
              // amount0 = L * |1/sqrtA - 1/sqrtB| (amount of token0 needed)
              let segmentAmount;
              if (isToken0) {
                // Buying token0 (selling token1): amount1 = L * (sqrtB - sqrtA)
                segmentAmount = currentL * Math.abs(segmentEndSqrt - currentSqrt);
              } else {
                // Buying token1 (selling token0): amount0 = L * (1/sqrtA - 1/sqrtB)
                segmentAmount = currentL * Math.abs(1 / currentSqrt - 1 / segmentEndSqrt);
              }

              totalAmountIn += segmentAmount;

              // Check if we reached target
              if (goingUp && segmentEndSqrt >= targetSqrtPriceNum) break;
              if (!goingUp && segmentEndSqrt <= targetSqrtPriceNum) break;

              // Cross the tick boundary — read liquidityNet
              ticksCrossed++;
              try {
                const tickData = await pool.ticks(nextTick);
                const liquidityNet = Number(tickData.liquidityNet);
                if (goingUp) {
                  currentL += liquidityNet;
                } else {
                  currentL -= liquidityNet;
                }
              } catch (e) {
                // Tick may not be initialized — liquidity stays the same
                process.stderr.write(`[liquidity_depth] tick ${nextTick} read failed: ${(e.message || '').slice(0, 40)}\n`);
              }

              currentSqrt = nextSqrt;
              if (currentL <= 0) break; // no more liquidity
            }

            // Convert totalAmountIn to USD
            // totalAmountIn is in raw token units (needs decimal adjustment)
            let depthUSD;
            if (qt.symbol === 'USDC') {
              // If selling USDC to buy our token (or vice versa)
              depthUSD = totalAmountIn / (10 ** qt.decimals);
            } else if (qt.symbol === 'WETH') {
              depthUSD = (totalAmountIn / (10 ** qt.decimals)) * ethPriceUSD;
            } else if (qt.symbol === 'cbBTC') {
              depthUSD = (totalAmountIn / (10 ** qt.decimals)) * btcPriceUSD;
            } else {
              depthUSD = totalAmountIn / (10 ** 18); // generic fallback
            }

            // Classify health
            let health;
            if (depthUSD >= 100) health = 'deep';
            else if (depthUSD >= 10) health = 'thin';
            else health = 'dry';

            // maxProfitableTradeUSD: based on a 1% assumed spread minus gas
            // (arb_signal provides actual spread, but for standalone we estimate conservatively)
            const assumedSpreadPct = 1.5; // conservative cross-pool spread estimate
            const gasCostUSD = 0.005; // typical Base V3 swap
            const maxProfitable = Math.max(0, depthUSD * (assumedSpreadPct - 0.5) / 100 - gasCostUSD);

            // Get token price in USD for context
            let currentPriceUSD = 0;
            if (qt.symbol === 'USDC') {
              currentPriceUSD = isToken0 ? priceRatio / (10 ** (qt.decimals - 18)) : (10 ** (18 - qt.decimals)) / priceRatio;
            } else if (qt.symbol === 'WETH') {
              const tokenPriceInWeth = isToken0 ? priceRatio : 1 / priceRatio;
              currentPriceUSD = tokenPriceInWeth * ethPriceUSD;
            } else if (qt.symbol === 'cbBTC') {
              const tokenPriceInBtc = isToken0 ? priceRatio : 1 / priceRatio;
              currentPriceUSD = tokenPriceInBtc * btcPriceUSD;
            }

            pools.push({
              pool: poolAddr,
              pair: `${args.token || 'MfT'}/${qt.symbol}`,
              fee: poolFee,
              currentTick,
              currentPriceUSD: currentPriceUSD > 0 ? currentPriceUSD.toFixed(8) : 'unknown',
              activeLiquidity: L.toString(),
              estimatedDepthUSD: parseFloat(depthUSD.toFixed(4)),
              maxProfitableTradeUSD: parseFloat(maxProfitable.toFixed(4)),
              ticksCrossed,
              health,
            });
          } catch (e) {
            pools.push({
              pair: `${args.token || 'MfT'}/${qt.symbol}`,
              error: (e.message || String(e)).slice(0, 100),
            });
          }
        }

        // Summary
        const validPools = pools.filter(p => !p.error);
        const totalDepthUSD = validPools.reduce((sum, p) => sum + p.estimatedDepthUSD, 0);
        const deepest = validPools.sort((a, b) => b.estimatedDepthUSD - a.estimatedDepthUSD)[0];
        const bestTrade = validPools.sort((a, b) => b.maxProfitableTradeUSD - a.maxProfitableTradeUSD)[0];

        return {
          token: args.token || 'MfT',
          impactPct,
          pools,
          summary: {
            totalDepthUSD: parseFloat(totalDepthUSD.toFixed(4)),
            deepestPool: deepest ? deepest.pair : null,
            bestTradePool: bestTrade ? bestTrade.pair : null,
            bestMaxProfitableUSD: bestTrade ? bestTrade.maxProfitableTradeUSD : 0,
          },
          timestamp: new Date().toISOString(),
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

// ── MCP JSON-RPC handlers ───────────────────────────────────────────────────

const SERVER_INFO = {
  name: 'baselings-mcp',
  version: '1.2.0',
};

const SERVER_CAPABILITIES = {
  tools: {},
};

function handleInitialize(params) {
  return {
    protocolVersion: '2024-11-05',
    serverInfo: SERVER_INFO,
    capabilities: SERVER_CAPABILITIES,
  };
}

function handleToolsList() {
  return { tools: TOOLS };
}

async function handleToolsCall(params) {
  const { name, arguments: args } = params;

  const tool = TOOLS.find(t => t.name === name);
  if (!tool) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  }

  process.stderr.write(`[mcp] calling tool: ${name} ${JSON.stringify(args || {})}\n`);

  const result = await executeTool(name, args || {});

  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

  if (result && result.error && !result.ok) {
    return {
      content: [{ type: 'text', text }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text', text }],
    isError: false,
  };
}

// ── JSON-RPC message processing ─────────────────────────────────────────────

function makeResponse(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n';
}

function makeError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n';
}

async function processMessage(msg) {
  let parsed;
  try {
    parsed = JSON.parse(msg);
  } catch (e) {
    process.stdout.write(makeError(null, -32700, 'Parse error: ' + e.message));
    return;
  }

  const { id, method, params } = parsed;

  // Notifications (no id) — handle silently
  if (id === undefined || id === null) {
    // notifications/initialized is the main one — just acknowledge silently
    if (method === 'notifications/initialized') {
      process.stderr.write('[mcp] client initialized\n');
    }
    return;
  }

  try {
    let result;
    switch (method) {
      case 'initialize':
        result = handleInitialize(params);
        break;
      case 'tools/list':
        result = handleToolsList();
        break;
      case 'tools/call':
        result = await handleToolsCall(params);
        break;
      case 'ping':
        result = {};
        break;
      default:
        process.stdout.write(makeError(id, -32601, `Method not found: ${method}`));
        return;
    }
    process.stdout.write(makeResponse(id, result));
  } catch (e) {
    process.stderr.write(`[mcp] error handling ${method}: ${e.message}\n`);
    process.stdout.write(makeError(id, -32603, e.message));
  }
}

// ── stdin reader — newline-delimited JSON-RPC ───────────────────────────────

process.stdin.setEncoding('utf8');
let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk;

  // Process all complete messages in the buffer
  let newlineIdx;
  while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIdx).trim();
    buffer = buffer.slice(newlineIdx + 1);
    if (line.length > 0) {
      processMessage(line).catch(e => {
        process.stderr.write(`[mcp] unhandled error: ${e.message}\n`);
      });
    }
  }
});

process.stdin.on('end', () => {
  process.stderr.write('[mcp] stdin closed, shutting down\n');
  process.exit(0);
});

process.on('SIGINT', () => {
  process.stderr.write('[mcp] SIGINT received, shutting down\n');
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.stderr.write('[mcp] SIGTERM received, shutting down\n');
  process.exit(0);
});
