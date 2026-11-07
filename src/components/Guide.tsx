import { GitWiki } from "./GitWiki";

/**
 * 「说明」页直接展示随仓库发布的 Project Wiki。
 * 内容来自 resources/wiki/*.md，与 Git 页里的项目 Wiki 使用同一份页面。
 */
export function Guide() {
  return (
    <div className="guide-wiki">
      <GitWiki sourceLabel="使用说明" />
    </div>
  );
}
