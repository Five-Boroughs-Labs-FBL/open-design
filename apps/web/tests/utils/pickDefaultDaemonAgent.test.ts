import { describe, expect, it } from "vitest";

import {
  pickDefaultDaemonAgent,
  resolveAcpStudioDaemonAgent,
} from "../../src/utils/pickDefaultDaemonAgent";

describe("pickDefaultDaemonAgent", () => {
  it("returns undefined when no agent is available", () => {
    expect(
      pickDefaultDaemonAgent([
        { id: "amr", available: false },
        { id: "claude", available: false, authStatus: "missing" },
      ]),
    ).toBeUndefined();
  });

  it("prefers an authenticated available agent over an unauthenticated one", () => {
    const picked = pickDefaultDaemonAgent([
      { id: "claude", available: true, authStatus: "missing" },
      { id: "codex", available: true, authStatus: "ok" },
      { id: "cursor-agent", available: true, authStatus: "ok" },
    ]);
    expect(picked?.id).toBe("codex");
  });

  it("falls back to the first available agent when none report auth ok", () => {
    const picked = pickDefaultDaemonAgent([
      { id: "amr", available: false },
      { id: "claude", available: true, authStatus: "missing" },
      { id: "opencode", available: true },
    ]);
    expect(picked?.id).toBe("claude");
  });
});

describe("resolveAcpStudioDaemonAgent", () => {
  const grokMissing = { id: "grok-build", available: true, authStatus: "missing" as const };
  const amrOk = { id: "amr", available: true, authStatus: "ok" as const };

  it("replaces unauthenticated Grok Build with an authenticated host agent", () => {
    expect(resolveAcpStudioDaemonAgent([grokMissing, amrOk], "grok-build")?.id).toBe("amr");
  });

  it("keeps an authenticated current agent", () => {
    expect(resolveAcpStudioDaemonAgent([
      { id: "grok-build", available: true, authStatus: "ok" },
      amrOk,
    ], "grok-build")?.id).toBe("grok-build");
  });

  it("fills an empty slot with the authenticated agent", () => {
    expect(resolveAcpStudioDaemonAgent([grokMissing, amrOk], null)?.id).toBe("amr");
  });
});
