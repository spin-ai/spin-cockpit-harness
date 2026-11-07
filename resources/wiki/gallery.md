# 界面与流程

> 一页看完工作台、任务链路、ACP、调度、Mission 和打包。点任意图片可放大查看。

<div class="wiki-gallery hero">
<figure><img src="./wiki/cover-multi-agent.png" alt="多智能体终端" loading="lazy" /><figcaption><b>多智能体终端</b><span>Chat、PTY、任务、调度塞进同一套状态机</span></figcaption></figure>
<figure><img src="./wiki/cover-super-agent.png" alt="Super Agent" loading="lazy" /><figcaption><b>Super Agent</b><span>Mission / Plan / Delegation 进入同一张看板</span></figcaption></figure>
</div>

## 工作台

<div class="wiki-gallery">
<figure><img src="./wiki/layout.png" alt="五列工作台" loading="lazy" /><figcaption><b>五列工作台</b><span>TODO / Chat / Terminal / 文件 / 导航同屏联动</span></figcaption></figure>
<figure><img src="./wiki/themes.png" alt="主题系统" loading="lazy" /><figcaption><b>主题系统</b><span>13 套主题，终端 ANSI 与编辑器一起跟随</span></figcaption></figure>
</div>

## 架构与执行

<div class="wiki-gallery">
<figure><img src="./wiki/architecture.png" alt="架构" loading="lazy" /><figcaption><b>进程模型</b><span>Main / Renderer / Executor / Storage 四层</span></figcaption></figure>
<figure><img src="./wiki/acp-sequence.png" alt="ACP 时序" loading="lazy" /><figcaption><b>ACP 一次 run</b><span>initialize → session/new → prompt → 流式落库</span></figcaption></figure>
<figure><img src="./wiki/ui-context.png" alt="元素拾取链路" loading="lazy" /><figcaption><b>界面上下文</b><span>CDP 拾取 → 结构化 ui-context → Chat / steer</span></figcaption></figure>
</div>

## 任务与调度

<div class="wiki-gallery">
<figure><img src="./wiki/data-model.png" alt="数据模型" loading="lazy" /><figcaption><b>数据模型</b><span>Thread / Todo / Run / Message / Artifact</span></figcaption></figure>
<figure><img src="./wiki/send-state.png" alt="发送状态机" loading="lazy" /><figcaption><b>单一 send 路径</b><span>派活 / 纠偏 / 排队 / 仅记录</span></figcaption></figure>
<figure><img src="./wiki/scheduler.png" alt="调度器" loading="lazy" /><figcaption><b>调度器</b><span>全局 / 主机 / Agent / 同 cwd 约束</span></figcaption></figure>
</div>

## Mission

<div class="wiki-gallery">
<figure><img src="./wiki/mission-flow.png" alt="Mission 流程" loading="lazy" /><figcaption><b>Mission 流程</b><span>Plan 审批 → 子任务 → 回灌 → 汇总</span></figcaption></figure>
<figure><img src="./wiki/mission-state.png" alt="Mission 状态机" loading="lazy" /><figcaption><b>三套状态机</b><span>Mission / Supervisor Run / Delegation</span></figcaption></figure>
<figure><img src="./wiki/mcp-bridge.png" alt="MCP bridge" loading="lazy" /><figcaption><b>MCP bridge</b><span>stdio ↔ HTTP ↔ 主进程领域动作</span></figcaption></figure>
</div>

## 打包

<div class="wiki-gallery">
<figure><img src="./wiki/packaging.png" alt="打包结构" loading="lazy" /><figcaption><b>发行包</b><span>renderer / main / dsh runtime / plugins</span></figcaption></figure>
</div>
