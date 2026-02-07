import 'dotenv/config';
import { ethers } from 'ethers';

// ============================================
// Clawshi Protocol Read-Only Tests
// ============================================
// Tests contract state without spending gas
// Safe to run anytime
// ============================================

const RPC_URL = process.env.MAINNET_RPC_URL || 'https://base.publicnode.com';

const CONTRACTS = {
  MarketFactory: '0xc0DeBCEa2F1BcB268b01777ff9c8E3BB4dA85559',
  ChainlinkResolver: '0xDEbe4E62bEE1DA1657008480e6d91a3f1E3CCaeC',
  ManualResolver: '0x3602D8989920B9A9451BF9D9562Bb97BA7cEd1bb',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
};

const FACTORY_ABI = [
  'function getMarket(uint256 marketId) external view returns (tuple(uint256 id, string question, address creator, address resolver, bytes resolverData, uint256 deadline, uint256 yesPool, uint256 noPool, uint256 creatorFee, bool resolved, bool outcome, bool paused))',
  'function getMarketCount() external view returns (uint256)',
  'function getOdds(uint256 marketId) external view returns (uint256 yesOdds, uint256 noOdds)',
  'function approvedResolvers(address) external view returns (bool)',
  'function owner() external view returns (address)',
  'function treasury() external view returns (address)',
  'function protocolFeeBps() external view returns (uint256)',
  'function minStake() external view returns (uint256)',
  'function maxCreatorFeeBps() external view returns (uint256)'
];

const RESOLVER_ABI = [
  'function getPrice(string calldata asset) external view returns (uint256 price, uint8 decimals)',
  'function priceFeeds(string) external view returns (address)',
  'function resolverType() external pure returns (string memory)',
  'function owner() external view returns (address)'
];

const MANUAL_ABI = [
  'function admin() external view returns (address)',
  'function resolverType() external pure returns (string memory)'
];

let passed = 0;
let failed = 0;

function test(name, condition, value = '') {
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`, value ? `(${value})` : '');
  } else {
    failed++;
    console.log(`  ❌ ${name}`, value ? `(${value})` : '');
  }
}

async function run() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         CLAWSHI PROTOCOL - READ-ONLY TESTS                 ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Contracts
  const factory = new ethers.Contract(CONTRACTS.MarketFactory, FACTORY_ABI, provider);
  const chainlink = new ethers.Contract(CONTRACTS.ChainlinkResolver, RESOLVER_ABI, provider);
  const manual = new ethers.Contract(CONTRACTS.ManualResolver, MANUAL_ABI, provider);

  // ========================================
  // 1. DEPLOYMENT CHECK
  // ========================================
  console.log('┌─ 1. DEPLOYMENT ───────────────────────┐');

  const factoryCode = await provider.getCode(CONTRACTS.MarketFactory);
  test('MarketFactory has code', factoryCode.length > 2);

  const chainlinkCode = await provider.getCode(CONTRACTS.ChainlinkResolver);
  test('ChainlinkResolver has code', chainlinkCode.length > 2);

  const manualCode = await provider.getCode(CONTRACTS.ManualResolver);
  test('ManualResolver has code', manualCode.length > 2);

  console.log('');

  // ========================================
  // 2. FACTORY CONFIG
  // ========================================
  console.log('┌─ 2. FACTORY CONFIG ───────────────────┐');

  const owner = await factory.owner();
  test('Owner set', owner !== ethers.ZeroAddress, owner.slice(0, 10) + '...');

  const treasury = await factory.treasury();
  test('Treasury set', treasury !== ethers.ZeroAddress, treasury.slice(0, 10) + '...');

  const protocolFee = await factory.protocolFeeBps();
  test('Protocol fee = 1%', protocolFee === 100n, `${protocolFee} bps`);

  const minStake = await factory.minStake();
  test('Min stake = 0.1 USDC', minStake === 100000n, `${ethers.formatUnits(minStake, 6)} USDC`);

  const maxCreatorFee = await factory.maxCreatorFeeBps();
  test('Max creator fee = 5%', maxCreatorFee === 500n, `${maxCreatorFee} bps`);

  console.log('');

  // ========================================
  // 3. RESOLVERS APPROVED
  // ========================================
  console.log('┌─ 3. APPROVED RESOLVERS ───────────────┐');

  const chainlinkApproved = await factory.approvedResolvers(CONTRACTS.ChainlinkResolver);
  test('ChainlinkResolver approved', chainlinkApproved);

  const manualApproved = await factory.approvedResolvers(CONTRACTS.ManualResolver);
  test('ManualResolver approved', manualApproved);

  const chainlinkType = await chainlink.resolverType();
  test('ChainlinkResolver type', chainlinkType === 'chainlink', chainlinkType);

  const manualType = await manual.resolverType();
  test('ManualResolver type', manualType === 'manual', manualType);

  console.log('');

  // ========================================
  // 4. PRICE FEEDS
  // ========================================
  console.log('┌─ 4. CHAINLINK PRICE FEEDS ────────────┐');

  try {
    const btcFeed = await chainlink.priceFeeds('BTC');
    test('BTC feed configured', btcFeed !== ethers.ZeroAddress, btcFeed.slice(0, 10) + '...');

    const [btcPrice, btcDec] = await chainlink.getPrice('BTC');
    const btcUsd = Number(btcPrice) / Math.pow(10, Number(btcDec));
    test('BTC price readable', btcPrice > 0n, `$${btcUsd.toLocaleString()}`);
  } catch (e) {
    test('BTC feed working', false, e.message.slice(0, 50));
  }

  try {
    const ethFeed = await chainlink.priceFeeds('ETH');
    test('ETH feed configured', ethFeed !== ethers.ZeroAddress, ethFeed.slice(0, 10) + '...');

    const [ethPrice, ethDec] = await chainlink.getPrice('ETH');
    const ethUsd = Number(ethPrice) / Math.pow(10, Number(ethDec));
    test('ETH price readable', ethPrice > 0n, `$${ethUsd.toLocaleString()}`);
  } catch (e) {
    test('ETH feed working', false, e.message.slice(0, 50));
  }

  console.log('');

  // ========================================
  // 5. MARKETS
  // ========================================
  console.log('┌─ 5. MARKETS ──────────────────────────┐');

  const marketCount = await factory.getMarketCount();
  test('Market count readable', true, `${marketCount} markets`);

  if (marketCount > 0n) {
    const latestMarket = await factory.getMarket(marketCount - 1n);
    test('Latest market readable', latestMarket.question.length > 0);
    console.log(`     Question: "${latestMarket.question.slice(0, 40)}..."`);
    console.log(`     YES Pool: ${ethers.formatUnits(latestMarket.yesPool, 6)} USDC`);
    console.log(`     NO Pool: ${ethers.formatUnits(latestMarket.noPool, 6)} USDC`);
    console.log(`     Resolved: ${latestMarket.resolved}`);
  }

  console.log('');

  // ========================================
  // SUMMARY
  // ========================================
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                      SUMMARY                               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log('');

  if (failed === 0) {
    console.log('  All read-only tests passed!');
    console.log('  Run `npm run test:full` for complete test with transactions.');
  } else {
    console.log('  Some tests failed. Check contract deployment.');
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(console.error);
