import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  Search,
  Copy,
  Check,
  RefreshCw,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronRight,
  Database,
  Server,
  ShieldCheck,
  History,
  ListChecks,
  Code2,
  Eye,
  Lock,
  Network,
  Trash2,
  AlertTriangle,
  Wrench,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  developerApi,
  orgApi,
  type DeveloperDocMeta,
  type DocCategory,
  type RoadmapSummaryResponse,
  type ApiCatalogResponse,
  type DeveloperDiagnosticsResponse,
  type DeveloperDatabaseTablesResponse,
  type DatabaseTableDomain,
  type SchemaSelfHealResponse,
  type PurgeDatabaseTablesResponse,
  type AuditLogEntry,
} from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { StatusTag } from '@/components/ui/StatusTag';
import { cn } from '@/lib/utils';

type DeveloperTab =
  | 'docs'
  | 'api'
  | 'roadmap'
  | 'changelog'
  | 'diagnostics'
  | 'database';

interface ParsedChangelogRelease {
  version: string;
  date: string;
  title: string;
  sections: Array<{
    heading: string;
    bullets: string[];
  }>;
}

const CATEGORY_LABELS: Record<DocCategory, string> = {
  ROOT_GOVERNANCE: 'Root Agent Governance',
  ROADMAP_AND_HISTORY: 'Roadmap & Release History',
  TECHNICAL_SPECIFICATION: 'Technical Specifications',
};

const CATEGORY_ORDER: DocCategory[] = [
  'ROOT_GOVERNANCE',
  'ROADMAP_AND_HISTORY',
  'TECHNICAL_SPECIFICATION',
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  return `${mins}m ${secs}s`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function parseChangelogMarkdown(markdown: string): ParsedChangelogRelease[] {
  const lines = markdown.split(/\r?\n/);
  const releases: ParsedChangelogRelease[] = [];
  let current: ParsedChangelogRelease | null = null;
  let currentSection: { heading: string; bullets: string[] } | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const releaseMatch = /^##\s+\[([^\]]+)\]\s*[—–-]\s*(\d{4}-\d{2}-\d{2})(?:\s*[—–-]\s*(.+))?$/.exec(
      trimmed,
    );
    if (releaseMatch && releaseMatch[1] && releaseMatch[2]) {
      current = {
        version: releaseMatch[1].trim(),
        date: releaseMatch[2].trim(),
        title: (releaseMatch[3] ?? 'Release Update').trim(),
        sections: [],
      };
      releases.push(current);
      currentSection = null;
      continue;
    }

    if (!current) continue;

    const sectionMatch = /^###\s+(.+)$/.exec(trimmed);
    if (sectionMatch && sectionMatch[1]) {
      currentSection = {
        heading: sectionMatch[1].trim(),
        bullets: [],
      };
      current.sections.push(currentSection);
      continue;
    }

    if (trimmed.startsWith('- ')) {
      if (!currentSection) {
        currentSection = { heading: 'Notes', bullets: [] };
        current.sections.push(currentSection);
      }
      const indentPrefix = /^\s{2,}-\s+/.test(rawLine) ? '↳ ' : '';
      currentSection.bullets.push(indentPrefix + trimmed.slice(2).trim());
    }
  }

  return releases;
}

// ---------------------------------------------------------------------------
// Deterministic Pure-TypeScript Markdown Renderer (Corporate Precision)
// ---------------------------------------------------------------------------

function renderInlineTokens(text: string, highlightQuery?: string): React.ReactNode {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(pattern);

  const highlightText = (segment: string, keyPrefix: string): React.ReactNode => {
    if (!highlightQuery || highlightQuery.trim().length < 2) {
      return segment;
    }
    const escaped = highlightQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const subParts = segment.split(regex);
    if (subParts.length === 1) return segment;
    return subParts.map((sp, idx) =>
      idx % 2 === 1 ? (
        <mark
          key={`${keyPrefix}-hl-${idx}`}
          className="rounded bg-amber-100 px-0.5 text-slate-900"
        >
          {sp}
        </mark>
      ) : (
        sp
      ),
    );
  };

  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={idx}
          className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-slate-800"
        >
          {highlightText(part.slice(1, -1), `c-${idx}`)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={idx} className="font-semibold text-slate-900">
          {highlightText(part.slice(2, -2), `b-${idx}`)}
        </strong>
      );
    }
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (linkMatch && linkMatch[1] && linkMatch[2]) {
      const label = linkMatch[1];
      const href = linkMatch[2];
      const isExternal = /^https?:\/\//i.test(href);
      return isExternal ? (
        <a
          key={idx}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-forest-800 underline decoration-forest-700/40 underline-offset-2 hover:text-forest-900"
        >
          {label}
        </a>
      ) : (
        <span
          key={idx}
          className="font-mono text-[12px] font-medium text-forest-800"
          title={href}
        >
          {label}
        </span>
      );
    }
    return <React.Fragment key={idx}>{highlightText(part, `t-${idx}`)}</React.Fragment>;
  });
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cells = splitTableCells(trimmed);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function MarkdownDocument({
  markdown,
  searchQuery,
}: {
  markdown: string;
  searchQuery?: string;
}) {
  const blocks = useMemo(() => {
    const lines = markdown.split(/\r?\n/);
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();

      if (trimmed === '') {
        i += 1;
        continue;
      }

      // Fenced code block
      if (trimmed.startsWith('```')) {
        const lang = trimmed.slice(3).trim();
        const codeLines: string[] = [];
        i += 1;
        while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
          codeLines.push(lines[i] ?? '');
          i += 1;
        }
        if (i < lines.length) i += 1;
        elements.push(
          <div
            key={`code-${i}`}
            className="my-4 overflow-hidden rounded border border-slate-800 bg-obsidian-950"
          >
            {lang && (
              <div className="flex items-center justify-between border-b border-slate-800 bg-obsidian-900 px-3 py-1.5">
                <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
                  {lang}
                </span>
              </div>
            )}
            <pre className="overflow-x-auto p-3.5 font-mono text-xs leading-relaxed text-slate-100">
              <code>{codeLines.join('\n')}</code>
            </pre>
          </div>,
        );
        continue;
      }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        elements.push(<hr key={`hr-${i}`} className="my-6 border-slate-200" />);
        i += 1;
        continue;
      }

      // Headings
      const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
      if (headingMatch && headingMatch[1] && headingMatch[2]) {
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        if (level === 1) {
          elements.push(
            <h1
              key={`h1-${i}`}
              className="mb-4 mt-2 border-b border-slate-200 pb-2.5 text-lg font-semibold tracking-tight text-slate-900"
            >
              {renderInlineTokens(text, searchQuery)}
            </h1>,
          );
        } else if (level === 2) {
          elements.push(
            <h2
              key={`h2-${i}`}
              className="mb-3 mt-6 border-b border-slate-100 pb-1.5 text-base font-semibold tracking-tight text-slate-900"
            >
              {renderInlineTokens(text, searchQuery)}
            </h2>,
          );
        } else if (level === 3) {
          elements.push(
            <h3
              key={`h3-${i}`}
              className="mb-2 mt-5 text-sm font-semibold text-slate-800"
            >
              {renderInlineTokens(text, searchQuery)}
            </h3>,
          );
        } else {
          elements.push(
            <h4
              key={`h4-${i}`}
              className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-600"
            >
              {renderInlineTokens(text, searchQuery)}
            </h4>,
          );
        }
        i += 1;
        continue;
      }

      // GFM Table
      if (
        trimmed.includes('|') &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1] ?? '')
      ) {
        const headers = splitTableCells(trimmed);
        i += 2;
        const rows: string[][] = [];
        while (
          i < lines.length &&
          (lines[i] ?? '').trim().includes('|') &&
          (lines[i] ?? '').trim() !== ''
        ) {
          rows.push(splitTableCells(lines[i] ?? ''));
          i += 1;
        }
        elements.push(
          <div
            key={`tbl-${i}`}
            className="my-4 overflow-x-auto rounded border border-slate-200"
          >
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {headers.map((h, hIdx) => (
                    <th
                      key={hIdx}
                      className="px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-slate-500"
                    >
                      {renderInlineTokens(h, searchQuery)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/80">
                    {headers.map((_h, cIdx) => (
                      <td
                        key={cIdx}
                        className="px-3 py-2 align-top text-slate-700"
                      >
                        {renderInlineTokens(row[cIdx] ?? '', searchQuery)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        continue;
      }

      // Blockquote
      if (trimmed.startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
          quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
          i += 1;
        }
        elements.push(
          <blockquote
            key={`bq-${i}`}
            className="my-3 border-l-2 border-forest-900 bg-slate-50 px-4 py-2.5 text-xs leading-relaxed text-slate-700"
          >
            {renderInlineTokens(quoteLines.join(' '), searchQuery)}
          </blockquote>,
        );
        continue;
      }

      // Unordered / Checklist items
      if (/^\s*[-*]\s+/.test(line)) {
        const listItems: Array<{
          indent: number;
          checked: boolean | null;
          content: string;
        }> = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
          const rawItem = lines[i] ?? '';
          const leadingSpaces = (/^(\s*)/.exec(rawItem)?.[1] ?? '').length;
          const stripped = rawItem.replace(/^\s*[-*]\s+/, '');
          const checkMatch = /^\[([ xX])\]\s+(.+)$/.exec(stripped);
          if (checkMatch && checkMatch[1] && checkMatch[2]) {
            listItems.push({
              indent: leadingSpaces,
              checked: checkMatch[1].toLowerCase() === 'x',
              content: checkMatch[2],
            });
          } else {
            listItems.push({
              indent: leadingSpaces,
              checked: null,
              content: stripped,
            });
          }
          i += 1;
        }
        elements.push(
          <ul key={`ul-${i}`} className="my-2.5 space-y-1.5 text-sm text-slate-700">
            {listItems.map((li, lIdx) => (
              <li
                key={lIdx}
                className={cn(
                  'flex items-start gap-2 leading-relaxed',
                  li.indent >= 4 ? 'pl-8 text-xs text-slate-600' : li.indent >= 2 ? 'pl-4 text-xs text-slate-600' : '',
                )}
              >
                {li.checked === true ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                ) : li.checked === false ? (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                ) : (
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-none bg-slate-400" />
                )}
                <span>{renderInlineTokens(li.content, searchQuery)}</span>
              </li>
            ))}
          </ul>,
        );
        continue;
      }

      // Ordered list
      if (/^\s*\d+\.\s+/.test(line)) {
        const orderedItems: Array<{ num: string; content: string }> = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
          const m = /^\s*(\d+)\.\s+(.+)$/.exec(lines[i] ?? '');
          if (m && m[1] && m[2]) {
            orderedItems.push({ num: m[1], content: m[2] });
          }
          i += 1;
        }
        elements.push(
          <ol key={`ol-${i}`} className="my-2.5 space-y-1.5 text-sm text-slate-700">
            {orderedItems.map((oi, oIdx) => (
              <li key={oIdx} className="flex items-start gap-2.5 leading-relaxed">
                <span className="mt-0.5 font-mono text-xs font-medium tabular-nums text-slate-500">
                  {oi.num}.
                </span>
                <span>{renderInlineTokens(oi.content, searchQuery)}</span>
              </li>
            ))}
          </ol>,
        );
        continue;
      }

      // Standard paragraph
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        (lines[i] ?? '').trim() !== '' &&
        !(lines[i] ?? '').trim().startsWith('#') &&
        !(lines[i] ?? '').trim().startsWith('```') &&
        !(lines[i] ?? '').trim().startsWith('>') &&
        !/^\s*[-*]\s+/.test(lines[i] ?? '') &&
        !/^\s*\d+\.\s+/.test(lines[i] ?? '') &&
        !/^(-{3,}|\*{3,}|_{3,})$/.test((lines[i] ?? '').trim())
      ) {
        paraLines.push((lines[i] ?? '').trim());
        i += 1;
      }
      if (paraLines.length > 0) {
        elements.push(
          <p
            key={`p-${i}`}
            className="my-2.5 text-sm leading-relaxed text-slate-700"
          >
            {renderInlineTokens(paraLines.join(' '), searchQuery)}
          </p>,
        );
      } else {
        i += 1;
      }
    }

    return elements;
  }, [markdown, searchQuery]);

  return <div>{blocks}</div>;
}

// ---------------------------------------------------------------------------
// Main Developer & Agent Context Page (/developer)
// ---------------------------------------------------------------------------

export function DeveloperPage() {
  const { role } = useAuth();
  const isAdmin = role === 'ADMIN';

  const [activeTab, setActiveTab] = useState<DeveloperTab>('docs');

  // Docs tab state
  const [docsList, setDocsList] = useState<DeveloperDocMeta[]>([]);
  const [selectedDocPath, setSelectedDocPath] = useState<string>('AGENTS.md');
  const [docContentsCache, setDocContentsCache] = useState<Record<string, string>>({});
  const [docsLoading, setDocsLoading] = useState<boolean>(false);
  const [docBodyLoading, setDocBodyLoading] = useState<boolean>(false);
  const [docViewMode, setDocViewMode] = useState<'rendered' | 'raw'>('rendered');
  const [docSearchQuery, setDocSearchQuery] = useState<string>('');
  const [copiedDoc, setCopiedDoc] = useState<boolean>(false);

  // Roadmap tab state
  const [roadmap, setRoadmap] = useState<RoadmapSummaryResponse | null>(null);
  const [roadmapLoading, setRoadmapLoading] = useState<boolean>(false);
  const [roadmapFilter, setRoadmapFilter] = useState<'ALL' | 'COMPLETED' | 'PENDING'>('ALL');
  const [expandedModules, setExpandedModules] = useState<Record<number, boolean>>({});

  // Changelog & Audit tab state
  const [changelogContent, setChangelogContent] = useState<string>('');
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditTotalCount, setAuditTotalCount] = useState<number>(0);
  const [changelogLoading, setChangelogLoading] = useState<boolean>(false);
  const [feedSearch, setFeedSearch] = useState<string>('');

  // Diagnostics tab state
  const [diagnostics, setDiagnostics] = useState<DeveloperDiagnosticsResponse | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState<boolean>(false);

  // API Reference tab state
  const [apiCatalog, setApiCatalog] = useState<ApiCatalogResponse | null>(null);
  const [apiCatalogLoading, setApiCatalogLoading] = useState<boolean>(false);
  const [apiSearch, setApiSearch] = useState<string>('');
  const [apiVerbFilter, setApiVerbFilter] = useState<'ALL' | 'GET' | 'POST' | 'PATCH' | 'DELETE'>('ALL');
  const [apiAccessFilter, setApiAccessFilter] = useState<'ALL' | 'PUBLIC' | 'ADMIN'>('ALL');
  const [expandedApiGroups, setExpandedApiGroups] = useState<Record<number, boolean>>({});
  const [copiedEndpointKey, setCopiedEndpointKey] = useState<string | null>(null);

  // Tab 6: Database & Table Manager
  const [dbTablesData, setDbTablesData] =
    useState<DeveloperDatabaseTablesResponse | null>(null);
  const [dbTablesLoading, setDbTablesLoading] = useState<boolean>(false);
  const [purgeScope, setPurgeScope] = useState<'ORGANIZATION' | 'GLOBAL'>(
    'ORGANIZATION',
  );
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [confirmPurgeModalOpen, setConfirmPurgeModalOpen] =
    useState<boolean>(false);
  const [purgingTables, setPurgingTables] = useState<boolean>(false);
  const [purgeReceipt, setPurgeReceipt] =
    useState<PurgeDatabaseTablesResponse | null>(null);
  const [syncingSchema, setSyncingSchema] = useState<boolean>(false);
  const [schemaSyncReceipt, setSchemaSyncReceipt] =
    useState<SchemaSelfHealResponse | null>(null);

  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const loadDocsIndex = useCallback(async () => {
    if (!isAdmin) return;
    setDocsLoading(true);
    setErrorBanner(null);
    try {
      const res = await developerApi.listDocs();
      setDocsList(res.files);
      if (res.files.length > 0 && !res.files.some((f) => f.path === selectedDocPath)) {
        setSelectedDocPath(res.files[0]!.path);
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load documentation index.');
    } finally {
      setDocsLoading(false);
    }
  }, [isAdmin, selectedDocPath]);

  const loadDocContent = useCallback(
    async (docPath: string, force = false) => {
      if (!isAdmin || !docPath) return;
      if (!force && docContentsCache[docPath] !== undefined) return;
      setDocBodyLoading(true);
      try {
        const res = await developerApi.getDocContent(docPath);
        setDocContentsCache((prev) => ({ ...prev, [docPath]: res.content }));
      } catch (err) {
        setErrorBanner(err instanceof Error ? err.message : 'Failed to load document content.');
      } finally {
        setDocBodyLoading(false);
      }
    },
    [isAdmin, docContentsCache],
  );

  // Preload all allowlisted docs when full-text search query is entered so sidebar can filter by content
  useEffect(() => {
    if (!isAdmin || docSearchQuery.trim().length < 2 || docsList.length === 0) return;
    const missing = docsList.filter((d) => docContentsCache[d.path] === undefined);
    if (missing.length === 0) return;

    let cancelled = false;
    void Promise.all(
      missing.map(async (d) => {
        try {
          const res = await developerApi.getDocContent(d.path);
          return { path: d.path, content: res.content };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setDocContentsCache((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r) next[r.path] = r.content;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, docSearchQuery, docsList, docContentsCache]);

  const loadRoadmap = useCallback(async () => {
    if (!isAdmin) return;
    setRoadmapLoading(true);
    setErrorBanner(null);
    try {
      const res = await developerApi.getRoadmapSummary();
      setRoadmap(res);
      setExpandedModules((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const initial: Record<number, boolean> = {};
        for (const m of res.modules) {
          if (m.pendingCount > 0 || m.moduleNumber >= 9) {
            initial[m.moduleNumber] = true;
          }
        }
        return initial;
      });
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load roadmap summary.');
    } finally {
      setRoadmapLoading(false);
    }
  }, [isAdmin]);

  const loadChangelogAndAudit = useCallback(async () => {
    if (!isAdmin) return;
    setChangelogLoading(true);
    setErrorBanner(null);
    try {
      const [changelogRes, auditRes] = await Promise.all([
        developerApi.getDocContent('docs/CHANGELOG.md'),
        orgApi.listAuditLogs({ limit: 30 }),
      ]);
      setChangelogContent(changelogRes.content);
      setDocContentsCache((prev) => ({
        ...prev,
        'docs/CHANGELOG.md': changelogRes.content,
      }));
      setAuditLogs(auditRes.logs);
      setAuditTotalCount(auditRes.totalCount);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to load changelog and audit feed.',
      );
    } finally {
      setChangelogLoading(false);
    }
  }, [isAdmin]);

  const loadDiagnostics = useCallback(async () => {
    if (!isAdmin) return;
    setDiagnosticsLoading(true);
    setErrorBanner(null);
    try {
      const res = await developerApi.getDiagnostics();
      setDiagnostics(res);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load runtime diagnostics.');
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [isAdmin]);

  const loadApiCatalog = useCallback(async () => {
    if (!isAdmin) return;
    setApiCatalogLoading(true);
    setErrorBanner(null);
    try {
      const res = await developerApi.getApiCatalog();
      setApiCatalog(res);
      setExpandedApiGroups((prev) => {
        if (Object.keys(prev).length > 0) return prev;
        const initial: Record<number, boolean> = {};
        for (const g of res.groups) {
          initial[g.sectionNumber] = true;
        }
        return initial;
      });
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load API catalog.');
    } finally {
      setApiCatalogLoading(false);
    }
  }, [isAdmin]);

  const loadDatabaseTables = useCallback(async () => {
    if (!isAdmin) return;
    setDbTablesLoading(true);
    setErrorBanner(null);
    try {
      const res = await developerApi.getDatabaseTables();
      setDbTablesData(res);
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : 'Failed to load database table metrics.',
      );
    } finally {
      setDbTablesLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadDocsIndex();
    void loadRoadmap();
    void loadApiCatalog();
  }, [loadDocsIndex, loadRoadmap, loadApiCatalog]);

  useEffect(() => {
    if (activeTab === 'docs' && selectedDocPath) {
      void loadDocContent(selectedDocPath);
    } else if (activeTab === 'api' && !apiCatalog) {
      void loadApiCatalog();
    } else if (activeTab === 'changelog' && !changelogContent) {
      void loadChangelogAndAudit();
    } else if (activeTab === 'diagnostics' && !diagnostics) {
      void loadDiagnostics();
    } else if (activeTab === 'database' && !dbTablesData) {
      void loadDatabaseTables();
    }
  }, [
    activeTab,
    selectedDocPath,
    loadDocContent,
    apiCatalog,
    loadApiCatalog,
    changelogContent,
    loadChangelogAndAudit,
    diagnostics,
    loadDiagnostics,
    dbTablesData,
    loadDatabaseTables,
  ]);

  const selectedDocMeta = useMemo(
    () => docsList.find((d) => d.path === selectedDocPath) ?? null,
    [docsList, selectedDocPath],
  );

  const activeDocMarkdown = docContentsCache[selectedDocPath] ?? '';

  const filteredDocs = useMemo(() => {
    const q = docSearchQuery.trim().toLowerCase();
    if (!q) return docsList;
    return docsList.filter((doc) => {
      if (
        doc.path.toLowerCase().includes(q) ||
        doc.title.toLowerCase().includes(q)
      ) {
        return true;
      }
      const body = docContentsCache[doc.path];
      return body ? body.toLowerCase().includes(q) : false;
    });
  }, [docsList, docSearchQuery, docContentsCache]);

  const activeDocMatchCount = useMemo(() => {
    const q = docSearchQuery.trim();
    if (q.length < 2 || !activeDocMarkdown) return 0;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = activeDocMarkdown.match(new RegExp(escaped, 'gi'));
    return matches ? matches.length : 0;
  }, [docSearchQuery, activeDocMarkdown]);

  const parsedReleases = useMemo(
    () => parseChangelogMarkdown(changelogContent),
    [changelogContent],
  );

  const filteredReleases = useMemo(() => {
    const q = feedSearch.trim().toLowerCase();
    if (!q) return parsedReleases;
    return parsedReleases.filter(
      (r) =>
        r.version.toLowerCase().includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.sections.some((s) =>
          s.bullets.some((b) => b.toLowerCase().includes(q)),
        ),
    );
  }, [parsedReleases, feedSearch]);

  const filteredAuditLogs = useMemo(() => {
    const q = feedSearch.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.entityType.toLowerCase().includes(q) ||
        l.summary.toLowerCase().includes(q) ||
        (l.actorEmail ?? '').toLowerCase().includes(q) ||
        (l.actorName ?? '').toLowerCase().includes(q),
    );
  }, [auditLogs, feedSearch]);

  const filteredModules = useMemo(() => {
    if (!roadmap) return [];
    if (roadmapFilter === 'COMPLETED') {
      return roadmap.modules.filter(
        (m) => m.totalCount > 0 && m.completedCount === m.totalCount,
      );
    }
    if (roadmapFilter === 'PENDING') {
      return roadmap.modules.filter((m) => m.pendingCount > 0);
    }
    return roadmap.modules;
  }, [roadmap, roadmapFilter]);

  const filteredApiGroups = useMemo(() => {
    if (!apiCatalog) return [];
    const q = apiSearch.trim().toLowerCase();

    return apiCatalog.groups
      .map((group) => {
        const matchingEndpoints = group.endpoints.filter((ep) => {
          if (apiVerbFilter !== 'ALL' && ep.verb.toUpperCase() !== apiVerbFilter) {
            return false;
          }
          if (
            apiAccessFilter === 'PUBLIC' &&
            !/public|no\s*\(public\)/i.test(ep.authRequired)
          ) {
            return false;
          }
          if (apiAccessFilter === 'ADMIN' && ep.rbacScope.trim() !== 'ADMIN') {
            return false;
          }
          if (!q) return true;
          return (
            ep.path.toLowerCase().includes(q) ||
            ep.verb.toLowerCase().includes(q) ||
            ep.rbacScope.toLowerCase().includes(q) ||
            ep.purpose.toLowerCase().includes(q) ||
            group.title.toLowerCase().includes(q) ||
            group.basePath.toLowerCase().includes(q)
          );
        });
        return { ...group, endpoints: matchingEndpoints };
      })
      .filter((group) => group.endpoints.length > 0);
  }, [apiCatalog, apiSearch, apiVerbFilter, apiAccessFilter]);

  const filteredEndpointCount = useMemo(
    () => filteredApiGroups.reduce((sum, g) => sum + g.endpoints.length, 0),
    [filteredApiGroups],
  );

  const handleCopyEndpointPath = async (verb: string, endpointPath: string) => {
    await navigator.clipboard.writeText(endpointPath);
    const key = `${verb}:${endpointPath}`;
    setCopiedEndpointKey(key);
    setTimeout(() => {
      setCopiedEndpointKey((prev) => (prev === key ? null : prev));
    }, 1800);
  };

  const handleCopyMarkdown = async () => {
    if (!activeDocMarkdown) return;
    await navigator.clipboard.writeText(activeDocMarkdown);
    setCopiedDoc(true);
    setTimeout(() => setCopiedDoc(false), 2000);
  };

  const handleRefreshActiveTab = () => {
    if (activeTab === 'docs') {
      void loadDocsIndex();
      if (selectedDocPath) void loadDocContent(selectedDocPath, true);
    } else if (activeTab === 'api') {
      void loadApiCatalog();
    } else if (activeTab === 'roadmap') {
      void loadRoadmap();
    } else if (activeTab === 'changelog') {
      void loadChangelogAndAudit();
    } else if (activeTab === 'database') {
      void loadDatabaseTables();
    } else {
      void loadDiagnostics();
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-600">
          <Lock className="h-5 w-5" />
        </div>
        <h1 className="text-base font-medium text-slate-900">
          Administrator Clearance Required
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          The Developer &amp; Agent Context Console is restricted to organization{' '}
          <span className="font-mono text-xs text-slate-700">ADMIN</span> members.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-medium tracking-tight text-slate-900">
            Developer &amp; Agent Context
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Read-only governance console for agent specifications, execution roadmaps, release history, and sanitized runtime diagnostics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshActiveTab}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {errorBanner && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {errorBanner}
        </div>
      )}

      {/* Horizontal Sub-Navigation Tab Bar */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex flex-wrap gap-6" aria-label="Developer Console Tabs">
          <button
            type="button"
            onClick={() => setActiveTab('docs')}
            className={cn(
              'flex items-center gap-2 border-b-2 py-2.5 text-sm transition-colors',
              activeTab === 'docs'
                ? 'border-forest-900 font-medium text-forest-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            )}
          >
            <FileText className="h-4 w-4" />
            <span>Context &amp; Docs Viewer</span>
            <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-slate-600">
              {docsList.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('api')}
            className={cn(
              'flex items-center gap-2 border-b-2 py-2.5 text-sm transition-colors',
              activeTab === 'api'
                ? 'border-forest-900 font-medium text-forest-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            )}
          >
            <Network className="h-4 w-4" />
            <span>API Reference</span>
            {apiCatalog && (
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-slate-600">
                {apiCatalog.totalEndpoints}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('roadmap')}
            className={cn(
              'flex items-center gap-2 border-b-2 py-2.5 text-sm transition-colors',
              activeTab === 'roadmap'
                ? 'border-forest-900 font-medium text-forest-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            )}
          >
            <ListChecks className="h-4 w-4" />
            <span>Roadmap Tracker</span>
            {roadmap && (
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-slate-600">
                {roadmap.overallCompletionPercent}%
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('changelog')}
            className={cn(
              'flex items-center gap-2 border-b-2 py-2.5 text-sm transition-colors',
              activeTab === 'changelog'
                ? 'border-forest-900 font-medium text-forest-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            )}
          >
            <History className="h-4 w-4" />
            <span>Changelog &amp; Audit Feed</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('diagnostics')}
            className={cn(
              'flex items-center gap-2 border-b-2 py-2.5 text-sm transition-colors',
              activeTab === 'diagnostics'
                ? 'border-forest-900 font-medium text-forest-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            )}
          >
            <Server className="h-4 w-4" />
            <span>Runtime &amp; Diagnostics</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('database')}
            className={cn(
              'flex items-center gap-2 border-b-2 py-2.5 text-sm transition-colors',
              activeTab === 'database'
                ? 'border-forest-900 font-medium text-forest-900'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
            )}
          >
            <Database className="h-4 w-4" />
            <span>Database &amp; Table Manager</span>
          </button>
        </nav>
      </div>

      {/* ================================================================= */}
      {/* TAB 1: CONTEXT & DOCS VIEWER                                      */}
      {/* ================================================================= */}
      {activeTab === 'docs' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left File Sidebar */}
          <aside className="space-y-4 lg:col-span-4 xl:col-span-3">
            <div className="rounded-md border border-slate-200 bg-white p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  value={docSearchQuery}
                  onChange={(e) => setDocSearchQuery(e.target.value)}
                  placeholder="Search docs & full text..."
                  className="pl-8 text-xs"
                />
              </div>
              {docSearchQuery.trim().length >= 2 && (
                <p className="mt-2 font-mono text-[11px] tabular-nums text-slate-500">
                  {filteredDocs.length} matching file{filteredDocs.length === 1 ? '' : 's'}
                </p>
              )}
            </div>

            <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
              {docsLoading && docsList.length === 0 ? (
                <div className="p-4 text-xs text-slate-500">Loading allowlisted index…</div>
              ) : filteredDocs.length === 0 ? (
                <div className="p-4 text-xs text-slate-500">
                  No allowlisted documentation matched &ldquo;{docSearchQuery}&rdquo;.
                </div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {CATEGORY_ORDER.map((cat) => {
                    const groupFiles = filteredDocs.filter((d) => d.category === cat);
                    if (groupFiles.length === 0) return null;
                    return (
                      <div key={cat}>
                        <div className="bg-slate-50 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">
                          {CATEGORY_LABELS[cat]}
                        </div>
                        <div className="divide-y divide-slate-100">
                          {groupFiles.map((doc) => {
                            const active = doc.path === selectedDocPath;
                            return (
                              <button
                                key={doc.path}
                                type="button"
                                onClick={() => setSelectedDocPath(doc.path)}
                                className={cn(
                                  'flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors',
                                  active
                                    ? 'border-l-2 border-forest-900 bg-slate-50'
                                    : 'hover:bg-slate-50/70',
                                )}
                              >
                                <span
                                  className={cn(
                                    'font-mono text-xs',
                                    active
                                      ? 'font-semibold text-forest-900'
                                      : 'font-medium text-slate-800',
                                  )}
                                >
                                  {doc.path}
                                </span>
                                <span className="line-clamp-1 text-xs text-slate-500">
                                  {doc.title}
                                </span>
                                <span className="mt-0.5 font-mono text-[10px] tabular-nums text-slate-400">
                                  {doc.lineCount} lines · {formatBytes(doc.sizeBytes)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>

          {/* Right Markdown Reader Pane */}
          <section className="lg:col-span-8 xl:col-span-9">
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
              {/* Document Toolbar */}
              <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900">
                      {selectedDocMeta?.path ?? selectedDocPath}
                    </span>
                    {selectedDocMeta && (
                      <span className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] tabular-nums text-slate-600">
                        {selectedDocMeta.lineCount} lines · {formatBytes(selectedDocMeta.sizeBytes)}
                      </span>
                    )}
                    {activeDocMatchCount > 0 && (
                      <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[11px] tabular-nums text-amber-800">
                        {activeDocMatchCount} match{activeDocMatchCount === 1 ? '' : 'es'}
                      </span>
                    )}
                  </div>
                  {selectedDocMeta && (
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                      Modified {formatTimestamp(selectedDocMeta.lastModified)}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded border border-slate-200 bg-white p-0.5">
                    <button
                      type="button"
                      onClick={() => setDocViewMode('rendered')}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                        docViewMode === 'rendered'
                          ? 'bg-forest-900 text-white'
                          : 'text-slate-600 hover:text-slate-900',
                      )}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Rendered
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocViewMode('raw')}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
                        docViewMode === 'raw'
                          ? 'bg-forest-900 text-white'
                          : 'text-slate-600 hover:text-slate-900',
                      )}
                    >
                      <Code2 className="h-3.5 w-3.5" />
                      Raw Source
                    </button>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopyMarkdown()}
                    disabled={!activeDocMarkdown}
                  >
                    {copiedDoc ? (
                      <>
                        <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-700" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Document Body */}
              <div className="p-6">
                {docBodyLoading && !activeDocMarkdown ? (
                  <p className="text-xs text-slate-500">Loading document content…</p>
                ) : docViewMode === 'raw' ? (
                  <pre className="overflow-x-auto rounded border border-slate-800 bg-obsidian-950 p-4 font-mono text-xs leading-relaxed text-slate-100">
                    <code>{activeDocMarkdown}</code>
                  </pre>
                ) : (
                  <MarkdownDocument
                    markdown={activeDocMarkdown}
                    searchQuery={docSearchQuery}
                  />
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB: API REFERENCE & ENDPOINT CATALOG                             */}
      {/* ================================================================= */}
      {activeTab === 'api' && (
        <div className="space-y-6">
          {apiCatalogLoading && !apiCatalog ? (
            <div className="rounded-md border border-slate-200 bg-white p-6 text-xs text-slate-500">
              Parsing docs/ARCHITECTURE.md endpoint catalog…
            </div>
          ) : apiCatalog ? (
            <>
              {/* KPI Strip */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Total API Endpoints
                  </p>
                  <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                    {apiCatalog.totalEndpoints}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Across <span className="font-mono">{apiCatalog.totalGroups}</span> service domains
                  </p>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Read / Write Breakdown
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px] tabular-nums">
                    <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-800">
                      GET {apiCatalog.verbCounts['GET'] ?? 0}
                    </span>
                    <span className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-sky-800">
                      POST {apiCatalog.verbCounts['POST'] ?? 0}
                    </span>
                    <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">
                      PATCH {apiCatalog.verbCounts['PATCH'] ?? 0}
                    </span>
                    <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-rose-800">
                      DELETE {apiCatalog.verbCounts['DELETE'] ?? 0}
                    </span>
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Public Entrypoints
                  </p>
                  <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                    {apiCatalog.publicEndpointsCount}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Health probe, SPA, &amp; OIDC login
                  </p>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Strict ADMIN-Only Routes
                  </p>
                  <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-forest-900">
                    {apiCatalog.adminOnlyEndpointsCount}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Governance, RBAC &amp; Developer Console
                  </p>
                </div>
              </div>

              {/* Filter & Controls Toolbar */}
              <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1 sm:max-w-sm">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      value={apiSearch}
                      onChange={(e) => setApiSearch(e.target.value)}
                      placeholder="Filter by path, role, domain, or description..."
                      className="pl-8 text-xs"
                    />
                  </div>

                  <div className="inline-flex flex-wrap rounded border border-slate-200 bg-slate-50 p-0.5">
                    {(['ALL', 'GET', 'POST', 'PATCH', 'DELETE'] as const).map((verb) => (
                      <button
                        key={verb}
                        type="button"
                        onClick={() => setApiVerbFilter(verb)}
                        className={cn(
                          'rounded px-2.5 py-1 font-mono text-[11px] font-medium transition-colors',
                          apiVerbFilter === verb
                            ? 'bg-forest-900 text-white'
                            : 'text-slate-600 hover:text-slate-900',
                        )}
                      >
                        {verb}
                      </button>
                    ))}
                  </div>

                  <div className="inline-flex rounded border border-slate-200 bg-slate-50 p-0.5">
                    {(['ALL', 'PUBLIC', 'ADMIN'] as const).map((acc) => (
                      <button
                        key={acc}
                        type="button"
                        onClick={() => setApiAccessFilter(acc)}
                        className={cn(
                          'rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
                          apiAccessFilter === acc
                            ? 'bg-forest-900 text-white'
                            : 'text-slate-600 hover:text-slate-900',
                        )}
                      >
                        {acc === 'ALL'
                          ? 'All Scopes'
                          : acc === 'PUBLIC'
                            ? 'Public'
                            : 'ADMIN Only'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {filteredEndpointCount} / {apiCatalog.totalEndpoints} shown
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const next: Record<number, boolean> = {};
                      for (const g of apiCatalog.groups) next[g.sectionNumber] = true;
                      setExpandedApiGroups(next);
                    }}
                  >
                    Expand All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExpandedApiGroups({})}
                  >
                    Collapse All
                  </Button>
                </div>
              </div>

              {/* Domain Endpoint Groups */}
              {filteredApiGroups.length === 0 ? (
                <div className="rounded-md border border-slate-200 bg-white p-6 text-xs text-slate-500">
                  No API endpoints matched your current search or filter criteria.
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredApiGroups.map((group) => {
                    const isExpanded = Boolean(expandedApiGroups[group.sectionNumber]);
                    return (
                      <div
                        key={group.sectionNumber}
                        className="overflow-hidden rounded-md border border-slate-200 bg-white"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedApiGroups((prev) => ({
                              ...prev,
                              [group.sectionNumber]: !prev[group.sectionNumber],
                            }))
                          }
                          className="flex w-full items-center justify-between gap-4 bg-slate-50 px-4 py-3 text-left hover:bg-slate-100/70"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                            ) : (
                              <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                            )}
                            <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-slate-600">
                              {String(group.sectionNumber).padStart(2, '0')}
                            </span>
                            <span className="text-sm font-semibold text-slate-900">
                              {group.title}
                            </span>
                            <span className="hidden rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600 sm:inline-block">
                              {group.basePath}
                            </span>
                          </div>
                          <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">
                            {group.endpoints.length} endpoint
                            {group.endpoints.length === 1 ? '' : 's'}
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="overflow-x-auto border-t border-slate-200">
                            <table className="w-full border-collapse text-left text-xs">
                              <thead>
                                <tr className="border-b border-slate-200 bg-white text-[11px] font-medium uppercase tracking-wider text-slate-500">
                                  <th className="w-24 px-4 py-2.5">Method</th>
                                  <th className="w-80 px-4 py-2.5">Endpoint Path</th>
                                  <th className="w-40 px-4 py-2.5">Auth</th>
                                  <th className="w-52 px-4 py-2.5">RBAC Scope</th>
                                  <th className="px-4 py-2.5">Purpose / Side Effects</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                {group.endpoints.map((ep, idx) => {
                                  const upperVerb = ep.verb.toUpperCase();
                                  const verbStyle =
                                    upperVerb === 'GET'
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                      : upperVerb === 'POST'
                                        ? 'border-sky-200 bg-sky-50 text-sky-800'
                                        : upperVerb === 'PATCH' || upperVerb === 'PUT'
                                          ? 'border-amber-200 bg-amber-50 text-amber-800'
                                          : upperVerb === 'DELETE'
                                            ? 'border-rose-200 bg-rose-50 text-rose-800'
                                            : 'border-slate-200 bg-slate-100 text-slate-700';
                                  const epKey = `${ep.verb}:${ep.path}`;
                                  const isCopied = copiedEndpointKey === epKey;

                                  return (
                                    <tr
                                      key={`${epKey}-${idx}`}
                                      className="hover:bg-slate-50/80"
                                    >
                                      <td className="px-4 py-2.5 align-top">
                                        <span
                                          className={cn(
                                            'inline-block rounded border px-2 py-0.5 font-mono text-[11px] font-semibold',
                                            verbStyle,
                                          )}
                                        >
                                          {upperVerb}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 align-top">
                                        <div className="flex items-center gap-1.5">
                                          <code className="font-mono text-xs font-medium text-slate-900">
                                            {ep.path}
                                          </code>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void handleCopyEndpointPath(ep.verb, ep.path)
                                            }
                                            title="Copy endpoint path"
                                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                          >
                                            {isCopied ? (
                                              <Check className="h-3 w-3 text-emerald-700" />
                                            ) : (
                                              <Copy className="h-3 w-3" />
                                            )}
                                          </button>
                                        </div>
                                      </td>
                                      <td className="px-4 py-2.5 align-top text-slate-600">
                                        <span className="font-mono text-[11px]">
                                          {ep.authRequired}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 align-top">
                                        <span className="font-mono text-[11px] text-slate-700">
                                          {ep.rbacScope}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 align-top leading-relaxed text-slate-700">
                                        {renderInlineTokens(ep.purpose, apiSearch)}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 2: ROADMAP TRACKER                                            */}
      {/* ================================================================= */}
      {activeTab === 'roadmap' && (
        <div className="space-y-6">
          {roadmapLoading && !roadmap ? (
            <div className="rounded-md border border-slate-200 bg-white p-6 text-xs text-slate-500">
              Parsing docs/STAGES_ROADMAP.md…
            </div>
          ) : roadmap ? (
            <>
              {/* KPI Strip */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Overall Completion
                  </p>
                  <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                    {roadmap.overallCompletionPercent}%
                  </p>
                  <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded bg-slate-100">
                    <div
                      className="h-full bg-forest-800 transition-all"
                      style={{ width: `${roadmap.overallCompletionPercent}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Modules Delivered
                  </p>
                  <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                    {roadmap.completedModules} / {roadmap.totalModules}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Parsed from <span className="font-mono">{roadmap.sourcePath}</span>
                  </p>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Completed Checklist Gates
                  </p>
                  <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-emerald-700">
                    {roadmap.completedChecklistItems}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Verified &amp; checked off in specification
                  </p>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Remaining Checklist Gates
                  </p>
                  <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-amber-700">
                    {roadmap.pendingChecklistItems}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Queued under Module-Gate Review Protocol
                  </p>
                </div>
              </div>

              {/* Filter Bar */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex rounded border border-slate-200 bg-white p-0.5">
                  {(['ALL', 'COMPLETED', 'PENDING'] as const).map((filterKey) => (
                    <button
                      key={filterKey}
                      type="button"
                      onClick={() => setRoadmapFilter(filterKey)}
                      className={cn(
                        'rounded px-3 py-1.5 text-xs font-medium transition-colors',
                        roadmapFilter === filterKey
                          ? 'bg-forest-900 text-white'
                          : 'text-slate-600 hover:text-slate-900',
                      )}
                    >
                      {filterKey === 'ALL'
                        ? `All Modules (${roadmap.modules.length})`
                        : filterKey === 'COMPLETED'
                          ? `Completed (${roadmap.completedModules})`
                          : `Remaining (${roadmap.totalModules - roadmap.completedModules})`}
                    </button>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSelectedDocPath('docs/STAGES_ROADMAP.md');
                    setActiveTab('docs');
                  }}
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  Open Raw STAGES_ROADMAP.md
                </Button>
              </div>

              {/* Module Cards */}
              <div className="space-y-3">
                {filteredModules.map((mod) => {
                  const isExpanded = Boolean(expandedModules[mod.moduleNumber]);
                  const isFullyDone =
                    mod.totalCount > 0 && mod.completedCount === mod.totalCount;
                  const isPartial = mod.completedCount > 0 && !isFullyDone;

                  return (
                    <div
                      key={mod.moduleNumber}
                      className="overflow-hidden rounded-md border border-slate-200 bg-white"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedModules((prev) => ({
                            ...prev,
                            [mod.moduleNumber]: !prev[mod.moduleNumber],
                          }))
                        }
                        className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-slate-50/70"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          {isExpanded ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-slate-700">
                                M{String(mod.moduleNumber).padStart(2, '0')}
                              </span>
                              <span className="text-sm font-semibold text-slate-900">
                                {mod.title}
                              </span>
                              <StatusTag
                                variant={
                                  isFullyDone
                                    ? 'emerald'
                                    : isPartial
                                      ? 'amber'
                                      : 'neutral'
                                }
                                label={
                                  isFullyDone
                                    ? 'COMPLETED'
                                    : isPartial
                                      ? 'IN PROGRESS'
                                      : 'PLANNED'
                                }
                              />
                            </div>
                            {mod.objective && (
                              <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                                {mod.objective}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-3">
                          <div className="hidden w-28 sm:block">
                            <div className="h-1.5 w-full overflow-hidden rounded bg-slate-100">
                              <div
                                className={cn(
                                  'h-full transition-all',
                                  isFullyDone ? 'bg-emerald-600' : 'bg-forest-800',
                                )}
                                style={{ width: `${mod.completionPercent}%` }}
                              />
                            </div>
                          </div>
                          <span className="font-mono text-xs font-medium tabular-nums text-slate-700">
                            {mod.completedCount}/{mod.totalCount}
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="divide-y divide-slate-100 border-t border-slate-200 bg-slate-50/40 px-4 py-2">
                          {mod.items.map((item) => (
                            <div key={item.id} className="py-2.5">
                              <div className="flex items-start gap-2.5">
                                {item.completed ? (
                                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                                ) : (
                                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-baseline gap-2">
                                    <span className="font-mono text-xs font-semibold tabular-nums text-slate-700">
                                      {item.id}
                                    </span>
                                    <span
                                      className={cn(
                                        'text-xs font-medium',
                                        item.completed ? 'text-slate-800' : 'text-slate-900',
                                      )}
                                    >
                                      {item.title}
                                    </span>
                                  </div>
                                  {item.details.length > 0 && (
                                    <ul className="mt-1.5 space-y-1 pl-4">
                                      {item.details.map((detail, dIdx) => (
                                        <li
                                          key={dIdx}
                                          className="text-xs leading-relaxed text-slate-600"
                                        >
                                          • {renderInlineTokens(detail)}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 3: CHANGELOG & AUDIT FEED                                     */}
      {/* ================================================================= */}
      {activeTab === 'changelog' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                value={feedSearch}
                onChange={(e) => setFeedSearch(e.target.value)}
                placeholder="Filter releases or audit log events..."
                className="pl-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-3 font-mono text-xs tabular-nums text-slate-500">
              <span>{filteredReleases.length} releases</span>
              <span>·</span>
              <span>
                {filteredAuditLogs.length} / {auditTotalCount} audit events
              </span>
            </div>
          </div>

          {changelogLoading && parsedReleases.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-white p-6 text-xs text-slate-500">
              Loading release history and system audit log…
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
              {/* Left Column: Chronological Release Changelog */}
              <div className="space-y-3 xl:col-span-7">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Repository Release History (docs/CHANGELOG.md)
                  </h2>
                </div>

                {filteredReleases.length === 0 ? (
                  <div className="rounded-md border border-slate-200 bg-white p-6 text-xs text-slate-500">
                    No changelog entries matched your filter.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredReleases.map((rel) => (
                      <div
                        key={`${rel.version}-${rel.date}`}
                        className="rounded-md border border-slate-200 bg-white p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded border border-forest-900/20 bg-forest-50 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-forest-900">
                              v{rel.version}
                            </span>
                            <span className="text-sm font-semibold text-slate-900">
                              {rel.title}
                            </span>
                          </div>
                          <span className="font-mono text-xs tabular-nums text-slate-500">
                            {rel.date}
                          </span>
                        </div>

                        <div className="mt-3 space-y-3">
                          {rel.sections.map((sec, sIdx) => (
                            <div key={sIdx}>
                              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                                {sec.heading}
                              </p>
                              <ul className="mt-1 space-y-1 text-xs leading-relaxed text-slate-700">
                                {sec.bullets.map((b, bIdx) => (
                                  <li key={bIdx} className="flex items-start gap-2">
                                    <span className="mt-1.5 h-1 w-1 shrink-0 bg-slate-400" />
                                    <span>{renderInlineTokens(b, feedSearch)}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right Column: Live Immutable System Audit Feed */}
              <div className="space-y-3 xl:col-span-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Recent Workspace Audit Events
                  </h2>
                </div>

                <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                  {filteredAuditLogs.length === 0 ? (
                    <div className="p-6 text-xs text-slate-500">
                      No recent workspace audit events matched.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {filteredAuditLogs.map((log) => (
                        <div key={log.id} className="p-3.5 hover:bg-slate-50/70">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase text-slate-700">
                                {log.action}
                              </span>
                              <span className="font-mono text-[11px] text-slate-500">
                                {log.entityType}
                              </span>
                            </div>
                            <span className="font-mono text-[10px] tabular-nums text-slate-400">
                              {formatTimestamp(log.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1.5 text-xs text-slate-800">{log.summary}</p>
                          <p className="mt-1 font-mono text-[11px] text-slate-500">
                            Actor: {log.actorName ?? log.actorEmail ?? 'System'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 4: RUNTIME & ENVIRONMENT DIAGNOSTICS                          */}
      {/* ================================================================= */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-6">
          {diagnosticsLoading && !diagnostics ? (
            <div className="rounded-md border border-slate-200 bg-white p-6 text-xs text-slate-500">
              Querying runtime &amp; PostgreSQL health…
            </div>
          ) : diagnostics ? (
            <>
              {/* Top Health Cards */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Node & Container Runtime */}
                <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-slate-600" />
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                        Unified Container Runtime
                      </h2>
                    </div>
                    <StatusTag
                      variant={
                        diagnostics.runtime.nodeEnv === 'production'
                          ? 'emerald'
                          : 'info'
                      }
                      label={diagnostics.runtime.nodeEnv.toUpperCase()}
                    />
                  </div>
                  <dl className="divide-y divide-slate-100 px-4 py-1 text-xs">
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="text-slate-500">Node.js Runtime</dt>
                      <dd className="font-mono font-medium text-slate-900">
                        {diagnostics.runtime.nodeVersion} ({diagnostics.runtime.platform})
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="text-slate-500">Bind Interface</dt>
                      <dd className="font-mono font-medium tabular-nums text-slate-900">
                        {diagnostics.runtime.host}:{diagnostics.runtime.port}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="text-slate-500">Process Uptime</dt>
                      <dd className="font-mono font-medium tabular-nums text-slate-900">
                        {formatUptime(diagnostics.runtime.uptimeSeconds)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="text-slate-500">Memory Footprint (RSS / Heap)</dt>
                      <dd className="font-mono font-medium tabular-nums text-slate-900">
                        {formatBytes(diagnostics.runtime.memoryRssBytes)} /{' '}
                        {formatBytes(diagnostics.runtime.memoryHeapUsedBytes)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="text-slate-500">Server UTC Clock</dt>
                      <dd className="font-mono text-slate-700">
                        {formatTimestamp(diagnostics.runtime.serverTimestamp)}
                      </dd>
                    </div>
                  </dl>
                </div>

                {/* PostgreSQL Health & Tenant Metrics */}
                <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-slate-600" />
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                        PostgreSQL Health &amp; Tenant Footprint
                      </h2>
                    </div>
                    <StatusTag
                      variant={
                        diagnostics.database.status === 'CONNECTED'
                          ? 'emerald'
                          : 'danger'
                      }
                      label={`${diagnostics.database.status} (${diagnostics.database.latencyMs}ms)`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
                    {[
                      {
                        label: 'GL Accounts',
                        value: diagnostics.database.tenantMetrics.accountsCount,
                      },
                      {
                        label: 'Contacts',
                        value: diagnostics.database.tenantMetrics.contactsCount,
                      },
                      {
                        label: 'AR Invoices',
                        value: diagnostics.database.tenantMetrics.invoicesCount,
                      },
                      {
                        label: 'AP Bills',
                        value: diagnostics.database.tenantMetrics.billsCount,
                      },
                      {
                        label: 'Journal Entries',
                        value: diagnostics.database.tenantMetrics.journalEntriesCount,
                      },
                      {
                        label: 'Audit Log Rows',
                        value: diagnostics.database.tenantMetrics.auditLogsCount,
                      },
                    ].map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded border border-slate-200 bg-slate-50/60 p-3"
                      >
                        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                          {metric.label}
                        </p>
                        <p className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
                          {metric.value.toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Sanitized Configuration & Secret Redaction Matrix */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-slate-600" />
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                        Sanitized Flags &amp; Redacted Secret Presence
                      </h2>
                    </div>
                  </div>
                  <dl className="divide-y divide-slate-100 px-4 py-1 text-xs">
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="text-slate-600">Schema Management Mode</dt>
                      <dd>
                        <StatusTag
                          variant="emerald"
                          label={diagnostics.configuration.schemaManagementMode}
                          mono
                        />
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="text-slate-600">Static SPA Assets Bundled</dt>
                      <dd className="font-mono font-medium text-slate-900">
                        {diagnostics.configuration.frontendDistBundled ? 'YES' : 'NO (Dev Proxy)'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="text-slate-600">Allowlisted Docs Indexed</dt>
                      <dd className="font-mono font-medium tabular-nums text-slate-900">
                        {diagnostics.configuration.docsAllowlistCount} files
                      </dd>
                    </div>
                    <div className="flex items-center justify-between py-2.5">
                      <dt className="font-mono text-slate-600">INSTANCE_CONNECTION_NAME</dt>
                      <dd>
                        <StatusTag
                          variant={
                            diagnostics.configuration.cloudSqlSocketConfigured
                              ? 'emerald'
                              : 'neutral'
                          }
                          label={
                            diagnostics.configuration.cloudSqlSocketConfigured
                              ? 'MOUNTED'
                              : 'TCP / LOCAL'
                          }
                        />
                      </dd>
                    </div>
                    {(
                      [
                        {
                          key: 'DB_PASSWORD',
                          present:
                            diagnostics.configuration.secretsPresenceRedacted
                              .dbPasswordConfigured,
                        },
                        {
                          key: 'SESSION_SECRET',
                          present:
                            diagnostics.configuration.secretsPresenceRedacted
                              .sessionSecretConfigured,
                        },
                        {
                          key: 'WEBHOOK_SECRET',
                          present:
                            diagnostics.configuration.secretsPresenceRedacted
                              .webhookSecretConfigured,
                        },
                      ] as const
                    ).map((sec) => (
                      <div
                        key={sec.key}
                        className="flex items-center justify-between py-2.5"
                      >
                        <dt className="font-mono text-slate-600">{sec.key}</dt>
                        <dd>
                          <StatusTag
                            variant={sec.present ? 'emerald' : 'amber'}
                            label={
                              sec.present
                                ? 'SET · VALUE REDACTED'
                                : 'NOT CONFIGURED'
                            }
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>

                {/* Active Organization Governance & Enabled Modules */}
                <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                      Workspace Governance &amp; Enabled Modules
                    </h2>
                  </div>
                  <div className="space-y-4 p-4 text-xs">
                    <dl className="divide-y divide-slate-100">
                      <div className="flex items-center justify-between py-2">
                        <dt className="text-slate-500">Organization</dt>
                        <dd className="font-medium text-slate-900">
                          {diagnostics.organization.name}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <dt className="text-slate-500">Tenant ID</dt>
                        <dd className="font-mono text-[11px] text-slate-700">
                          {diagnostics.organization.id}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <dt className="text-slate-500">ABN / Base Currency</dt>
                        <dd className="font-mono text-slate-900">
                          {diagnostics.organization.abn} ·{' '}
                          {diagnostics.organization.baseCurrency}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <dt className="text-slate-500">Period Lock Date</dt>
                        <dd className="font-mono text-slate-900">
                          {diagnostics.organization.lockDate ?? 'Unlocked'}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <dt className="text-slate-500">Two-Person Maker-Checker</dt>
                        <dd>
                          <StatusTag
                            variant={
                              diagnostics.organization.enforceTwoPersonApproval
                                ? 'info'
                                : 'neutral'
                            }
                            label={
                              diagnostics.organization.enforceTwoPersonApproval
                                ? 'ENFORCED'
                                : 'STANDARD SME'
                            }
                          />
                        </dd>
                      </div>
                    </dl>

                    <div>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Enabled Module Flags (organization.enabledModules)
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {diagnostics.organization.enabledModules.map((mod) => (
                          <span
                            key={mod}
                            className="rounded border border-forest-900/20 bg-forest-50 px-2 py-1 font-mono text-[11px] font-medium text-forest-900"
                          >
                            {mod}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* ================================================================= */}
      {/* TAB 6: INTERACTIVE DATABASE & TABLE MANAGER (MODULE 13)           */}
      {/* ================================================================= */}
      {activeTab === 'database' && (
        <div className="space-y-6">
          {/* Prisma Schema Self-Heal & System Account Verifier Card */}
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Wrench className="h-4 w-4 text-forest-800" />
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-800">
                    Prisma-Native Schema Self-Healing &amp; System Account Verifier
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Synchronizes PostgreSQL tables, columns, enums, and indexes against{' '}
                    <span className="font-mono text-slate-700">backend/prisma/schema.prisma</span>{' '}
                    and verifies all 10 Protected System GL Accounts (1000–6000).
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                loading={syncingSchema}
                onClick={async () => {
                  setSyncingSchema(true);
                  setErrorBanner(null);
                  try {
                    const res = await developerApi.syncSchema();
                    setSchemaSyncReceipt(res);
                    await loadDatabaseTables();
                  } catch (err) {
                    setErrorBanner(
                      err instanceof Error
                        ? err.message
                        : 'Failed to execute Prisma schema self-heal.',
                    );
                  } finally {
                    setSyncingSchema(false);
                  }
                }}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Run Prisma Schema Self-Heal
              </Button>
            </div>

            {schemaSyncReceipt && (
              <div className="border-b border-slate-200 bg-emerald-50/70 p-4 text-xs text-emerald-950">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                    <span>
                      Prisma Schema Self-Heal Completed ({schemaSyncReceipt.durationMs}ms) ·{' '}
                      {schemaSyncReceipt.organizationsVerified} Organization(s) Verified
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSchemaSyncReceipt(null)}
                    className="text-[11px] font-medium underline opacity-75 hover:opacity-100"
                  >
                    Dismiss
                  </button>
                </div>
                {schemaSyncReceipt.output && (
                  <pre className="mt-2 max-h-40 overflow-x-auto rounded bg-obsidian-950 p-3 font-mono text-[11px] text-emerald-300">
                    {schemaSyncReceipt.output}
                  </pre>
                )}
              </div>
            )}

            {/* Permanently Protected Identity & System Tables Strip */}
            {dbTablesData && (
              <div className="p-4">
                <div className="mb-2 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">
                    Permanently Protected Identity &amp; Core Control Tables (Never Wiped)
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
                  {dbTablesData.protectedIdentityTables.map((pt) => (
                    <div
                      key={pt.tableName}
                      className="rounded border border-emerald-200 bg-emerald-50/40 p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-mono text-[11px] font-semibold text-emerald-950">
                          {pt.tableName}
                        </span>
                        <StatusTag tone="emerald" label="PROTECTED" mono />
                      </div>
                      <p className="mt-1 font-medium text-slate-800">{pt.label}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-600">
                        Org: {pt.orgRowCount} · DB Total: {pt.globalRowCount}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Purge Completion Receipt Banner */}
          {purgeReceipt && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-950">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  <span className="font-semibold">
                    Purged {purgeReceipt.totalDeletedRows.toLocaleString()} row(s) across{' '}
                    {purgeReceipt.tablesPurgedCount} table(s) (Scope: {purgeReceipt.scope})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setPurgeReceipt(null)}
                  className="text-[11px] font-medium underline opacity-75 hover:opacity-100"
                >
                  Dismiss
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(purgeReceipt.deletedCounts).map(([tbl, count]) => (
                  <span
                    key={tbl}
                    className="rounded border border-emerald-200 bg-white px-2 py-0.5 font-mono text-[11px] text-emerald-900"
                  >
                    {tbl}: {count} deleted
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Selective Table Purge Workbench */}
          {dbTablesLoading && !dbTablesData ? (
            <div className="rounded-md border border-slate-200 bg-white p-6 text-xs text-slate-500">
              Loading PostgreSQL table inventory &amp; live row counts…
            </div>
          ) : dbTablesData ? (
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white divide-y divide-slate-200">
              {/* Scope Selector & Quick Presets Toolbar */}
              <div className="p-4 space-y-4 bg-slate-50/70">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Selective Database Table Purge Workbench
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Select specific tables to clear test records. Parent selections automatically include required child line-item tables. Users, Organizations, and RBAC Memberships are always preserved.
                    </p>
                  </div>

                  {/* Scope Toggle */}
                  <div className="flex items-center gap-1 rounded border border-slate-300 bg-white p-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setPurgeScope('ORGANIZATION')}
                      className={cn(
                        'rounded px-3 py-1.5 font-medium transition-colors',
                        purgeScope === 'ORGANIZATION'
                          ? 'bg-forest-900 text-white'
                          : 'text-slate-600 hover:text-slate-900',
                      )}
                    >
                      Active Organization Only
                    </button>
                    <button
                      type="button"
                      onClick={() => setPurgeScope('GLOBAL')}
                      className={cn(
                        'rounded px-3 py-1.5 font-medium transition-colors',
                        purgeScope === 'GLOBAL'
                          ? 'bg-rose-700 text-white'
                          : 'text-slate-600 hover:text-slate-900',
                      )}
                    >
                      Whole Database (All Orgs)
                    </button>
                  </div>
                </div>

                {/* 1-Click Selection Presets */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mr-1">
                      Quick Presets:
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const txAndLogTables = dbTablesData.tables
                          .filter((t) => t.domain !== 'MASTER_DATA')
                          .map((t) => t.tableName);
                        setSelectedTables(txAndLogTables);
                      }}
                    >
                      Select All Transactions &amp; Logs (Keep Contacts, Items &amp; CoA)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const apExpGl = dbTablesData.tables
                          .filter(
                            (t) =>
                              t.domain === 'AP' ||
                              t.domain === 'EXPENSES' ||
                              t.domain === 'GL' ||
                              t.domain === 'AUDIT',
                          )
                          .map((t) => t.tableName);
                        setSelectedTables(apExpGl);
                      }}
                    >
                      Select Bills, Expenses, Journals &amp; Logs
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSelectedTables(
                          dbTablesData.tables.map((t) => t.tableName),
                        )
                      }
                    >
                      Select All Clearable Tables
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedTables([])}
                    >
                      Clear Selection
                    </Button>
                  </div>

                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={selectedTables.length === 0}
                    onClick={() => setConfirmPurgeModalOpen(true)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Purge {selectedTables.length} Selected Table
                    {selectedTables.length === 1 ? '' : 's'}
                  </Button>
                </div>
              </div>

              {/* Domain-Grouped Table Checkboxes */}
              <div className="p-4 space-y-6">
                {(
                  [
                    {
                      domain: 'AP' as DatabaseTableDomain,
                      title: '1. Accounts Payable (Bills, POs, Vendor Credits & Payments Out)',
                    },
                    {
                      domain: 'AR' as DatabaseTableDomain,
                      title: '2. Accounts Receivable (Invoices, Quotes, Credit Notes & Receipts)',
                    },
                    {
                      domain: 'EXPENSES' as DatabaseTableDomain,
                      title: '3. Direct Bank Spend & Employee Expense Claims',
                    },
                    {
                      domain: 'BANKING' as DatabaseTableDomain,
                      title: '4. Bank Statement Feeds, Transfers & Recurring Schedules',
                    },
                    {
                      domain: 'GL' as DatabaseTableDomain,
                      title: '5. General Ledger Journal Entries & Lines',
                    },
                    {
                      domain: 'MASTER_DATA' as DatabaseTableDomain,
                      title: '6. Master Data (Contacts, Items, Cost Centres & Custom GL Accounts)',
                    },
                    {
                      domain: 'AUDIT' as DatabaseTableDomain,
                      title: '7. System Audit Trail Logs',
                    },
                  ] as const
                ).map((group) => {
                  const groupTables = dbTablesData.tables.filter(
                    (t) => t.domain === group.domain,
                  );
                  if (groupTables.length === 0) return null;

                  const allGroupSelected = groupTables.every((t) =>
                    selectedTables.includes(t.tableName),
                  );

                  return (
                    <div key={group.domain} className="space-y-2.5">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                          {group.title}
                        </h4>
                        <button
                          type="button"
                          onClick={() => {
                            if (allGroupSelected) {
                              const groupNames = new Set(
                                groupTables.map((t) => t.tableName),
                              );
                              setSelectedTables((prev) =>
                                prev.filter((name) => !groupNames.has(name)),
                              );
                            } else {
                              const additions = new Set(selectedTables);
                              for (const t of groupTables) {
                                additions.add(t.tableName);
                                t.autoSelectChildren.forEach((c) =>
                                  additions.add(c),
                                );
                              }
                              setSelectedTables(Array.from(additions));
                            }
                          }}
                          className="text-[11px] font-medium text-forest-800 hover:underline"
                        >
                          {allGroupSelected ? 'Deselect Group' : 'Select Group'}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                        {groupTables.map((tbl) => {
                          const checked = selectedTables.includes(tbl.tableName);
                          const activeRowCount =
                            purgeScope === 'ORGANIZATION'
                              ? tbl.orgRowCount
                              : tbl.globalRowCount;

                          return (
                            <label
                              key={tbl.tableName}
                              className={cn(
                                'flex items-start justify-between gap-3 rounded border p-3 text-xs cursor-pointer transition-colors',
                                checked
                                  ? 'border-rose-300 bg-rose-50/40'
                                  : 'border-slate-200 bg-white hover:bg-slate-50',
                              )}
                            >
                              <div className="flex items-start gap-2.5 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    if (checked) {
                                      setSelectedTables((prev) =>
                                        prev.filter((n) => n !== tbl.tableName),
                                      );
                                    } else {
                                      const next = new Set(selectedTables);
                                      next.add(tbl.tableName);
                                      tbl.autoSelectChildren.forEach((child) =>
                                        next.add(child),
                                      );
                                      setSelectedTables(Array.from(next));
                                    }
                                  }}
                                  className="mt-0.5 rounded border-slate-300 text-rose-700 focus:ring-rose-600"
                                />
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-semibold text-slate-900">
                                      {tbl.label}
                                    </span>
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                                      {tbl.tableName}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 text-[11px] text-slate-500">
                                    {tbl.description}
                                  </p>
                                  {tbl.autoSelectChildren.length > 0 && (
                                    <p className="mt-1 font-mono text-[10px] text-amber-800">
                                      Auto-includes:{' '}
                                      {tbl.autoSelectChildren.join(', ')}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="shrink-0 text-right font-mono">
                                <span
                                  className={cn(
                                    'inline-block rounded px-2 py-0.5 text-xs font-semibold tabular-nums',
                                    activeRowCount > 0
                                      ? 'bg-slate-900 text-white'
                                      : 'bg-slate-100 text-slate-500',
                                  )}
                                >
                                  {activeRowCount.toLocaleString()} rows
                                </span>
                                <span className="mt-0.5 block text-[10px] text-slate-400">
                                  Org: {tbl.orgRowCount} · DB: {tbl.globalRowCount}
                                </span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Confirmation Modal for Table Purge */}
          <Modal
            open={confirmPurgeModalOpen}
            onClose={() => setConfirmPurgeModalOpen(false)}
            title="Confirm Selective Database Table Purge"
            description={
              purgeScope === 'GLOBAL'
                ? 'WARNING: You have selected WHOLE DATABASE (GLOBAL) scope. Rows in the selected tables will be permanently deleted across ALL organizations.'
                : 'Rows in the selected tables will be permanently deleted for the active organization.'
            }
            size="lg"
          >
            <div className="space-y-4 text-xs">
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-amber-950 flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    Scope:{' '}
                    {purgeScope === 'GLOBAL'
                      ? 'Whole Database (All Organizations)'
                      : 'Active Organization Only'}
                  </p>
                  <p className="mt-0.5 text-amber-800">
                    Google OAuth Users (`users`), Organizations (`organizations`), RBAC Team Memberships (`organization_members`), and the 10 System GL Accounts (`1000`–`6000`) are strictly protected and will not be touched.
                  </p>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Tables Scheduled for Purge ({selectedTables.length})
                </p>
                <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto p-2.5 rounded border border-slate-200 bg-slate-50">
                  {selectedTables.map((t) => (
                    <span
                      key={t}
                      className="rounded border border-rose-200 bg-white px-2 py-0.5 font-mono text-[11px] font-medium text-rose-900"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={purgingTables}
                  onClick={() => setConfirmPurgeModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  loading={purgingTables}
                  onClick={async () => {
                    setPurgingTables(true);
                    setErrorBanner(null);
                    try {
                      const res = await developerApi.purgeTables({
                        scope: purgeScope,
                        tables: selectedTables,
                      });
                      setPurgeReceipt(res);
                      setConfirmPurgeModalOpen(false);
                      setSelectedTables([]);
                      await Promise.all([
                        loadDatabaseTables(),
                        loadDiagnostics(),
                      ]);
                    } catch (err) {
                      setErrorBanner(
                        err instanceof Error
                          ? err.message
                          : 'Failed to purge selected database tables.',
                      );
                      setConfirmPurgeModalOpen(false);
                    } finally {
                      setPurgingTables(false);
                    }
                  }}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Confirm &amp; Purge {selectedTables.length} Table
                  {selectedTables.length === 1 ? '' : 's'}
                </Button>
              </div>
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}
