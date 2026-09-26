# IBM-hackathon
**PR Review & Risk Triage Assistant**
When someone submits a code change (a "pull request"), your tool automatically reads it and flags problems — like "this might be a security risk," "you forgot to add a test," or "this doesn't match what the ticket asked for." It's like an automatic first-pass reviewer that catches issues before a human even looks at it.
**AI Test-Coverage Generator**
It scans a codebase, finds the parts that have no tests protecting them, and automatically writes those tests. Then it runs them to make sure they actually work. The result: "before, 60% of the code was tested — now it's 90%."
**Combined suite**-what we are building...:
Instead of picking just one, you build one tool that does both #1 and #3 — reviews PRs and generates missing tests. More impressive scope, and since both features need similar underlying tech, it's not much more work with 6 people.
**AI Test-Coverage Generator**-in simple terms :
The problem: Most codebases have gaps — code nobody wrote tests for. If that code breaks later, nothing catches it.

What the tool does, step by step:

Finds the gaps — it checks which parts of the code have no tests (like a checklist of "tested" vs "untested" functions).
Reads the code — for each untested function, it looks at what the function actually does, so it understands what "correct behavior" looks like.
Writes the tests — it generates test cases: normal use, edge cases (empty input, weird values), and error cases.
Checks its own work — this is the key part. It actually runs the tests it wrote. If a test is broken or doesn't really test anything meaningful, it rewrites it. So you're not getting random AI-generated tests you have to trust blindly — you're getting tests that are proven to work.
Reports the improvement — it shows a before/after number, like "60% of the code was covered, now it's 90%," plus a list of what kinds of bugs it protected against.

Why it matters: Writing tests is tedious and often skipped under deadline pressure. This tool does that boring-but-important work automatically, and — because it validates its own tests — you can actually trust the output instead of double-checking everything yourself.
**PR Review & Risk Triage Assistant**---in simple terms:
The problem: When developers submit code changes for review, a human has to read through everything to catch issues — which is slow, and tired reviewers miss things.

What the tool does, step by step:

Reads the change — it looks at exactly what code was added, removed, or modified in the pull request (the "diff").
Checks against the ticket/task — if there's a linked ticket describing what was supposed to be built, it compares the code against that description to see if anything's missing or off-track.
Scans for risk patterns — things like:
Security issues (hardcoded passwords, unsafe database queries, missing input validation)
Missing tests for the new code
Overly complex or risky changes (touching critical files, huge diffs, no error handling)
Flags it in plain language — instead of a wall of code, it gives a short list like: "⚠️ No tests added for this new function," "⚠️ This looks like it could allow SQL injection," "⚠️ Ticket asked for X, this PR only does Y."
Prioritizes what matters — not every flag is equal, so it ranks issues by severity (security bug > missing test > minor style nit), so the human reviewer knows what to look at first.

Why it matters: It's like a spellchecker, but for code risk — it does the tedious first pass automatically, so the human reviewer spends their time on judgment calls instead of hunting for obvious problems. That makes reviews faster and catches things people are prone to miss when they're rushed.

Together with the Test-Coverage Generator: one catches risk in new code before it merges, the other fills gaps in old code that's already in the codebase — so together they pitch as "a copilot that watches code quality continuously," which is a strong hackathon story.
