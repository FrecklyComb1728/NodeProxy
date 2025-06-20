import { parentPort } from 'worker_threads';
import fetch from 'node-fetch';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const agent = new https.Agent({
    rejectUnauthorized: false
});

async function downloadWithProxy(url, proxyConfig) {
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

parentPort.on('message', async ({ url, proxyConfig }) => {
    try {
        const result = await downloadWithProxy(url, proxyConfig);
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
