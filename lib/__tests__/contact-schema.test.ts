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

  it('maps contact fields to the verified Tracker Contact names', () => {
    const t = toTrackerContact(full());
    expect(t).toMatchObject({
      firstName: 'Ada',
      surname: 'Lovelace',
      displayAs: 'Ada Lovelace',
      jobTitle: 'Chief Engineer',
      company: 'Analytical Engines',
      addressLine1: '1 Engine Way',
      town: 'Houston',
      county: 'TX',
      postcode: '77002',
      country: 'United States',
      mobilePhone: '(555) 123-4567',
      email: 'ada@example.com',
      website: 'https://example.com',
      contactSource: 'Business card scan',
    });
  });

  it('never maps the fabricated LinkedIn search URL to a Tracker field', () => {
    const values = Object.values(toTrackerContact(full()));
    expect(values.some((v) => String(v).includes('linkedin.com'))).toBe(false);
  });

  it('omits empty fields entirely', () => {
    const c = emptyContact();
    c['First Name'] = 'Ada';
    const t = toTrackerContact(c);
    expect('email' in t).toBe(false);
    expect('addressLine2' in t).toBe(false);
  });

  it('uses lowercase firstname for candidates (verified API casing)', () => {
    const t = toTrackerCandidate(full());
    expect(t.firstname).toBe('Ada');
    expect('firstName' in t).toBe(false);
    expect(t.whereDidYouHear).toBe('Business card scan');
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
