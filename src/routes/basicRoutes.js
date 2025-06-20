import { getCacheHeaders } from '../Cache.js';
import { logBuffer, calculateUptime, formatEstablishTime } from '../utils.js';

export default function basicRoutes(app, config, START_TIME, homepage, favicon, configHtml, CONFIG_ENDPOINT, maxAgeSeconds, cacheHeaders) {
  app.get(CONFIG_ENDPOINT, (req, res) => {
    const uptime = Date.now() - START_TIME.getTime();
    const uptimeHours = Math.floor(uptime / (1000 * 60 * 60));
    const uptimeMinutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));
    const configInfo = {
      服务状态: "运行中",
      版本信息: "v1.0",
      运行时间: calculateUptime(config.establishTime),
      建站时间: formatEstablishTime(config.establishTime),
      缓存时间: `${Math.floor(maxAgeSeconds / 86400)}天`,
      服务配置: {
        服务名称: config.title,
        服务描述: config.description,
        页脚信息: config.footer
      },
      代理服务器: config.httpProxy?.enabled ? {
        启用状态: "已启用",
        代理地址: `${config.httpProxy.address}${config.httpProxy.port ? ':' + config.httpProxy.port : ''}`,
        认证信息: config.httpProxy.username ? "已配置" : "未配置"
      } : {
        启用状态: "未启用"
      },
      代理配置: config.proxies
        .filter(proxy => proxy.visible !== false)
        .map(proxy => ({
          代理路径: proxy.prefix,
          目标地址: proxy.target,
          代理说明: proxy.description || "未提供描述",
          重定向模板: proxy.rawRedirect || "使用默认目标URL",
          使用代理: proxy.useProxy !== false ? "是" : "否",
          使用示例: {
            代理访问: `${req.protocol}://${req.get('host')}${proxy.prefix}`,
            直接重定向: `${req.protocol}://${req.get('host')}${proxy.prefix}?raw=true`
          }
        }))
    };
    return res.set({
      'Content-Type': 'application/json; charset=utf-8',
      ...getCacheHeaders(maxAgeSeconds)
    }).send(JSON.stringify(configInfo, null, 2));
  });
  app.get('/favicon.ico', (req, res) => {
    if (!favicon) return res.status(404).send("Not Found");
    res.set({ ...cacheHeaders, "Content-Type": "image/x-icon" }).send(favicon);
  });
  app.get('/', (req, res) => {
    if (!homepage) return res.status(503).send("Service Unavailable");
    res.set({ ...cacheHeaders, "Content-Type": "text/html; charset=utf-8" }).send(homepage);
  });
  app.get('/logs', (req, res) => {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(logBuffer.join('\n'));
  });
}
