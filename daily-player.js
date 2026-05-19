#!/usr/bin/env node
/**
 * daily-player.js — Agent plays Baselings a few times per day
 *
 * Discovers baselings on-chain, feeds urgent ones via SDK actions.
 * PM2: pm2 start daily-player.js --name baseling-player --cron "0 6,14,22 * * *"
 */

const path = require('path');
const envPath = process.env.DOTENV_PATH
  || (require('fs').existsSync(path.join(__dirname, '.env')) ? path.join(__dirname, '.env') : null)
  || path.join(__dirname, '..', 'api', '.env');
require('dotenv').config({ path: envPath });

const { ethers } = require('ethers');
const sdk = require('./index');

const GAME_WALLET_KEY = process.env.GAME_WALLET_KEY || process.env.AGENT_TEST_KEY;
if (!GAME_WALLET_KEY) {
  console.error('ERROR: GAME_WALLET_KEY (or AGENT_TEST_KEY) env var required. Set it in .env or environment.');
  process.exit(1);
}
const RPC_URL = process.env.ALCHEMY_RPC || 'https://mainnet.base.org';
const MAX_SPEND = 0.10; // USD per session
const DEATH_DAYS = 3;
const FEED_THRESHOLD = 2.5; // days left — feed if below this (was 2, wasted a day of margin)
const NFT_ADDR = '0xFCb825491490284189C75fD330Fd08Df5E9217b9';

function log(msg) {
  console.log(`[${new Date().toISOString().slice(0, 19)}] ${msg}`);
}

async function discoverBaselings(provider, ownerAddr) {
  const nft = new ethers.Contract(NFT_ADDR, [
    'function totalMinted() view returns (uint256)',
    'function ownerOf(uint256) view returns (address)',
    'function balanceOf(address) view returns (uint256)',
    'function baselings(uint256) view returns (uint8,uint8,bool,uint256,uint256,uint16,uint8)',
  ], provider);

  const count = await nft.balanceOf(ownerAddr);
  if (count === 0n) return [];

  const total = await nft.totalMinted();
  const mine = [];
  const addr = ownerAddr.toLowerCase();

  for (let i = 1; i <= Number(total); i++) {
    try {
      const owner = await nft.ownerOf(i);
      if (owner.toLowerCase() === addr) {
        const b = await nft.baselings(i);
        const lastFed = Number(b[4]);
        const daysLeft = DEATH_DAYS - (Date.now() / 1000 - lastFed) / 86400;
        mine.push({ id: i, state: Number(b[0]), family: Number(b[1]),
          feedCount: Number(b[5]), daysLeft, dead: Number(b[0]) === 2 });
      }
    } catch (e) { /* burned */ }
  }
  return mine;
}

async function playSession() {
  log('=== Baseling Play Session ===');

  // Create SDK context with proper RPC
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(GAME_WALLET_KEY, provider);
  const contracts = sdk.getContracts(wallet);
  const ctx = { wallet, contracts, apiUrl: 'https://tasern.quest/api/baseling' };
  log(`Player: ${wallet.address}`);

  // Balances
  const balances = await sdk.state.getBalances(ctx).catch(() => ({}));
  log(`Balances: ETH=${balances.ETH || '?'}, USDC=${balances.USDC || '?'}, POOP=${balances.POOP || '?'}`);

  // Discover on-chain
  log('Discovering baselings...');
  const baselings = await discoverBaselings(provider, wallet.address);
  log(`Found ${baselings.length} baselings`);

  if (baselings.length === 0) {
    log('No baselings found.');
    return;
  }

  // Report + find hungry ones
  const hungry = [];
  for (const b of baselings) {
    const flag = (!b.dead && b.daysLeft < 3) ? ' *** CRITICAL ***'
      : (!b.dead && b.daysLeft < FEED_THRESHOLD) ? ' * hungry *' : '';
    log(`  #${b.id}: family=${b.family} feeds=${b.feedCount} ${b.dead ? 'DEAD' : b.daysLeft.toFixed(1) + 'd left'}${flag}`);
    if (!b.dead && b.daysLeft < FEED_THRESHOLD) hungry.push(b);
  }

  if (hungry.length === 0) {
    log('All baselings well-fed. Nothing to do.');
    return;
  }

  // Ensure approvals first
  log('Setting approvals...');
  try {
    await sdk.actions.ensureApprovals(ctx);
    log('Approvals set.');
  } catch (e) {
    log(`Approvals failed: ${e.message.slice(0, 80)}`);
  }

  // Sort by most critical first
  hungry.sort((a, b) => a.daysLeft - b.daysLeft);
  let spent = 0;

  for (const b of hungry) {
    if (spent >= MAX_SPEND) { log(`Budget limit reached.`); break; }

    // Step 1: Buy food (AZUSD = balanced stats, $0.01 per meal)
    log(`Buying food for #${b.id}...`);
    const buyResult = await sdk.actions.buyFood(ctx, 'azusd', 0.01);
    if (!buyResult.ok) {
      log(`  buyFood failed: ${buyResult.error}`);
      continue;
    }
    log(`  Food purchased: ${buyResult.tx}`);
    spent += 0.01;

    // Step 2: Feed baseling from cupboard
    log(`Feeding #${b.id}...`);
    const feedResult = await sdk.actions.feedBaseling(ctx, b.id, 'azusd', 1);
    if (!feedResult.ok) {
      log(`  feedBaseling failed: ${feedResult.error}`);
      continue;
    }
    log(`  Fed! TX: ${feedResult.tx}`);
  }

  // Check pending POOP
  const aliveIds = baselings.filter(b => !b.dead).map(b => b.id);
  try {
    const pending = await sdk.state.getPendingPoop(ctx, aliveIds);
    if (pending && pending.total > 0) {
      log(`Claimable POOP: ${pending.total}`);
      const claimed = await sdk.actions.claimPoop(ctx, aliveIds);
      if (claimed.ok) log(`POOP claimed! TX: ${claimed.tx}`);
    }
  } catch (e) {
    log(`POOP claim skipped: ${e.message.slice(0, 80)}`);
  }

  // Forward POOP to keeper wallet for house vault pipeline
  const KEEPER_WALLET = '0xE2a4A8b9d77080c57799A94BA8eDeb2Dd6e0aC10';
  const POOP_TOKEN = '0x126555aecBAC290b25644e4b7f29c016aE95f4dc';
  try {
    const poopC = new ethers.Contract(POOP_TOKEN, ['function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)'], wallet);
    const poopBal = await poopC.balanceOf(wallet.address);
    if (poopBal > 0n) {
      log(`Forwarding ${ethers.formatEther(poopBal)} POOP to keeper for house pipeline`);
      const tx = await poopC.transfer(KEEPER_WALLET, poopBal, { gasLimit: 100_000 });
      await tx.wait();
      log(`POOP forwarded! TX: ${tx.hash}`);
    }
  } catch (e) {
    log(`POOP forward skipped: ${e.message.slice(0, 80)}`);
  }

  log(`Session done. Spent $${spent.toFixed(2)}, fed ${Math.min(hungry.length, Math.floor(spent / 0.01))} baselings.`);
}

playSession()
  .then(() => { log('=== Session Complete ==='); process.exit(0); })
  .catch(e => { log(`FATAL: ${e.message}`); process.exit(1); });
