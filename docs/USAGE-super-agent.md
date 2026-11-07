# Super Agent 使用说明

> 界面内也可以打开左侧导航「说明」或 Chat 空状态的「Super Agent 怎么用？」。

## 1. 准备 Agent

1. 在 Chat 底部点「＋ dsh」，纳管一个 **worker**（真正执行代码改动）。
2. 再点「＋ 主管」创建 **Supervisor**；同一项目只需要一个主管即可。
3. 也可以在 **设置 → 执行 → Agent 角色** 里把已有 Agent 改成 Supervisor，并填写主管的额外要求。

> 只有 dsh/ACP 能直接从 Chat 执行。其他 CLI 仍标注「终端专用」。

## 2. 新建 Mission

1. 点 Chat 的「新任务」。
2. 在底部 Agent 选择器选 `✦ 主管`。
3. 直接描述目标，例如：
   > 把登录页拆成实现 + 测试两个子任务，完成后汇总改动和测试结果。

普通单任务不要选主管，选 worker 即可。

## 3. 审批计划

主管先提交 **Plan Card**，不会立刻改代码。检查：

- 步骤是否合理
- 每步的 worker 是否正确
- 依赖顺序（`dependsOn`）
- 验收条件和风险

可以「退回修改」并填写原因；确认后点「批准并分派」。

## 4. 子任务执行

批准后系统会：

- 创建 child Todo + Delegation + worker run
- 有 git 仓库时，每个 child 使用独立 worktree
- 在 Mission 面板和 TODO LIST 显示进度
- 子任务审批仍按普通 run 的审批策略处理

子任务卡上的「查看会话」会打开该 child 的独立 Chat。

## 5. 审阅与确认

- 子任务结束后，Mission 进入「待确认」
- 主管会收到事件并汇总；收件箱只出现一条「Mission 待确认」
- 可要求返工、重试或停止单个子任务
- 全部满意后点「确认完成」；Mission 和 child 任务进入完成状态

## 6. 中断 / 恢复 / 取消

- **停止主管**：只停当前 supervisor run，不自动杀子任务
- **取消 Mission**：级联取消所有未完成 child run
- 应用重启或异常中断后，Mission 显示「已中断」，点「恢复 Mission」重新接入
- 已确认的 Mission 仍可在 TODO LIST 中查看历史

## 7. 设置建议

**设置 → 执行 → Super Agent / Mission**：

| 设置 | 建议 |
|---|---|
| 启用 Mission 模式 | 默认开启 |
| Supervisor 并发 | 单机建议 1 |
| Mission 子任务上限 | 4，按机器负载调整 |
| Mission 时长预算 | 30 分钟起；超时会失败并进收件箱 |

## 8. 常见问题

**没有计划？**  
先确认有 worker、dsh 可用、模型已配置；失败原因会进收件箱。

**批准后没有子任务？**  
计划必须审批通过；计划里的 worker 必须存在且可执行。

**没有独立 worktree？**  
项目不是 git 仓库时会回落到项目目录。并行改文件前建议先 `git init` 或使用已有仓库。

**主管能直接改代码吗？**  
不建议，也不会：Mission supervisor 使用只读 sandbox，代码改动由 worker 完成。

**支持远程主管吗？**  
当前 supervisor 只支持本地；远程主机可作为 worker。远程 supervisor / 团队是后续能力。

## 9. 一句话原则

**普通单任务用 worker；需要拆解、并行、审阅、汇总时用 Mission。**
