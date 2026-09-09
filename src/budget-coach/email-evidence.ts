import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { CoachTransaction } from './reader.js';

const execFileP = promisify(execFile);

export interface EmailEvidenceMessage {
  id: string;
  date: string;
  from: string;
  subject: string;
  labels: string[];
}

export interface EmailEvidenceQueryRun {
  query: string;
  match_count: number;
  messages: EmailEvidenceMessage[];
  truncated: boolean;
}

export type EmailEvidenceSignal =
  | 'amazon_order_generic'
  | 'amazon_item_specific'
  | 'travel'
  | 'rideshare'
  | 'lodging'
  | 'restaurant'
  | 'subscription'
  | 'medical'
  | 'daycare'
  | 'business_cloud'
  | 'generic_receipt';

export interface TransactionEmailEvidence {
  transaction_id: string;
  source: 'gmail';
  account: string;
  merchant_term: string | null;
  queries: EmailEvidenceQueryRun[];
  messages: EmailEvidenceMessage[];
  signals: EmailEvidenceSignal[];
  has_specific_item_evidence: boolean;
  notes: string[];
}

export interface EmailEvidenceProvider {
  searchForTransaction(tx: CoachTransaction): Promise<TransactionEmailEvidence | null>;
}

export interface GogEmailProviderOptions {
  account?: string;
  timeoutMs?: number;
  maxResults?: number;
  windowDays?: number;
  keyringPassword?: string;
}

const DEFAULT_EMAIL_ACCOUNT = 'armsteadj1@gmail.com';
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_WINDOW_DAYS = 7;

const STOP_TOKENS = new Set([
  'the', 'a', 'an', 'and', 'llc', 'inc', 'co', 'com', 'net', 'org', 'corp',
  'sq', 'square', 'tst', 'pos', 'online', 'store', 'www', 'http', 'https',
  'usa', 'paypal', 'pmnt', 'pay',
]);

const NUMERIC_RE = /^[0-9]+$/;

export function pickMerchantTerm(tx: CoachTransaction): string | null {
  const sources = [tx.payee_name, tx.import_payee_name, tx.import_payee_name_original];
  for (const src of sources) {
    if (!src) continue;
    const tokens = src
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t && t.length >= 3 && !STOP_TOKENS.has(t) && !NUMERIC_RE.test(t));
    if (tokens.length > 0) return tokens[0];
  }
  return null;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function gmailDateFormat(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${y}/${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

function sanitizeTerm(term: string): string | null {
  const cleaned = term.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return cleaned.length >= 3 ? cleaned : null;
}

export function buildGmailQueries(
  term: string,
  txDate: string,
  windowDays: number
): string[] {
  const safeTerm = sanitizeTerm(term);
  if (!safeTerm) return [];
  const after = gmailDateFormat(shiftDate(txDate, -windowDays));
  const before = gmailDateFormat(shiftDate(txDate, windowDays + 1));
  return [
    `from:${safeTerm} after:${after} before:${before}`,
    `${safeTerm} after:${after} before:${before}`,
  ];
}

interface GogJsonResponse {
  messages?: Array<{
    id?: string;
    threadId?: string;
    date?: string;
    from?: string;
    subject?: string;
    labels?: string[];
  }>;
  nextPageToken?: string;
}

async function runGogSearch(
  query: string,
  account: string,
  maxResults: number,
  timeoutMs: number,
  keyringPassword?: string
): Promise<EmailEvidenceMessage[]> {
  const args = [
    'gmail',
    'messages',
    'search',
    query,
    '--account',
    account,
    '--max',
    String(maxResults),
    '--json',
    '--no-input',
  ];
  const env = {
    ...process.env,
    ...(keyringPassword ? { GOG_KEYRING_PASSWORD: keyringPassword } : {}),
  };
  try {
    const { stdout } = await execFileP('gog', args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      env,
    });
    const parsed = JSON.parse(stdout) as GogJsonResponse;
    return (parsed.messages ?? []).map((m) => ({
      id: m.id ?? '',
      date: m.date ?? '',
      from: m.from ?? '',
      subject: m.subject ?? '',
      labels: Array.isArray(m.labels) ? m.labels : [],
    }));
  } catch {
    return [];
  }
}

const ITEM_SPECIFIC_PATTERNS = [
  /your\s+amazon\b.*order\s+of\s+["“]/i,
  /your\s+order\s+of\s+["“]/i,
  /shipped:\s+/i,
  /delivered:\s+/i,
  /invoice\s+#?\d/i,
  /receipt\s+for\s+\S/i,
  /itinerary\s+for\s+\S/i,
];

const SIGNAL_RULES: Array<{
  signal: EmailEvidenceSignal;
  match: (msg: EmailEvidenceMessage) => boolean;
}> = [
  {
    signal: 'amazon_item_specific',
    match: (m) =>
      /amazon/i.test(m.from) &&
      (/your\s+amazon\b.*order\s+of\s+["“]/i.test(m.subject) ||
        /your\s+order\s+of\s+["“]/i.test(m.subject) ||
        /shipped:\s+/i.test(m.subject) ||
        /delivered:\s+/i.test(m.subject)),
  },
  {
    signal: 'amazon_order_generic',
    match: (m) =>
      /amazon/i.test(m.from) && /(order|shipment|delivery|payment)/i.test(m.subject),
  },
  {
    signal: 'travel',
    match: (m) =>
      /(airline|airfare|flight|delta|united|jetblue|southwest|alaska air)/i.test(
        `${m.from} ${m.subject}`
      ),
  },
  {
    signal: 'lodging',
    match: (m) =>
      /(airbnb|hotel|marriott|hilton|hyatt|ihg|booking\.com|vrbo)/i.test(
        `${m.from} ${m.subject}`
      ),
  },
  {
    signal: 'rideshare',
    match: (m) => /(uber|lyft)/i.test(`${m.from} ${m.subject}`),
  },
  {
    signal: 'restaurant',
    match: (m) =>
      /(opentable|toast|resy|doordash|grubhub|ubereats|uber eats|seamless)/i.test(
        `${m.from} ${m.subject}`
      ),
  },
  {
    signal: 'subscription',
    match: (m) =>
      /(netflix|spotify|hulu|disney\+|youtube premium|patreon|apple\.com\/bill|nytimes)/i.test(
        `${m.from} ${m.subject}`
      ),
  },
  {
    signal: 'medical',
    match: (m) =>
      /(clinic|hospital|medical|pharmacy|cvs health|walgreens|prescription|copay|veterinary|vca)/i.test(
        `${m.from} ${m.subject}`
      ),
  },
  {
    signal: 'daycare',
    match: (m) =>
      /(daycare|preschool|childcare|tuition|kindercare|brighthorizons|montessori)/i.test(
        `${m.from} ${m.subject}`
      ),
  },
  {
    signal: 'business_cloud',
    match: (m) =>
      /(aws|amazon web services|google cloud|gcp|vercel|stripe|github|netlify|render|cloudflare)/i.test(
        `${m.from} ${m.subject}`
      ),
  },
  {
    signal: 'generic_receipt',
    match: (m) =>
      /(receipt|invoice|order confirmation|thank you for your order|your purchase)/i.test(
        m.subject
      ),
  },
];

export function classifyEmailSignals(messages: EmailEvidenceMessage[]): {
  signals: EmailEvidenceSignal[];
  itemSpecific: boolean;
} {
  const set = new Set<EmailEvidenceSignal>();
  let itemSpecific = false;
  for (const m of messages) {
    for (const rule of SIGNAL_RULES) {
      if (rule.match(m)) set.add(rule.signal);
    }
    if (ITEM_SPECIFIC_PATTERNS.some((re) => re.test(m.subject))) {
      itemSpecific = true;
    }
  }
  if (set.has('amazon_item_specific')) itemSpecific = true;
  return { signals: [...set], itemSpecific };
}

export function createGogEmailEvidenceProvider(
  opts: GogEmailProviderOptions = {}
): EmailEvidenceProvider {
  const account =
    opts.account ?? process.env.YNAB_EMAIL_ACCOUNT ?? DEFAULT_EMAIL_ACCOUNT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResults = Math.max(1, Math.min(opts.maxResults ?? DEFAULT_MAX_RESULTS, 20));
  const windowDays = Math.max(1, Math.min(opts.windowDays ?? DEFAULT_WINDOW_DAYS, 30));
  const keyringPassword = opts.keyringPassword ?? process.env.GOG_KEYRING_PASSWORD;

  return {
    async searchForTransaction(tx) {
      const term = pickMerchantTerm(tx);
      if (!term) return null;
      const queries = buildGmailQueries(term, tx.date, windowDays);
      if (queries.length === 0) return null;

      const runs: EmailEvidenceQueryRun[] = [];
      const seen = new Map<string, EmailEvidenceMessage>();

      for (const q of queries) {
        const msgs = await runGogSearch(
          q,
          account,
          maxResults,
          timeoutMs,
          keyringPassword
        );
        runs.push({
          query: q,
          match_count: msgs.length,
          messages: msgs,
          truncated: msgs.length >= maxResults,
        });
        for (const m of msgs) {
          if (m.id && !seen.has(m.id)) seen.set(m.id, m);
        }
        if (seen.size >= maxResults) break;
      }

      const messages = [...seen.values()].slice(0, maxResults);
      const { signals, itemSpecific } = classifyEmailSignals(messages);
      const notes: string[] = [];
      if (messages.length === 0) {
        notes.push(`No Gmail matches near ${tx.date} for term "${term}".`);
      } else {
        notes.push(
          `Gmail matched ${messages.length} message(s) within ±${windowDays} days using term "${term}".`
        );
        if (!itemSpecific && /amazon|amzn/i.test(term)) {
          notes.push(
            'Amazon receipts found, but no item-level subject — keep human review.'
          );
        }
      }

      return {
        transaction_id: tx.id,
        source: 'gmail',
        account,
        merchant_term: term,
        queries: runs,
        messages,
        signals,
        has_specific_item_evidence: itemSpecific,
        notes,
      };
    },
  };
}

export function isAmazonLikeMerchant(
  payeeName: string | null,
  importPayeeName: string | null
): boolean {
  const haystack = [payeeName, importPayeeName].filter(Boolean).join(' ').toLowerCase();
  return /(amazon|amzn)/.test(haystack);
}
