// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IResolver.sol";

/**
 * @title IERC20
 * @notice Minimal ERC20 interface for USDC
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title MarketFactory
 * @notice Core contract for Clawshi Prediction Market Protocol
 * @dev Creates and manages prediction markets with pluggable resolvers
 *
 * Features:
 * - Multiple resolver support (Chainlink, Manual, Custom)
 * - 0.1 USDC minimum stake
 * - 1% protocol fee
 * - Proportional payout system
 * - Market creator fees (optional)
 */
contract MarketFactory {
    // ============ Structs ============

    struct Market {
        uint256 id;
        string question;
        address creator;
        address resolver;
        bytes resolverData;
        uint256 deadline;
        uint256 yesPool;
        uint256 noPool;
        uint256 creatorFee; // basis points (100 = 1%)
        bool resolved;
        bool outcome;
        bool paused;
    }

    struct Stake {
        uint256 amount;
        bool isYes;
        bool claimed;
    }

    // ============ State Variables ============

    // USDC token
    IERC20 public immutable usdc;

    // Protocol settings
    address public owner;
    address public treasury;
    uint256 public protocolFeeBps = 100; // 1% = 100 basis points
    uint256 public minStake = 100000; // 0.1 USDC (6 decimals)
    uint256 public maxCreatorFeeBps = 500; // Max 5%

    // Markets
    Market[] public markets;
    mapping(uint256 => mapping(address => Stake)) public stakes;

    // Approved resolvers
    mapping(address => bool) public approvedResolvers;

    // Reentrancy guard
    uint256 private _locked = 1;

    // ============ Events ============

    event MarketCreated(
        uint256 indexed marketId,
        string question,
        address indexed creator,
        address indexed resolver,
        uint256 deadline
    );

    event Staked(
        uint256 indexed marketId,
        address indexed user,
        bool isYes,
        uint256 amount
    );

    event MarketResolved(
        uint256 indexed marketId,
        bool outcome,
        uint256 yesPool,
        uint256 noPool
    );

    event Claimed(
        uint256 indexed marketId,
        address indexed user,
        uint256 payout
    );

    event ResolverApproved(address indexed resolver, bool approved);
    event ProtocolFeeUpdated(uint256 newFeeBps);
    event MinStakeUpdated(uint256 newMinStake);
    event MarketPaused(uint256 indexed marketId, bool paused);

    // ============ Errors ============

    error Unauthorized();
    error InvalidResolver();
    error InvalidDeadline();
    error InvalidAmount();
    error InvalidPosition();
    error MarketNotFound();
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error MarketPausedError();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error AlreadyClaimed();
    error NoWinnings();
    error TransferFailed();
    error ReentrancyGuard();
    error CreatorFeeTooHigh();
    error CannotResolveYet();

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_locked == 2) revert ReentrancyGuard();
        _locked = 2;
        _;
        _locked = 1;
    }

    modifier marketExists(uint256 marketId) {
        if (marketId >= markets.length) revert MarketNotFound();
        _;
    }

    // ============ Constructor ============

    constructor(address _usdc, address _treasury, address _owner) {
        usdc = IERC20(_usdc);
        treasury = _treasury;
        owner = _owner;
    }

    // ============ Market Creation ============

    /**
     * @notice Create a new prediction market
     * @param question The market question
     * @param resolver Address of the resolver contract
     * @param resolverData Encoded data for the resolver
     * @param deadline Unix timestamp for staking deadline
     * @param creatorFeeBps Creator fee in basis points (0-500)
     * @return marketId The ID of the created market
     */
    function createMarket(
        string calldata question,
        address resolver,
        bytes calldata resolverData,
        uint256 deadline,
        uint256 creatorFeeBps
    ) external returns (uint256 marketId) {
        // Validate resolver
        if (!approvedResolvers[resolver]) revert InvalidResolver();

        // Validate deadline
        if (deadline <= block.timestamp) revert InvalidDeadline();

        // Validate creator fee
        if (creatorFeeBps > maxCreatorFeeBps) revert CreatorFeeTooHigh();

        marketId = markets.length;

        markets.push(Market({
            id: marketId,
            question: question,
            creator: msg.sender,
            resolver: resolver,
            resolverData: resolverData,
            deadline: deadline,
            yesPool: 0,
            noPool: 0,
            creatorFee: creatorFeeBps,
            resolved: false,
            outcome: false,
            paused: false
        }));

        emit MarketCreated(marketId, question, msg.sender, resolver, deadline);

        return marketId;
    }

    // ============ Staking ============

    /**
     * @notice Stake USDC on a market outcome
     * @param marketId The market to stake on
     * @param isYes True to stake on YES, false for NO
     * @param amount Amount of USDC to stake (6 decimals)
     */
    function stake(
        uint256 marketId,
        bool isYes,
        uint256 amount
    ) external nonReentrant marketExists(marketId) {
        Market storage market = markets[marketId];

        // Validations
        if (market.resolved) revert MarketAlreadyResolved();
        if (market.paused) revert MarketPausedError();
        if (block.timestamp >= market.deadline) revert DeadlinePassed();
        if (amount < minStake) revert InvalidAmount();

        // Get existing stake
        Stake storage userStake = stakes[marketId][msg.sender];

        // If user already staked, must stake same side
        if (userStake.amount > 0 && userStake.isYes != isYes) {
            revert InvalidPosition();
        }

        // Transfer USDC from user
        if (!usdc.transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }

        // Update pools
        if (isYes) {
            market.yesPool += amount;
        } else {
            market.noPool += amount;
        }

        // Update user stake
        userStake.amount += amount;
        userStake.isYes = isYes;

        emit Staked(marketId, msg.sender, isYes, amount);
    }

    // ============ Resolution ============

    /**
     * @notice Resolve a market using its resolver
     * @param marketId The market to resolve
     */
    function resolveMarket(uint256 marketId) external nonReentrant marketExists(marketId) {
        Market storage market = markets[marketId];

        // Validations
        if (market.resolved) revert MarketAlreadyResolved();
        if (block.timestamp < market.deadline) revert DeadlineNotPassed();

        IResolver resolver = IResolver(market.resolver);

        // Check if can resolve
        if (!resolver.canResolve(marketId, market.resolverData)) {
            revert CannotResolveYet();
        }

        // Get outcome from resolver
        bool outcome = resolver.resolve(marketId, market.resolverData);

        // Update market
        market.resolved = true;
        market.outcome = outcome;

        emit MarketResolved(marketId, outcome, market.yesPool, market.noPool);
    }

    // ============ Claiming ============

    /**
     * @notice Claim winnings from a resolved market
     * @param marketId The market to claim from
     */
    function claim(uint256 marketId) external nonReentrant marketExists(marketId) {
        Market storage market = markets[marketId];
        Stake storage userStake = stakes[marketId][msg.sender];

        // Validations
        if (!market.resolved) revert MarketNotResolved();
        if (userStake.claimed) revert AlreadyClaimed();
        if (userStake.amount == 0) revert NoWinnings();

        // Check if user won
        bool userWon = (market.outcome && userStake.isYes) ||
                       (!market.outcome && !userStake.isYes);

        if (!userWon) {
            userStake.claimed = true;
            revert NoWinnings();
        }

        // Calculate payout
        uint256 totalPool = market.yesPool + market.noPool;
        uint256 winningPool = market.outcome ? market.yesPool : market.noPool;
        uint256 grossPayout = (userStake.amount * totalPool) / winningPool;

        // Calculate fees
        uint256 protocolFee = (grossPayout * protocolFeeBps) / 10000;
        uint256 creatorFee = (grossPayout * market.creatorFee) / 10000;
        uint256 netPayout = grossPayout - protocolFee - creatorFee;

        // Mark as claimed
        userStake.claimed = true;

        // Transfer fees
        if (protocolFee > 0) {
            if (!usdc.transfer(treasury, protocolFee)) revert TransferFailed();
        }
        if (creatorFee > 0) {
            if (!usdc.transfer(market.creator, creatorFee)) revert TransferFailed();
        }

        // Transfer payout
        if (!usdc.transfer(msg.sender, netPayout)) revert TransferFailed();

        emit Claimed(marketId, msg.sender, netPayout);
    }

    // ============ View Functions ============

    /**
     * @notice Get market details
     */
    function getMarket(uint256 marketId) external view marketExists(marketId) returns (Market memory) {
        return markets[marketId];
    }

    /**
     * @notice Get user stake for a market
     */
    function getStake(uint256 marketId, address user) external view returns (Stake memory) {
        return stakes[marketId][user];
    }

    /**
     * @notice Get total number of markets
     */
    function getMarketCount() external view returns (uint256) {
        return markets.length;
    }

    /**
     * @notice Calculate current odds for a market
     * @return yesOdds YES percentage (0-100)
     * @return noOdds NO percentage (0-100)
     */
    function getOdds(uint256 marketId) external view marketExists(marketId) returns (
        uint256 yesOdds,
        uint256 noOdds
    ) {
        Market storage market = markets[marketId];
        uint256 total = market.yesPool + market.noPool;

        if (total == 0) return (50, 50);

        yesOdds = (market.yesPool * 100) / total;
        noOdds = 100 - yesOdds;
    }

    /**
     * @notice Calculate potential payout for a stake
     */
    function calculatePayout(
        uint256 marketId,
        bool isYes,
        uint256 amount
    ) external view marketExists(marketId) returns (uint256 potentialPayout) {
        Market storage market = markets[marketId];

        uint256 newYesPool = isYes ? market.yesPool + amount : market.yesPool;
        uint256 newNoPool = isYes ? market.noPool : market.noPool + amount;
        uint256 totalPool = newYesPool + newNoPool;
        uint256 winningPool = isYes ? newYesPool : newNoPool;

        uint256 grossPayout = (amount * totalPool) / winningPool;
        uint256 fees = (grossPayout * (protocolFeeBps + market.creatorFee)) / 10000;

        return grossPayout - fees;
    }

    // ============ Admin Functions ============

    /**
     * @notice Approve or revoke a resolver
     */
    function setResolverApproval(address resolver, bool approved) external onlyOwner {
        approvedResolvers[resolver] = approved;
        emit ResolverApproved(resolver, approved);
    }

    /**
     * @notice Update protocol fee
     */
    function setProtocolFee(uint256 newFeeBps) external onlyOwner {
        require(newFeeBps <= 500, "Fee too high"); // Max 5%
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(newFeeBps);
    }

    /**
     * @notice Update minimum stake
     */
    function setMinStake(uint256 newMinStake) external onlyOwner {
        minStake = newMinStake;
        emit MinStakeUpdated(newMinStake);
    }

    /**
     * @notice Update treasury address
     */
    function setTreasury(address newTreasury) external onlyOwner {
        treasury = newTreasury;
    }

    /**
     * @notice Pause/unpause a market
     */
    function pauseMarket(uint256 marketId, bool paused) external onlyOwner marketExists(marketId) {
        markets[marketId].paused = paused;
        emit MarketPaused(marketId, paused);
    }

    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    /**
     * @notice Emergency withdraw (only if contract is deprecated)
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }
}
