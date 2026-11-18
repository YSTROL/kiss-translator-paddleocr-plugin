const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../recognize-text.js"), "utf8");
const { permissions } = require("../manifest.json");
const jobs = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
const storage = "https://paddleocr-store-7.bj.bcebos.com";
const image = { assetId: "asset-1", mimeType: "image/png" };
const polygon = [[0, 0], [40, 0], [40, 10], [0, 10]];

function recognize({ resultUrl = storage + "/page?signature=test", config = {}, onRequest, globals = {} } = {}) {
  // Use only the SDK for network access. This context has no browser URL or timers.
  const plugin = {};
  vm.runInNewContext(source, { exports: plugin, ...globals });
  const calls = [];
  const secret = { key: "apiKey" };
  const origins = new Set(permissions.network);
  if (config.resultOrigin) origins.add(new URL(config.resultOrigin).origin);
  async function request(req) {
    const { origin } = new URL(req.url);
    if (!origins.has(origin)) {
      throw Object.assign(new Error("Origin outside declared network scope: " + origin), { code: "NETWORK_DENIED" });
    }
    calls.push(req);
    const reply = onRequest?.(req);
    if (reply) return reply;
    if (req.url === jobs) return { body: JSON.stringify({ data: { jobId: "demo" } }) };
    if (req.url === jobs + "/demo") {
      return { body: JSON.stringify({ data: { state: "done", resultUrl: { jsonUrl: resultUrl } } }) };
    }
    const page = { prunedResult: { rec_texts: ["示例"], rec_polys: [polygon] } };
    return { body: JSON.stringify({ result: { ocrResults: [page] } }) };
  }
  const ctx = { http: { request }, secrets: { ref: key => { assert.equal(key, "apiKey"); return secret; } } };
  return { calls, secret, result: plugin.recognizeText({ image }, config, ctx) };
}

test("download a signed result without a global URL, keeping the token on the jobs API", async () => {
  const { result, calls, secret } = recognize();
  assert.equal((await result).text, "示例");
  assert.deepEqual(calls.map(req => req.method), ["POST", "GET", "GET"]);
  assert.equal(calls[0].auth.secret, secret);
  assert.equal(calls[1].auth.secret, secret);
  assert.equal(calls[2].auth, undefined);
  assert.equal(calls[2].url, storage + "/page?signature=test");
});

test("a new result domain needs approval and the message omits the signed path", async () => {
  const origin = "https://new-storage.example";
  const resultUrl = origin + "/private-page?signature=test";
  const { result, calls } = recognize({ resultUrl });
  await assert.rejects(result, error => {
    assert.equal(error.code, "RESULT_ORIGIN_REQUIRED");
    assert.ok(error.message.includes(origin));
    assert.doesNotMatch(error.message, /private-page|signature/);
    return true;
  });
  assert.equal(calls.length, 2);
  const configured = recognize({ resultUrl, config: { resultOrigin: origin } });
  assert.equal((await configured.result).text, "示例");
  assert.equal(configured.calls[2].auth, undefined);
});

test("reject incomplete links, HTTP and embedded credentials before download", async () => {
  for (const resultUrl of [null, "https://", "http://example.test/file", "https://user@example.test/file"]) {
    const { result, calls } = recognize({ resultUrl });
    await assert.rejects(result, /有效的 HTTPS/);
    assert.equal(calls.length, 2);
  }
});

test("403 and 429 distinguish the request stage and give the appropriate next step", async () => {
  for (const [status, url, hint] of [
    [403, jobs, /提交 OCR 任务.*禁用Origin名单/],
    [429, jobs + "/demo", /查询 OCR 任务.*配额/],
    [403, storage + "/page?signature=test", /下载识别结果.*新的结果链接/]
  ]) {
    const { result } = recognize({ onRequest(req) {
      if (req.url === url) throw Object.assign(new Error("Provider returned HTTP " + status), { code: "HTTP_ERROR" });
    } });
    await assert.rejects(result, error => {
      assert.equal(error.code, "HTTP_ERROR");
      assert.match(error.message, hint);
      assert.doesNotMatch(error.message, /signature/);
      return true;
    });
  }
});

test("stop polling after 45 seconds without resubmitting the image", async () => {
  let now = 0;
  const { result, calls } = recognize({
    globals: {
      Date: { now: () => now },
      setTimeout(resolve, ms) { now += ms; resolve(); }
    },
    onRequest(req) {
      if (req.method === "GET") return { body: JSON.stringify({ data: { state: "pending" } }) };
    }
  });
  await assert.rejects(result, /结果超时/);
  assert.equal(now, 45000);
  assert.equal(calls.filter(req => req.method === "POST").length, 1);
  assert.ok(calls.slice(1).every(req => req.url === jobs + "/demo"));
});

test("a truncated JSONL record rejects the entire result", async () => {
  const first = { result: { ocrResults: [{ prunedResult: { rec_texts: ["first"], rec_polys: [polygon] } }] } };
  const { result } = recognize({ onRequest(req) {
    if (req.url.startsWith(storage + "/")) return { body: JSON.stringify(first) + "\n{" };
  } });
  await assert.rejects(result, /无法解析为 JSON/);
});
