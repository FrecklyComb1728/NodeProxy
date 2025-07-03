import { parentPort } from 'worker_threads';
import fetch from 'node-fetch';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import dns from 'node:dns';
import { promisify } from 'util';

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
        console.error(`[下载工作线程] DNS解析失败: ${hostname}, ${error.message}`);
        return null;
    }
}

async function downloadWithProxy(url, proxyConfig, dnsConfig) {
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
        
        const buffer = await response.buffer();
        const contentType = response.headers.get('content-type');
        
        return { buffer, contentType, status: response.status };
    } catch (error) {
        parentPort.postMessage({ error: error.message });
        return null;
    }
}

parentPort.on('message', async ({ url, proxyConfig, dnsConfig }) => {
    try {
        const result = await downloadWithProxy(url, proxyConfig, dnsConfig);
        if (result) {
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
