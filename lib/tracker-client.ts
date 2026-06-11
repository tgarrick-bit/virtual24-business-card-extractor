// Trimmed ATS Tracker (TrackerRMS) client, ported from virtual24's
// src/lib/tracker-api.ts. Server-side only - the bearer token and JWT must
// never reach the browser.
//
// Known Tracker API behaviors (verified live in virtual24, 2026-05/06):
// - Auth: POST /api/Auth/ExchangeToken { bearerToken } -> { token, expiration }
//   (JWT valid ~7 days; we re-exchange within 1 hour of expiry).
// - The *Search endpoints IGNORE all text filters and return a fixed default
//   list paginated 10 records per page, so duplicate detection crawls pages
//   and matches client-side, bounded by maxPages.
// - Rate limit ~100 req/min.

export interface TrackerContactRecord {
  contactId: number;
  firstName?: string;
  surname?: string;
  displayAs?: string;
  email?: string;
  mobilePhone?: string;
  businessPhone?: string;
  company?: string;
  clientName?: string;
  [key: string]: unknown;
}

interface ContactSnapshot {
  records: TrackerContactRecord[];
  complete: boolean; // true if the crawl reached the end of the dataset
  fetchedAt: number;
}

const DEFAULT_BASE_URL = 'https://evousapi.tracker-rms.com';
const PAGE_SIZE = 10; // server-side cap regardless of what you request
const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

export class TrackerClient {
  private bearerToken: string;
  private baseUrl: string;
  private jwt: string | null = null;
  private jwtExpiry: Date | null = null;
  private snapshot: ContactSnapshot | null = null;

  constructor(bearerToken: string, baseUrl?: string) {
    this.bearerToken = bearerToken;
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private async authenticate(): Promise<string> {
    if (this.jwt && this.jwtExpiry && new Date() < new Date(this.jwtExpiry.getTime() - 3600000)) {
      return this.jwt;
    }
    const res = await fetch(`${this.baseUrl}/api/Auth/ExchangeToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bearerToken: this.bearerToken }),
    });
    if (!res.ok) {
      throw new TrackerError('tracker_auth_failed', `Tracker auth failed (${res.status})`);
    }
    const data = (await res.json()) as { token: string; expiration: string };
    this.jwt = data.token;
    this.jwtExpiry = new Date(data.expiration);
    return this.jwt;
  }

  private async request(endpoint: string, options: RequestInit = {}): Promise<unknown> {
    const jwt = await this.authenticate();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
          ...options.headers,
        },
      });
    } catch {
      throw new TrackerError('tracker_unreachable', `Tracker unreachable on ${endpoint}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new TrackerError(
        res.status === 401 ? 'tracker_auth_failed' : 'tracker_api_error',
        `Tracker API error (${res.status}) on ${endpoint}: ${body.slice(0, 300)}`,
        res.status
      );
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  private static extractList(raw: unknown): TrackerContactRecord[] {
    if (Array.isArray(raw)) return raw as TrackerContactRecord[];
    if (raw && typeof raw === 'object') {
      for (const k of ['contacts', 'results', 'data']) {
        const v = (raw as Record<string, unknown>)[k];
        if (Array.isArray(v)) return v as TrackerContactRecord[];
      }
    }
    return [];
  }

  // Crawl the contact list into an in-memory snapshot for duplicate matching.
  // Bounded by maxPages; `complete` reports honestly whether we saw everything.
  async getContactSnapshot(maxPages = 10): Promise<ContactSnapshot> {
    if (this.snapshot && Date.now() - this.snapshot.fetchedAt < SNAPSHOT_TTL_MS) {
      return this.snapshot;
    }
    const records: TrackerContactRecord[] = [];
    let complete = false;
    for (let page = 1; page <= maxPages; page++) {
      const raw = await this.request('/api/v1/Contact/Search', {
        method: 'POST',
        body: JSON.stringify({ searchText: '', companyName: '', pageSize: PAGE_SIZE, pageNumber: page }),
      });
      const list = TrackerClient.extractList(raw);
      records.push(...list);
      if (list.length < PAGE_SIZE) {
        complete = true;
        break;
      }
    }
    this.snapshot = { records, complete, fetchedAt: Date.now() };
    return this.snapshot;
  }

  invalidateSnapshot() {
    this.snapshot = null;
  }

  async createContact(data: Record<string, unknown>): Promise<unknown> {
    this.invalidateSnapshot();
    return this.request('/api/v1/Contact', { method: 'POST', body: JSON.stringify(data) });
  }

  async createCandidate(data: Record<string, unknown>): Promise<unknown> {
    return this.request('/api/v1/Resource', { method: 'POST', body: JSON.stringify(data) });
  }

  // Endpoint shape is a best-effort port from virtual24 (flagged there as
  // unverified against the JWT API). Callers treat failure as non-fatal.
  async addNote(entity: 'contact' | 'candidate', entityId: string | number, text: string): Promise<void> {
    const seg = entity === 'candidate' ? 'Resource' : 'Contact';
    await this.request(`/api/v1/${seg}/${entityId}/Notes`, {
      method: 'POST',
      body: JSON.stringify({ text, type: 'general' }),
    });
  }
}

export class TrackerError extends Error {
  code: 'tracker_auth_failed' | 'tracker_unreachable' | 'tracker_api_error';
  status?: number;
  constructor(code: TrackerError['code'], message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Pull a numeric/record id out of whatever shape the create endpoint returns.
export function extractRecordId(raw: unknown, keys: string[]): string | null {
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object') {
    for (const k of [...keys, 'id']) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'number' || (typeof v === 'string' && v)) return String(v);
    }
  }
  return null;
}

export const normalizePhone = (p: string | undefined | null): string =>
  (p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

let client: TrackerClient | null = null;

export function getTrackerClient(): TrackerClient {
  const token = process.env.TRACKER_API_TOKEN;
  if (!token) throw new TrackerError('tracker_auth_failed', 'TRACKER_API_TOKEN not configured');
  if (!client) client = new TrackerClient(token, process.env.TRACKER_API_URL);
  return client;
}
