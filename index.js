// Baselings Agent SDK — Main entry point
// Agents and automation scripts use this to interact with the Baselings game on Base chain.
//
// Usage:
//   const baselings = require('./agent-sdk');
//   const ctx = baselings.createContext(process.env.GAME_WALLET_KEY);
//
//   // Read state
//   const balances = await baselings.state.getBalances(ctx);
//   const pets = await baselings.state.getMyBaselings(ctx);
//
//   // Take actions
//   await baselings.actions.ensureApprovals(ctx);
//   await baselings.actions.buyEgg(ctx, 'random');
//   await baselings.actions.feedBaseling(ctx, tokenId, 'burgers', amount);
//
//   // Strategy playbooks
//   const strats = baselings.strategies.listStrategies();
//   const green = baselings.strategies.getStrategy('green');
//   const todo = await baselings.strategies.getNextActions(green, currentState);

const contracts = require('./contracts');
const state = require('./state');
const actions = require('./actions');
const strategies = require('./strategies');

// Create a ready-to-use context from a game wallet private key
function createContext(gameWalletKey, opts = {}) {
  const wallet = contracts.createWallet(gameWalletKey);
  const c = contracts.getContracts(wallet);
  return {
    wallet,
    contracts: c,
    apiUrl: opts.apiUrl || 'https://tasern.quest/api/baseling',
  };
}

module.exports = {
  // Core
  createContext,
  contracts,
  state,
  actions,
  strategies,

  // Re-export commonly used helpers
  createWallet: contracts.createWallet,
  createProvider: contracts.createProvider,
  deriveGameWallet: contracts.deriveGameWallet,
  getContracts: contracts.getContracts,
  toM: contracts.toM,
  fromM: contracts.fromM,

  // Constants
  TOKENS: contracts.TOKENS,
  CONTRACTS: contracts.CONTRACTS,
  FOOD_LP: contracts.FOOD_LP,
  POOL_INDEX: contracts.POOL_INDEX,
  JOB_TYPE: contracts.JOB_TYPE,
  GARDEN_POOLS: contracts.GARDEN_POOLS,
};
