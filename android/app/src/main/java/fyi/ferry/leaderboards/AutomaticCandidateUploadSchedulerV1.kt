package fyi.ferry.leaderboards

// define the native contract
internal object AutomaticCandidateUploadSchedulerV1 {
    // derive one non-sensitive independent scheduling lane key
    fun entityKey(candidate: AutomaticCheckinCandidateV1): String = when (candidate) {
        is AutomaticCheckinCandidateV1.Terminal -> "terminal:${candidate.terminalId}"
        is AutomaticCheckinCandidateV1.Vessel -> "candidate:${candidate.candidateId}"
    }

    // select one independent upload head per terminal
    fun selectHeads(candidates: List<AutomaticCheckinCandidateV1>): List<AutomaticCheckinCandidateV1> {
        val selected = mutableListOf<AutomaticCheckinCandidateV1>()
        val selectedTerminalIds = mutableSetOf<String>()
        // order by the exact queue key
        val ordered = candidates.sortedWith(
            // run the bounded callback
            compareBy<AutomaticCheckinCandidateV1> { candidate -> candidate.capturedAtMs }
                // run the bounded callback
                .thenBy { candidate -> candidate.candidateId },
        )

        // visit oldest work before its same-terminal successors
        for (candidate in ordered) {
            // select by independent entity lane
            when (candidate) {
                // handle the fixed branch
                is AutomaticCheckinCandidateV1.Terminal -> {
                    // block only newer work for the same terminal
                    if (selectedTerminalIds.add(candidate.terminalId)) {
                        selected += candidate
                    }
                }
                is AutomaticCheckinCandidateV1.Vessel -> selected += candidate
            }
        }

        return selected
    }
}
