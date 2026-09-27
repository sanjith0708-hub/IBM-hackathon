# IBM-hackathon
**PR Review & Risk Triage Assistant**
When someone submits a code change (a "pull request"), your tool automatically reads it and flags problems — like "this might be a security risk," "you forgot to add a test," or "this doesn't match what the ticket asked for." It's like an automatic first-pass reviewer that catches issues before a human even looks at it.

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

