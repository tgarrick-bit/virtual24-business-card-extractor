import { emptyContact, type ContactData } from '@/lib/contact-schema';

// Heuristic parser for raw OCR text from a business card. Extracted from
// app/api/extract-ocr/route.ts so it can be unit-tested.

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
// Global variant is ONLY for matchAll; .test() on a /g regex is stateful
// (lastIndex carries over between calls), which used to corrupt the per-line
// classification below. Keep the test variant non-global.
const PHONE_REGEX_ALL = /(\+?1?[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g;
const PHONE_REGEX_TEST = new RegExp(PHONE_REGEX_ALL.source);
const WEBSITE_REGEX = /(https?:\/\/)?(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\.[a-zA-Z]{2,})?/;
const ZIP_REGEX = /\b\d{5}(-\d{4})?\b/;

const TITLE_KEYWORDS = [
  'ceo', 'president', 'vice president', 'vp', 'director', 'manager', 'senior', 'lead', 'head',
  'chief', 'executive', 'officer', 'coordinator', 'specialist', 'analyst', 'consultant',
  'engineer', 'developer', 'designer', 'architect', 'supervisor', 'administrator',
];

const MOBILE_KEYWORDS = ['mobile', 'cell', 'cellular', 'personal', 'm:', 'c:'];

export function parseContactInfo(text: string): ContactData {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const contact = emptyContact();

  const emailMatch = text.match(EMAIL_REGEX);
  if (emailMatch) contact['E-mail 1'] = emailMatch[0];

  // Phones, preferring numbers with mobile/cell context. The context is the
  // number's own line: a wider window used to swallow the NEXT line's
  // "Mobile:" label and pick the office number.
  const phoneMatches = Array.from(text.matchAll(PHONE_REGEX_ALL));
  if (phoneMatches.length > 0) {
    let selectedPhone = phoneMatches[0][0];
    for (const match of phoneMatches) {
      const lineStart = text.lastIndexOf('\n', match.index!) + 1;
      const lineEnd = text.indexOf('\n', match.index! + match[0].length);
      const phoneContext = text
        .substring(lineStart, lineEnd === -1 ? text.length : lineEnd)
        .toLowerCase();
      if (MOBILE_KEYWORDS.some((keyword) => phoneContext.includes(keyword))) {
        selectedPhone = match[0];
        break;
      }
    }
    contact['Phone 1'] = selectedPhone;
  }

  // Strip emails first: "john.smith@x.com" would otherwise match as a website.
  const textWithoutEmails = text.replace(new RegExp(EMAIL_REGEX.source, 'g'), ' ');
  const websiteMatch = textWithoutEmails.match(WEBSITE_REGEX);
  if (websiteMatch) {
    let website = websiteMatch[0];
    if (!website.startsWith('http')) website = 'https://' + website;
    contact['Website 1 - Value'] = website;
  }

  const processedLines = lines.map((line) => ({
    original: line,
    hasEmail: EMAIL_REGEX.test(line),
    hasPhone: PHONE_REGEX_TEST.test(line),
    hasWebsite: WEBSITE_REGEX.test(line),
    hasTitle: TITLE_KEYWORDS.some((keyword) => line.toLowerCase().includes(keyword)),
    wordCount: line.split(/\s+/).length,
    hasNumbers: /\d/.test(line),
    isAllCaps: line === line.toUpperCase() && line.length > 2,
  }));

  // Name: first short line that is not contact info.
  const nameCandidate = processedLines.find(
    (line) =>
      !line.hasEmail &&
      !line.hasPhone &&
      !line.hasWebsite &&
      line.wordCount >= 2 &&
      line.wordCount <= 4 &&
      !line.hasNumbers
  );
  if (nameCandidate) {
    const nameParts = nameCandidate.original.split(/\s+/).filter((part) => part.length > 0);
    if (nameParts.length >= 2) {
      contact['First Name'] = nameParts[0];
      contact['Last Name'] = nameParts.slice(1).join(' ');
    } else if (nameParts.length === 1) {
      contact['First Name'] = nameParts[0];
    }
  }

  const titleCandidate = processedLines.find(
    (line) => line.hasTitle && !line.hasEmail && !line.hasPhone && !line.hasWebsite
  );
  if (titleCandidate) contact['Organization Title'] = titleCandidate.original;

  const orgCandidate = processedLines.find(
    (line) =>
      !line.hasEmail &&
      !line.hasPhone &&
      !line.hasWebsite &&
      !line.hasTitle &&
      line.original !== (contact['First Name'] + ' ' + contact['Last Name']).trim() &&
      line.wordCount <= 5 &&
      (line.isAllCaps || line.wordCount <= 3)
  );
  if (orgCandidate) contact['Organization Name'] = orgCandidate.original;

  const addressLines = processedLines.filter(
    (line) =>
      !line.hasEmail &&
      !line.hasPhone &&
      !line.hasWebsite &&
      line.original !== contact['First Name'] + ' ' + contact['Last Name'] &&
      line.original !== contact['Organization Name'] &&
      line.original !== contact['Organization Title'] &&
      (line.hasNumbers ||
        /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|suite|ste|apt|apartment)\b/i.test(
          line.original
        ))
  );

  if (addressLines.length > 0) {
    contact['Address 1'] = addressLines.map((line) => line.original).join(', ');

    const lastAddressLine = addressLines[addressLines.length - 1].original;
    const zipMatch = lastAddressLine.match(ZIP_REGEX);
    if (zipMatch) contact['Address 1 - Postal Code'] = zipMatch[0];

    const cityStateMatch = lastAddressLine.match(/([^,\d]+),\s*([A-Z]{2})\s*\d{5}/);
    if (cityStateMatch) {
      contact['Address 1 - City'] = cityStateMatch[1].trim();
      contact['Address 1 - Region'] = cityStateMatch[2];
      contact['Country'] = 'United States';
    } else {
      const parts = lastAddressLine.split(',').map((p) => p.trim());
      if (parts.length >= 2) {
        contact['Address 1 - City'] = parts[parts.length - 2];
        if (parts[parts.length - 1].match(/^[A-Z]{2}/)) {
          contact['Address 1 - Region'] = parts[parts.length - 1].split(/\s+/)[0];
          contact['Country'] = 'United States';
        }
      }
    }

    if (addressLines.length > 1) {
      contact['Address 1 - Street'] = addressLines
        .slice(0, -1)
        .map((line) => line.original)
        .join(', ');
    }
  }

  return contact;
}
