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

// Internal: check allowance and approve if needed
async function _ensureAllowance(tokenContract, owner, spender, amount) {
  try {
    const current = await tokenContract.allowance(owner, spender);
    if (current >= amount) return null; // already approved
    const tx = await tokenContract.approve(spender, MAX_UINT256);
    const receipt = await waitForTx(tx);
    return receipt.hash;
  } catch (e) {
    console.error('[actions] _ensureAllowance:', e.message);
    throw e;
  }
}

// ── SETUP ───────────────────────────────────────────────────────────────────

async function ensureApprovals(ctx) {
  try {
    const { wallet, contracts } = ctx;
    const addr = wallet.address;
    const approved = [];

    // USDC → Router (egg buying + food)
    const usdcRouter = await _ensureAllowance(
      contracts.usdc, addr, CONTRACTS.ROUTER, MAX_UINT256
    );
    if (usdcRouter) approved.push({ token: 'USDC', spender: 'Router', tx: usdcRouter });

    // POOP → Router
    const poopRouter = await _ensureAllowance(
      contracts.poop, addr, CONTRACTS.ROUTER, MAX_UINT256
    );
    if (poopRouter) approved.push({ token: 'POOP', spender: 'Router', tx: poopRouter });

    // POOP → Pantry
    const poopPantry = await _ensureAllowance(
      contracts.poop, addr, CONTRACTS.PANTRY, MAX_UINT256
    );
    if (poopPantry) approved.push({ token: 'POOP', spender: 'Pantry', tx: poopPantry });

    // POOP → BaselingState (deposits)
    const poopState = await _ensureAllowance(
      contracts.poop, addr, CONTRACTS.BASELING_STATE, MAX_UINT256
    );
    if (poopState) approved.push({ token: 'POOP', spender: 'BaselingState', tx: poopState });

    // POOP → House NFT (vault deposits)
    const poopHouse = await _ensureAllowance(
      contracts.poop, addr, CONTRACTS.HOUSE_NFT, MAX_UINT256
    );
    if (poopHouse) approved.push({ token: 'POOP', spender: 'HouseNFT', tx: poopHouse });

    // NFT → setApprovalForAll for game wallet (Router needs to move NFTs)
    const nftApprovedRouter = await contracts.nftRead.isApprovedForAll(addr, CONTRACTS.ROUTER);
    if (!nftApprovedRouter) {
      const tx = await contracts.nft.setApprovalForAll(CONTRACTS.ROUTER, true);
      const receipt = await waitForTx(tx);
      approved.push({ token: 'BaselingNFT', spender: 'Router', tx: receipt.hash });
    }

    return { ok: true, approved };
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

// ── HOUSE VAULT ────────────────────────────────────────────────────────────

async function depositPoopToHouse(ctx, houseId, amount) {
  try {
    const { wallet, contracts } = ctx;
    await _ensureAllowance(contracts.poop, wallet.address, CONTRACTS.HOUSE_NFT, BigInt(amount));
    const tx = await contracts.house.depositPoop(houseId, amount);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] depositPoopToHouse:', e.message);
    return { ok: false, error: e.message };
  }
}

async function sendPoopFromHouse(ctx, houseId, destination, amount) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.house.sendPoop(houseId, destination, amount);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] sendPoopFromHouse:', e.message);
    return { ok: false, error: e.message };
  }
}

async function depositTokenToHouse(ctx, houseId, tokenAddress, amount) {
  try {
    const { wallet, contracts } = ctx;
    const token = contracts.erc20Write(tokenAddress);
    await _ensureAllowance(token, wallet.address, CONTRACTS.HOUSE_NFT, BigInt(amount));
    const tx = await contracts.house.depositToken(houseId, tokenAddress, amount);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] depositTokenToHouse:', e.message);
    return { ok: false, error: e.message };
  }
}

async function withdrawTokenFromHouse(ctx, houseId, tokenAddress, amount) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.house.withdrawToken(houseId, tokenAddress, amount);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] withdrawTokenFromHouse:', e.message);
    return { ok: false, error: e.message };
  }
}

async function placeStorageItem(ctx, houseId, itemId) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.house.placeStorageItem(houseId, itemId);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] placeStorageItem:', e.message);
    return { ok: false, error: e.message };
  }
}

async function removeStorageItem(ctx, houseId, itemId) {
  try {
    const { contracts } = ctx;
    const tx = await contracts.house.removeStorageItem(houseId, itemId);
    const receipt = await waitForTx(tx);
    return { ok: true, tx: receipt.hash };
  } catch (e) {
    console.error('[actions] removeStorageItem:', e.message);
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
  // House Vault
  depositPoopToHouse,
  sendPoopFromHouse,
  depositTokenToHouse,
  withdrawTokenFromHouse,
  placeStorageItem,
  removeStorageItem,
  // Cryo / Graveyard
  freezeBaseling,
  unfreezeBaseling,
  resurrectBaseling,
  // ATM
  depositUSDC,
  withdrawUSDC,
};
