import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import https from 'node:https';
import DnsResolver from '../DnsResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKER_PATH = join(__dirname, 'Download.js');

const ipCache = new Map();
const workerPool = new Map();
const MAX_WORKERS = 8;
let dnsResolver = null;

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

function downloadWithWorker(url, proxyConfig, res = null, headers = null) {
    return new Promise((resolve, reject) => {
        const workerInfo = getWorker();
        if (!workerInfo) {
            console.log(`[下载] 工作线程已满，使用主线程下载: ${url}`);
            downloadInMainThread(url, proxyConfig, res, headers).then(resolve).catch(reject);
            return;
        }

        const { worker, id } = workerInfo;
        const timeout = setTimeout(() => {
            workerPool.get(id).busy = false;
            reject(new Error('Download timeout'));
        }, 30000);

        // 如果提供了响应对象，则使用流式传输
        const streamMode = !!res;
        let streamStarted = false;
        let headersSent = false; // 跟踪响应头是否已发送
        let bufferChunks = [];
        
        worker.on('message', (result) => {
            if (result.error) {
                clearTimeout(timeout);
                workerPool.get(id).busy = false;
                reject(new Error(result.error));
                return;
            }
            
            // 处理流式传输开始
            if (result.streamStart) {
                clearTimeout(timeout); // 清除超时，因为我们现在将通过流处理
                streamStarted = true;
                
                // 只有在响应头未发送时才设置响应头
                if (res && !headersSent && !res.headersSent) {
                    try {
                        // 确保只设置一次响应头
                        headersSent = true;
                        res.status(result.status);
                        // 设置所有响应头，包括Content-Type和缓存头
                        res.set('Content-Type', result.contentType);
                        if (headers) {
                            res.set(headers);
                        }
                        if (result.contentLength) {
                            res.set('Content-Length', result.contentLength);
                        }
                        // 开始发送响应
                        res.flushHeaders();
                    } catch (err) {
                        console.error('[错误] 设置响应头失败:', err.message);
                    }
                }
                return;
            }
            
            // 处理流式数据块
            if (result.streamChunk && streamStarted) {
                if (res) {
                    // 直接发送到客户端
                    res.write(result.chunk);
                } else {
                    // 如果没有响应对象，则收集块以便稍后处理
                    bufferChunks.push(result.chunk);
                }
                return;
            }
            
            // 处理流结束
            if (result.streamEnd && streamStarted) {
                workerPool.get(id).busy = false;
                
                if (res) {
                    // 结束响应
                    res.end();
                    resolve({ streamed: true });
                } else {
                    // 合并所有块并解析
                    const buffer = Buffer.concat(bufferChunks);
                    resolve({ 
                        buffer, 
                        contentType: result.contentType, 
                        status: result.status 
                    });
                }
                return;
            }
            
            // 处理非流式响应（完整缓冲区）
            if (result.buffer) {
                clearTimeout(timeout);
                workerPool.get(id).busy = false;
                resolve(result);
                return;
            }
        });

        worker.postMessage({ 
            url, 
            proxyConfig,
            dnsConfig: dnsResolver?.enabled ? {
                enabled: true,
                servers: dnsResolver.servers
            } : null,
            streamMode
        });
    });
}

async function downloadInMainThread(url, proxyConfig, res = null, headers = null) {
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

    // 使用自定义DNS解析（如果启用）
    if (dnsResolver?.enabled) {
        const urlObj = new URL(url);
        const ip = await dnsResolver.resolve(urlObj.hostname);
        if (ip) {
            // 保持原始主机名，但使用解析的IP
            const originalHost = urlObj.host;
            urlObj.host = ip;
            options.headers = options.headers || {};
            options.headers['Host'] = originalHost;
            url = urlObj.toString();
            console.log(`[DNS] 使用自定义DNS解析，${originalHost} -> ${ip}`);
        }
    }

    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // 如果提供了响应对象，则使用流式传输
    if (res) {
        res.status(response.status);
        res.set('Content-Type', response.headers.get('content-type'));
        
        // 设置缓存头
        if (headers) {
            res.set(headers);
        }
        
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            res.set('Content-Length', contentLength);
        }
        
        // 将响应流直接传输到客户端
        response.body.pipe(res);
        
        // 返回一个Promise，当流完成时解析
        return new Promise((resolve, reject) => {
            response.body.on('end', () => {
                resolve({ streamed: true });
            });
            
            response.body.on('error', (err) => {
                reject(err);
            });
        });
    }
    
    // 如果没有响应对象，则返回完整缓冲区
    const buffer = await response.buffer();
    return {
        buffer,
        contentType: response.headers.get('content-type'),
        status: response.status
    };
}

export default function proxyRoute(app, config, cacheHeaders, imageCache) {
    // 初始化DNS解析器
    if (config.dns?.enabled) {
        dnsResolver = new DnsResolver(config.dns);
    }
    
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
            let matchedPath = '';

            for (const proxy of config.proxies) {
                if (req.path.startsWith(proxy.prefix)) {
                    proxyConfig = proxy;
                    matchedPath = proxy.prefix;
                    basePath = req.path.slice(proxy.prefix.length);
                    console.log(`[代理] 通过主路径匹配: ${proxy.prefix}`);
                    break;
                }
                
                if (proxy.aliases && Array.isArray(proxy.aliases)) {
                    for (const alias of proxy.aliases) {
                        if (req.path.startsWith(alias)) {
                            proxyConfig = proxy;
                            matchedPath = alias;
                            basePath = req.path.slice(alias.length);
                            console.log(`[代理] 通过别名匹配: ${alias} -> ${proxy.prefix}`);
                            break;
                        }
                    }
                    if (proxyConfig) break;
                }
            }

            if (!proxyConfig) {
                console.log(`[输出] 未匹配到代理，返回404`);
                res.status(404).send('Not Found');
                return;
            }
            const sanitizedPath = basePath.replace(/^[\/]+/, "").replace(/\|/g, "").replace(/[\/]+/g, "/");
            const targetUrl = new URL(sanitizedPath, proxyConfig.target);
            
            Object.entries(req.query).forEach(([key, value]) => {
                if (key !== "raw") {
                    targetUrl.searchParams.append(key, value);
                }
            });
            
            console.log(`[代理] 目标URL: ${targetUrl}`);
            if (req.query.raw === "true") {
                let redirectUrl;
                if (proxyConfig.rawRedirect) {
                    redirectUrl = proxyConfig.rawRedirect.replace("{path}", sanitizedPath);
                    
                    const params = new URLSearchParams();
                    Object.entries(req.query).forEach(([key, value]) => {
                        if (key !== "raw") params.append(key, value);
                    });
                    if (params.toString()) {
                        redirectUrl += (redirectUrl.includes('?') ? '&' : '?') + params.toString();
                    }
                } else {
                    redirectUrl = targetUrl.toString();
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
                    const ext = req.path.split('.').pop()?.toLowerCase() || '';
                    const useStreaming = config.streaming?.enabled !== false;
                    
                    // 检查是否应该使用流式传输
                    if (useStreaming) {
                        console.log(`[代理] 使用流式传输: ${targetUrl}`);
                        // 注意：不在这里设置cacheHeaders，而是在worker消息处理中设置
                        
                        // 直接将响应流式传输到客户端
                        const result = await downloadWithWorker(targetUrl.toString(), proxySettings, res, cacheHeaders);
                        
                        // 如果是大文件且可缓存，在后台异步缓存
                        if (result.buffer && config.cache?.enabled && imageCache.isCacheable(ext, result.buffer.length)) {
                            console.log(`[缓存] 后台存储 ${req.path} (${imageCache.formatSize(result.buffer.length)})`);                            imageCache.set(req, result.buffer, result.contentType).catch(err => {
                                console.error(`[缓存] 存储失败: ${err.message}`);
                            });
                        }
                    } else {
                        // 使用传统方式下载完整文件
                        const result = await downloadWithWorker(targetUrl.toString(), proxySettings);
                        let { buffer, contentType, status } = result;
                        if (!(buffer instanceof Buffer)) {
                            buffer = Buffer.from(buffer);
                        }

                        if (config.cache?.enabled && imageCache.isCacheable(ext, buffer.length)) {
                            console.log(`[缓存] 存储 ${req.path} (${imageCache.formatSize(buffer.length)})`);                            await imageCache.set(req, buffer, contentType);
                        }

                        res.set("Content-Type", contentType);
                        res.set(cacheHeaders);
                        res.end(buffer);
                    }
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
