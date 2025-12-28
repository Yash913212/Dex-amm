# DEX AMM Project

## Overview
This repository implements a simplified Uniswap V2-style Automated Market Maker (AMM) DEX for swapping between two ERC-20 tokens. Users can add/remove liquidity (tracked via internal LP accounting) and swap using the constant product invariant.

## Features
- Initial and subsequent liquidity provision
- Liquidity removal with proportional share calculation
- Token swaps using constant product formula (x * y = k)
- 0.3% trading fee for liquidity providers
- LP token minting and burning (tracked via `totalLiquidity` + `liquidity(address)`)

## Architecture
- `contracts/MockERC20.sol`: Simple ERC-20 token for local testing.
- `contracts/DEX.sol`: Core AMM pool with:
  - reserves (`reserveA`, `reserveB`)
  - LP accounting (`totalLiquidity`, `liquidity` mapping)
  - swap functions and quote function (`getAmountOut`)

Design choices:
- LP shares are tracked inside the DEX contract (instead of a separate ERC-20 LP token contract) to keep the project small.
- Uses OpenZeppelin `ReentrancyGuard` + `SafeERC20` for safer token transfers.
- For simplicity and determinism, subsequent liquidity additions require the exact pool ratio.

## Mathematical Implementation

### Constant Product Formula
Let:
- $x$ = reserve of Token A
- $y$ = reserve of Token B
- $k = x \cdot y$

For a swap, the pool computes output such that $k$ does not decrease (and typically increases slightly due to fees).

### Fee Calculation
A 0.3% fee is applied by discounting the effective input amount using the Uniswap V2-style formula:

$$
\text{amountInWithFee} = \text{amountIn} \cdot 997
$$

$$
\text{amountOut} = \frac{\text{amountInWithFee} \cdot \text{reserveOut}}{\text{reserveIn} \cdot 1000 + \text{amountInWithFee}}
$$

Because the contract adds the full `amountIn` to reserves but computes `amountOut` using the fee-adjusted amount, the fee remains in the pool, benefiting LPs. This tends to make $k$ increase over time.

### LP Token Minting
1. **Initial Liquidity (first provider)**

$$
\text{liquidityMinted} = \lfloor\sqrt{\text{amountA} \cdot \text{amountB}}\rfloor
$$

2. **Subsequent Liquidity**
To keep the price unchanged, the contract requires:

$$
\text{amountB} = \left\lfloor \frac{\text{amountA} \cdot \text{reserveB}}{\text{reserveA}} \right\rfloor
$$

Then mints LP proportionally:

$$
\text{liquidityMinted} = \left\lfloor \frac{\text{amountA} \cdot \text{totalLiquidity}}{\text{reserveA}} \right\rfloor
$$

## Setup Instructions

### Prerequisites
- Docker and Docker Compose installed
- Git

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd dex-amm
```

2. Start Docker environment:
```bash
docker-compose up -d
```

3. Compile contracts:
```bash
docker-compose exec app npm run compile
```

4. Run tests:
```bash
docker-compose exec app npm test
```

5. Check coverage:
```bash
docker-compose exec app npm run coverage
```

6. Stop Docker:
```bash
docker-compose down
```

## Running Tests Locally (without Docker)
```bash
npm install
npm run compile
npm test
```

## Contract Addresses
If deployed to a public testnet, list addresses here along with block explorer links.

## Known Limitations
- Only supports a single pair (Token A / Token B).
- No slippage protection parameters (e.g., `minAmountOut`) to keep the interface minimal.
- Subsequent liquidity additions require the exact existing ratio.

## Security Considerations
- `ReentrancyGuard` is used on state-changing external functions.
- `SafeERC20` is used for token transfers.
- Inputs are validated (non-zero amounts, sufficient reserves, sufficient LP balance).
- Note: This is an educational implementation and not audited.
