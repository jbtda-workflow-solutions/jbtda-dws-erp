import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireRole } from '../plugins/auth.js';
import { runStartupSchemaSync } from '../lib/schema-sync.js';
import { recordAuditLog } from '../lib/audit.js';

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

export interface ApiEndpointItem {
  verb: string;
  path: string;
  authRequired: string;
  rbacScope: string;
  purpose: string;
}

export interface ApiEndpointGroup {
  sectionNumber: number;
  title: string;
  basePath: string;
  endpoints: ApiEndpointItem[];
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

function parseArchitectureApiCatalog(markdown: string): ApiEndpointGroup[] {
  const lines = markdown.split(/\r?\n/);
  const groups: ApiEndpointGroup[] = [];

  let inDirectory = false;
  let currentGroup: ApiEndpointGroup | null = null;
  let isInfraTable = false;
  let headerSeen = false;
  let separatorSeen = false;

  const stripBackticks = (s: string) => s.replace(/`/g, '').trim();

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed === '## Master Monolith Entrypoint Directory') {
      inDirectory = true;
      continue;
    }

    if (!inDirectory) continue;

    // Stop if another top-level H2 section begins
    if (/^##\s+/.test(trimmed)) {
      break;
    }

    const sectionMatch = /^###\s+(\d+)\.\s+(.+)$/.exec(trimmed);
    if (sectionMatch && sectionMatch[1] && sectionMatch[2]) {
      const sectionNumber = Number(sectionMatch[1]);
      const rawTitle = sectionMatch[2].trim();

      // Skip Frontend Client Routes table (non-API SPA routes)
      if (/Frontend Client Routes/i.test(rawTitle)) {
        currentGroup = null;
        continue;
      }

      const pathMatch = /\(([^)]+)\)\s*$/.exec(rawTitle);
      const basePath = pathMatch && pathMatch[1]
        ? stripBackticks(pathMatch[1])
        : 'System / Root';
      const cleanTitle = rawTitle.replace(/\s*\([^)]+\)\s*$/, '').trim();

      currentGroup = {
        sectionNumber,
        title: cleanTitle,
        basePath,
        endpoints: [],
      };
      groups.push(currentGroup);
      isInfraTable = sectionNumber === 1;
      headerSeen = false;
      separatorSeen = false;
      continue;
    }

    if (!currentGroup) continue;

    if (!trimmed.startsWith('|')) {
      continue;
    }

    if (!headerSeen) {
      headerSeen = true;
      continue;
    }

    if (!separatorSeen) {
      separatorSeen = true;
      continue;
    }

    const cells = trimmed
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());

    if (cells.length < 5) continue;

    const verb = stripBackticks(cells[0] ?? '');
    const endpointPath = stripBackticks(cells[1] ?? '');
    const authRequired = stripBackticks(cells[2] ?? '');

    if (isInfraTable) {
      const purpose = (cells[3] ?? '').replace(/<br\s*\/?>/gi, ' · ');
      const responseInfo = stripBackticks((cells[4] ?? '').replace(/<br\s*\/?>/gi, ' | '));
      currentGroup.endpoints.push({
        verb,
        path: endpointPath,
        authRequired,
        rbacScope: 'Public / Infra',
        purpose: responseInfo ? `${purpose} (${responseInfo})` : purpose,
      });
    } else {
      const rbacScope = stripBackticks(cells[3] ?? '');
      const purpose = (cells[4] ?? '').replace(/<br\s*\/?>/gi, ' · ');
      currentGroup.endpoints.push({
        verb,
        path: endpointPath,
        authRequired,
        rbacScope,
        purpose,
      });
    }
  }

  return groups;
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
  // GET /api/v1/developer/api-catalog
  // Parses docs/ARCHITECTURE.md into a structured API endpoint reference catalog
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/developer/api-catalog',
    { preHandler: [requireRole('ADMIN')] },
    async (_request, reply) => {
      const allowlist = buildAllowlistedDocsMap();
      const archPath = allowlist.get('docs/ARCHITECTURE.md');

      if (!archPath) {
        return reply.code(404).send({
          error: 'docs/ARCHITECTURE.md is not available in the runtime bundle.',
        });
      }

      const stat = fs.statSync(archPath);
      const markdown = fs.readFileSync(archPath, 'utf8');
      const groups = parseArchitectureApiCatalog(markdown);

      const allEndpoints = groups.flatMap((g) => g.endpoints);
      const verbCounts: Record<string, number> = {};
      let publicCount = 0;
      let adminOnlyCount = 0;

      for (const ep of allEndpoints) {
        const v = ep.verb.toUpperCase();
        verbCounts[v] = (verbCounts[v] ?? 0) + 1;
        if (/public|no\s*\(public\)/i.test(ep.authRequired)) {
          publicCount += 1;
        }
        if (ep.rbacScope.trim() === 'ADMIN') {
          adminOnlyCount += 1;
        }
      }

      return {
        sourcePath: 'docs/ARCHITECTURE.md',
        lastModified: stat.mtime.toISOString(),
        totalGroups: groups.length,
        totalEndpoints: allEndpoints.length,
        publicEndpointsCount: publicCount,
        adminOnlyEndpointsCount: adminOnlyCount,
        verbCounts,
        groups,
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
          schemaManagementMode: 'PRISMA_NATIVE_SELF_HEAL',
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

  // -------------------------------------------------------------------------
  // GET /api/v1/developer/database/tables
  // Returns live row counts (Organization vs. Global) and dependency metadata
  // for all clearable ERP PostgreSQL tables, plus permanently protected identity tables.
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/v1/developer/database/tables',
    { preHandler: [requireRole('ADMIN')] },
    async (request) => {
      const organizationId = request.user.organizationId!;
      const p = fastify.prisma;

      const [
        usersGlobal,
        orgsGlobal,
        membersOrg,
        membersGlobal,
        invitesOrg,
        invitesGlobal,
        billsOrg,
        billsGlobal,
        billLinesOrg,
        billLinesGlobal,
        posOrg,
        posGlobal,
        poLinesOrg,
        poLinesGlobal,
        vendorCreditsOrg,
        vendorCreditsGlobal,
        vendorCreditLinesOrg,
        vendorCreditLinesGlobal,
        paymentsOutOrg,
        paymentsOutGlobal,
        batchPaymentsOrg,
        batchPaymentsGlobal,
        invoicesOrg,
        invoicesGlobal,
        invoiceLinesOrg,
        invoiceLinesGlobal,
        quotesOrg,
        quotesGlobal,
        quoteLinesOrg,
        quoteLinesGlobal,
        creditNotesOrg,
        creditNotesGlobal,
        creditNoteLinesOrg,
        creditNoteLinesGlobal,
        paymentsInOrg,
        paymentsInGlobal,
        directTxOrg,
        directTxGlobal,
        directTxLinesOrg,
        directTxLinesGlobal,
        claimsOrg,
        claimsGlobal,
        claimItemsOrg,
        claimItemsGlobal,
        statementsOrg,
        statementsGlobal,
        transfersOrg,
        transfersGlobal,
        schedulesOrg,
        schedulesGlobal,
        journalsOrg,
        journalsGlobal,
        journalLinesOrg,
        journalLinesGlobal,
        contactsOrg,
        contactsGlobal,
        itemsOrg,
        itemsGlobal,
        trackingCatsOrg,
        trackingCatsGlobal,
        trackingOptsOrg,
        trackingOptsGlobal,
        customAccountsOrg,
        customAccountsGlobal,
        systemAccountsOrg,
        systemAccountsGlobal,
        auditLogsOrg,
        auditLogsGlobal,
      ] = await Promise.all([
        p.user.count(),
        p.organization.count(),
        p.organizationMember.count({ where: { organizationId } }),
        p.organizationMember.count(),
        p.organizationInvite.count({ where: { organizationId } }),
        p.organizationInvite.count(),
        p.bill.count({ where: { organizationId } }),
        p.bill.count(),
        p.billLineItem.count({ where: { organizationId } }),
        p.billLineItem.count(),
        p.purchaseOrder.count({ where: { organizationId } }),
        p.purchaseOrder.count(),
        p.purchaseOrderLineItem.count({ where: { organizationId } }),
        p.purchaseOrderLineItem.count(),
        p.vendorCredit.count({ where: { organizationId } }),
        p.vendorCredit.count(),
        p.vendorCreditLineItem.count({ where: { organizationId } }),
        p.vendorCreditLineItem.count(),
        p.paymentOut.count({ where: { organizationId } }),
        p.paymentOut.count(),
        p.batchPayment.count({ where: { organizationId } }),
        p.batchPayment.count(),
        p.invoice.count({ where: { organizationId } }),
        p.invoice.count(),
        p.invoiceLineItem.count({ where: { organizationId } }),
        p.invoiceLineItem.count(),
        p.quote.count({ where: { organizationId } }),
        p.quote.count(),
        p.quoteLineItem.count({ where: { organizationId } }),
        p.quoteLineItem.count(),
        p.creditNote.count({ where: { organizationId } }),
        p.creditNote.count(),
        p.creditNoteLineItem.count({ where: { organizationId } }),
        p.creditNoteLineItem.count(),
        p.paymentIn.count({ where: { organizationId } }),
        p.paymentIn.count(),
        p.directTransaction.count({ where: { organizationId } }),
        p.directTransaction.count(),
        p.directTransactionLine.count({ where: { organizationId } }),
        p.directTransactionLine.count(),
        p.expenseClaim.count({ where: { organizationId } }),
        p.expenseClaim.count(),
        p.expenseClaimItem.count({ where: { organizationId } }),
        p.expenseClaimItem.count(),
        p.bankStatementLine.count({ where: { organizationId } }),
        p.bankStatementLine.count(),
        p.bankTransfer.count({ where: { organizationId } }),
        p.bankTransfer.count(),
        p.recurringSchedule.count({ where: { organizationId } }),
        p.recurringSchedule.count(),
        p.journalEntry.count({ where: { organizationId } }),
        p.journalEntry.count(),
        p.journalLine.count({ where: { organizationId } }),
        p.journalLine.count(),
        p.contact.count({ where: { organizationId } }),
        p.contact.count(),
        p.item.count({ where: { organizationId } }),
        p.item.count(),
        p.trackingCategory.count({ where: { organizationId } }),
        p.trackingCategory.count(),
        p.trackingOption.count({ where: { organizationId } }),
        p.trackingOption.count(),
        p.account.count({ where: { organizationId, isSystem: false } }),
        p.account.count({ where: { isSystem: false } }),
        p.account.count({ where: { organizationId, isSystem: true } }),
        p.account.count({ where: { isSystem: true } }),
        p.auditLog.count({ where: { organizationId } }),
        p.auditLog.count(),
      ]);

      return {
        protectedIdentityTables: [
          {
            tableName: 'users',
            label: 'Google OAuth Users',
            orgRowCount: membersOrg,
            globalRowCount: usersGlobal,
            reason: 'Permanently protected so Google sign-in sessions and user identities are never wiped.',
          },
          {
            tableName: 'organizations',
            label: 'Tenant Organizations',
            orgRowCount: 1,
            globalRowCount: orgsGlobal,
            reason: 'Permanently protected so legal entity profiles, ABNs, and settings remain intact.',
          },
          {
            tableName: 'organization_members',
            label: 'RBAC Team Memberships',
            orgRowCount: membersOrg,
            globalRowCount: membersGlobal,
            reason: 'Permanently protected so ADMIN and team role bindings are never lost.',
          },
          {
            tableName: 'organization_invites',
            label: 'Pending Workspace Invites',
            orgRowCount: invitesOrg,
            globalRowCount: invitesGlobal,
            reason: 'Permanently protected so pending user invitations remain active.',
          },
          {
            tableName: 'accounts (is_system = true)',
            label: '10 Protected System GL Accounts (1000–6000)',
            orgRowCount: systemAccountsOrg,
            globalRowCount: systemAccountsGlobal,
            reason: 'Core control accounts (Bank 1000, AR 1200, AP 2000, Reimbursements 2050, GST 2100/2200, Retained Earnings 3000, Sales 4000, Expenses 6000) are always preserved.',
          },
        ],
        tables: [
          // Domain: AP
          {
            tableName: 'bills',
            label: 'Vendor Bills',
            domain: 'AP',
            description: 'Supplier AP tax invoices and bills (`bills`).',
            orgRowCount: billsOrg,
            globalRowCount: billsGlobal,
            autoSelectChildren: ['bill_line_items', 'payments_out'],
            recommendedCompanions: ['journal_entries', 'journal_lines'],
          },
          {
            tableName: 'bill_line_items',
            label: 'Vendor Bill Line Items',
            domain: 'AP',
            description: 'Line item distributions on supplier bills (`bill_line_items`).',
            orgRowCount: billLinesOrg,
            globalRowCount: billLinesGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          {
            tableName: 'purchase_orders',
            label: 'Purchase Orders',
            domain: 'AP',
            description: 'Supplier purchase orders (`purchase_orders`).',
            orgRowCount: posOrg,
            globalRowCount: posGlobal,
            autoSelectChildren: ['purchase_order_line_items'],
            recommendedCompanions: [],
          },
          {
            tableName: 'purchase_order_line_items',
            label: 'Purchase Order Line Items',
            domain: 'AP',
            description: 'Line items on purchase orders (`purchase_order_line_items`).',
            orgRowCount: poLinesOrg,
            globalRowCount: poLinesGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          {
            tableName: 'vendor_credits',
            label: 'Vendor Credit Notes',
            domain: 'AP',
            description: 'Supplier AP credit adjustments (`vendor_credits`).',
            orgRowCount: vendorCreditsOrg,
            globalRowCount: vendorCreditsGlobal,
            autoSelectChildren: ['vendor_credit_line_items'],
            recommendedCompanions: ['journal_entries', 'journal_lines'],
          },
          {
            tableName: 'vendor_credit_line_items',
            label: 'Vendor Credit Line Items',
            domain: 'AP',
            description: 'Line items on vendor credit notes (`vendor_credit_line_items`).',
            orgRowCount: vendorCreditLinesOrg,
            globalRowCount: vendorCreditLinesGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          {
            tableName: 'payments_out',
            label: 'Supplier Bill Payments (Payments Out)',
            domain: 'AP',
            description: 'Outgoing supplier bill settlement records (`payments_out`).',
            orgRowCount: paymentsOutOrg,
            globalRowCount: paymentsOutGlobal,
            autoSelectChildren: [],
            recommendedCompanions: ['journal_entries', 'journal_lines'],
          },
          {
            tableName: 'batch_payments',
            label: 'ABA Batch Payment Runs',
            domain: 'AP',
            description: 'Consolidated Australian .ABA batch payment files (`batch_payments`).',
            orgRowCount: batchPaymentsOrg,
            globalRowCount: batchPaymentsGlobal,
            autoSelectChildren: [],
            recommendedCompanions: ['payments_out'],
          },
          // Domain: AR
          {
            tableName: 'invoices',
            label: 'Customer Tax Invoices',
            domain: 'AR',
            description: 'Customer AR tax invoices (`invoices`).',
            orgRowCount: invoicesOrg,
            globalRowCount: invoicesGlobal,
            autoSelectChildren: ['invoice_line_items', 'payments_in'],
            recommendedCompanions: ['journal_entries', 'journal_lines'],
          },
          {
            tableName: 'invoice_line_items',
            label: 'Customer Invoice Line Items',
            domain: 'AR',
            description: 'Line items on customer tax invoices (`invoice_line_items`).',
            orgRowCount: invoiceLinesOrg,
            globalRowCount: invoiceLinesGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          {
            tableName: 'quotes',
            label: 'Customer Quotes & Estimates',
            domain: 'AR',
            description: 'Client commercial quotes (`quotes`).',
            orgRowCount: quotesOrg,
            globalRowCount: quotesGlobal,
            autoSelectChildren: ['quote_line_items'],
            recommendedCompanions: [],
          },
          {
            tableName: 'quote_line_items',
            label: 'Customer Quote Line Items',
            domain: 'AR',
            description: 'Line items on client quotes (`quote_line_items`).',
            orgRowCount: quoteLinesOrg,
            globalRowCount: quoteLinesGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          {
            tableName: 'credit_notes',
            label: 'Customer AR Credit Notes',
            domain: 'AR',
            description: 'Customer credit note adjustments (`credit_notes`).',
            orgRowCount: creditNotesOrg,
            globalRowCount: creditNotesGlobal,
            autoSelectChildren: ['credit_note_line_items'],
            recommendedCompanions: ['journal_entries', 'journal_lines'],
          },
          {
            tableName: 'credit_note_line_items',
            label: 'Customer Credit Note Line Items',
            domain: 'AR',
            description: 'Line items on customer credit notes (`credit_note_line_items`).',
            orgRowCount: creditNoteLinesOrg,
            globalRowCount: creditNoteLinesGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          {
            tableName: 'payments_in',
            label: 'Customer Receipts (Payments In)',
            domain: 'AR',
            description: 'Incoming customer invoice receipts and prepayments (`payments_in`).',
            orgRowCount: paymentsInOrg,
            globalRowCount: paymentsInGlobal,
            autoSelectChildren: [],
            recommendedCompanions: ['journal_entries', 'journal_lines'],
          },
          // Domain: EXPENSES
          {
            tableName: 'direct_transactions',
            label: 'Direct Spend & Receive Money',
            domain: 'EXPENSES',
            description: 'Direct bank/card spend and receive transactions (`direct_transactions`).',
            orgRowCount: directTxOrg,
            globalRowCount: directTxGlobal,
            autoSelectChildren: ['direct_transaction_lines'],
            recommendedCompanions: ['journal_entries', 'journal_lines'],
          },
          {
            tableName: 'direct_transaction_lines',
            label: 'Direct Transaction Line Items',
            domain: 'EXPENSES',
            description: 'Account allocations on direct spend/receive transactions (`direct_transaction_lines`).',
            orgRowCount: directTxLinesOrg,
            globalRowCount: directTxLinesGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          {
            tableName: 'expense_claims',
            label: 'Employee Expense Claims',
            domain: 'EXPENSES',
            description: 'Staff out-of-pocket reimbursement claims (`expense_claims`).',
            orgRowCount: claimsOrg,
            globalRowCount: claimsGlobal,
            autoSelectChildren: ['expense_claim_items'],
            recommendedCompanions: ['journal_entries', 'journal_lines'],
          },
          {
            tableName: 'expense_claim_items',
            label: 'Expense Claim Receipt Lines',
            domain: 'EXPENSES',
            description: 'Individual merchant receipt lines on expense claims (`expense_claim_items`).',
            orgRowCount: claimItemsOrg,
            globalRowCount: claimItemsGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          // Domain: BANKING
          {
            tableName: 'bank_statement_lines',
            label: 'Imported Bank Statement Lines',
            domain: 'BANKING',
            description: 'Uploaded CSV bank statement feed lines (`bank_statement_lines`).',
            orgRowCount: statementsOrg,
            globalRowCount: statementsGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          {
            tableName: 'bank_transfers',
            label: 'Inter-Account Bank Transfers',
            domain: 'BANKING',
            description: 'Transfers between bank and credit card accounts (`bank_transfers`).',
            orgRowCount: transfersOrg,
            globalRowCount: transfersGlobal,
            autoSelectChildren: [],
            recommendedCompanions: ['journal_entries', 'journal_lines'],
          },
          {
            tableName: 'recurring_schedules',
            label: 'Recurring Transaction Schedules',
            domain: 'BANKING',
            description: 'Automated recurring templates for bills, invoices, and journals (`recurring_schedules`).',
            orgRowCount: schedulesOrg,
            globalRowCount: schedulesGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          // Domain: GL
          {
            tableName: 'journal_entries',
            label: 'General Ledger Journal Entries',
            domain: 'GL',
            description: 'Double-entry GL headers (`journal_entries`). Wiping unmatches any kept bank statement lines.',
            orgRowCount: journalsOrg,
            globalRowCount: journalsGlobal,
            autoSelectChildren: ['journal_lines'],
            recommendedCompanions: [],
          },
          {
            tableName: 'journal_lines',
            label: 'General Ledger Debit/Credit Lines',
            domain: 'GL',
            description: 'Individual debit and credit ledger postings (`journal_lines`).',
            orgRowCount: journalLinesOrg,
            globalRowCount: journalLinesGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          // Domain: MASTER_DATA
          {
            tableName: 'contacts',
            label: 'Contacts Directory (Customers & Suppliers)',
            domain: 'MASTER_DATA',
            description: 'Customer and vendor master records (`contacts`). Keep unchecked to preserve imported contacts.',
            orgRowCount: contactsOrg,
            globalRowCount: contactsGlobal,
            autoSelectChildren: [
              'bills',
              'bill_line_items',
              'payments_out',
              'purchase_orders',
              'purchase_order_line_items',
              'vendor_credits',
              'vendor_credit_line_items',
              'invoices',
              'invoice_line_items',
              'payments_in',
              'quotes',
              'quote_line_items',
              'credit_notes',
              'credit_note_line_items',
            ],
            recommendedCompanions: ['direct_transactions', 'direct_transaction_lines'],
          },
          {
            tableName: 'items',
            label: 'Products & Services Catalog (Items)',
            domain: 'MASTER_DATA',
            description: 'SKU items and standardized pricing (`items`).',
            orgRowCount: itemsOrg,
            globalRowCount: itemsGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          {
            tableName: 'tracking_categories',
            label: 'Cost Centre Tracking Categories',
            domain: 'MASTER_DATA',
            description: 'Dimensional tracking categories (`tracking_categories`).',
            orgRowCount: trackingCatsOrg,
            globalRowCount: trackingCatsGlobal,
            autoSelectChildren: ['tracking_options'],
            recommendedCompanions: [],
          },
          {
            tableName: 'tracking_options',
            label: 'Cost Centre Tracking Options',
            domain: 'MASTER_DATA',
            description: 'Individual cost centres / department options (`tracking_options`).',
            orgRowCount: trackingOptsOrg,
            globalRowCount: trackingOptsGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
          {
            tableName: 'accounts',
            label: 'Custom GL Accounts (Excludes 10 System Accounts)',
            domain: 'MASTER_DATA',
            description: 'User-created Chart of Accounts entries (`is_system = false`). Requires wiping `journal_lines` & `expense_claim_items` first.',
            orgRowCount: customAccountsOrg,
            globalRowCount: customAccountsGlobal,
            autoSelectChildren: [
              'journal_entries',
              'journal_lines',
              'direct_transactions',
              'direct_transaction_lines',
              'expense_claims',
              'expense_claim_items',
            ],
            recommendedCompanions: [],
          },
          // Domain: AUDIT
          {
            tableName: 'audit_logs',
            label: 'System Audit Log Events',
            domain: 'AUDIT',
            description: 'Append-only audit trail events (`audit_logs`).',
            orgRowCount: auditLogsOrg,
            globalRowCount: auditLogsGlobal,
            autoSelectChildren: [],
            recommendedCompanions: [],
          },
        ],
      };
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/developer/database/sync-schema
  // Triggers on-demand Prisma schema self-healing (`prisma db push`) and
  // re-verifies the 10 Protected System GL Accounts across all organizations.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/v1/developer/database/sync-schema',
    { preHandler: [requireRole('ADMIN')] },
    async (request) => {
      const organizationId = request.user.organizationId!;
      const result = await runStartupSchemaSync(fastify.prisma, fastify.log);

      await recordAuditLog(fastify.prisma, {
        organizationId,
        actorUserId: request.user.userId,
        action: 'PRISMA_SCHEMA_SELF_HEAL',
        entityType: 'DATABASE',
        entityId: organizationId,
        summary: `Executed Prisma schema self-heal and verified system GL accounts across ${result.organizationsVerified} organization(s) (${result.durationMs}ms).`,
        metadata: {
          success: result.success,
          durationMs: result.durationMs,
          organizationsVerified: result.organizationsVerified,
        },
      });

      return result;
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/v1/developer/database/purge-tables
  // Dependency-aware selective table purge (ORGANIZATION or GLOBAL scope).
  // Permanently protects `users`, `organizations`, `organization_members`,
  // `organization_invites`, and the 10 system GL accounts (`is_system = true`).
  // -------------------------------------------------------------------------
  fastify.post<{
    Body: {
      scope?: 'ORGANIZATION' | 'GLOBAL';
      tables?: string[];
    };
  }>(
    '/api/v1/developer/database/purge-tables',
    { preHandler: [requireRole('ADMIN')] },
    async (request, reply) => {
      const organizationId = request.user.organizationId!;
      const scope = request.body?.scope === 'GLOBAL' ? 'GLOBAL' : 'ORGANIZATION';
      const requestedTables = Array.isArray(request.body?.tables)
        ? request.body.tables.map((t) => String(t).trim().toLowerCase())
        : [];

      const PROTECTED_TABLES = new Set([
        'users',
        'organizations',
        'organization_members',
        'organization_invites',
      ]);

      for (const t of requestedTables) {
        if (PROTECTED_TABLES.has(t)) {
          return reply.code(400).send({
            error: `Table "${t}" is permanently protected and cannot be purged so user logins and organization memberships are preserved.`,
          });
        }
      }

      const selected = new Set<string>(requestedTables);
      if (selected.size === 0) {
        return reply.code(400).send({
          error: 'At least one clearable table must be selected.',
        });
      }

      // Enforce mandatory parent -> child cascades so foreign keys never fail
      if (selected.has('contacts')) {
        [
          'bills',
          'bill_line_items',
          'payments_out',
          'purchase_orders',
          'purchase_order_line_items',
          'vendor_credits',
          'vendor_credit_line_items',
          'invoices',
          'invoice_line_items',
          'payments_in',
          'quotes',
          'quote_line_items',
          'credit_notes',
          'credit_note_line_items',
        ].forEach((c) => selected.add(c));
      }
      if (selected.has('accounts')) {
        [
          'journal_entries',
          'journal_lines',
          'direct_transactions',
          'direct_transaction_lines',
          'expense_claims',
          'expense_claim_items',
        ].forEach((c) => selected.add(c));
      }
      if (selected.has('bills')) {
        selected.add('bill_line_items');
        selected.add('payments_out');
      }
      if (selected.has('purchase_orders')) {
        selected.add('purchase_order_line_items');
      }
      if (selected.has('vendor_credits')) {
        selected.add('vendor_credit_line_items');
      }
      if (selected.has('invoices')) {
        selected.add('invoice_line_items');
        selected.add('payments_in');
      }
      if (selected.has('quotes')) {
        selected.add('quote_line_items');
      }
      if (selected.has('credit_notes')) {
        selected.add('credit_note_line_items');
      }
      if (selected.has('direct_transactions')) {
        selected.add('direct_transaction_lines');
      }
      if (selected.has('expense_claims')) {
        selected.add('expense_claim_items');
      }
      if (selected.has('journal_entries')) {
        selected.add('journal_lines');
      }
      if (selected.has('tracking_categories')) {
        selected.add('tracking_options');
      }

      const whereScope =
        scope === 'ORGANIZATION' ? { organizationId } : {};

      const deletedCounts: Record<string, number> = {};

      await fastify.prisma.$transaction(async (tx) => {
        // 1. Safe Relational Unlinking before deletions
        if (selected.has('journal_entries') && !selected.has('bank_statement_lines')) {
          await tx.bankStatementLine.updateMany({
            where: whereScope,
            data: {
              isReconciled: false,
              matchedJournalId: null,
              reconciledAt: null,
              reconciledByUserId: null,
            },
          });
        }

        if (selected.has('payments_out') && !selected.has('bills')) {
          await tx.bill.updateMany({
            where: {
              ...whereScope,
              status: { in: ['PAID', 'PARTIALLY_PAID'] },
            },
            data: {
              amountPaidCents: 0n,
              status: 'AWAITING_PAYMENT',
            },
          });
        }

        if (selected.has('payments_in') && !selected.has('invoices')) {
          await tx.invoice.updateMany({
            where: {
              ...whereScope,
              status: { in: ['PAID', 'PARTIALLY_PAID'] },
            },
            data: {
              amountPaidCents: 0n,
              status: 'ISSUED',
            },
          });
        }

        if (selected.has('contacts') && !selected.has('bank_statement_lines')) {
          await tx.bankStatementLine.updateMany({
            where: whereScope,
            data: { suggestedContactId: null },
          });
        }

        if (selected.has('tracking_options') && !selected.has('bank_statement_lines')) {
          await tx.bankStatementLine.updateMany({
            where: whereScope,
            data: { suggestedTrackingOptionId: null },
          });
        }

        if (selected.has('accounts')) {
          // Unlink custom accounts from contacts, items, and kept statement lines
          const customAccounts = await tx.account.findMany({
            where: { ...whereScope, isSystem: false },
            select: { id: true },
          });
          const customIds = customAccounts.map((a) => a.id);
          if (customIds.length > 0) {
            await tx.contact.updateMany({
              where: {
                ...whereScope,
                defaultRevenueAccountId: { in: customIds },
              },
              data: { defaultRevenueAccountId: null },
            });
            await tx.contact.updateMany({
              where: {
                ...whereScope,
                defaultExpenseAccountId: { in: customIds },
              },
              data: { defaultExpenseAccountId: null },
            });
            await tx.item.updateMany({
              where: {
                ...whereScope,
                incomeAccountId: { in: customIds },
              },
              data: { incomeAccountId: null },
            });
            await tx.item.updateMany({
              where: {
                ...whereScope,
                expenseAccountId: { in: customIds },
              },
              data: { expenseAccountId: null },
            });
            await tx.bankStatementLine.updateMany({
              where: {
                ...whereScope,
                suggestedAccountId: { in: customIds },
              },
              data: { suggestedAccountId: null },
            });
          }
        }

        // 2. Topological Child-to-Parent Deletions
        if (selected.has('journal_lines')) {
          const r = await tx.journalLine.deleteMany({ where: whereScope });
          deletedCounts['journal_lines'] = r.count;
        }
        if (selected.has('journal_entries')) {
          const r = await tx.journalEntry.deleteMany({ where: whereScope });
          deletedCounts['journal_entries'] = r.count;
        }

        if (selected.has('payments_out')) {
          const r = await tx.paymentOut.deleteMany({ where: whereScope });
          deletedCounts['payments_out'] = r.count;
        }
        if (selected.has('batch_payments')) {
          const r = await tx.batchPayment.deleteMany({ where: whereScope });
          deletedCounts['batch_payments'] = r.count;
        }
        if (selected.has('payments_in')) {
          const r = await tx.paymentIn.deleteMany({ where: whereScope });
          deletedCounts['payments_in'] = r.count;
        }

        if (selected.has('vendor_credit_line_items')) {
          const r = await tx.vendorCreditLineItem.deleteMany({ where: whereScope });
          deletedCounts['vendor_credit_line_items'] = r.count;
        }
        if (selected.has('vendor_credits')) {
          const r = await tx.vendorCredit.deleteMany({ where: whereScope });
          deletedCounts['vendor_credits'] = r.count;
        }

        if (selected.has('credit_note_line_items')) {
          const r = await tx.creditNoteLineItem.deleteMany({ where: whereScope });
          deletedCounts['credit_note_line_items'] = r.count;
        }
        if (selected.has('credit_notes')) {
          const r = await tx.creditNote.deleteMany({ where: whereScope });
          deletedCounts['credit_notes'] = r.count;
        }

        if (selected.has('bill_line_items')) {
          const r = await tx.billLineItem.deleteMany({ where: whereScope });
          deletedCounts['bill_line_items'] = r.count;
        }
        if (selected.has('bills')) {
          const r = await tx.bill.deleteMany({ where: whereScope });
          deletedCounts['bills'] = r.count;
        }

        if (selected.has('purchase_order_line_items')) {
          const r = await tx.purchaseOrderLineItem.deleteMany({ where: whereScope });
          deletedCounts['purchase_order_line_items'] = r.count;
        }
        if (selected.has('purchase_orders')) {
          const r = await tx.purchaseOrder.deleteMany({ where: whereScope });
          deletedCounts['purchase_orders'] = r.count;
        }

        if (selected.has('invoice_line_items')) {
          const r = await tx.invoiceLineItem.deleteMany({ where: whereScope });
          deletedCounts['invoice_line_items'] = r.count;
        }
        if (selected.has('invoices')) {
          const r = await tx.invoice.deleteMany({ where: whereScope });
          deletedCounts['invoices'] = r.count;
        }

        if (selected.has('quote_line_items')) {
          const r = await tx.quoteLineItem.deleteMany({ where: whereScope });
          deletedCounts['quote_line_items'] = r.count;
        }
        if (selected.has('quotes')) {
          const r = await tx.quote.deleteMany({ where: whereScope });
          deletedCounts['quotes'] = r.count;
        }

        if (selected.has('direct_transaction_lines')) {
          const r = await tx.directTransactionLine.deleteMany({ where: whereScope });
          deletedCounts['direct_transaction_lines'] = r.count;
        }
        if (selected.has('direct_transactions')) {
          const r = await tx.directTransaction.deleteMany({ where: whereScope });
          deletedCounts['direct_transactions'] = r.count;
        }

        if (selected.has('expense_claim_items')) {
          const r = await tx.expenseClaimItem.deleteMany({ where: whereScope });
          deletedCounts['expense_claim_items'] = r.count;
        }
        if (selected.has('expense_claims')) {
          const r = await tx.expenseClaim.deleteMany({ where: whereScope });
          deletedCounts['expense_claims'] = r.count;
        }

        if (selected.has('bank_statement_lines')) {
          const r = await tx.bankStatementLine.deleteMany({ where: whereScope });
          deletedCounts['bank_statement_lines'] = r.count;
        }
        if (selected.has('bank_transfers')) {
          const r = await tx.bankTransfer.deleteMany({ where: whereScope });
          deletedCounts['bank_transfers'] = r.count;
        }
        if (selected.has('recurring_schedules')) {
          const r = await tx.recurringSchedule.deleteMany({ where: whereScope });
          deletedCounts['recurring_schedules'] = r.count;
        }

        if (selected.has('items')) {
          const r = await tx.item.deleteMany({ where: whereScope });
          deletedCounts['items'] = r.count;
        }
        if (selected.has('contacts')) {
          const r = await tx.contact.deleteMany({ where: whereScope });
          deletedCounts['contacts'] = r.count;
        }
        if (selected.has('tracking_options')) {
          const r = await tx.trackingOption.deleteMany({ where: whereScope });
          deletedCounts['tracking_options'] = r.count;
        }
        if (selected.has('tracking_categories')) {
          const r = await tx.trackingCategory.deleteMany({ where: whereScope });
          deletedCounts['tracking_categories'] = r.count;
        }
        if (selected.has('accounts')) {
          const r = await tx.account.deleteMany({
            where: { ...whereScope, isSystem: false },
          });
          deletedCounts['accounts'] = r.count;
        }

        if (selected.has('audit_logs')) {
          const r = await tx.auditLog.deleteMany({ where: whereScope });
          deletedCounts['audit_logs'] = r.count;
        } else {
          const totalRows = Object.values(deletedCounts).reduce(
            (sum, n) => sum + n,
            0,
          );
          await recordAuditLog(tx, {
            organizationId,
            actorUserId: request.user.userId,
            action: 'DATABASE_TABLE_PURGE',
            entityType: 'DATABASE',
            entityId: organizationId,
            summary: `Purged ${totalRows} row(s) across ${Object.keys(deletedCounts).length} table(s) (Scope: ${scope}).`,
            metadata: {
              scope,
              deletedCounts,
            },
          });
        }
      });

      const totalDeletedRows = Object.values(deletedCounts).reduce(
        (sum, n) => sum + n,
        0,
      );

      return {
        success: true,
        scope,
        tablesPurgedCount: Object.keys(deletedCounts).length,
        totalDeletedRows,
        deletedCounts,
      };
    },
  );
};
