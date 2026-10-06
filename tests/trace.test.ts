import { describe, expect, it } from "vitest";
import { decodeSse, encodeSse, STEPS, stepNumber, type TraceEvent } from "@/lib/agent/trace";

describe("trace contract", () => {
  it("numbers steps in a fixed order", () => {
    expect(STEPS.map((s) => s.key)).toEqual(["fetch_dispute", "gather_order", "gather_tracking", "gather_logs", "assess", "draft", "validate", "package", "await_approval"]);
    expect(stepNumber("assess")).toBe(5);
  });

  it("round-trips events through SSE framing", () => {
    const events: TraceEvent[] = [
      { v: 1, type: "run_started", runId: "r1", disputeId: "PP-R-1", mode: "replay", at: "2026-10-06T12:00:00Z" },
      {
        v: 1,
        type: "step",
        runId: "r1",
        step: 1,
        key: "fetch_dispute",
        title: "Read the dispute from PayPal",
        status: "done",
        paypal: [{ method: "GET", endpoint: "/v1/customer/disputes/{id}", api: "Disputes", status: 200, ms: 512 }],
        ms: 530,
        at: "2026-10-06T12:00:01Z",
      },
    ];
    const wire = events.map((e, i) => encodeSse(e, i)).join("");
    expect(wire).toContain("event: step\nid: r1:1\ndata: ");
    expect(decodeSse(wire)).toEqual(events);
  });
});
