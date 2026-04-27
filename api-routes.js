// Baselings Agent SDK — REST API Routes
// Mounts as Express router at /agent/* for read-only game state queries.
// Usage: app.use(require('./agent-sdk/api-routes'));

const { Router } = require('express');
const { ethers } = require('ethers');
const {
  createProvider, getContracts, ABI, CONTRACTS, TOKENS,
  GARDEN_POOLS, POOL_INDEX, FOOD_LP, FOOD_FAMILY_IDX,
} = require('./contracts.js');
const {
  getMyBaselings, getBaseling, getBalances, getFoodStock,
  getGardenStatus, getAssignments, getHouses, getPendingPoop,
  getEggPrices, getGlobalStats,
} = require('./state.js');

const router = Router();

// ── Read-only context builder ───────────────────────────────────────────────
// Creates a ctx object that mirrors what state.js expects, but without a signer.
// The wallet "address" is injected from the URL param; provider is shared.

const _provider = createProvider();

function makeReadCtx(walletAddress) {
  // getContracts() requires a signer, but for reads we only need the provider.
  // Build read-only contract instances directly.
  const read = (addr, abi) => new ethers.Contract(addr, abi, _provider);

  return {
    wallet: {
      address: walletAddress,
      provider: _provider,
    },
    contracts: {
      nftRead:    read(CONTRACTS.BASELING_NFT, ABI.BASELING_NFT),
      routerRead: read(CONTRACTS.ROUTER, ABI.ROUTER),
      pantryRead: read(CONTRACTS.PANTRY, ABI.PANTRY),
      houseRead:  read(CONTRACTS.HOUSE_NFT, ABI.HOUSE_NFT),
      traitRead:  read(CONTRACTS.TRAIT_REGISTRY, ABI.TRAIT_REGISTRY),
      stateRead:  read(CONTRACTS.BASELING_STATE, ABI.BASELING_STATE),
      assignRead: read(CONTRACTS.ASSIGNMENTS, ABI.ASSIGNMENTS),
      poopRead:   read(TOKENS.POOP, ABI.ERC20),
      usdcRead:   read(TOKENS.USDC, ABI.ERC20),
      wethRead:   read(TOKENS.WETH, ABI.WETH),
    },
    apiUrl: process.env.API_URL || 'https://tasern.quest/api/baseling',
  };
}

// ── Validation helpers ──────────────────────────────────────────────────────

function isValidAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidTokenId(id) {
  return /^\d+$/.test(id) && id !== '0';
}

// ── Wallet auth middleware (for future write endpoints) ─────────────────────
// Not used by current read endpoints, but available for later expansion.

function verifyWallet(req, res, next) {
  const address = req.headers['x-wallet-address'];
  const signature = req.headers['x-wallet-signature'];

  if (!address || !signature) {
    return res.status(401).json({ error: 'Missing x-wallet-address or x-wallet-signature headers' });
  }

  if (!isValidAddress(address)) {
    return res.status(401).json({ error: 'Invalid wallet address format' });
  }

  try {
    const recovered = ethers.verifyMessage('Baselings Agent Auth', signature);
    if (recovered.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({ error: 'Signature does not match wallet address' });
    }
    req.agentWallet = recovered;
    next();
  } catch (e) {
    console.error('[agent-sdk] verifyWallet:', e.message);
    return res.status(401).json({ error: 'Invalid signature' });
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

// GET /agent/status/:wallet — Combined balances + baselings summary
router.get('/agent/status/:wallet', async (req, res) => {
  const { wallet } = req.params;
  if (!isValidAddress(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    const ctx = makeReadCtx(wallet);
    const [balances, baselings] = await Promise.all([
      getBalances(ctx),
      getMyBaselings(ctx),
    ]);

    return res.json({
      wallet,
      balances,
      baselingCount: baselings.length,
      baselings: baselings.map(b => ({
        id: b.id,
        name: b.name,
        family: b.family,
        rarity: b.rarity,
        hunger: b.hunger,
        happy: b.happy,
        poop: b.poop,
      })),
    });
  } catch (e) {
    console.error('[agent-sdk] GET /agent/status:', e.message);
    return res.status(500).json({ error: 'Failed to fetch status: ' + e.message });
  }
});

// GET /agent/baselings/:wallet — Full baseling list from game save
router.get('/agent/baselings/:wallet', async (req, res) => {
  const { wallet } = req.params;
  if (!isValidAddress(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    const ctx = makeReadCtx(wallet);
    const baselings = await getMyBaselings(ctx);
    return res.json({ wallet, count: baselings.length, baselings });
  } catch (e) {
    console.error('[agent-sdk] GET /agent/baselings:', e.message);
    return res.status(500).json({ error: 'Failed to fetch baselings: ' + e.message });
  }
});

// GET /agent/baseling/:tokenId — On-chain state for a single baseling
// Requires ?wallet= query param for pendingPoop lookup
router.get('/agent/baseling/:tokenId', async (req, res) => {
  const { tokenId } = req.params;
  if (!isValidTokenId(tokenId)) {
    return res.status(400).json({ error: 'Invalid tokenId — must be a positive integer' });
  }

  // wallet is needed for pendingPoop; fall back to zero address if not provided
  const wallet = req.query.wallet;
  const ownerAddr = wallet && isValidAddress(wallet)
    ? wallet
    : ethers.ZeroAddress;

  try {
    const ctx = makeReadCtx(ownerAddr);
    const baseling = await getBaseling(ctx, Number(tokenId));

    if (!baseling) {
      return res.status(404).json({ error: `Baseling #${tokenId} not found or does not exist` });
    }

    return res.json(baseling);
  } catch (e) {
    console.error('[agent-sdk] GET /agent/baseling:', e.message);
    return res.status(500).json({ error: 'Failed to fetch baseling: ' + e.message });
  }
});

// GET /agent/food/:wallet — Food stock in cupboard per food type
router.get('/agent/food/:wallet', async (req, res) => {
  const { wallet } = req.params;
  if (!isValidAddress(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    const ctx = makeReadCtx(wallet);
    const food = await getFoodStock(ctx);
    return res.json({ wallet, food });
  } catch (e) {
    console.error('[agent-sdk] GET /agent/food:', e.message);
    return res.status(500).json({ error: 'Failed to fetch food stock: ' + e.message });
  }
});

// GET /agent/gardens — Global garden pool statuses (no wallet needed)
router.get('/agent/gardens', async (req, res) => {
  try {
    const ctx = makeReadCtx(ethers.ZeroAddress);
    const gardens = await getGardenStatus(ctx);
    return res.json({ gardens });
  } catch (e) {
    console.error('[agent-sdk] GET /agent/gardens:', e.message);
    return res.status(500).json({ error: 'Failed to fetch garden status: ' + e.message });
  }
});

// GET /agent/assignments/:wallet — Worker assignments for the wallet
router.get('/agent/assignments/:wallet', async (req, res) => {
  const { wallet } = req.params;
  if (!isValidAddress(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    const ctx = makeReadCtx(wallet);
    const assignments = await getAssignments(ctx);
    return res.json({ wallet, count: assignments.length, assignments });
  } catch (e) {
    console.error('[agent-sdk] GET /agent/assignments:', e.message);
    return res.status(500).json({ error: 'Failed to fetch assignments: ' + e.message });
  }
});

// GET /agent/houses/:wallet — Houses owned by the wallet
router.get('/agent/houses/:wallet', async (req, res) => {
  const { wallet } = req.params;
  if (!isValidAddress(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    const ctx = makeReadCtx(wallet);
    const houses = await getHouses(ctx);
    return res.json({ wallet, count: houses.length, houses });
  } catch (e) {
    console.error('[agent-sdk] GET /agent/houses:', e.message);
    return res.status(500).json({ error: 'Failed to fetch houses: ' + e.message });
  }
});

// GET /agent/poop/:wallet — Pending POOP for all owned baselings
router.get('/agent/poop/:wallet', async (req, res) => {
  const { wallet } = req.params;
  if (!isValidAddress(wallet)) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    const ctx = makeReadCtx(wallet);

    // First get the baseling list to know which tokenIds to check
    const baselings = await getMyBaselings(ctx);
    if (!baselings || baselings.length === 0) {
      return res.json({ wallet, baselingCount: 0, pendingPoop: {}, total: '0' });
    }

    const tokenIds = baselings.map(b => b.id);
    const poop = await getPendingPoop(ctx, tokenIds);

    return res.json({
      wallet,
      baselingCount: tokenIds.length,
      pendingPoop: poop,
    });
  } catch (e) {
    console.error('[agent-sdk] GET /agent/poop:', e.message);
    return res.status(500).json({ error: 'Failed to fetch pending poop: ' + e.message });
  }
});

// GET /agent/prices — Current egg prices in M currency
router.get('/agent/prices', async (req, res) => {
  try {
    const ctx = makeReadCtx(ethers.ZeroAddress);
    const prices = await getEggPrices(ctx);
    return res.json({
      eggPrices: prices,
      note: 'Prices in M currency (1M = 0.01 USDC)',
    });
  } catch (e) {
    console.error('[agent-sdk] GET /agent/prices:', e.message);
    return res.status(500).json({ error: 'Failed to fetch prices: ' + e.message });
  }
});

// GET /agent/stats — Global on-chain game statistics
router.get('/agent/stats', async (req, res) => {
  try {
    const ctx = makeReadCtx(ethers.ZeroAddress);
    const stats = await getGlobalStats(ctx);
    return res.json(stats);
  } catch (e) {
    console.error('[agent-sdk] GET /agent/stats:', e.message);
    return res.status(500).json({ error: 'Failed to fetch global stats: ' + e.message });
  }
});

// GET /agent/guide — Landing page for any agent that discovers the API
router.get('/agent/guide', async (req, res) => {
  // Pull live stats so agents see an active economy, not a static pitch
  let liveStats = null;
  try {
    const ctx = makeReadCtx(ethers.ZeroAddress);
    liveStats = await getGlobalStats(ctx);
  } catch (e) { /* stats are optional — guide still works without them */ }

  return res.json({
    game: 'Baselings',
    chain: 'Base (8453)',
    pitch: 'Yield-generating pet game. Your agent earns USDC/ETH/BTC by raising baselings. Retire carbon credits as a side effect. $10 entry for a productive worker.',
    install: {
      mcp: 'npx baselings-mcp',
      mcp_env: 'GAME_WALLET_KEY=0x...',
      claude_desktop: 'Copy claude-desktop-config.example.json from the npm package',
      npm: 'npm install -g baselings-mcp',
      rest_api: 'https://tasern.quest/api/baseling/agent/ (no auth for reads)',
      openapi: 'https://tasern.quest/api/baseling/agent/openapi.yaml',
    },
    security: {
      architecture: 'Thin pipe over forever vaults. The game wallet is a relay — assets belong in YOUR wallet, not ours.',
      vaults: 'LP deposited into baseling vaults is locked in the NFT contract forever. No admin key can withdraw it. The vault earns swap fees for the NFT holder permanently.',
      game_wallet: 'The game wallet (GAME_WALLET_KEY) is a hot relay for transactions. Keep minimal balance. Move yields to your main wallet regularly.',
      nft_ownership: 'Baseling NFTs should be held in your main wallet, not the game wallet. The NFT IS the vault — whoever holds it owns the stacked LP yield.',
      poop_flow: 'POOP is tradeable on market, but every mint flows through the game and into LPs before reaching markets. No free tokens for anyone, ever. Every POOP in circulation was earned by gameplay and routed through LP deposits first.',
      honest_risk: 'The game server and keeper are centralized infrastructure. A breach could lose in-game POOP or pending claims. It CANNOT touch your vault LP (on-chain, immutable), your NFTs (in your wallet), or your blue chip yields (sent to main wallet). Keep exposure in the game wallet low.',
      recommendation: 'Use a dedicated game wallet with small USDC balance. Transfer NFTs and yield to your main wallet. The game is a thin pipe — your vaults and wallet are the safe.',
    },
    capital_efficiency: {
      '$10': '1 egg + PP worker to STR 10 — 3,000 POOP/day, 40% as USDC',
      '$25': 'PP worker + garden worker — yield + compounding LP',
      '$70': 'Full 5-baseling squad — self-sustaining pipeline',
    },
    strategies: ['green (impact/carbon)', 'meme (BRETT/BUSTER)', 'bluechip (ETH/BTC)', 'broad (diversified)', 'custom (agent decides)'],
    currency: 'M (1M = 0.01 USDC)',
    overview: 'Baselings is a Tamagotchi-meets-DeFi pet game on Base chain. Players hatch egg NFTs, feed them LP-token food, earn POOP tokens, and assign workers to gardens and power plants. Every deposit stacks permanently — baselings become yield-generating NFTs.',
    quickStart: [
      '1. Buy an egg ($0.10 USDC)',
      '2. Hatch and feed your baseling with food (LP tokens)',
      '3. Build stats by feeding specific food types (BTC→STR, WETH→DEX, TGN→WIS)',
      '4. Assign to a job: garden (yield), power plant (blue chips), hauler (logistics)',
      '5. Claim POOP, deposit to gardens, compound forever',
      '6. Transfer NFTs + yields to your main wallet — keep game wallet lean',
    ],
    families: {
      TGN:     { index: 0, stats: 'WIS, CON, CHA', description: 'Impact — funds environmental projects' },
      BURGERS: { index: 1, stats: 'CON (3x)', description: 'Impact — donates to feed people' },
      AZUSD:   { index: 2, stats: 'All (0.5x)', description: 'Regenerative agriculture token' },
      WETH:    { index: 3, stats: 'DEX, INT', description: 'Blue chip pairing' },
      BTC:     { index: 4, stats: 'STR (1.5x), CON (1.5x)', description: 'Blue chip pairing' },
    },
    jobs: {
      garden:  'WIS-based. Shovels POOP into garden pools → food LP yield. 3,000 POOP/day at lv10.',
      pp:      'STR-based. Burns POOP + meme tokens → USDC/ETH/BTC yield. 3,000 POOP/day at lv10.',
      hauler:  'DEX-based. Moves POOP from houses to gardens/PP. 1,000/day at lv10. Need 3 per shoveler.',
      nanny:   'CHA-based (lv3+). Cares for baselings in a room. 5% skim of room worker yield.',
    },
    impact: {
      CHAR: 'Retires carbon credits with every garden deposit',
      TGN: 'LP fees fund environmental projects',
      BURGERS: 'LP fees donate to feed people IRL',
      note: 'Impact is free — same pipeline as yield. No trade-off.',
    },
    live: liveStats || 'Stats temporarily unavailable — try GET /agent/stats directly',
    endpoints: {
      status:      'GET /agent/status/:wallet',
      baselings:   'GET /agent/baselings/:wallet',
      baseling:    'GET /agent/baseling/:tokenId?wallet=0x...',
      food:        'GET /agent/food/:wallet',
      gardens:     'GET /agent/gardens',
      assignments: 'GET /agent/assignments/:wallet',
      houses:      'GET /agent/houses/:wallet',
      poop:        'GET /agent/poop/:wallet',
      prices:      'GET /agent/prices',
      stats:       'GET /agent/stats',
      guide:       'GET /agent/guide',
      openapi:     'GET /agent/openapi.yaml',
      economyRules:   'GET /agent/economy/rules',
      feedingGuide:   'GET /agent/economy/feeding/:job',
      buildPhase:     'GET /agent/economy/phase/:wallet',
      flywheel:       'GET /agent/tokenomics/flywheel',
      metrics:        'GET /agent/tokenomics/metrics',
      pitch:          'GET /agent/tokenomics/pitch',
    },
    mcp_tools: '35 tools (10 read, 12 write, 3 strategy, 3 tokenomics, 3 economy, 1 info)',
    writeActions: 'Write actions require the MCP server with GAME_WALLET_KEY, or the SDK with a local signer.',
    tokens: {
      MfT: '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3',
      POOP: '0x126555aecBAC290b25644e4b7f29c016aE95f4dc',
      BaselingNFT: '0xFCb825491490284189C75fD330Fd08Df5E9217b9',
    },
    links: {
      game: 'https://tasern.quest/baseling',
      npm: 'https://www.npmjs.com/package/baselings-mcp',
    },
  });
});

// GET /agent/openapi.yaml — Serve OpenAPI spec
router.get('/agent/openapi.yaml', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const specPath = path.join(__dirname, 'openapi.yaml');
  try {
    const spec = fs.readFileSync(specPath, 'utf8');
    res.type('text/yaml').send(spec);
  } catch (e) {
    res.status(404).json({ error: 'OpenAPI spec not found' });
  }
});

// ── Tokenomics endpoints ──
router.get('/agent/tokenomics/flywheel', (req, res) => {
  try {
    const tokenomics = require('./tokenomics');
    res.json(tokenomics.getMftFlywheel());
  } catch (e) {
    console.error('[agent-sdk] flywheel:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/agent/tokenomics/metrics', async (req, res) => {
  try {
    const tokenomics = require('./tokenomics');
    const readCtx = makeReadCtx('0x0000000000000000000000000000000000000000');
    const metrics = await tokenomics.getTokenomicsMetrics(readCtx);
    res.json(metrics);
  } catch (e) {
    console.error('[agent-sdk] metrics:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/agent/tokenomics/pitch', (req, res) => {
  try {
    const tokenomics = require('./tokenomics');
    res.json({ pitch: tokenomics.getAgentPitch() });
  } catch (e) {
    console.error('[agent-sdk] pitch:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Economy endpoints (no wallet needed) ──────────────────────────────────

router.get('/agent/economy/rules', (req, res) => {
  try {
    const strats = require('./strategies');
    res.json({
      constraints: strats.ECONOMY_CONSTRAINTS,
      buildOrder: strats.BUILD_ORDER,
      foodStatMap: strats.FOOD_STAT_MAP,
      jobRequirements: strats.JOB_REQUIREMENTS,
      warnings: [
        'Feeding more than $5/2.4hr without haulers wastes yield',
        'House poop cap is 5000 — overflow goes to PP at lowest tier',
        'Baselings die after 14 days without food',
        'Every feed permanently locks LP in baseling vault',
        'POOP has ~4hr delay before claimable',
        'Keeper auto-harvests every 2.4hr cycle',
      ],
    });
  } catch (e) {
    console.error('[agent-sdk] economy rules:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/agent/economy/feeding/:job', (req, res) => {
  try {
    const strats = require('./strategies');
    res.json(strats.recommendFeeding(req.params.job));
  } catch (e) {
    console.error('[agent-sdk] feeding guide:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/agent/economy/phase/:wallet', async (req, res) => {
  try {
    const strats = require('./strategies');
    const ctx = makeReadCtx(req.params.wallet);
    const [baselings, assignments] = await Promise.all([
      getMyBaselings(ctx),
      getAssignments(ctx),
    ]);
    const phase = strats.getBuildPhase({ baselings, assignments });
    res.json({ ...phase, buildOrder: strats.BUILD_ORDER });
  } catch (e) {
    console.error('[agent-sdk] build phase:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Export router + verifyWallet middleware (for future write endpoints)
module.exports = router;
module.exports.verifyWallet = verifyWallet;
