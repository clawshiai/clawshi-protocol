// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IResolver.sol";

/**
 * @title ManualResolver
 * @notice Resolves markets manually by admin or multi-sig
 * @dev Used for non-price markets (events, sports, politics, etc.)
 */
contract ManualResolver is IResolver {
    // Market outcomes set by admin
    mapping(uint256 => bool) public outcomes;
    mapping(uint256 => bool) public outcomeSet;
    mapping(uint256 => uint256) public deadlines;

    // Admin address (can be multi-sig)
    address public admin;

    // Pending admin for 2-step transfer
    address public pendingAdmin;

    // Events
    event OutcomeSet(uint256 indexed marketId, bool outcome, address indexed setBy);
    event DeadlineSet(uint256 indexed marketId, uint256 deadline);
    event AdminTransferInitiated(address indexed newAdmin);
    event AdminTransferCompleted(address indexed newAdmin);

    // Errors
    error Unauthorized();
    error OutcomeAlreadySet();
    error OutcomeNotSet();
    error DeadlineNotReached();
    error InvalidDeadline();

    constructor() {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    /**
     * @notice Set the deadline for a market
     * @param marketId The market identifier
     * @param deadline Unix timestamp when market can be resolved
     */
    function setDeadline(uint256 marketId, uint256 deadline) external onlyAdmin {
        if (deadline <= block.timestamp) revert InvalidDeadline();
        deadlines[marketId] = deadline;
        emit DeadlineSet(marketId, deadline);
    }

    /**
     * @notice Set the outcome for a market
     * @param marketId The market identifier
     * @param outcome True for YES, False for NO
     */
    function setOutcome(uint256 marketId, bool outcome) external onlyAdmin {
        if (outcomeSet[marketId]) revert OutcomeAlreadySet();

        outcomes[marketId] = outcome;
        outcomeSet[marketId] = true;

        emit OutcomeSet(marketId, outcome, msg.sender);
    }

    /**
     * @notice Batch set outcomes for multiple markets
     * @param marketIds Array of market identifiers
     * @param _outcomes Array of outcomes
     */
    function batchSetOutcome(
        uint256[] calldata marketIds,
        bool[] calldata _outcomes
    ) external onlyAdmin {
        require(marketIds.length == _outcomes.length, "Length mismatch");

        for (uint256 i = 0; i < marketIds.length; i++) {
            if (!outcomeSet[marketIds[i]]) {
                outcomes[marketIds[i]] = _outcomes[i];
                outcomeSet[marketIds[i]] = true;
                emit OutcomeSet(marketIds[i], _outcomes[i], msg.sender);
            }
        }
    }

    /**
     * @notice Check if market can be resolved
     */
    function canResolve(
        uint256 marketId,
        bytes calldata /* resolverData */
    ) external view override returns (bool) {
        // Must have outcome set
        if (!outcomeSet[marketId]) return false;

        // Must be past deadline (if set)
        uint256 deadline = deadlines[marketId];
        if (deadline > 0 && block.timestamp < deadline) return false;

        return true;
    }

    /**
     * @notice Resolve market with pre-set outcome
     */
    function resolve(
        uint256 marketId,
        bytes calldata /* resolverData */
    ) external override returns (bool outcome) {
        if (!outcomeSet[marketId]) revert OutcomeNotSet();

        uint256 deadline = deadlines[marketId];
        if (deadline > 0 && block.timestamp < deadline) revert DeadlineNotReached();

        return outcomes[marketId];
    }

    /**
     * @notice Check if outcome is set for a market
     */
    function isOutcomeSet(uint256 marketId) external view returns (bool) {
        return outcomeSet[marketId];
    }

    /**
     * @notice Get outcome for a market
     */
    function getOutcome(uint256 marketId) external view returns (bool outcome, bool isSet) {
        return (outcomes[marketId], outcomeSet[marketId]);
    }

    /**
     * @notice Initiate admin transfer (2-step process)
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        pendingAdmin = newAdmin;
        emit AdminTransferInitiated(newAdmin);
    }

    /**
     * @notice Accept admin transfer
     */
    function acceptAdmin() external {
        if (msg.sender != pendingAdmin) revert Unauthorized();
        admin = pendingAdmin;
        pendingAdmin = address(0);
        emit AdminTransferCompleted(msg.sender);
    }

    function resolverType() external pure override returns (string memory) {
        return "manual";
    }
}
