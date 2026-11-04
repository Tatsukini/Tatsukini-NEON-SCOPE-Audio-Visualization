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

## 5. context API

```ts
interface PluginContext {
  apiVersion: 1;
  app: 'NEON//SCOPE';
  plugin: { id: string; name: string; version: string };
  registerModule(spec: ModuleSpec): void;
  log(...args: unknown[]): void;
  toast(message: string, tone?: 'info' | 'success' | 'error'): void;
}
```

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
| `options` | array | 与内置模块相同的选项 schema |
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

与内置模块一致：

```js
{ key, label, type, default, min, max, step, unit, options }
```

类型：`range`、`toggle`、`select`、`color`、`text`。
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

- 插件是远程 JavaScript，默认拥有页面权限；只安装可信来源。
- 不在插件中读取或上传用户工程、音频、MIDI 等私有数据，除非明确说明。
- 不要依赖相对路径 import；请打包为单文件 ESM。
- 不要阻塞主线程；重计算请分帧或使用 Worker。
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
