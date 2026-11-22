import type { State } from "../types";
import { EmptyState } from "./EmptyState";
import { PageHeader } from "./PageHeader";
import { useT } from "../i18n";

/** 插件视图 id → 渲染层已注册组件的页面 id（ARCH-plugins：第三方 view 进沙箱 iframe 之前，视图必须在这里登记） */
const VIEW_TARGETS: Record<string, "notes" | "zhulong"> = { notes: "notes", zhulong: "zhulong" };

/**
 * 插件市场（一级页面）：本机插件的目录页。
 *
 * 只回答两件事：有哪些插件、每个插件提供什么视图能打开。
 * 安装 / 启用 / 卸载 / 权限 / 插件设置都留在 设置 → 插件 —— 一个动作只有一个常驻入口
 * （DESIGN-SYSTEM §5「一行 chrome」、AGENTS 第 21 条），所以这里不放「安装」按钮，只给一个「插件设置」。
 */
export function PluginMarket({ state, onOpenView, onOpenSettings }: {
  state: State;
  onOpenView: (view: "notes" | "zhulong") => void;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const plugins = state.plugins || [];
  const views = state.pluginViews || [];
  const enabled = plugins.filter((plugin) => plugin.enabled).length;

  return (
    <div className="page plugins-page">
      <PageHeader
        title={t("page.plugins")}
        subtitle={`${plugins.length} 个插件 · ${enabled} 个已启用`}
        actions={<button className="btn tiny" onClick={onOpenSettings}>{t("plugins.manage")}</button>}
      />
      <section className="panel">
        <div className="panel-head">{t("plugins.installed")}</div>
        {plugins.length === 0 ? (
          <EmptyState compact title={t("plugins.emptyTitle")} desc={t("plugins.emptyDesc")} />
        ) : (
          plugins.map((plugin) => {
            const name = plugin.manifest?.name || plugin.id;
            const openable = views.filter((view) => view.pluginId === plugin.id && VIEW_TARGETS[view.id]);
            const permissions = (plugin.permissions || []).join(" · ") || t("plugins.noPermission");
            return (
              <div className="settings-plugin-row" key={plugin.id}>
                <div className="settings-plugin-main">
                  <div className="settings-plugin-name">
                    <b>{name}</b>
                    {plugin.builtin && <span className="tag">{t("plugins.builtin")}</span>}
                    <span className="mono tiny faint">{plugin.version}</span>
                    <span className={`pill status ${plugin.enabled ? "done" : "cancelled"}`}>{plugin.enabled ? t("plugins.enabled") : t("plugins.disabled")}</span>
                  </div>
                  <div className="settings-plugin-meta">{plugin.id} · {permissions}</div>
                  {plugin.lastError && <div className="settings-plugin-error">{plugin.lastError}</div>}
                </div>
                <div className="settings-plugin-actions">
                  {plugin.enabled
                    ? openable.map((view) => (
                        <button key={view.id} className="btn tiny" onClick={() => onOpenView(VIEW_TARGETS[view.id])}>
                          {t("plugins.open")} {view.title}
                        </button>
                      ))
                    : <button className="btn tiny" onClick={onOpenSettings}>{t("plugins.toEnable")}</button>}
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
