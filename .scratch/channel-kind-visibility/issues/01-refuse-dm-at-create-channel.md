# 01 — Refuse a direct message at the create-channel mutation

**What to build:** The mutation that creates a **channel** stops accepting a
direct-message type. Today it will happily mint a `dm` row with no participants,
which is a conversation that can never resolve its own label and that the
deduplication path assumes cannot exist. Nothing in the product sends it — the
sidebar's direct-message path calls a different mutation — so closing this is
invisible to users and safe to ship on its own.

This is the first step of the schema work as well as the last guard on the
current form, so it is done once, here.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] The create-channel mutation's type argument admits only the two channel
      visibilities; a direct-message value is rejected by argument validation
      before the handler runs.
- [x] A test asserts the refusal, placed beside the existing per-workspace
      channel-limit tests for the same mutation.
- [x] Every existing channel-limit test still passes unchanged, including the
      two asserting that direct messages do not count toward the cap and that a
      capped workspace can still start one.
- [x] Every existing create-DM test still passes unchanged.

## Notes on completion

The test went to the direct-message lifecycle suite rather than beside the
channel-limit tests as this ticket suggested. That file is where the other "what
cannot be done to a direct message" invariants already live — cannot rename,
cannot add members, cannot DM yourself — and the limit suite is about counting.
The channel-limit suite was run and passes unchanged either way.

Precedent followed: the browse query was narrowed the same way earlier, and its
test in the DM-discovery suite is the idiom this one copies.
