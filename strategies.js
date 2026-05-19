// Baselings Agent SDK — Strategy Playbooks (Schools of Thought)
// Pick a strategy at the door. The SDK tells you exactly what to do.
// Humans raise pets, play games, get paid. Agents optimize the engine.

const { POOL_INDEX, FOOD_FAMILY_IDX, GARDEN_POOLS } = require('./contracts');

// ── Economy Constants ──
// These are the physical laws of the Baseling economy.
// Breaking them wastes capital. Following them compounds yield.

const FOOD_STAT_MAP = {
  // What stats each food grows when fed to a baseling
  // Stats: [STR, DEX, CON, INT, WIS, CHA]
  tgn:     { wis: 1.0, con: 1.0, cha: 1.0 },
  burgers: { con: 3.0 },
  azusd:   { str: 0.5, dex: 0.5, con: 0.5, int: 0.5, wis: 0.5, cha: 0.5 },
  weth:    { dex: 1.0, int: 1.0 },
  btc:     { str: 1.5, con: 1.5 },  // user flagged: may change to str:1, dex:1, con:1
};

const JOB_REQUIREMENTS = {
  // What stats matter for each job, and minimum thresholds
  garden:  { primaryStat: 'wis', description: 'Tends garden pools. WIS determines yield share.' },
  hauler:  { primaryStat: 'dex', description: 'Moves food between systems. DEX determines throughput. Earns 5% skim.' },
  pp:      { primaryStat: 'str', description: 'Power plant worker. STR scales burn ratio. Burns POOP for blue chips.' },
  nanny:   { primaryStat: 'cha', minLevel: 3, description: 'Cares for baselings in rooms. CHA 3+ required. Earns 5% skim of room yield.' },
};

// Optimal feeding strategy per target job
const JOB_FEEDING_PLAN = {
  garden:  ['tgn', 'azusd'],          // TGN gives WIS directly; AZUSD gives broad including WIS
  hauler:  ['weth', 'azusd'],          // WETH gives DEX; AZUSD gives broad
  pp:      ['btc', 'azusd'],           // BTC gives STR; AZUSD supplements
  nanny:   ['tgn', 'azusd'],           // TGN gives CHA; AZUSD gives broad
};

const ECONOMY_CONSTRAINTS = {
  poopDelay:       4,          // hours before minted POOP is claimable
  keeperCycle:     2.4,        // hours between keeper auto-harvest
  maxFeedPerCycle: 5.00,       // USD — feeding more than this without haulers wastes yield
  housePoopCap:    500,        // base POOP per house — decorations increase cap, overflow burns
  careTimer:       3,          // days — baseling dies if not fed within this
  mealCost:        0.01,       // USD per meal (10000 raw USDC)
  eggCost:         0.10,       // USD per random egg
};

// The 4-phase build order for a new economy from zero.
// Phase 1 must complete before Phase 2 matters.
const BUILD_ORDER = [
  {
    phase: 1,
    name: 'Gardener',
    description: 'Your first worker should be a gardener. Gardens turn POOP into yield.',
    target: { job: 'garden', stat: 'wis', food: ['tgn', 'azusd'] },
    why: 'Without a gardener, POOP just sits. Gardens are the engine.',
  },
  {
    phase: 2,
    name: 'Haulers (x2)',
    description: 'Two haulers unlock the food supply chain. DEX stat scales throughput.',
    target: { job: 'hauler', stat: 'dex', food: ['weth', 'azusd'] },
    why: 'Without haulers, max throughput is $5/2.4hr. Haulers move food and earn 5% skim.',
  },
  {
    phase: 3,
    name: 'Power Plant Worker',
    description: 'PP worker burns POOP for blue chip yield. STR scales burn efficiency.',
    target: { job: 'pp', stat: 'str', food: ['btc', 'azusd'] },
    why: 'PP burns POOP+X tokens for ETH/BTC. Deflationary pressure on POOP supply.',
  },
  {
    phase: 4,
    name: 'Nanny',
    description: 'Nanny automates poop cleanup in rooms. Needs CHA level 3+. Last priority.',
    target: { job: 'nanny', stat: 'cha', food: ['tgn', 'azusd'] },
    why: 'An active agent can manually clean poop. Nanny is a luxury, not a necessity.',
  },
];

// ── Strategy Definitions ──
// Each strategy defines:
//   pools     — which garden/PP pools to target (ordered by priority)
//   food      — preferred food families to buy
//   deposits  — where to deposit POOP (ordered by priority)
//   ppPools   — power plant pools to burn in (if any)
//   playbook  — step-by-step instructions for the agent
//   vibe      — one-line pitch for the strategy

const STRATEGIES = {

  // ── GREEN MACHINE ──
  // Impact-first. Every pool here does real-world good.
  // CHAR burns carbon. TGN is an impact asset. BURGERS donates LP fees to feed people.
  // MfT plants trees on every harvest. This whole path prints impact receipts.
  green: {
    name: 'Green Machine',
    vibe: 'Retire carbon credits, plant trees, feed people. Every pool does real-world good — and you earn yield doing it.',
    pools: ['char', 'tgn', 'burgers', 'burger_flower', 'azos', 'lettuce', 'rice'],
    food: ['tgn', 'burgers', 'azusd'],
    deposits: [
      { pool: 'char',          reason: 'Burns carbon tokens via community garden — real carbon retirement' },
      { pool: 'tgn',           reason: 'TGN is an impact asset — LP fees fund environmental projects' },
      { pool: 'burgers',       reason: 'BURGERS donates LP fees to feed people IRL — impact + yield' },
      { pool: 'burger_flower', reason: 'BURGER FLOWER — more BURGERS yield, more meals donated' },
      { pool: 'azos',          reason: 'AZOS tree — regenerative agriculture yield' },
      { pool: 'lettuce',       reason: 'Grows salad food LP — sustainable food chain' },
      { pool: 'rice',          reason: 'Rice paddy — food production yield' },
    ],
    ppPools: ['char', 'tgn', 'burgers'],
    playbook: [
      'Run ensure_approvals to set up token permissions',
      'Buy 1-3 eggs (any family works — TGN or BURGERS family for thematic fit)',
      'Hatch eggs and feed with TGN or BURGERS food (both are impact assets)',
      'Claim POOP after 4hr delay → deposit into house vault (deposit_poop_to_house)',
      'From house vault, sendPoop to CHAR GARDEN first (retires carbon credits)',
      'Then TGN GARDEN (impact asset LP fees fund environmental work)',
      'Then BURGER TREE (LP fees donate to feed people)',
      'Overflow to AZOS, LETTUCE, RICE farms for food production',
      'Place storage decorations in house to increase POOP vault cap beyond 500 base',
      'Assign baselings as garden workers on impact pools (WIS stat matters)',
      'Keeper cycles every 2.4hrs — your workers auto-earn',
      'MfT gets bought+burned on every harvest — trees get planted IRL',
      'POOP flow: baseling → wallet → house vault → sendPoop to gardens/PP',
      'Your yield: food LP + carbon credits + TGN + BURGERS + MfT burn credit',
      'Every token you earn here does real-world good. Impact receipts on-chain.',
    ],
  },

  // ── MEME MACHINE ──
  // Pure meme plays — BRETT, BUSTER, FUN. The degen pool.
  // BURGERS and TGN are impact assets that also have meme energy,
  // but this path is for the tokens that are meme-first.
  meme: {
    name: 'Meme Machine',
    vibe: 'Maximum meme exposure. BRETT, BUSTER, BURGERS — ride every wave, earn every token.',
    pools: ['brett', 'buster', 'burgers', 'buster_berry', 'burger_flower', 'tgn'],
    food: ['burgers', 'tgn'],
    deposits: [
      { pool: 'brett',          reason: 'BRETT GARDEN — earns BRETT from community garden' },
      { pool: 'buster',        reason: 'BUSTER GARDEN — earns BUSTER tokens' },
      { pool: 'burgers',       reason: 'BURGER TREE — grows burger food + earns BURGERS (also feeds people IRL)' },
      { pool: 'buster_berry',  reason: 'BUSTER BERRY — grows buster berry food' },
      { pool: 'burger_flower', reason: 'BURGER FLOWER — special BURGERS garden' },
      { pool: 'tgn',           reason: 'TGN GARDEN — earns TGN (impact asset with meme energy)' },
    ],
    ppPools: ['brett', 'buster', 'burgers'],
    playbook: [
      'Run ensure_approvals to set up token permissions',
      'Buy eggs — random for variety, or giant for bigger stats',
      'Hatch and feed with BURGERS food (cheapest, most liquid)',
      'Claim POOP after 4hr delay → deposit into house vault (deposit_poop_to_house)',
      'From house vault, sendPoop across meme pools: BRETT and BUSTER first for pure meme',
      'BURGERS pool also earns yield AND feeds people — meme with a conscience',
      'Place storage decorations to boost house vault cap beyond 500 base',
      'Assign workers to BRETT GARDEN and BUSTER GARDEN (WIS stat)',
      'Power Plant burns POOP+meme tokens — assign STR-heavy baselings there',
      'Keeper cycles every 2.4hrs — harvests all pools automatically',
      'POOP flow: baseling → wallet → house vault → sendPoop to gardens/PP',
      'Your yield: meme tokens + food LP + POOP compound',
    ],
  },

  // ── BLUE CHIP ──
  // Conservative. WETH and cbBTC exposure. Slow and steady.
  // Hidden garden pools that earn real ETH and BTC.
  bluechip: {
    name: 'Blue Chip',
    vibe: 'Conservative yield in ETH and BTC. Slow, steady, real value accrual.',
    pools: ['weth', 'cbbtc', 'berry'],
    food: ['weth', 'btc'],
    deposits: [
      { pool: 'weth',  reason: 'ETH PATCH — earns WETH from community garden' },
      { pool: 'cbbtc', reason: 'BTC PATCH — earns cbBTC from community garden' },
      { pool: 'berry', reason: 'BERRY BUSH — WETH-backed food, tangible harvest' },
    ],
    ppPools: ['weth'],
    playbook: [
      'Run ensure_approvals to set up token permissions',
      'Buy eggs (any type — stats matter more than family for blue chip)',
      'Hatch and feed with WETH food (blue chip food = ETH-backed LP)',
      'Claim POOP after 4hr delay → deposit into house vault (deposit_poop_to_house)',
      'From house vault, sendPoop to ETH PATCH first, then BTC PATCH',
      'BERRY BUSH for overflow — grows berry food backed by WETH',
      'Place storage decorations to boost house vault cap beyond 500 base',
      'Assign workers to ETH/BTC pools (WIS stat)',
      'Power Plant workers burn POOP for blue chip yield (STR stat)',
      'POOP flow: baseling → wallet → house vault → sendPoop to gardens/PP',
      'Keeper harvests every 2.4hrs — yields accumulate in ETH + BTC',
      'Your yield: WETH + cbBTC + food LP. Real assets, no meme risk.',
    ],
  },

  // ── BROAD ──
  // Diversified. A little of everything. Balanced risk, balanced reward.
  broad: {
    name: 'Broad Portfolio',
    vibe: 'Diversified across impact, memes, and blue chips. Balance everything.',
    pools: ['burgers', 'weth', 'char', 'brett', 'rice', 'berry', 'tgn', 'cbbtc'],
    food: ['burgers', 'tgn', 'weth'],
    deposits: [
      { pool: 'burgers', reason: 'BURGER TREE — impact (feeds people) + food yield' },
      { pool: 'weth',    reason: 'ETH PATCH — blue chip stability' },
      { pool: 'char',    reason: 'CHAR GARDEN — impact/carbon retirement' },
      { pool: 'tgn',     reason: 'TGN GARDEN — impact asset yield' },
      { pool: 'brett',   reason: 'BRETT GARDEN — meme diversification' },
      { pool: 'rice',    reason: 'RICE PADDY — food production' },
      { pool: 'berry',   reason: 'BERRY BUSH — ETH-backed food' },
      { pool: 'cbbtc',   reason: 'BTC PATCH — blue chip stability' },
    ],
    ppPools: ['burgers', 'weth', 'char'],
    playbook: [
      'Run ensure_approvals to set up token permissions',
      'Buy 3+ eggs across different families for stat diversity',
      'Hatch all and rotate feeding: BURGERS → TGN → WETH',
      'Claim POOP after 4hr delay → deposit into house vault (deposit_poop_to_house)',
      'From house vault, sendPoop split: 25% blue chip (WETH/BTC), 25% meme (BRETT/BUSTER), 50% impact (CHAR/TGN/BURGERS)',
      'Place storage decorations to boost house vault cap beyond 500 base',
      'Assign workers across multiple pools — spread the WIS',
      'Some workers in Power Plant for burn yield (STR-heavy ones)',
      'POOP flow: baseling → wallet → house vault → sendPoop to gardens/PP',
      'Keeper cycles every 2.4hrs — all pools harvest automatically',
      'Rebalance monthly: check get_garden_status, shift POOP to highest-yield pools',
      'Your yield: mixed basket of ETH, BTC, meme tokens, food LP, carbon credits, meals donated',
    ],
  },

  // ── PLAYER DETERMINED ──
  // No guardrails. Agent picks its own strategy based on current yields.
  // Uses get_garden_status to find optimal allocation dynamically.
  custom: {
    name: 'Player Determined',
    vibe: 'No preset path. Analyze yields, pick your own pools, optimize freely.',
    pools: [], // agent decides
    food: [],  // agent decides
    deposits: [],
    ppPools: [],
    playbook: [
      'Run ensure_approvals to set up token permissions',
      'Call get_garden_status to see all pool yields and worker counts',
      'Call get_global_stats for POOP supply and burn rate',
      'Call get_egg_prices to find best entry point',
      'Buy eggs based on your analysis',
      'Choose food family based on LP depth and your preferred pools',
      'Claim POOP after 4hr delay → deposit into house vault (deposit_poop_to_house)',
      'Check house vault cap (get_house_vault) — place storage decorations to increase cap',
      'From house vault, sendPoop to pools based on current yield data — highest BPS first',
      'Under-worked pools may offer better per-worker yield (fewer workers = larger share)',
      'Power Plant pools burn POOP+X tokens — good for tokens you want to reduce supply of',
      'Farm pools produce food LP — good for self-sustaining feeding loop',
      'Garden pools earn the paired token directly — good for token accumulation',
      'POOP flow: baseling → wallet → house vault → sendPoop to gardens/PP',
      'Rebalance every keeper cycle (2.4hrs) based on fresh yield data',
      'Track your performance: get_balances before and after each cycle',
    ],
  },
};

// ── Strategy Selector ──
// Returns the full strategy object for a given key
function getStrategy(key) {
  if (!STRATEGIES[key]) {
    return { error: `Unknown strategy: ${key}. Choose: ${Object.keys(STRATEGIES).join(', ')}` };
  }
  return STRATEGIES[key];
}

// ── Strategy Overview ──
// Returns a summary of all strategies for the agent to choose from
function listStrategies() {
  return Object.entries(STRATEGIES).map(([key, s]) => ({
    key,
    name: s.name,
    vibe: s.vibe,
    poolCount: s.pools.length,
    foodTypes: s.food,
  }));
}

// ── Determine Build Phase ──
// Where is this agent in their economy progression?
function getBuildPhase(state) {
  const baselings = state.baselings || [];
  const assignments = state.assignments || [];
  const count = baselings.length;

  if (count === 0) return { phase: 0, name: 'Bootstrap', next: BUILD_ORDER[0] };

  // Count assigned jobs
  const jobs = { garden: 0, hauler: 0, pp: 0, nanny: 0 };
  for (const a of assignments) {
    if (a.job && jobs.hasOwnProperty(a.job)) {
      jobs[a.job] += 1;
    }
  }

  if (jobs.garden === 0) return { phase: 1, name: 'Need Gardener', next: BUILD_ORDER[0], jobs };
  if (jobs.hauler < 2)   return { phase: 2, name: 'Need Haulers', next: BUILD_ORDER[1], jobs };
  if (jobs.pp === 0)     return { phase: 3, name: 'Need PP Worker', next: BUILD_ORDER[2], jobs };
  if (jobs.nanny === 0)  return { phase: 4, name: 'Need Nanny', next: BUILD_ORDER[3], jobs };

  return { phase: 5, name: 'Full Economy', next: null, jobs };
}

// ── Recommend Feeding for Job Target ──
// Given a baseling's target job, return what food to feed it
function recommendFeeding(targetJob) {
  const plan = JOB_FEEDING_PLAN[targetJob];
  if (!plan) return { error: `Unknown job: ${targetJob}` };
  return {
    job: targetJob,
    primaryStat: JOB_REQUIREMENTS[targetJob].primaryStat,
    feedWith: plan,
    statGains: plan.map(f => ({ food: f, stats: FOOD_STAT_MAP[f] })),
    tip: `Feed ${plan[0]} primarily for ${JOB_REQUIREMENTS[targetJob].primaryStat} growth. ${plan[1]} as supplement for breadth.`,
  };
}

// ── Generate Next Actions ──
// Given a strategy and current state, return what the agent should do RIGHT NOW
// Now economy-phase-aware: recommends actions appropriate to build phase
async function getNextActions(strategy, state) {
  const actions = [];
  const phase = getBuildPhase(state);

  // 0. Always verify approvals
  actions.push({ priority: 0, action: 'ensure_approvals', reason: 'Always verify approvals are set' });

  // 1. If no baselings, buy + hatch eggs (need 5 for full economy)
  const baselings = state.baselings || [];
  if (baselings.length === 0) {
    actions.push({ priority: 1, action: 'buy_egg', params: { type: 'random' }, reason: 'No baselings — buy your first egg' });
    actions.push({ priority: 2, action: 'hatch_egg', params: {}, reason: 'Hatch the egg to start earning' });
    return actions;
  }

  if (baselings.length < 5) {
    actions.push({
      priority: 1, action: 'buy_egg', params: { type: 'random' },
      reason: `Only ${baselings.length}/5 baselings — full economy needs 5 (1 gardener, 2 haulers, 1 PP, 1 nanny)`,
    });
  }

  // 2. Check care timer — feed any baseling within 3 days of death
  for (const b of baselings) {
    if (b.daysLeft !== undefined && b.daysLeft < 3) {
      actions.push({
        priority: 0, action: 'feed_baseling', params: { tokenId: b.id },
        reason: `URGENT: Baseling #${b.id} has ${b.daysLeft.toFixed(1)} days left — feed to prevent death!`,
      });
    }
  }

  // 3. Claim POOP if available (keeper auto-claims, but manual claim works too)
  if (state.pendingPoop && state.pendingPoop.total > 0) {
    const claimable = Object.entries(state.pendingPoop)
      .filter(([k, v]) => k !== 'total' && v > 0)
      .map(([k]) => parseInt(k));
    if (claimable.length > 0) {
      actions.push({ priority: 1, action: 'claim_poop', params: { tokenIds: claimable }, reason: `${claimable.length} baselings have claimable POOP` });
    }
  }

  // 4. Phase-aware feeding — feed the stat each baseling needs for its target job
  if (phase.next) {
    const targetFood = phase.next.target.food[0];
    actions.push({
      priority: 2, action: 'buy_food', params: { family: targetFood, amountUSDC: ECONOMY_CONSTRAINTS.mealCost },
      reason: `Phase ${phase.phase}: Growing ${phase.next.name} — buy ${targetFood} food (grows ${phase.next.target.stat})`,
    });
    actions.push({
      priority: 3, action: 'feed_baseling', params: { foodType: targetFood },
      reason: `Feed ${targetFood} to grow ${phase.next.target.stat} for ${phase.next.target.job} job`,
    });
  } else {
    // Full economy — rotate feeding across strategy foods
    for (const food of strategy.food) {
      actions.push({ priority: 3, action: 'feed_baseling', params: { foodType: food }, reason: `Maintenance feeding with ${food}` });
    }
  }

  // 5. Deposit POOP to priority pools (only if we have POOP)
  if (state.balances && state.balances.poop > 0) {
    // Route POOP through house vault before garden deposits
    const poopBal = parseFloat(state.balances.poop);
    if (poopBal > 0) {
      actions.push({
        priority: 2, action: 'deposit_poop_to_house',
        params: {},
        reason: `Deposit ${poopBal.toFixed(0)} POOP into house vault first — POOP flows: wallet → house vault → sendPoop to gardens/PP`,
      });
    }
    for (const dep of strategy.deposits.slice(0, 3)) {
      actions.push({ priority: 4, action: 'deposit_garden', params: { poolPair: dep.pool }, reason: dep.reason });
    }
  }

  // 6. Assign unassigned baselings (phase-aware job selection)
  if (state.assignments) {
    const assigned = new Set((state.assignments || []).map(a => a.baselingId));
    const idle = baselings.filter(b => !assigned.has(b.id));
    if (idle.length > 0) {
      const nextJob = phase.next ? phase.next.target.job : 'garden';
      const nextPool = strategy.pools[0] || 'burgers';
      actions.push({
        priority: 5, action: 'assign_worker',
        params: { job: nextJob, poolPair: nextPool },
        reason: `${idle.length} idle baseling(s) — Phase ${phase.phase}: assign as ${nextJob} in ${nextPool}`,
      });
    }
  }

  // 7. Build phase status for agent context
  actions.push({
    priority: 99, action: '_info',
    params: { buildPhase: phase, constraints: ECONOMY_CONSTRAINTS },
    reason: `Economy status: Phase ${phase.phase} (${phase.name}). ${phase.next ? 'Next: ' + phase.next.description : 'Full economy running.'}`,
  });

  return actions.sort((a, b) => a.priority - b.priority);
}

// ── Door Greeting ──
// The first thing an agent sees when it connects.
// Tells them what's available and asks them to pick.
function doorGreeting() {
  return {
    welcome: 'Welcome to Baselings — Tamagotchi meets DeFi on Base chain.',
    how_it_works: [
      'Buy eggs → hatch → feed baselings → earn POOP tokens',
      'Deposit POOP into house vault → sendPoop to garden pools for yield (food, memes, blue chips, carbon credits)',
      'House vault has a base cap of 500 POOP — place storage decorations to increase it',
      'Some tokens do real-world good: TGN funds environmental projects, BURGERS donates fees to feed people, CHAR retires carbon, MfT plants trees',
      'Assign baselings as workers — keeper harvests every 2.4 hours automatically',
      'Game mechanics are the rate limit — no API throttling, just economic physics',
      'Humans raise pets and play games. Agents optimize the yield engine.',
    ],
    pick_your_strategy: listStrategies(),
    next_step: 'Call choose_strategy with one of: green, meme, bluechip, broad, custom',
    humans_get: 'Prizes, games, and fun — funded by the yield agents generate.',
  };
}

module.exports = {
  STRATEGIES,
  FOOD_STAT_MAP,
  JOB_REQUIREMENTS,
  JOB_FEEDING_PLAN,
  ECONOMY_CONSTRAINTS,
  BUILD_ORDER,
  getStrategy,
  listStrategies,
  getNextActions,
  getBuildPhase,
  recommendFeeding,
  doorGreeting,
};
