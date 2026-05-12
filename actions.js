// Baselings Agent SDK — Actions Module
// Every write action an agent can take in the game.

const { ethers } = require('ethers');
const {
  TOKENS, CONTRACTS, FOOD_LP, FOOD_FAMILY_IDX,
  POOL_INDEX, JOB_TYPE, ABI, toM, fromM, usdToRaw,
} = require('./contracts.js');

const MAX_UINT256 = ethers.MaxUint256;

// ── HELPER ──────────────────────────────────────────────────────────────────

async function waitForTx(tx) {
  try {
    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error(`Transaction failed: ${tx.hash}`);
    }
    return receipt;
  } catch (e) {
    console.error('[actions] waitForTx:', e.message);
    throw e;
  }
}

// Internal: check allowance and approve if needed.
//
// Approves the exact `amount` requested rather than MAX_UINT256. For an
// agent-driven hot wallet this matters: a future buggy upgrade or
// compromise of `spender` can only drain up to the current allowance,
// not the entire token balance. Set BASELINGS_INFINITE_APPROVALS=1 to
// opt back into MAX_UINT256 (saves one approve tx per session — not
// recommended for agent wallets).
async function _ensureAllowance(tokenContract, owner, spender, amount) {
  try {
    const current = await tokenContract.allowance(owner, spender);
    if (current >= amount) return null; // already approved
    const approveAmount = process.env.BASELINGS_INFINITE_APPROVALS === '1'
      ? MAX_UINT256
      : amount;
    const tx = await tokenContract.approve(spender, approveAmount);
    const receipt = await waitForTx(tx);
    return receipt.hash;
  } catch (e) {
    console.error('[actions] _ensureAllowance:', e.message);
    throw e;
  }
}

// ── SETUP ───────────────────────────────────────────────────────────────────

// Pre-approves only the NFT setApprovalForAll (one-time, per-collection).
// USDC/POOP allowances are NOT blanket-approved — each write action requests
// the exact amount it needs. This means a future compromise of
// Router/Pantry/BaselingState can only drain currently-pending per-action
// approvals, not the entire token balance.
async function ensureApprovals(ctx) {
  try {
    const { wallet, contracts } = ctx;
    const addr = wallet.address;
    const approved = [];

    // NFT → setApprovalForAll for Router (allows Router to move user's NFTs).
    // This is per-collection authorization, not a token-amount allowance.
    const nftApprovedRouter = await contracts.nftRead.isApprovedForAll(addr, CONTRACTS.ROUTER);
    if (!nftApprovedRouter) {
      const tx = await contracts.nft.setApprovalForAll(CONTRACTS.ROUTER, true);
      const receipt = await waitForTx(tx);
      approved.push({ token: 'BaselingNFT', spender: 'Router', tx: receipt.hash });
    }

    return {
      ok: true,
      approved,
      note: 'USDC/POOP allowances are now set per-action with exact amounts. ' +
            'Set BASELINGS_INFINITE_APPROVALS=1 to opt back into MAX_UINT256 approvals (not recommended for agent wallets).',
    };
  } catch (e) {
    console.error('[actions] ensureApprovals:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── EGGS ────────────────────────────────────────────────────────────────────

async function buyEgg(ctx, type, family) {
  try {
    const { wallet, contracts } = ctx;
    const addr = wallet.address;

    // Map type to index for estimateEggUSDC: 0=random, 1=sorted, 2=giant
    const typeIdx = { random: 0, sorted: 1, giant: 2 }[type];
    if (typeIdx === undefined) {
      return { ok: false, error: `Invalid egg type: ${type}` };
    }

    // Get cost estimate
    const usdcAmount = await contracts.routerRead.estimateEggUSDC(typeIdx);

    // Check USDC balance
    const balance = await contracts.usdcRead.balanceOf(addr);
    if (balance < usdcAmount) {
      return { ok: false, error: `Insufficient USDC: have ${balance}, need ${usdcAmount}` };
    }

    // Ensure USDC approved for Router
    await _ensureAllowance(contracts.usdc, addr, CONTRACTS.ROUTER, usdcAmount);

    // Mint egg
    let tx;
    if (type === 'random') {
      tx = await contracts.router.mintRandomEgg(usdcAmount);
    } else if (type === 'sorted') {
      if (family === undefined || family === null) {
        return { ok: false, error: 'Sorted eggs require a family index (0=TGN, 1=BURGERS, 2=AZUSD)' };
      }
      tx = await contracts.router.mintSortedEgg(family, usdcAmount);
    } else if (type === 'giant') {
      tx = await contracts.router.mintGiantEgg(usdcAmount);
    }

    const receipt = await waitForTx(tx);

    // Try to extract tokenId from Transfer event
    let tokenId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = contracts.nft.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'Transfer') {
          tokenId = parsed.args.tokenId.toString();
          break;
        }
      } catch (_) {
        // Not an NFT log, skip
      }
    }

    return { ok: true, tx: receipt.hash, tokenId };
  } catch (e) {
    console.error('[actions] buyEgg:', e.message);
    return { ok: false, error: e.message };
  }
}

async function hatchEgg(ctx, tokenId) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.nft.hatch(tokenId);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] hatchEgg:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── FOOD ────────────────────────────────────────────────────────────────────

async function buyFood(ctx, family, amountUSDC) {
  try {
    const { wallet, contracts } = ctx;
    const addr = wallet.address;

    const familyIdx = FOOD_FAMILY_IDX[family];
    if (familyIdx === undefined) {
      return { ok: false, error: `Invalid food family: ${family}. Use: tgn, burgers, azusd, weth, btc` };
    }

    const rawAmount = usdToRaw(amountUSDC);

    // Check USDC balance
    const balance = await contracts.usdcRead.balanceOf(addr);
    if (balance < BigInt(rawAmount)) {
      return { ok: false, error: `Insufficient USDC: have ${balance}, need ${rawAmount}` };
    }

    // Ensure USDC approved for Router
    await _ensureAllowance(contracts.usdc, addr, CONTRACTS.ROUTER, BigInt(rawAmount));

    const tx = await contracts.router.buyFood(familyIdx, rawAmount);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] buyFood:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── CARE ────────────────────────────────────────────────────────────────────

async function feedBaseling(ctx, tokenId, foodType, amount) {
  try {
    const { wallet, contracts } = ctx;
    const addr = wallet.address;

    const lpAddr = FOOD_LP[foodType];
    if (!lpAddr) {
      return { ok: false, error: `Invalid food type: ${foodType}. Use: tgn, burgers, azusd, weth, btc` };
    }

    // Ensure LP token approved for Pantry
    const lpToken = contracts.erc20Write(lpAddr);
    await _ensureAllowance(lpToken, addr, CONTRACTS.PANTRY, BigInt(amount));

    // Feed baseling — last param false = from cupboard (not freezer)
    const tx = await contracts.pantry.feedBaseling(tokenId, lpAddr, amount, false);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] feedBaseling:', e.message);
    return { ok: false, error: e.message };
  }
}

async function updateGameState(ctx, changes) {
  try {
    const { wallet, apiUrl } = ctx;
    const addr = wallet.address;

    // Load current game save
    const getResp = await fetch(`${apiUrl}/save/${addr}`);
    if (!getResp.ok) {
      return { ok: false, error: `Failed to load game save: ${getResp.status}` };
    }
    const save = await getResp.json();

    // Apply changes (shallow merge into save data)
    Object.assign(save, changes);

    // POST save back
    const postResp = await fetch(`${apiUrl}/save/${addr}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(save),
    });
    if (!postResp.ok) {
      return { ok: false, error: `Failed to save game state: ${postResp.status}` };
    }

    return { ok: true };
  } catch (e) {
    console.error('[actions] updateGameState:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── POOP ────────────────────────────────────────────────────────────────────

async function claimPoop(ctx, tokenIds) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.nft.distributeBatch(tokenIds);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] claimPoop:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── WORKERS ─────────────────────────────────────────────────────────────────

async function assignWorker(ctx, baselingId, job, poolPair, roomId) {
  try {
    const { wallet, contracts } = ctx;

    const jobType = JOB_TYPE[job];
    if (jobType === undefined) {
      return { ok: false, error: `Invalid job: ${job}. Use: garden, pp, nanny, hauler` };
    }

    const poolIdx = poolPair ? (POOL_INDEX[poolPair] ?? 0) : 0;
    const room = roomId || 0;

    const tx = await contracts.assignments.assign(
      baselingId, wallet.address, jobType, poolIdx, room, []
    );
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] assignWorker:', e.message);
    return { ok: false, error: e.message };
  }
}

async function unassignWorker(ctx, baselingId) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.assignments.unassign(baselingId);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] unassignWorker:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── DEPOSITS ────────────────────────────────────────────────────────────────

async function depositToGarden(ctx, poolPair, amount) {
  try {
    const { wallet, contracts } = ctx;

    const poolIdx = POOL_INDEX[poolPair];
    if (poolIdx === undefined) {
      return { ok: false, error: `Invalid pool pair: ${poolPair}` };
    }

    // Ensure POOP approved for BaselingState
    await _ensureAllowance(contracts.poop, wallet.address, CONTRACTS.BASELING_STATE, BigInt(amount));

    const tx = await contracts.state.deposit(poolIdx, amount);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] depositToGarden:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── HOUSING ─────────────────────────────────────────────────────────────────

async function buyHouse(ctx, houseType) {
  try {
    const { contracts } = ctx;

    if (houseType < 0 || houseType > 3) {
      return { ok: false, error: `Invalid house type: ${houseType}. Must be 0-3` };
    }

    const tx = await contracts.house.mintPublic(houseType);
    const receipt = await waitForTx(tx);

    // Try to extract tokenId from Transfer event
    let tokenId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = contracts.house.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === 'Transfer') {
          tokenId = parsed.args.tokenId.toString();
          break;
        }
      } catch (_) {
        // Not a house NFT log, skip
      }
    }

    return { ok: true, tx: receipt.hash, tokenId };
  } catch (e) {
    console.error('[actions] buyHouse:', e.message);
    return { ok: false, error: e.message };
  }
}

async function assignToHouse(ctx, houseTokenId, baselingId) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.house.assignBaseling(houseTokenId, baselingId);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] assignToHouse:', e.message);
    return { ok: false, error: e.message };
  }
}

async function unassignFromHouse(ctx, houseTokenId, baselingId) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.house.unassignBaseling(houseTokenId, baselingId);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] unassignFromHouse:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── CRYO / GRAVEYARD ────────────────────────────────────────────────────────

async function freezeBaseling(ctx, tokenId) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.nft.freeze(tokenId);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] freezeBaseling:', e.message);
    return { ok: false, error: e.message };
  }
}

async function unfreezeBaseling(ctx, tokenId) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.nft.unfreeze(tokenId);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] unfreezeBaseling:', e.message);
    return { ok: false, error: e.message };
  }
}

async function resurrectBaseling(ctx, tokenId) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.nft.resurrect(tokenId);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] resurrectBaseling:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── ATM (main wallet <-> game wallet transfers) ─────────────────────────────

async function depositUSDC(ctx, mainSigner, amount) {
  try {
    const { wallet } = ctx;
    const gameAddr = wallet.address;

    // Use mainSigner to transfer USDC to game wallet
    const usdc = new ethers.Contract(TOKENS.USDC, ABI.ERC20, mainSigner);
    const tx = await usdc.transfer(gameAddr, amount);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] depositUSDC:', e.message);
    return { ok: false, error: e.message };
  }
}

async function withdrawUSDC(ctx, mainWalletAddr, amount) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.usdc.transfer(mainWalletAddr, amount);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] withdrawUSDC:', e.message);
    return { ok: false, error: e.message };
  }
}

// ── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  // Helper
  waitForTx,
  // Setup
  ensureApprovals,
  // Eggs
  buyEgg,
  hatchEgg,
  // Food
  buyFood,
  // Care
  feedBaseling,
  updateGameState,
  // Poop
  claimPoop,
  // Workers
  assignWorker,
  unassignWorker,
  // Deposits
  depositToGarden,
  // Housing
  buyHouse,
  assignToHouse,
  unassignFromHouse,
  // Cryo / Graveyard
  freezeBaseling,
  unfreezeBaseling,
  resurrectBaseling,
  // ATM
  depositUSDC,
  withdrawUSDC,
};
