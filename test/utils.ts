import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from "hardhat";

const { splitSignature } = ethers.utils;

type DomainData = {
  chainId: number;
  verifyingContract: string;
};

type VoteData = {
  proposalId: number;
  support: boolean;
};

export const voteTypes = {
  VoteSig: [
    { name: "proposalId", type: "uint256" },
    { name: "support", type: "bool" },
  ],
};

export const createDomainType = ({ chainId, verifyingContract }: DomainData) => ({
  name: "CollectorDAO",
  chainId,
  verifyingContract,
});

export const createVoteType = ({ proposalId, support }: VoteData) => ({
  proposalId,
  support,
});

export type SignedMessageType = {
  proposalId: number;
  support: boolean;
  v: number;
  r: string;
  s: string;
};

export const signVoteByVoter = async (
  signer: SignerWithAddress,
  verifyingContract: string,
  { proposalId, support }: VoteData,
): Promise<SignedMessageType> => {
  const { chainId } = await ethers.provider.getNetwork();
  const signature = await signer._signTypedData(
    createDomainType({ chainId, verifyingContract }),
    voteTypes,
    createVoteType({ proposalId, support }),
  );
  const { v, r, s } = splitSignature(signature);

  return {
    proposalId,
    support,
    v,
    r,
    s,
  };
};
