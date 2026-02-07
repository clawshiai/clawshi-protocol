# Clawshi Protocol

Open-source prediction market protocol on Base. Create markets, stake USDC, resolve via oracles or manual verification.

🦞 **Live on Base Mainnet** 🦞

## Features

- **Modular Resolvers** — Chainlink oracles for price feeds, manual resolution for events, or build your own
- **USDC Settlement** — Real stablecoin staking with proportional payouts
- **Low Barrier** — 0.1 USDC minimum stake
- **Creator Fees** — Optional 0-5% fee for market creators
- **Permissionless** — Anyone can create markets and integrate

## Deployed Contracts (Base Mainnet)

| Contract | Address |
|----------|---------|
| MarketFactory | [`0xc0DeBCEa2F1BcB268b01777ff9c8E3BB4dA85559`](https://basescan.org/address/0xc0DeBCEa2F1BcB268b01777ff9c8E3BB4dA85559) |
| ChainlinkResolver | [`0xDEbe4E62bEE1DA1657008480e6d91a3f1E3CCaeC`](https://basescan.org/address/0xDEbe4E62bEE1DA1657008480e6d91a3f1E3CCaeC) |
| ManualResolver | [`0x3602D8989920B9A9451BF9D9562Bb97BA7cEd1bb`](https://basescan.org/address/0x3602D8989920B9A9451BF9D9562Bb97BA7cEd1bb) |

**Chain:** Base Mainnet (8453)
**USDC:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      MarketFactory                          │
│  - Creates prediction markets                               │
│  - Manages USDC pools (YES/NO)                              │
│  - Handles staking, resolution, payouts                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                      IResolver                              │
│  - canResolve(marketId, data) → bool                        │
│  - resolve(marketId, data) → outcome                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│ ChainlinkResolver│    │  ManualResolver  │
│                  │    │                  │
│ BTC/USD, ETH/USD │    │ Admin-controlled │
│ Price oracles    │    │ Event outcomes   │
└──────────────────┘    └──────────────────┘
```

## Quick Start

### Install Dependencies

```bash
npm install ethers solc dotenv
```

### Create a Market

```javascript
import { ethers } from 'ethers';

const factory = new ethers.Contract(MARKET_FACTORY, abi, signer);

// Create a price prediction market
const tx = await factory.createMarket(
  "Will BTC be above $100K by March 2026?",  // question
  CHAINLINK_RESOLVER,                          // resolver
  resolverData,                                // encoded params
  1741046400,                                  // deadline (unix)
  0                                            // creator fee (bps)
);
```

### Stake on Outcome

```javascript
// Approve USDC first
await usdc.approve(MARKET_FACTORY, amount);

// Stake on YES
await factory.stake(marketId, true, ethers.parseUnits("10", 6));

// Stake on NO
await factory.stake(marketId, false, ethers.parseUnits("5", 6));
```

### Resolve & Claim

```javascript
// After deadline, anyone can trigger resolution
await factory.resolveMarket(marketId);

// Winners claim their payout
await factory.claim(marketId);
```

## Protocol Parameters

| Parameter | Value |
|-----------|-------|
| Min Stake | 0.1 USDC (100000 units) |
| Protocol Fee | 1% (100 bps) |
| Max Creator Fee | 5% (500 bps) |
| Stale Price Threshold | 1 hour |

## Payout Formula

```
totalPool = yesPool + noPool
winningPool = outcome ? yesPool : noPool

grossPayout = (userStake × totalPool) / winningPool
protocolFee = grossPayout × 1%
creatorFee = grossPayout × creatorFeeBps
netPayout = grossPayout - protocolFee - creatorFee
```

## Resolver Interface

Build custom resolvers by implementing `IResolver`:

```solidity
interface IResolver {
    function canResolve(
        uint256 marketId,
        bytes calldata resolverData
    ) external view returns (bool);

    function resolve(
        uint256 marketId,
        bytes calldata resolverData
    ) external returns (bool outcome);

    function resolverType() external pure returns (string memory);
}
```

### ChainlinkResolver

For price-based markets. Resolver data format:

```solidity
struct ResolverParams {
    string asset;        // "BTC", "ETH"
    uint256 targetPrice; // 8 decimals (e.g., 10000000000000 = $100,000)
    bool isGreaterThan;  // true: price >= target wins YES
    uint256 deadline;    // unix timestamp
}

bytes memory data = abi.encode(ResolverParams({
    asset: "BTC",
    targetPrice: 10000000000000,
    isGreaterThan: true,
    deadline: 1741046400
}));
```

### ManualResolver

For event-based markets (elections, sports, etc.):

```solidity
// Admin sets outcome before resolution
resolver.setOutcome(marketId, true);  // YES wins

// Then anyone can resolve the market
factory.resolveMarket(marketId);
```

## Deployment

### Environment Setup

```bash
cp .env.example .env
# Edit .env with your keys
```

```env
MAINNET_PRIVATE_KEY=0x...
MAINNET_RPC_URL=https://mainnet.base.org
MAINNET_USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

### Check Contracts

```bash
node scripts/check-contracts.js
```

### Deploy

```bash
node scripts/deploy-protocol.js
```

## Contract Functions

### MarketFactory

| Function | Description |
|----------|-------------|
| `createMarket(question, resolver, data, deadline, fee)` | Create new prediction market |
| `stake(marketId, isYes, amount)` | Stake USDC on YES or NO |
| `resolveMarket(marketId)` | Resolve market via oracle |
| `claim(marketId)` | Claim winnings |
| `getMarket(marketId)` | Get market details |
| `getStake(marketId, user)` | Get user's stake |
| `getOdds(marketId)` | Get current YES/NO percentages |
| `calculatePayout(marketId, isYes, amount)` | Preview potential payout |

### Admin Functions

| Function | Description |
|----------|-------------|
| `setResolverApproval(resolver, approved)` | Approve/revoke resolver |
| `setProtocolFee(bps)` | Update protocol fee (max 5%) |
| `setMinStake(amount)` | Update minimum stake |
| `pauseMarket(marketId, paused)` | Pause/unpause market |
| `transferOwnership(newOwner)` | Transfer ownership |

## Integration

### API

Dashboard & API available at: https://clawshi.app

```bash
# Get contract info
curl https://clawshi.app/api/contract

# Get all markets
curl https://clawshi.app/api/markets

# Get market details
curl https://clawshi.app/api/markets/0
```

### NPM Package (Coming Soon)

```bash
npm install @clawshi/protocol
```

## Security

- Reentrancy protection on all state-changing functions
- Owner-only admin functions
- Approved resolver whitelist
- Stale price protection (1 hour max)
- 2-step admin transfer on ManualResolver

## License

MIT

## Links

- **Dashboard:** https://clawshi.app
- **API Docs:** https://clawshi.app/api-docs
- **Twitter:** [@ClawshiAI](https://twitter.com/ClawshiAI)
- **BaseScan:** [View Contracts](https://basescan.org/address/0xc0DeBCEa2F1BcB268b01777ff9c8E3BB4dA85559)

---

Built with 🦞 on Base
