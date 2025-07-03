# Node.js版本的图片代理服务

这是使用Node.js实现的图片代理服务版本。

## 安装依赖

```bash
npm install
```

## 运行服务

开发模式（使用nodemon自动重启）：
```bash
npm run dev
```

生产模式：
```bash
npm start
```

## 配置

- 配置文件位于 `index_config.json`，共享主配置文件。
- 🔴 <span style="color:red">**不知道怎么配置看[这里](./docs/config.md)**</span> 🔴
- 🗂️ 了解缓存系统的实现原理看[这里](./docs/cache.md)
- 🔍 了解DNS解析功能使用方法看[这里](./docs/dns.md)

## 特性

- Express.js框架
- 文件缓存支持
- 自定义DNS解析支持
- 灵活的代理规则配置
- 支持多个CDN源
- HTML和JSON格式的配置查看界面
- 路径别名支持，一个代理可以通过多个路径访问

## 路径别名使用

在`index_config.json`的代理配置中，可以为每个代理设置别名：

```json
{
  "prefix": "/oss/",
  "aliases": ["/img/", "/images/"],
  "target": "https://your-cdn-url.com/path/",
  ...
}
```

通过这种方式，不仅可以通过`/oss/image.png`访问图片，还可以使用`/img/image.png`或`/images/image.png`访问相同的资源。

## DNS解析功能

本服务支持自定义DNS解析，可以指定特定的DNS服务器来解析目标域名，这对于提高访问速度或绕过某些网络限制非常有用。

```json
{
  "dns": {
    "enabled": true,
    "servers": ["8.8.8.8", "1.1.1.1"],
    "cacheEnabled": true
  }
}
```

详细配置说明见 [DNS解析文档](./docs/dns.md)。

