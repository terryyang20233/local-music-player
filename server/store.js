import fs from "node:fs";
import path from "node:path";

/**
 * 读 JSON。文件不存在返回 fallback；内容损坏时先改名备份再返回 fallback，
 * 这样下一次写入不会把原文件覆盖掉。
 */
export function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    const backup = file.replace(/\.json$/, "") + `.corrupt-${Date.now()}.json`;
    try {
      fs.renameSync(file, backup);
      console.warn(`[唱机] ${path.basename(file)} 无法解析，已备份到 ${backup}（${err.message}）`);
    } catch {
      console.warn(`[唱机] ${path.basename(file)} 无法解析，也无法备份（${err.message}）`);
    }
    return fallback;
  }
}

/** 先写临时文件再 rename，写到一半崩溃也不会留下半截 JSON。 */
export function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}
