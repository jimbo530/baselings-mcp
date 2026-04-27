// Baselings Agent SDK — Contract addresses, ABIs, and helpers
// All contracts deployed on Base mainnet (chain ID 8453)

const { ethers } = require('ethers');

const CHAIN_ID = 8453;
const BASE_RPC = 'https://mainnet.base.org';

// ── Token addresses ──
const TOKENS = {
  POOP:    '0x126555aecBAC290b25644e4b7f29c016aE95f4dc',
  MFT:     '0x8FB87d13B40B1A67B22ED1a17e2835fe7e3a9bA3',
  WETH:    '0x4200000000000000000000000000000000000006',
  USDC:    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  CBBTC:   '0xcbB7C0000AB88B473b1f5aFd9ef808440eed33Bf',
  BURGERS: '0x06A05043eb2C1691b19c2C13219dB9212269dDc5',
  TGN:     '0xD75dfa972C6136f1c594Fec1945302f885E1ab29',
  BRETT:   '0x532f27101965dd16442E59d40670FaF5eBB142E4',
  AZUSD:   '0x3595ca37596D5895B70EFAB592ac315D5B9809B2',
  EGP:     '0xc1ba76771bbf0dd841347630e57c793f9d5accee',
  BUSTER:  '0xBFC5cD421bBC91A2Ca976C4AB1754748634b7D41',
  CHAR:    '0x20b048fA035D5763685D695e66aDF62c5D9f5055',
  FUN:     '0x16EE7ecAc70d1028E7712751E2Ee6BA808a7dd92',
};

// ── Core contract addresses ──
const CONTRACTS = {
  BASELING_NFT:    '0xFCb825491490284189C75fD330Fd08Df5E9217b9',
  ROUTER:          '0x59eB70F7cd16F63a9E81aEBE3DD10D4cFa4f0319',
  PANTRY:          '0xe818Ce01aD0842730Cb893a03E6659f647b389EF',
  POWER_PLANT:     '0xffC11092419a1068334be90cEcAeFE873031c31d',
  HOUSE_NFT:       '0xC5dE87D10De86ad39b94010e73A6c5Ce607e866a',
  TRAIT_REGISTRY:  '0xfCb1aA4537844d6730d4068407ed4B161BAD7d04',
  BASELING_STATE:  '0x4b123766152397BAa035a52808DDDCD794c8a32d',
  ASSIGNMENTS:     '0xabC2e93CF79F89E0874741366E9C33D73D7E9C6c',
  GROCERY_STORE:   '0x8e346E31faD18709cf71A1f374cE1729A9Bd318A',
  KEEPER_BATCH:    '0xE693dD02BB1Ba0850A1a153a03b99531004096B1',
};

// ── DEX addresses ──
const DEX = {
  V2_ROUTER:       '0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24',
  V3_ROUTER:       '0x2626664c2603336E57B271c5C0b26F421741e481',
  V3_POSITION_MGR: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  V3_FACTORY:      '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  MULTICALL3:      '0xcA11bde05977b3631167028862bE2a173976CA11',
};

// ── Food LP pair addresses (family → V2 LP) ──
const FOOD_LP = {
  tgn:     '0xbd0cc3b0aaf91b80c862dbcaf39faa4705ee2d7a',
  burgers: '0xa2A61fD7816951A0bCf8C67eA8f153C1AB5De288',
  azusd:   '0xecc664757da0c71ba32dfed527580a26783b6697',
  weth:    '0x23ac5919b710b6a62bd2acf8be5cd29560bf1a78',
  btc:     '0x5ea3608d81f39b39c769b3f168991f743b03cc14',
};

// ── Router food family indexes ──
const FOOD_FAMILY_IDX = { tgn: 0, burgers: 1, azusd: 2, weth: 3, btc: 4 };

// ── On-chain pool indexes (BaselingState) ──
const POOL_INDEX = {
  burgers:0, tgn:1, brett:2, azusd:3, egp:4, buster:5, char:6, weth:7,
  cbbtc:8, berry:9, rice:10, lettuce:11, burger_flower:12, orange_grove:13, azos:14, buster_berry:15,
};

// ── Job types (BaselingAssignments) ──
const JOB_TYPE = { garden: 0, pp: 1, nanny: 2, hauler: 3 };

// ── Garden pool config (mirrors game POOL_CONFIG) ──
const GARDEN_POOLS = [
  { pair:'burgers',       name:'BURGER TREE',    type:'farm',   foodId:'burger' },
  { pair:'cbbtc',         name:'BTC PATCH',      type:'garden', hidden:true },
  { pair:'weth',          name:'ETH PATCH',      type:'garden', hidden:true },
  { pair:'berry',         name:'BERRY BUSH',     type:'farm',   foodId:'berry' },
  { pair:'rice',          name:'RICE PADDY',     type:'farm',   foodId:'rice' },
  { pair:'lettuce',       name:'LETTUCE PATCH',  type:'farm',   foodId:'salad' },
  { pair:'tgn',           name:'TGN GARDEN',     type:'garden' },
  { pair:'burger_flower', name:'BURGER FLOWER',  type:'garden' },
  { pair:'orange_grove',  name:'ORANGE GROVE',   type:'farm',   foodId:'orange' },
  { pair:'brett',         name:'BRETT GARDEN',    type:'garden' },
  { pair:'buster',        name:'BUSTER GARDEN',  type:'garden' },
  { pair:'char',          name:'CHAR GARDEN',    type:'garden' },
  { pair:'azos',          name:'AZOS TREE',      type:'garden' },
  { pair:'buster_berry',  name:'BUSTER BERRY',   type:'farm',   foodId:'buster_berry' },
];

// ── ABIs (minimal, human-readable) ──
const ABI = {
  ERC20: [
    'function balanceOf(address) view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function allowance(address,address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
    'function transferFrom(address,address,uint256) returns (bool)',
    'function decimals() view returns (uint8)',
  ],
  WETH: [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function allowance(address,address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
    'function deposit() payable',
    'function withdraw(uint256)',
  ],
  BASELING_NFT: [
    'function mintRandom() returns (uint256)',
    'function mintSorted(uint8) returns (uint256)',
    'function mintGiant() returns (uint256)',
    'function hatch(uint256)',
    'function freeze(uint256)',
    'function unfreeze(uint256)',
    'function resurrect(uint256)',
    'function distributeBatch(uint256[])',
    'function isDead(uint256) view returns (bool)',
    'function randomEggPrice() view returns (uint256)',
    'function sortedEggPrice() view returns (uint256)',
    'function giantEggPrice() view returns (uint256)',
    'function totalMinted() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function ownerOf(uint256) view returns (address)',
    'function transferFrom(address,address,uint256)',
    'function baselings(uint256) view returns (uint8,uint8,bool,uint64,uint64,uint32,uint16)',
    'function pendingPoop(uint256,address) view returns (uint256)',
    'function totalVaultWETH(uint256) view returns (uint256)',
    'function totalVaultLP(uint256) view returns (uint256)',
    'function getVaultPairs(uint256) view returns (address[])',
    'function powerPlantBalance() view returns (uint256)',
    'function totalPoopMinted() view returns (uint256)',
    'function totalPoopBurned() view returns (uint256)',
    'function isApprovedForAll(address,address) view returns (bool)',
    'function setApprovalForAll(address,bool)',
  ],
  ROUTER: [
    'function buyFood(uint8,uint256)',
    'function buyFoodToFreezer(uint8,uint256)',
    'function mintRandomEgg(uint256) returns (uint256)',
    'function mintSortedEgg(uint8,uint256) returns (uint256)',
    'function mintGiantEgg(uint256) returns (uint256)',
    'function estimateEggUSDC(uint8) view returns (uint256)',
    'function convertSeed(uint256)',
    'function convertSeedBatch(uint256[])',
    'function familyLPPairs(uint256) view returns (address)',
    'function familyTokens(uint256) view returns (address)',
    'function USDC() view returns (address)',
  ],
  PANTRY: [
    'function feedBaseling(uint256,address,uint256,bool)',
    'function cupboardAmount(address,address) view returns (uint256)',
    'function freezerAmount(address,address) view returns (uint256)',
    'function cupboardTime(address,address) view returns (uint64)',
    'function isSpoiled(address,address) view returns (bool)',
    'function timeUntilSpoil(address,address) view returns (uint256)',
  ],
  HOUSE_NFT: [
    'function mint(address,uint8,uint8) returns (uint256)',
    'function mintPublic(uint8) returns (uint256)',
    'function addRoom(uint256)',
    'function assignBaseling(uint256,uint256)',
    'function unassignBaseling(uint256,uint256)',
    'function placeFlower(uint256,uint256)',
    'function removeFlower(uint256,uint256)',
    'function tokensOf(address) view returns (uint256[])',
    'function houses(uint256) view returns (uint8,uint8,uint64)',
    'function baselingsInHouse(uint256) view returns (uint256[])',
    'function flowersInHouse(uint256) view returns (uint256[])',
    'function ownerOf(uint256) view returns (address)',
    'function totalSupply() view returns (uint256)',
    'function housePrice(uint8) view returns (uint256)',
  ],
  TRAIT_REGISTRY: [
    'function getIdentity(uint256) view returns (uint8,uint16,uint8,uint8,bool,uint16,uint8)',
    'function hatchLocked(uint256) view returns (bool)',
    'function setHatchTraits(uint256,uint16,uint8,uint8,bool,uint8)',
  ],
  BASELING_STATE: [
    'function balanceOf(address,uint256) view returns (uint256)',
    'function balanceOfBatch(address[],uint256[]) view returns (uint256[])',
    'function getBalances(address,uint256[]) view returns (uint256[])',
    'function deposit(uint256,uint256)',
    'function withdraw(uint256,uint256)',
    'function pools(uint256) view returns (string,address,uint8,bool)',
    'function poolCount() view returns (uint256)',
    'function tokens(uint256) view returns (string,uint256,uint8,uint16,bool)',
    'function totalSupply(uint256) view returns (uint256)',
    'function getPoolYieldBps(uint256) view returns (uint256,uint256)',
  ],
  ASSIGNMENTS: [
    'function assign(uint256,address,uint8,uint256,uint256,uint256[])',
    'function unassign(uint256)',
    'function getAssignment(uint256) view returns (uint256,address,uint8,uint256,uint256,uint256[],bool)',
    'function getPlayerAssignments(address) view returns (uint256[])',
    'function getAssignmentBatch(uint256[]) view returns (uint256[],address[],uint8[],uint256[],uint256[],bool[])',
    'function activeWorkerCount(uint256) view returns (uint256)',
  ],
  V2_ROUTER: [
    'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])',
    'function getAmountsOut(uint256,address[]) view returns (uint256[])',
  ],
};

// ── M currency helpers (1M = 0.01 USDC = 10000 raw USDC units) ──
function toM(rawUSDC) { return Number(rawUSDC) / 10000; }
function fromM(m) { return Math.round(m * 10000); }
function usdToRaw(usd) { return Math.round(usd * 1000000); }

// ── Create provider + contract instances from a wallet ──
function createProvider(rpcUrl) {
  return new ethers.JsonRpcProvider(rpcUrl || BASE_RPC);
}

function createWallet(privateKey, provider) {
  if (!provider) provider = createProvider();
  return new ethers.Wallet(privateKey, provider);
}

// Derive deterministic game wallet from main wallet (same as browser game)
async function deriveGameWallet(mainWalletSigner) {
  const sig = await mainWalletSigner.signMessage('Baselings Game Wallet v1');
  const key = ethers.keccak256(sig);
  return key; // use as private key for game wallet
}

function getContracts(signer) {
  const provider = signer.provider || createProvider();
  const read = (addr, abi) => new ethers.Contract(addr, abi, provider);
  const write = (addr, abi) => new ethers.Contract(addr, abi, signer);

  return {
    // Read-only (no gas)
    nftRead:         read(CONTRACTS.BASELING_NFT, ABI.BASELING_NFT),
    routerRead:      read(CONTRACTS.ROUTER, ABI.ROUTER),
    pantryRead:      read(CONTRACTS.PANTRY, ABI.PANTRY),
    houseRead:       read(CONTRACTS.HOUSE_NFT, ABI.HOUSE_NFT),
    traitRead:       read(CONTRACTS.TRAIT_REGISTRY, ABI.TRAIT_REGISTRY),
    stateRead:       read(CONTRACTS.BASELING_STATE, ABI.BASELING_STATE),
    assignRead:      read(CONTRACTS.ASSIGNMENTS, ABI.ASSIGNMENTS),
    poopRead:        read(TOKENS.POOP, ABI.ERC20),
    usdcRead:        read(TOKENS.USDC, ABI.ERC20),
    wethRead:        read(TOKENS.WETH, ABI.WETH),

    // Write (costs gas)
    nft:             write(CONTRACTS.BASELING_NFT, ABI.BASELING_NFT),
    router:          write(CONTRACTS.ROUTER, ABI.ROUTER),
    pantry:          write(CONTRACTS.PANTRY, ABI.PANTRY),
    house:           write(CONTRACTS.HOUSE_NFT, ABI.HOUSE_NFT),
    state:           write(CONTRACTS.BASELING_STATE, ABI.BASELING_STATE),
    assignments:     write(CONTRACTS.ASSIGNMENTS, ABI.ASSIGNMENTS),
    poop:            write(TOKENS.POOP, ABI.ERC20),
    usdc:            write(TOKENS.USDC, ABI.ERC20),
    weth:            write(TOKENS.WETH, ABI.WETH),

    // Helpers
    erc20:           (addr) => read(addr, ABI.ERC20),
    erc20Write:      (addr) => write(addr, ABI.ERC20),
  };
}

module.exports = {
  CHAIN_ID, BASE_RPC,
  TOKENS, CONTRACTS, DEX,
  FOOD_LP, FOOD_FAMILY_IDX, POOL_INDEX, JOB_TYPE,
  GARDEN_POOLS, ABI,
  toM, fromM, usdToRaw,
  createProvider, createWallet, deriveGameWallet, getContracts,
};
