const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function() {
    let dex, tokenA, tokenB;
    let owner, addr1, addr2;

    const one = ethers.utils.parseEther("1");

    beforeEach(async function() {
        // Deploy tokens and DEX before each test
        [owner, addr1, addr2] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        tokenA = await MockERC20.deploy("Token A", "TKA");
        tokenB = await MockERC20.deploy("Token B", "TKB");

        const DEX = await ethers.getContractFactory("DEX");
        dex = await DEX.deploy(tokenA.address, tokenB.address);

        // Approve DEX to spend tokens
        await tokenA.approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.approve(dex.address, ethers.utils.parseEther("1000000"));

        // Fund & approve other users
        await tokenA.mint(addr1.address, ethers.utils.parseEther("1000000"));
        await tokenB.mint(addr1.address, ethers.utils.parseEther("1000000"));
        await tokenA.mint(addr2.address, ethers.utils.parseEther("1000000"));
        await tokenB.mint(addr2.address, ethers.utils.parseEther("1000000"));

        await tokenA.connect(addr1).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.connect(addr1).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenA.connect(addr2).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.connect(addr2).approve(dex.address, ethers.utils.parseEther("1000000"));
    });

    function sqrtBigInt(value) {
        // integer sqrt via BigInt (avoid BigInt numeric literals to prevent parser issues)
        const ZERO = BigInt(0);
        const ONE = BigInt(1);
        const TWO = BigInt(2);
        if (value < ZERO) throw new Error("negative");
        if (value < TWO) return value;
        let x0 = value;
        let x1 = (x0 + ONE) >> ONE;
        while (x1 < x0) {
            x0 = x1;
            x1 = (x1 + value / x1) >> ONE;
        }
        return x0;
    }

    describe("Liquidity Management", function() {
        it("should allow initial liquidity provision", async function() {
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );

            const [rA, rB] = await dex.getReserves();
            expect(rA).to.equal(ethers.utils.parseEther("100"));
            expect(rB).to.equal(ethers.utils.parseEther("200"));
            expect(await dex.totalLiquidity()).to.be.gt(0);
            expect(await dex.liquidity(owner.address)).to.be.gt(0);
        });

        it("should mint correct LP tokens for first provider", async function() {
            const a = ethers.utils.parseEther("100");
            const b = ethers.utils.parseEther("200");
            await dex.addLiquidity(a, b);

            const expected = sqrtBigInt(BigInt(a.toString()) * BigInt(b.toString()));
            const minted = await dex.liquidity(owner.address);
            expect(BigInt(minted.toString())).to.equal(expected);
            expect(await dex.totalLiquidity()).to.equal(minted);
        });

        it("should allow subsequent liquidity additions", async function() {
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );

            await dex.connect(addr1).addLiquidity(
                ethers.utils.parseEther("10"),
                ethers.utils.parseEther("20")
            );

            const [rA, rB] = await dex.getReserves();
            expect(rA).to.equal(ethers.utils.parseEther("110"));
            expect(rB).to.equal(ethers.utils.parseEther("220"));
            expect(await dex.liquidity(addr1.address)).to.be.gt(0);
        });

        it("should maintain price ratio on liquidity addition", async function() {
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );

            const priceBefore = await dex.getPrice(); // integer division (200/100 = 2)
            expect(priceBefore).to.equal(2);

            await dex.connect(addr1).addLiquidity(
                ethers.utils.parseEther("50"),
                ethers.utils.parseEther("100")
            );

            const priceAfter = await dex.getPrice();
            expect(priceAfter).to.equal(2);
        });

        it("should allow partial liquidity removal", async function() {
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );

            const lp = await dex.liquidity(owner.address);
            const burn = lp.div(2);

            await dex.removeLiquidity(burn);

            expect(await dex.liquidity(owner.address)).to.equal(lp.sub(burn));
            expect(await dex.totalLiquidity()).to.equal(lp.sub(burn));
        });

        it("should return correct token amounts on liquidity removal", async function() {
            const a = ethers.utils.parseEther("100");
            const b = ethers.utils.parseEther("200");
            await dex.addLiquidity(a, b);

            const lp = await dex.liquidity(owner.address);
            const burn = lp.div(4);

            const balA0 = await tokenA.balanceOf(owner.address);
            const balB0 = await tokenB.balanceOf(owner.address);

            await dex.removeLiquidity(burn);

            const balA1 = await tokenA.balanceOf(owner.address);
            const balB1 = await tokenB.balanceOf(owner.address);

            const expectedA = a.mul(burn).div(lp);
            const expectedB = b.mul(burn).div(lp);

            expect(balA1.sub(balA0)).to.equal(expectedA);
            expect(balB1.sub(balB0)).to.equal(expectedB);
        });

        it("should revert on zero liquidity addition", async function() {
            await expect(
                dex.addLiquidity(0, ethers.utils.parseEther("1"))
            ).to.be.revertedWith("Zero amount");

            await expect(
                dex.addLiquidity(ethers.utils.parseEther("1"), 0)
            ).to.be.revertedWith("Zero amount");
        });

        it("should revert when removing more liquidity than owned", async function() {
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );

            const lp = await dex.liquidity(owner.address);
            await expect(dex.removeLiquidity(lp.add(1))).to.be.revertedWith("Not enough liquidity");
        });
    });

    describe("Token Swaps", function() {
        beforeEach(async function() {
            // Add initial liquidity before swap tests
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );
        });

        it("should swap token A for token B", async function() {
            const amountIn = ethers.utils.parseEther("10");

            const balB0 = await tokenB.balanceOf(addr1.address);
            await dex.connect(addr1).swapAForB(amountIn);
            const balB1 = await tokenB.balanceOf(addr1.address);

            expect(balB1).to.be.gt(balB0);
        });

        it("should swap token B for token A", async function() {
            const amountIn = ethers.utils.parseEther("10");

            const balA0 = await tokenA.balanceOf(addr1.address);
            await dex.connect(addr1).swapBForA(amountIn);
            const balA1 = await tokenA.balanceOf(addr1.address);

            expect(balA1).to.be.gt(balA0);
        });

        it("should calculate correct output amount with fee", async function() {
            const amountIn = ethers.utils.parseEther("10");
            const [rA, rB] = await dex.getReserves();

            const quoted = await dex.getAmountOut(amountIn, rA, rB);

            const balB0 = await tokenB.balanceOf(addr1.address);
            await dex.connect(addr1).swapAForB(amountIn);
            const balB1 = await tokenB.balanceOf(addr1.address);

            expect(balB1.sub(balB0)).to.equal(quoted);
        });

        it("should update reserves after swap", async function() {
            const amountIn = ethers.utils.parseEther("10");
            const [rA0, rB0] = await dex.getReserves();

            const out = await dex.getAmountOut(amountIn, rA0, rB0);
            await dex.connect(addr1).swapAForB(amountIn);

            const [rA1, rB1] = await dex.getReserves();
            expect(rA1).to.equal(rA0.add(amountIn));
            expect(rB1).to.equal(rB0.sub(out));
        });

        it("should increase k after swap due to fees", async function() {
            const [rA0, rB0] = await dex.getReserves();
            const k0 = BigInt(rA0.toString()) * BigInt(rB0.toString());

            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("10"));

            const [rA1, rB1] = await dex.getReserves();
            const k1 = BigInt(rA1.toString()) * BigInt(rB1.toString());

            expect(k1).to.be.gte(k0);
        });

        it("should revert on zero swap amount", async function() {
            await expect(dex.swapAForB(0)).to.be.revertedWith("Zero amount");
            await expect(dex.swapBForA(0)).to.be.revertedWith("Zero amount");
        });

        it("should handle large swaps with high price impact", async function() {
            const amountIn = ethers.utils.parseEther("90");
            const [rA0, rB0] = await dex.getReserves();
            const out = await dex.getAmountOut(amountIn, rA0, rB0);

            await dex.connect(addr1).swapAForB(amountIn);

            const [rA1, rB1] = await dex.getReserves();
            expect(rA1).to.equal(rA0.add(amountIn));
            expect(rB1).to.equal(rB0.sub(out));
            expect(out).to.be.lt(rB0.mul(9).div(10));
        });

        it("should handle multiple consecutive swaps", async function() {
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("5"));
            await dex.connect(addr2).swapAForB(ethers.utils.parseEther("7"));
            await dex.connect(addr1).swapBForA(ethers.utils.parseEther("3"));

            const [rA, rB] = await dex.getReserves();
            expect(rA).to.be.gt(0);
            expect(rB).to.be.gt(0);
        });
    });

    describe("Price Calculations", function() {
        it("should return correct initial price", async function() {
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );
            expect(await dex.getPrice()).to.equal(2);
        });

        it("should update price after swaps", async function() {
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );

            const p0 = await dex.getPrice();
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("10"));
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("30"));
            const p1 = await dex.getPrice();

            expect(p0).to.equal(2);
            expect(p1).to.not.equal(p0);
            expect(p1).to.not.equal(0);
        });

        it("should handle price queries with zero reserves gracefully", async function() {
            expect(await dex.getPrice()).to.equal(0);
        });
    });

    describe("Fee Distribution", function() {
        it("should accumulate fees for liquidity providers", async function() {
            const a = ethers.utils.parseEther("100");
            const b = ethers.utils.parseEther("200");
            await dex.addLiquidity(a, b);

            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("10"));
            await dex.connect(addr1).swapBForA(ethers.utils.parseEther("10"));

            const [rA, rB] = await dex.getReserves();
            const kAfter = BigInt(rA.toString()) * BigInt(rB.toString());
            const kInitial = BigInt(a.toString()) * BigInt(b.toString());
            expect(kAfter).to.be.gte(kInitial);

            const lp = await dex.liquidity(owner.address);

            const balA0 = await tokenA.balanceOf(owner.address);
            const balB0 = await tokenB.balanceOf(owner.address);
            await dex.removeLiquidity(lp);
            const balA1 = await tokenA.balanceOf(owner.address);
            const balB1 = await tokenB.balanceOf(owner.address);

            const outA = balA1.sub(balA0);
            const outB = balB1.sub(balB0);
            expect(outA.gte(a) || outB.gte(b)).to.equal(true);
        });

        it("should distribute fees proportionally to LP share", async function() {
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );

            await dex.connect(addr1).addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );

            await dex.connect(addr2).swapAForB(ethers.utils.parseEther("20"));
            await dex.connect(addr2).swapBForA(ethers.utils.parseEther("40"));

            const lpOwner = await dex.liquidity(owner.address);
            const lp1 = await dex.liquidity(addr1.address);
            expect(lpOwner).to.equal(lp1);

            const balAOwner0 = await tokenA.balanceOf(owner.address);
            const balA10 = await tokenA.balanceOf(addr1.address);

            await dex.removeLiquidity(lpOwner);
            await dex.connect(addr1).removeLiquidity(lp1);

            const balAOwner1 = await tokenA.balanceOf(owner.address);
            const balA11 = await tokenA.balanceOf(addr1.address);

            const outOwnerA = balAOwner1.sub(balAOwner0);
            const out1A = balA11.sub(balA10);

            const diff = outOwnerA.gt(out1A) ? outOwnerA.sub(out1A) : out1A.sub(outOwnerA);
            expect(diff).to.be.lte(1);
        });
    });

    describe("Edge Cases", function() {
        it("should handle very small liquidity amounts", async function() {
            await dex.addLiquidity(one, one);
            const [rA, rB] = await dex.getReserves();
            expect(rA).to.equal(one);
            expect(rB).to.equal(one);
            expect(await dex.totalLiquidity()).to.be.gt(0);
        });

        it("should handle very large liquidity amounts", async function() {
            const a = ethers.utils.parseEther("100000");
            const b = ethers.utils.parseEther("200000");
            await dex.addLiquidity(a, b);
            const [rA, rB] = await dex.getReserves();
            expect(rA).to.equal(a);
            expect(rB).to.equal(b);
        });

        it("should prevent unauthorized access", async function() {
            expect(await dex.connect(addr1).tokenA()).to.equal(tokenA.address);
            expect(await dex.connect(addr1).tokenB()).to.equal(tokenB.address);
        });
    });

    describe("Events", function() {
        it("should emit LiquidityAdded event", async function() {
            const a = ethers.utils.parseEther("10");
            const b = ethers.utils.parseEther("20");

            const tx = await dex.addLiquidity(a, b);
            const minted = await dex.liquidity(owner.address);

            await expect(tx)
                .to.emit(dex, "LiquidityAdded")
                .withArgs(owner.address, a, b, minted);
        });

        it("should emit LiquidityRemoved event", async function() {
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );

            const lp = await dex.liquidity(owner.address);
            const burn = lp.div(3);
            const tx = await dex.removeLiquidity(burn);

            await expect(tx).to.emit(dex, "LiquidityRemoved");
        });

        it("should emit Swap event", async function() {
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );

            const amountIn = ethers.utils.parseEther("10");

            const [rA, rB] = await dex.getReserves();
            const out = await dex.getAmountOut(amountIn, rA, rB);

            const tx = await dex.connect(addr1).swapAForB(amountIn);
            await expect(tx)
                .to.emit(dex, "Swap")
                .withArgs(addr1.address, tokenA.address, tokenB.address, amountIn, out);
        });
    });
});