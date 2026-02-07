import 'dotenv/config';
import { ethers } from 'ethers';

// ============================================
// Clawshi Protocol Test Suite
// ============================================
// Tests all core functionality on Base Mainnet
// Uses real USDC - ensure wallet is funded!
// ============================================

const RPC_URL = process.env.MAINNET_RPC_URL || 'https://base.publicnode.com';
const PRIVATE_KEY = process.env.MAINNET_PRIVATE_KEY;

// Deployed contracts
const CONTRACTS = {
  MarketFactory: '0xc0DeBCEa2F1BcB268b01777ff9c8E3BB4dA85559',
  ChainlinkResolver: '0xDEbe4E62bEE1DA1657008480e6d91a3f1E3CCaeC',
  ManualResolver: '0x3602D8989920B9A9451BF9D9562Bb97BA7cEd1bb',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
};

// ABIs
const FACTORY_ABI = [
  'function createMarket(string calldata question, address resolver, bytes calldata resolverData, uint256 deadline, uint256 creatorFeeBps) external returns (uint256)',
  'function stake(uint256 marketId, bool isYes, uint256 amount) external',
  'function resolveMarket(uint256 marketId) external',
  'function claim(uint256 marketId) external',
  'function getMarket(uint256 marketId) external view returns (tuple(uint256 id, string question, address creator, address resolver, bytes resolverData, uint256 deadline, uint256 yesPool, uint256 noPool, uint256 creatorFee, bool resolved, bool outcome, bool paused))',
  'function getStake(uint256 marketId, address user) external view returns (tuple(uint256 amount, bool isYes, bool claimed))',
  'function getMarketCount() external view returns (uint256)',
  'function getOdds(uint256 marketId) external view returns (uint256 yesOdds, uint256 noOdds)',
  'function calculatePayout(uint256 marketId, bool isYes, uint256 amount) external view returns (uint256)',
  'function approvedResolvers(address) external view returns (bool)',
  'function owner() external view returns (address)',
  'function protocolFeeBps() external view returns (uint256)',
  'function minStake() external view returns (uint256)'
];

const RESOLVER_ABI = [
  'function encodeParams(string memory asset, uint256 targetPrice, bool isGreaterThan, uint256 deadline) external pure returns (bytes memory)',
  'function getPrice(string calldata asset) external view returns (uint256 price, uint8 decimals)',
  'function canResolve(uint256 marketId, bytes calldata resolverData) external view returns (bool)',
  'function resolverType() external pure returns (string memory)'
];

const MANUAL_RESOLVER_ABI = [
  'function setOutcome(uint256 marketId, bool outcome) external',
  'function setDeadline(uint256 marketId, uint256 deadline) external',
  'function isOutcomeSet(uint256 marketId) external view returns (bool)',
  'function getOutcome(uint256 marketId) external view returns (bool outcome, bool isSet)',
  'function canResolve(uint256 marketId, bytes calldata resolverData) external view returns (bool)',
  'function admin() external view returns (address)'
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)'
];

// Test results
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

function log(msg) {
  console.log(msg);
}

function test(name, passed, details = '') {
  if (passed) {
    results.passed++;
    results.tests.push({ name, passed: true });
    log(`  ✅ ${name}`);
  } else {
    results.failed++;
    results.tests.push({ name, passed: false, details });
    log(`  ❌ ${name}`);
    if (details) log(`     ${details}`);
  }
}

async function runTests() {
  log('');
  log('╔════════════════════════════════════════════════════════════╗');
  log('║           CLAWSHI PROTOCOL TEST SUITE                      ║');
  log('╚════════════════════════════════════════════════════════════╝');
  log('');

  if (!PRIVATE_KEY) {
    log('❌ MAINNET_PRIVATE_KEY not set in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  log(`Network: Base Mainnet (${RPC_URL})`);
  log(`Tester: ${wallet.address}`);
  log('');

  // Contracts
  const factory = new ethers.Contract(CONTRACTS.MarketFactory, FACTORY_ABI, wallet);
  const chainlinkResolver = new ethers.Contract(CONTRACTS.ChainlinkResolver, RESOLVER_ABI, provider);
  const manualResolver = new ethers.Contract(CONTRACTS.ManualResolver, MANUAL_RESOLVER_ABI, wallet);
  const usdc = new ethers.Contract(CONTRACTS.USDC, ERC20_ABI, wallet);

  // ========================================
  // 1. CONTRACT DEPLOYMENT TESTS
  // ========================================
  log('┌────────────────────────────────────────┐');
  log('│ 1. CONTRACT DEPLOYMENT                 │');
  log('└────────────────────────────────────────┘');

  // Check MarketFactory has code
  const factoryCode = await provider.getCode(CONTRACTS.MarketFactory);
  test('MarketFactory deployed', factoryCode.length > 2);

  // Check ChainlinkResolver has code
  const chainlinkCode = await provider.getCode(CONTRACTS.ChainlinkResolver);
  test('ChainlinkResolver deployed', chainlinkCode.length > 2);

  // Check ManualResolver has code
  const manualCode = await provider.getCode(CONTRACTS.ManualResolver);
  test('ManualResolver deployed', manualCode.length > 2);

  log('');

  // ========================================
  // 2. CONFIGURATION TESTS
  // ========================================
  log('┌────────────────────────────────────────┐');
  log('│ 2. PROTOCOL CONFIGURATION              │');
  log('└────────────────────────────────────────┘');

  // Check owner
  const owner = await factory.owner();
  test('Owner is set', owner !== ethers.ZeroAddress);

  // Check protocol fee
  const protocolFee = await factory.protocolFeeBps();
  test('Protocol fee is 1%', protocolFee === 100n, `Got: ${protocolFee} bps`);

  // Check min stake
  const minStake = await factory.minStake();
  test('Min stake is 0.1 USDC', minStake === 100000n, `Got: ${minStake}`);

  // Check resolvers approved
  const chainlinkApproved = await factory.approvedResolvers(CONTRACTS.ChainlinkResolver);
  test('ChainlinkResolver approved', chainlinkApproved);

  const manualApproved = await factory.approvedResolvers(CONTRACTS.ManualResolver);
  test('ManualResolver approved', manualApproved);

  log('');

  // ========================================
  // 3. ORACLE TESTS
  // ========================================
  log('┌────────────────────────────────────────┐');
  log('│ 3. CHAINLINK ORACLE                    │');
  log('└────────────────────────────────────────┘');

  try {
    const [btcPrice, btcDecimals] = await chainlinkResolver.getPrice('BTC');
    const btcUsd = Number(btcPrice) / Math.pow(10, Number(btcDecimals));
    test('BTC/USD feed working', btcPrice > 0n, `Price: $${btcUsd.toLocaleString()}`);
    log(`     Current BTC: $${btcUsd.toLocaleString()}`);
  } catch (e) {
    test('BTC/USD feed working', false, e.message);
  }

  try {
    const [ethPrice, ethDecimals] = await chainlinkResolver.getPrice('ETH');
    const ethUsd = Number(ethPrice) / Math.pow(10, Number(ethDecimals));
    test('ETH/USD feed working', ethPrice > 0n, `Price: $${ethUsd.toLocaleString()}`);
    log(`     Current ETH: $${ethUsd.toLocaleString()}`);
  } catch (e) {
    test('ETH/USD feed working', false, e.message);
  }

  const resolverType = await chainlinkResolver.resolverType();
  test('Resolver type is "chainlink"', resolverType === 'chainlink');

  log('');

  // ========================================
  // 4. USDC TESTS
  // ========================================
  log('┌────────────────────────────────────────┐');
  log('│ 4. USDC TOKEN                          │');
  log('└────────────────────────────────────────┘');

  const usdcDecimals = await usdc.decimals();
  test('USDC decimals is 6', usdcDecimals === 6n);

  const usdcBalance = await usdc.balanceOf(wallet.address);
  const usdcFormatted = ethers.formatUnits(usdcBalance, 6);
  test('Wallet has USDC', usdcBalance > 0n, `Balance: ${usdcFormatted} USDC`);
  log(`     Balance: ${usdcFormatted} USDC`);

  const hasEnoughUsdc = usdcBalance >= 200000n; // 0.2 USDC for tests
  test('Sufficient USDC for tests (0.2)', hasEnoughUsdc);

  log('');

  // ========================================
  // 5. MARKET CREATION TEST
  // ========================================
  log('┌────────────────────────────────────────┐');
  log('│ 5. MARKET CREATION                     │');
  log('└────────────────────────────────────────┘');

  const marketCountBefore = await factory.getMarketCount();
  log(`     Existing markets: ${marketCountBefore}`);

  // Create test market with ManualResolver (we control outcome)
  const testQuestion = `Test Market ${Date.now()}`;
  const deadline = Math.floor(Date.now() / 1000) + 120; // 2 minutes

  try {
    const createTx = await factory.createMarket(
      testQuestion,
      CONTRACTS.ManualResolver,
      '0x', // No resolver data needed for manual
      deadline,
      0 // No creator fee
    );
    await createTx.wait();

    const marketCountAfter = await factory.getMarketCount();
    test('Market created', marketCountAfter > marketCountBefore);

    const testMarketId = marketCountAfter - 1n;
    log(`     Created market #${testMarketId}`);

    const market = await factory.getMarket(testMarketId);
    test('Market question matches', market.question === testQuestion);
    test('Market not resolved', !market.resolved);
    test('Market not paused', !market.paused);

    log('');

    // ========================================
    // 6. STAKING TEST
    // ========================================
    log('┌────────────────────────────────────────┐');
    log('│ 6. STAKING                             │');
    log('└────────────────────────────────────────┘');

    // Approve USDC
    const allowance = await usdc.allowance(wallet.address, CONTRACTS.MarketFactory);
    if (allowance < 200000n) {
      const approveTx = await usdc.approve(CONTRACTS.MarketFactory, ethers.MaxUint256);
      await approveTx.wait();
    }
    test('USDC approved for staking', true);

    // Stake on YES
    const stakeAmount = 100000n; // 0.1 USDC
    const stakeTx = await factory.stake(testMarketId, true, stakeAmount);
    await stakeTx.wait();

    const stakeInfo = await factory.getStake(testMarketId, wallet.address);
    test('Stake recorded', stakeInfo.amount === stakeAmount);
    test('Staked on YES', stakeInfo.isYes === true);

    const marketAfterStake = await factory.getMarket(testMarketId);
    test('YES pool updated', marketAfterStake.yesPool === stakeAmount);

    const [yesOdds, noOdds] = await factory.getOdds(testMarketId);
    log(`     Odds: ${yesOdds}% YES / ${noOdds}% NO`);
    test('Odds calculated', yesOdds === 100n && noOdds === 0n);

    log('');

    // ========================================
    // 7. RESOLUTION TEST
    // ========================================
    log('┌────────────────────────────────────────┐');
    log('│ 7. MARKET RESOLUTION                   │');
    log('└────────────────────────────────────────┘');

    // Set outcome via ManualResolver
    const setOutcomeTx = await manualResolver.setOutcome(testMarketId, true);
    await setOutcomeTx.wait();

    const [outcome, isSet] = await manualResolver.getOutcome(testMarketId);
    test('Outcome set to YES', outcome === true && isSet === true);

    // Wait for deadline
    log('     Waiting for deadline (2 min)...');
    const waitTime = (deadline - Math.floor(Date.now() / 1000) + 5) * 1000;
    if (waitTime > 0) {
      await new Promise(r => setTimeout(r, Math.min(waitTime, 130000)));
    }

    // Resolve market
    const canResolve = await manualResolver.canResolve(testMarketId, '0x');
    test('Can resolve market', canResolve);

    const resolveTx = await factory.resolveMarket(testMarketId);
    await resolveTx.wait();

    const marketAfterResolve = await factory.getMarket(testMarketId);
    test('Market resolved', marketAfterResolve.resolved === true);
    test('Outcome is YES', marketAfterResolve.outcome === true);

    log('');

    // ========================================
    // 8. CLAIM TEST
    // ========================================
    log('┌────────────────────────────────────────┐');
    log('│ 8. CLAIM WINNINGS                      │');
    log('└────────────────────────────────────────┘');

    const balanceBefore = await usdc.balanceOf(wallet.address);

    const claimTx = await factory.claim(testMarketId);
    await claimTx.wait();

    const balanceAfter = await usdc.balanceOf(wallet.address);
    const payout = balanceAfter - balanceBefore;

    test('Payout received', payout > 0n, `Payout: ${ethers.formatUnits(payout, 6)} USDC`);
    log(`     Payout: ${ethers.formatUnits(payout, 6)} USDC`);

    const stakeAfterClaim = await factory.getStake(testMarketId, wallet.address);
    test('Stake marked as claimed', stakeAfterClaim.claimed === true);

  } catch (e) {
    test('Market operations', false, e.message);
  }

  log('');

  // ========================================
  // SUMMARY
  // ========================================
  log('╔════════════════════════════════════════════════════════════╗');
  log('║                    TEST SUMMARY                            ║');
  log('╚════════════════════════════════════════════════════════════╝');
  log('');
  log(`  Passed: ${results.passed}`);
  log(`  Failed: ${results.failed}`);
  log(`  Total:  ${results.passed + results.failed}`);
  log('');

  if (results.failed === 0) {
    log('  ✅ ALL TESTS PASSED!');
    log('');
    log('  Protocol is functioning correctly on Base Mainnet.');
  } else {
    log('  ❌ SOME TESTS FAILED');
    log('');
    log('  Failed tests:');
    results.tests
      .filter(t => !t.passed)
      .forEach(t => log(`    - ${t.name}: ${t.details || 'Unknown error'}`));
  }

  log('');
  log('════════════════════════════════════════════════════════════════');

  process.exit(results.failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
