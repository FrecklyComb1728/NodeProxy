import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_MAX_DAYS = 30;
const DEFAULT_MIN_PERCENT = 10;

export function getCacheHeaders(maxAgeSeconds) {
    return {
        "Cache-Control": `public, max-age=${maxAgeSeconds}`,
        "CDN-Cache-Control": `max-age=${maxAgeSeconds}`,
    };
}

function parseSize(sizeStr) {
    if (typeof sizeStr === 'number') return sizeStr;
    const match = sizeStr.match(/^\d+(MB|KB|B)$/i);
    if (!match) throw new Error('大小格式无效，请使用“8MB”、“1024KB”或“1048576B”等格式"');
    const [, size, unit] = sizeStr.match(/^(\d+)(MB|KB|B)$/i);
    const multipliers = { 'B': 1, 'KB': 1024, 'MB': 1024 * 1024 };
    return parseInt(size) * multipliers[unit.toUpperCase()];
}
export function parseTime(timeStr) {
    if (typeof timeStr === 'number') return timeStr;
    const match = timeStr.match(/^(\d+)S$/i);
    if (!match) throw new Error('时间格式无效，使用“86400S”等格式"');
    return parseInt(match[1]) * 1000;
}
function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toFixed(2)}${units[unitIndex]}`;
}
function pathToFileName(pathStr) {
    return crypto.createHash('md5').update(pathStr).digest('hex');
}

class MemoryCache {
    constructor(maxSize) {
        this.cache = new Map();
        this.maxSize = parseSize(maxSize);
        this.currentSize = 0;
    }
    set(key, value, size, maxAge) {
        while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
            const firstKey = this.cache.keys().next().value;
            this.delete(firstKey);
        }
        if (size > this.maxSize) {
            return false;
        }
        const expiresAt = maxAge ? Date.now() + parseTime(maxAge) : null;
        this.cache.set(key, {
            data: value,
            size: size,
            timestamp: Date.now(),
            expiresAt,
            accessCount: 1
        });
        this.currentSize += size;
        return true;
    }
    get(key) {
        const item = this.cache.get(key);
        if (item) {
            if (item.expiresAt && Date.now() > item.expiresAt) {
                this.delete(key);
                return null;
            }
            item.timestamp = Date.now();
            item.accessCount = (item.accessCount || 0) + 1;
            return item.data;
        }
        return null;
    }
    delete(key) {
        const item = this.cache.get(key);
        if (item) {
            this.currentSize -= item.size;
            this.cache.delete(key);
        }
    }
    has(key) {
        if (!this.cache.has(key)) return false;
        const item = this.cache.get(key);
        if (item.expiresAt && Date.now() > item.expiresAt) {
            this.delete(key);
            return false;
        }
        return true;
    }
    getSize() {
        return this.currentSize;
    }
    clear() {
        this.cache.clear();
        this.currentSize = 0;
    }
}

class DiskCache {
    constructor(diskPath, maxSize, options = {}) {
        this.diskPath = diskPath;
        this.maxSize = parseSize(maxSize);
        this.currentSize = 0;
        this.metaCache = new Map();
        this.maxDays = options.maxDays || DEFAULT_MAX_DAYS;
        this.minPercent = options.minPercent || DEFAULT_MIN_PERCENT;
        this.init();
    }
    async init() {
        try {
            await fs.mkdir(this.diskPath, { recursive: true });
            await this.loadCacheInfo();
            console.log(`[缓存] 已初始化，路径: ${this.diskPath}`);
        } catch (error) {
            console.error(`[缓存] 初始化失败: ${error.message}`);
        }
    }
    async loadCacheInfo() {
        try {
            const files = await fs.readdir(this.diskPath);
            const metaFiles = files.filter(file => file.endsWith('.meta'));
            for (const metaFile of metaFiles) {
                try {
                    const metaPath = path.join(this.diskPath, metaFile);
                    const metaContent = await fs.readFile(metaPath, 'utf-8');
                    const metadata = JSON.parse(metaContent);
                    const dataPath = path.join(this.diskPath, metadata.fileName);
                    try {
                        await fs.access(dataPath);
                        if (metadata.expiresAt && Date.now() > metadata.expiresAt) {
                            await this.deleteFile(metadata.key);
                            continue;
                        }
                        this.metaCache.set(metadata.key, metadata);
                        this.currentSize += metadata.size;
                    } catch (err) {
                        await fs.unlink(metaPath).catch(() => {});
                    }
                } catch (err) {
                    console.error(`[缓存] 加载元数据失败: ${metaFile}, ${err.message}`);
                }
            }
            console.log(`[缓存] 已加载 ${this.metaCache.size} 个条目，总大小: ${formatSize(this.currentSize)}`);
        } catch (error) {
            console.error(`[缓存] 加载缓存信息失败: ${error.message}`);
        }
    }
    async set(key, value, size, maxAge) {
        try {
            if (size > this.maxSize) {
                return false;
            }
            await this.autoClean();
            while (this.currentSize + size > this.maxSize && this.metaCache.size > 0) {
                const oldestKey = [...this.metaCache.entries()]
                    .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
                await this.delete(oldestKey);
            }
            const fileName = pathToFileName(key);
            const dataPath = path.join(this.diskPath, fileName);
            const metaPath = path.join(this.diskPath, `${fileName}.meta`);
            const expiresAt = maxAge ? Date.now() + parseTime(maxAge) : null;
            const metadata = {
                key,
                fileName,
                size,
                contentType: value.contentType,
                timestamp: Date.now(),
                expiresAt,
                accessCount: 1
            };
            await fs.writeFile(dataPath, value.data);
            await fs.writeFile(metaPath, JSON.stringify(metadata));
            this.metaCache.set(key, metadata);
            this.currentSize += size;
            return true;
        } catch (error) {
            console.error(`[缓存] 写入缓存失败: ${key}, ${error.message}`);
            return false;
        }
    }
    async autoClean() {
        const now = Date.now();
        const maxAgeMs = this.maxDays * 24 * 60 * 60 * 1000;
        const items = Array.from(this.metaCache.values());
        if (items.length === 0) return;
        const accessCounts = items.map(m => m.accessCount || 1);
        const maxAccess = Math.max(...accessCounts);
        const minAccess = Math.floor(maxAccess * (this.minPercent / 100));
        for (const meta of items) {
            if (now - meta.timestamp > maxAgeMs) continue;
            if ((meta.accessCount || 1) <= minAccess) {
                await this.delete(meta.key);
            }
        }
    }
    async get(key) {
        try {
            const metadata = this.metaCache.get(key);
            if (!metadata) return null;
            if (metadata.expiresAt && Date.now() > metadata.expiresAt) {
                await this.delete(key);
                return null;
            }
            const dataPath = path.join(this.diskPath, metadata.fileName);
            const data = await fs.readFile(dataPath);
            metadata.timestamp = Date.now();
            metadata.accessCount = (metadata.accessCount || 0) + 1;
            await fs.writeFile(
                path.join(this.diskPath, `${metadata.fileName}.meta`),
                JSON.stringify(metadata)
            );
            return {
                data,
                contentType: metadata.contentType
            };
        } catch (error) {
            console.error(`[缓存] 读取缓存失败: ${key}, ${error.message}`);
            return null;
        }
    }
    async delete(key) {
        try {
            const metadata = this.metaCache.get(key);
            if (!metadata) return;
            await this.deleteFile(key);
            this.currentSize -= metadata.size;
            this.metaCache.delete(key);
        } catch (error) {
            console.error(`[缓存] 删除缓存失败: ${key}, ${error.message}`);
        }
    }
    async deleteFile(key) {
        const metadata = this.metaCache.get(key);
        if (!metadata) return;
        const dataPath = path.join(this.diskPath, metadata.fileName);
        const metaPath = path.join(this.diskPath, `${metadata.fileName}.meta`);
        await Promise.all([
            fs.unlink(dataPath).catch(() => {}),
            fs.unlink(metaPath).catch(() => {})
        ]);
    }
    async has(key) {
        const metadata = this.metaCache.get(key);
        if (!metadata) return false;
        if (metadata.expiresAt && Date.now() > metadata.expiresAt) {
            await this.delete(key);
            return false;
        }
        return true;
    }
    getSize() {
        return this.currentSize;
    }
    async clear() {
        try {
            const files = await fs.readdir(this.diskPath);
            await Promise.all(files.map(file =>
                fs.unlink(path.join(this.diskPath, file)).catch(() => {})
            ));
            this.metaCache.clear();
            this.currentSize = 0;
            console.log(`[缓存] 已清空缓存`);
        } catch (error) {
            console.error(`[缓存] 清空缓存失败: ${error.message}`);
        }
    }
}

class Cache {
    constructor(config) {
        this.config = config;
        const cacheType = config.cache?.type || 'disk';
        const maxSize = config.cache?.maxSize || '1024MB';
        const diskPath = config.cache?.diskPath || './cache';
        const maxDays = config.cache?.maxDays || DEFAULT_MAX_DAYS;
        const minPercent = config.cache?.minPercent || DEFAULT_MIN_PERCENT;
        
        if (cacheType === 'disk') {
            this.cacheImpl = new DiskCache(diskPath, maxSize, { maxDays, minPercent });
        } else {
            this.cacheImpl = new MemoryCache(maxSize);
        }

        this.cacheConfig = {
            type: cacheType,
            maxSize: maxSize,
            diskPath: diskPath,
            maxDays: maxDays,
            minPercent: minPercent
        };
    }

    getCacheConfig() {
        return this.cacheConfig;
    }

    getCacheKey(req) {
        return req.path;
    }
    isCacheable(ext, bufferLength) {
        const allowedTypes = this.config.cache?.imageTypes || ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"];
        const minSize = parseSize(this.config.cache?.minSize || "8MB");
        return allowedTypes.includes(ext) && bufferLength >= minSize;
    }
    async get(req) {
        const key = this.getCacheKey(req);
        const cacheType = this.config.cache?.type || 'memory';
        if (cacheType === 'disk') {
            return await this.cacheImpl.get(key);
        }
        return this.cacheImpl.get(key);
    }
    async set(req, buffer, contentType) {
        const cacheKey = this.getCacheKey(req);
        const maxTime = this.config.cache?.maxTime;
        const cacheData = { data: buffer, contentType };
        const cacheType = this.config.cache?.type || 'memory';
        if (cacheType === 'disk') {
            await this.cacheImpl.set(cacheKey, cacheData, buffer.length, maxTime);
        } else {
            this.cacheImpl.set(cacheKey, cacheData, buffer.length, maxTime);
        }
    }
    formatSize(bytes) {
        return formatSize(bytes);
    }
}

export default Cache;
