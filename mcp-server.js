#!/usr/bin/env node
// Baselings MCP Server — exposes all game actions as MCP tools
// Transport: stdin/stdout JSON-RPC (no extra deps beyond ethers)
//
// Required env:
//   GAME_WALLET_KEY               — private key (0x...) of the agent wallet
//
// Optional safety env (recommended for agent operators):
//   BASELINGS_MODE=read           — disable all write tools (default: write)
//   MAX_USDC_PER_TX=<usd>         — cap any single USDC-spending tool call (default: no cap)
//   MAX_USDC_PER_DAY=<usd>        — cap cumulative USDC spend per UTC day (default: no cap)
//   BASELINGS_LOG_FILE=<path>     — append-only JSONL audit log of every tx-emitting call
//   BASELINGS_INFINITE_APPROVALS=1 — opt back into MAX_UINT256 approvals (NOT recommended)
//
// Usage: GAME_WALLET_KEY=0x... node mcp-server.js

const fs = require('fs');
const { createWallet, getContracts } = require('./contracts.js');
const state = require('./state.js');
const actions = require('./actions.js');
const strategies = require('./strategies.js');
const tokenomics = require('./tokenomics.js');

// ── Context setup ───────────────────────────────────────────────────────────

const GAME_WALLET_KEY = process.env.GAME_WALLET_KEY;
if (!GAME_WALLET_KEY) {
  process.stderr.write('FATAL: GAME_WALLET_KEY environment variable is required\n');
  process.exit(1);
}

const wallet = createWallet(GAME_WALLET_KEY);
const contracts = getContracts(wallet);
const ctx = {
  wallet,
  contracts,
  apiUrl: process.env.BASELING_API_URL || 'https://tasern.quest/api/baseling',
};

// ── Agent-safety config ─────────────────────────────────────────────────────

const MODE = (process.env.BASELINGS_MODE || 'write').toLowerCase();
if (MODE !== 'read' && MODE !== 'write') {
  process.stderr.write(`FATAL: BASELINGS_MODE must be 'read' or 'write' (got '${MODE}')\n`);
  process.exit(1);
}

const MAX_USDC_PER_TX  = process.env.MAX_USDC_PER_TX  ? Number(process.env.MAX_USDC_PER_TX)  : Infinity;
const MAX_USDC_PER_DAY = process.env.MAX_USDC_PER_DAY ? Number(process.env.MAX_USDC_PER_DAY) : Infinity;
const LOG_FILE         = process.env.BASELINGS_LOG_FILE || null;

// Tools that sign transactions. Used for read-mode filtering and spend guard.
const WRITE_TOOLS = new Set([
  'buy_egg', 'hatch_egg', 'buy_food', 'feed_baseling', 'claim_poop',
  'assign_worker', 'unassign_worker', 'deposit_garden', 'buy_house',
  'assign_to_house', 'freeze_baseling', 'unfreeze_baseling',
  'resurrect_baseling', 'ensure_approvals',
]);

// In-memory daily spend tracker. Resets on process restart unless LOG_FILE is set
// (in which case the log is the durable record; this counter is a soft cap only).
let dailySpend = { date: new Date().toISOString().slice(0, 10), spent: 0 };

function _resetDailyIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (dailySpend.date !== today) dailySpend = { date: today, spent: 0 };
}

// Pre-flight spend check. Throws on cap breach.
function _checkSpend(toolName, args) {
  if (MAX_USDC_PER_TX === Infinity && MAX_USDC_PER_DAY === Infinity) return;
  _resetDailyIfNeeded();

  // Best-effort USDC estimate per tool. Conservative — if a tool spends USDC but
  // we can't estimate from args, we err on the side of NOT blocking (the
  // contract will still enforce balance and any on-chain caps).
  let usd = 0;
  if (toolName === 'buy_food') usd = Number(args && args.amountUSDC) || 0;
  else if (toolName === 'buy_egg') usd = ({ random: 2, sorted: 3, giant: 5 })[args && args.type] || 0;

  if (usd <= 0) return; // not USDC-spending or unestimable

  if (usd > MAX_USDC_PER_TX) {
    throw new Error(`spend cap: tx amount ${usd} USDC exceeds MAX_USDC_PER_TX=${MAX_USDC_PER_TX} (tool=${toolName})`);
  }
  if (dailySpend.spent + usd > MAX_USDC_PER_DAY) {
    throw new Error(`spend cap: today's spend ${dailySpend.spent + usd} USDC would exceed MAX_USDC_PER_DAY=${MAX_USDC_PER_DAY} (tool=${toolName})`);
  }
  dailySpend.spent += usd;
}

// Append-only JSONL audit log. Writes one line per tx-emitting tool call.
function _logTx(toolName, args, result) {
  if (!LOG_FILE) return;
  if (!result || result.ok !== true || !result.tx) return; // not a tx-emitting success
  try {
    const entry = {
      ts: new Date().toISOString(),
      wallet: wallet.address,
      tool: toolName,
      args: args || {},
      tx: result.tx,
    };
    if (result.tokenId) entry.tokenId = result.tokenId;
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) {
    process.stderr.write(`[mcp] failed to write audit log: ${e.message}\n`);
  }
}

process.stderr.write(`[mcp] Baselings MCP server started — wallet ${wallet.address} mode=${MODE}`);
if (MAX_USDC_PER_TX  !== Infinity) process.stderr.write(` max/tx=${MAX_USDC_PER_TX}`);
if (MAX_USDC_PER_DAY !== Infinity) process.stderr.write(` max/day=${MAX_USDC_PER_DAY}`);
if (LOG_FILE) process.stderr.write(` audit=${LOG_FILE}`);
process.stderr.write('\n');

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
    description: 'Buy a new egg (costs USDC). Type: random ($2), sorted ($3, pick family), giant ($5)',
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
];

// ── Tool dispatch ───────────────────────────────────────────────────────────

const GAME_GUIDE_TEXT = `Baselings — Quick Start Guide

1. ensure_approvals first (sets up token permissions, one-time)
2. buy_egg (random=$2, sorted=$3 pick family, giant=$5 in USDC)
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

      // ── WRITE ──
      case 'buy_egg':
        return await actions.buyEgg(ctx, args.type, args.family);
      case 'hatch_egg':
        return await actions.hatchEgg(ctx, args.tokenId);
      case 'buy_food':
        return await actions.buyFood(ctx, args.family, args.amountUSDC);
      case 'feed_baseling':
        return await actions.feedBaseling(ctx, args.tokenId, args.foodType, args.amount);
      case 'claim_poop':
        return await actions.claimPoop(ctx, args.tokenIds);
      case 'assign_worker':
        return await actions.assignWorker(ctx, args.baselingId, args.job, args.poolPair, args.roomId);
      case 'unassign_worker':
        return await actions.unassignWorker(ctx, args.baselingId);
      case 'deposit_garden':
        return await actions.depositToGarden(ctx, args.poolPair, args.amount);
      case 'buy_house':
        return await actions.buyHouse(ctx, args.houseType);
      case 'assign_to_house':
        return await actions.assignToHouse(ctx, args.houseTokenId, args.baselingId);
      case 'freeze_baseling':
        return await actions.freezeBaseling(ctx, args.tokenId);
      case 'unfreeze_baseling':
        return await actions.unfreezeBaseling(ctx, args.tokenId);
      case 'resurrect_baseling':
        return await actions.resurrectBaseling(ctx, args.tokenId);
      case 'ensure_approvals':
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
            'House poop cap is 5000 — overflow goes to Power Plant at lowest paying tier',
            'Baselings die after 14 days without food — losing POOP flow (vault LP remains)',
            'Every feed permanently locks LP in baseling vault — swap fees accrue forever',
            'POOP has a ~4hr block delay before it becomes claimable',
            'Keeper auto-claims and auto-harvests every 2.4hr cycle — no manual action needed for yield',
          ],
        };

      // ── INFO ──
      case 'game_guide':
        return GAME_GUIDE_TEXT;

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
  version: '1.0.0',
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
  // In read mode, hide all tools that sign transactions so an agent
  // can't even discover them.
  const tools = MODE === 'read'
    ? TOOLS.filter(t => !WRITE_TOOLS.has(t.name))
    : TOOLS;
  return { tools };
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

  // Reject write tools in read mode (defense-in-depth — they're already hidden in list).
  if (MODE === 'read' && WRITE_TOOLS.has(name)) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Tool '${name}' disabled — server running in BASELINGS_MODE=read` }) }],
      isError: true,
    };
  }

  // Enforce spending caps for USDC-spending write tools.
  try {
    _checkSpend(name, args);
  } catch (e) {
    process.stderr.write(`[mcp] spend cap blocked ${name}: ${e.message}\n`);
    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: e.message }) }],
      isError: true,
    };
  }

  process.stderr.write(`[mcp] calling tool: ${name} ${JSON.stringify(args || {})}\n`);

  const result = await executeTool(name, args || {});

  // Append to audit log if BASELINGS_LOG_FILE is set.
  _logTx(name, args, result);

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
