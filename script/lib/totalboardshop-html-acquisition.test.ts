import test from "node:test";
import assert from "node:assert/strict";
import { createTotalboardshopHtmlAcquirer } from "./totalboardshop-html-acquisition.ts";

type FakeResponse = {
  ok: boolean;
  status: number;
  url: string;
  headers: Record<string, string>;
  html: string;
  error?: Error;
  redirectChainUrls?: string[];
};

function createPlaywrightStub(steps: FakeResponse[]) {
  const pageCloseCalls: string[] = [];
  const gotoCalls: string[] = [];
  const waitUntilCalls: string[] = [];
  const timeoutCalls: number[] = [];
  let onCalls = 0;
  let offCalls = 0;
  let routeCalls = 0;
  let unrouteCalls = 0;
  let cursor = 0;

  const context = {
    async newPage() {
      const step = steps[cursor] ?? steps[steps.length - 1];
      return {
        on() { onCalls += 1; },
        off() { offCalls += 1; },
        async route() { routeCalls += 1; },
        async unroute() { unrouteCalls += 1; },
        async goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }) {
          gotoCalls.push(url);
          waitUntilCalls.push(options.waitUntil);
          timeoutCalls.push(options.timeout);
          if (!step) throw new Error("missing step");
          if (step.error) throw step.error;
          return {
            ok: () => step.ok,
            status: () => step.status,
            url: () => step.url,
            headers: () => step.headers,
            request: () => ({
              url: () => step.url,
              redirectedFrom: () => {
                const chain = step.redirectChainUrls ?? [];
                if (chain.length < 1) return null;
                let prev: { url(): string; redirectedFrom(): any } | null = null;
                for (const chainUrl of chain) {
                  const node = {
                    url: () => chainUrl,
                    redirectedFrom: () => prev,
                  };
                  prev = node;
                }
                return prev;
              },
            }),
          };
        },
        url() {
          return step.url;
        },
        async content() {
          return step.html;
        },
        async close() {
          pageCloseCalls.push(`page-${cursor}`);
          cursor += 1;
        },
      };
    },
    async close() {
      pageCloseCalls.push("context");
    },
  };

  const browser = {
    async newContext() {
      return context;
    },
    async close() {
      pageCloseCalls.push("browser");
    },
  };

  return {
    calls: { pageCloseCalls, gotoCalls, waitUntilCalls, timeoutCalls, onCalls: () => onCalls, offCalls: () => offCalls, routeCalls: () => routeCalls, unrouteCalls: () => unrouteCalls },
    playwrightModule: {
      chromium: {
        async launch() {
          return browser as any;
        },
      },
    },
  };
}

test("allowlist is enforced before navigation", async () => {
  const stub = createPlaywrightStub([]);
  const acquirer = await createTotalboardshopHtmlAcquirer({ timeoutMs: 1000, maxHtmlBytes: 1000, playwrightModule: stub.playwrightModule as any });
  await assert.rejects(() => acquirer.fetchHtml("https://example.com/blocked"), /Non-allowlisted host blocked/);
  await acquirer.close();
  assert.equal(stub.calls.gotoCalls.length, 0);
});

test("final URL allowlist is enforced after navigation", async () => {
  const stub = createPlaywrightStub([
    { ok: true, status: 200, url: "https://example.com/redirected", headers: { "content-type": "text/html" }, html: "<html></html>" },
  ]);
  const acquirer = await createTotalboardshopHtmlAcquirer({ timeoutMs: 1000, maxHtmlBytes: 1000, playwrightModule: stub.playwrightModule as any });
  await assert.rejects(() => acquirer.fetchHtml("https://totalboardshop.cz/start"), /Non-allowlisted host blocked/);
  await acquirer.close();
});

test("missing navigation response hard-fails", async () => {
  const stub = {
    playwrightModule: {
      chromium: {
        async launch() {
          return {
            async newContext() {
              return {
                async newPage() {
                  return {
                    on() {},
                    off() {},
                    async route() {},
                    async unroute() {},
                    async goto() {
                      return null;
                    },
                    url() {
                      return "https://totalboardshop.cz/x";
                    },
                    async content() {
                      return "";
                    },
                    async close() {},
                  };
                },
                async close() {},
              };
            },
            async close() {},
          } as any;
        },
      },
    },
  };
  const acquirer = await createTotalboardshopHtmlAcquirer({ timeoutMs: 1000, maxHtmlBytes: 1000, playwrightModule: stub.playwrightModule as any });
  await assert.rejects(() => acquirer.fetchHtml("https://totalboardshop.cz/start"), /Missing navigation response/);
  await acquirer.close();
});

test("non-ok response hard-fails", async () => {
  const stub = createPlaywrightStub([
    { ok: false, status: 503, url: "https://totalboardshop.cz/start", headers: { "content-type": "text/html" }, html: "<html></html>" },
  ]);
  const acquirer = await createTotalboardshopHtmlAcquirer({ timeoutMs: 1000, maxHtmlBytes: 1000, playwrightModule: stub.playwrightModule as any });
  await assert.rejects(() => acquirer.fetchHtml("https://totalboardshop.cz/start"), /HTTP 503/);
  await acquirer.close();
});

test("non-html content hard-fails", async () => {
  const stub = createPlaywrightStub([
    { ok: true, status: 200, url: "https://totalboardshop.cz/start", headers: { "content-type": "application/json" }, html: "{}" },
  ]);
  const acquirer = await createTotalboardshopHtmlAcquirer({ timeoutMs: 1000, maxHtmlBytes: 1000, playwrightModule: stub.playwrightModule as any });
  await assert.rejects(() => acquirer.fetchHtml("https://totalboardshop.cz/start"), /Unsupported content-type/);
  await acquirer.close();
});

test("content-length preflight overflow hard-fails", async () => {
  const stub = createPlaywrightStub([
    { ok: true, status: 200, url: "https://totalboardshop.cz/start", headers: { "content-type": "text/html", "content-length": "9000" }, html: "<html></html>" },
  ]);
  const acquirer = await createTotalboardshopHtmlAcquirer({ timeoutMs: 1000, maxHtmlBytes: 1000, playwrightModule: stub.playwrightModule as any });
  await assert.rejects(() => acquirer.fetchHtml("https://totalboardshop.cz/start"), /content-length/);
  await acquirer.close();
});

test("post-content overflow hard-fails", async () => {
  const stub = createPlaywrightStub([
    { ok: true, status: 200, url: "https://totalboardshop.cz/start", headers: { "content-type": "text/html" }, html: "x".repeat(5000) },
  ]);
  const acquirer = await createTotalboardshopHtmlAcquirer({ timeoutMs: 1000, maxHtmlBytes: 1000, playwrightModule: stub.playwrightModule as any });
  await assert.rejects(() => acquirer.fetchHtml("https://totalboardshop.cz/start"), /Payload too large/);
  await acquirer.close();
});

test("retry is used only for retriable errors", async () => {
  const retriableStub = createPlaywrightStub([
    { ok: true, status: 200, url: "https://totalboardshop.cz/start", headers: { "content-type": "text/html" }, html: "<html>ok</html>", error: new Error("Navigation timeout of 30000ms exceeded") },
    { ok: true, status: 200, url: "https://totalboardshop.cz/start", headers: { "content-type": "text/html" }, html: "<html>ok</html>" },
  ]);
  const acquirer = await createTotalboardshopHtmlAcquirer({ timeoutMs: 1234, maxHtmlBytes: 1000, maxRetries: 1, playwrightModule: retriableStub.playwrightModule as any });
  const result = await acquirer.fetchHtml("https://totalboardshop.cz/start");
  assert.equal(result.status, 200);
  assert.equal(retriableStub.calls.gotoCalls.length, 2);
  assert.deepEqual(retriableStub.calls.waitUntilCalls, ["domcontentloaded", "domcontentloaded"]);
  assert.deepEqual(retriableStub.calls.timeoutCalls, [1234, 1234]);
  assert.equal(retriableStub.calls.onCalls(), 4);
  assert.equal(retriableStub.calls.offCalls(), 4);
  assert.equal(retriableStub.calls.routeCalls(), 2);
  assert.equal(retriableStub.calls.unrouteCalls(), 2);
  await acquirer.close();

  const nonRetriableStub = createPlaywrightStub([
    { ok: true, status: 200, url: "https://totalboardshop.cz/start", headers: { "content-type": "text/html" }, html: "<html></html>", error: new Error("Protocol violation") },
    { ok: true, status: 200, url: "https://totalboardshop.cz/start", headers: { "content-type": "text/html" }, html: "<html></html>" },
  ]);
  const nonRetriable = await createTotalboardshopHtmlAcquirer({ timeoutMs: 1234, maxHtmlBytes: 1000, maxRetries: 2, playwrightModule: nonRetriableStub.playwrightModule as any });
  await assert.rejects(() => nonRetriable.fetchHtml("https://totalboardshop.cz/start"), /Protocol violation/);
  assert.equal(nonRetriableStub.calls.gotoCalls.length, 1);
  await nonRetriable.close();

  const blockedPolicyStub = createPlaywrightStub([
    { ok: true, status: 200, url: "https://totalboardshop.cz/start", headers: { "content-type": "text/html" }, html: "<html></html>", error: new Error("net::ERR_BLOCKED_BY_CLIENT") },
    { ok: true, status: 200, url: "https://totalboardshop.cz/start", headers: { "content-type": "text/html" }, html: "<html></html>" },
  ]);
  const blockedPolicy = await createTotalboardshopHtmlAcquirer({ timeoutMs: 1234, maxHtmlBytes: 1000, maxRetries: 2, playwrightModule: blockedPolicyStub.playwrightModule as any });
  await assert.rejects(() => blockedPolicy.fetchHtml("https://totalboardshop.cz/start"), /ERR_BLOCKED_BY_CLIENT/);
  assert.equal(blockedPolicyStub.calls.gotoCalls.length, 1);
  await blockedPolicy.close();
});

test("redirect chain is explicitly blocked fail-closed", async () => {
  const stub = createPlaywrightStub([
    {
      ok: true,
      status: 200,
      url: "https://totalboardshop.cz/start",
      headers: { "content-type": "text/html" },
      html: "<html></html>",
      redirectChainUrls: ["https://totalboardshop.cz/b", "https://totalboardshop.cz/a"],
    },
  ]);
  const acquirer = await createTotalboardshopHtmlAcquirer({ timeoutMs: 1000, maxHtmlBytes: 1000, playwrightModule: stub.playwrightModule as any });
  await assert.rejects(() => acquirer.fetchHtml("https://totalboardshop.cz/start"), /Redirect chain detected/);
  await acquirer.close();
});

test("valid main document passes while non-document subresource is aborted without retry", async () => {
  const listeners: Record<string, Array<(payload: any) => void>> = { request: [], response: [] };
  let routeHandler: ((route: { request(): any; continue(): Promise<void>; abort(reason: "blockedbyclient"): Promise<void> }) => Promise<void>) | null = null;
  const mainFrame = {};
  let gotoCalls = 0;
  let abortCalls = 0;
  let continueCalls = 0;
  const page = {
    on(event: "request" | "response", handler: (payload: any) => void) {
      listeners[event].push(handler);
    },
    off(event: "request" | "response", handler: (payload: any) => void) {
      listeners[event] = listeners[event].filter((item) => item !== handler);
    },
    async route(_pattern: string, handler: typeof routeHandler) {
      routeHandler = handler;
    },
    async unroute() {},
    async goto() {
      gotoCalls += 1;
      await routeHandler?.({
        request: () => ({
          url: () => "https://cdn.badhost.example/font.woff2",
          isNavigationRequest: () => false,
          resourceType: () => "font",
          frame: () => ({ not: "main-frame" }),
        }),
        async continue() {
          continueCalls += 1;
        },
        async abort() {
          abortCalls += 1;
        },
      });

      await routeHandler?.({
        request: () => ({
          url: () => "https://totalboardshop.cz/obchod/mikina-zle-classic/",
          isNavigationRequest: () => true,
          resourceType: () => "document",
          frame: () => mainFrame,
        }),
        async continue() {
          continueCalls += 1;
        },
        async abort() {
          abortCalls += 1;
        },
      });

      for (const handler of listeners.request) {
        handler({
          url: () => "https://cdn.badhost.example/font.woff2",
          isNavigationRequest: () => false,
          resourceType: () => "font",
          frame: () => ({ not: "main-frame" }),
        });
      }
      return {
        ok: () => true,
        status: () => 200,
        url: () => "https://totalboardshop.cz/obchod/mikina-zle-classic/",
        headers: () => ({ "content-type": "text/html" }),
        request: () => ({
          url: () => "https://totalboardshop.cz/obchod/mikina-zle-classic/",
          redirectedFrom: () => null,
          isNavigationRequest: () => true,
          resourceType: () => "document",
          frame: () => mainFrame,
        }),
      };
    },
    mainFrame() {
      return mainFrame;
    },
    url() {
      return "https://totalboardshop.cz/obchod/mikina-zle-classic/";
    },
    async content() {
      return "<html><body>ok</body></html>";
    },
    async close() {},
  };

  const acquirer = await createTotalboardshopHtmlAcquirer({
    timeoutMs: 1000,
    maxHtmlBytes: 1000,
    playwrightModule: {
      chromium: {
        async launch() {
          return {
            async newContext() {
              return {
                async newPage() {
                  return page as any;
                },
                async close() {},
              };
            },
            async close() {},
          } as any;
        },
      },
    },
  });

  const result = await acquirer.fetchHtml("https://totalboardshop.cz/obchod/mikina-zle-classic/");
  assert.equal(result.status, 200);
  assert.equal(gotoCalls, 1);
  assert.equal(abortCalls, 1);
  assert.equal(continueCalls, 1);
  await acquirer.close();
});
