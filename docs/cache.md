## 缓存类型

系统支持两种缓存类型：

1. **内存缓存**：数据存储在RAM中，速度快但重启后丢失
2. **硬盘缓存**：数据存储在硬盘上，持久化但读写速度相对较慢（其实没什么区别）

## 缓存大小自动维护

### 内存缓存实现

```javascript
set(key, value, size, maxAge) {
    // 检查是否超过最大容量，如果是则移除最旧的项目
    while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
        const firstKey = this.cache.keys().next().value;
        this.delete(firstKey);
    }
    
    // 如果单个项目超过最大容量，则拒绝缓存（虽然不太可能）
    if (size > this.maxSize) {
        return false;
    }
    
    // 存储项目并更新缓存大小
    const expiresAt = maxAge ? Date.now() + parseTime(maxAge) : null;
    this.cache.set(key, {
        data: value,
        size: size,
        timestamp: Date.now(),
        expiresAt
    });
    this.currentSize += size;
    return true;
}
```

### 硬盘缓存实现

```javascript
async set(key, value, size, maxAge) {
    try {
        // 如果新内容太大，无法存储
        if (size > this.maxSize) {
            return false;
        }
        
        // 清理空间，直到有足够空间存储新内容
        while (this.currentSize + size > this.maxSize && this.metaCache.size > 0) {
            // 查找并移除最旧的缓存项(通过访问时间排序)
            const oldestKey = [...this.metaCache.entries()]
                .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
            await this.delete(oldestKey);
        }
        
        // 后续存储逻辑...
    } catch (error) {
        console.error(`[缓存] 写入缓存失败: ${key}, ${error.message}`);
        return false;
    }
}
```

## 过期清理机制

### 懒惰删除策略

系统使用"懒惰删除"策略，即不主动检查过期项，而是在访问时检查：

```javascript
get(key) {
    const item = this.cache.get(key);
    if (item) {
        // 如果项目已过期，则删除并返回null
        if (item.expiresAt && Date.now() > item.expiresAt) {
            this.delete(key);
            return null;
        }
        
        // 更新最近访问时间
        item.timestamp = Date.now();
        return item.data;
    }
    return null;
}
```

### 硬盘缓存启动时清理

硬盘缓存在初始化时会加载并验证所有缓存项：

```javascript
async loadCacheInfo() {
    try {
        // 读取缓存目录中的所有文件
        const files = await fs.readdir(this.diskPath);
        
        // 只处理.meta文件，它们包含元数据
        const metaFiles = files.filter(file => file.endsWith('.meta'));
        
        for (const metaFile of metaFiles) {
            try {
                const metaPath = path.join(this.diskPath, metaFile);
                const metaContent = await fs.readFile(metaPath, 'utf-8');
                const metadata = JSON.parse(metaContent);
                
                // 验证数据文件是否存在
                const dataPath = path.join(this.diskPath, metadata.fileName);
                try {
                    await fs.access(dataPath);
                    
                    // 检查是否过期
                    if (metadata.expiresAt && Date.now() > metadata.expiresAt) {
                        // 过期了，删除文件
                        await this.deleteFile(metadata.key);
                        continue;
                    }
                    
                    // 加载元数据到内存
                    this.metaCache.set(metadata.key, metadata);
                    this.currentSize += metadata.size;
                } catch (err) {
                    // 数据文件不存在，删除元数据文件
                    await fs.unlink(metaPath).catch(() => {});
                }
            } catch (err) {
                // 处理单个元数据文件失败，继续处理下一个
                console.error(`[缓存] 加载元数据失败: ${metaFile}, ${err.message}`);
            }
        }
        
        console.log(`[缓存] 已加载 ${this.metaCache.size} 个条目，总大小: ${formatSize(this.currentSize)}`);
    } catch (error) {
        console.error(`[缓存] 加载缓存信息失败: ${error.message}`);
    }
}
```

## LRU缓存策略

两种缓存实现均采用LRU（最近最少使用）策略：

1. **记录访问时间戳**：每次读取缓存都会更新项目的timestamp
2. **移除最老的项目**：需要腾出空间时，总是移除最久未访问的项目
3. **自动平衡**：大小维护和访问模式相结合，自动优化缓存内容

## 元数据管理（硬盘缓存）

硬盘缓存使用元数据文件管理每个缓存项：

1. **双文件机制**：每个缓存项包含一个数据文件和一个.meta元数据文件
2. **元数据内容**：包含键值、文件名、大小、内容类型、时间戳和过期时间
3. **内存映射**：元数据同时保存在内存中，加快访问速度
4. **文件名处理**：使用MD5哈希将路径转换为安全的文件名

## 文件系统安全措施

1. **异常处理**：所有文件操作包含错误处理，防止意外中断
2. **原子性操作**：元数据和数据文件写入分离，减少数据损坏风险
3. **缓存验证**：启动时验证缓存文件的完整性，自动清理损坏的项目

## 配置示例

```json
"cache": {
    "enabled": true,
    "type": "disk",        // 选择缓存类型: "memory" 或 "disk"
    "minSize": "8MB",      // 最小可缓存文件大小
    "maxTime": "2678400S", // 缓存过期时间(31天)
    "maxSize": "1024MB",   // 缓存总大小上限
    "diskPath": ".cache",// 硬盘缓存存储路径
    "imageTypes": ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"]
}
``` 