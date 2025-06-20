import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import https from 'node:https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKER_PATH = join(__dirname, 'Download.js');

const ipCache = new Map();
const workerPool = new Map();
const MAX_WORKERS = 8;

function getWorker() {
    for (const [id, worker] of workerPool.entries()) {
        if (!worker.busy) {
            worker.busy = true;
            return { worker: worker.worker, id };
        }
    }

    if (workerPool.size < MAX_WORKERS) {
        const id = workerPool.size;
        const worker = new Worker(WORKER_PATH);
        workerPool.set(id, { worker, busy: true });
        return { worker, id };
    }

    return null;
}

function downloadWithWorker(url, proxyConfig) {
    return new Promise((resolve, reject) => {
        const workerInfo = getWorker();
        if (!workerInfo) {
            console.log(`[下载] 工作线程已满，使用主线程下载: ${url}`);
            downloadInMainThread(url, proxyConfig).then(resolve).catch(reject);
            return;
        }

        const { worker, id } = workerInfo;
        const timeout = setTimeout(() => {
            workerPool.get(id).busy = false;
            reject(new Error('Download timeout'));
        }, 30000);

        worker.once('message', (result) => {
            clearTimeout(timeout);
            workerPool.get(id).busy = false;
            
            if (result.error) {
                reject(new Error(result.error));
            } else {
                resolve(result);
            }
        });

        worker.postMessage({ url, proxyConfig });
    });
}

async function downloadInMainThread(url, proxyConfig) {
    const agent = new https.Agent({
        rejectUnauthorized: false
    });

    const options = {
        agent,
        timeout: 30000
    };

    if (proxyConfig?.enabled) {
        const proxyUrl = `http://${proxyConfig.address}${proxyConfig.port ? `:${proxyConfig.port}` : ''}`;
        options.agent = new HttpsProxyAgent(proxyUrl);
        
        if (proxyConfig.username && proxyConfig.password) {
            options.headers = {
                'Proxy-Authorization': 'Basic ' + Buffer.from(`${proxyConfig.username}:${proxyConfig.password}`).toString('base64')
            };
        }
    }

    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const buffer = await response.buffer();
    return {
        buffer,
        contentType: response.headers.get('content-type'),
        status: response.status
    };
}

export default function proxyRoute(app, config, cacheHeaders, imageCache) {
    function cleanupWorkers() {
        for (const [id, { worker }] of workerPool.entries()) {
            worker.terminate();
        }
        workerPool.clear();
    }

    process.on('exit', cleanupWorkers);
    process.on('SIGINT', () => {
        cleanupWorkers();
        process.exit(0);
    });

    app.use(async (req, res) => {
        try {
            const ip = getClientIp(req);
            await getIpLocation(ip).then(ipInfo => {
                if (ipInfo) {
                    console.log(`[请求]————————————————————————`);
                    console.log(`|- IP：${ipInfo.ip}`);
                    console.log(`|- 国家：${ipInfo.country || '未知'}`);
                    console.log(`|- 地区：${ipInfo.prov || ''}${ipInfo.city || ''}${ipInfo.area || ''}`);
                    console.log(`|- ISP：${ipInfo.isp || '未知'}`);
                }
            }).catch(err => {
                console.log(`[IP查询] 获取IP信息失败: ${err.message}`);
            });
            
            console.log(`[请求] 路径: ${req.path}, 原始URL: ${req.originalUrl}, 方法: ${req.method}`);
            let proxyConfig = null;
            let basePath = req.path;
            for (const proxy of config.proxies) {
                if (req.path.startsWith(proxy.prefix)) {
                    proxyConfig = proxy;
                    basePath = req.path.slice(proxy.prefix.length);
                    break;
                }
            }
            if (!proxyConfig) {
                console.log(`[输出] 未匹配到代理，返回404`);
                res.status(404).send('Not Found');
                return;
            }
            const sanitizedPath = basePath.replace(/^[\/]+/, "").replace(/\|/g, "").replace(/[\/]+/g, "/");
            const targetUrl = new URL(sanitizedPath, proxyConfig.target);
            console.log(`[代理] 目标URL: ${targetUrl}`);
            if (req.query.raw === "true") {
                let redirectUrl;
                if (proxyConfig.rawRedirect) {
                    redirectUrl = proxyConfig.rawRedirect.replace("{path}", sanitizedPath);
                } else {
                    redirectUrl = targetUrl.toString();
                }
                const params = new URLSearchParams();
                Object.entries(req.query).forEach(([key, value]) => {
                    if (key !== "raw") params.append(key, value);
                });
                if (params.toString()) {
                    redirectUrl += (redirectUrl.includes('?') ? '&' : '?') + params.toString();
                }
                return res.redirect(302, redirectUrl);
            } else {
                const cachedImage = await imageCache.get(req);
                if (cachedImage) {
                    console.log(`[缓存] 命中 ${req.path} (${imageCache.formatSize(cachedImage.data.length)})`);
                    res.set("Content-Type", cachedImage.contentType);
                    res.set(cacheHeaders);
                    res.send(cachedImage.data);
                    return;
                }

                console.log(`[代理] 开始下载: ${targetUrl}`);
                const useProxy = proxyConfig.useProxy !== false && config.httpProxy?.enabled;
                const proxySettings = useProxy ? config.httpProxy : null;

                try {
                    const result = await downloadWithWorker(targetUrl.toString(), proxySettings);
                    let { buffer, contentType, status } = result;
                    if (!(buffer instanceof Buffer)) {
                        buffer = Buffer.from(buffer);
                    }
                    const ext = req.path.split('.').pop()?.toLowerCase() || '';

                    if (config.cache?.enabled && imageCache.isCacheable(ext, buffer.length)) {
                        console.log(`[缓存] 存储 ${req.path} (${imageCache.formatSize(buffer.length)})`);
                        await imageCache.set(req, buffer, contentType);
                    }

                    res.set("Content-Type", contentType);
                    res.set(cacheHeaders);
                    res.end(buffer);

                } catch (error) {
                    console.error(`[错误] 下载失败: ${error.message}`);
                    res.status(500).send('Internal Server Error');
                }
            }
        } catch (error) {
            console.error(`[错误] 代理请求失败: ${error.message}`);
            res.status(500).send('Internal Server Error');
        }
    });
}

function shouldUseProxy(config, proxyConfig) {
  if (!config.httpProxy || !config.httpProxy.enabled) {
    return false;
  }

  if (proxyConfig.useProxy === true) {
    return true;
  }

  return false; 
}

function buildProxyUrl(proxyConfig) {
  if (!proxyConfig || !proxyConfig.enabled || !proxyConfig.address) {
    return null;
  }
  
  let proxyUrl = 'http://';

  if (proxyConfig.username && proxyConfig.password) {
    proxyUrl += `${encodeURIComponent(proxyConfig.username)}:${encodeURIComponent(proxyConfig.password)}@`;
  }
  
  proxyUrl += proxyConfig.address;

  if (proxyConfig.port) {
    proxyUrl += `:${proxyConfig.port}`;
  }
  
  return proxyUrl;
}

function hideProxyCredentials(proxyUrl) {
  if (!proxyUrl) return '';
  return proxyUrl.replace(/(http:\/\/)(.*?):(.*?)@/, '$1****:****@');
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
         req.headers['x-real-ip'] || 
         req.connection.remoteAddress?.replace('::ffff:', '') ||
         req.socket.remoteAddress || 
         req.connection.socket?.remoteAddress ||
         '127.0.0.1';
}

async function getIpLocation(ip) {
  if (ipCache.has(ip)) {
    return ipCache.get(ip);
  }
  
  try {
    const response = await fetch(`https://ip9.com.cn/get?ip=${ip}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`API返回错误状态: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.ret !== 200 || !data.data) {
      throw new Error('API返回数据格式错误');
    }
    
    ipCache.set(ip, data.data);
    
    if (ipCache.size > 1000) {
      const firstKey = ipCache.keys().next().value;
      ipCache.delete(firstKey);
    }
    
    return data.data;
  } catch (error) {
    console.error(`获取IP信息失败: ${error.message}`);
    return null;
  }
}
