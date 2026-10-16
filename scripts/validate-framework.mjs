#!/usr/bin/env node
// Validates the AI engineering framework in this repository: Claude Code agents, skills, rules,
// settings, MCP config, requirement traceability, phase plans, backlog and internal links.
// Dependency-free. Usage:
//   node scripts/validate-framework.mjs              run all checks (exit 1 on any error)
//   node scripts/validate-framework.mjs --ids-by-phase   print requirement IDs grouped by phase
//   node scripts/validate-framework.mjs --root <dir>     validate another checkout of this layout
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// --root <dir> validates another checkout (used to prove the checks fail when they should).
const rootArg = process.argv.indexOf('--root');
const root = rootArg > -1
  ? resolve(process.argv[rootArg + 1])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);
const read = (p) => readFileSync(join(root, p), 'utf8');
const exists = (p) => existsSync(join(root, p));
const toPosix = (p) => p.split(sep).join('/');
// Markdown shipped by the Hydrogen scaffold (README, CHANGELOG, AGENTS, guides/, .cursor/) belongs to the template, not to this framework.
const TEMPLATE_DOC = /^storefront\/(README\.md|CHANGELOG\.md|AGENTS\.md|guides\/|\.cursor\/)/;
const isTemplateDoc = (rel) => TEMPLATE_DOC.test(rel);

// ---------------------------------------------------------------- constants

const PHASE_FILES = {
  '0': 'phase-00-discovery-and-feasibility.md',
  '1': 'phase-01-foundation-and-ci.md',
  '2': 'phase-02-design-system-and-shell.md',
  '3A': 'phase-03a-shopify-connectivity-and-catalog-data.md',
  '3B': 'phase-03b-catalog-experience.md',
  '4': 'phase-04-cart-and-pre-checkout-offers.md',
  '5A': 'phase-05a-extend-protection.md',
  '5B': 'phase-05b-delivery-functions-and-checkout.md',
  '6': 'phase-06-quiz-compare-stores-account-content.md',
  '7': 'phase-07-analytics-seo-a11y-performance-security.md',
  '8': 'phase-08-acceptance-and-uat.md',
  '9': 'phase-09-launch-and-handover.md',
};
const REQ_STATUSES = new Set(['Confirmed', 'Assumed', 'Blocked', 'Pending approval']);
const TASK_STATUSES = new Set(['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE']);
const AGENTS = [
  'project-manager', 'solution-architect', 'shopify-hydrogen-developer', 'ui-ux-designer',
  'integration-engineer', 'qa-engineer', 'security-engineer', 'code-reviewer', 'devops-engineer',
  'technical-writer',
];
const SKILLS = [
  'project-bootstrap', 'scope-to-implementation-plan', 'phase-planning', 'figma-to-hydrogen',
  'shopify-product-and-collection-development', 'shopify-cart-and-checkout-boundaries',
  'extend-integration', 'shopify-promotions-and-functions', 'playwright-e2e-testing',
  'accessibility-review', 'security-review-storefront', 'performance-review',
  'code-review-storefront', 'deployment-readiness', 'release-and-handover',
];
const AGENT_KEYS = new Set([
  'name', 'description', 'tools', 'disallowedTools', 'model', 'permissionMode', 'maxTurns', 'skills',
  'mcpServers', 'hooks', 'memory', 'color', 'effort', 'background', 'omitClaudeMd', 'isolation',
  'initialPrompt', 'experimental',
]);
const SKILL_KEYS = new Set([
  'name', 'description', 'when_to_use', 'argument-hint', 'arguments', 'disable-model-invocation',
  'user-invocable', 'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context', 'agent',
  'background', 'hooks', 'paths', 'shell', 'metadata', 'license', 'compatibility',
]);
const AGENT_COLORS = new Set(['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']);
const BASE_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'NotebookEdit',
]);
const AGENT_SECTIONS = [
  '## Mission', '## Boundaries', '## Invoke when', '## Read first', '## Deliverables',
  '## Tools and MCP', '## Done when', '## Security and scope limits', '## Escalate to the orchestrator when',
];
const SKILL_SECTIONS = ['## When to use', '## Steps', '## Outputs', '## Validation'];
const REQUIRED_FILES = [
  'CLAUDE.md', 'README.md', '.gitignore', '.env.example', '.mcp.json', '.claude/settings.json',
  'docs/requirements/SCOPE_OF_WORK.md', 'docs/requirements/REQUIREMENTS.md',
  'docs/requirements/TRACEABILITY.md', 'docs/requirements/OPEN_QUESTIONS.md',
  'docs/requirements/SOW_DEVIATIONS.md', 'docs/requirements/CLIENT_QUESTION_PACK.md',
  'docs/research/BASIC_PLAN_WORKAROUNDS.md', '.nvmrc',
  'docs/architecture/ARCHITECTURE.md', 'docs/architecture/SHOPIFY_DATA_MODEL.md',
  'docs/decisions/TEMPLATE.md', 'docs/research/TECH_FEASIBILITY.md', 'docs/design/FIGMA_WORKFLOW.md',
  'docs/integrations/INTEGRATION_CONTRACTS.md', 'docs/integrations/EXTEND.md',
  'docs/integrations/READINESS_CHECKLIST.md', 'docs/security/THREAT_MODEL.md',
  'docs/testing/TEST_STRATEGY.md', 'docs/testing/PLAYWRIGHT_WORKFLOW.md',
  'docs/deployment/DEPLOYMENT.md', 'docs/handover/HANDOVER.md',
  'plans/MASTER_PLAN.md', 'plans/ROADMAP.md', 'plans/CURRENT_PHASE.md', 'plans/BACKLOG.md',
  'plans/RISKS_AND_DEPENDENCIES.md', 'plans/ACCEPTANCE_CRITERIA.md',
  'progress/STATUS.md', 'progress/DECISIONS.md', 'progress/BLOCKERS.md', 'progress/TEST_RESULTS.md',
];

// ---------------------------------------------------------------- helpers

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    if (['node_modules', '.git', '.shopify', 'dist', 'build', '.react-router', 'test-results',
      'playwright-report', '.playwright-mcp'].includes(name)) continue;
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

function scalar(raw) {
  const s = raw.trim();
  if (s.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(s)) throw new Error(`malformed double-quoted value: ${s.slice(0, 60)}`);
    return JSON.parse(s);
  }
  if (s.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(s)) throw new Error(`malformed single-quoted value: ${s.slice(0, 60)}`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/:\s|\s#/.test(s)) throw new Error(`unquoted value contains ": " or " #" (quote it): ${s.slice(0, 60)}`);
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

// Minimal strict front matter parser: top-level `key: value` and `key:` followed by `- item` lines.
function parseFrontmatter(text) {
  const norm = text.replace(/\r\n/g, '\n');
  if (!norm.startsWith('---\n')) throw new Error('front matter must start with --- on line 1');
  const end = norm.indexOf('\n---\n', 3);
  if (end === -1) throw new Error('front matter is not closed with ---');
  const data = {};
  let key = null;
  norm.slice(4, end).split('\n').forEach((raw, i) => {
    if (!raw.trim()) return;
    const item = raw.match(/^\s+-\s+(.*)$/);
    if (item) {
      if (key === null || !Array.isArray(data[key])) throw new Error(`line ${i + 2}: list item without a list key`);
      data[key].push(scalar(item[1]));
      return;
    }
    const kv = raw.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/);
    if (!kv) throw new Error(`line ${i + 2}: cannot parse "${raw.slice(0, 60)}"`);
    key = kv[1];
    data[key] = kv[2] === undefined || kv[2].trim() === '' ? [] : scalar(kv[2]);
  });
  return { data, body: norm.slice(end + 5) };
}

function splitRow(line) {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function parseTables(text) {
  const tables = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\|/.test(line)) {
      const cells = splitRow(line);
      if (!cur) { cur = { headers: cells, rows: [], sep: false }; continue; }
      if (!cur.sep) { cur.sep = /^[\s:|-]+$/.test(line); continue; }
      const row = {};
      cur.headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
      cur.rows.push(row);
    } else if (cur) { tables.push(cur); cur = null; }
  }
  if (cur) tables.push(cur);
  return tables;
}

const stripCode = (text) => text.replace(/```[\s\S]*?```/g, '');

// ---------------------------------------------------------------- checks

function checkRequiredFiles() {
  for (const f of REQUIRED_FILES) if (!exists(f)) err(f, 'required file is missing');
  for (const f of Object.values(PHASE_FILES)) {
    if (!exists(`plans/phases/${f}`)) err(`plans/phases/${f}`, 'required phase plan is missing');
  }
  if (exists('.gitignore')) {
    const gi = read('.gitignore').split(/\r?\n/).map((l) => l.trim());
    for (const need of ['.env', 'node_modules', '.claude/settings.local.json', 'CLAUDE.local.md']) {
      if (!gi.some((l) => l === need || l === `${need}/` || l === `/${need}`)) {
        err('.gitignore', `must ignore ${need}`);
      }
    }
  }
  if (exists('.env.example')) {
    read('.env.example').split(/\r?\n/).forEach((line, i) => {
      if (!line.trim() || line.trim().startsWith('#')) return;
      if (!/^[A-Z][A-Z0-9_]*=$/.test(line.trim())) err('.env.example', `line ${i + 1} must be NAME= with no value`);
    });
  }
  if (exists('CLAUDE.md')) {
    const n = read('CLAUDE.md').split(/\r?\n/).length;
    if (n > 200) warn('CLAUDE.md', `${n} lines; Claude Code guidance is to stay under 200`);
  }
}

// Does a semver range (engines.node) admit the given major version? Major-level only; unknown syntax fails closed.
function majorSatisfies(range, major) {
  const m = Number(major);
  return range.split('||').some((alt) => alt.trim().split(/\s+/).filter(Boolean).every((cmp) => {
    const mt = cmp.match(/^(>=|<=|>|<|\^|~|=)?v?(\d+)(?:\.(?:\d+|x|\*))*$/);
    if (!mt) return false;
    const op = mt[1] ?? '=';
    const n = Number(mt[2]);
    if (op === '>=') return m >= n;
    if (op === '>') return m > n;
    if (op === '<=') return m <= n;
    if (op === '<') return m < n;
    return m === n; // ^, ~, = and bare versions pin the major
  }));
}

function checkToolchain() {
  // A nested .git (the Hydrogen scaffold leaves one) turns the app into an embedded repository.
  for (const d of ['storefront', 'shopify-app']) {
    if (exists(`${d}/.git`)) err(d, 'nested .git directory: remove it so the root repository tracks this folder');
  }
  if (exists('.nvmrc') && exists('storefront/package.json')) {
    const major = read('.nvmrc').trim().replace(/^v/, '').split('.')[0];
    let engines = '';
    try { engines = JSON.parse(read('storefront/package.json')).engines?.node ?? ''; } catch { err('storefront/package.json', 'invalid JSON'); }
    if (!engines) err('storefront/package.json', 'engines.node is missing: it must admit the .nvmrc major (ADR-0005)');
    else if (!majorSatisfies(engines, major)) err('.nvmrc', `major ${major} is not admitted by storefront engines.node "${engines}"`);
  }
  if (exists('storefront/package-lock.json') === false && exists('storefront/package.json')) {
    err('storefront', 'package-lock.json is missing (ADR-0001: the lockfile is committed)');
  }
}

function checkAgents() {
  const dir = '.claude/agents';
  if (!exists(dir)) { err(dir, 'missing'); return; }
  const files = readdirSync(join(root, dir)).filter((f) => f.endsWith('.md'));
  for (const name of AGENTS) if (!files.includes(`${name}.md`)) err(dir, `missing agent ${name}.md`);
  const seen = new Set();
  for (const f of files) {
    const rel = `${dir}/${f}`;
    let fm;
    try { fm = parseFrontmatter(read(rel)); } catch (e) { err(rel, e.message); continue; }
    const { data, body } = fm;
    for (const k of Object.keys(data)) if (!AGENT_KEYS.has(k)) err(rel, `unsupported frontmatter key "${k}" (silently ignored by Claude Code)`);
    if (typeof data.name !== 'string' || !data.name) err(rel, 'name is required');
    else {
      if (data.name !== f.replace(/\.md$/, '')) err(rel, `name "${data.name}" should match the file name`);
      if (seen.has(data.name)) err(rel, `duplicate name ${data.name}`);
      seen.add(data.name);
      if (/^-|:/.test(data.name)) err(rel, 'name may not start with "-" or contain ":"');
    }
    if (typeof data.description !== 'string' || data.description.length < 40) err(rel, 'description is required (40+ characters)');
    if (data.color !== undefined && !AGENT_COLORS.has(data.color)) err(rel, `invalid color ${data.color}`);
    const tools = typeof data.tools === 'string' ? data.tools.split(',').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(data.tools) ? data.tools : null;
    if (!tools || tools.length === 0) err(rel, 'tools allowlist is required (least privilege)');
    else {
      for (const t of tools) {
        if (t === 'Agent' || t.startsWith('Agent(')) err(rel, 'agents must not spawn agents; the orchestrator integrates work');
        else if (!BASE_TOOLS.has(t) && !t.startsWith('mcp__')) err(rel, `unknown tool "${t}"`);
        if (t.startsWith('mcp__') && t.includes('(')) err(rel, `MCP tool rule "${t}" may not have parentheses`);
      }
      if (['code-reviewer'].includes(data.name) && tools.some((t) => t === 'Write' || t === 'Edit')) {
        err(rel, 'code-reviewer must be read-only (no Write or Edit)');
      }
    }
    const preload = Array.isArray(data.skills) ? data.skills : [];
    for (const s of preload) {
      if (!exists(`.claude/skills/${s}/SKILL.md`)) err(rel, `preloads missing skill ${s}`);
      else if (/disable-model-invocation:\s*true/.test(read(`.claude/skills/${s}/SKILL.md`).split('\n---\n')[0])) {
        err(rel, `skill ${s} has disable-model-invocation and cannot be preloaded`);
      }
    }
    for (const h of AGENT_SECTIONS) if (!body.includes(`\n${h}`) && !body.startsWith(h)) err(rel, `missing section "${h}"`);
  }
}

function checkSkills() {
  const dir = '.claude/skills';
  if (!exists(dir)) { err(dir, 'missing'); return; }
  const dirs = readdirSync(join(root, dir)).filter((d) => statSync(join(root, dir, d)).isDirectory());
  for (const name of SKILLS) if (!dirs.includes(name)) err(dir, `missing skill ${name}`);
  for (const d of dirs) {
    const rel = `${dir}/${d}/SKILL.md`;
    if (d.toLowerCase() === 'synced') err(rel, 'folder name "synced" is reserved by Claude Code');
    if (!exists(rel)) { err(`${dir}/${d}`, 'SKILL.md missing'); continue; }
    const text = read(rel);
    let fm;
    try { fm = parseFrontmatter(text); } catch (e) { err(rel, e.message); continue; }
    const { data, body } = fm;
    for (const k of Object.keys(data)) if (!SKILL_KEYS.has(k)) err(rel, `unsupported frontmatter key "${k}"`);
    if (data.name !== d) err(rel, `name "${data.name}" must equal the folder name "${d}"`);
    if (typeof data.description !== 'string' || data.description.length < 40) err(rel, 'description is required (40+ characters)');
    const combined = `${data.description || ''}${data.when_to_use || ''}`.length;
    if (combined > 1536) err(rel, `description + when_to_use is ${combined} chars; limit is 1,536`);
    const lines = text.split(/\r?\n/).length;
    if (lines > 500) err(rel, `${lines} lines; keep SKILL.md under 500`);
    for (const h of SKILL_SECTIONS) if (!body.includes(h)) err(rel, `missing section "${h}"`);
  }
}

function checkRules() {
  const dir = '.claude/rules';
  if (!exists(dir)) { err(dir, 'missing'); return; }
  const files = walk(dir).filter((f) => f.endsWith('.md'));
  if (files.length === 0) err(dir, 'no rules found');
  for (const rel of files) {
    const text = read(rel);
    if (!text.startsWith('---')) continue; // unscoped rule, loads always
    let fm;
    try { fm = parseFrontmatter(text); } catch (e) { err(rel, e.message); continue; }
    for (const k of Object.keys(fm.data)) if (k !== 'paths') err(rel, `rules only support "paths" frontmatter, found "${k}"`);
    if (!Array.isArray(fm.data.paths) || fm.data.paths.length === 0) err(rel, 'paths must be a non-empty list');
  }
}

function checkJsonConfigs() {
  for (const f of ['.claude/settings.json', '.mcp.json']) {
    if (!exists(f)) continue;
    let json;
    try { json = JSON.parse(read(f)); } catch (e) { err(f, `invalid JSON: ${e.message}`); continue; }
    if (f === '.claude/settings.json') {
      const deny = json.permissions?.deny ?? [];
      for (const need of ['Read(.env)', 'Read(.env.local)']) if (!deny.includes(need)) err(f, `permissions.deny must include ${need}`);
      for (const rule of [...(json.permissions?.allow ?? []), ...(json.permissions?.deny ?? []), ...(json.permissions?.ask ?? [])]) {
        if (/^mcp__.*\(/.test(rule)) err(f, `MCP rule "${rule}" may not use parentheses`);
      }
      if (json.permissions?.allow?.some((r) => /^Bash\(\*\)$|^Bash$/.test(r))) err(f, 'allow list must not grant blanket Bash');
    } else {
      for (const need of ['figma', 'playwright']) if (!json.mcpServers?.[need]) err(f, `mcpServers.${need} is missing`);
      for (const [name, s] of Object.entries(json.mcpServers ?? {})) {
        for (const [k, v] of Object.entries({ ...(s.env ?? {}), ...(s.headers ?? {}) })) {
          if (typeof v === 'string' && v && !/^\$\{[A-Z0-9_]+(:-[^}]*)?\}$/.test(v)) err(f, `${name}.${k} must be an environment reference, not a literal`);
        }
      }
    }
  }
}

function checkSecrets() {
  const patterns = [
    [/shp(?:at|ss|ca|pa)_[a-f0-9]{16,}/i, 'Shopify token'],
    [/\bsk-[A-Za-z0-9_-]{20,}/, 'API secret key'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
    [/Bearer\s+[A-Za-z0-9._~+/-]{24,}/, 'bearer token'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
    // Keep this list identical to the loop in .github/workflows/ci.yml (the history scan); [.] stands for a dot in both.
    [/sk_live_[A-Za-z0-9]{16,}/, 'Stripe-style live secret key'],
    [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
    [/github_pat_[A-Za-z0-9_]{30,}/, 'GitHub fine-grained token'],
    [/eyJ[A-Za-z0-9_-]{10,}[.]eyJ[A-Za-z0-9_-]{10,}[.][A-Za-z0-9_-]{10,}/, 'JWT'],
  ];
  for (const rel of walk('')) {
    if (!/\.(md|json|mjs|js|ts|tsx|yml|yaml|toml|env|example|txt)$/.test(rel) && !rel.endsWith('.gitignore')) continue;
    if (rel === 'scripts/validate-framework.mjs') continue;
    const text = read(rel);
    for (const [re, label] of patterns) if (re.test(text)) err(rel, `looks like a committed secret (${label})`);
  }
}

function checkLinks() {
  for (const rel of walk('').filter((f) => f.endsWith('.md') && !isTemplateDoc(f))) {
    const text = stripCode(read(rel));
    for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      let target = m[1];
      if (/^(https?:|mailto:|#)/.test(target) || target.includes('<')) continue;
      target = target.split('#')[0];
      if (!target) continue;
      const abs = resolve(root, dirname(rel), target);
      if (!abs.startsWith(root) || !existsSync(abs)) err(rel, `broken link ${m[1]}`);
    }
  }
}

function parseRequirements() {
  const tables = parseTables(read('docs/requirements/REQUIREMENTS.md'));
  const rows = [];
  for (const t of tables) {
    if (t.headers[0] !== 'ID' || !t.headers.includes('Phase') || !t.headers.includes('Status')) continue;
    for (const r of t.rows) if (/^(REQ-[A-Z]+-\d{3}|NFR-\d{3})$/.test(r.ID)) rows.push(r);
  }
  return rows;
}

function checkRequirements() {
  const rows = parseRequirements();
  const ids = new Set();
  const trace = read('docs/requirements/TRACEABILITY.md');
  const traceRows = new Map();
  for (const t of parseTables(trace)) for (const r of t.rows) if (r.ID) traceRows.set(r.ID, r);
  for (const r of rows) {
    if (ids.has(r.ID)) err('REQUIREMENTS.md', `duplicate ${r.ID}`);
    ids.add(r.ID);
    if (!PHASE_FILES[r.Phase]) err('REQUIREMENTS.md', `${r.ID} has unknown phase "${r.Phase}"`);
    if (!REQ_STATUSES.has(r.Status)) err('REQUIREMENTS.md', `${r.ID} has invalid status "${r.Status}"`);
    if (!r['Acceptance criteria']) err('REQUIREMENTS.md', `${r.ID} has no acceptance criteria`);
    const tr = traceRows.get(r.ID);
    if (!tr) err('TRACEABILITY.md', `${r.ID} is missing`);
    else {
      if (tr.Phase !== r.Phase) err('TRACEABILITY.md', `${r.ID} phase ${tr.Phase} differs from REQUIREMENTS.md (${r.Phase})`);
      if (!tr['Unit and integration'] && !tr['E2E, accessibility'] && !tr.Other) err('TRACEABILITY.md', `${r.ID} has no planned verification`);
    }
    const planFile = PHASE_FILES[r.Phase];
    if (planFile && exists(`plans/phases/${planFile}`)) {
      if (!new RegExp(`\\b${r.ID}\\b`).test(read(`plans/phases/${planFile}`))) err(`plans/phases/${planFile}`, `does not list ${r.ID}`);
    }
  }
  for (const id of traceRows.keys()) if (!ids.has(id)) err('TRACEABILITY.md', `${id} is not in REQUIREMENTS.md`);

  // reference integrity across all markdown
  const tableIds = (file, re) => (exists(file) ? new Set([...read(file).matchAll(re)].map((m) => m[1])) : new Set());
  const questions = tableIds('docs/requirements/OPEN_QUESTIONS.md', /^\|\s*(Q-\d{3})\s*\|/gm);
  const sdIds = tableIds('docs/requirements/SOW_DEVIATIONS.md', /^\|\s*(SD-\d{2})\s*\|/gm);
  const crIds = tableIds('plans/BACKLOG.md', /^\|\s*(CR-\d{2})\s*\|/gm);
  const factIds = tableIds('docs/research/TECH_FEASIBILITY.md', /^\|\s*([FVD]-\d{2})\s*\|/gm);
  const riskIds = tableIds('plans/RISKS_AND_DEPENDENCIES.md', /^\|\s*(R-\d{2})\s*\|/gm);
  const threatIds = tableIds('docs/security/THREAT_MODEL.md', /^\|\s*(T-\d{2})\s*\|/gm);
  const adrIds = new Set(exists('docs/decisions') ? readdirSync(join(root, 'docs/decisions')).map((n) => n.match(/^(ADR-\d{4})-/)?.[1]).filter(Boolean) : []);
  const reqText = read('docs/requirements/REQUIREMENTS.md');
  const defined = new Set([...reqText.matchAll(/^\|\s*((?:CLR|EXC|ASM)-\d{2,3})\s*\|/gm)].map((m) => m[1]));
  for (const rel of walk('').filter((f) => f.endsWith('.md') && !isTemplateDoc(f) && !f.startsWith('.claude/projects'))) {
    const text = stripCode(read(rel));
    for (const m of text.matchAll(/\b(REQ-[A-Z]+-\d{3}|NFR-\d{3})\b/g)) if (!ids.has(m[1])) err(rel, `references unknown requirement ${m[1]}`);
    for (const m of text.matchAll(/\bQ-\d{3}\b/g)) if (!questions.has(m[0])) err(rel, `references unknown question ${m[0]}`);
    for (const m of text.matchAll(/\b(?:CLR|EXC|ASM)-\d{2,3}\b/g)) if (!defined.has(m[0])) err(rel, `references unknown ${m[0]}`);
    for (const m of text.matchAll(/\bSD-\d{2}\b/g)) if (!sdIds.has(m[0])) err(rel, `references unknown deviation ${m[0]}`);
    for (const m of text.matchAll(/\bCR-\d{2}\b/g)) if (!crIds.has(m[0])) err(rel, `references unknown change request ${m[0]}`);
    for (const m of text.matchAll(/\b[FVD]-\d{2}\b/g)) if (!factIds.has(m[0])) err(rel, `references unknown feasibility item ${m[0]}`);
    for (const m of text.matchAll(/\bV-(\d{2})[a-z]\b/g)) if (!factIds.has(`V-${m[1]}`)) err(rel, `references unknown verification ${m[0]}`);
    for (const m of text.matchAll(/\bR-\d{2}\b/g)) if (!riskIds.has(m[0])) err(rel, `references unknown risk ${m[0]}`);
    for (const m of text.matchAll(/\bT-\d{2}\b/g)) if (!threatIds.has(m[0])) err(rel, `references unknown threat ${m[0]}`);
    for (const m of text.matchAll(/\bADR-\d{4}\b/g)) if (!adrIds.has(m[0])) err(rel, `references unknown ADR ${m[0]}`);
  }
  return ids.size;
}

function checkPlans() {
  const master = exists('plans/MASTER_PLAN.md') ? read('plans/MASTER_PLAN.md') : '';
  const taskIds = new Set();
  for (const [phase, f] of Object.entries(PHASE_FILES)) {
    const rel = `plans/phases/${f}`;
    if (!exists(rel)) continue;
    if (!master.includes(f)) err('plans/MASTER_PLAN.md', `does not link ${f}`);
    const text = read(rel);
    for (const h of ['## Objective', '## Scope', '## Prerequisites', '## Requirement IDs', '## Architecture and design decisions',
      '## Tasks', '## Dependencies and blockers', '## Security considerations', '## Testing', '## Acceptance criteria',
      '## Definition of done', '## Review and sign-off', '## Rollback and recovery']) {
      if (!text.includes(h)) err(rel, `missing section "${h}"`);
    }
    for (const t of parseTables(text)) {
      if (t.headers[0] !== 'ID' || !t.headers.includes('Task')) continue;
      for (const r of t.rows) {
        if (!new RegExp(`^P${phase}-\\d{2}$`).test(r.ID)) err(rel, `task id "${r.ID}" must look like P${phase}-NN`);
        if (taskIds.has(r.ID)) err(rel, `duplicate task id ${r.ID}`);
        taskIds.add(r.ID);
      }
    }
  }
  if (exists('plans/BACKLOG.md')) {
    for (const t of parseTables(read('plans/BACKLOG.md'))) {
      if (t.headers[0] !== 'ID' || !t.headers.includes('Status') || !t.headers.includes('Depends on')) continue;
      for (const r of t.rows) {
        if (!taskIds.has(r.ID)) err('plans/BACKLOG.md', `${r.ID} is not defined in a phase plan`);
        if (!TASK_STATUSES.has(r.Status)) err('plans/BACKLOG.md', `${r.ID} has invalid status "${r.Status}"`);
        for (const dep of r['Depends on'].match(/P\d[AB]?-\d{2}/g) ?? []) {
          if (!taskIds.has(dep)) err('plans/BACKLOG.md', `${r.ID} depends on unknown task ${dep}`);
        }
      }
    }
  }
  return taskIds.size;
}

// ---------------------------------------------------------------- main

if (process.argv.includes('--ids-by-phase')) {
  const byPhase = {};
  for (const r of parseRequirements()) (byPhase[r.Phase] ??= []).push(r.ID);
  for (const p of Object.keys(PHASE_FILES)) console.log(`${p}: ${(byPhase[p] ?? []).join(', ')}`);
  process.exit(0);
}

checkRequiredFiles();
checkToolchain();
checkAgents();
checkSkills();
checkRules();
checkJsonConfigs();
let reqCount = 0;
let taskCount = 0;
if (exists('docs/requirements/REQUIREMENTS.md') && exists('docs/requirements/TRACEABILITY.md') && exists('docs/requirements/OPEN_QUESTIONS.md')) {
  reqCount = checkRequirements();
  taskCount = checkPlans();
}
checkLinks();
checkSecrets();

const count = (d, ext) => (exists(d) ? readdirSync(join(root, d)).filter((f) => !ext || f.endsWith(ext)).length : 0);
console.log(`agents: ${count('.claude/agents', '.md')}  skills: ${count('.claude/skills')}  rules: ${exists('.claude/rules') ? walk('.claude/rules').length : 0}  requirements: ${reqCount}  phase tasks: ${taskCount}`);
for (const w of warnings) console.log(`WARN  ${toPosix(w)}`);
for (const e of errors) console.log(`ERROR ${toPosix(e)}`);
console.log(errors.length === 0 ? 'framework check: OK' : `framework check: ${errors.length} error(s)`);
process.exit(errors.length === 0 ? 0 : 1);
