import { emptyContact, type ContactData } from '@/lib/contact-schema';

// Parsers for the two payload formats QR codes on business cards actually
// carry: vCard (BEGIN:VCARD) and MeCard (MECARD:). Returns null when the
// payload is neither.

export interface QrContactResult {
  contact: ContactData;
  format: 'vcard' | 'mecard';
}

export function parseQrPayload(payload: string): QrContactResult | null {
  const trimmed = payload.trim();
  if (/^BEGIN:VCARD/i.test(trimmed)) {
    return { contact: parseVCard(trimmed), format: 'vcard' };
  }
  if (/^MECARD:/i.test(trimmed)) {
    return { contact: parseMeCard(trimmed), format: 'mecard' };
  }
  return null;
}

export function isUrlPayload(payload: string): string | null {
  const t = payload.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  return null;
}

// --- vCard ------------------------------------------------------------------

function unfoldVCardLines(text: string): string[] {
  // RFC 6350 line folding: a line starting with space/tab continues the
  // previous line.
  const raw = text.split(/\r\n|\r|\n/);
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.trim()) {
      lines.push(line);
    }
  }
  return lines;
}

interface VCardProp {
  name: string;
  params: string[];
  value: string;
}

function parseVCardLine(line: string): VCardProp | null {
  const colon = line.indexOf(':');
  if (colon < 1) return null;
  const lhs = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [nameWithGroup, ...params] = lhs.split(';');
  // Strip an optional group prefix ("item1.TEL").
  const name = nameWithGroup.split('.').pop()!.toUpperCase();
  return { name, params: params.map((p) => p.toUpperCase()), value };
}

const unescapeV = (s: string) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

function parseVCard(text: string): ContactData {
  const contact = emptyContact();
  const props = unfoldVCardLines(text)
    .map(parseVCardLine)
    .filter((p): p is VCardProp => p !== null);

  const tels: { value: string; mobile: boolean }[] = [];
  let fn = '';

  for (const p of props) {
    switch (p.name) {
      case 'N': {
        // N:Family;Given;Middle;Prefix;Suffix
        const parts = p.value.split(';');
        contact['Last Name'] = unescapeV(parts[0] || '');
        contact['First Name'] = unescapeV(parts[1] || '');
        break;
      }
      case 'FN':
        fn = unescapeV(p.value);
        break;
      case 'ORG':
        contact['Organization Name'] = unescapeV(p.value.split(';')[0] || '');
        break;
      case 'TITLE':
        contact['Organization Title'] = unescapeV(p.value);
        break;
      case 'EMAIL':
        if (!contact['E-mail 1']) contact['E-mail 1'] = unescapeV(p.value);
        break;
      case 'TEL':
        tels.push({
          value: unescapeV(p.value.replace(/^tel:/i, '')),
          mobile: p.params.some((q) => q.includes('CELL') || q.includes('MOBILE')),
        });
        break;
      case 'URL': {
        const url = unescapeV(p.value);
        if (/linkedin\.com/i.test(url)) {
          if (!contact['LinkedIn Profile']) contact['LinkedIn Profile'] = url;
        } else if (!contact['Website 1 - Value']) {
          contact['Website 1 - Value'] = url;
        }
        break;
      }
      case 'ADR': {
        // ADR:PO;Extended;Street;City;Region;PostalCode;Country
        const parts = p.value.split(';').map(unescapeV);
        contact['Address 1 - Extended Address'] = parts[1] || '';
        contact['Address 1 - Street'] = parts[2] || '';
        contact['Address 1 - City'] = parts[3] || '';
        contact['Address 1 - Region'] = parts[4] || '';
        contact['Address 1 - Postal Code'] = parts[5] || '';
        contact['Country'] = parts[6] || '';
        contact['Address 1'] = parts.slice(2).filter(Boolean).join(', ');
        break;
      }
    }
  }

  // Fall back to FN when N is absent.
  if (!contact['First Name'] && !contact['Last Name'] && fn) {
    const parts = fn.split(/\s+/);
    contact['First Name'] = parts[0] || '';
    contact['Last Name'] = parts.slice(1).join(' ');
  }

  const tel = tels.find((t) => t.mobile) || tels[0];
  if (tel) contact['Phone 1'] = tel.value;

  return contact;
}

// --- MeCard -----------------------------------------------------------------

function parseMeCard(text: string): ContactData {
  const contact = emptyContact();
  const body = text.replace(/^MECARD:/i, '').replace(/;;\s*$/, '');
  // Fields are KEY:value pairs separated by ';' with '\' escapes.
  const fields: Record<string, string[]> = {};
  for (const part of body.split(/(?<!\\);/)) {
    const colon = part.indexOf(':');
    if (colon < 1) continue;
    const key = part.slice(0, colon).toUpperCase();
    const value = part
      .slice(colon + 1)
      .replace(/\\([;:,\\])/g, '$1')
      .trim();
    if (!value) continue;
    (fields[key] ||= []).push(value);
  }

  const name = fields['N']?.[0] || '';
  if (name.includes(',')) {
    const [last, first] = name.split(',');
    contact['Last Name'] = (last || '').trim();
    contact['First Name'] = (first || '').trim();
  } else {
    const parts = name.split(/\s+/).filter(Boolean);
    contact['First Name'] = parts[0] || '';
    contact['Last Name'] = parts.slice(1).join(' ');
  }
  if (fields['TEL']?.[0]) contact['Phone 1'] = fields['TEL'][0];
  if (fields['EMAIL']?.[0]) contact['E-mail 1'] = fields['EMAIL'][0];
  if (fields['URL']?.[0]) contact['Website 1 - Value'] = fields['URL'][0];
  if (fields['ORG']?.[0]) contact['Organization Name'] = fields['ORG'][0];
  if (fields['ADR']?.[0]) contact['Address 1'] = fields['ADR'][0];

  return contact;
}
