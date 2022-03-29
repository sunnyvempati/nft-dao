import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";
import { CollectorDAO, CollectorDAO__factory, NftMarketplace, NftMarketplace__factory } from "../src/types";
import { signVoteByVoter } from "./utils";
import { FakeContract, smock } from "@defi-wonderland/smock";
import { expect, use } from "chai";

const { parseEther, AbiCoder, Interface } = ethers.utils;

use(smock.matchers);

const SECONDS_IN_A_DAY = 60 * 60 * 24;

const mineBlock = async () => await ethers.provider.send("evm_mine", []);

const timeTravel = async (seconds: number) => {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await mineBlock();
};

describe("CollectorDAO", () => {
  const abiCoder = new AbiCoder();
  let addrs: SignerWithAddress[],
    collectorDAO: CollectorDAO,
    mockNftMarketplace: FakeContract<NftMarketplace>,
    fakeContract: FakeContract;
  beforeEach(async () => {
    const iRandomContract = new Interface(["function callMe(uint256 arg1) returns (bool success)"]);
    fakeContract = await smock.fake(iRandomContract);
    addrs = await ethers.getSigners();

    mockNftMarketplace = await smock.fake<NftMarketplace>("NftMarketplace");

    const collectorDaoFactory = <CollectorDAO__factory>await ethers.getContractFactory("CollectorDAO");
    collectorDAO = <CollectorDAO>await collectorDaoFactory.deploy(mockNftMarketplace.address);

    await collectorDAO.deployed();
  });

  const buyMemberships = (num: number) =>
    [...Array(num).keys()].forEach(async i => {
      await collectorDAO.connect(addrs[i]).buyMembership({ value: parseEther("1") });
    });

  it("allows user to buy membership", async () => {
    await expect(collectorDAO.connect(addrs[0]).buyMembership({ value: parseEther("0.9") })).to.be.revertedWith(
      "CollectorDAO: send exactly 1eth please",
    );
    await collectorDAO.connect(addrs[0]).buyMembership({ value: parseEther("1") });
    await expect(collectorDAO.connect(addrs[0]).buyMembership({ value: parseEther("1") })).to.be.revertedWith(
      "CollectorDAO: member already exists",
    );

    expect((await collectorDAO.members(addrs[0].address)).active).to.be.true;
    expect(await collectorDAO.memberCount()).to.equal(1);
  });

  it("allows users to propose", async () => {
    await collectorDAO.connect(addrs[0]).buyMembership({ value: parseEther("1") });

    await expect(collectorDAO.connect(addrs[0]).propose([], [], [], [])).to.be.revertedWith(
      "CollectorDAO: Invalid proposal length",
    );

    await expect(collectorDAO.connect(addrs[1]).propose([], [], [], [])).to.be.revertedWith(
      "CollectorDAO: Not a member",
    );

    await collectorDAO
      .connect(addrs[0])
      .propose([collectorDAO.address], [parseEther("10")], ["buyNftViaProposal(address,uint256)"], ["0x"]);
    const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
    expect(await collectorDAO.proposalCount()).to.equal(1);
    expect((await collectorDAO.proposals(0)).startDate).to.equal(latestTimestamp); // active
    expect((await collectorDAO.proposals(0)).endDate).to.equal(latestTimestamp + SECONDS_IN_A_DAY * 3); // active
  });

  it("allows users to vote", async () => {
    buyMemberships(10);

    await collectorDAO
      .connect(addrs[0])
      .propose([collectorDAO.address], [parseEther("10")], ["buyNftViaProposal(address,uint256)"], ["0x"]);
    await mineBlock();

    await collectorDAO.connect(addrs[10]).buyMembership({ value: parseEther("1") });
    await expect(collectorDAO.connect(addrs[10]).vote(0, true)).to.be.revertedWith("CollectorDAO: Casting vote failed");
    await expect(collectorDAO.connect(addrs[11]).vote(0, true)).to.be.revertedWith("CollectorDAO: Casting vote failed");

    await collectorDAO.connect(addrs[0]).vote(0, true);
    await collectorDAO.connect(addrs[1]).vote(0, false);
    await collectorDAO.connect(addrs[2]).vote(0, true);
    const proposal = await collectorDAO.proposals(0);
    expect(proposal.forVotes).to.equal(2);
    expect(proposal.againstVotes).to.equal(1);
  });

  it("allows users to vote with signature", async () => {
    await collectorDAO.connect(addrs[0]).buyMembership({ value: parseEther("1") });
    await collectorDAO
      .connect(addrs[0])
      .propose([collectorDAO.address], [parseEther("10")], ["buyNftViaProposal(address,uint256)"], ["0x"]);

    const voterSig = await signVoteByVoter(addrs[0], collectorDAO.address, { proposalId: 0, support: true });
    await collectorDAO.voteWithSig(voterSig);
    expect((await collectorDAO.proposals(0)).forVotes).to.equal(1);
  });

  it("allows for bulk voting with siguature", async () => {
    buyMemberships(10);
    await collectorDAO
      .connect(addrs[0])
      .propose([collectorDAO.address], [parseEther("10")], ["buyNftViaProposal(address,uint256)"], ["0x"]);

    const voteSigs = await (async () =>
      Promise.all(
        [...Array(3).keys()].map(
          async i => await signVoteByVoter(addrs[i + 1], collectorDAO.address, { proposalId: 0, support: true }),
        ),
      ))();

    await collectorDAO.bulkVoteWithSig(voteSigs);
    expect((await collectorDAO.proposals(0)).forVotes).to.equal(3);
  });

  it("allows user to execute successful proposals", async () => {
    buyMemberships(5);

    await collectorDAO
      .connect(addrs[0])
      .propose([fakeContract.address], [parseEther("1")], ["callMe(uint256)"], [abiCoder.encode(["uint256"], [10])]);

    await collectorDAO.connect(addrs[0]).vote(0, true);
    await collectorDAO.connect(addrs[1]).vote(0, true);

    await collectorDAO.connect(addrs[0]).executeProposal(0);
    expect(fakeContract.callMe).to.be.calledWith(10);
  });

  it("allows proposals to buy nfts", async () => {
    buyMemberships(5);

    await collectorDAO
      .connect(addrs[0])
      .propose(
        [collectorDAO.address],
        [parseEther("1")],
        ["buyNftViaProposal(address,uint256)"],
        [abiCoder.encode(["address", "uint256"], [addrs[6].address, 22])],
      );

    await collectorDAO.connect(addrs[0]).vote(0, true);
    await collectorDAO.connect(addrs[1]).vote(0, true);

    mockNftMarketplace.getPrice.returns(parseEther("2")); // price too high
    await expect(collectorDAO.connect(addrs[0]).executeProposal(0)).to.be.revertedWith(
      "CollectorDAO: Execution failed",
    );

    mockNftMarketplace.getPrice.returns(parseEther("0.5"));
    mockNftMarketplace.buy.returns(true);
    await collectorDAO.connect(addrs[0]).executeProposal(0);
    expect(mockNftMarketplace.getPrice).to.be.calledWith(addrs[6].address, 22);
    expect(mockNftMarketplace.buy).to.be.calledWith(addrs[6].address, 22);
  });

  it("does not allow execution if proposal failed", async () => {
    buyMemberships(3);

    await collectorDAO
      .connect(addrs[0])
      .propose([collectorDAO.address], [parseEther("10")], ["buyNftViaProposal(address,uint256)"], ["0x"]);

    await collectorDAO.connect(addrs[1]).vote(0, false);

    await expect(collectorDAO.connect(addrs[0]).executeProposal(0)).to.be.revertedWith(
      "CollectorDAO: Proposal can't be executed",
    );
  });

  it("executes multiple function calls on proposal", async () => {
    buyMemberships(3);

    await collectorDAO
      .connect(addrs[0])
      .propose(
        [fakeContract.address, collectorDAO.address],
        [parseEther("0"), parseEther("0.5")],
        ["callMe(uint256)", "buyNftViaProposal(address,uint256)"],
        [abiCoder.encode(["uint256"], [12]), abiCoder.encode(["address", "uint256"], [addrs[6].address, 22])],
      );

    await collectorDAO.connect(addrs[0]).vote(0, true);

    fakeContract.callMe.returns(true);
    mockNftMarketplace.getPrice.returns(parseEther("0.5"));
    mockNftMarketplace.buy.returns(true);

    await collectorDAO.connect(addrs[0]).executeProposal(0);
    expect(mockNftMarketplace.getPrice).to.be.calledWith(addrs[6].address, 22);
    expect(mockNftMarketplace.buy).to.be.calledWith(addrs[6].address, 22);
    expect(fakeContract.callMe).to.be.calledWith(12);
  });

  it("protects votes by whales", async () => {
    // 0-9 normal users
    // 10-14 whale creates 5 accounts giving them quorum
    buyMemberships(15);

    await collectorDAO.connect(addrs[10]).propose(
      [fakeContract.address, collectorDAO.address],
      [parseEther("2"), parseEther("3")], // adds up to way more than 25% of 15 ETH (balance of contract)
      ["callMe(uint256)", "buyNftViaProposal(address,uint256)"],
      [abiCoder.encode(["uint256"], [12]), abiCoder.encode(["address", "uint256"], [addrs[6].address, 22])],
    );

    // whale votes yes 5 times giving them quorum
    [11, 12, 13, 14].forEach(async i => await collectorDAO.connect(addrs[i]).vote(0, true));

    // 5 more eth into treasury
    // Note: proposal sitll successful, quorum met due to # of members at time of proposal
    [15, 16, 17, 18, 19].forEach(
      async i => await collectorDAO.connect(addrs[i]).buyMembership({ value: parseEther("1") }),
    );

    // whale executes proposal which gets reverted
    await expect(collectorDAO.connect(addrs[10]).executeProposal(0)).to.be.revertedWith(
      "CollectorDAO: Proposal cost upper limit error",
    );
  });

  it("does not allow voting or execution after expiration", async () => {
    buyMemberships(3);

    await collectorDAO
      .connect(addrs[0])
      .propose([fakeContract.address], [parseEther("3")], ["callMe(uint256)"], [abiCoder.encode(["uint256"], [10])]);

    await timeTravel(SECONDS_IN_A_DAY * 1);
    await collectorDAO.connect(addrs[0]).vote(0, true);
    await timeTravel(SECONDS_IN_A_DAY * 2.5);
    await expect(collectorDAO.connect(addrs[1]).vote(0, true)).to.be.revertedWith("CollectorDAO: Casting vote failed");
  });
});
