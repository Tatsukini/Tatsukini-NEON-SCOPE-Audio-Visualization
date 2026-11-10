# NEON//SCOPE

[![Release](https://img.shields.io/badge/release-V0.1.3__1110__alpha__GPLver-orange)](https://github.com/Tatsukini/Tatsukini-NEON-SCOPE-Audio-Visualization/releases/tag/V0.1.3_1110_alpha_GPLver)

> 当前为 **Alpha 测试版本 V0.1.3_1110_alpha_GPLver**。启动时会显示 Alpha 提示，确认后进入工作台。

实时音频 / MIDI 可视化工作台。导入音频或 MIDI，在仪表盘上自由编排模块，实时渲染并导出带音频的视频；支持第三方插件扩展模块。

![NEON//SCOPE 工作台](docs/screenshots/workspace.png)

## 预览

| 工作台 | 硬件设置 |
| --- | --- |
| ![工作台](docs/screenshots/workspace.png) | ![硬件设置](docs/screenshots/hardware.png) |

| 插件管理器 |
| --- |
| ![插件管理器](docs/screenshots/plugins.png) |

## 直接运行 EXE（推荐）

**双击 `dist\NEON-SCOPE.exe`** 即可。不需要安装 Node.js，也不需要安装 .NET 运行时。

- 运行环境：Windows 10 / 11 x64。
- 依赖系统自带的 **Microsoft Edge WebView2 Runtime**。如果系统没有，程序会提示下载地址。
- 首次运行可能出现 Windows SmartScreen 提示（程序未签名），选择“更多信息 → 仍要运行”。
- 导出的视频默认保存到 `下载 / Downloads` 文件夹。
- 布局、主色和偏好设置会自动保存，下次启动恢复。

项目根目录下同时提供 `NEON-SCOPE-win64.zip` 作为压缩分发版本（内含 EXE、使用说明与可替换的 `assets` 示例素材）。

Windows 构建使用 [SignPath Foundation](https://signpath.org/) 作为开源项目可信代码签名方案；签名由 SignPath Foundation 证书完成。

### EXE 的数据位置

优先使用：

```
%LOCALAPPDATA%\NEONScope\
```

如果该位置不可写，会自动回退到 EXE 同目录的 `NEONScopeData\`。日志文件为其中的 `neon-scope.log`。

### MP4、FFmpeg 与硬件编码

- 在 Windows WebView2 中，MP4 **优先直接录制为 H.264 + AAC**，无需 FFmpeg。
- 如果系统不支持原生 MP4 录制，或选择了自定义 CRF、H.265 / AV1 编码、MKV / MOV 容器、指定的硬件编码器，才会调用 FFmpeg 转码。
- 若需要使用这些高级选项，请安装 [FFmpeg](https://ffmpeg.org/) 并加入 `PATH`；没有 FFmpeg 也不影响常规 MP4 / WebM 导出。
- **硬件编码**：高级导出 →「视频编码 / ENCODER」可选 自动（优先硬件）/ 软件 / NVIDIA NVENC / AMD AMF / Intel QSV。服务端启动时会用小尺寸真实编码探测本机可用的硬件编码器，UI 只启用探测到的厂商；硬件编码不可用或编码失败时自动回退软件编码。VP8 / VP9 仅支持软件编码。
- **帧率保障**：导出前会测量显示器刷新率与导出分辨率下的实际渲染吞吐；如果无法稳定跑满请求帧率，会自动降速录制（画面与音频同步放慢），再在 FFmpeg 封装阶段恢复原速并强制输出请求帧率。降速录制需要 FFmpeg；没有 FFmpeg 时会按原速录制并在导出日志中给出提示。
- **原始音轨封装**：降速录制时音频会被浏览器同步放慢、音高降低，因此封装阶段不再使用录制音轨，而是把原始音频文件直接封装进成片（画面仍按原速恢复）。导出日志会显示「上传原始音频」与 `audio source: original file`；原始音频上传失败时回退为录制音轨并应用 `atempo`。
- 导出期间请保持窗口在前台：窗口切到后台时浏览器会暂停画布出帧，导出会主动提示并退出，而不是卡在初始化。
- 导出进度页中部提供 **FFMPEG / ENCODE LOG** 实时日志，显示转码命令输出、进度与错误；「取消导出」会中止上传并终止转码进程，录制阶段与封装阶段都能立即停止。

## 网页版（开发用）

也可以继续用本地 Node 服务运行同一套界面：

**双击 `启动 NEON SCOPE.bat`**，或手动：

```bash
node server.mjs
```

网页版要求 Node.js 18+，MP4 后备转码同样可选依赖 FFmpeg。EXE 和网页版共用同一套 `index.html / styles.css / js` 资源。

## 功能

- **导入音频**：WAV / MP3 / FLAC / OGG / M4A / AAC。
- **导入 MIDI**：内置 Standard MIDI File（Format 0/1）解析器；支持一次选择多个 MIDI，所有文件、所有轨道强制合并进同一个 3D 钢琴卷帘模块。MIDI 只驱动可视化，不合成音频、不替换当前音轨，播放时间轴仍来自当前音频或 DEMO。
- **MIDI 模块总线**：统一管理合并后的全部 MIDI 轨道，可调整 MIDI 偏移（10ms 步进）、音符样式、MIDI 缩放、滚动速度、时间窗口、默认深度、音符厚度、垂直中心、Vibrato、标题 / 和弦叠加，并逐轨设置 M/S、颜色与视觉深度。默认读取 MIDI 的 BPM / 拍号，并结合当前音频长度校准速度，以「显示小节数」自动计算显示范围；「MIDI 缩放」只改变音符横向密度，「滚动速度」只改变实际滚动速率。轨道列表顺序决定 3D 纵深，上远下近，音符近大远小、近快远慢；轨道行尾 × 或 Ctrl+Shift+左键可删除轨道。
- **硬件设置**：设置 →「硬件」提供自动资源分配、CPU / GPU / 内存 / 显存配额、FFT 解算精度（1024–16384）、预览渲染缩放（50%–120%）、FPS / 帧耗时 / CPU / GPU / RAM / 显存 / 渲染分辨率实时图表、性能优化与恢复默认；设置 →「动效」提供 10 FPS 到无限制的预览帧率与 VSync。
- **插件系统**：设置 →「插件」支持从 GitHub 仓库或 PNPM 包安装插件；插件名必须以 `Tatsukini-Neon-` 开头，支持启用、停用、重载和卸载。插件可注册新的可视化模块，规范见 [PLUGIN_SPEC.md](PLUGIN_SPEC.md)。
- **MIDI 钢琴卷帘**：所有导入 MIDI 强制合并进同一个 3D 模块；模块专属设置包含每轨 M/S、轨道颜色、单轨视觉深度、音符样式（长方形 / 圆角）、滚动速度，以及标题 / 和弦叠加的文字、位置、颜色、字号、字体和滑入 / 淡入动画。
- **示例工程**：首次打开自动载入 `When Rain In My Mind Vol.2.mp3` 与 6 个配套 MIDI 文件，并强制合并成一个 3D 钢琴卷帘。
- **21 个可视化模块**：VU 电平、响度、模拟 VU 表、示波器、X-Y 李萨如、频谱、相位相关、节奏、动态、声谱图、立体声场、全局波形、MIDI 钢琴卷帘、峰值倾斜、声场分布、三段能量环、峰值频谱、节拍脉冲、环形示波器、克拉尼图形、基础信息。
- **克拉尼图形**：用近似克拉尼方程生成方形板驻波场与沙粒聚集，可调振动模态、沙子数量、振动幅度、采样精度与驻波场显隐。
- **自由布局**：拖动移动、四角缩放、属性面板精确输入、图层顺序、复制/删除。
- **窗口化工作区**：左侧「模块与素材」、中央舞台、右侧「属性检查器」都有窗口化 / 关闭按钮；每张内部卡片（信号源、模块库、位置尺寸、模块外观、专属参数、图层、画布输出、快速提示）也都可以独立浮动、关闭、拖动和缩放，像 OBS 面板一样排列。顶部九宫格按钮可恢复。
- **DAW 式吸附对齐**：顶部磁铁开关或 `G`。吸附画布边缘、中心线、其他模块边缘/中心线，并显示参考线。
- **模块专属参数**：每个可视化模块不再是同一套模板。VU 表有 LED 段数和峰值保持，示波器有轨迹线宽、余晖和网格，频谱有频段数量，声谱图有色图/增益，波形有 BAR/LINE/FILL 样式，钢琴卷帘有时间窗口等。
- **模块右键菜单**：右键任意模块，可快速复制、隐藏、独显、居中、重置尺寸、调整图层或删除。
- **模块显隐**：模块库中点击眼睛图标切换同类模块；也可单个隐藏。
- **RGBA 色盘 + 主题预设**：使用色相/明度/饱和度面板 + RGB/A 数值选择主题色、模块色或纯色背景；支持透明度，并提供 MAGENTA / CYAN / AMBER / VIOLET 快捷预设。
- **桌面设置窗口**：EXE 中点击右侧栏底部「设置」会打开独立的原生桌面窗口（不是软件内弹层）；网页版回退为同功能设置弹层。设置修改会实时同步回主窗口。
- **界面缩放**：70%–150% 全局 UI 缩放，**设置窗口自身也会同步缩放**；达到较大缩放时会自动切换紧凑布局，避免顶栏、侧栏和按钮重叠。
- **三种界面风格**：NEON GRID（当前霓虹仪表盘）、VIDI STUDIO（深色青色霓虹剪辑台）、CATBOT PAPER（浅色直角几何编辑界面），在设置 →「界面」切换。
- **明暗模式**：设置 →「界面」提供跟随主题 / 深色 / 浅色三个选项；浅色模式适用于全部主题，深色模式也让 CATBOT PAPER 拥有深色版本。
- **主题色 / 背景色联动**：CATBOT PAPER 的纸张底色由背景色自动调和，强调色、选中态、品牌标记和设置按钮跟随主题色；浅色模式的纸张底色同样会随背景色变化。
- **信息编辑面板**：初始隐藏，可从顶部九宫格面板菜单启用；编辑歌曲名、艺术家、专辑、流派、BPM、封面，并可把信息卡叠加进预览和导出。填写的 BPM 会立即覆盖节拍引擎与节奏类模块的 BPM 显示（留空则恢复自动检测 / 音轨 BPM）。
- **动画设计面板**：初始隐藏；可按时间码添加闪白、文字、字幕、标题卡、开场卡、颜色染色、淡出动作，支持删除/清空、撤销 / 重做，动作会直接进入导出视频。标题卡的标题 / 作者 / 来源三条文本可分别设置字号，并支持关键帧自动化。
- **关键帧编辑器**：每个动作参数可单独绘制自动化曲线；单击曲线添加关键帧，拖动圆点同时修改时间与数值，也可以在下方列表精确输入时间 / 数值或取色；颜色关键帧按时间插值，点「完成」后随工程自动保存。
- **时间轴缩放与平移**：`Ctrl + 滚轮` 以时间轴为轴心横向缩放，`Alt + 滚轮` 以第一轨为轴心纵向缩放；在时间轴空白处滚动普通滚轮可左右平移。
- **舞台排版存档**：设置 → 文件提供 5 个独立快速槽位，只保存模块布局/尺寸/颜色/参数；支持导入导出 `.NEONMDUL`，不包含音频与动画。
- **工程存档**：保存为单个 `.NEON`（ZIP 工程包），可导出/导入；包含 `project.json`、动画、音频源文件、MIDI 源文件、背景和封面。`Ctrl+S` 快速保存。
- **动画脚本**：支持 `00:00.000 text ...`、`mash`、`color`、`effect blur`、`bpm` 等时间码脚本的导入/导出；`mash` 行支持 `sizeTitle` / `sizeAuthor` / `sizeOrigin` 三个字号字段。
- **动画时间轴**：Blender 风格底部时间轴，显示轨道、动作条、播放头；轨道改由拖拽动画项目自动创建，不同类型动画可共享同一轨道；支持拖动、拉伸时长、删除、缩放、吸附（`G`）与对齐参考（`Ctrl + K`）。
- **文件路径**：设置 →「文件」可指定默认存档路径与视频导出路径；每行提供「查看文件」按钮，可在资源管理器中直接打开当前路径；EXE 中使用原生文件夹选择器。存档默认保存到本机应用数据目录下的 `Saves`，导出留空时使用系统 Downloads。
- **背景图片**：上传后实时显示图片预览并持久化；支持暗化、模糊、完整显示、Ken Burns 缓慢推拉、漂移、呼吸、轻摇和强节拍动效。
- **动效 / 导出效果**：设置 →「动效」可调节背景图片动效、片头渐入、片尾渐出和节拍闪光，效果直接绘制进导出视频。
- **快捷键映射**：快捷键映射窗口，支持搜索、重绑定、恢复默认；`Tab`、`Esc` 和鼠标按键不可绑定。默认键位为 FL Studio 风格的工作流。
- **视频导出**：720P / 1080P / 2K / 4K；24 / 30 / 60 / 120 FPS 快捷档与 1–240 自定义帧率；8–40 Mbps 快捷档与自定义码率；MP4 / WebM / MKV / MOV 容器；H.264 / H.265 / AV1 / VP9 / VP8 编码；硬件编码（自动 / 软件 / NVENC / AMF / QSV）自动探测并可回退；CRF 画质、编码预设、GOP、音频编码 / 码率 / 采样率等高级设置；可选完整曲目 / 前 30 秒 / 前 10 秒。导出时按性能自动降速录制并在封装阶段恢复原速，保证输出帧率与请求一致；降速导出会自动用原始音频替换录制音轨，避免音高被放慢。进度页内置 FFmpeg 实时日志，可随时取消。导出按请求帧率采样画布，不再因渲染循环节流产生重复帧。
- **实时分析**：8192 sample FFT，双通道波形、峰值保持、短时/综合响度近似、节拍脉冲和 BPM。
- **完全本地处理**：媒体文件不会上传到网络。

## 插件

### 安装

1. 打开 设置 → 插件。
2. 输入 GitHub 仓库（如 `owner/Tatsukini-Neon-Example`）或 PNPM 包名（如 `Tatsukini-Neon-Example`）。
3. 点击「从 GitHub 安装」或「从 PNPM 安装」。
4. 安装后插件会出现在列表里，可停用、重载或卸载。

只有名称以 `Tatsukini-Neon-` 开头的仓库 / 包会被接受；插件代码是远程 JavaScript，请只安装可信来源。

### 插件能做什么

- 通过 `context.registerModule()` 注册新的 Canvas2D 可视化模块。
- 使用与内置模块相同的选项 schema（滑块、开关、下拉、颜色、文本）。
- 读取音频分析帧（时域、频谱、RMS、低频/中频/高频、节拍、BPM）。
- 通过 `activate()` / `deactivate()` 管理生命周期。

完整清单、字段、绘制 API、GitHub / PNPM 下载路径和示例代码见仓库根目录的 [PLUGIN_SPEC.md](PLUGIN_SPEC.md)。

## 快捷键

按 `F1` 或点击顶部键盘图标打开**快捷键映射**窗口，可按功能搜索、点击右侧键位重新绑定，也可一键恢复默认。`Tab`、`Esc` 和鼠标按键被禁止绑定。

默认键位：

| 键 | 操作 |
|---|---|
| `Space` | 播放 / 暂停 |
| `Home` | 停止并回到开头 |
| `G` | 吸附对齐开关 |
| `E` | 编辑 / 预览模式 |
| `F` | 专注预览（再按退出） |
| `L` | 循环播放 |
| `Ctrl + Shift + E` | 打开视频导出 |
| `Ctrl + ,` | 打开设置 |
| `F1` | 快捷键映射 |
| `F2` | 工作台指南 |
| `F3` | 打开独立舞台窗口 |
| `T` | 显示 / 收起动画时间轴 |
| `K` | 显示关键帧管理总线 |
| `A` | 添加动画动作 |
| `Ctrl + K` | 时间轴对齐参考 |
| `Ctrl + Z` | 撤销动画编辑 |
| `Ctrl + Shift + Z` / `Ctrl + Y` | 重做动画编辑 |
| `Ctrl + Shift + R` | 恢复默认面板布局 |
| `Ctrl + D` | 复制所选模块 |
| `Shift + H` / `Shift + V` | 模块水平 / 垂直居中 |
| `← ↑ ↓ →` | 微调所选模块 |
| `Shift + 方向键` | 微调 10 px |
| `Delete` | 删除所选模块 |
| `Esc` | 关闭窗口 / 取消选择 / 退出专注（不可重绑定） |

时间轴内：鼠标滚轮横向平移，`Ctrl + 滚轮` 横向缩放，`Alt + 滚轮` 纵向缩放。

## 使用建议

1. 打开后点击画面中央播放键，先用示例音频与 MIDI 调整视觉；也可以导入自己的音频 / MIDI。
2. 在左侧「模块与素材」中增减模块；在画布中点击模块后，于右侧「属性检查器」精确调整位置、尺寸、颜色、透明度和**该模块专属参数**。右键模块可打开快捷操作菜单。
3. 编辑时保持「吸附对齐」开启，拖动模块会吸附到网格、画布边缘/中线与其他模块边缘；参考线是青色。
4. 点击右侧栏底部「设置」，可以调整四色主题、纯色/图片背景、界面风格、界面缩放、默认字体、动效、GPU/CPU 模式、灵敏度和快捷键。EXE 中这是独立桌面窗口。
5. 左侧、舞台、右侧面板以及内部每张小卡片右上角的窗口 / 关闭按钮可以独立浮动、隐藏或停靠；顶部九宫格按钮可恢复。信息编辑、动画设计默认隐藏，在面板菜单中启用。
6. 导出从曲目开头开始实时录制，耗时约等于曲目长度。导出期间请保持窗口在前台。

## 技术实现

```
音频文件 / MIDI
      │
      ▼
Web Audio AudioBuffer ──► ChannelSplitter ──► AnalyserNode L/R
      │                                            │
      └────────► destination / MediaStreamDestination
                                                   │
                                            实时分析数据
                                                   │
                        WebGL 背景着色器 + Canvas2D 模块合成
                                                   │
                                      Canvas.captureStream + 音轨
                                                   │
                             MediaRecorder (MP4/H.264 或 WebM/VP9)
                                                   │
                             可选：本机 FFmpeg → MP4 / MKV / MOV / WebM
```

- **桌面外壳**：C# WinForms + WebView2，内嵌 ASP.NET Core Kestrel 本地服务（仅监听 `127.0.0.1`），使用固定端口段保证 localStorage 持久化。Web 前端嵌入 EXE。
- **分析**：Web Audio `AnalyserNode`（8192 point FFT）获取时域与频域数据，并计算 RMS、峰值、相关度、低/中/高频能量、节拍包络和 BPM。响度显示为近似 K-weighted 值，非母带级认证仪表。
- **MIDI**：自写 SMF 解析器处理 tempo map、velocity、program、CC10 pan、CC7 volume 与鼓通道；解析结果只供钢琴卷帘模块滚动显示，不进入音频合成或分析链路。
- **渲染**：默认 GPU 模式使用 WebGL fragment shader 渲染等离子 / 电弧 / 霓虹环背景；CPU 模式提供 Canvas2D 回退。示波器、频谱、声谱图、声场等模块由高分辨率 Canvas2D 合成。
- **导出**：`CaptureStream` 录制画布，同时混合 Web Audio 音轨。降速导出时改为调用本地 FFmpeg 把原始音频文件与录制画面重新封装，并在封装阶段恢复原速（原始音频经 `POST /api/audio-source` 上传到临时目录，封装完成后删除）。Windows WebView2 支持直接 MP4/H.264 硬件录制；自定义容器 / 编码 / CRF / 硬件编码器时由本地 FFmpeg 按设置转码（H.264 / H.265 / AV1 / VP9 / VP8，AAC / Opus）。硬件编码器（NVENC / AMF / QSV）在服务启动时通过真实小尺寸编码探测，转码失败自动回退软件编码；`POST /api/convert/cancel` 会终止 FFmpeg 进程树。下载由 WebView2 原生下载管理器保存到“下载”文件夹。

### 工程结构

```
index.html / styles.css          工作台界面
js/                              前端模块、音频分析、MIDI、导出
server.mjs                       网页版本地服务
native/                          C# 桌面外壳源码
  Program.cs / MainForm.cs       WinForms + WebView2 窗口
  ServerHost.cs                  内嵌 Kestrel + FFmpeg 转换 API
  AppPaths.cs                    可写数据目录与日志
  app.ico                        应用图标
build-native.ps1                 重建 EXE
dist/NEON-SCOPE.exe              可分发 EXE
```

## 重新构建 EXE

要求：.NET 8 SDK。

在项目目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\build-native.ps1
```

脚本会在 `dist\` 生成新的 `NEON-SCOPE.exe` 并打包 `NEON-SCOPE-win64.zip`。

### GitHub Actions

仓库包含 [`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml)。推送 `V*` 标签或手动触发 workflow 时，会在 `windows-latest` 上构建并上传未签名产物：

```text
NEON-SCOPE-win64-unsigned
```

### Code signing / 代码签名

NEON//SCOPE 使用 [SignPath Foundation](https://signpath.org/) 为开源 Windows 构建提供可信代码签名支持。签名后的发布产物由 SignPath Foundation 证书签名，而不是由个人证书签名。

For the SignPath Foundation program, this project is built automatically from the public repository by GitHub Actions and publishes Windows artifacts through GitHub Releases.

## License / 许可证

源代码使用 GNU General Public License v3.0 或更高版本（GPL-3.0-or-later），见 [LICENSE](LICENSE)。

`assets/` 下的示例音频、MIDI、字体和图片仍归各自作者所有，不包含在 GPL 许可范围内；详见 [NOTICE](NOTICE)。

## Privacy / 隐私

见 [PRIVACY.md](PRIVACY.md)。应用本地运行，不上传音频、MIDI、工程文件或个人信息；插件可能按其自身逻辑联网，请只安装可信插件。

## 已知限制

- 画布固定 16:9（逻辑分辨率 1920×1080），所有导出分辨率均为 16:9。
- 视频导出为实时录制，不支持后台静默渲染；4K/60FPS 对性能要求较高，建议先用 1080P。导出期间切到后台会暂停画布出帧，程序会提示并中止本次导出。
- 当硬件无法稳定跑满请求帧率时会自动降速录制，实际录制耗时约为成片时长的 1–2 倍；封装阶段恢复原速需要 FFmpeg。
- 降速导出时成片音轨来自原始音频文件，音量滑块不再影响成片电平（按原始文件封装）；音频编码 / 码率 / 采样率仍按高级设置执行。
- 硬件编码取决于显卡、驱动与 FFmpeg 构建：没有对应编码器时会自动使用软件编码，VP8 / VP9 也不支持硬件编码。
- MIDI 只作为钢琴卷帘可视化数据，不参与音频分析或合成；请使用导入音频或 DEMO 作为播放时间轴。
- Windows 构建正在接入 SignPath Foundation 可信签名；在签名正式启用前，SmartScreen 仍可能提示“未知发布者”。
- 如果系统没有 WebView2 Runtime，需要先安装（Windows 10/11 通常已经自带）。
