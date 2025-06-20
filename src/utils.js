import { promises as fs } from 'fs';
export function calculateUptime(establishTimeStr) {
  if (!establishTimeStr) return "未设置建站时间";
  const [year, month, day, hour, minute] = establishTimeStr.split('/').map(Number);
  const establishDate = new Date(year, month - 1, day, hour, minute);
  const now = new Date();
  const diff = now - establishDate;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  let uptime = "";
  if (days > 0) uptime += `${days}天`;
  if (hours > 0) uptime += `${hours}小时`;
  uptime += `${minutes}分钟`;
  return uptime;
}
export function formatEstablishTime(timeStr) {
  if (!timeStr) return "未设置";
  const [year, month, day, hour, minute] = timeStr.split('/').map(Number);
  return `${year}年${month}月${day}日${hour}时${minute}分`;
}

export async function loadConfig(configPath, fallback) {
  try {
    const configText = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(configText);
  } catch (e) {
    console.error("加载配置文件失败，使用默认配置", e);
    return fallback;
  }
}

const LOG_BUFFER_SIZE = 2000;
let logBuffer = [];
function pushLog(msg) {
  const time = new Date().toISOString();
  logBuffer.push(`[${time}] ${msg}`);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
}
const rawLog = console.log;
const rawError = console.error;
console.log = (...args) => {
  pushLog(args.map(String).join(' '));
  rawLog.apply(console, args);
};
console.error = (...args) => {
  pushLog('[ERROR] ' + args.map(String).join(' '));
  rawError.apply(console, args);
};
export { logBuffer };

export async function loadStatics(paths) {
  return Promise.all([
    fs.readFile(paths.index, 'utf-8').catch(() => null),
    fs.readFile(paths.configHtml, 'utf-8').catch(() => null),
    fs.readFile(paths.favicon).catch(() => null),
  ]);
}
