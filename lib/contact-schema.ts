import { z } from 'zod';

// Single source of truth for the extracted-contact shape. The field names are
// Google Contacts CSV headers because the CSV export depends on them verbatim.
export const CONTACT_FIELDS = [
  'First Name',
  'Last Name',
  'E-mail 1',
  'Phone 1',
  'Address 1',
  'Country',
  'Address 1 - Street',
  'Address 1 - Extended Address',
  'Address 1 - City',
  'Address 1 - Region',
  'Address 1 - Postal Code',
  'Organization Name',
  'Organization Title',
  'Website 1 - Value',
  'LinkedIn Profile',
] as const;

export type ContactField = (typeof CONTACT_FIELDS)[number];

// .catch('') tolerates nulls/numbers from model output; .default('') tolerates
// missing keys. Unknown keys are stripped by default.
export const ContactSchema = z.object(
  Object.fromEntries(
    CONTACT_FIELDS.map((f) => [f, z.string().trim().catch('').default('')])
  ) as Record<ContactField, z.ZodDefault<z.ZodCatch<z.ZodString>>>
);

export type ContactData = Record<ContactField, string>;

export const emptyContact = (): ContactData => ContactSchema.parse({});

// A row with no name, email, or phone carries nothing worth exporting or
// pushing - it is a failed extraction, whatever produced it.
export const isBlankContact = (c: ContactData): boolean =>
  !c['First Name'] && !c['Last Name'] && !c['E-mail 1'] && !c['Phone 1'];

// Per-field merge: primary wins, secondary fills gaps. Used to overlay
// QR-decoded vCard data (authoritative) on top of AI/OCR extraction.
export function mergeContacts(primary: ContactData, secondary: ContactData): ContactData {
  const out = emptyContact();
  for (const f of CONTACT_FIELDS) out[f] = primary[f] || secondary[f] || '';
  return out;
}

// The AI extraction prompt renders its field list from here so the schema
// cannot drift from what the model is asked to produce.
export function buildExtractionPrompt(): string {
  const jsonShape = CONTACT_FIELDS.map((f) => `  "${f}": ""`).join(',\n');
  return `Please extract contact information from this business card image and return it as a JSON object with the following exact field names:

{
${jsonShape}
}

Instructions:
- Extract the person's first and last name separately
- Find email address and phone number
- For Phone 1: If there are multiple phone numbers, prioritize mobile/cell numbers over office/work numbers. Look for labels like "mobile", "cell", "personal" or numbers that appear to be mobile format
- For addresses, try to parse street, city, state/region, and postal code separately
- If you can't find a specific field, leave it as an empty string
- For websites, include the full URL (add https:// if missing)
- Organization Name should be the company name
- Organization Title should be the person's job title/position
- Address 1 should be the complete address as a single string
- Country should be inferred from context (default to "United States" if unclear)
- For LinkedIn Profile: Leave empty for now (will be filled separately)
- Return ONLY the JSON object, no additional text or formatting`;
}

export function buildLinkedInSearchUrl(c: ContactData): string {
  if (!c['First Name'] || !c['Last Name']) return '';
  const terms = [c['First Name'], c['Last Name'], c['Organization Name']]
    .filter(Boolean)
    .join(' ');
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(terms)}`;
}

// ---------------------------------------------------------------------------
// ATS Tracker (TrackerRMS) field mappings.
// The create endpoints accept the FULL OBJECT shape returned by
// GET /api/v1/Contact/{id} and GET /api/v1/Resource/{id} (verified live
// 2026-06-11): identity fields are top-level, but email/phone nest under
// `contactDetails` and the address under `address`. The flat *Search list
// records use different names (and `firstname` casing for resources) - do
// NOT map from those. A flat create payload silently drops email/phone.
// `note` is a top-level field on the object; the separate Notes endpoint
// 404s on this API version.
// ---------------------------------------------------------------------------

function compact(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v.trim() !== ''));
}

// A real profile URL (e.g. from a QR vCard) maps to Tracker's linkedInUrl
// field; the generated people-search links do NOT - a guessed URL in a
// structured ATS field is fabricated data. Search links ride in the note.
export const isLinkedInProfileUrl = (url: string): boolean =>
  /^https?:\/\/([a-z]+\.)?linkedin\.com\/(in|pub)\//i.test(url.trim());

function trackerEntityBase(c: ContactData, note: string): Record<string, unknown> {
  const out: Record<string, unknown> = compact({
    firstName: c['First Name'],
    surname: c['Last Name'],
    jobTitle: c['Organization Title'],
    website: c['Website 1 - Value'],
    source: 'Business card scan',
    note,
    linkedInUrl: isLinkedInProfileUrl(c['LinkedIn Profile']) ? c['LinkedIn Profile'] : '',
  });
  const contactDetails = compact({
    email: c['E-mail 1'],
    mobilePhone: c['Phone 1'],
  });
  if (Object.keys(contactDetails).length > 0) out.contactDetails = contactDetails;
  const address = compact({
    addressLine1: c['Address 1 - Street'],
    addressLine2: c['Address 1 - Extended Address'],
    town: c['Address 1 - City'],
    county: c['Address 1 - Region'],
    postcode: c['Address 1 - Postal Code'],
    country: c['Country'],
  });
  if (Object.keys(address).length > 0) out.address = address;
  return out;
}

export function toTrackerContact(c: ContactData, note = ''): Record<string, unknown> {
  const out = trackerEntityBase(c, note);
  if (c['Organization Name']) out.company = c['Organization Name'];
  return out;
}

export function toTrackerCandidate(c: ContactData, note = ''): Record<string, unknown> {
  // Resources have no `company` field; the org goes in the note instead.
  return trackerEntityBase(c, note);
}

export function buildPushNote(c: ContactData, scannedAt: string): string {
  const li = c['LinkedIn Profile'];
  const lines = [
    `Created from business card scan on ${scannedAt}.`,
    c['Organization Name'] && `Company: ${c['Organization Name']}`,
    c['Website 1 - Value'] && `Website: ${c['Website 1 - Value']}`,
    c['Address 1'] && `Address: ${c['Address 1']}`,
    li && (isLinkedInProfileUrl(li) ? `LinkedIn profile: ${li}` : `LinkedIn search link: ${li}`),
  ].filter(Boolean);
  return lines.join('\n');
}
