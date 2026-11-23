/**
 * 工作区交接：把项目根 / worktree / 终端目录交给机器人。
 *
 * 不变量（对应 docs/arch/ARCH-bot-workspace.md）：
 * 1. 交接是一条长期关系（bot_workspaces），pty 退出不影响它；
 * 2. 同一个 (bot, path) 重复交只更新，不新增行；
 * 3. 项目根交出去 = 绑 bots.project_id（卡片上的「X 接手」才不是装饰），交回时解绑；
 * 4. 工作区要进 system prompt，并且有 workspace=<id>，工具才引用得到；
 * 5. 删机器人时连它手上的工作区一起清。
 */

import assert from "node:assert/strict";
import { NOON, test } from "./_harness.mjs";
import { compileContext, createBots } from "../../electron/bot/index.mjs";

const botRecord = (id, name) => ({
  id, name, avatar: "B", avatarClass: "a", role: "worker", capability: "work",
  persona: { mission: `${name} 的职责` }, channels: ["local"], policy: {}, budget: {},
  status: "active", mutedUntil: 0, executorAgentId: null, skills: [],
  projectId: null, hostId: null, team: "", plan: null, createdAt: NOON, updatedAt: NOON,
});

const makeBots = (state) => {
  const store = {
    state, persist() {},
    addMessage(threadId, runId, role, kind, content) {
      state.messages = state.messages || [];
      state.messages.push({ id: `m${state.messages.length + 1}`, threadId, runId, role, kind, content, createdAt: NOON });
    },
  };
  const bots = createBots({ store, now: () => NOON, memory: () => ({ inject: () => ({ items: [] }) }), key: () => "k" });
  return { store, bots };
};

await test("交接：重复交同一个目录不新增，项目根绑 project_id", () => {
  const state = {
    bots: [botRecord("bot-a", "A")], botTurns: [], threads: [], messages: [], botRevisions: [], botWorkspaces: [],
    projects: [{ id: "p1", name: "demo", path: "/tmp/demo" }],
  };
  const { bots } = makeBots(state);
  const first = bots.handOff({ botId: "bot-a", projectId: "p1", path: "/tmp/demo", title: "demo", kind: "project", projectRoot: true, goal: "先看 CI" });
  assert.equal(state.botWorkspaces.length, 1);
  assert.equal(first.workspace.kind, "project");
  assert.equal(state.bots[0].projectId, "p1", "项目根交出去要绑默认项目");
  const again = bots.handOff({ botId: "bot-a", projectId: "p1", path: "/tmp/demo", title: "demo 改名", goal: "改成跑测试" });
  assert.equal(state.botWorkspaces.length, 1, "同一个 (bot, path) 重复交不新增行");
  assert.equal(again.workspace.title, "demo 改名");
  assert.equal(again.workspace.goal, "改成跑测试");
  const noGoal = bots.handOff({ botId: "bot-a", projectId: "p1", path: "/tmp/demo" });
  assert.equal(noGoal.workspace.goal, "改成跑测试", "没带目标时沿用上一次，不擦掉");
  assert.equal(noGoal.goalChanged, false, "目标没变就不该自动再开一轮");
  assert.ok(state.botTurns.some((t) => t.decision === "watching" && t.trigger?.kind === "handoff"), "交接要落一条可审计回合");
  assert.ok((state.messages || []).some((m) => m.role === "system" && /交接/.test(m.content)), "会话里要能看见交接这一行");
});

await test("工作区进 system prompt：带 id，工具能引用", () => {
  const state = {
    bots: [botRecord("bot-a", "A")], botTurns: [], threads: [], messages: [], botRevisions: [],
    botWorkspaces: [{ id: "ws-1", botId: "bot-a", path: "/tmp/demo", title: "demo", branch: "feat/x", kind: "worktree", status: "open", createdAt: NOON }],
    projects: [], delegations: [],
  };
  const { bots } = makeBots(state);
  const c = compileContext(state.bots[0], "记忆", { workspaces: bots.workspaces("bot-a") });
  assert.match(c.system, /workspace=ws-1/);
  assert.match(c.system, /feat\/x/);
  assert.ok(c.sectionChars.workspaces > 0);
});

await test("交回：状态 released，项目根解绑；删机器人连工作区一起清", () => {
  const state = {
    bots: [botRecord("bot-a", "A"), botRecord("bot-b", "B")],
    botTurns: [], threads: [], messages: [], botRevisions: [], botWorkspaces: [
      { id: "ws-a", botId: "bot-a", projectId: "p1", path: "/tmp/demo", title: "demo", kind: "project", branch: "", terminalId: null, goal: "", status: "open", createdAt: NOON, updatedAt: NOON },
      { id: "ws-b", botId: "bot-b", projectId: "p1", path: "/tmp/demo", title: "demo", kind: "worktree", branch: "", terminalId: null, goal: "", status: "open", createdAt: NOON, updatedAt: NOON },
    ],
    projects: [{ id: "p1", name: "demo", path: "/tmp/demo" }],
  };
  state.bots[0].projectId = "p1";
  const { bots } = makeBots(state);
  bots.releaseWorkspace({ id: "ws-a" });
  assert.equal(state.botWorkspaces.find((w) => w.id === "ws-a")?.status, "released");
  assert.equal(state.bots[0].projectId, null, "交回项目根要解绑默认项目");
  assert.deepEqual(bots.workspaces("bot-a"), [], "交回后不再出现在它的观察面");
  bots.remove("bot-b");
  assert.equal(state.botWorkspaces.some((w) => w.botId === "bot-b"), false, "删机器人要带走它的工作区");
  bots.undoRemove();
  assert.ok(state.botWorkspaces.some((w) => w.botId === "bot-b"), "撤销删除要把工作区一起放回去");
});
