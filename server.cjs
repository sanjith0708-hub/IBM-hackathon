#!/usr/bin/env node
'use strict';

/**
 * Axios PR Review Server
 * ---------------------
 * GET  /api/review?pr=<number|url>   — fetch or generate a review
 * POST /api/vote                      — record a 👍/👎 vote for a section
 *
 * Static files in this same directory are served at /.
 *
 * Usage:
 *   node server.cjs               (port 3000)
 *   PORT=8080 node server.cjs
 *   GITHUB_TOKEN=ghp_… node server.cjs   (raises the rate limit to 5000/h)
 */

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const PORT        = parseInt(process.env.PORT || '3000', 10);
const REVIEWS_DIR = __dirname;           // server.cjs lives inside /reviews/
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').trim();
const VOTES_FILE  = path.join(REVIEWS_DIR, 'votes.json');

// ─── MIME types for static serving ───────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'text/javascript; charset=utf-8',
  '.md'  : 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico' : 'image/x-icon',
};

// ─── Tiny GitHub HTTPS helper ─────────────────────────────────────────────────
function githubGet(apiPath) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: apiPath,
      method: 'GET',
      headers: {
        'Accept'    : 'application/vnd.github.v3+json',
        'User-Agent': 'axios-pr-reviewer',
        ...(GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode === 401) return reject(new Error('GitHub returned 401 Bad credentials. Unset GITHUB_TOKEN or replace it with a valid token: $env:GITHUB_TOKEN=""'));
        if (res.statusCode === 404) return reject(new Error('PR not found (404). Make sure the repo is public and the PR number is correct.'));
        if (res.statusCode === 403) return reject(new Error('GitHub rate limit exceeded. Set the GITHUB_TOKEN environment variable to raise it.'));
        if (res.statusCode >= 400)  return reject(new Error(`GitHub API returned HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Failed to parse GitHub API response as JSON.')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── Parse PR number from a URL or bare number string ────────────────────────
function parsePR(input) {
  if (!input) return null;
  // bare number
  if (/^\d+$/.test(input.trim())) return input.trim();
  // full URL  https://github.com/<owner>/<repo>/pull/<n>
  const m = input.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (m) return { owner: m[1], repo: m[2], number: m[3] };
  return null;
}

// ─── Build a markdown review from PR data + file patches ─────────────────────
function buildReview(meta, files) {
  const { number, title, user, base, head, body: prBody } = meta;
  const prUrl = `https://github.com/${base.repo.full_name}/pull/${number}`;

  // Collect the raw patches into one diff blob for analysis
  const diffSummary = files.map(f =>
    `### ${f.filename} (+${f.additions}/-${f.deletions})\n` +
    (f.patch ? '```diff\n' + f.patch + '\n```' : '_Binary or too large to display_')
  ).join('\n\n');

  // ── Heuristic analysis ──────────────────────────────────────────────────────

  const allPatches    = files.map(f => f.patch || '').join('\n');
  const changedFiles  = files.map(f => f.filename);
  const addedLines    = files.flatMap(f => (f.patch || '').split('\n').filter(l => l.startsWith('+')));

  // Security signals
  const securityFindings = [];
  if (/eval\s*\(/.test(allPatches))
    securityFindings.push('`eval()` usage detected — verify no user-controlled input reaches it.');
  if (/__proto__|prototype\s*\[/.test(allPatches))
    securityFindings.push('Potential prototype-pollution: `__proto__` or `prototype[…]` manipulation detected.');
  if (/constructor\s*\.\s*prototype/.test(allPatches))
    securityFindings.push('`constructor.prototype` manipulation detected — review for prototype pollution.');
  if (/withCredentials|Authorization|xsrf|csrf/i.test(allPatches) && !/test|spec/i.test(changedFiles.join()))
    securityFindings.push('Credential/auth-related code changed outside tests — review for header leakage or XSRF weakening.');
  if (/new\s+Function\s*\(/.test(allPatches))
    securityFindings.push('`new Function(…)` detected — ensure no user input is interpolated.');
  if (/innerHTML\s*=/.test(allPatches))
    securityFindings.push('`innerHTML` assignment detected — potential XSS if value is user-controlled.');
  if (/process\.env\.[A-Z_]+/.test(allPatches))
    securityFindings.push('Environment variable access detected — confirm no secrets are logged or returned to clients.');
  const securitySection = securityFindings.length
    ? securityFindings.map(f => `- ${f}`).join('\n')
    : 'None identified based on static patch analysis.';

  // Missing test signals
  const hasTestChanges = changedFiles.some(f => /test|spec/i.test(f));
  const hasSourceChanges = changedFiles.some(f => /^(lib|src)\//i.test(f));
  const missingTests = [];
  if (hasSourceChanges && !hasTestChanges)
    missingTests.push('Source files were modified but **no test files were changed**. Add unit tests covering the new/modified code paths.');
  if (changedFiles.some(f => /\.d\.ts$/.test(f)) && !changedFiles.some(f => /test.*ts|spec.*ts/i.test(f)))
    missingTests.push('TypeScript declaration file changed without a corresponding type-level test (e.g. `tsd` assertions).');
  const testsSection = missingTests.length
    ? missingTests.map(m => `- ${m}`).join('\n')
    : 'Test files were included with the change, or no source changes require additional test coverage.';

  // Breaking-change signals
  const breakingFindings = [];
  if (files.some(f => f.filename === 'index.d.ts' || f.filename === 'index.d.cts'))
    breakingFindings.push('Public TypeScript declarations changed — verify that no existing call-sites are broken by removed or narrowed types.');
  if (addedLines.some(l => /export\s+(default\s+)?/.test(l)) || files.some(f => f.status === 'removed'))
    breakingFindings.push('Exports or files were added/removed — confirm the public API surface is backward-compatible.');
  if (/package\.json/.test(changedFiles.join())) {
    const pkgFile = files.find(f => f.filename === 'package.json');
    if (pkgFile && /dependencies|engines|exports|main|module/i.test(pkgFile.patch || ''))
      breakingFindings.push('`package.json` fields affecting runtime resolution (dependencies, engines, exports, main, module) were changed.');
  }
  const breakingSection = breakingFindings.length
    ? breakingFindings.map(b => `- ${b}`).join('\n')
    : 'None identified based on static patch analysis.';

  // Suggested improvements — each entry is { text, fix? }
  // fix is an optional { lang, code } object that renders as a labeled code block.
  const suggestions = [
    {
      text: 'Add or update `PRE_RELEASE_CHANGELOG.md` with a user-facing description of this change.',
      fix: {
        lang: 'markdown',
        code: `## Unreleased\n\n### Fixed\n- <one-line description of the change>`,
      },
    },
    {
      text: 'Ensure new code paths are covered by unit tests in `tests/unit/`.',
      fix: {
        lang: 'js',
        code: `import { describe, it, expect } from 'vitest';\n\ndescribe('<feature>', () => {\n  it('<behaviour>', () => {\n    expect(<actual>).toBe(<expected>);\n  });\n});`,
      },
    },
    {
      text: 'Run `npm run lint` and `npm run test:vitest:unit` locally before requesting a re-review.',
      fix: {
        lang: 'bash',
        code: `npm run lint\nnpm run test:vitest:unit`,
      },
    },
  ];
  if (changedFiles.some(f => /adapters\/http/.test(f)))
    suggestions.push({
      text: 'HTTP adapter changes should be tested against both Node.js and Bun runtimes if behaviour differs.',
      fix: {
        lang: 'bash',
        code: `# Node.js\nnpm run test:vitest:unit\n# Bun\nbun test tests/unit/adapters/http.test.js`,
      },
    });
  if (changedFiles.some(f => /adapters\/xhr/.test(f)))
    suggestions.push({
      text: 'XHR adapter changes should include browser-test coverage (`tests/browser/`).',
      fix: {
        lang: 'bash',
        code: `npx playwright install --with-deps\nnpm run test:vitest:browser:headless`,
      },
    });
  if (changedFiles.some(f => /helpers\//.test(f)))
    suggestions.push({
      text: 'Helper changes: confirm the helper remains generic and free of axios-specific request-lifecycle logic (see AGENTS.md).',
    });
  if (changedFiles.some(f => /AxiosHeaders/.test(f)))
    suggestions.push({
      text: '`AxiosHeaders` changes: ensure case-insensitive header normalisation is preserved and add a focused unit test.',
      fix: {
        lang: 'js',
        code: `it('normalises header names case-insensitively', () => {\n  const h = new AxiosHeaders({ 'Content-Type': 'application/json' });\n  expect(h.get('content-type')).toBe('application/json');\n});`,
      },
    });

  // Render suggestions as: bullet text + optional **Code Fix:** fenced block
  const suggestionsSection = suggestions.map(s => {
    const fixBlock = s.fix
      ? `\n\n  **Code Fix:**\n\n  \`\`\`${s.fix.lang}\n  ${s.fix.code.replace(/\n/g, '\n  ')}\n  \`\`\``
      : '';
    return `- ${s.text}${fixBlock}`;
  }).join('\n\n');

  // Overall assessment heuristic
  let assessment = 'Approve';
  let rationale  = 'Change appears well-scoped and complete.';
  if (securityFindings.length) {
    assessment = 'Request Changes';
    rationale  = 'Potential security findings require human review before merging.';
  } else if (missingTests.length) {
    assessment = 'Request Changes';
    rationale  = 'Source changes are missing test coverage.';
  } else if (breakingFindings.length) {
    assessment = 'Needs Discussion';
    rationale  = 'Possible breaking changes need maintainer sign-off.';
  }

  return `# PR #${number} Review
**Title:** ${title}
**Author:** ${user.login}
**Base → Head:** ${base.ref}...${head.ref}
**URL:** ${prUrl}

## Summary

${prBody ? prBody.trim().split('\n').slice(0, 10).join('\n') : '_No PR description provided._'}

<details>
<summary>Changed files (${files.length})</summary>

${files.map(f => `- \`${f.filename}\` (+${f.additions}/-${f.deletions}) [${f.status}]`).join('\n')}

</details>

## Security Risks

${securitySection}

## Missing Tests

${testsSection}

## Breaking Changes

${breakingSection}

## Suggested Improvements

${suggestionsSection}

## Overall Assessment

**${assessment}** — ${rationale}

---
_Review generated automatically on ${new Date().toISOString().slice(0, 10)}_
`;
}

// ─── Core review handler ──────────────────────────────────────────────────────
async function handleReview(rawInput, res) {
  const parsed = parsePR(rawInput);
  if (!parsed) {
    return sendJSON(res, 400, { error: 'Could not parse a PR number or GitHub URL from the input.' });
  }

  const owner  = typeof parsed === 'object' ? parsed.owner  : 'axios';
  const repo   = typeof parsed === 'object' ? parsed.repo   : 'axios';
  const number = typeof parsed === 'object' ? parsed.number : parsed;

  const cacheFile = path.join(REVIEWS_DIR, `PR-${number}.md`);

  // Serve from cache if available
  if (fs.existsSync(cacheFile)) {
    const cached = fs.readFileSync(cacheFile, 'utf8');
    return sendJSON(res, 200, { pr: number, markdown: cached, cached: true });
  }

  // Fetch from GitHub
  let meta, files;
  try {
    [meta, files] = await Promise.all([
      githubGet(`/repos/${owner}/${repo}/pulls/${number}`),
      githubGet(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`),
    ]);
  } catch (err) {
    return sendJSON(res, 502, { error: err.message });
  }

  const markdown = buildReview(meta, files);

  // Save to disk
  try {
    fs.writeFileSync(cacheFile, markdown, 'utf8');
  } catch (e) {
    console.error('Warning: could not write cache file:', e.message);
  }

  sendJSON(res, 200, { pr: number, markdown, cached: false });
}

// ─── Vote handler ─────────────────────────────────────────────────────────────
// Body: { pr, section, vote }  vote = 'up' | 'down'
async function handleVote(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let payload;
    try { payload = JSON.parse(body); } catch {
      return sendJSON(res, 400, { error: 'Invalid JSON' });
    }

    const { pr, section, vote } = payload;
    if (!pr || !section || !['up', 'down'].includes(vote))
      return sendJSON(res, 400, { error: 'Required fields: pr, section, vote ("up"|"down")' });

    // Load existing votes
    let votes = {};
    try { votes = JSON.parse(fs.readFileSync(VOTES_FILE, 'utf8')); } catch { /* first run */ }

    // Structure: votes[pr][section] = { up: N, down: N }
    if (!votes[pr])           votes[pr] = {};
    if (!votes[pr][section])  votes[pr][section] = { up: 0, down: 0 };
    votes[pr][section][vote]++;

    try {
      fs.writeFileSync(VOTES_FILE, JSON.stringify(votes, null, 2), 'utf8');
    } catch (e) {
      return sendJSON(res, 500, { error: 'Could not save vote: ' + e.message });
    }

    sendJSON(res, 200, { ok: true, tally: votes[pr][section] });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(res, filePath) {
  try {
    const data = fs.readFileSync(filePath);
    const ext  = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');

  const reqUrl  = new URL(req.url, 'http://localhost');
  const pathname = reqUrl.pathname;

  if (pathname === '/api/review' && req.method === 'GET') {
    const pr = reqUrl.searchParams.get('pr') || '';
    await handleReview(pr, res);
    return;
  }

  if (pathname === '/api/vote' && req.method === 'POST') {
    handleVote(req, res);
    return;
  }

  if (pathname === '/api/votes' && req.method === 'GET') {
    try {
      const votes = JSON.parse(fs.readFileSync(VOTES_FILE, 'utf8'));
      sendJSON(res, 200, votes);
    } catch {
      sendJSON(res, 200, {});
    }
    return;
  }

  // Static file serving
  let filePath;
  if (pathname === '/' || pathname === '/index.html') {
    filePath = path.join(REVIEWS_DIR, 'index.html');
  } else {
    filePath = path.join(REVIEWS_DIR, pathname.replace(/^\//, ''));
  }

  // Basic path traversal guard
  if (!filePath.startsWith(REVIEWS_DIR)) {
    res.writeHead(403); res.end('Forbidden');
    return;
  }

  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(`Axios PR Reviewer running at http://localhost:${PORT}`);
  console.log(`Reviews folder: ${REVIEWS_DIR}`);
  if (!GITHUB_TOKEN) console.log('Tip: set GITHUB_TOKEN env var to avoid GitHub rate limits (60 req/h unauthenticated → 5000/h)');
});
