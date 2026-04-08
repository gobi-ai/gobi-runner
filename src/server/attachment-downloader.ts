import fs from "fs";
import path from "path";
import { getRunnerDir } from "./project-resolver.js";

/**
 * Extract image URLs from a Linear issue description (markdown).
 * Matches both ![alt](url) and bare Linear upload URLs.
 */
function extractImageUrls(description: string): string[] {
  const urls: string[] = [];
  // Match markdown images: ![...](url)
  const mdImageRe = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdImageRe.exec(description)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

/**
 * Fetch Linear issue attachments via GraphQL API.
 * These are explicit file attachments (not inline images in description).
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
      .filter((n: any) => n.url && isImageUrl(n.url))
      .map((n: any) => ({ url: n.url, title: n.title || "" }));
  } catch (err) {
    console.error(`[attachments] Failed to fetch Linear attachments for ${issueId}:`, err);
    return [];
  }
}

/**
 * Fetch all comments on a Linear issue and extract inline image URLs.
 */
async function fetchCommentImageUrls(
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
        urls.push(...extractImageUrls(comment.body));
      }
    }
    return urls;
  } catch (err) {
    console.error(`[attachments] Failed to fetch comments for ${issueId}:`, err);
    return [];
  }
}

function isImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("uploads.linear.app") ||
    /\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?|$)/i.test(lower)
  );
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
    // If the basename has a reasonable extension, use it
    if (/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(basename)) {
      return basename;
    }
  } catch {
    // ignore parse errors
  }
  return `image-${index + 1}.png`;
}

export interface AttachmentResult {
  /** Directory where attachments were saved */
  dir: string;
  /** List of downloaded filenames */
  files: string[];
  /** Path to the attachments.md wikilink file */
  mdPath: string;
}

/**
 * Download all images from a Linear issue (inline description images + attachments)
 * into .runner/sessions/<sessionId>/ and write an attachments.md with wikilinks.
 *
 * Returns null if no images were found/downloaded.
 */
export async function downloadIssueAttachments(
  projectId: string,
  sessionId: string,
  issueDescription: string | undefined,
  issueId?: string
): Promise<AttachmentResult | null> {
  const apiKey = process.env.LINEAR_API_KEY;

  // Collect image URLs from description
  const descriptionUrls = issueDescription ? extractImageUrls(issueDescription) : [];

  // Collect image URLs from Linear attachments API and comments
  let attachmentUrls: { url: string; title: string }[] = [];
  let commentUrls: string[] = [];
  if (issueId && apiKey) {
    [attachmentUrls, commentUrls] = await Promise.all([
      fetchLinearAttachments(issueId, apiKey),
      fetchCommentImageUrls(issueId, apiKey),
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

  // Download all images
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

  // Write attachments.md with wikilinks
  const mdLines = ["# Issue Attachments", ""];
  for (const file of downloaded) {
    mdLines.push(`![[${file}]]`);
  }
  mdLines.push("");

  const mdPath = path.join(sessionDir, "attachments.md");
  fs.writeFileSync(mdPath, mdLines.join("\n"));

  console.log(`[attachments] Saved ${downloaded.length} attachment(s) to ${sessionDir}`);

  return { dir: sessionDir, files: downloaded, mdPath };
}
