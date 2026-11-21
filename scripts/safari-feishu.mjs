#!/usr/bin/env node
/**
 * 配置飞书时的一次性小工具：通过 JXA 在 Safari 里执行受控 JS（不写文件、不依赖 AX）。
 *
 * 前提：Safari → 设置 → 高级 → 显示网页开发者功能；开发菜单 →「允许来自 Apple 事件的 JavaScript」。
 *
 * 用法：
 *   node scripts/safari-feishu.mjs title
 *   node scripts/safari-feishu.mjs hits 复制 "App Secret" 权限管理
 *   node scripts/safari-feishu.mjs click "事件与回调"
 *   node scripts/safari-feishu.mjs copy "App Secret"
 *
 * 安全：只点「复制」，不打印任何凭据值；需要写入时走应用里的「从剪贴板读入」。
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DRIVER = `function run(argv) {
  const Safari = Application("Safari");
  const docs = Safari.documents;
  if (!docs.length) return "NO_DOCUMENT";
  return Safari.doJavaScript(argv[0], { in: docs[0] });
}`;

function runJs(js) {
  const file = path.join(os.tmpdir(), `jxa-${randomUUID()}.js`);
  fs.writeFileSync(file, DRIVER);
  try {
    return execFileSync("osascript", ["-l", "JavaScript", file, js], { encoding: "utf8" }).trim();
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const [, , cmd, ...args] = process.argv;
const lit = (value) => JSON.stringify(String(value));

switch (cmd) {
  case "title":
    console.log(runJs("document.title + ' | ' + location.href"));
    break;
  case "hits": {
    const keys = args.length ? args : ["复制", "权限管理", "事件订阅"];
    const js = `JSON.stringify(${JSON.stringify(keys)}.map((k) => [k, document.body.innerText.split(k).length - 1]))`;
    console.log(runJs(js));
    break;
  }
  case "fields": {
    const js = `JSON.stringify([...document.querySelectorAll('input,textarea')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => ({ tag: el.tagName, type: el.type || '', placeholder: el.placeholder || '', name: el.name || '', id: el.id || '' }))
      .slice(0, 20))`;
    console.log(runJs(js));
    break;
  }
  case "buttons": {
    const js = `JSON.stringify([...document.querySelectorAll('button,[role=button]')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 18))
      .filter(Boolean).slice(0, 30))`;
    console.log(runJs(js));
    break;
  }
  case "fill": {
    const [needle, ...rest] = args;
    const value = rest.join(" ");
    const js = `(() => {
      const needle = ${lit(needle)};
      const value = ${lit(value)};
      const el = [...document.querySelectorAll('input,textarea')].find((x) => (x.placeholder || '').includes(needle) || (x.name || '').includes(needle) || (x.id || '').includes(needle));
      if (!el) return 'INPUT_NOT_FOUND';
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'FILLED';
    })()`;
    console.log(runJs(js));
    break;
  }
  case "click": {
    const text = args.join(" ");
    const js = `(() => {
      const wanted = ${lit(text)};
      const all = [...document.querySelectorAll('button,a,[role=button],[role=tab],li,span')];
      const hit = all.find((el) => (el.innerText || '').trim() === wanted && el.offsetParent !== null)
        || all.find((el) => (el.getAttribute('aria-label') || '').trim() === wanted && el.offsetParent !== null)
        || all.find((el) => (el.innerText || '').includes(wanted) && el.offsetParent !== null);
      if (!hit) return 'NOT_FOUND';
      hit.scrollIntoView({ block: 'center' });
      hit.click();
      return 'CLICKED';
    })()`;
    console.log(runJs(js));
    break;
  }
  case "copy": {
    const label = args.join(" ");
    const js = `(() => {
      const label = ${lit(label)};
      const btn = [...document.querySelectorAll('button,[role=button],i,span,svg')]
        .filter((el) => el.offsetParent !== null)
        .find((el) => {
          const near = el.closest('div,tr,section');
          const text = (near?.innerText || '');
          const own = (el.getAttribute('aria-label') || '') + ' ' + (el.innerText || '') + ' ' + (el.className || '');
          return text.includes(label) && /复制|copy/i.test(own);
        });
      if (!btn) return 'COPY_NOT_FOUND';
      btn.click();
      return 'COPIED';
    })()`;
    console.log(runJs(js));
    break;
  }
  default:
    console.error("用法：title | hits <关键词…> | click <文本> | copy <标签>");
    process.exit(1);
}
