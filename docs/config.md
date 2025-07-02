# 配置文件说明 

## 基础配置

- `title`: 网站标题，显示在页面和日志中
  - 示例: `"MIFENG CDN代理服务"`

- `description`: 网站描述，显示在页面中
  - 示例: `"高性能多源CDN代理解决方案"`

- `footer`: 网站页脚内容
  - 示例: `"© 2025 Mifeng CDN服务 | 提供稳定快速的资源访问"`

- `establishTime`: 建站时间，格式为`YYYY/MM/DD/HH/MM`
  - 示例: `"2025/01/13/08/00"`

- `port`: 服务监听端口
  - 示例: `6000`

- `host`: 服务监听地址，通常为localhost或服务器IP
  - 示例: `"localhost"`

## 缓存配置 (`cache`)

- `enabled`: 是否启用缓存功能
  - 示例: `true`

- `type`: 缓存类型，可选 "memory" 或 "disk"
  - 示例: `"memory"` (内存缓存) 或 `"disk"` (硬盘缓存)
  - 说明: 内存缓存速度快但重启后丢失，硬盘缓存持久化但速度稍慢

- `maxSize`: 最大缓存大小上限，支持B、KB、MB单位
  - 示例: `"1024MB"` (1GB)

- `diskPath`: 硬盘缓存存储路径，仅在 `type` 为 `"disk"` 时生效
  - 示例: `"./cache"` (相对路径) 或 `"/var/cache/imageproxy"` (绝对路径)

- `minSize`: 最小缓存大小，支持B、KB、MB单位
  - 示例: `"8MB"`

- `maxTime`: 缓存过期时间，单位为秒(S)
  - 示例: `"2678400S"` (31天)

- `imageTypes`: 支持缓存的图片类型列表
  - 示例: `["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]`

## 图片显示配置

- `forceInlineImages`: 是否强制在浏览器中显示大型图片
  - 示例: `true`（强制预览模式）或 `false`（使用源站设置，大图片可能被下载）
  - 说明: 当设置为`true`时，超过10MB的大型图片也会在浏览器中直接预览而不是下载

## HTTP代理配置 (`httpProxy`)

- `enabled`: 是否启用全局代理
  - 示例: `false`

- `address`: 代理服务器地址
  - 示例: `"127.0.0.1"`

- `port`: 代理服务器端口
  - 示例: `7890`

- `username`: 代理服务器用户名（如需验证）
  - 示例: `"user"` 或留空 `""`

- `password`: 代理服务器密码（如需验证）
  - 示例: `"pass"` 或留空 `""`
  
- `rejectUnauthorized`: 是否验证SSL证书（设为false表示忽略证书错误）
  - 示例: `false`（忽略SSL错误）或 `true`（默认，验证证书）

## 代理路径配置 (`proxies`)

每个代理路径配置包含以下字段：

- `prefix`: 路径前缀，用于匹配请求
  - 示例: `"/gh/"`

- `aliases`: 路径别名，用于设置可选的访问路径，数组格式
  - 示例: `["/github/", "/g/"]`
  - 说明: 通过这些别名也可以访问到相同的目标资源，可以设置多个

- `target`: 目标地址
  - 示例: `"https://cdn.statically.io/gh/"`

- `rawRedirect`: raw模式下的重定向地址模板，`{path}`会被实际路径替换
  - 示例: `"https://cdn.jsdmirror.cn/gh/{path}"`

- `description`: 该代理的说明文字
  - 示例: `"statically反代(类jsdelivr静态文件加速)"`

- `visible`: 是否在配置页面显示该代理
  - 示例: `true`

- `useProxy`: 该路径是否使用全局代理
  - 示例: `true`

## 配置示例

```json
{
    "title": "MIFENG CDN代理服务",
    "description": "高性能多源CDN代理解决方案",
    "footer": "© 2025 Mifeng CDN服务 | 提供稳定快速的资源访问",
    "establishTime": "2025/01/13/08/00",
    "port": 3000,
    "cache": {
        "enabled": true,
        "type": "disk",
        "minSize": "8MB",
        "maxTime": "2678400S",
        "maxSize": "1024MB",
        "diskPath": "./cache",
        "imageTypes": ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]
    },
    "host": "localhost",
    "httpProxy": {
        "enabled": true,
        "address": "127.0.0.1",
        "port": 7890,
        "username": "",
        "password": "",
        "rejectUnauthorized": false
    },
    "proxies": [
        {
            "prefix": "/imlazy/",
            "aliases": ["/cdn.imlazy.ink/img/background/", "/https://cdn.imlazy.ink/img/background/"],
            "target": "https://cdn.imlazy.ink:233/img/background/",
            "rawRedirect": "https://cdn.imlazy.ink:233/img/background/{path}",
            "description": "个人图床服务(非本人图床，仅作反代并缓存)",
            "visible": false,
            "useProxy": false
        }
    ]
}
```

## 使用说明

1. **启用全局代理**：
   - 将 `httpProxy.enabled` 设置为 `true`
   - 设置正确的 `address` 和 `port`
   - 如果代理需要认证，设置 `username` 和 `password`

2. **单独控制路径代理**：
   - 对于需要使用代理的路径，设置 `useProxy` 为 `true`
   - 对于不需要使用代理的路径，设置 `useProxy` 为 `false`

3. **禁用特定路径**：
   - 如果不希望在前端页面显示某个代理路径，设置 `visible` 为 `false`

4. **缓存配置**：
   - 可以通过 `type` 选择使用内存缓存 `memory` 或硬盘缓存 `disk`
   - 硬盘缓存支持重启后保留缓存内容，但速度稍慢，可通过 `diskPath` 指定存储位置
   - 对于空间受限或大量图片的场景，推荐使用硬盘缓存
   - 缓存过期时间 `maxTime` 单位为秒，例如31天为 `"2678400S"`
   - 支持的图片类型在 `imageTypes` 数组中定义

5. **SSL证书验证问题**：
   - 🔴 如遇到SSL证书错误，设置 `httpProxy.rejectUnauthorized` 为 `false` 来忽略证书验证
   - <span style="color:red">**⚠️ 注意：禁用SSL证书验证会降低安全性，只应在信任的环境中使用**</span> 

6. **路径别名使用**：
   - 通过设置 `aliases` 数组，可以为一个代理路径配置多个访问路径
   - 例如: 配置 `prefix: "/oss/"` 和 `aliases: ["/img/", "/images/"]`，则可以通过 `/oss/file.jpg`, `/img/file.jpg` 或 `/images/file.jpg` 访问相同的资源
   - 便于设置简短或更直观的URL路径，同时保持原有路径兼容性
   - 别名匹配的优先级低于主前缀(prefix)，所以如果有冲突，会优先匹配主前缀

7. **大图片预览功能**：
   - 设置 `forceInlineImages` 为 `true` 可以强制大型图片(>10MB)在浏览器中预览
   - 解决了GitHub等站点大图片会自动下载而不是预览的问题
   - 如果不想使用此功能，设置为 `false` 将使用源站原始设置