// SPDX-License-Identifier: MIT
pragma solidity >=0.8.9;

/*
   CollectorDAO is your friendly DAO to help you and your friends come togehter
   and automate the process of buying NFTs together.  You are more than welcome
   to propose other types of transactions.  Come be part of this awesome DAO!

   NOT a rugpull :D

   Voting Mechanism:
   - Proposal is active on the next block after creation
   - Voters can vote up until either a 25% quorum has reached OR 3 days have passed.
   - A voter has to have been a member at the time of proposal to be eligible for a vote.
   - If proposal succeeds, anyone can execute the proposal.
   - Combined ETH of all function calls in proposal has to be less than 25% of the total funds held by DAO.
*/
contract CollectorDAO {
    // hashes for EIP712 standard
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)");
    bytes32 public constant VOTE_TYPEHASH = keccak256("VoteSig(uint256 proposalId,bool support)");
    // ----

    // max of 5 proposal function calls
    uint8 public constant PROPOSAL_TRANSACTION_LENGTH = 5;

    // 3 days; short length but NFT prices are volatile; lets move fast
    uint256 public constant PROPOSAL_LENGTH = 3 days;

    // can handle up to 100 vote signatures
    uint256 public constant MAX_BULK_SIGNATURES = 100;

    uint256 public memberCount;

    uint256 public proposalCount;

    uint256 public totalFunds;

    NftMarketplace public nftMarketplace;

    Proposal[] public proposals;

    mapping(address => Member) public members;

    enum VoterDecision {
        NotVoted,
        For,
        Against
    }

    enum ProposalState {
        Active,
        Cancelled,
        Success,
        Failed,
        Expired,
        Executed
    }

    struct Member {
        uint256 memberId;
        uint256 joinDate;
        bool active;
        mapping(uint256 => VoterDecision) votes;
    }

    // Signature interface accepted by voting functions
    struct VoteBySigInput {
        uint256 proposalId;
        bool support;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct ProposalInput {
        address target;
        uint256 callValue;
        string functionSig;
        bytes functionCalldata;
    }

    struct Proposal {
        uint256 id;
        // function calls
        address[] targets;
        uint256[] values;
        string[] functionSigs;
        bytes[] functionCalldatas;
        // ----
        address proposedBy;
        uint256 startDate;
        uint256 endDate;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 totalFundsSnapshot;
        uint256 memberSnapshot;
        bool cancelled;
        bool executed;
    }

    constructor(address _nftMarketplace) {
        nftMarketplace = NftMarketplace(_nftMarketplace);
    }

    /*
        Allows users to buy membership
            - 1 eth
            - can't buy in twice
    */
    function buyMembership() external payable {
        require(msg.value == 1 ether, "CollectorDAO: send exactly 1eth please");
        require(!members[msg.sender].active, "CollectorDAO: member already exists");

        totalFunds += msg.value;

        Member storage newMember = members[msg.sender];
        newMember.memberId = memberCount++;
        newMember.joinDate = block.timestamp;
        newMember.active = true;
    }

    /*
        Allows users to buy membership
            - Mmebers only
            - New proposal is created and expiration is set
    */
    function propose(
        address[] memory _targets,
        uint256[] memory _values,
        string[] memory _functionSigs,
        bytes[] memory _functionCalldatas
    ) external returns (uint256) {
        require(members[msg.sender].active, "CollectorDAO: Not a member");
        require(
            _targets.length > 0 && _targets.length <= PROPOSAL_TRANSACTION_LENGTH,
            "CollectorDAO: Invalid proposal length"
        );
        require(
            _targets.length == _values.length &&
                _targets.length == _functionSigs.length &&
                _targets.length == _functionCalldatas.length,
            "CollectorDAO: Length error"
        );

        Proposal memory newProposal = Proposal({
            id: proposalCount++,
            targets: _targets,
            values: _values,
            functionSigs: _functionSigs,
            functionCalldatas: _functionCalldatas,
            proposedBy: msg.sender,
            startDate: block.timestamp,
            endDate: block.timestamp + PROPOSAL_LENGTH,
            forVotes: 0,
            againstVotes: 0,
            memberSnapshot: memberCount,
            totalFundsSnapshot: totalFunds,
            cancelled: false,
            executed: false
        });
        proposals.push(newProposal);
        emit ProposalCreated(msg.sender, newProposal.id);

        return newProposal.id;
    }

    // member who proposed can cancel said proposal
    function cancel(uint256 proposalId) external {
        require(msg.sender == proposals[proposalId].proposedBy, "CollectorDAO: Cancel request denied");
        require(state(proposalId) == ProposalState.Active, "CollectorDAO: Proposal can't be cancelled");

        proposals[proposalId].cancelled = true;
        emit ProposalCancelled(msg.sender, proposalId);
    }

    // Old fashioned vote call; member pays gas
    function vote(uint256 proposalId, bool support) external {
        require(_vote(msg.sender, proposalId, support), "CollectorDAO: Casting vote failed");
    }

    // vote with a signature; as long as signature address is valid anyone can call this
    function voteWithSig(VoteBySigInput memory _sig) external {
        address voterAddress = _getAddressFromSig(_sig);
        require(_vote(voterAddress, _sig.proposalId, _sig.support), "CollectorDAO: Casting vote failed");
    }

    // same as above except do it in bulk
    // Note:  if casting any vote fails, event is emitted and rest of votes are processed
    function bulkVoteWithSig(VoteBySigInput[] memory _sigs) external {
        require(_sigs.length > 0 && _sigs.length <= MAX_BULK_SIGNATURES, "CollectorDAO: Invalid length");

        for (uint256 i = 0; i < _sigs.length; i++) {
            address voterAddress = _getAddressFromSig(_sigs[i]);

            // if the vote isn't successful, emit an event and keep casting the other
            // votes vs. reverting entire transaction (waste of gas)
            if (!_vote(voterAddress, _sigs[i].proposalId, _sigs[i].support)) {
                emit CastVoteFailed(voterAddress, _sigs[i].proposalId);
            }
        }
    }

    function _vote(
        address voter,
        uint256 proposalId,
        bool support
    )
        private
        returns (
            // return bool to better handle batch jobs
            bool
        )
    {
        Proposal storage proposal = proposals[proposalId];
        Member storage member = members[voter];
        VoterDecision decision = member.votes[proposalId];
        if (
            !members[voter].active || // has to be active member
            state(proposalId) != ProposalState.Active || // has to be active proposal
            member.joinDate > proposal.startDate || // has to be member prior to proposal creation
            decision != VoterDecision.NotVoted || // member hasn't voted yet
            proposal.startDate >= block.timestamp // same transaction protection?
        ) return false;

        emit CastedVote(voter, proposalId, support);
        if (support) {
            member.votes[proposalId] = VoterDecision.For;
            proposal.forVotes += 1;
        } else {
            member.votes[proposalId] = VoterDecision.Against;
            proposal.againstVotes += 1;
        }

        return true;
    }

    // returns the recovered voter address based on the signature
    function _getAddressFromSig(VoteBySigInput memory _sig) private view returns (address) {
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256(bytes("CollectorDAO")), getChainIdInternal(), address(this))
        );
        bytes32 structHash = keccak256(abi.encode(VOTE_TYPEHASH, _sig.proposalId, _sig.support));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        return ecrecover(digest, _sig.v, _sig.r, _sig.s);
    }

    // returns the state of a given proposal based on the data in storage
    function state(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage prop = proposals[proposalId];
        if (prop.cancelled) return ProposalState.Cancelled;
        else if (prop.executed) return ProposalState.Executed;
        else if (prop.forVotes * 4 >= prop.memberSnapshot) return ProposalState.Success;
        else if (prop.againstVotes * 4 >= prop.memberSnapshot) return ProposalState.Failed;
        else if (block.timestamp >= prop.endDate) return ProposalState.Expired;
        else return ProposalState.Active;
    }

    // anyone can execute proposal
    // as long as it passes the checks, proposal can be invoked
    function executeProposal(uint256 _proposalId) external {
        require(state(_proposalId) == ProposalState.Success, "CollectorDAO: Proposal can't be executed");

        Proposal storage proposal = proposals[_proposalId];
        proposal.executed = true;
        uint256 totalFundsBeforeExec = proposal.totalFundsSnapshot;
        uint256 totalValueSpentOnTransaction;
        for (uint256 i = 0; i < proposal.targets.length; i++) {
            // Proposal cannot spend more than 25% of contract funds
            // Protection against whales
            // see test on line 205 in CollectorDAO.test.ts
            totalValueSpentOnTransaction += proposal.values[i];
            require(
                totalValueSpentOnTransaction * 4 < totalFundsBeforeExec,
                "CollectorDAO: Proposal cost upper limit error"
            );
            _executeTransaction(
                proposal.targets[i],
                proposal.values[i],
                proposal.functionSigs[i],
                proposal.functionCalldatas[i]
            );
        }
        emit ProposalExecuted(msg.sender, _proposalId);
    }

    function _executeTransaction(
        address _target,
        uint256 _value,
        string storage _functionSig,
        bytes storage _callData
    ) private {
        bytes memory packedCallData = abi.encodePacked(bytes4(keccak256(bytes(_functionSig))), _callData);
        totalFunds -= _value;
        (bool success, ) = _target.call{ value: _value }(packedCallData);
        require(success, "CollectorDAO: Execution failed");
    }

    function buyNftViaProposal(address _nftContract, uint256 _nftId) public payable {
        require(address(this) == msg.sender, "CollectorDAO: Only contract permission");
        uint256 currentNftPrice = nftMarketplace.getPrice(_nftContract, _nftId);
        require(msg.value >= currentNftPrice, "CollectorDAO: Proposal execution price error");

        bool success = nftMarketplace.buy{ value: msg.value }(_nftContract, _nftId);
        require(success, "CollectorDAO: Proposal execution buy error");
    }

    // copied from:
    // https://ethereum.stackexchange.com/questions/ +
    //     56749/retrieve-chain-id-of-the-executing-chain-from-a-solidity-contract
    // gets the chain id
    function getChainIdInternal() internal view returns (uint256) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return chainId;
    }

    // EVENTS
    event ProposalCancelled(address indexed user, uint256 proposalId);
    event ProposalExecuted(address indexed user, uint256 proposalId);
    event ProposalCreated(address indexed user, uint256 proposalId);
    event CastedVote(address indexed voter, uint256 proposalId, bool support);
    event CastVoteFailed(address indexed voter, uint256 proposalId);
}

interface NftMarketplace {
    function getPrice(address nftContract, uint256 nftId) external returns (uint256 price);

    function buy(address nftContract, uint256 nftId) external payable returns (bool success);
}
