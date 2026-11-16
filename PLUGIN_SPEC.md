# NEON//SCOPE 插件规范

版本：`1`（apiVersion = 1）  
适用范围：NEON//SCOPE 桌面版 / 浏览器版插件管理器

## 1. 命名规范

插件仓库名或 PNPM 包名必须满足：

```text
Tatsukini-Neon-<name>[-<detail>...]
```

- 不区分大小写，内部统一转小写。
- 前两段必须是 `Tatsukini-Neon-`，后续可以继续使用 `-` 分段。
- 合法示例：
  - `Tatsukini-Neon-Spectrum-Pack`
  - `Tatsukini-Neon-Audio-Rings`
  - `tatsukini-neon-midi-layers`
- 非法示例：`Neon-Scope-Pack`、`Tatsukini-Plugin-X`

插件管理器会同时校验仓库名 / 包名与 `plugin.json` 的 `name`。

## 2. 仓库或包结构

最小结构：

```text
Tatsukini-Neon-Example/
├─ plugin.json
├─ index.js
└─ README.md        # 可选
```

- `plugin.json`：插件清单，必须是合法 JSON。
- `index.js`：入口 ESM 文件，必须导出 `activate(context)`。
- 入口必须是单文件，或者已经在构建阶段打包成单文件；当前加载器不会解析远程相对 import。
- 入口不能使用 `..`、绝对路径或目录外文件。

## 3. plugin.json

```json
{
  "name": "Tatsukini-Neon-Example",
  "id": "tatsukini-neon-example",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.js",
  "description": "An example NEON//SCOPE plugin",
  "author": "your-name",
  "license": "MIT",
  "repository": "https://github.com/you/Tatsukini-Neon-Example",
  "permissions": ["modules"],
  "keywords": ["visualizer", "spectrum"]
}
```

必需字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 必须匹配 `Tatsukini-Neon-*` |
| `version` | string | 语义化版本 |
| `apiVersion` | number | 当前只能是 `1` |
| `entry` | string | 入口文件，相对于插件根目录 |

可选字段：`id`、`description`、`author`、`license`、`repository`、`permissions`、`keywords`。

`permissions` 用于声明插件能力，安装时会向用户确认；未声明的能力在运行时会被拒绝：

| 值 | 说明 |
| --- | --- |
| `modules` | 注册绘制模块（默认能力） |
| `network` | `context.net.fetch()` 与远程 `context.loadImage()` |
| `storage` | `context.storage` / `context.settings` 的本机读写 |
| `assets` | 图片等资源的本机存储 |
| `clipboard` | `context.clipboard.writeText()` |
| `openExternal` | `context.openExternal()` |

未知的权限值会被忽略并提示；不写 `permissions` 的旧插件仍可加载，但不能使用需要权限的 API。

## 4. 生命周期

入口模块：

```js
export async function activate(context) {
  // 注册模块、读取本地配置等
}

export async function deactivate() {
  // 可选：清理定时器、事件监听、Worker 等
}
```

- `activate(context)` 在安装后、启用后、应用启动时调用。
- `deactivate()` 在停用、卸载、重新加载前调用。
- 插件代码在应用主上下文中执行，拥有与页面相同的权限；只安装可信插件。
- 插件模块的文字颜色由 `draw` 自行设置 `ctx.fillStyle`；内置模块才受主题文字色约束。绘制上下文在每帧调用前已 `save()`，`draw` 结束时应用会 `restore()`。

### 热加载

- 安装、重载或更新插件后会**立即**重新执行入口脚本，无需重启应用。
- 更新时先执行旧实例的 `deactivate()`，再整体替换该插件的模块注册（模块定义、选项与 `draw`）；已经摆放在舞台上的模块会直接使用新版 `draw`，位置、尺寸与选项值保留。
- 新版本激活失败时保留上一个可用版本的渲染与启用状态，只记录 `lastError`。
- 原生版本的设置窗口与主窗口是两个 WebView；在设置窗口安装 / 启用 / 停用 / 卸载插件会通知主窗口立即同步，主窗口负责实际激活。

### 更新与卸载

- 插件管理器提供「检查更新」：GitHub 插件读取默认分支的 `plugin.json`，PNPM 插件读取 registry 的 `latest`，版本号更高时才视为更新。原生版会弹出 Windows 对话框勾选要更新的插件。
- 更新会替换插件记录里的清单与入口代码，并复用热加载流程；已有的模块实例与选项保持不变。
- 应用会记录入口代码的 SHA-256；检查更新时版本号或代码哈希任一变化都会提示更新（哈希不同但版本相同标注「代码已变化」）。「重载」对远程插件会重新下载后再激活。
- GitHub 插件先解析分支最新 commit SHA（`main` / `master`，仅 1 次 API 调用），再按该 SHA 从 raw 读取清单与入口，保证两者同版本且不受 CDN 缓存影响；API 未认证限流（60 次/小时）时回退到 raw 分支路径，状态栏会注明。PNPM 插件读取 registry 的 `latest` 与对应版本文件。
- 卸载会清理模块注册、绘制器、舞台实例、选中状态、工程存档与排版槽位中的引用；不会删除插件自行写入的任意 localStorage 键。

## 5. context API

```ts
interface PluginContext {
  apiVersion: 1;
  app: 'NEON//SCOPE';
  plugin: { id: string; name: string; version: string };
  registerModule(spec: ModuleSpec): void;
  log(...args: unknown[]): void;
  toast(message: string, tone?: 'info' | 'success' | 'error'): void;

  // 插件级设置（不写入 .NEON 工程）
  settings: {
    define(schema: SettingField[]): void;
    get(key: string, fallback?: unknown): unknown;
    all(): Record<string, unknown>;
    set(key: string, value: unknown): void;
    onChange(handler: (event: { plugin: string; key: string; value: unknown }) => void): () => void;
  };

  // 插件私有本地存储（按插件命名空间，卸载时清除）
  storage: {
    get(key: string, fallback?: unknown): unknown;
    set(key: string, value: unknown): void;
    delete(key: string): void;
    clear(): void;
    keys(): string[];
  };

  // 图片资源（按插件命名空间，卸载时清除）
  assets: {
    put(dataUrl: string, meta?: { id?: string }): string; // 返回资源引用 id
    get(ref: string): string | null;                      // data URL
    image(ref: string): HTMLImageElement | null;          // 首次调用返回 null，加载完成后重新调用
    remove(ref: string): boolean;
  };

  // 网络（需要 network 权限；CORS 失败时自动走本机代理）
  net: {
    fetch(url: string, init?: RequestInit & { timeout?: number; proxy?: boolean; binary?: boolean }): Promise<Response>;
  };
  loadImage(src: string, options?: { timeout?: number }): Promise<HTMLImageElement>;

  // 事件；返回取消订阅函数
  on(event: 'transport' | 'theme' | 'settings' | 'options' | 'project', handler: (payload: unknown) => void): () => void;

  clipboard: { writeText(text: string): Promise<void> }; // clipboard 权限
  openExternal(url: string): void;                       // openExternal 权限
}
```

### 5.1 插件设置

```js
context.settings.define([
  { key: 'apiKey', label: 'API Key', type: 'password', maxLength: 200, help: '只保存在本机' },
  { key: 'model', label: '模型', type: 'select', options: [['fast', '快速'], ['deep', '深度']], default: 'fast' },
  { key: 'avatar', label: '头像', type: 'image' },
]);

const key = context.settings.get('apiKey', '');
context.settings.set('model', 'deep');
context.settings.onChange(({ key, value }) => { /* 更新缓存，下一帧生效 */ });
```

- 设置值只写入本机（`neon-scope.plugin-settings.v1:<pluginId>`），**不会进入 `.NEON` 工程存档**，分享工程不会带走密钥。
- 设置界面出现在插件管理器的「设置」按钮里；支持的字段类型：`text`、`password`、`textarea`、`toggle`、`select`、`color`、`number`、`range`、`image`。
- 卸载插件时会清除该插件的设置、存储与资源。

### 5.2 存储与资源

- `storage` 与 `assets` 都按插件 id 隔离；`storage` 值需可 JSON 序列化，单个值上限 128 KB。
- `assets.put` 只接受 PNG / JPEG / WebP 的 data URL，上限约 2 MB；返回的 id 可放进模块选项（`image` 类型）或插件设置。
- 若模块选项使用 `image` 类型，宿主的文件选择器会压缩图片（最长边 512 px）后存入资源区，选项里只保存引用 id。

### 5.3 网络与图片

- `context.net.fetch` 先直接 `fetch`；失败（通常是 CORS）时自动回退到本机代理 `/api/net-proxy`。代理仅允许公网 http(s)，拒绝 localhost 与内网地址，按请求设置超时（1–60 秒），响应上限 5 MB。
- 远程图片建议使用 `context.loadImage`：它会用 `crossOrigin="anonymous"` 加载，失败时经代理取回再转 blob URL，避免画布被污染导致导出失败。
- 插件必须声明 `"permissions": ["network"]` 才能使用上述接口。

### 5.4 事件

| 事件 | 载荷 | 触发时机 |
| --- | --- | --- |
| `transport` | `{ playing, time, duration, bpm, loop }` | 播放 / 暂停 / 跳转 / 播放结束 |
| `theme` | `{ accent, palette: { bg, window, text, chart } }` | 界面四色或强调色变化 |
| `settings` | `{ plugin, key, value }` | 插件设置变更（本窗口或其他窗口保存） |
| `options` | `{ type, id, key, value, options }` | 模块参数变更 |
| `project` | `{ action: 'load' }` | 载入工程存档 |

事件在任意窗口保存设置后都会同步；绘制仍是连续进行的，事件只用于更新缓存或发起请求。

### 5.5 模块交互与尺寸

- `hiddenByDefault: true`：新添加的模块默认隐藏（可从模块库的显示按钮打开）。
- `minW / maxW / minH / maxH`：拖拽缩放时的尺寸边界（像素）。
- `icon`：模块库图标，支持 PNG / JPEG / WebP / SVG 的 data URL，建议 ≤ 32 KB。
- `onPointer(mod, event)`：在编辑模式下接收 `enter` / `leave` / `down` / `move` / `up`；`event` 包含模块内坐标 `x`、`y`、舞台坐标 `stageX`、`stageY` 与修饰键状态。回调必须快速返回，不能阻塞拖动。

### ModuleSpec

```js
context.registerModule({
  id: 'spectrum-rings',
  name: '频谱环',
  code: 'SPECTRUM RINGS',
  glyph: '◎',
  about: 'A plugin-provided spectrum ring module.',
  w: 360,
  h: 260,
  category: 'PLUGIN',
  options: [
    {
      key: 'rings',
      label: '环数量',
      type: 'range',
      min: 2,
      max: 12,
      step: 1,
      default: 5,
      unit: ''
    }
  ],
  draw(ctx, mod, body, frame, state, env) {
    // Canvas2D 绘制；body 是模块内容区域
  }
});
```

字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 插件内唯一；最终类型为 `pluginId:localId` |
| `name` | string | 模块库显示名称 |
| `code` | string | 模块角标 |
| `glyph` | string | 模块库图标，最多 2 字符 |
| `about` | string | 模块说明 |
| `w` / `h` | number | 默认尺寸，受舞台尺寸限制 |
| `category` | string | 分类角标，默认 `PLUGIN` |
| `hiddenByDefault` | boolean | 新添加时默认隐藏 |
| `minW` / `maxW` / `minH` / `maxH` | number | 拖拽缩放的尺寸边界（像素） |
| `icon` | string | 模块库图标 data URL（PNG / JPEG / WebP / SVG），建议 ≤ 32 KB |
| `options` | array | 选项 schema |
| `onPointer` | function | 编辑模式下的鼠标交互回调，见 5.5 |
| `draw` | function | Canvas2D 绘制函数 |

### 绘制函数

```js
draw(ctx, mod, body, frame, state, env)
```

- `ctx`：Canvas2D 上下文。
- `mod`：模块实例，包含 `type`、`options`、`opacity`、`w`、`h` 等。
- `body`：`{ x, y, w, h, accent }` 内容区域，已裁剪。
- `frame`：音频分析帧：
  - `tdL`、`tdR`：时域 Float32Array
  - `freqL`、`freqR`：dB 频谱
  - `rms`、`peak`、`low`、`mid`、`high`
  - `beatPulse`、`beatPhase`、`bpm`、`energy`
  - `sampleRate`、`binCount`、`time`、`playing`
- `state`：该模块的持久绘制状态对象，可用于缓存。
- `env`：`{ settings, palette, ... }`。

### 选项 schema

```js
{ key, label, type, default, min, max, step, unit, options, maxLength, rows, placeholder, text, onPress }
```

支持的 `type`：

| 类型 | 说明 |
| --- | --- |
| `range` / `number` | 数值，`min` / `max` / `step` 生效 |
| `toggle` | 布尔开关 |
| `select` | 下拉；`options` 可以是数组 `[[value, label], ...]`，也可以是函数 `(mod, app) => 数组`（每次渲染时求值） |
| `color` | 颜色（含透明度约定与内置模块一致） |
| `text` | 单行文本，`maxLength` 默认 80 |
| `password` | 掩码文本，带「显示 / 隐藏」；仅用于防窥，值仍会写入工程选项——敏感数据请用 `context.settings` |
| `textarea` | 多行文本，`maxLength` 默认 2000，`rows` 默认 3 |
| `image` | 文件选择器，图片压缩后存资源区，选项中是资源引用 id；用 `context.assets.image(ref)` 取图像 |
| `button` | 仅显示按钮，不保存值；`onPress({ mod, options, setOption, toast, app })` 在点击时调用 |

选项值会随模块写入 `.NEON` 存档；插件级配置请用 `context.settings`，不会进入存档。

读取示例：

```js
const rings = Number(mod.options?.rings ?? 5);
const accent = body.accent;
```

## 6. 安装来源

### GitHub

输入：

```text
owner/Tatsukini-Neon-Example
https://github.com/owner/Tatsukini-Neon-Example
github:owner/Tatsukini-Neon-Example
```

加载器通过 GitHub API 读取默认分支，然后从：

```text
https://raw.githubusercontent.com/<owner>/<repo>/<branch>/plugin.json
https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<entry>
```

下载。

### PNPM / npm 包

输入：

```text
Tatsukini-Neon-Example
pnpm:Tatsukini-Neon-Example
```

加载器通过 npm registry 读取最新版本，再从 unpkg 读取：

```text
https://unpkg.com/<package>@<version>/plugin.json
https://unpkg.com/<package>@<version>/<entry>
```

当前只支持无 scope 的包名。

## 7. 版本与兼容

- `apiVersion` 必须为 `1`。
- 插件应自行检查 `context.plugin.version` 和 `context.apiVersion`。
- 升级入口 API 时会提升 `apiVersion`；旧插件不会被静默加载。

## 8. 安全与限制

- 插件是远程 JavaScript，默认拥有页面权限；只安装可信来源。`permissions` 只影响宿主提供的 API，不构成沙箱。
- 不在插件中读取或上传用户工程、音频、MIDI 等私有数据，除非明确说明。
- 密钥等敏感值请放在 `context.settings`（本机、不进工程存档）；不要放在模块选项里。
- 网络代理只放行公网 http(s)，拒绝 localhost / 内网地址，单次响应上限 5 MB；不要依赖它访问本机服务。
- 不要依赖相对路径 import；请打包为单文件 ESM。
- 不要阻塞主线程；重计算请分帧或使用 Worker。`onPointer` 在拖拽过程中调用，必须尽快返回。
- 插件绘制函数应避免每帧创建大量 Canvas / gradient 对象。

## 9. 完整示例

`index.js`：

```js
export function activate(context) {
  context.registerModule({
    id: 'pulse-bar',
    name: '插件脉冲条',
    code: 'PLUGIN PULSE',
    glyph: '│',
    about: 'A minimal plugin module.',
    w: 320,
    h: 180,
    category: 'PLUGIN',
    options: [
      { key: 'gain', label: '增益', type: 'range', min: 50, max: 200, step: 5, default: 100, unit: '%' }
    ],
    draw(ctx, mod, body, frame) {
      const gain = Number(mod.options?.gain ?? 100) / 100;
      const level = Math.min(1, (frame.rms || 0) * 3 * gain);
      ctx.fillStyle = body.accent;
      ctx.fillRect(body.x + 8, body.y + body.h - level * body.h, body.w - 16, level * body.h);
    }
  });
}
```

## 10. 发布检查清单

- [ ] 仓库 / 包名以 `Tatsukini-Neon-` 开头
- [ ] `plugin.json` 合法且 `apiVersion: 1`
- [ ] 入口是单文件 ESM，导出 `activate`
- [ ] 模块 `draw` 不抛异常
- [ ] 停用 / 卸载后能释放定时器和监听
- [ ] README 说明插件用途、权限与数据访问
