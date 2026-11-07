import { marked } from "marked";
import DOMPurify from "dompurify";

/**
 * 把 Markdown 源码渲染成可安全注入的 HTML。
 * - gfm：表格 / 任务列表 / 删除线
 * - DOMPurify：去掉脚本、iframe、表单等危险标签
 * - 补 heading id：让 README 里的目录锚点（#xxx）可跳转
 */
export function renderMarkdown(text: string): string {
  if (!text) return "";
  const raw = marked.parse(text, { gfm: true, async: false }) as string;
  const safe = DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "button", "textarea", "select"],
  });
  return addHeadingIds(safe);
}

/** marked 新版默认不生成 heading id；给目录锚点补上 id */
function addHeadingIds(html: string) {
  return html.replace(/<(h[1-6])>([\s\S]*?)<\/\1>/g, (_m, tag: string, inner: string) => {
    const plain = inner.replace(/<[^>]+>/g, "").trim();
    const id = slugifyHeading(plain);
    return id ? `<${tag} id="${id}">${inner}</${tag}>` : `<${tag}>${inner}</${tag}>`;
  });
}

export function slugifyHeading(text: string) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, "-")
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "");
}
