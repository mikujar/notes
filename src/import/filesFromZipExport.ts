import JSZip from "jszip";

/**
 * 将 zip 解压为带 `webkitRelativePath` 的 File 列表，供 `parseAppleNotesExportDirectory` 使用。
 * 便于在**不支持文件夹选择**的浏览器（如手机）里导入：先在电脑上把导出目录打成 zip 再上传。
 */
export async function filesFromZipExport(zipBlob: Blob): Promise<File[]> {
  const zip = await JSZip.loadAsync(zipBlob);
  const out: File[] = [];
  const names = Object.keys(zip.files).filter((p) => !zip.files[p]!.dir);
  for (const path of names) {
    const entry = zip.files[path];
    if (!entry || entry.dir) continue;
    const data = await entry.async("blob");
    const base = path.replace(/\\/g, "/").split("/").pop() || "file";
    const file = new File([data], base, {
      type: data.type || "application/octet-stream",
      lastModified: entry.date?.getTime() ?? Date.now(),
    });
    const rel = path.replace(/\\/g, "/").replace(/^\//, "");
    Object.defineProperty(file, "webkitRelativePath", {
      value: rel,
      writable: false,
      configurable: true,
    });
    out.push(file);
  }
  return out;
}
