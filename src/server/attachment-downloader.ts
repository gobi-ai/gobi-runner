import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { getRunnerDir } from "./project-resolver.js";

/**
 * Extract file URLs from markdown text.
 * Matches: ![alt](url) and [text](url) — covers both inline images and linked files.
 */
function extractFileUrls(markdown: string): string[] {
  const urls: string[] = [];
  // Match markdown images and links: ![...](url) or [...](url)
  const re = /!?\[[^\]]*\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const url = match[1];
    if (isDownloadableUrl(url)) {
      urls.push(url);
    }
  }
  return urls;
}

/**
 * Check if a URL points to a downloadable file (not a webpage link like Linear issues or PRs).
 */
function isDownloadableUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Linear upload CDN — always a file
  if (lower.includes("uploads.linear.app")) return true;
  // Common file extensions
  if (/\.(png|jpg|jpeg|gif|webp|svg|bmp|zip|gz|tar|log|txt|csv|json|pdf|mp4|mov|webm)(\?|$)/i.test(lower)) return true;
  return false;
}

/**
 * Fetch Linear issue attachments via GraphQL API.
 * Returns all file attachments (not just images).
 */
async function fetchLinearAttachments(
  issueId: string,
  apiKey: string
): Promise<{ url: string; title: string }[]> {
  const query = `
    query($id: String!) {
      issue(id: $id) {
        attachments {
          nodes {
            url
            title
            metadata
            sourceType
          }
        }
      }
    }
  `;

  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { id: issueId } }),
    });
    const data = (await res.json()) as any;
    const nodes = data.data?.issue?.attachments?.nodes ?? [];
    return nodes
      .filter((n: any) => n.url && isDownloadableUrl(n.url))
      .map((n: any) => ({ url: n.url, title: n.title || "" }));
  } catch (err) {
    console.error(`[attachments] Failed to fetch Linear attachments for ${issueId}:`, err);
    return [];
  }
}

/**
 * Fetch all comments on a Linear issue and extract file URLs.
 */
async function fetchCommentFileUrls(
  issueId: string,
  apiKey: string
): Promise<string[]> {
  const query = `
    query($id: String!) {
      issue(id: $id) {
        comments {
          nodes {
            body
          }
        }
      }
    }
  `;

  try {
    const res = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { id: issueId } }),
    });
    const data = (await res.json()) as any;
    const nodes = data.data?.issue?.comments?.nodes ?? [];
    const urls: string[] = [];
    for (const comment of nodes) {
      if (comment.body) {
        urls.push(...extractFileUrls(comment.body));
      }
    }
    return urls;
  } catch (err) {
    console.error(`[attachments] Failed to fetch comments for ${issueId}:`, err);
    return [];
  }
}

/**
 * Download a URL to a local file path. Returns true on success.
 */
async function downloadFile(url: string, destPath: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[attachments] HTTP ${res.status} downloading ${url}`);
      return false;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    return true;
  } catch (err) {
    console.error(`[attachments] Failed to download ${url}:`, err);
    return false;
  }
}

/**
 * Derive a filename from a URL.
 */
function filenameFromUrl(url: string, index: number): string {
  try {
    const parsed = new URL(url);
    const basename = path.basename(parsed.pathname);
    // If the basename has any extension, use it
    if (path.extname(basename)) {
      return basename;
    }
  } catch {
    // ignore parse errors
  }
  return `file-${index + 1}`;
}

/**
 * Extract a zip file into a subdirectory. Returns list of extracted file paths (relative to extractDir).
 */
function extractZip(zipPath: string, extractDir: string): string[] {
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    execSync(`unzip -o -q "${zipPath}" -d "${extractDir}"`, { timeout: 30_000 });
    const files: string[] = [];
    function walk(dir: string, prefix: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), rel);
        } else {
          files.push(rel);
        }
      }
    }
    walk(extractDir, "");
    return files;
  } catch (err) {
    console.error(`[attachments] Failed to extract ${zipPath}:`, err);
    return [];
  }
}

export interface AttachmentResult {
  /** Directory where attachments were saved */
  dir: string;
  /** List of downloaded filenames */
  files: string[];
  /** Path to the attachments.md index file */
  mdPath: string;
}

/**
 * Download all file attachments from a Linear issue (inline images, linked files,
 * Linear API attachments, and comment files) into .runner/sessions/<sessionId>/
 * and write an attachments.md index.
 *
 * Zip files are automatically extracted into subdirectories.
 *
 * Returns null if no attachments were found/downloaded.
 */
export async function downloadIssueAttachments(
  projectId: string,
  sessionId: string,
  issueDescription: string | undefined,
  issueId?: string
): Promise<AttachmentResult | null> {
  const apiKey = process.env.LINEAR_API_KEY;

  // Collect file URLs from description
  const descriptionUrls = issueDescription ? extractFileUrls(issueDescription) : [];

  // Collect file URLs from Linear attachments API and comments
  let attachmentUrls: { url: string; title: string }[] = [];
  let commentUrls: string[] = [];
  if (issueId && apiKey) {
    [attachmentUrls, commentUrls] = await Promise.all([
      fetchLinearAttachments(issueId, apiKey),
      fetchCommentFileUrls(issueId, apiKey),
    ]);
  }

  // Merge, dedup by URL
  const seen = new Set<string>();
  const allUrls: { url: string; title: string }[] = [];
  for (const url of descriptionUrls) {
    if (!seen.has(url)) {
      seen.add(url);
      allUrls.push({ url, title: "" });
    }
  }
  for (const att of attachmentUrls) {
    if (!seen.has(att.url)) {
      seen.add(att.url);
      allUrls.push(att);
    }
  }
  for (const url of commentUrls) {
    if (!seen.has(url)) {
      seen.add(url);
      allUrls.push({ url, title: "" });
    }
  }

  if (allUrls.length === 0) return null;

  // Create session directory
  const sessionDir = path.join(getRunnerDir(projectId), "sessions", sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  // Download all files
  const downloaded: string[] = [];
  const usedNames = new Set<string>();

  for (let i = 0; i < allUrls.length; i++) {
    let filename = filenameFromUrl(allUrls[i].url, i);
    // Avoid name collisions
    while (usedNames.has(filename)) {
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      filename = `${base}-${i}${ext}`;
    }
    usedNames.add(filename);

    const destPath = path.join(sessionDir, filename);
    const ok = await downloadFile(allUrls[i].url, destPath);
    if (ok) {
      downloaded.push(filename);
      console.log(`[attachments] Downloaded: ${filename}`);
    }
  }

  if (downloaded.length === 0) return null;

  // Extract zip files and build the attachments index
  const mdLines = ["# Issue Attachments", ""];

  for (const file of downloaded) {
    const filePath = path.join(sessionDir, file);
    const ext = path.extname(file).toLowerCase();

    if (ext === ".zip") {
      const extractDir = path.join(sessionDir, path.basename(file, ext));
      const extracted = extractZip(filePath, extractDir);
      const dirName = path.basename(file, ext);
      mdLines.push(`## ${file} (extracted to \`${dirName}/\`)`);
      mdLines.push("");
      for (const f of extracted) {
        mdLines.push(`- \`${dirName}/${f}\``);
      }
      mdLines.push("");
      console.log(`[attachments] Extracted ${file}: ${extracted.length} files`);
    } else if (/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(file)) {
      mdLines.push(`![[${file}]]`);
    } else {
      mdLines.push(`- \`${file}\``);
    }
  }
  mdLines.push("");

  const mdPath = path.join(sessionDir, "attachments.md");
  fs.writeFileSync(mdPath, mdLines.join("\n"));

  console.log(`[attachments] Saved ${downloaded.length} attachment(s) to ${sessionDir}`);

  return { dir: sessionDir, files: downloaded, mdPath };
}
