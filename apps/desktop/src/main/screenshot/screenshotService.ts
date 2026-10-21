/**
 * 图片写盘服务（M4：职责收窄）。
 *
 * 截图功能移除后，本模块只负责「字节 → 落盘」一段：
 * - getImagesDir()：图片落盘目录（userData/images）；
 * - writeImageFiles(images)：mkdir（幂等）→ 逐张 randomUUID 命名 writeFile，
 *   收集 `images/<uuid>.png` 相对路径与 sizeBytes 返回给调用方编排入库；
 *   任一张失败 → 对已写文件逐个尽力 unlink（unlink 失败仅吞掉，不掩盖原始
 *   错误）→ 抛原始错误。入库（createCaptureWithAttachments）由调用方负责。
 */
import path from 'node:path';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { app } from 'electron';

/**
 * 图片落盘目录（userData/images）。
 * 本函数不创建目录（mkdir 幂等由 writeImageFiles 负责）。
 */
export function getImagesDir(): string {
  return path.join(app.getPath('userData'), 'images');
}

/**
 * 将图片字节逐张落盘：mkdir（幂等）→ randomUUID 命名 writeFile。
 *
 * 返回相对路径数组（`images/<uuid>.png`）与 sizeBytes（= data.length），
 * 由调用方编排 createCaptureWithAttachments 入库。
 * 任一张失败 → 对已写文件逐个尽力 unlink → 抛原始错误。
 */
export async function writeImageFiles(
  images: Uint8Array[],
): Promise<Array<{ filePath: string; sizeBytes: number }>> {
  const imagesDir = getImagesDir();
  await mkdir(imagesDir, { recursive: true });

  const written: Array<{ filePath: string; sizeBytes: number }> = [];
  const absPaths: string[] = [];
  try {
    for (const data of images) {
      const filename = `${randomUUID()}.png`;
      const absPath = path.join(imagesDir, filename);
      await writeFile(absPath, data);
      absPaths.push(absPath);
      written.push({ filePath: `images/${filename}`, sizeBytes: data.length });
    }
  } catch (err) {
    // 尽力清理可能已写入的残缺文件；unlink 失败不再抛出
    for (const absPath of absPaths) {
      await unlink(absPath).catch(() => {});
    }
    throw err;
  }
  return written;
}
