// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IResolver
 * @notice Interface for market resolution strategies
 * @dev All resolvers must implement this interface
 */
interface IResolver {
    /**
     * @notice Check if a market can be resolved
     * @param marketId The market identifier
     * @param resolverData Custom data for the resolver
     * @return canResolve Whether the market can be resolved now
     */
    function canResolve(
        uint256 marketId,
        bytes calldata resolverData
    ) external view returns (bool canResolve);

    /**
     * @notice Resolve a market and return the outcome
     * @param marketId The market identifier
     * @param resolverData Custom data for the resolver
     * @return outcome True for YES, False for NO
     */
    function resolve(
        uint256 marketId,
        bytes calldata resolverData
    ) external returns (bool outcome);

    /**
     * @notice Get resolver type identifier
     * @return resolverType String identifier (e.g., "chainlink", "manual")
     */
    function resolverType() external pure returns (string memory);
}
