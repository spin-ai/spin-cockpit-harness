#!/usr/bin/env python3
"""把 docs 下的 Markdown 需求/对比文档合成为单页 HTML。

用法：python3 scripts/build-docs-html.py
依赖：pip install markdown
输出：docs/REQ-multi-agent-workspace.html
"""

from __future__ import annotations

import re
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUT = DOCS / "REQ-multi-agent-workspace.html"

REQ = DOCS / "REQ-multi-agent-workspace.md"
ORIG = DOCS / "REQ-original.md"

MD_EXT = ["tables", "fenced_code", "sane_lists", "attr_list", "toc"]
MD_CFG = {"toc": {"permalink": False}}


def md2html(text: str) -> str:
    return markdown.markdown(text, extensions=MD_EXT, extension_configs=MD_CFG)


def strip_first_h1(text: str) -> str:
    return re.sub(r"\A#\s+.*?\n", "", text, count=1)


MODULE_LETTER = re.compile(r"^[A-T]$|^[A-T]\s*[.、]")


def add_ids(md: str, kind: str) -> str:
    """给标题加稳定 ASCII 锚点，避免中文标题 slug 冲突。"""
    out = []
    in_apx = False
    for line in md.split("\n"):
        m = re.match(r"^(#{2,3})\s+(.*)$", line)
        if not m:
            out.append(line)
            continue
        hashes, title = m.group(1), m.group(2).strip()
        if hashes == "##" and title.startswith("附录"):
            in_apx = True
        anchor = None
        mm = re.match(r"^(\d+)\s*\.", title)
        mod = re.match(r"^([A-T])\s*[.、]", title)
        if hashes == "##" and mod:
            anchor = "cm-" + mod.group(1).lower()
        elif hashes == "###" and mod and not in_apx:
            anchor = "m-" + mod.group(1).lower()
        elif hashes == "##" and mm:
            anchor = ("s" if kind == "req" else "cmp-") + mm.group(1)
        elif hashes == "##" and title.startswith("附录"):
            anchor = "apx"
        elif hashes == "##" and title.startswith("附："):
            anchor = "cmp-skip"
        if anchor:
            line = f"{hashes} {title} {{#{anchor}}}"
        out.append(line)
    return "\n".join(out)


def polish(html: str) -> str:
    """表格包一层可横向滚动；跨文档链接转锚点。"""
    def wrap(m: re.Match) -> str:
        table = m.group(0)
        head = re.search(r"<th[^>]*>(.*?)</th>", table, re.S)
        first = re.sub(r"<[^>]+>", "", head.group(1)).strip() if head else ""
        cls = "tbl tbl-id" if first == "编号" else "tbl tbl-plain"
        return f'<div class="{cls}">{table}</div>'

    html = re.sub(r"<table>.*?</table>", wrap, html, flags=re.S)
    html = re.sub(r'<a href="REQ-multi-agent-workspace\.md"', '<a href="#top"', html)
    html = re.sub(r'<a href="REQ-original\.md"', '<a href="#orig"', html)
    return html


def old_style_and_proto() -> tuple[str, str]:
    """样式与线框图优先从 assets 读（已从上一版手写 HTML 抽离）。"""
    style_f = DOCS / "assets" / "doc-style.css"
    proto_f = DOCS / "assets" / "proto-section.html"
    style = style_f.read_text(encoding="utf-8") if style_f.exists() else ""
    proto = proto_f.read_text(encoding="utf-8") if proto_f.exists() else ""
    return style, proto


EXTRA_CSS = """
  /* ---------- doc parts ---------- */
  .part{margin-top:56px;padding-top:8px;border-top:2px solid var(--line)}
  .part-head{margin:0 0 6px;font-size:22px;letter-spacing:.4px;border-top:0;padding-top:0}
  .part-head .num{display:inline-block;font:600 10.5px var(--sans);letter-spacing:1.4px;
    color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:3px 9px;
    margin-right:10px;vertical-align:3px}
  .part-lead{color:var(--muted);font-size:13.5px;margin:0 0 18px}

  /* ---------- code ---------- */
  .part pre{background:#0f1720;color:#cfdae5;border:1px solid #0b1116;border-radius:10px;
    padding:14px 16px;margin:14px 0;overflow:auto;font-size:12.5px;line-height:1.7}
  .part pre code{background:none;border:0;color:inherit;padding:0;white-space:pre;font-size:12.5px}
  .part blockquote{margin:14px 0;padding:10px 16px;background:var(--surface-2);
    border-left:3px solid var(--accent);border-radius:0 8px 8px 0;color:var(--ink-2);font-size:13.5px}
  .part blockquote p{margin:0}

  /* ---------- tables ---------- */
  .tbl{margin:14px 0;overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
  .tbl table{margin:0;border:0;border-radius:0}
  .tbl table td:first-child{width:auto;font-family:var(--sans);font-size:13.5px;color:var(--ink-2);font-weight:400}
  .tbl.tbl-id table td:first-child{width:52px;font-family:var(--mono);font-size:12px;color:var(--accent);font-weight:600}

  /* ---------- compare ---------- */
  .cmp h2{margin-top:40px;padding-top:16px;border-top:1px solid var(--line)}
  .cmp h2:first-of-type{border-top:0}
  .cmp h2 .badge{font:600 10px var(--sans);letter-spacing:1px;border-radius:999px;
    padding:2px 8px;margin-left:8px;vertical-align:3px}
  .cmp .tbl{margin:10px 0 14px}
  .cmp .tbl table{min-width:640px}
  .cmp .tbl td{width:auto}
  .cmp .tbl-plain td:first-child{color:var(--ink);font-weight:600;width:20%;min-width:150px}
  .cmp .tbl-plain td,.cmp .tbl-plain th{overflow-wrap:break-word;word-break:normal}
  .cmp .tbl td img.shot{width:100%;height:auto;max-height:520px;object-fit:contain;background:var(--surface-2)}
  .shot{display:block;width:100%;border:1px solid var(--line-2);border-radius:8px;background:#fff}
  .cmp table:has(img.shot) td{width:50%;vertical-align:top}
  .cmp .suggest{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
    padding:4px 18px 10px;margin:14px 0 8px}
  .cmp .suggest h3{margin:12px 0 4px;font-size:14px}
  .cmp .suggest ol{margin:6px 0 6px;padding-left:20px}
  .cmp .suggest li{margin:4px 0}
  .cmp em{color:var(--muted)}
  .cmp code{white-space:normal}
  .cmp blockquote{color:var(--muted);font-size:13px}

  /* ---------- misc ---------- */
  .lede-chips{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 0}
  .lede-chips span{font-size:12px;color:var(--ink-2);background:var(--surface);
    border:1px solid var(--line);border-radius:999px;padding:4px 11px}
  .doc-foot{margin-top:70px;padding-top:16px;border-top:1px solid var(--line);
    color:var(--muted);font-size:12.5px}
  @media (max-width:900px){
    .shell{grid-template-columns:1fr}
    .nav{position:static;height:auto}
    main{padding:20px 18px 60px}
    .cmp td{display:block;width:100%}
  }
"""


def build_nav(parts: list[tuple[str, str]]) -> str:
    rows = []
    for group, html in parts:
        rows.append(f'<div class="group">{group}</div>')
        for m in re.finditer(r'<h([23])\b[^>]*?\bid="([^"]+)"[^>]*>(.*?)</h\1>', html, re.S):
            level = int(m.group(1))
            hid = m.group(2)
            title = re.sub(r"<[^>]+>", "", m.group(3)).strip()
            if level == 3 and not hid.startswith("m-"):
                continue
            if hid.startswith("m-") and group != "需求":
                continue
            cls = "" if level == 2 else ' class="sub"'
            rows.append(f'<a href="#{hid}"{cls}>{title}</a>')
    return "\n".join(rows)


def main() -> None:
    style, proto = old_style_and_proto()

    req_html = polish(md2html(add_ids(strip_first_h1(REQ.read_text(encoding="utf-8")), "req")))
    orig_html = polish(md2html(strip_first_h1(ORIG.read_text(encoding="utf-8"))))

    proto_html = proto if proto else '<p class="part-lead">（原型图缺失）</p>'
    if proto:
        proto = proto.replace('id="p1"', 'id="proto"', 1)
        proto_html = '<div class="part">' + proto + "</div>"

    req_html = '<div class="part" id="req">' + req_html + "</div>"
    orig_html = (
        '<div class="part">'
        '<h2 class="part-head" id="orig">原话拆解与修改建议</h2>'
        '<p class="part-lead">项目起点的原话拆解，仅作追溯。</p>'
        + orig_html
        + "</div>"
    )

    nav = build_nav(
        [
            ("需求", req_html),
            ("原型", proto_html),
            ("附录", orig_html),
        ]
    )

    doc = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cockpit Harness — 需求与模块对比</title>
<style>{style}{EXTRA_CSS}</style>
</head>
<body>
<div class="shell">
<nav class="nav">
  <div class="brand">Cockpit Harness<span>MULTI-AGENT ORCHESTRATION CONSOLE</span></div>
  <div class="ver">需求 76 条 · 模块 A–T</div>
  {nav}
</nav>
<main>
  <header class="doc-head" id="top">
    <h1>Cockpit Harness — 需求文档</h1>
    <p class="lead">独立发包的多 Agent 编排控制台：TODO / 看板 / 分派 / 纠偏 / 回写，<b>域面板留在 YieldMind-IDE</b>。
    本文合并两份内容：现行需求（A–T）与界面原型。</p>
    <div class="lede-chips">
      <span>76 条需求 · 57 P0 / 14 P1 / 5 P2</span>
      <span>14 周（M0–M6）</span>
    </div>
  </header>
  {req_html}
  {proto_html}
  {orig_html}
  <div class="doc-foot">
    由 <code>scripts/build-docs-html.py</code> 生成：源文件
    <code>docs/REQ-multi-agent-workspace.md</code> +
    <code>docs/REQ-original.md</code>。
  </div>
</main>
</div>
<script>
  // 滚动高亮导航
  const links = [...document.querySelectorAll('.nav a')];
  const targets = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const onScroll = () => {{
    const y = window.scrollY + 120;
    let idx = 0;
    targets.forEach((t, i) => {{ if (t.offsetTop <= y) idx = i; }});
    links.forEach(l => l.classList.remove('active'));
    if (links[idx]) links[idx].classList.add('active');
  }};
  window.addEventListener('scroll', onScroll, {{ passive: true }});
  onScroll();
</script>
</body>
</html>
"""
    OUT.write_text(doc, encoding="utf-8")
    print(f"written {OUT.relative_to(ROOT)}  ({len(doc)/1024:.1f} KB)")


if __name__ == "__main__":
    main()
