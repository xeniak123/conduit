---
name: write-tests
description: Write or extend tests for existing code. Use when asked to add tests, cover a function, or reproduce a bug with a failing test.
---

# Writing tests

Find the project's test runner and one existing test file before writing a
line. Match its framework, its naming and its layout; a test in a style
nobody else uses is a test nobody maintains.

## What to test

The behaviour a caller relies on: inputs and the outputs or effects they
produce. Not private helpers, not the order of internal calls. A test that
breaks on a harmless refactor is a cost, not a safety net.

Cover, in this order:

1. The ordinary case that the function exists for.
2. Boundaries: empty, one, many; zero and negative; the largest valid input.
3. Invalid input, and that it fails the way the code promises.
4. The bug you were asked about, as a test that fails before the fix.

## How

- One behaviour per test, named for that behaviour.
- Arrange, act, assert. Keep setup visible in the test unless it is shared
  by many.
- Prefer real objects to mocks. Mock only what is slow, random, or outside
  the process.
- Run the test and watch it fail for the reason you expect before you make
  it pass. A test that has never failed has not been shown to test anything.

Finish by running the whole suite and reporting what passed and what did not.
