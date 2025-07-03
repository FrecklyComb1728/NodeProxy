import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadConfig } from './src/utils.js';
import { loadStatics } from './src/utils.js';
import { logBuffer } from './src/utils.js';
import { calculateUptime, formatEstablishTime } from './src/utils.js';
import Cache, { parseTime, getCacheHeaders } from './src/Cache.js';
import basicRoutes from './src/routes/basicRoutes.js';
import proxyRoute from './src/routes/proxyRoute.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FAVICON_PATH = join(__dirname, "public", "favicon.ico");
const INDEX_FILE = join(__dirname, "public", "index.html");
const CONFIG_FILE = join(__dirname, "index_config.json");
const CONFIG_ENDPOINT = "/list";
const app = express();

app.use('/assets', express.static(join(__dirname, 'public', 'assets')));

const fallbackConfig = {
  title: "MIFENG CDN代理服务",
  description: "高性能多源CDN代理解决方案",
  footer: "© 2025 Mifeng CDN服务 | 提供稳定快速的资源访问",
  proxies: []
};
const config = await loadConfig(CONFIG_FILE, fallbackConfig);
const [homepage, configHtml, favicon] = await loadStatics({
  index: INDEX_FILE,
  favicon: FAVICON_PATH
});
const START_TIME = new Date();
const maxAgeSeconds = config.cache?.maxTime ? parseTime(config.cache.maxTime) : 86400;
const cacheHeaders = getCacheHeaders(maxAgeSeconds);
const imageCache = new Cache(config);

basicRoutes(app, config, START_TIME, homepage, favicon, configHtml, CONFIG_ENDPOINT, maxAgeSeconds, cacheHeaders);
proxyRoute(app, config, cacheHeaders, imageCache);

if (process.env.VERCEL !== '1') {
    const PORT = process.env.PORT || config.port || 3000;
    try {
        const server = app.listen(PORT, () => {
            const host = config.host || 'localhost';
            const cacheEnabled = config.cache?.enabled !== false;
            const minSize = config.cache?.minSize || '5MB';
            const cacheTime = config.cache?.maxTime || '86400S';
            const cacheDays = Math.floor(parseInt(cacheTime) / 86400);
            const imageTypes = (config.cache?.imageTypes || []).join(', ');
            const proxies = config.proxies || [];
            const establishTimeStr = formatEstablishTime(config.establishTime);
            const uptimeStr = calculateUptime(config.establishTime);
            const cacheConfig = imageCache.getCacheConfig();
            const dnsEnabled = config.dns?.enabled === true;
            const dnsServers = config.dns?.servers || [];
            
            console.log('================= MIFENG CDN代理服务 启动信息 =================');
            console.log(`服务名称: ${config.title}`);
            console.log(`服务描述: ${config.description}`);
            console.log(`页脚信息: ${config.footer}`);
            console.log(`监听地址: http://${host}:${PORT}`);
            console.log(`缓存类型: ${cacheConfig.type === 'disk' ? '硬盘缓存' : '内存缓存'}`);
            console.log(`缓存启用: ${cacheEnabled ? '是' : '否'}`);
            console.log(`最小缓存大小: ${minSize}`);
            console.log(`最大缓存大小: ${cacheConfig.maxSize}`);
            console.log(`缓存时间: ${cacheDays}天`);
            console.log(`支持图片类型: ${imageTypes}`);
            console.log(`DNS解析: ${dnsEnabled ? '启用' : '禁用'}`);
            if (dnsEnabled) {
                console.log(`DNS服务器: ${dnsServers.join(', ')}`);
                console.log(`DNS缓存: ${config.dns?.cacheEnabled !== false ? '启用' : '禁用'}`);
                console.log(`DNS缓存时间: ${config.dns?.cacheTTL || 3600}秒`);
            }
            console.log(`全局代理: ${config.httpProxy?.enabled ? '启用' : '禁用'}`);
            if (config.httpProxy?.enabled) {
              const proxyAddress = config.httpProxy.address + (config.httpProxy.port ? `:${config.httpProxy.port}` : '');
              console.log(`代理地址: ${proxyAddress}`);
              console.log(`代理认证: ${config.httpProxy.username ? '已配置' : '未配置'}`);
            }
            console.log('代理配置:');
            proxies.forEach(proxy => {
              console.log(`  - 路径: ${proxy.prefix} 目标: ${proxy.target} 可见: ${proxy.visible !== false ? '是' : '否'} 使用代理: ${proxy.useProxy !== false ? '是' : '否'} 描述: ${proxy.description || '无'}`);
            });
            console.log(`建站时间: ${establishTimeStr}`);
            console.log(`已运行: ${uptimeStr}`);
            console.log('============================================================');
        });
    } catch (error) {
        console.error('服务器启动失败:', error);
        process.exit(1);
    }
}

export default app;
