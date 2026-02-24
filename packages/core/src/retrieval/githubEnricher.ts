import { request } from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function resolveToken(token?: string): Promise<string | undefined> {
  if (token) return token;
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"]);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export interface GitHubRepoContext {
  language: string | null;
  description: string | null;
  filePaths: string[];
  readmeSnippet: string | null;
  dependenciesSnippet: string | null;
}

const IGNORED_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".pdf",
  ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mp3",
  ".zip", ".gz", ".tar", ".lock", ".log",
]);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "__pycache__", ".venv", "venv",
  "dist", "build", ".next", "vendor", ".mypy_cache",
]);

function shouldInclude(filePath: string): boolean {
  const parts = filePath.split("/");
  if (parts.some((p) => IGNORED_DIRS.has(p))) return false;
  const dotIdx = filePath.lastIndexOf(".");
  if (dotIdx >= 0) {
    const ext = filePath.slice(dotIdx);
    if (IGNORED_EXTS.has(ext)) return false;
  }
  return true;
}

function githubGet(path: string, token?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "api.github.com",
        path,
        method: "GET",
        headers: {
          "User-Agent": "wship-planner/1.0",
          Accept: "application/vnd.github.v3+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API ${res.statusCode}: ${path}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const DEP_FILES = ["requirements.txt", "pyproject.toml", "Pipfile", "package.json", "go.mod", "Cargo.toml"];

export async function fetchGitHubRepoContext(
  repoFullName: string,
  token?: string,
): Promise<GitHubRepoContext | null> {
  try {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) return null;

    const resolvedToken = await resolveToken(token);

    // Repo metadata
    const repoData = (await githubGet(`/repos/${owner}/${repo}`, resolvedToken)) as Record<string, unknown>;
    const language = typeof repoData["language"] === "string" ? repoData["language"] : null;
    const description = typeof repoData["description"] === "string" ? repoData["description"] : null;
    const defaultBranch =
      typeof repoData["default_branch"] === "string" ? repoData["default_branch"] : "main";

    // File tree
    const treeData = (await githubGet(
      `/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`,
      resolvedToken,
    )) as Record<string, unknown>;
    const tree = Array.isArray(treeData["tree"])
      ? (treeData["tree"] as Array<{ type: string; path: string }>)
      : [];
    const filePaths = tree
      .filter((item) => item.type === "blob" && shouldInclude(item.path))
      .map((item) => item.path)
      .slice(0, 200);

    // README
    let readmeSnippet: string | null = null;
    try {
      const readmeData = (await githubGet(`/repos/${owner}/${repo}/readme`, resolvedToken)) as Record<
        string,
        unknown
      >;
      if (typeof readmeData["content"] === "string") {
        readmeSnippet = Buffer.from(readmeData["content"], "base64")
          .toString("utf8")
          .slice(0, 2000);
      }
    } catch {
      // README may not exist
    }

    // Dependencies file
    let dependenciesSnippet: string | null = null;
    const depFile = DEP_FILES.find((f) => filePaths.includes(f));
    if (depFile) {
      try {
        const depData = (await githubGet(
          `/repos/${owner}/${repo}/contents/${depFile}`,
          token,
        )) as Record<string, unknown>;
        if (typeof depData["content"] === "string") {
          dependenciesSnippet = `${depFile}:\n${Buffer.from(depData["content"], "base64")
            .toString("utf8")
            .slice(0, 800)}`;
        }
      } catch {
        // ignore
      }
    }

    return { language, description, filePaths, readmeSnippet, dependenciesSnippet };
  } catch {
    return null;
  }
}
