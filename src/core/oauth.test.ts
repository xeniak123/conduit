import { describe, expect, it } from "vitest";
import { challengeFor } from "./oauth";

describe("the PKCE challenge", () => {
  it("matches the worked example in RFC 7636", async () => {
    // If this ever drifts, every sign-in fails at the exchange with a message
    // nobody can act on — so it is pinned to the specification's own vector.
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("is base64url, with no padding to be mangled in a URL", async () => {
    const challenge = await challengeFor("a-verifier-that-pads");
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
