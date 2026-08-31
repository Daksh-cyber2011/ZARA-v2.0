/**
 * ZARA V2.1 — Approval memory tests.
 *
 * §8-9 natural action UX: the SAME high-risk action approved moments ago
 * shouldn't re-confirm — but different arguments, expiry, or a disabled
 * policy always re-ask. Android permissions are OUT OF SCOPE by design.
 */
import { describe, it, expect } from "vitest";
import { ApprovalPolicy, approvalKey } from "../src/agent/confirmation/ApprovalPolicy";

const NOW = 1_700_000_000_000;

describe("approvalKey", () => {
  it("keys by tool + primary argument", () => {
    expect(approvalKey("send_message", { contact: "Rahul" })).toBe("send_message::rahul");
  });

  it("ignores case/whitespace noise", () => {
    expect(approvalKey("send_message", { contact: "  RAHUL " })).toBe(approvalKey("send_message", { contact: "rahul" }));
  });

  it("different contacts are different keys", () => {
    expect(approvalKey("send_message", { contact: "Rahul" })).not.toBe(approvalKey("send_message", { contact: "Priya" }));
  });

  it("falls back through contact → app → query → url → message", () => {
    expect(approvalKey("open_app", { app: "Instagram" })).toBe("open_app::instagram");
    expect(approvalKey("web_search", { query: "cats" })).toBe("web_search::cats");
  });
});

describe("ApprovalPolicy", () => {
  it("is DISABLED by default — never remembers anything", () => {
    const p = new ApprovalPolicy();
    p.recordApproval("send_message", { contact: "Rahul" }, NOW);
    expect(p.isRecentlyApproved("send_message", { contact: "Rahul" }, NOW)).toBe(false);
  });

  it("remembers an identical action within the TTL when enabled", () => {
    const p = new ApprovalPolicy({ enabled: () => true });
    p.recordApproval("send_message", { contact: "Rahul" }, NOW);
    expect(p.isRecentlyApproved("send_message", { contact: "rahul" }, NOW + 60_000)).toBe(true);
  });

  it("forgets after the TTL expires", () => {
    const p = new ApprovalPolicy({ ttlMs: 60_000, enabled: () => true });
    p.recordApproval("send_message", { contact: "Rahul" }, NOW);
    expect(p.isRecentlyApproved("send_message", { contact: "Rahul" }, NOW + 61_000)).toBe(false);
  });

  it("a different argument still asks (Rahul ≠ Priya)", () => {
    const p = new ApprovalPolicy({ enabled: () => true });
    p.recordApproval("send_message", { contact: "Rahul" }, NOW);
    expect(p.isRecentlyApproved("send_message", { contact: "Priya" }, NOW)).toBe(false);
  });

  it("a different tool still asks", () => {
    const p = new ApprovalPolicy({ enabled: () => true });
    p.recordApproval("call_contact", { contact: "Rahul" }, NOW);
    expect(p.isRecentlyApproved("send_message", { contact: "Rahul" }, NOW)).toBe(false);
  });

  it("respects the master switch flipping OFF mid-session", () => {
    let on = true;
    const p = new ApprovalPolicy({ enabled: () => on });
    p.recordApproval("send_message", { contact: "Rahul" }, NOW);
    on = false;
    expect(p.isRecentlyApproved("send_message", { contact: "Rahul" }, NOW)).toBe(false);
  });

  it("clear() wipes session memory", () => {
    const p = new ApprovalPolicy({ enabled: () => true });
    p.recordApproval("send_message", { contact: "Rahul" }, NOW);
    p.clear();
    expect(p.isRecentlyApproved("send_message", { contact: "Rahul" }, NOW)).toBe(false);
  });
});
