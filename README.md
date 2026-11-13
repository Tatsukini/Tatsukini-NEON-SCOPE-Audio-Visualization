# NEON//SCOPE `CANARY`

**前沿测试频道 · 不是稳定版**

[![Canary build](https://img.shields.io/badge/canary-V0.1.4__Alpha__Canary__1114__8-e5397f)](https://github.com/Tatsukini/Tatsukini-NEON-SCOPE-Audio-Visualization-Canary/releases/tag/V0.1.4_Alpha_Canary_1114_8)
[![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-1f6feb)](LICENSE)
[![Stable channel](https://img.shields.io/badge/stable-V0.1.1_1104_alpha_Num.2-6e7681)](https://github.com/Tatsukini/Tatsukini-NEON-SCOPE-Audio-Visualization)

> 这个仓库是 **NEON//SCOPE 的 Canary 频道**：功能最先落地、修得最快，也最不保证稳定。
> 如果你的用途是稳定出片，请回到 [稳定版仓库](https://github.com/Tatsukini/Tatsukini-NEON-SCOPE-Audio-Visualization/releases)。

Canary 与稳定版共享同一套前端资源与桌面外壳，代码同源；差别只在发布节奏与验收强度。Canary 构建不承诺存档 / 设置向后兼容，跨构建恢复失败属于预期内的测试风险。

---

## 频道对照

| | **Canary（本仓库）** | **Stable** |
| --- | --- | --- |
| 定位 | 前沿功能试验场，供测试与尝鲜 | 面向日常使用与出片 |
| 更新节奏 | 每一轮改动单独构建、单独发版 | 功能沉淀并回归后再发布 |
| 稳定性 | 可能引入行为变更、UI 重排、键位调整 | 冻结键位与工作流 |
| 存档兼容 | 每个构建都可能调整存档 / 设置结构 | 尽量保持兼容 |
| 问题反馈 | 通过 Canary 仓库 Issues，按测试项标注 | 通过稳定版仓库 Issues |
| 许可 | **AGPL-3.0-or-later**（比稳定版的 GPL 更严格） | GPL-3.0-or-later |

---

## 本构建

| 项目 | 值 |
| --- | --- |
| 构建号 | `V0.1.4_Alpha_Canary_1114_8` |
| 通道 | Canary / Alpha |
| 基于 | `V0.1.4_Alpha_Canary_1114_7` |
| 构建日期 | 2026-11-14 |
| 许可 | AGPL-3.0-or-later（见 [LICENSE](LICENSE)、[NOTICE](NOTICE)） |
| 可执行文件 | `dist\NEON-SCOPE.exe`、`NEON-SCOPE-win64.zip` |

### 本轮测试重点

1. **预览渲染优化** — 设置 → 硬件新增「预览优化」（默认开启）。模块外框、标题条、内部网格、扫描线与暗角一次性预渲染成图层后逐帧复用；声谱图、钢琴卷帘、波形、峰值斜率、立体声场、克拉尼等慢模块按 1/2/3 帧节奏更新。开启后预览帧率应明显提升，画面内容不应缺失或冻结。
2. **导出保持完整质量** — 导出路径完全绕过预览缓存与跳帧：所有可见模块每帧直绘，叠加水印、片头渐入、片尾渐出与节拍闪光。导出一段包含慢模块的视频，确认画面逐帧更新且与关闭「预览优化」时一致。
3. **设置侧边栏** — 左侧菜单在任何窗口宽度与系统缩放比例下都保持纵向排列；窄窗口收成 56px 图标栏（数字编号 + 悬停标题），不再变成横向条。
4. **回归** — 预览优化开关切换后立即生效；切换布局、主题、主色、模块尺寸后缓存正确失效；导入 MIDI / 音频后模块内容正常刷新。

### 回归清单（建议按顺序）

- [ ] 首次启动 → 确认 Alpha 提示 → 载入示例工程
- [ ] 播放时开关「预览优化」，对比帧率与画面是否一致
- [ ] 修改模块位置 / 尺寸 / 标题 / 颜色，确认预览即时更新
- [ ] 导出 10 秒视频，检查慢模块逐帧变化、水印与片头片尾
- [ ] 以 125% / 150% / 200% 系统缩放打开设置窗口，确认侧边栏始终纵向
- [ ] 把设置窗口拖窄到 700px 以下，确认收成图标栏且可滚动到「关于 / 快捷键」
- [ ] 设置全部面板走一遍，重启后核对设置与主色

---

## 快速开始（EXE）

**双击 `dist\NEON-SCOPE.exe`**。无需安装 Node.js 或 .NET 运行时。

- 运行环境：Windows 10 / 11 x64，依赖系统自带的 **Microsoft Edge WebView2 Runtime**。
- 未签名构建，首次运行可能出现 SmartScreen 提示：更多信息 → 仍要运行。
- 数据目录优先 `%LOCALAPPDATA%\NEONScope\`，不可写时回退到 EXE 同目录的 `NEONScopeData\`；日志为其中的 `neon-scope.log`。
- 设置、布局与主色自动保存；工程状态默认不跨启动恢复，可在 设置 → 文件 开启「自动存档恢复」，退出前会等待存档写完。
- 导出视频默认保存到系统「下载」文件夹。

### 网页版（开发 / 调试）

```bash
node server.mjs
```

需要 Node.js 18+。EXE 与网页版共用同一套 `index.html / styles.css / js` 资源；调试建议使用 `--no-open` 避免自动拉起浏览器。

---

## 快捷键（Canary 本轮变更处已标注）

按 `F1` 打开快捷键映射窗口，支持搜索、重绑定、恢复默认。`Tab`、`Esc` 与鼠标按键不可绑定。

| 键 | 操作 |
| --- | --- |
| `Space` | 播放 / 暂停 |
| `Home` | 停止并回到开头 |
| `←` / `→` | **快退 / 快进 1 秒（长按每秒 5 步）** |
| `↑` / `↓` | 微调所选模块 1 px |
| `Shift + ← / →` | **微调所选模块 10 px** |
| `Ctrl + ← / →` | **微调所选模块 1 px** |
| `Delete` | **删除所选动画动作或模块（无需先点对应面板）** |
| `G` | 吸附对齐 |
| `E` | 编辑 / 预览模式 |
| `F` | 专注预览 |
| `L` | 循环播放 |
| `Ctrl + S` | 保存工程存档 |
| `Ctrl + D` | 复制所选模块 |
| `Shift + H` / `Shift + V` | 模块水平 / 垂直居中 |
| `Ctrl + Z` / `Ctrl + Shift + Z` | 撤销 / 重做动画编辑 |
| `Ctrl + Shift + E` | 打开视频导出 |
| `A` / `Ctrl + K` | 添加动画动作 / 时间轴对齐参考 |
| `T` / `K` | 时间轴 / 关键帧管理总线 |
| `F2` / `F3` | 工作台指南 / 独立舞台窗口 |
| `Ctrl + ,` | 打开设置 |
| `Esc` | 关闭窗口 / 取消选择 / 退出专注 |

时间轴内：滚轮横向平移，`Ctrl + 滚轮` 横向缩放，`Alt + 滚轮` 纵向缩放。

---

## 功能速览

Canary 具备稳定版的全部工作台能力，并先行接收新功能：

- 音频 / MIDI 导入与实时分析（8192 sample FFT、双通道波形、响度、节拍与 BPM）。
- 22 个内置可视化模块 + 3D MIDI 钢琴卷帘 + MIDI O/C 字符模块；支持第三方插件扩展。
- 自由布局、吸附对齐、模块专属参数、四色主题与三套界面风格（NEON GRID / VIDI STUDIO / CATBOT PAPER）。
- 动画设计面板、关键帧曲线、Blender 风格时间轴。
- `.NEON` 工程存档（含音频、MIDI、动画、背景、封面）、5 个排版槽位。
- 720P – 4K 视频导出，MP4 / WebM / MKV / MOV，硬件编码探测与 FFmpeg 回退。
- 桌面外壳使用 C# WinForms + WebView2，内嵌 Kestrel 本地服务；EXE 与网页版共用前端。

完整功能清单、插件规范与架构说明以 [稳定版 README](https://github.com/Tatsukini/Tatsukini-NEON-SCOPE-Audio-Visualization) 为准，Canary 只维护差异部分。

![NEON//SCOPE 工作台](docs/screenshots/workspace.png)

---

## 许可 / License

**本仓库自 `V0.1.4_Alpha_Canary_1114_7` 起使用 GNU Affero General Public License v3.0 或更高版本（AGPL-3.0-or-later）**，比稳定版仓库的 GPL-3.0-or-later 更严格：

- 分发修改后的程序时，必须按 AGPL 提供完整对应源代码。
- 如果你修改程序并通过网络让其他用户使用，必须向这些用户提供修改版的对应源代码（AGPL 第 13 条）。
- 不得对 Canary 构建附加额外限制条款；如需更宽松的条款，请使用稳定版仓库的 GPL 构建。

`assets/` 下的示例音频、MIDI、字体与图片仍归各自作者所有，不在 AGPL 范围内；详见 [NOTICE](NOTICE)。
应用内 设置 → 关于 → 许可与版权声明 同步列出本程序的 AGPL 条目。

---

## 开发者

```powershell
powershell -ExecutionPolicy Bypass -File .\build-native.ps1
```

要求 .NET 8 SDK；脚本在 `dist\` 生成 `NEON-SCOPE.exe` 并打包 `NEON-SCOPE-win64.zip`。

```
index.html / styles.css    工作台界面
js/                        前端模块、音频分析、MIDI、导出、音效（sfx.js）
server.mjs                 网页版本地服务
native/                    C# 桌面外壳（WinForms + WebView2 + Kestrel）
build-native.ps1           重建 EXE
dist/                      可分发 EXE
```

GitHub Actions（`.github/workflows/build-windows.yml`）在推送 `V*` 标签或手动触发时构建未签名产物。Windows 构建正在接入 [SignPath Foundation](https://signpath.org/) 可信代码签名。

---

## Canary 已知限制与风险

- 实时录制导出，不支持后台静默渲染；导出期间保持窗口在前台。
- 4K / 60FPS 对性能要求高；硬件不稳时会自动降速录制，封装阶段依赖 FFmpeg 恢复原速。
- MIDI 仅驱动可视化，不参与音频合成或分析。
- Canary 构建间的存档、设置键位可能变化；跨构建异常请先清空应用数据目录再复测。
- 尚未签名的构建在签名启用前仍可能触发 SmartScreen 提示。

反馈请使用本仓库 Issues，并注明构建号与复现步骤。
