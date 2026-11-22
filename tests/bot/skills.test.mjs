/**
 * 技能包：内容必须能直接用；未知 id 不炸；正文不重。
 */

import assert from "node:assert/strict";
import { test } from "./_harness.mjs";
import { BOT_SKILLS, botSkill, skillSummaries, skillsFor } from "../../electron/bot/skills.mjs";
import { compileContext } from "../../electron/bot/index.mjs";

await test("技能：id 唯一、描述与正文非空", () => {
  assert.ok(BOT_SKILLS.length >= 4);
  assert.equal(new Set(BOT_SKILLS.map((s) => s.id)).size, BOT_SKILLS.length);
  for (const s of BOT_SKILLS) {
    assert.ok(s.name && s.description && s.body, `${s.id} 缺内容`);
    assert.ok(s.body.length > 30, `${s.id} 正文太短`);
  }
  assert.equal(botSkill("nope"), null);
  assert.deepEqual(skillsFor(["status-brief", "nope"]).map((s) => s.id), ["status-brief"]);
  assert.equal(skillSummaries().every((s) => !("body" in s)), true, "列表不带正文");
});

await test("技能进 system prompt，并有 2400 字符硬上限", () => {
  const out = compileContext(
    { name: "PM", capability: "read", persona: {} },
    "",
    { proactive: false, skills: skillsFor(["status-brief", "pr-review"]) },
  );
  assert.match(out.system, /技能（需要时按里面的步骤做/);
  assert.match(out.system, /第一句给结论/);
  assert.ok(out.sectionChars.skills > 0);
  const huge = [{ id: "x", name: "大", body: "技".repeat(5000) }];
  const capped = compileContext({ name: "PM", capability: "read", persona: {} }, "", { proactive: false, skills: huge });
  assert.ok(capped.sectionChars.skills <= 2400);
});
