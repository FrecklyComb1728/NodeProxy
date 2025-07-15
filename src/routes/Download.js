import { parentPort } from 'worker_threads';
import fetch from 'node-fetch';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dns from 'node:dns';
import { promisify } from 'util';
import { Readable } from 'stream';

const agent = new https.Agent({
    rejectUnauthorized: false
});

const lookup = promisify(dns.lookup);

async function resolveHostname(hostname, dnsServers) {
    if (!dnsServers || !Array.isArray(dnsServers) || dnsServers.length === 0) {
        return null;
    }

    try {
        const result = await lookup(hostname);
        return result.address;
    } catch (error) {
        console.error(`[下载] DNS解析失败: ${hostname}, ${error.message}`);
        return null;
    }
}

async function downloadWithProxy(url, proxyConfig, dnsConfig, streamMode = false) {
    try {
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

        // DNS解析处理
        if (dnsConfig?.enabled) {
            const urlObj = new URL(url);
            const ip = await resolveHostname(urlObj.hostname, dnsConfig.servers);
            
            if (ip) {
                const originalHost = urlObj.host;
                urlObj.host = ip;
                options.headers = options.headers || {};
                options.headers['Host'] = originalHost;
                url = urlObj.toString();
            }
        }

        const response = await fetch(url, options);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // 流式模式直接返回响应对象
        if (streamMode) {
            return { 
                stream: response.body,
                contentType: response.headers.get('content-type'),
                status: response.status,
                contentLength: response.headers.get('content-length')
            };
        }
        
        // 非流式模式返回完整缓冲区
        const buffer = await response.buffer();
        const contentType = response.headers.get('content-type');
        
        return { buffer, contentType, status: response.status };
    } catch (error) {
        parentPort.postMessage({ error: error.message });
        return null;
    }
}

parentPort.on('message', async ({ url, proxyConfig, dnsConfig, streamMode }) => {
    try {
        const result = await downloadWithProxy(url, proxyConfig, dnsConfig, streamMode);
        if (!result) return;
        
        if (streamMode && result.stream) {
            // 流式模式下，先发送头部信息
            parentPort.postMessage({
                streamStart: true,
                contentType: result.contentType,
                status: result.status,
                contentLength: result.contentLength
            });
            
            // 设置流数据处理
            // node-fetch v2.7.0 返回的是Node.js的PassThrough流，不是Web标准流
            // 所以不需要使用Readable.fromWeb转换
            const stream = result.stream;
            const chunkSize = 64 * 1024; // 64KB 块大小
            
            stream.on('data', (chunk) => {
                // 发送数据块
                parentPort.postMessage({
                    streamChunk: true,
                    chunk: chunk
                }, [chunk.buffer]);
            });
            
            stream.on('end', () => {
                // 发送流结束信号
                parentPort.postMessage({ streamEnd: true });
            });
            
            stream.on('error', (err) => {
                parentPort.postMessage({ error: err.message });
            });
        } else if (result.buffer) {
            // 非流式模式，发送完整缓冲区
            parentPort.postMessage({
                buffer: result.buffer,
                contentType: result.contentType,
                status: result.status
            }, [result.buffer.buffer]);
        }
    } catch (error) {
        parentPort.postMessage({ error: error.message });
    }
});
