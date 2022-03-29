# DAO Readme

#shipyard/dao/readme

## CollectorDAO - Your friendly NFT purchase DAO

The purpose of this DAO is to build a mutual way of investing and purchasing in NFTs that the community finds valuable.

`Membership fee` : 1 eth

Once you’re a member, you can propose an NFT to purchase and the community votes on the proposal.

### Voting Rules

- You have to be a member prior to the proposal creation.
- Members are given 1 vote per proposal.
- Once quorum (25%) is reached, any member is allowed to execute the proposal. Quorum is based on number of members at time of proposal creation.
- Proposal execution will fail if the proposal moves more than 25% of the ETH stored in the DAO at the time of proposal is created. This serves as protection for the DAO. 🐳 watch.

Risks/Tradeoffs:

- 75% of the value of the contract is locked up. Without this risk, someone could hijack the contract by buying more than quorum; users can vote to move the 75% of the funds out later if needed.
- New members lose 75% of their buying power in DAO. On the flip side, they gain 25% of the buying power of DAO via proposals. DAO may introduce tokens in the future for membership; anything is possible.
- Members that join after proposal is live can’t vote but their money could be used for the proposal purchase. Users should check in flight proposals and choose if they’d like to be a member.
- No delays between execution. Since NFT purchases need to be quick and fast, this DAO optimized for speed.
