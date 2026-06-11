import {
  CONTACT_FIELDS,
  ContactSchema,
  emptyContact,
  isBlankContact,
  mergeContacts,
  buildExtractionPrompt,
  buildLinkedInSearchUrl,
  toTrackerContact,
  toTrackerCandidate,
  buildPushNote,
} from '@/lib/contact-schema';

describe('ContactSchema', () => {
  it('fills missing fields with empty strings', () => {
    const parsed = ContactSchema.parse({ 'First Name': 'Ada' });
    expect(parsed['First Name']).toBe('Ada');
    expect(parsed['E-mail 1']).toBe('');
    expect(Object.keys(parsed).sort()).toEqual([...CONTACT_FIELDS].sort());
  });

  it('tolerates nulls and numbers from model output', () => {
    const parsed = ContactSchema.parse({ 'First Name': null, 'Phone 1': 5551234567 });
    expect(parsed['First Name']).toBe('');
    expect(parsed['Phone 1']).toBe('');
  });

  it('strips unknown keys', () => {
    const parsed = ContactSchema.parse({ 'First Name': 'Ada', hallucinated: 'yes' });
    expect('hallucinated' in parsed).toBe(false);
  });

  it('trims whitespace', () => {
    expect(ContactSchema.parse({ 'Last Name': '  Lovelace ' })['Last Name']).toBe('Lovelace');
  });
});

describe('isBlankContact', () => {
  it('treats a contact with only address data as blank', () => {
    const c = emptyContact();
    c['Address 1 - City'] = 'Houston';
    expect(isBlankContact(c)).toBe(true);
  });

  it('treats a contact with a phone as non-blank', () => {
    const c = emptyContact();
    c['Phone 1'] = '555-123-4567';
    expect(isBlankContact(c)).toBe(false);
  });
});

describe('mergeContacts', () => {
  it('prefers primary and falls back to secondary per field', () => {
    const qr = emptyContact();
    qr['First Name'] = 'Ada';
    qr['E-mail 1'] = 'ada@example.com';
    const ai = emptyContact();
    ai['First Name'] = 'Ada-OCR';
    ai['Organization Name'] = 'Analytical Engines Inc';
    const merged = mergeContacts(qr, ai);
    expect(merged['First Name']).toBe('Ada');
    expect(merged['E-mail 1']).toBe('ada@example.com');
    expect(merged['Organization Name']).toBe('Analytical Engines Inc');
  });
});

describe('buildExtractionPrompt', () => {
  it('renders every schema field so the prompt cannot drift', () => {
    const prompt = buildExtractionPrompt();
    for (const field of CONTACT_FIELDS) {
      expect(prompt).toContain(`"${field}"`);
    }
  });
});

describe('buildLinkedInSearchUrl', () => {
  it('builds a people-search URL from name and company', () => {
    const c = emptyContact();
    c['First Name'] = 'Ada';
    c['Last Name'] = 'Lovelace';
    c['Organization Name'] = 'Analytical Engines';
    expect(buildLinkedInSearchUrl(c)).toBe(
      'https://www.linkedin.com/search/results/people/?keywords=Ada%20Lovelace%20Analytical%20Engines'
    );
  });

  it('returns empty without a full name', () => {
    const c = emptyContact();
    c['First Name'] = 'Ada';
    expect(buildLinkedInSearchUrl(c)).toBe('');
  });
});

describe('Tracker mappings', () => {
  const full = (): ReturnType<typeof emptyContact> => {
    const c = emptyContact();
    c['First Name'] = 'Ada';
    c['Last Name'] = 'Lovelace';
    c['E-mail 1'] = 'ada@example.com';
    c['Phone 1'] = '(555) 123-4567';
    c['Organization Name'] = 'Analytical Engines';
    c['Organization Title'] = 'Chief Engineer';
    c['Address 1 - Street'] = '1 Engine Way';
    c['Address 1 - City'] = 'Houston';
    c['Address 1 - Region'] = 'TX';
    c['Address 1 - Postal Code'] = '77002';
    c['Country'] = 'United States';
    c['Website 1 - Value'] = 'https://example.com';
    c['LinkedIn Profile'] = 'https://www.linkedin.com/search/results/people/?keywords=x';
    return c;
  };

  it('maps contact fields to the verified Tracker object shape (nested contactDetails/address)', () => {
    const t = toTrackerContact(full(), 'scan note');
    expect(t).toMatchObject({
      firstName: 'Ada',
      surname: 'Lovelace',
      jobTitle: 'Chief Engineer',
      company: 'Analytical Engines',
      website: 'https://example.com',
      source: 'Business card scan',
      note: 'scan note',
      contactDetails: {
        email: 'ada@example.com',
        mobilePhone: '(555) 123-4567',
      },
      address: {
        addressLine1: '1 Engine Way',
        town: 'Houston',
        county: 'TX',
        postcode: '77002',
        country: 'United States',
      },
    });
    // A flat create payload silently drops these - they must be nested.
    expect('email' in t).toBe(false);
    expect('mobilePhone' in t).toBe(false);
    expect('addressLine1' in t).toBe(false);
  });

  it('never maps the fabricated LinkedIn search URL to a Tracker field', () => {
    const t = toTrackerContact(full());
    const flatten = (o: unknown): string[] =>
      o && typeof o === 'object' ? Object.values(o).flatMap(flatten) : [String(o)];
    expect(flatten(t).some((v) => v.includes('linkedin.com'))).toBe(false);
  });

  it('maps a verified LinkedIn profile URL (QR vCard) to linkedInUrl', () => {
    const c = full();
    c['LinkedIn Profile'] = 'https://www.linkedin.com/in/ada-lovelace';
    expect(toTrackerContact(c).linkedInUrl).toBe('https://www.linkedin.com/in/ada-lovelace');
    expect(toTrackerCandidate(c).linkedInUrl).toBe('https://www.linkedin.com/in/ada-lovelace');
  });

  it('omits empty fields and empty nested objects entirely', () => {
    const c = emptyContact();
    c['First Name'] = 'Ada';
    const t = toTrackerContact(c);
    expect('contactDetails' in t).toBe(false);
    expect('address' in t).toBe(false);
    expect('company' in t).toBe(false);
    expect('note' in t).toBe(false);
  });

  it('uses camelCase firstName for candidates (full-object casing, not the list casing)', () => {
    const t = toTrackerCandidate(full(), 'note');
    expect(t.firstName).toBe('Ada');
    expect('firstname' in t).toBe(false);
    // Resources have no company field; org rides in the note.
    expect('company' in t).toBe(false);
    expect(t.source).toBe('Business card scan');
  });
});

describe('buildPushNote', () => {
  it('includes scan date and the LinkedIn search link', () => {
    const c = emptyContact();
    c['Organization Name'] = 'Analytical Engines';
    c['LinkedIn Profile'] = 'https://www.linkedin.com/search/x';
    const note = buildPushNote(c, '2026-06-10');
    expect(note).toContain('2026-06-10');
    expect(note).toContain('Analytical Engines');
    expect(note).toContain('LinkedIn search link');
  });
});
