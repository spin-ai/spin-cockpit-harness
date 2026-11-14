import { useState } from "react";
import type { State } from "../types";
import type { OfficeModel } from "../office/model";
import type { ScenePrefs } from "../office/SceneConfigPanel";
import type { CoordinationScene, CoordinationTemplate } from "../types";
import { SCENE_TEMPLATES, templateDesc, templateLabel, templateOf } from "../office/templates";
import { RowMenu } from "./RowMenu";

function OfficeCover() {
  return (
    <svg className="off-scene-cover" viewBox="0 0 320 152" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="320" height="152" className="off-cv-floor" />
      <rect width="320" height="58" className="off-cv-wall" />
      <rect y="57" width="320" height="1" className="off-cv-line" />
      <ellipse cx="178" cy="120" rx="124" ry="34" className="off-cv-rug" />
      <g className="off-cv-shadow">
        <rect x="16" y="12" width="70" height="40" rx="3" className="off-cv-surface" />
        <rect x="22" y="20" width="34" height="2" rx="1" className="off-cv-line-strong" />
        <rect x="22" y="26" width="52" height="1.5" rx=".75" className="off-cv-line" />
        <rect x="22" y="31" width="44" height="1.5" rx=".75" className="off-cv-line" />
        <rect x="22" y="36" width="50" height="1.5" rx=".75" className="off-cv-line" />
      </g>
      <g className="off-cv-shadow">
        <rect x="16" y="78" width="74" height="24" rx="3" className="off-cv-desk" />
        <rect x="22" y="68" width="24" height="14" rx="2" className="off-cv-screen" />
        <rect x="26" y="72" width="12" height="1.4" rx=".7" className="off-cv-line-strong" />
        <rect x="26" y="76" width="15" height="1.2" rx=".6" className="off-cv-line" />
        <rect x="58" y="64" width="14" height="21" rx="7" className="off-cv-actor" />
        <rect x="61" y="69" width="8" height="5" rx="2.5" className="off-cv-visor" />
        <circle cx="65" cy="71.5" r="1.2" fill="var(--off-slate)" />
        <rect x="57" y="80" width="16" height="3" rx="1.5" fill="var(--off-slate)" />
      </g>
      {[112, 168, 224].map((x, i) => (
        <g className="off-cv-shadow" key={x}>
          <rect x={x} y="88" width="42" height="11" rx="2" className="off-cv-desk" />
          <rect x={x + 4} y="76" width="17" height="12" rx="1.5" className="off-cv-screen" />
          <rect x={x + 7} y="79" width="8" height="1.2" rx=".6" className="off-cv-line-strong" />
          <rect x={x + 7} y="82" width="10" height="1" rx=".5" className="off-cv-line" />
          <rect x={x + 26} y="73" width="11" height="18" rx="5.5" className="off-cv-actor" />
          <rect x={x + 29} y="77" width="6" height="4" rx="2" className="off-cv-visor" />
          <circle cx={x + 32} cy="79" r="1" fill={["var(--off-teal)", "var(--off-indigo)", "var(--off-amber)"][i]} />
          <rect x={x + 25} y="87" width="13" height="2.5" rx="1.25" fill={["var(--off-teal)", "var(--off-indigo)", "var(--off-amber)"][i]} />
        </g>
      ))}
      <g className="off-cv-shadow">
        <rect x="226" y="18" width="40" height="30" rx="2" className="off-cv-surface" />
        <circle cx="240" cy="30" r="6" fill="var(--amber)" opacity=".32" />
        <rect x="234" y="40" width="24" height="1.4" rx=".7" className="off-cv-line" />
      </g>
      <g>
        <rect x="288" y="104" width="12" height="12" rx="2" className="off-cv-pot" />
        <ellipse cx="294" cy="102" rx="8" ry="11" className="off-cv-plant" />
        <ellipse cx="300" cy="105" rx="5" ry="8" className="off-cv-plant" transform="rotate(22 300 105)" />
      </g>
    </svg>
  );
}

function WarRoomCover() {
  return (
    <svg className="off-scene-cover" viewBox="0 0 320 152" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="320" height="152" className="off-cv-floor" />
      <rect width="320" height="58" className="off-cv-wall" />
      <rect y="57" width="320" height="1" className="off-cv-line" />
      <ellipse cx="160" cy="120" rx="130" ry="30" className="off-cv-rug" />
      <g className="off-cv-shadow">
        <rect x="100" y="12" width="120" height="40" rx="3" className="off-cv-screen" />
        <rect x="110" y="20" width="42" height="2" rx="1" className="off-cv-line-strong" />
        <rect x="110" y="26" width="84" height="1.5" rx=".75" fill="rgba(255,255,255,.18)" />
        <rect x="110" y="31" width="64" height="1.5" rx=".75" fill="rgba(255,255,255,.12)" />
        <circle cx="206" cy="44" r="2" fill="var(--red)" />
      </g>
      <g className="off-cv-shadow">
        <ellipse cx="160" cy="94" rx="102" ry="24" className="off-cv-surface" />
        <ellipse cx="160" cy="92" rx="94" ry="19" className="off-cv-rug" />
        <rect x="116" y="86" width="24" height="12" rx="2" className="off-cv-screen" />
        <rect x="180" y="86" width="24" height="12" rx="2" className="off-cv-screen" />
      </g>
      {[92, 140, 188, 228].map((x, i) => (
        <g className="off-cv-shadow" key={x}>
          <rect x={x} y={i === 1 || i === 2 ? 58 : 62} width="15" height="24" rx="7.5" className="off-cv-actor" />
          <rect x={x + 4} y={i === 1 || i === 2 ? 63 : 67} width="7" height="5" rx="2.5" className="off-cv-visor" />
          <circle cx={x + 8} cy={i === 1 || i === 2 ? 65.5 : 69.5} r="1.1" fill={["var(--off-teal)", "var(--off-indigo)", "var(--off-amber)", "var(--off-purple)"][i]} />
          <rect x={x - 1} y={i === 1 || i === 2 ? 76 : 80} width="17" height="3" rx="1.5" fill={["var(--off-teal)", "var(--off-indigo)", "var(--off-amber)", "var(--off-purple)"][i]} />
        </g>
      ))}
      <g>
        <rect x="280" y="104" width="12" height="12" rx="2" className="off-cv-pot" />
        <ellipse cx="286" cy="102" rx="8" ry="11" className="off-cv-plant" />
      </g>
    </svg>
  );
}

function CarrierCover() {
  return (
    <svg className="off-scene-cover" viewBox="0 0 320 152" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="320" height="152" className="off-cv-sea2" />
      <g transform="translate(160 78) scale(.82) rotate(28) translate(-160 -78)">
        <path className="off-cv-deck2" d="M 160 8 L 182 30 L 196 82 L 200 136 L 120 136 L 124 82 L 138 30 Z" />
        <path className="off-cv-deck2-side" d="M 182 30 L 196 82 L 200 136 L 204 142 L 116 142 L 120 136 Z" />
        <path className="off-cv-lane" d="M 116 130 L 128 136 L 184 62 L 176 50 Z" />
        <path className="off-cv-deck2-line" d="M 132 130 L 180 64" strokeDasharray="3 3" />
        <path className="off-cv-deck2-line" d="M 150 104 L 154 44" strokeWidth="4" />
        <path className="off-cv-deck2-line" d="M 168 104 L 172 44" strokeWidth="4" />
        <path className="off-cv-deck2-line" d="M 130 112 L 176 70" strokeWidth="3" />
        <path className="off-cv-island2" d="M 176 52 L 196 56 L 202 82 L 184 86 Z" />
        <rect x="182" y="62" width="12" height="5" rx="1" className="off-cv-window2" />
        <line x1="188" y1="52" x2="188" y2="38" className="off-cv-deck2-line" />
        <text x="144" y="64" className="off-cv-number" transform="rotate(-10 144 64)">18</text>
      </g>
    </svg>
  );
}

type SortKey = "updated" | "created" | "name";

/** 卡片上的「更新于」：只到分钟/天，不做秒级跳动。 */
function relTime(ts: number) {
  if (!ts) return "未保存";
  const diff = Date.now() - ts;
  if (diff < 45_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString([], { month: "2-digit", day: "2-digit" });
}

/** 只显示偏离默认值的配置，避免每张卡都重复「评审门 · 升级」。 */
function sceneFlags(scene: CoordinationScene) {
  const prefs = scene.config.prefs ?? {};
  return [
    prefs.reviewGate === false ? "免评审" : null,
    prefs.escalate === false ? "不升级" : null,
    prefs.inject === true ? "注入角色提示" : null,
    prefs.showLinks === false ? "隐藏连线" : null,
    prefs.showLabels === false ? "隐藏姓名" : null,
  ].filter((flag): flag is string => Boolean(flag));
}

export function SceneGallery({ state, model, scenes, activeSceneId, onSelectScene, onEnter, onNewScene, onRenameScene, onDuplicateScene, onDeleteScene, onExportScene }: {
  state: State;
  model: OfficeModel;
  scenes: CoordinationScene[];
  activeSceneId: string | null;
  onSelectScene: (id: string) => void;
  onEnter: () => void;
  onNewScene: (template?: ScenePrefs["template"]) => void;
  onRenameScene: (id: string, name: string) => void;
  onDuplicateScene: (id: string) => void;
  onDeleteScene: (id: string) => void;
  onExportScene: (id: string) => void;
}) {
  const stats = model.stats;
  const project = state.projects.find((p) => p.id === state.activeProjectId);
  const [query, setQuery] = useState("");
  const [templateFilter, setTemplateFilter] = useState<CoordinationTemplate | "all">("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const sceneCast = (scene: CoordinationScene) => {
    const members = scene.config.cast ?? [];
    if (!members.length) {
      const lead = model.lead ? [{ id: model.lead.agent.id, name: model.lead.displayName, accent: model.lead.accent }] : [];
      return [...lead, ...model.actors.filter((a) => a.agent.id !== model.lead?.agent.id).map((a) => ({ id: a.agent.id, name: a.displayName, accent: a.accent }))];
    }
    return members.map((c) => {
      const agent = state.agents.find((a) => a.id === c.agentId);
      const actor = model.actors.find((a) => a.agent.id === c.agentId);
      return { id: c.agentId, name: c.displayName || actor?.displayName || agent?.name || c.agentId, accent: actor?.accent || agent?.color || "slate", role: c.role };
    });
  };

  const startRename = (scene: CoordinationScene) => {
    setConfirming(null);
    setRenaming({ id: scene.id, value: scene.name });
  };
  const commitRename = () => {
    if (!renaming) return;
    const value = renaming.value.trim().slice(0, 80);
    const current = scenes.find((s) => s.id === renaming.id);
    if (value && current && value !== current.name) onRenameScene(renaming.id, value);
    setRenaming(null);
  };

  const counts: Record<string, number> = {};
  for (const scene of scenes) counts[templateOf(scene.template)] = (counts[templateOf(scene.template)] || 0) + 1;

  const keyword = query.trim().toLowerCase();
  const visible = scenes
    .filter((scene) => templateFilter === "all" || templateOf(scene.template) === templateFilter)
    .filter((scene) => {
      if (!keyword) return true;
      const hay = [scene.name, templateLabel(scene.template), templateDesc(scene.template), ...sceneCast(scene).map((a) => a.name)].join(" ").toLowerCase();
      return hay.includes(keyword);
    })
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "zh-Hans-CN");
      if (sort === "created") return (b.createdAt || 0) - (a.createdAt || 0);
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

  return (
    <div className="off-gallery">
      <div className="off-gal-summary">
        <span><b>{scenes.length}</b> 个协作场景</span>
        <span><b>{stats.agents}</b> 位 Agent</span>
        <span><b>{stats.running}</b> 运行中</span>
        <span><b>{stats.waiting}</b> 待确认</span>
        <span><b>{stats.review}</b> 待验收</span>
        <span className="off-gal-muted">舞台模板 3 种 · 办公室 2.5D / 作战室 3D / 航母 3D 已上线</span>
      </div>

      <div className="off-gal-tools">
        <div className="off-gal-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索场景名 / 成员"
            aria-label="搜索场景"
            spellCheck={false}
          />
          {query ? <button className="off-icon-btn" onClick={() => setQuery("")} aria-label="清除搜索" title="清除搜索">✕</button> : null}
        </div>
        <div className="off-gal-filters" role="group" aria-label="按舞台模板筛选">
          <button className={`off-gal-chip ${templateFilter === "all" ? "on" : ""}`} onClick={() => setTemplateFilter("all")}>
            全部 <b>{scenes.length}</b>
          </button>
          {SCENE_TEMPLATES.map((t) => (
            <button key={t.id} className={`off-gal-chip ${templateFilter === t.id ? "on" : ""}`} onClick={() => setTemplateFilter(t.id)} title={t.parts}>
              {t.label} <b>{counts[t.id] || 0}</b>
            </button>
          ))}
        </div>
        {keyword || templateFilter !== "all" ? <span className="off-gal-count">{visible.length} / {scenes.length}</span> : null}
        <select className="off-gal-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title="排序" aria-label="排序">
          <option value="updated">最近更新</option>
          <option value="created">最近创建</option>
          <option value="name">名称</option>
        </select>
      </div>

      {scenes.length > 0 && visible.length === 0 ? (
        <div className="off-gal-empty">
          <span>没有匹配的场景</span>
          <button className="btn tiny-btn" onClick={() => { setQuery(""); setTemplateFilter("all"); }}>清除筛选</button>
        </div>
      ) : null}

      <div className="off-gal-grid">
        {visible.map((scene) => {
          const cast = sceneCast(scene);
          const stage = templateOf(scene.template);
          const CardCover = stage === "warroom" ? WarRoomCover : stage === "carrier" ? CarrierCover : OfficeCover;
          const label = templateLabel(scene.template);
          const desc = templateDesc(scene.template);
          const active = scene.id === activeSceneId;
          const flags = sceneFlags(scene);
          const onlyScene = scenes.length <= 1;
          return (
            <article
              className={`off-scene-card ${active ? "active" : ""}`}
              key={scene.id}
              tabIndex={0}
              aria-label={`场景 ${scene.name}`}
              onClick={() => onSelectScene(scene.id)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.target !== e.currentTarget) return;
                onSelectScene(scene.id);
                onEnter();
              }}
            >
              <div className="off-scene-thumb">
                <CardCover />
                <span className="off-gal-label">{stage.toUpperCase()} · {active ? "LIVE" : "SCENE"}</span>
                {active ? <span className="off-gal-live"><i />当前</span> : null}
              </div>
              <div className="off-scene-body">
                <div className="off-scene-title">
                  {renaming?.id === scene.id ? (
                    <input
                      className="off-scene-rename"
                      value={renaming.value}
                      autoFocus
                      aria-label="场景名称"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenaming((r) => (r ? { ...r, value: e.target.value } : r))}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                        else if (e.key === "Escape") { e.preventDefault(); setRenaming(null); }
                      }}
                    />
                  ) : (
                    <h3
                      title="双击重命名"
                      onDoubleClick={(e) => { e.stopPropagation(); startRename(scene); }}
                    >{scene.name}</h3>
                  )}
                  {active ? <span className="tag live">当前</span> : null}
                  <span className="tag">{label}</span>
                </div>
                <p className="off-scene-desc">{project ? `${project.name} · ${project.alias}` : "全局"} · {desc}</p>
                <div className="off-gal-cast">
                  <div className="off-avatars">
                    {cast.slice(0, 5).map((a) => <span key={a.id} className={`off-avatar-mini accent-${a.accent}`} title={a.name}>{a.name.slice(0, 1)}</span>)}
                    {cast.length > 5 ? <span className="off-avatar-more">+{cast.length - 5}</span> : null}
                  </div>
                  <span className="off-gal-cast-label">{cast.length || stats.agents} 位 · {model.standby.length ? `${model.standby.length} 待命` : "全部就位"}</span>
                </div>
                <div className="off-scene-meta">
                  <span title={scene.updatedAt ? new Date(scene.updatedAt).toLocaleString() : undefined}>更新 {relTime(scene.updatedAt)}</span>
                  {flags.map((flag) => <span className="off-scene-flag" key={flag}>{flag}</span>)}
                </div>
              </div>
              <div className="off-scene-foot">
                {confirming === scene.id ? (
                  <>
                    <span className="off-scene-confirm">删除「{scene.name}」？</span>
                    <div className="row gap6">
                      <button className="btn tiny-btn" onClick={(e) => { e.stopPropagation(); setConfirming(null); }}>取消</button>
                      <button className="btn tiny-btn danger" onClick={(e) => { e.stopPropagation(); setConfirming(null); onDeleteScene(scene.id); }}>删除</button>
                    </div>
                  </>
                ) : (
                  <>
                    <button className="btn primary" onClick={(e) => { e.stopPropagation(); onSelectScene(scene.id); onEnter(); }}>进入实况</button>
                    <RowMenu title={`${scene.name} 的操作`}>
                      <button role="menuitem" onClick={() => startRename(scene)}>重命名</button>
                      <button role="menuitem" onClick={() => onDuplicateScene(scene.id)}>复制一份</button>
                      <button role="menuitem" onClick={() => onExportScene(scene.id)}>复制为 JSON</button>
                      <button
                        role="menuitem"
                        className="danger"
                        disabled={onlyScene}
                        title={onlyScene ? "至少保留一个场景；想换模板可直接修改这个场景" : "删除场景"}
                        onClick={() => { if (!onlyScene) setConfirming(scene.id); }}
                      >删除</button>
                    </RowMenu>
                  </>
                )}
              </div>
            </article>
          );
        })}

        <article className="off-new-scene">
          <div className="off-new-head"><b>新建协作场景</b><span>从模板开始</span></div>
          {SCENE_TEMPLATES.map((t) => (
            <button key={t.id} className="off-template-choice" onClick={() => onNewScene(t.id)}>
              <span className={`off-tpl-icon ${t.id === "office" ? "" : t.id}`} />
              <span className="off-tpl-copy"><b>{t.label}</b><span>{t.parts}</span></span>
              <span className={`tag ${t.id === "office" ? "ok" : ""}`}>{t.id === "office" ? "默认" : "原型"}</span>
            </button>
          ))}
          <p className="off-new-note">点模板会带入新建弹层（可改名）；舞台只决定空间与动作，调度仍走现有 Mission / Delegation。</p>
        </article>
      </div>

      <div className="off-template-strip">
        <div className="off-strip-head"><b>舞台模板</b><span>同一套 SceneModel，换舞台不换状态机</span></div>
        <div className="off-template-row">
          {SCENE_TEMPLATES.map((t) => (
            <div className="off-template-item" key={t.id}>
              <span className={`off-template-icon ${t.id === "office" ? "" : t.id}`} />
              <div><b>{t.label}</b><span>{t.parts}</span></div>
              <span className={`tag ${t.id === "office" ? "ok" : ""}`}>{t.id === "office" ? "默认" : "原型"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
