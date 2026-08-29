import { describe, it, expect } from "vitest";
import { LLMError, classifyTransportError, withTimeoutRetry, createCancellationToken } from "../src/cognition/provider/types";

describe("Provider error taxonomy (§36, §47)", () => {
  it("classifies aborts as timeouts", () => {
    const e = classifyTransportError(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
    expect(e.code).toBe("LLM_TIMEOUT");
  });

  it("classifies auth failures", () => {
    expect(classifyTransportError(Object.assign(new Error("API key not valid"), {})).code).toBe("LLM_AUTH_ERROR");
    expect(classifyTransportError(Object.assign(new Error("x"), { status: 401 })).code).toBe("LLM_AUTH_ERROR");
  });

  it("classifies rate limits as retryable", () => {
    const e = classifyTransportError(Object.assign(new Error("quota exceeded"), {}));
    expect(e.code).toBe("LLM_RATE_LIMIT");
    expect(e.retryable).toBe(true);
  });

  it("classifies network errors as retryable", () => {
    const e = classifyTransportError(new Error("Failed to fetch"));
    expect(e.code).toBe("NETWORK_ERROR");
    expect(e.retryable).toBe(true);
  });

  it("non-retryable LLMErrors pass through unchanged", () => {
    const orig = new LLMError("LLM_NOT_CONFIGURED", "no key");
    expect(classifyTransportError(orig)).toBe(orig);
  });
});

describe("withTimeoutRetry", () => {
  it("retries retryable failures then succeeds", async () => {
    let calls = 0;
    const result = await withTimeoutRetry(async () => {
      calls++;
      if (calls < 3) throw new LLMError("NETWORK_ERROR", "flaky", true);
      return "ok";
    }, { timeoutMs: 2000, retries: 3 });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does NOT retry non-retryable errors", async () => {
    let calls = 0;
    await expect(withTimeoutRetry(async () => {
      calls++;
      throw new LLMError("LLM_AUTH_ERROR", "bad key");
    }, { timeoutMs: 2000, retries: 3 })).rejects.toMatchObject({ code: "LLM_AUTH_ERROR" });
    expect(calls).toBe(1);
  });

  it("honors cancellation before start", async () => {
    const token = createCancellationToken();
    token.cancel();
    await expect(withTimeoutRetry(async () => "never", { timeoutMs: 1000, retries: 1, token }))
      .rejects.toMatchObject({ code: "LLM_CANCELLED" });
  });

  it("honors cancellation mid-flight", async () => {
    const token = createCancellationToken();
    const p = withTimeoutRetry(
      () => new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => resolve("late"), 300);
        token.onCancel(() => { clearTimeout(t); reject(new LLMError("LLM_CANCELLED", "cancelled")); });
      }),
      { timeoutMs: 5000, retries: 0, token }
    );
    setTimeout(() => token.cancel(), 30);
    await expect(p).rejects.toMatchObject({ code: "LLM_CANCELLED" });
  });

  it("times out stuck operations", async () => {
    await expect(withTimeoutRetry(
      (signal) => new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
      { timeoutMs: 40, retries: 0 }
    )).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
  });
});

describe("CancellationToken", () => {
  it("runs cancel cleanups exactly once", () => {
    const t = createCancellationToken();
    let ran = 0;
    t.onCancel(() => ran++);
    t.cancel();
    t.cancel(); // idempotent
    expect(ran).toBe(1);
  });
});
