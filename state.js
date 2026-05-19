// Baselings Agent SDK — State query module (read-only)
// All functions take a ctx object: { wallet, contracts, apiUrl }

const { ethers } = require('ethers');
const { TOKENS, CONTRACTS, FOOD_LP, POOL_INDEX, GARDEN_POOLS, JOB_TYPE, ABI, toM } = require('./contracts.js');

const DEFAULT_API_URL = 'https://tasern.quest/api/baseling';

// ── Job type reverse lookup ──
const JOB_NAME = Object.fromEntries(Object.entries(JOB_TYPE).map(([k, v]) => [v, k]));

// ── 1. getMyBaselings — Load baselings from game save API ──
async function getMyBaselings(ctx) {
  const apiUrl = ctx.apiUrl || DEFAULT_API_URL;
  try {
    const res = await fetch(`${apiUrl}/save?wallet=${ctx.wallet.address}`);
    if (!res.ok) {
      console.error('[state] getMyBaselings: API returned', res.status);
      return [];
    }
    const save = await res.json();
    if (!save || !save.baselings) return [];
    return save.baselings.map(b => ({
      id:         b.id,
      name:       b.name || null,
      family:     b.family,
      rarity:     b.rarity,
      hunger:     b.hunger,
      happy:      b.happy,
      poop:       b.poop,
      feedCount:  b.feedCount,
      stats:      b.stats || {},
      assignment: b.assignment || null,
    }));
  } catch (e) {
    console.error('[state] getMyBaselings:', e.message);
    return [];
  }
}

// ── 2. getBaseling — On-chain state for a single baseling ──
async function getBaseling(ctx, tokenId) {
  const { nftRead, traitRead } = ctx.contracts;
  try {
    const [chain, identity, pending] = await Promise.all([
      nftRead.baselings(tokenId),
      traitRead.getIdentity(tokenId),
      nftRead.pendingPoop(tokenId, ctx.wallet.address),
    ]);
    return {
      tokenId,
      state:       Number(chain[0]),
      family:      Number(chain[1]),
      giant:       chain[2],
      birthTime:   Number(chain[3]),
      lastFed:     Number(chain[4]),
      feedCount:   Number(chain[5]),
      deathCount:  Number(chain[6]),
      layer:       Number(identity[0]),
      charId:      Number(identity[1]),
      rarity:      Number(identity[2]),
      colorVariant:Number(identity[3]),
      sparkle:     identity[4],
      evoForm:     Number(identity[5]),
      evoTier:     Number(identity[6]),
      pendingPoop: ethers.formatEther(pending),
    };
  } catch (e) {
    console.error('[state] getBaseling:', e.message);
    return null;
  }
}

// ── 3. getBalances — Token balances for the game wallet ──
async function getBalances(ctx) {
  const { poopRead, usdcRead, wethRead } = ctx.contracts;
  const provider = ctx.wallet.provider;
  const addr = ctx.wallet.address;
  try {
    const [eth, poop, usdc, weth] = await Promise.all([
      provider.getBalance(addr),
      poopRead.balanceOf(addr),
      usdcRead.balanceOf(addr),
      wethRead.balanceOf(addr),
    ]);
    return {
      ETH:  ethers.formatEther(eth),
      POOP: ethers.formatEther(poop),
      USDC: toM(usdc) + 'M',
      WETH: ethers.formatEther(weth),
      raw: {
        ETH:  eth.toString(),
        POOP: poop.toString(),
        USDC: usdc.toString(),
        WETH: weth.toString(),
      },
    };
  } catch (e) {
    console.error('[state] getBalances:', e.message);
    return { ETH: '0', POOP: '0', USDC: '0M', WETH: '0', raw: {} };
  }
}

// ── 4. getFoodStock — Food amounts in cupboard per food type ──
async function getFoodStock(ctx) {
  const { pantryRead } = ctx.contracts;
  const addr = ctx.wallet.address;
  const foodKeys = Object.keys(FOOD_LP);
  try {
    const results = await Promise.all(
      foodKeys.map(key => Promise.all([
        pantryRead.cupboardAmount(addr, FOOD_LP[key]),
        pantryRead.isSpoiled(addr, FOOD_LP[key]),
        pantryRead.timeUntilSpoil(addr, FOOD_LP[key]),
      ]))
    );
    const stock = {};
    foodKeys.forEach((key, i) => {
      stock[key] = {
        amount:  ethers.formatEther(results[i][0]),
        spoiled: results[i][1],
        ttl:     Number(results[i][2]),
      };
    });
    return stock;
  } catch (e) {
    console.error('[state] getFoodStock:', e.message);
    const stock = {};
    foodKeys.forEach(key => { stock[key] = { amount: '0', spoiled: false, ttl: 0 }; });
    return stock;
  }
}

// ── 5. getGardenStatus — All garden pool statuses ──
// Chunks RPC calls to stay under Base public RPC batch limit (10 per batch)
async function getGardenStatus(ctx) {
  const { stateRead, assignRead } = ctx.contracts;
  try {
    const results = [];
    // Process 4 pools at a time (4 pools × 2 calls = 8 per batch, under limit of 10)
    for (let i = 0; i < GARDEN_POOLS.length; i += 4) {
      const chunk = GARDEN_POOLS.slice(i, i + 4);
      const chunkResults = await Promise.all(
        chunk.map(pool => {
          const idx = POOL_INDEX[pool.pair];
          if (idx === undefined) {
            return Promise.resolve({ yield: [0n, 0n], workers: 0n });
          }
          return Promise.all([
            stateRead.getPoolYieldBps(idx).catch(() => [0n, 0n]),
            assignRead.activeWorkerCount(idx).catch(() => 0n),
          ]).then(([yld, wrk]) => ({ yield: yld, workers: wrk }));
        })
      );
      results.push(...chunkResults);
    }
    return GARDEN_POOLS.map((pool, i) => ({
      name:        pool.name,
      pair:        pool.pair,
      type:        pool.type,
      workerCount: Number(results[i].workers),
      yieldBps:    Array.isArray(results[i].yield)
        ? { base: Number(results[i].yield[0]), bonus: Number(results[i].yield[1]) }
        : { base: 0, bonus: 0 },
    }));
  } catch (e) {
    console.error('[state] getGardenStatus:', e.message);
    return GARDEN_POOLS.map(pool => ({
      name: pool.name, pair: pool.pair, type: pool.type,
      workerCount: 0, yieldBps: { base: 0, bonus: 0 },
    }));
  }
}

// ── 6. getAssignments — All worker assignments for the wallet ──
async function getAssignments(ctx) {
  const { assignRead } = ctx.contracts;
  const addr = ctx.wallet.address;
  try {
    const baselingsIds = await assignRead.getPlayerAssignments(addr);
    if (!baselingsIds || baselingsIds.length === 0) return [];

    const assignments = await Promise.all(
      baselingsIds.map(id =>
        assignRead.getAssignment(id).catch(e => {
          console.error(`[state] getAssignments(${id}):`, e.message);
          return null;
        })
      )
    );

    return assignments
      .filter(a => a !== null)
      .map(a => ({
        baselingId: Number(a[0]),
        job:        JOB_NAME[Number(a[2])] || 'unknown',
        pool:       Number(a[3]),
        room:       Number(a[4]),
        targets:    Array.isArray(a[5]) ? a[5].map(Number) : [],
        active:     a[6],
      }));
  } catch (e) {
    console.error('[state] getAssignments:', e.message);
    return [];
  }
}

// ── 7. getHouses — All houses owned by the wallet ──
async function getHouses(ctx) {
  const { houseRead } = ctx.contracts;
  const addr = ctx.wallet.address;
  try {
    const tokenIds = await houseRead.tokensOf(addr);
    if (!tokenIds || tokenIds.length === 0) return [];

    const details = await Promise.all(
      tokenIds.map(id => Promise.all([
        houseRead.houses(id),
        houseRead.baselingsInHouse(id),
        houseRead.flowersInHouse(id),
      ]).catch(e => {
        console.error(`[state] getHouses(${id}):`, e.message);
        return null;
      }))
    );

    return details
      .filter(d => d !== null)
      .map((d, i) => ({
        tokenId:     Number(tokenIds[i]),
        type:        Number(d[0][0]),
        rooms:       Number(d[0][1]),
        purchasedAt: Number(d[0][2]),
        baselings:   d[1].map(Number),
        flowers:     d[2].map(Number),
      }));
  } catch (e) {
    console.error('[state] getHouses:', e.message);
    return [];
  }
}

// ── 8. getHouseVault — POOP vault + storage state per house ──
async function getHouseVault(ctx, houseId) {
  const { houseRead } = ctx.contracts;
  try {
    const [stored, cap, baseCap, items, bonus, overflowBurned] = await Promise.all([
      houseRead.poopStored(houseId),
      houseRead.poopCap(houseId),
      houseRead.basePoopCap(),
      houseRead.storageItemsInHouse(houseId),
      houseRead.storageBonusTotal(houseId),
      houseRead.totalPoopOverflowBurned(),
    ]);
    return {
      houseId:            Number(houseId),
      poopStored:         ethers.formatEther(stored),
      poopCap:            ethers.formatEther(cap),
      basePoopCap:        ethers.formatEther(baseCap),
      storageItems:       items.map(Number),
      storageBonusTotal:  ethers.formatEther(bonus),
      totalOverflowBurned: ethers.formatEther(overflowBurned),
      raw: {
        poopStored: stored.toString(),
        poopCap:    cap.toString(),
      },
    };
  } catch (e) {
    console.error('[state] getHouseVault:', e.message);
    return null;
  }
}

// ── 9. getPendingPoop — Pending POOP for multiple baselings ──
async function getPendingPoop(ctx, tokenIds) {
  const { nftRead } = ctx.contracts;
  const addr = ctx.wallet.address;
  try {
    const amounts = await Promise.all(
      tokenIds.map(id =>
        nftRead.pendingPoop(id, addr).catch(e => {
          console.error(`[state] getPendingPoop(${id}):`, e.message);
          return 0n;
        })
      )
    );
    const result = {};
    let total = 0n;
    tokenIds.forEach((id, i) => {
      result[id] = ethers.formatEther(amounts[i]);
      total += amounts[i];
    });
    result.total = ethers.formatEther(total);
    return result;
  } catch (e) {
    console.error('[state] getPendingPoop:', e.message);
    const result = {};
    tokenIds.forEach(id => { result[id] = '0'; });
    result.total = '0';
    return result;
  }
}

// ── 9. getGameSave — Load full game save from API ──
async function getGameSave(ctx) {
  const apiUrl = ctx.apiUrl || DEFAULT_API_URL;
  try {
    const res = await fetch(`${apiUrl}/save?wallet=${ctx.wallet.address}`);
    if (!res.ok) {
      console.error('[state] getGameSave: API returned', res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error('[state] getGameSave:', e.message);
    return null;
  }
}

// ── 10. getEggPrices — Current egg prices in M currency ──
async function getEggPrices(ctx) {
  const { routerRead } = ctx.contracts;
  try {
    const [random, sorted, giant] = await Promise.all([
      routerRead.estimateEggUSDC(0),
      routerRead.estimateEggUSDC(1),
      routerRead.estimateEggUSDC(2),
    ]);
    return {
      random: toM(random),
      sorted: toM(sorted),
      giant:  toM(giant),
    };
  } catch (e) {
    console.error('[state] getEggPrices:', e.message);
    return { random: 0, sorted: 0, giant: 0 };
  }
}

// ── 11. getMarketListings — Market listings from game save ──
async function getMarketListings(ctx) {
  try {
    const save = await getGameSave(ctx);
    if (!save || !save.listings) return [];
    return save.listings.map(l => ({
      baselingId: l.baselingId,
      price:      l.price,
      seller:     l.seller,
    }));
  } catch (e) {
    console.error('[state] getMarketListings:', e.message);
    return [];
  }
}

// ── 12. getGlobalStats — Global game statistics from on-chain ──
async function getGlobalStats(ctx) {
  const { nftRead, poopRead } = ctx.contracts;
  try {
    const [totalMinted, totalPoopMinted, totalPoopBurned, ppBalance, poopSupply] = await Promise.all([
      nftRead.totalMinted(),
      nftRead.totalPoopMinted(),
      nftRead.totalPoopBurned(),
      nftRead.powerPlantBalance(),
      poopRead.totalSupply(),
    ]);
    return {
      totalBaselings:  Number(totalMinted),
      totalPoopMinted: ethers.formatEther(totalPoopMinted),
      totalPoopBurned: ethers.formatEther(totalPoopBurned),
      poopSupply:      ethers.formatEther(poopSupply),
      powerPlantWeth:  ethers.formatEther(ppBalance),
    };
  } catch (e) {
    console.error('[state] getGlobalStats:', e.message);
    return {
      totalBaselings: 0, totalPoopMinted: '0', totalPoopBurned: '0',
      poopSupply: '0', powerPlantWeth: '0',
    };
  }
}

module.exports = {
  getMyBaselings,
  getBaseling,
  getBalances,
  getFoodStock,
  getGardenStatus,
  getAssignments,
  getHouses,
  getHouseVault,
  getPendingPoop,
  getGameSave,
  getEggPrices,
  getMarketListings,
  getGlobalStats,
};
