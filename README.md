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

## 特性

- Express.js框架
- 文件缓存支持
- 灵活的代理规则配置
- 支持多个CDN源
- HTML和JSON格式的配置查看界面

