---
name: explain-error
description: Explain an error message or stack trace and say what to do about it. Use when the user pastes an error or asks why something failed.
---

# Explaining an error

Answer three things, in this order, in plain language:

1. **What happened.** One sentence, no jargon the person did not use.
2. **Why.** Point at the line in the trace that belongs to their code, not
   the framework's. That is almost always where the cause is.
3. **What to do.** The most likely fix first, as a concrete change or
   command. If there are two plausible causes, say how to tell them apart.

Read the whole trace. The first line names the symptom; the useful frame is
usually several lines down.

If the error depends on something you cannot see (a file, a version, an
environment variable), say what you need to check, and check it if you can.
Do not guess a cause and present it as certain.
