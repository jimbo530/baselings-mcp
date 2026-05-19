// Reactor-Aligned DCA Runner
// Buys MfT during the compression window (15-30 min before Prime fires)
// Runs standalone via cron/PM2 on a 2-hour interval
//
// Usage:
//   node dca-runner.js           (single cycle, then exits)
//   node dca-runner.js --loop    (runs every 2 hours)

const { ethers } = require('ethers');
const { createSwapContext, swapToken, getArbSignal, getSwapStatus, ALLOWED_TOKENS, MAX_SWAP_USD, COOLDOWN_MS } = require('./swap.js');

// ── Config ──────────────────────────────────────────────────────────────────
const BASE_RPC = 'https://mainnet.base.org';
const PRIME_REACTOR = '0xed3aE91b2bb22307c07438EEebA2500C18EABcFE';
const TIME_UNTIL_EXECUTE_SELECTOR = '0xd46cd1c9'; // timeUntilExecute()

const COMPRESSION_WINDOW_MIN = 15; // Start buying when reactor is 15 min away
const COMPRESSION_WINDOW_MAX = 30; // Only if within 30 min
const SECOND_BUY_DELAY_MS = 90_000; // 90 seconds between buys
const LOOP_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const BUY_AMOUNT_USD = 0.10;

// ── Logging ─────────────────────────────────────────────────────────────────
function log(msg) {
  process.stderr.write(`[dca ${new Date().toISOString()}] ${msg}\n`);
}

// ── Reactor Timing ──────────────────────────────────────────────────────────
async function getReactorTimeLeft(provider) {
  try {
    const data = await provider.call({
      to: PRIME_REACTOR.toLowerCase(),
      data: TIME_UNTIL_EXECUTE_SELECTOR,
      gas: '0x1C9C380', // 30M
    });

    if (!data || data.length < 66) {
      log(`WARNING: Unexpected timeUntilExecute response length: ${data ? data.length : 'null'}`);
      return null;
    }

    const seconds = Number(BigInt(data.slice(0, 66)));
    return seconds;
  } catch (e) {
    log(`ERROR: Failed to read reactor timing: ${(e.message || String(e)).slice(0, 150)}`);
    return null;
  }
}

// ── DCA Buy Logic ───────────────────────────────────────────────────────────
async function executeBuy(swapCtx, provider, reason) {
  // Check guardrails first
  const status = getSwapStatus();
  if (!status.ready) {
    log(`SKIP: Cooldown active (${status.cooldownRemainingSeconds}s remaining)`);
    return { skipped: true, reason: 'cooldown' };
  }
  if (status.dailyRemainingUSD < BUY_AMOUNT_USD) {
    log(`SKIP: Daily limit reached. Remaining: $${status.dailyRemainingUSD.toFixed(4)}`);
    return { skipped: true, reason: 'daily_limit' };
  }

  // Get arb signal to find cheapest pool
  log('Checking arb signal for cheapest MfT pool...');
  const arb = await getArbSignal(provider, null);

  // Determine which quote token to buy from (cheapest pool)
  // Use WETH by default — trade wallet funded with ETH, not USDC
  let buyFromToken = ALLOWED_TOKENS.WETH;
  let buyFromSymbol = 'WETH';

  if (arb && arb.spread && arb.spread.buyIn) {
    const cheapPool = arb.spread.buyIn; // e.g., "MfT/WETH"
    log(`Arb signal: cheapest pool = ${cheapPool} (spread: ${arb.spread.percentage})`);
  } else {
    log('No arb spread data; defaulting to WETH buy');
  }

  // Execute swap: WETH -> MfT
  log(`Executing $${BUY_AMOUNT_USD} WETH -> MfT buy (reason: ${reason})`);
  const result = await swapToken(swapCtx, buyFromToken, ALLOWED_TOKENS.MfT, BUY_AMOUNT_USD);

  if (result.error) {
    log(`BUY FAILED: ${result.error}`);
    return { success: false, error: result.error };
  }

  log(`BUY SUCCESS: ${result.note}`);
  return { success: true, txHash: result.swap.txHash };
}

// ── Main Cycle ──────────────────────────────────────────────────────────────
async function runCycle() {
  log('=== DCA Cycle Start ===');

  const privateKey = process.env.TRADE_WALLET_KEY || process.env.TRADE_PRIVATE_KEY;
  if (!privateKey) {
    log('FATAL: TRADE_WALLET_KEY (or TRADE_PRIVATE_KEY) not set in environment');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(BASE_RPC);
  const swapCtx = createSwapContext(privateKey);

  // Read reactor timing
  const timeLeftSeconds = await getReactorTimeLeft(provider);
  const timeLeftMinutes = timeLeftSeconds !== null ? Math.round(timeLeftSeconds / 60) : null;

  let shouldBuy = false;
  let reason = '';

  if (timeLeftMinutes === null) {
    // Cannot read reactor -- fallback: buy anyway (per spec)
    shouldBuy = true;
    reason = 'reactor_unreadable_fallback';
    log('WARNING: Cannot read reactor timing. Buying anyway (fallback mode).');
  } else if (timeLeftMinutes === 0) {
    // Reactor is ready to fire (or just fired)
    shouldBuy = true;
    reason = 'reactor_ready';
    log(`Reactor is READY (0 min left). Buying in post-fire window.`);
  } else if (timeLeftMinutes <= COMPRESSION_WINDOW_MAX && timeLeftMinutes >= COMPRESSION_WINDOW_MIN) {
    // In the sweet spot: 15-30 min before firing
    shouldBuy = true;
    reason = 'compression_window';
    log(`Reactor fires in ${timeLeftMinutes} min. COMPRESSION WINDOW -- executing buys.`);
  } else if (timeLeftMinutes < COMPRESSION_WINDOW_MIN) {
    // Less than 15 min -- still buy, just not ideal timing
    shouldBuy = true;
    reason = 'near_fire';
    log(`Reactor fires in ${timeLeftMinutes} min (<${COMPRESSION_WINDOW_MIN} min). Buying.`);
  } else {
    // Reactor is too far out
    log(`Reactor fires in ${timeLeftMinutes} min (>${COMPRESSION_WINDOW_MAX} min window). Skipping this cycle.`);
    shouldBuy = false;
  }

  if (!shouldBuy) {
    log('=== DCA Cycle End (no buy) ===');
    return;
  }

  // First buy
  const buy1 = await executeBuy(swapCtx, provider, reason);

  if (buy1.skipped || !buy1.success) {
    log('=== DCA Cycle End (first buy failed/skipped) ===');
    return;
  }

  // Wait 90 seconds for second buy
  log(`Waiting ${SECOND_BUY_DELAY_MS / 1000}s before second buy...`);
  await new Promise(resolve => setTimeout(resolve, SECOND_BUY_DELAY_MS));

  // Second buy
  const buy2 = await executeBuy(swapCtx, provider, reason + '_second');

  if (buy2.success) {
    log('Both buys executed successfully.');
  } else if (buy2.skipped) {
    log(`Second buy skipped: ${buy2.reason}`);
  } else {
    log(`Second buy failed: ${buy2.error}`);
  }

  log('=== DCA Cycle End ===');
}

// ── Entry Point ─────────────────────────────────────────────────────────────
async function main() {
  const loopMode = process.argv.includes('--loop');

  if (loopMode) {
    log('Starting in LOOP mode (every 2 hours)');
    // Run immediately, then repeat
    while (true) {
      try {
        await runCycle();
      } catch (e) {
        log(`UNHANDLED ERROR in cycle: ${(e.message || String(e)).slice(0, 200)}`);
        log(`Stack: ${(e.stack || '').slice(0, 300)}`);
      }
      log(`Sleeping ${LOOP_INTERVAL_MS / 1000 / 60} minutes until next cycle...`);
      await new Promise(resolve => setTimeout(resolve, LOOP_INTERVAL_MS));
    }
  } else {
    // Single run
    try {
      await runCycle();
    } catch (e) {
      log(`FATAL: ${(e.message || String(e)).slice(0, 200)}`);
      log(`Stack: ${(e.stack || '').slice(0, 300)}`);
      process.exit(1);
    }
  }
}

main();
