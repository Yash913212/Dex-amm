const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const tokenA = await MockERC20.deploy("Token A", "TKA");
    await tokenA.deployed();

    const tokenB = await MockERC20.deploy("Token B", "TKB");
    await tokenB.deployed();

    const DEX = await ethers.getContractFactory("DEX");
    const dex = await DEX.deploy(tokenA.address, tokenB.address);
    await dex.deployed();

    console.log("Deployer:", deployer.address);
    console.log("TokenA:", tokenA.address);
    console.log("TokenB:", tokenB.address);
    console.log("DEX:", dex.address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});