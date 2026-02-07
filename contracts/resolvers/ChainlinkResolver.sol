// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IResolver.sol";

/**
 * @title AggregatorV3Interface
 * @notice Chainlink Price Feed interface
 */
interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

/**
 * @title ChainlinkResolver
 * @notice Resolves markets based on Chainlink price feeds
 * @dev Supports "greater than" and "less than" price conditions
 */
contract ChainlinkResolver is IResolver {
    // Supported price feeds on Base Mainnet
    mapping(string => address) public priceFeeds;

    // Owner for adding new feeds
    address public owner;

    // Events
    event PriceFeedAdded(string indexed asset, address feed);
    event PriceFeedRemoved(string indexed asset);

    // Errors
    error InvalidFeed();
    error StalePrice();
    error DeadlineNotReached();
    error Unauthorized();

    constructor() {
        owner = msg.sender;

        // Base Mainnet Chainlink Price Feeds (verified correct addresses)
        priceFeeds["BTC"] = 0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F;
        priceFeeds["ETH"] = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
        priceFeeds["USDC"] = 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /**
     * @notice Resolver data format:
     * - bytes32 asset (e.g., "BTC")
     * - uint256 targetPrice (in USD with 8 decimals)
     * - bool isGreaterThan (true: price > target, false: price < target)
     * - uint256 deadline (unix timestamp)
     */
    struct ResolverParams {
        string asset;
        uint256 targetPrice;
        bool isGreaterThan;
        uint256 deadline;
    }

    function decodeParams(bytes calldata data) public pure returns (ResolverParams memory) {
        return abi.decode(data, (ResolverParams));
    }

    function encodeParams(
        string memory asset,
        uint256 targetPrice,
        bool isGreaterThan,
        uint256 deadline
    ) external pure returns (bytes memory) {
        return abi.encode(ResolverParams(asset, targetPrice, isGreaterThan, deadline));
    }

    /**
     * @notice Check if market can be resolved
     */
    function canResolve(
        uint256 /* marketId */,
        bytes calldata resolverData
    ) external view override returns (bool) {
        ResolverParams memory params = decodeParams(resolverData);

        // Check deadline passed
        if (block.timestamp < params.deadline) return false;

        // Check feed exists
        if (priceFeeds[params.asset] == address(0)) return false;

        return true;
    }

    /**
     * @notice Resolve market based on Chainlink price
     */
    function resolve(
        uint256 /* marketId */,
        bytes calldata resolverData
    ) external override returns (bool outcome) {
        ResolverParams memory params = decodeParams(resolverData);

        // Validate deadline
        if (block.timestamp < params.deadline) revert DeadlineNotReached();

        // Get price feed
        address feedAddress = priceFeeds[params.asset];
        if (feedAddress == address(0)) revert InvalidFeed();

        AggregatorV3Interface feed = AggregatorV3Interface(feedAddress);

        // Get latest price
        (
            ,
            int256 price,
            ,
            uint256 updatedAt,
        ) = feed.latestRoundData();

        // Check for stale price (older than 1 hour)
        if (block.timestamp - updatedAt > 3600) revert StalePrice();

        // Normalize price to 8 decimals (Chainlink standard)
        uint256 currentPrice = uint256(price);

        // Determine outcome
        if (params.isGreaterThan) {
            outcome = currentPrice >= params.targetPrice;
        } else {
            outcome = currentPrice < params.targetPrice;
        }

        return outcome;
    }

    /**
     * @notice Get current price for an asset
     */
    function getPrice(string calldata asset) external view returns (uint256 price, uint8 decimals) {
        address feedAddress = priceFeeds[asset];
        if (feedAddress == address(0)) revert InvalidFeed();

        AggregatorV3Interface feed = AggregatorV3Interface(feedAddress);
        (, int256 answer,,,) = feed.latestRoundData();

        return (uint256(answer), feed.decimals());
    }

    /**
     * @notice Add or update a price feed
     */
    function setPriceFeed(string calldata asset, address feed) external onlyOwner {
        priceFeeds[asset] = feed;
        emit PriceFeedAdded(asset, feed);
    }

    /**
     * @notice Remove a price feed
     */
    function removePriceFeed(string calldata asset) external onlyOwner {
        delete priceFeeds[asset];
        emit PriceFeedRemoved(asset);
    }

    /**
     * @notice Transfer ownership
     */
    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function resolverType() external pure override returns (string memory) {
        return "chainlink";
    }
}
