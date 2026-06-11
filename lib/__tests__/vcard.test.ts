import { parseQrPayload, isUrlPayload } from '@/lib/vcard';

const VCARD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Lovelace;Ada;;;',
  'FN:Ada Lovelace',
  'ORG:Analytical Engines Inc.;R&D',
  'TITLE:Chief Engineer',
  'TEL;TYPE=WORK,VOICE:(555) 111-2222',
  'TEL;TYPE=CELL:(555) 123-4567',
  'EMAIL:ada@example.com',
  'URL:https://example.com',
  'ADR;TYPE=WORK:;;1 Engine Way;Houston;TX;77002;United States',
  'END:VCARD',
].join('\r\n');

describe('parseQrPayload - vCard', () => {
  it('parses the core identity fields', () => {
    const result = parseQrPayload(VCARD);
    expect(result?.format).toBe('vcard');
    const c = result!.contact;
    expect(c['First Name']).toBe('Ada');
    expect(c['Last Name']).toBe('Lovelace');
    expect(c['E-mail 1']).toBe('ada@example.com');
    expect(c['Organization Name']).toBe('Analytical Engines Inc.');
    expect(c['Organization Title']).toBe('Chief Engineer');
    expect(c['Website 1 - Value']).toBe('https://example.com');
  });

  it('prefers the CELL phone over the first listed phone', () => {
    expect(parseQrPayload(VCARD)!.contact['Phone 1']).toBe('(555) 123-4567');
  });

  it('parses ADR into the address component fields', () => {
    const c = parseQrPayload(VCARD)!.contact;
    expect(c['Address 1 - Street']).toBe('1 Engine Way');
    expect(c['Address 1 - City']).toBe('Houston');
    expect(c['Address 1 - Region']).toBe('TX');
    expect(c['Address 1 - Postal Code']).toBe('77002');
    expect(c['Country']).toBe('United States');
  });

  it('routes a LinkedIn URL to the LinkedIn field, not website', () => {
    const card = VCARD.replace(
      'URL:https://example.com',
      'URL:https://www.linkedin.com/in/ada-lovelace'
    );
    const c = parseQrPayload(card)!.contact;
    expect(c['LinkedIn Profile']).toBe('https://www.linkedin.com/in/ada-lovelace');
    expect(c['Website 1 - Value']).toBe('');
  });

  it('falls back to FN when N is missing', () => {
    const card = ['BEGIN:VCARD', 'FN:Ada Lovelace', 'EMAIL:ada@example.com', 'END:VCARD'].join('\n');
    const c = parseQrPayload(card)!.contact;
    expect(c['First Name']).toBe('Ada');
    expect(c['Last Name']).toBe('Lovelace');
  });

  it('handles folded lines and escaped commas', () => {
    const card = [
      'BEGIN:VCARD',
      'N:Lovelace;Ada',
      'ORG:Analytical Engines\\, Inc.',
      'NOTE:line one',
      ' continued',
      'END:VCARD',
    ].join('\r\n');
    expect(parseQrPayload(card)!.contact['Organization Name']).toBe('Analytical Engines, Inc.');
  });
});

describe('parseQrPayload - MeCard', () => {
  it('parses a typical MeCard payload', () => {
    const c = parseQrPayload(
      'MECARD:N:Lovelace,Ada;TEL:5551234567;EMAIL:ada@example.com;URL:https://example.com;;'
    )!.contact;
    expect(c['First Name']).toBe('Ada');
    expect(c['Last Name']).toBe('Lovelace');
    expect(c['Phone 1']).toBe('5551234567');
    expect(c['E-mail 1']).toBe('ada@example.com');
    expect(c['Website 1 - Value']).toBe('https://example.com');
  });
});

describe('non-contact payloads', () => {
  it('returns null for plain URLs and text', () => {
    expect(parseQrPayload('https://example.com/menu')).toBeNull();
    expect(parseQrPayload('hello world')).toBeNull();
  });

  it('isUrlPayload recognizes http(s) URLs only', () => {
    expect(isUrlPayload('https://example.com/x')).toBe('https://example.com/x');
    expect(isUrlPayload('WIFI:S:net;P:pass;;')).toBeNull();
  });
});
