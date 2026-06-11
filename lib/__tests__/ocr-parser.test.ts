import { parseContactInfo } from '@/lib/ocr-parser';

const CARD_TEXT = `John Smith
Senior Account Manager
ACME STAFFING
123 Main Street, Suite 400
Houston, TX 77002
Office: (713) 555-0100
Mobile: (832) 555-0199
john.smith@acmestaffing.com
www.acmestaffing.com`;

describe('parseContactInfo', () => {
  const c = parseContactInfo(CARD_TEXT);

  it('extracts name', () => {
    expect(c['First Name']).toBe('John');
    expect(c['Last Name']).toBe('Smith');
  });

  it('extracts email', () => {
    expect(c['E-mail 1']).toBe('john.smith@acmestaffing.com');
  });

  it('prefers the mobile number over the office number', () => {
    expect(c['Phone 1']).toContain('832');
  });

  it('extracts title and organization', () => {
    expect(c['Organization Title']).toBe('Senior Account Manager');
    expect(c['Organization Name']).toBe('ACME STAFFING');
  });

  it('extracts website with https prefix', () => {
    expect(c['Website 1 - Value']).toBe('https://www.acmestaffing.com');
  });

  it('parses city/state/zip from the address block', () => {
    expect(c['Address 1 - City']).toBe('Houston');
    expect(c['Address 1 - Region']).toBe('TX');
    expect(c['Address 1 - Postal Code']).toBe('77002');
    expect(c['Country']).toBe('United States');
  });

  // Regression test for the stateful /g regex bug: phoneRegex.test() used to
  // carry lastIndex across lines, misclassifying phone lines as non-phone and
  // letting numbers leak into Organization/Title/Address fields.
  it('classifies consecutive phone lines consistently (stateful /g regression)', () => {
    const text = `Jane Doe
(713) 555-0100
(832) 555-0199
(281) 555-0123
ACME CORP`;
    const parsed = parseContactInfo(text);
    expect(parsed['Organization Name']).toBe('ACME CORP');
    expect(parsed['Organization Name']).not.toMatch(/\d{3}/);
    expect(parsed['Address 1']).toBe('');
  });

  it('returns a blank-ish contact for empty input rather than throwing', () => {
    const empty = parseContactInfo('');
    expect(empty['First Name']).toBe('');
    expect(empty['E-mail 1']).toBe('');
  });
});
