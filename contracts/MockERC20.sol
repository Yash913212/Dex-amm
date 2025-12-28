// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    /// @notice Create a mock ERC-20 token and mint 1,000,000 tokens to the deployer
    /// @param name Token name
    /// @param symbol Token symbol
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1000000 * 10**18); // Mint 1 million tokens
    }

    /// @notice Mint tokens for testing
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
