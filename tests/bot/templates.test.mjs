/**
 * 内置模板：人格 / 职责 / 日程必须是能直接用的成品，不是占位。
 */

import assert from "node:assert/strict";
import { test } from "./_harness.mjs";
import { BOT_TEMPLATES, botTemplate, templateSummaries } from "../../electron/bot/templates.mjs";
import { describeRoutine, normalizeRoutine } from "../../electron/bot/routine.mjs";
import { botSkill } from "../../electron/bot/skills.mjs";

await test("模板：每个都有职责与一句话说明，日程可规范化", () => {
  assert.ok(BOT_TEMPLATES.length >= 4);
  for (const t of BOT_TEMPLATES) {
    assert.ok(t.name, `${t.id} 缺名字`);
    assert.ok(t.line, `${t.id} 缺一句话说明`);
    assert.ok(t.persona?.mission, `${t.id} 缺 mission`);
    assert.ok(t.persona?.duty?.goal, `${t.id} 缺 duty.goal`);
    for (const id of t.skills || []) assert.ok(botSkill(id), `${t.id} 的技能 ${id} 不存在`);
    if (t.routine) {
      const r = normalizeRoutine(t.routine);
      assert.ok(["daily", "every", "once", "watch"].includes(r.kind));
      assert.ok(describeRoutine(r), `${t.id} 日程描述为空`);
      assert.ok(r.prompt && r.prompt.length > 10, `${t.id} 日程缺 prompt`);
    }
  }
  assert.equal(botTemplate("briefing")?.name, "早报");
  assert.equal(botTemplate("nope"), null);
  assert.equal(templateSummaries().length, BOT_TEMPLATES.length);
});
