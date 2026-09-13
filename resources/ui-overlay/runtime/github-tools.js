"use strict";

/**
 * GITHUB TOOLS - API completa de GitHub
 * Soporta repos, PRs, issues, commits, etc.
 */

const https = require("https");
const { URL } = require("url");

/**
 * Realiza llamada a GitHub API
 */
async function githubApi(endpoint, token, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(`https://api.github.com${endpoint}`);

    const requestOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "GET",
      headers: {
        "User-Agent": "EditCore-AI/2.0",
        "Accept": "application/vnd.github.v3+json",
        ...(token && { "Authorization": `token ${token}` }),
        ...(options.headers || {}),
      },
      timeout: options.timeout || 30000,
    };

    const req = https.request(requestOptions, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        // Información de rate limit
        const rateLimit = {
          limit: parseInt(res.headers["x-ratelimit-limit"]) || 0,
          remaining: parseInt(res.headers["x-ratelimit-remaining"]) || 0,
          reset: parseInt(res.headers["x-ratelimit-reset"]) || 0,
        };

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
          return;
        }

        try {
          const parsed = JSON.parse(data);
          resolve({ data: parsed, rateLimit });
        } catch (e) {
          reject(new Error(`Error parseando respuesta: ${e.message}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout en GitHub API"));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

/**
 * Obtiene información de un repositorio
 */
async function getRepoInfo(owner, repo, token) {
  const response = await githubApi(`/repos/${owner}/${repo}`, token);
  return response.data;
}

/**
 * Lista archivos en un repositorio
 */
async function listRepoContents(owner, repo, path = "", token) {
  const endpoint = `/repos/${owner}/${repo}/contents/${path}`;
  const response = await githubApi(endpoint, token);
  return response.data;
}

/**
 * Obtiene contenido de un archivo
 */
async function getFileContent(owner, repo, path, token) {
  const response = await githubApi(`/repos/${owner}/${repo}/contents/${path}`, token);
  const data = response.data;

  if (data.encoding === "base64" && data.content) {
    data.decodedContent = Buffer.from(data.content, "base64").toString("utf8");
  }

  return data;
}

/**
 * Lista branches de un repositorio
 */
async function listBranches(owner, repo, token) {
  const response = await githubApi(`/repos/${owner}/${repo}/branches`, token);
  return response.data;
}

/**
 * Lista commits de un repositorio
 */
async function listCommits(owner, repo, options = {}, token) {
  let endpoint = `/repos/${owner}/${repo}/commits`;
  const params = [];

  if (options.branch) params.push(`sha=${options.branch}`);
  if (options.since) params.push(`since=${options.since}`);
  if (options.until) params.push(`until=${options.until}`);
  if (options.per_page) params.push(`per_page=${options.per_page}`);
  if (options.page) params.push(`page=${options.page}`);

  if (params.length > 0) {
    endpoint += `?${params.join("&")}`;
  }

  const response = await githubApi(endpoint, token);
  return response.data;
}

/**
 * Obtiene un commit específico
 */
async function getCommit(owner, repo, sha, token) {
  const response = await githubApi(`/repos/${owner}/${repo}/commits/${sha}`, token);
  return response.data;
}

/**
 * Lista pull requests
 */
async function listPullRequests(owner, repo, state = "open", token) {
  const response = await githubApi(`/repos/${owner}/${repo}/pulls?state=${state}`, token);
  return response.data;
}

/**
 * Obtiene un pull request específico
 */
async function getPullRequest(owner, repo, number, token) {
  const response = await githubApi(`/repos/${owner}/${repo}/pulls/${number}`, token);
  return response.data;
}

/**
 * Lista issues
 */
async function listIssues(owner, repo, state = "open", token) {
  const response = await githubApi(`/repos/${owner}/${repo}/issues?state=${state}`, token);
  return response.data;
}

/**
 * Obtiene un issue específico
 */
async function getIssue(owner, repo, number, token) {
  const response = await githubApi(`/repos/${owner}/${repo}/issues/${number}`, token);
  return response.data;
}

/**
 * Busca repositorios
 */
async function searchRepos(query, token, options = {}) {
  let endpoint = `/search/repositories?q=${encodeURIComponent(query)}`;

  if (options.sort) endpoint += `&sort=${options.sort}`;
  if (options.order) endpoint += `&order=${options.order}`;
  if (options.per_page) endpoint += `&per_page=${options.per_page}`;
  if (options.page) endpoint += `&page=${options.page}`;

  const response = await githubApi(endpoint, token);
  return response.data;
}

/**
 * Busca código
 */
async function searchCode(query, token, options = {}) {
  let endpoint = `/search/code?q=${encodeURIComponent(query)}`;

  if (options.sort) endpoint += `&sort=${options.sort}`;
  if (options.order) endpoint += `&order=${options.order}`;
  if (options.per_page) endpoint += `&per_page=${options.per_page}`;
  if (options.page) endpoint += `&page=${options.page}`;

  const response = await githubApi(endpoint, token);
  return response.data;
}

/**
 * Obtiene información del usuario autenticado
 */
async function getAuthenticatedUser(token) {
  const response = await githubApi("/user", token);
  return response.data;
}

/**
 * Lista repositorios del usuario autenticado
 */
async function listUserRepos(token, options = {}) {
  let endpoint = "/user/repos";
  const params = [];

  if (options.visibility) params.push(`visibility=${options.visibility}`);
  if (options.sort) params.push(`sort=${options.sort}`);
  if (options.per_page) params.push(`per_page=${options.per_page}`);
  if (options.page) params.push(`page=${options.page}`);

  if (params.length > 0) {
    endpoint += `?${params.join("&")}`;
  }

  const response = await githubApi(endpoint, token);
  return response.data;
}

/**
 * Crea un issue
 */
async function createIssue(owner, repo, title, body, token, options = {}) {
  const data = {
    title,
    body,
    ...(options.labels && { labels: options.labels }),
    ...(options.assignees && { assignees: options.assignees }),
  };

  const response = await githubApi(`/repos/${owner}/${repo}/issues`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: data,
  });

  return response.data;
}

/**
 * Analiza URL de GitHub y extrae owner/repo
 */
function parseGitHubUrl(url) {
  const patterns = [
    /github\.com[\/:]([^\/]+)\/([^\/\.]+)/,
    /^([^\/]+)\/([^\/]+)$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ""),
      };
    }
  }

  throw new Error("URL de GitHub inválida");
}

module.exports = {
  githubApi,
  getRepoInfo,
  listRepoContents,
  getFileContent,
  listBranches,
  listCommits,
  getCommit,
  listPullRequests,
  getPullRequest,
  listIssues,
  getIssue,
  searchRepos,
  searchCode,
  getAuthenticatedUser,
  listUserRepos,
  createIssue,
  parseGitHubUrl,
};
