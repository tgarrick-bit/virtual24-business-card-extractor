import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ContactSchema,
  isBlankContact,
  toTrackerContact,
  toTrackerCandidate,
  buildPushNote,
  type ContactData,
} from '@/lib/contact-schema';
import {
  getTrackerClient,
  extractRecordId,
  normalizePhone,
  TrackerError,
  type TrackerContactRecord,
} from '@/lib/tracker-client';

export const fetchCache = 'force-no-store';
export const revalidate = 0;
// Dedup crawl + create can take a while on serverless cold starts.
export const maxDuration = 60;

const PushRequestSchema = z.object({
  contact: ContactSchema,
  entity: z.enum(['contact', 'candidate']).default('contact'),
  // check: only look for duplicates; create: create unless duplicate found;
  // force: create even if a duplicate exists.
  mode: z.enum(['check', 'create', 'force']).default('create'),
});

function findDuplicates(contact: ContactData, records: TrackerContactRecord[]) {
  const email = contact['E-mail 1'].trim().toLowerCase();
  const phone = normalizePhone(contact['Phone 1']);
  return records
    .filter((r) => {
      const rEmail = (r.email || '').trim().toLowerCase();
      if (email && rEmail && rEmail === email) return true;
      if (phone && phone.length >= 10) {
        if (normalizePhone(r.mobilePhone) === phone) return true;
        if (normalizePhone(r.businessPhone) === phone) return true;
      }
      return false;
    })
    .slice(0, 5)
    .map((r) => ({
      trackerId: r.contactId,
      name: r.displayAs || `${r.firstName || ''} ${r.surname || ''}`.trim(),
      email: r.email || '',
      company: r.company || r.clientName || '',
    }));
}

export async function POST(request: NextRequest) {
  let parsed;
  try {
    parsed = PushRequestSchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_contact', issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const { contact, entity, mode } = parsed.data;

  if (isBlankContact(contact)) {
    return NextResponse.json(
      { error: 'invalid_contact', issues: [{ message: 'Contact has no name, email, or phone' }] },
      { status: 400 }
    );
  }

  try {
    const tracker = getTrackerClient();

    // Duplicate detection. Tracker's search ignores text filters, so this
    // matches against a bounded crawl of the contact list; dedupCoverage is
    // 'full' only when the crawl reached the end of the dataset.
    let duplicates: ReturnType<typeof findDuplicates> = [];
    let dedupCoverage: 'full' | 'partial' | 'skipped' = 'skipped';
    if (entity === 'contact' && mode !== 'force') {
      try {
        const snapshot = await tracker.getContactSnapshot();
        duplicates = findDuplicates(contact, snapshot.records);
        dedupCoverage = snapshot.complete ? 'full' : 'partial';
      } catch (err) {
        console.error('tracker-push: dedup crawl failed, continuing without it:', errMessage(err));
      }
    }

    if (mode === 'check') {
      return NextResponse.json({
        status: duplicates.length > 0 ? 'duplicate' : 'clear',
        matches: duplicates,
        dedupCoverage,
      });
    }

    if (mode === 'create' && duplicates.length > 0) {
      return NextResponse.json(
        { status: 'duplicate', matches: duplicates, dedupCoverage },
        { status: 409 }
      );
    }

    // The note rides inside the create payload (top-level `note` field on the
    // Tracker object); the separate Notes endpoint 404s on this API version.
    const note = buildPushNote(contact, new Date().toISOString().slice(0, 10));
    const payload =
      entity === 'candidate' ? toTrackerCandidate(contact, note) : toTrackerContact(contact, note);
    const created = await (entity === 'candidate'
      ? tracker.createCandidate(payload)
      : tracker.createContact(payload));
    const trackerId = extractRecordId(created, ['contactId', 'resourceId']);

    return NextResponse.json(
      { status: 'created', entity, trackerId, dedupCoverage },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof TrackerError) {
      const status = err.code === 'tracker_auth_failed' ? 502 : err.code === 'tracker_unreachable' ? 502 : 502;
      console.error('tracker-push:', err.code, errMessage(err));
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error('tracker-push: unexpected error:', errMessage(err));
    return NextResponse.json({ error: 'tracker_push_failed' }, { status: 500 });
  }
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));
