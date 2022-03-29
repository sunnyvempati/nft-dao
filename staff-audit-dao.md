https://github.com/ShipyardDAO/student.sunnyvempati/tree/dc054f25397c7f96f1a0bf3663a507aac528ed90/dao

The following is a micro audit by Alex.S


# General Comments

This is good, the code is clear. Your voting mechansim is unusual but you have explained it well. It just needed a bit more thought on the way its first to 25%  approach  would work with batch vote submission.


# Design Exercise

I couldn't find an answer for this.

# Issues

**[H-1]** Proposal can pass even though majority vote against it. or fail when a majority voted for it

In the `state` function at line 254 a proposal is considered to have passed if more than 25% of available votes have been cast in favour of it. Similarly at line 255 it is considered to have failed if more than 25% of availalbe voters have been cast against it. After either of these points is reached, no further votes will be accepted because of the check at line 221 in `_vote`. So if a bulk vote contains a quorum of votes for the proposal and also a quorum against it, the outcome will be determined by the ordering of the votes within the batch. Whichever side happens to reach 25% first, counting them in the order they appear the batch array, will win. This is unfair, the side with most votes should win.


**[M-1]** Proposer can arbitrarily cancel proposal

The proposer can cancel a proposal at any time until it either fails or succeeds. This gives them an unnecessary veto power. Consider restricting cancellation to some fixed initial time period, or to when only some small number of votes have been cast.


**[L-1]** NFT can be bought at above the current price

In `buyNftViaProposal` at line 303 a check is made that the `msg.value` is not less than the current price, but then the purchase goes ahead at the `msg.value` price even if it is greater than the current price for the NFT.


**[Q-1]** Unused struct

The struct `ProposalInput` is defined at line 77, but not used anywhere.


# Score

| Reason | Score |
|-|-|
| Late                       | - |
| Unfinished features        | - |
| Extra features             | - |
| Vulnerability              | 6 |
| Unanswered design exercise | 1 |
| Insufficient tests         | - |
| Technical mistake          | - |

Total: 7

Good effort!
