// ファイルの種別判定
const TEXT_EXT = new Set(["txt", "json", "js", "mjs", "ts", "py", "sh", "ps1", "bat", "toml", "yaml", "yml", "csv", "log", "css", "xml", "ini", "cfg", "conf", "tsv", "jsonl", "rs", "c", "h", "cpp", "go", "java", "sql", "env", "gitignore", "tex", "svg"]);
const TEXT_MAX = 10 * 1048576; // これを超えるテキストは開かず「Driveで開く」にする

export function kindOf(f) {
  const mime = f.mimeType || "";
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  if (mime.startsWith("application/vnd.google-apps.")) return "other";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "image/svg+xml") return "image";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  const big = f.size > TEXT_MAX;
  if (mime === "text/html" || ext === "html" || ext === "htm") return big ? "other" : "html";
  if (mime === "text/markdown" || ext === "md" || ext === "markdown") return big ? "other" : "md";
  if (mime.startsWith("text/") || ["application/json", "application/javascript", "application/xml"].includes(mime) || TEXT_EXT.has(ext)) return big ? "other" : "code";
  return "other";
}
export const ICON = { md: "i-file-text", code: "i-file-code", video: "i-film", audio: "i-music", image: "i-image", pdf: "i-pdf", html: "i-globe", other: "i-file" };
export const EDITABLE = new Set(["md", "code"]);
