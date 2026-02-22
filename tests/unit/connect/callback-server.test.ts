import { describe, it, expect, afterEach } from "vitest";
import { waitForCallback } from "../../../src/connect/callback-server.js";

// Use a different port for each test to avoid EADDRINUSE between tests
let portCounter = 14000;
function nextPort(): number {
  return portCounter++;
}

/**
 * Helper: eagerly attach a .catch() to suppress Node's unhandled-rejection
 * warning, then return a function that awaits + asserts the rejection.
 */
function captureRejection(promise: Promise<unknown>) {
  let caught: Error | undefined;
  const handled = promise.catch((err) => {
    caught = err instanceof Error ? err : new Error(String(err));
  });
  return {
    /** Wait for the promise to settle, then assert it threw with `pattern`. */
    async expectThrow(pattern: string | RegExp) {
      await handled;
      expect(caught).toBeDefined();
      expect(caught!.message).toMatch(pattern);
    },
  };
}

describe("CallbackServer", () => {
  afterEach(() => {
    // noop — each test cleans up its own server
  });

  it("resolves with code on successful callback", async () => {
    const port = nextPort();
    const state = "test-state-123";

    const promise = waitForCallback({ port, state, timeoutMs: 5000 });

    // Simulate the bank redirecting back with a code
    await new Promise((r) => setTimeout(r, 50)); // let server start
    const res = await fetch(
      `http://127.0.0.1:${port}/callback?code=AUTH_CODE_XYZ&state=${state}`,
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Authorization successful");

    const result = await promise;
    expect(result.code).toBe("AUTH_CODE_XYZ");
  });

  it("rejects on state mismatch (CSRF)", async () => {
    const port = nextPort();
    const state = "correct-state";

    const rejection = captureRejection(
      waitForCallback({ port, state, timeoutMs: 5000 }),
    );

    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(
      `http://127.0.0.1:${port}/callback?code=CODE&state=wrong-state`,
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("State mismatch");

    await rejection.expectThrow("CSRF");
  });

  it("rejects when code parameter is missing", async () => {
    const port = nextPort();
    const state = "some-state";

    const rejection = captureRejection(
      waitForCallback({ port, state, timeoutMs: 5000 }),
    );

    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(
      `http://127.0.0.1:${port}/callback?state=${state}`,
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("No authorization code");

    await rejection.expectThrow("No authorization code");
  });

  it("rejects when bank returns error", async () => {
    const port = nextPort();
    const state = "state-abc";

    const rejection = captureRejection(
      waitForCallback({ port, state, timeoutMs: 5000 }),
    );

    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(
      `http://127.0.0.1:${port}/callback?error=access_denied&error_description=User+cancelled`,
    );

    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Authorization failed");

    await rejection.expectThrow("Bank authorization failed");
  });

  it("rejects on timeout", async () => {
    const port = nextPort();

    const rejection = captureRejection(
      waitForCallback({
        port,
        state: "state-timeout",
        timeoutMs: 100, // Very short timeout for test
      }),
    );

    await rejection.expectThrow("timed out");
  });

  it("rejects on port already in use (EADDRINUSE)", async () => {
    const port = nextPort();
    const state = "state-1";

    // Start first server
    const first = waitForCallback({ port, state, timeoutMs: 5000 });

    await new Promise((r) => setTimeout(r, 50)); // let it bind

    // Try to start second server on same port
    const rejection = captureRejection(
      waitForCallback({ port, state: "state-2", timeoutMs: 5000 }),
    );

    await rejection.expectThrow("already in use");

    // Clean up first server by sending a valid callback
    await fetch(`http://127.0.0.1:${port}/callback?code=cleanup&state=${state}`);
    await first;
  });

  it("returns 404 for non-callback paths", async () => {
    const port = nextPort();
    const state = "state-404";

    const promise = waitForCallback({ port, state, timeoutMs: 5000 });

    await new Promise((r) => setTimeout(r, 50));
    const res = await fetch(`http://127.0.0.1:${port}/other-path`);
    expect(res.status).toBe(404);

    // Clean up
    await fetch(`http://127.0.0.1:${port}/callback?code=done&state=${state}`);
    await promise;
  });
});
