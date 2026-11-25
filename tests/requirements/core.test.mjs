import assert from "node:assert/strict";
import {
  M0_STATUSES, gapFor, keyPrefix, nextRequirementKey, normalizeAcceptance,
  requiredFieldsFor, statusGate, validateParent,
} from "../../electron/requirements/core.mjs";

const project = { id: "p1", alias: "cmh" };
const rr = { projectId: "p1", level: "rr", key: "CMH-RR-01", status: "approved", source: "客户", requester: "李经理" };
const ir = { projectId: "p1", level: "ir", key: "CMH-IR-01", status: "approved", scope: "只读", outOfScope: "不改存储" };
const sr = { projectId: "p1", level: "sr", key: "CMH-SR-01", status: "draft", impact: "Chat", acceptance: [] };
const us = { projectId: "p1", level: "us", key: "CMH-US-01", status: "draft", role: "值班", value: "定位失败", acceptance: [] };

assert.equal(keyPrefix(project), "CMH");
assert.equal(nextRequirementKey([rr], "p1", "rr", "CMH"), "CMH-RR-02");
assert.equal(keyPrefix({ id: "p 2", alias: "" }), "P2");
assert.equal(nextRequirementKey([ir], "p1", "ir", "CMH"), "CMH-IR-02");
assert.equal(nextRequirementKey([{ ...ir, key: "CMH-IR-09" }], "p1", "ir", "CMH"), "CMH-IR-10");

assert.equal(validateParent({ level: "rr", parent: null, projectId: "p1" }).ok, true);
assert.equal(validateParent({ level: "ir", parent: rr, projectId: "p1" }).ok, true);
assert.equal(validateParent({ level: "ir", parent: null, projectId: "p1" }).ok, false);
assert.equal(validateParent({ level: "sr", parent: ir, projectId: "p1" }).ok, true);
assert.equal(validateParent({ level: "us", parent: sr, projectId: "p1" }).ok, true);
assert.equal(validateParent({ level: "us", parent: ir, projectId: "p1" }).ok, false);
assert.equal(validateParent({ level: "sr", parent: null, projectId: "p1" }).ok, false);
assert.equal(validateParent({ level: "rr", parent: rr, projectId: "p1" }).ok, false);

assert.deepEqual(normalizeAcceptance([" a ", { text: "b", done: true }, { text: " " }]), [
  { text: "a", done: false }, { text: "b", done: true },
]);

assert.deepEqual(requiredFieldsFor("rr"), ["source", "requester"]);
assert.deepEqual(requiredFieldsFor("ir"), ["scope", "outOfScope"]);
assert.equal(statusGate(rr, "approved").ok, true);
assert.equal(statusGate({ ...rr, source: "" }, "approved").ok, false);
assert.equal(statusGate(ir, "approved").ok, true);
assert.equal(statusGate(sr, "approved").ok, false);
assert.deepEqual(statusGate({ ...sr, impact: "" }, "approved").missing, ["impact", "acceptance"]);
assert.equal(statusGate({ ...us, acceptance: [{ text: "a", done: false }] }, "approved").ok, true);
assert.equal(statusGate({ ...us, acceptance: [{ text: "a", done: false }] }, "done").ok, false);
assert.equal(statusGate({ ...us, acceptance: [{ text: "a", done: true }] }, "done").ok, true);
assert.equal(statusGate(rr, "done", { children: [] }).ok, false);
assert.equal(statusGate(rr, "done", { children: [{ status: "approved" }] }).ok, true);
assert.equal(statusGate(ir, "done", { children: [] }).ok, false);
assert.equal(statusGate(ir, "done", { children: [{ status: "approved" }] }).ok, true);
assert.equal(statusGate(us, "in_progress").ok, false);
assert.ok(M0_STATUSES.includes("approved"));

assert.equal(gapFor({ ...sr, acceptance: [{ text: "a", done: false }] }, { children: [] }).type, "downstream");
assert.equal(gapFor({ ...sr, acceptance: [{ text: "a", done: false }] }, { children: [{ id: "u" }] }), null);
assert.equal(gapFor({ ...us, acceptance: [] }, { children: [] }).label, "缺验收");

console.log("requirements core: passed");
