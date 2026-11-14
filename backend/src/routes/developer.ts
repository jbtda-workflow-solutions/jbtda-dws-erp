import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRole } from '../plugins/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type DocCategory =
  | 'ROOT_GOVERNANCE'
  | 'ROADMAP_AND_HISTORY'
  | 'TECHNICAL_SPECIFICATION';

export interface DeveloperDocMeta {
  path: string;
  fileName: string;
  title: string;
  category: DocCategory;
  sizeBytes: number;
  lineCount: number;
  lastModified: string;
}

export interface RoadmapChecklistItem {
  id: string;
  title: string;
  completed: boolean;
  details: string[];
}

export interface RoadmapModuleSummary {
  moduleNumber: number;
  heading: string;
  title: string;
  completedBadge: boolean;
  objective: string;
  completedCount: number;
  pendingCount: number;
  totalCount: number;
  completionPercent: number;
  items: RoadmapChecklistItem[];
}

const ROOT_ALLOWLIST = ['AGENTS.md', 'AGENT_SPECIFICATION.md'] as const;

const DOCS_PRIORITY_ORDER: string[] = [
  'AGENTS.md',
  'AGENT_SPECIFICATION.md',
  'docs/STAGES_ROADMAP.md',
  'docs/CHANGELOG.md',
  'docs/ARCHITECTURE.md',
  'docs/DATABASE_SCHEMA.md',
  'docs/SECURITY.md',
  'docs/DESIGN_SYSTEM.md',
  'docs/PLUGINS.md',
  'docs/INTEGRATIONS.md',
];

function resolveRepoRoot(): string {
  const candidates = [
    '/app',
    path.resolve(__dirname, '../../..'),
    path.resolve(process.cwd(), '..'),
    process.cwd(),
  ];

  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'AGENTS.md')) ||
      fs.existsSync(path.join(candidate, 'docs', 'ARCHITECTURE.md'))
    ) {
      return candidate;
    }
  }

  return path.resolve(__dirname, '../../..');
}

function classifyDocCategory(docKey: string): DocCategory {
  if (docKey === 'AGENTS.md' || docKey === 'AGENT_SPECIFICATION.md') {
    return 'ROOT_GOVERNANCE';
  }
  if (docKey === 'docs/STAGES_ROADMAP.md' || docKey === 'docs/CHANGELOG.md') {
    return 'ROADMAP_AND_HISTORY';
  }
  return 'TECHNICAL_SPECIFICATION';
}

function extractMarkdownTitle(content: string, fallbackName: string): string {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return fallbackName;
}

/**
 * Builds an explicit, canonical map of allowlisted documentation keys -> verified absolute paths.
 * User input is NEVER concatenated into filesystem paths; lookups strictly match keys in this map.
 */
function buildAllowlistedDocsMap(): Map<string, string> {
  const repoRoot = resolveRepoRoot();
  const map = new Map<string, string>();

  for (const rootFile of ROOT_ALLOWLIST) {
    const absPath = path.resolve(repoRoot, rootFile);
    if (
      path.dirname(absPath) === repoRoot &&
      fs.existsSync(absPath) &&
      fs.statSync(absPath).isFile()
    ) {
      map.set(rootFile, absPath);
    }
  }

  const docsDir = path.resolve(repoRoot, 'docs');
  if (fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()) {
    const entries = fs.readdirSync(docsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^[A-Za-z0-9_-]+\.md$/.test(entry.name)) continue;

      const absPath = path.resolve(docsDir, entry.name);
      if (path.dirname(absPath) !== docsDir) continue;

      map.set(`docs/${entry.name}`, absPath);
    }
  }

  return map;
}

function readDocMeta(docKey: string, absPath: string): DeveloperDocMeta {
  const stat = fs.statSync(absPath);
  const content = fs.readFileSync(absPath, 'utf8');
  const fileName = path.basename(absPath);
  const lineCount = content.length === 0 ? 0 : content.split(/\r?\n/).length;

  return {
    path: docKey,
    fileName,
    title: extractMarkdownTitle(content, fileName),
    category: classifyDocCategory(docKey),
    sizeBytes: stat.size,
    lineCount,
    lastModified: stat.mtime.toISOString(),
  };
}

function parseStagesRoadmap(markdown: string): RoadmapModuleSummary[] {
  const lines = markdown.split(/\r?\n/);
  const modules: RoadmapModuleSummary[] = [];

  let currentModule: RoadmapModuleSummary | null = null;
  let currentItem: RoadmapChecklistItem | null = null;

  for (const rawLine of lines) {
    const moduleMatch = /^###\s+Module\s+(\d+):\s+(.+)$/.exec(rawLine.trim());
    if (moduleMatch && moduleMatch[1] && moduleMatch[2]) {
      const moduleNumber = Number(moduleMatch[1]);
      const rawHeading = moduleMatch[2].trim();
      const completedBadge = /COMPLETED|✅/i.test(rawHeading);
      const cleanTitle = rawHeading
        .replace(/\(\s*✅?\s*COMPLETED\s*\)/gi, '')
        .trim();

      currentModule = {
        moduleNumber,
        heading: `Module ${moduleNumber}: ${cleanTitle}`,
        title: cleanTitle,
        completedBadge,
        objective: '',
        completedCount: 0,
        pendingCount: 0,
        totalCount: 0,
        completionPercent: 0,
        items: [],
      };
      modules.push(currentModule);
      currentItem = null;
      continue;
    }

    if (!currentModule) continue;

    const objectiveMatch = /^\*\*Objective:\*\*\s*(.+)$/.exec(rawLine.trim());
    if (objectiveMatch && objectiveMatch[1] && !currentModule.objective) {
      currentModule.objective = objectiveMatch[1].trim();
      continue;
    }

    const checklistMatch = /^-\s+\[([ xX])\]\s+(.+)$/.exec(rawLine);
    if (checklistMatch && checklistMatch[1] && checklistMatch[2]) {
      const completed = checklistMatch[1].toLowerCase() === 'x';
      const rawText = checklistMatch[2].trim().replace(/:$/, '');
      const boldMatch = /^\*\*([^*]+)\*\*(.*)$/.exec(rawText);

      let itemId = `${currentModule.moduleNumber}.${currentModule.items.length + 1}`;
      let itemTitle = rawText.replace(/\*\*/g, '').trim();

      if (boldMatch && boldMatch[1]) {
        const boldPart = boldMatch[1].trim();
        const restPart = (boldMatch[2] ?? '').replace(/^:\s*/, '').trim();
        const numPrefix = /^(\d+\.\d+)\s+(.+)$/.exec(boldPart);
        if (numPrefix && numPrefix[1] && numPrefix[2]) {
          itemId = numPrefix[1];
          itemTitle = restPart ? `${numPrefix[2]} — ${restPart}` : numPrefix[2];
        } else {
          itemTitle = restPart ? `${boldPart} — ${restPart}` : boldPart;
        }
      }

      currentItem = {
        id: itemId,
        title: itemTitle,
        completed,
        details: [],
      };
      currentModule.items.push(currentItem);
      continue;
    }

    if (currentItem && /^\s{2,}-\s+(.+)$/.test(rawLine)) {
      const subMatch = /^\s{2,}-\s+(.+)$/.exec(rawLine);
      if (subMatch && subMatch[1]) {
        currentItem.details.push(subMatch[1].trim());
      }
    }
  }

  for (const mod of modules) {
    mod.completedCount = mod.items.filter((i) => i.completed).length;
    mod.pendingCount = mod.items.filter((i) => !i.completed).length;
    mod.totalCount = mod.items.length;
    mod.completionPercent =
      mod.totalCount > 0
        ? Math.round((mod.completedCount / mod.totalCount) * 100)
        : mod.completedBadge
          ? 100
          : 0;
  }

  return modules;
}

function hasFrontendDistBundle(): boolean {
  const repoRoot = resolveRepoRoot();
  const candidates = [
    process.env['FRONTEND_DIST_PATH'],
    '/app/frontend/dist',
    path.resolve(repoRoot, 'frontend/dist'),
  ].filter((p): p is string => Boolean(p));

  return candidates.some(
    (dir) => fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html')),
  );
}

export const developerRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/v1/developer/docs
  // Whitelisted directory index of repository governance & specification files
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/developer/docs',
    { preHandler: [requireRole('ADMIN')] },
    async () => {
      const allowlist = buildAllowlistedDocsMap();
      const docs: DeveloperDocMeta[] = [];

      for (const [docKey, absPath] of allowlist.entries()) {
        docs.push(readDocMeta(docKey, absPath));
      }

      docs.sort((a, b) => {
        const idxA = DOCS_PRIORITY_ORDER.indexOf(a.path);
        const idxB = DOCS_PRIORITY_ORDER.indexOf(b.path);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.path.localeCompare(b.path);
      });

      return { files: docs };
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/developer/docs/content?path=...
  // Returns raw Markdown content + metadata for a strictly allowlisted doc key
  // -------------------------------------------------------------------------
  fastify.get<{ Querystring: { path?: string } }>(
    '/api/v1/developer/docs/content',
    { preHandler: [requireRole('ADMIN')] },
    async (request, reply) => {
      const requestedKey = (request.query.path ?? '').trim();
      if (!requestedKey) {
        return reply.code(400).send({
          error: 'Query parameter "path" is required.',
        });
      }

      const allowlist = buildAllowlistedDocsMap();
      const absPath = allowlist.get(requestedKey);
      if (!absPath) {
        return reply.code(404).send({
          error: `Documentation file "${requestedKey}" is not in the allowlisted repository index.`,
        });
      }

      const doc = readDocMeta(requestedKey, absPath);
      const content = fs.readFileSync(absPath, 'utf8');

      return { doc, content };
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/developer/roadmap-summary
  // Parses docs/STAGES_ROADMAP.md into structured module & checklist metrics
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/developer/roadmap-summary',
    { preHandler: [requireRole('ADMIN')] },
    async (_request, reply) => {
      const allowlist = buildAllowlistedDocsMap();
      const roadmapPath = allowlist.get('docs/STAGES_ROADMAP.md');

      if (!roadmapPath) {
        return reply.code(404).send({
          error: 'docs/STAGES_ROADMAP.md is not available in the runtime bundle.',
        });
      }

      const stat = fs.statSync(roadmapPath);
      const markdown = fs.readFileSync(roadmapPath, 'utf8');
      const modules = parseStagesRoadmap(markdown);

      const totalModules = modules.length;
      const completedModules = modules.filter(
        (m) => m.totalCount > 0 && m.completedCount === m.totalCount,
      ).length;
      const totalChecklistItems = modules.reduce((sum, m) => sum + m.totalCount, 0);
      const completedChecklistItems = modules.reduce(
        (sum, m) => sum + m.completedCount,
        0,
      );
      const pendingChecklistItems = totalChecklistItems - completedChecklistItems;
      const overallCompletionPercent =
        totalChecklistItems > 0
          ? Math.round((completedChecklistItems / totalChecklistItems) * 100)
          : 0;

      return {
        sourcePath: 'docs/STAGES_ROADMAP.md',
        lastModified: stat.mtime.toISOString(),
        totalModules,
        completedModules,
        totalChecklistItems,
        completedChecklistItems,
        pendingChecklistItems,
        overallCompletionPercent,
        modules,
      };
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/v1/developer/diagnostics
  // Safe, read-only runtime, database health, & tenant governance diagnostics.
  // Strictly redacts all secrets (never exposes DB_PASSWORD, SESSION_SECRET, etc.)
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/developer/diagnostics',
    { preHandler: [requireRole('ADMIN')] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;

      const org = await fastify.prisma.organization.findFirst({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          legalName: true,
          abn: true,
          defaultPaymentTermsDays: true,
          fiscalYearStartMonth: true,
          lockDate: true,
          enforceTwoPersonApproval: true,
          enabledModules: true,
          createdAt: true,
        },
      });

      if (!org) {
        return reply.code(404).send({ error: 'Organization not found.' });
      }

      let dbStatus: 'CONNECTED' | 'DEGRADED' = 'CONNECTED';
      let dbLatencyMs = 0;
      const pingStart = Date.now();
      try {
        await fastify.prisma.$queryRaw`SELECT 1`;
        dbLatencyMs = Date.now() - pingStart;
      } catch {
        dbStatus = 'DEGRADED';
        dbLatencyMs = Date.now() - pingStart;
      }

      const [
        accountsCount,
        contactsCount,
        invoicesCount,
        billsCount,
        journalEntriesCount,
        auditLogsCount,
        membersCount,
      ] = await Promise.all([
        fastify.prisma.account.count({ where: { organizationId } }),
        fastify.prisma.contact.count({ where: { organizationId } }),
        fastify.prisma.invoice.count({ where: { organizationId } }),
        fastify.prisma.bill.count({ where: { organizationId } }),
        fastify.prisma.journalEntry.count({ where: { organizationId } }),
        fastify.prisma.auditLog.count({ where: { organizationId } }),
        fastify.prisma.organizationMember.count({ where: { organizationId } }),
      ]);

      const allowlist = buildAllowlistedDocsMap();
      const mem = process.memoryUsage();

      return {
        runtime: {
          nodeVersion: process.version,
          platform: `${process.platform}/${process.arch}`,
          nodeEnv: process.env['NODE_ENV'] ?? 'development',
          port: Number(process.env['PORT'] ?? 8080),
          host: process.env['HOST'] ?? '0.0.0.0',
          uptimeSeconds: Math.floor(process.uptime()),
          memoryRssBytes: mem.rss,
          memoryHeapUsedBytes: mem.heapUsed,
          serverTimestamp: new Date().toISOString(),
        },
        configuration: {
          autoSchemaPush: process.env['AUTO_SCHEMA_PUSH'] ?? 'unset',
          dbForceReset: process.env['DB_FORCE_RESET'] ?? 'unset',
          frontendDistBundled: hasFrontendDistBundle(),
          docsAllowlistCount: allowlist.size,
          cloudSqlSocketConfigured: Boolean(process.env['INSTANCE_CONNECTION_NAME']),
          googleClientIdConfigured: Boolean(process.env['GOOGLE_CLIENT_ID']),
          frontendOriginConfigured: Boolean(process.env['FRONTEND_ORIGIN']),
          secretsPresenceRedacted: {
            dbPasswordConfigured: Boolean(process.env['DB_PASSWORD']),
            sessionSecretConfigured: Boolean(process.env['SESSION_SECRET']),
            webhookSecretConfigured: Boolean(process.env['WEBHOOK_SECRET']),
          },
        },
        database: {
          status: dbStatus,
          latencyMs: dbLatencyMs,
          tenantMetrics: {
            accountsCount,
            contactsCount,
            invoicesCount,
            billsCount,
            journalEntriesCount,
            auditLogsCount,
            membersCount,
          },
        },
        organization: {
          id: org.id,
          name: org.name,
          legalName: org.legalName,
          abn: org.abn,
          baseCurrency: 'AUD',
          defaultPaymentTermsDays: org.defaultPaymentTermsDays,
          fiscalYearStartMonth: org.fiscalYearStartMonth,
          lockDate: org.lockDate ? org.lockDate.toISOString().slice(0, 10) : null,
          enforceTwoPersonApproval: org.enforceTwoPersonApproval,
          enabledModules: org.enabledModules,
          developerPortalFlagEnabled: org.enabledModules.includes('DEVELOPER_PORTAL'),
          createdAt: org.createdAt.toISOString(),
        },
      };
    },
  );
};
