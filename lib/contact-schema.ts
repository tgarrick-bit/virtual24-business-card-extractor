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
// Field names verified 2026-06-10 against live read-only API responses:
// Contact list (POST /api/v1/Contact/Search) and Resource list
// (POST /api/v1/Resource/Search). Note the casing trap: contacts use
// `firstName`, candidates use `firstname`.
// ---------------------------------------------------------------------------

function compact(obj: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v.trim() !== ''));
}

export function toTrackerContact(c: ContactData): Record<string, string> {
  return compact({
    firstName: c['First Name'],
    surname: c['Last Name'],
    displayAs: `${c['First Name']} ${c['Last Name']}`.trim(),
    jobTitle: c['Organization Title'],
    company: c['Organization Name'],
    addressLine1: c['Address 1 - Street'],
    addressLine2: c['Address 1 - Extended Address'],
    town: c['Address 1 - City'],
    county: c['Address 1 - Region'],
    postcode: c['Address 1 - Postal Code'],
    country: c['Country'],
    mobilePhone: c['Phone 1'],
    email: c['E-mail 1'],
    website: c['Website 1 - Value'],
    contactSource: 'Business card scan',
    // 'LinkedIn Profile' is deliberately NOT mapped to linkedInUrl: it is a
    // fabricated people-search URL, not a verified profile. It goes in the note.
  });
}

export function toTrackerCandidate(c: ContactData): Record<string, string> {
  return compact({
    firstname: c['First Name'], // lowercase n - verified, differs from Contact
    surname: c['Last Name'],
    displayAs: `${c['First Name']} ${c['Last Name']}`.trim(),
    jobTitle: c['Organization Title'],
    addressLine1: c['Address 1 - Street'],
    addressLine2: c['Address 1 - Extended Address'],
    town: c['Address 1 - City'],
    county: c['Address 1 - Region'],
    postcode: c['Address 1 - Postal Code'],
    country: c['Country'],
    mobilePhone: c['Phone 1'],
    email: c['E-mail 1'],
    whereDidYouHear: 'Business card scan',
  });
}

export function buildPushNote(c: ContactData, scannedAt: string): string {
  const lines = [
    `Created from business card scan on ${scannedAt}.`,
    c['Organization Name'] && `Company: ${c['Organization Name']}`,
    c['Website 1 - Value'] && `Website: ${c['Website 1 - Value']}`,
    c['Address 1'] && `Address: ${c['Address 1']}`,
    c['LinkedIn Profile'] && `LinkedIn search link: ${c['LinkedIn Profile']}`,
  ].filter(Boolean);
  return lines.join('\n');
}
