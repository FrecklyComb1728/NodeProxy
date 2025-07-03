import dnsSocket from 'dns-socket';
import { promisify } from 'util';
import dns from 'node:dns';

class DnsResolver {
    constructor(config = {}) {
        this.enabled = config.enabled === true;
        this.servers = config.servers || ['223.5.5.5', '114.114.114.114'];
        this.timeout = config.timeout || 5000;
        this.cacheEnabled = config.cacheEnabled !== false;
        this.cacheTTL = config.cacheTTL || 3600;
        this.dnsCache = new Map();
        this.lookup = promisify(dns.lookup);
        
        console.log(`[DNS] DNS解析器初始化，状态: ${this.enabled ? '启用' : '禁用'}`);
        if (this.enabled) {
            console.log(`[DNS] 使用服务器: ${this.servers.join(', ')}`);
            console.log(`[DNS] 缓存状态: ${this.cacheEnabled ? '启用' : '禁用'}`);
        }
    }
    
    async resolve(hostname) {
        if (!this.enabled) {
            return null;
        }
        
        try {
            if (this.cacheEnabled) {
                const cached = this.getFromCache(hostname);
                if (cached) {
                    console.log(`[DNS] 缓存命中: ${hostname} -> ${cached.ip}`);
                    return cached.ip;
                }
            }
            
            const socket = dnsSocket();
            const serverParts = this.servers[0].split(':');
            const serverHost = serverParts[0];
            const serverPort = serverParts[1] || 53;
            const query = promisify(socket.query.bind(socket));
            const result = await Promise.race([
                query({
                    questions: [{
                        type: 'A',
                        name: hostname
                    }]
                }, serverPort, serverHost),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('DNS查询超时')), this.timeout)
                )
            ]);
            
            socket.destroy();
            
            const answers = result.answers || [];
            if (answers.length > 0) {
                const ip = answers[0].data;
                console.log(`[DNS] 解析成功: ${hostname} -> ${ip}`);
                
                if (this.cacheEnabled) {
                    this.addToCache(hostname, ip);
                }
                
                return ip;
            }
            
            return await this.fallbackResolve(hostname);
            
        } catch (error) {
            console.error(`[DNS] 解析错误: ${hostname}, ${error.message}`);
            return await this.fallbackResolve(hostname);
        }
    }
    
    async fallbackResolve(hostname) {
        try {
            console.log(`[DNS] 使用备用方法解析: ${hostname}`);
            const result = await this.lookup(hostname);
            const ip = result.address;
            
            if (ip && this.cacheEnabled) {
                this.addToCache(hostname, ip);
            }
            
            return ip;
        } catch (error) {
            console.error(`[DNS] 备用解析失败: ${hostname}, ${error.message}`);
            return null;
        }
    }
    
    getFromCache(hostname) {
        if (!this.cacheEnabled) return null;
        
        const cached = this.dnsCache.get(hostname);
        if (!cached) return null;
        
        const now = Date.now();
        if (now - cached.timestamp > this.cacheTTL * 1000) {
            this.dnsCache.delete(hostname);
            return null;
        }
        
        return cached;
    }
    
    addToCache(hostname, ip) {
        if (!this.cacheEnabled) return;
        
        this.dnsCache.set(hostname, {
            ip,
            timestamp: Date.now()
        });
        
        if (this.dnsCache.size > 1000) {
            const oldestKey = this.dnsCache.keys().next().value;
            this.dnsCache.delete(oldestKey);
        }
    }
    
    clearCache() {
        this.dnsCache.clear();
        console.log('[DNS] 缓存已清空');
    }
}

export default DnsResolver; 