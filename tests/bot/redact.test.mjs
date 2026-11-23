/**
 * 密钥封口（P0-2）的不变量：
 *
 * 1. `containsSecretLike` 是单一判定：形态明确的密钥才算，不吃裸 commit sha；
 * 2. `redactDeep` 覆盖模型可控的任意 JSON（工具入参 / 工具结果），命中一律 `[redacted]`；
 * 3. `linkCarriesCredential` 认得 `?access_token=` / `#id_token=` 这类链接，写 `bot_events` 前直接拒收；
 * 4. 工具循环落库的 `bot_turns.trace` 里命中数为 0。
 */
import assert from "node:assert/strict";
import { NOON, makeBot, test } from "./_harness.mjs";
import { containsSecretLike, linkCarriesCredential, redactDeep, redactSecrets, safeLink } from "../../electron/redact.mjs";
import { webhookEvent } from "../../electron/bot/webhook.mjs";
import { eventRowsFromGh } from "../../electron/bot/github.mjs";
import { redactToolArgs, redactToolResult } from "../../electron/bot/tools.mjs";
import { createBots } from "../../electron/bot/index.mjs";

// 形态真实、字面量拆开写：`verify:privacy` 不该因为这个用例报警
const SK = ["sk", "abcdefghijklmnopqrstuvwx"].join("-");
const GH = ["ghp", "abcdefghijklmnopqrstuvwx"].join("_");
const BEARER = "Authorization: Bearer abcdefghijklmnop.qrstuv";

await test("containsSecretLike：明确形态命中，路径 / commit sha 不误伤", () => {
  assert.equal(containsSecretLike(SK), true);
  assert.equal(containsSecretLike(BEARER), true);
  assert.equal(containsSecretLike("api_key=abcdefgh12345"), true);
  assert.equal(containsSecretLike(GH), true);
  assert.equal(containsSecretLike("src/components/Bot.tsx"), false);
  assert.equal(containsSecretLike("8f547e3da"), false);
  assert.equal(containsSecretLike("9f8c7e5b3a1d2c4e6f8a0b2c4d6e8f0a1b3c5d7e"), false, "40 位 sha 不是密钥");
  assert.equal(containsSecretLike(""), false);
});

await test("redactDeep：深层对象 / 数组都涂掉，不保留长度", () => {
  const input = {
    headers: { authorization: `Bearer ${"a".repeat(20)}` },
    rows: [{ file: "src/a.ts", text: `OPENAI_KEY=${SK}` }],
    note: "正常的说明文字",
    count: 3,
    nested: { deep: { value: SK } },
  };
  const { value, hits } = redactDeep(input);
  assert.ok(hits >= 3, `应当命中至少 3 处，实际 ${hits}`);
  const text = JSON.stringify(value);
  assert.equal(text.includes(SK), false);
  assert.equal(text.includes("a".repeat(20)), false, "Bearer 的值也要涂掉");
  assert.equal(value.count, 3, "非字符串不受影响");
  // commit sha 不是密钥：工具结果里的 40 位十六进制必须留着，否则 git_log 不可读
  assert.equal(redactDeep({ sha: "9f8c7e5b3a1d2c4e6f8a0b2c4d6e8f0a1b3c5d7e" }).value.sha, "9f8c7e5b3a1d2c4e6f8a0b2c4d6e8f0a1b3c5d7e");
  assert.equal(redactDeep({ sha: "9f8c7e5b3a1d2c4e6f8a0b2c4d6e8f0a1b3c5d7e" }).hits, 0);
  assert.equal(value.rows[0].file, "src/a.ts", "路径不误伤");
  assert.match(value.note, /正常的说明/);
});

await test("redactDeep：深度与数组封顶，不会因为大结果卡住", () => {
  let deep = { leaf: SK };
  for (let i = 0; i < 20; i += 1) deep = { next: deep };
  const { value } = redactDeep(deep);
  assert.equal(JSON.stringify(value).includes(SK), false);
  const big = redactDeep({ rows: Array.from({ length: 500 }, () => ({ v: "x" })) });
  assert.equal(big.value.rows.length, 200);
});

await test("linkCarriesCredential：?access_token= / #id_token= 命中，普通链接不误伤", () => {
  assert.equal(linkCarriesCredential("https://x.dev/callback?access_token=abc123"), true);
  assert.equal(linkCarriesCredential("https://x.dev/a?page=2&api_key=zzz"), true);
  assert.equal(linkCarriesCredential("https://x.dev/a#id_token=zz"), true);
  assert.equal(linkCarriesCredential(`https://x.dev/a?q=${SK}`), true);
  assert.equal(linkCarriesCredential("https://github.com/o/r/pull/12"), false);
  assert.equal(linkCarriesCredential("https://x.dev/a?page=2&sort=asc"), false);
  assert.equal(linkCarriesCredential(""), false);
  assert.equal(safeLink("https://x.dev/?token=1"), "");
  assert.equal(safeLink("https://x.dev/a"), "https://x.dev/a");
});

await test("bot_events：webhook 的凭据链接拒收，标题里的密钥涂掉", () => {
  const ev = webhookEvent({ botId: "b1", payload: { title: "部署完成", text: `token=${SK}`, url: "https://x.dev/hook?access_token=abc" }, now: NOON });
  assert.equal(ev.url, "", "凭据形状的链接不入库");
  assert.equal(JSON.stringify(ev).includes(SK), false);
  assert.match(ev.title, /\[redacted\]/);
  const ok = webhookEvent({ botId: "b1", payload: { url: "https://x.dev/build/12" }, now: NOON });
  assert.equal(ok.url, "https://x.dev/build/12");
});

await test("bot_events：github 事件的凭据链接也拒收", () => {
  const rows = eventRowsFromGh({
    botId: "b1",
    prs: [{ number: 7, title: "修 CI", url: "https://github.com/o/r/pull/7" }],
    runs: [{ databaseId: 9, workflowName: "ci", url: "https://github.com/o/r/actions?access_token=abc" }],
    now: NOON,
  });
  assert.equal(rows.find((r) => r.key === "pr:7").url, "https://github.com/o/r/pull/7");
  assert.equal(rows.find((r) => r.key === "ci:9").url, "");
});

await test("工具出口：入参与结果各封一次，命中计数可查", () => {
  const args = redactToolArgs({ query: BEARER, path: "src/a.ts" });
  assert.equal(args.hits, 1);
  assert.equal(JSON.stringify(args.args).includes("abcdefghijklmnop"), false);
  const out = redactToolResult({ rows: [{ text: `KEY=${SK}` }] });
  assert.equal(out.hits, 1);
  assert.equal(JSON.stringify(out.result).includes(SK), false);
});

await test("工具循环：bot_turns.trace 里命中数为 0（入参与结果都不留明文）", async () => {
  const store = { state: { bots: [], botTurns: [] }, persist() {} };
  let round = 0;
  const seen = [];
  const b = createBots({
    store, now: () => NOON,
    memory: () => ({ inject: () => ({ items: [] }) }),
    key: () => "k",
    runTool: async (name, args) => {
      seen.push(args);
      return { rows: [{ path: "config/app.env", text: `OPENAI_API_KEY=${SK}` }] };
    },
    chatStream: async () => {
      round += 1;
      if (round === 1) {
        return { text: "", toolCalls: [{ id: "c1", name: "workspace_grep", args: JSON.stringify({ query: `Authorization: Bearer ${"b".repeat(20)}` }) }] };
      }
      return { text: "查完了。", toolCalls: [] };
    },
  });
  b.ensureSeed();
  const turn = await b.reply(makeBot(b, { id: "bsec", capability: "read" }), "查一下配置");
  assert.equal(seen.length, 1);
  assert.match(seen[0].query, /\[redacted\]/, "执行前就把 key 涂掉");
  assert.equal(turn.decision, "replied");
  const traceText = JSON.stringify(turn.tools || []);
  assert.equal(traceText.includes(SK), false);
  assert.equal(traceText.includes("b".repeat(20)), false);
  const stored = JSON.stringify(store.state.botTurns.at(-1).trace || []);
  assert.equal(stored.includes(SK), false);
  assert.equal(redactSecrets(stored).hits, 0, "落库的 trace 里 0 命中");
});
