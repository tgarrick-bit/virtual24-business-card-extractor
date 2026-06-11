'use client';

import Image from "next/image";
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Upload, Download, Trash2, FileImage, AlertCircle, Brain, Eye, Linkedin, Camera, CheckCircle2, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import Papa from 'papaparse';
import {
  emptyContact,
  isBlankContact,
  mergeContacts,
  buildLinkedInSearchUrl,
  type ContactData,
  type ContactField,
} from '@/lib/contact-schema';
import { prepareImage } from '@/lib/image-client';

type RowStatus = 'processing' | 'ok' | 'failed';
type PushState = 'idle' | 'pushing' | 'pushed' | 'duplicate' | 'error' | 'blocked';

interface DupMatch {
  trackerId: number;
  name: string;
  email: string;
  company: string;
}

interface Row {
  contact: ContactData;
  sourceFile: string;
  status: RowStatus;
  via: string; // 'qr' | 'ai' | 'ocr' | 'qr+ai' | 'qr+ocr'
  extractError?: string;
  push: PushState;
  pushDetail?: string;
  trackerId?: string | null;
  matches?: DupMatch[];
}

type Entity = 'contact' | 'candidate';

const POOL_SIZE = 3;

export default function BusinessCardExtractor() {
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [useAI, setUseAI] = useState(true);
  const [autoPush, setAutoPush] = useState(true);
  const [entity, setEntity] = useState<Entity>('contact');
  const [configWarning, setConfigWarning] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Refs mirror state that async workers and button handlers need fresh.
  const rowsRef = useRef<Row[]>(rows);
  const autoPushRef = useRef(autoPush);
  const entityRef = useRef(entity);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { autoPushRef.current = autoPush; }, [autoPush]);
  useEffect(() => { entityRef.current = entity; }, [entity]);

  const patchRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    const imageFiles = selectedFiles.filter(file => file.type.startsWith('image/'));
    setFiles(prev => [...prev, ...imageFiles]);
    event.target.value = ''; // allow re-selecting the same file / next camera shot
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setFiles([]);
    setRows([]);
    setProgress(0);
    setConfigWarning('');
  };

  const extractFromServer = async (blob: Blob, fileName: string): Promise<ContactData> => {
    const formData = new FormData();
    formData.append('image', blob, fileName);

    const endpoint = useAI ? '/api/extract' : '/api/extract-ocr';
    const response = await fetch(endpoint, { method: 'POST', body: formData });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 503) {
        setConfigWarning(errorData.error || 'Server extraction is not configured.');
      }
      throw new Error(errorData.error || 'Failed to extract data');
    }
    const result = await response.json();
    return result.data as ContactData;
  };

  const processImages = async () => {
    if (files.length === 0 || isProcessing) return;

    const batch = [...files];
    setIsProcessing(true);
    setProgress(0);
    setConfigWarning('');

    const initial: Row[] = batch.map((file) => ({
      contact: emptyContact(),
      sourceFile: file.name,
      status: 'processing',
      via: '',
      push: 'idle',
    }));
    setRows(initial);
    rowsRef.current = initial;
    setFiles([]);

    let done = 0;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(POOL_SIZE, batch.length) }, async () => {
        while (next < batch.length) {
          const i = next++;
          const file = batch[i];
          try {
            const prepared = await prepareImage(file);
            let contact = prepared.qrContact?.contact ?? null;
            let via = prepared.qrContact ? 'qr' : '';

            // A complete vCard QR makes the server round-trip unnecessary.
            const qrComplete =
              contact && contact['First Name'] && (contact['E-mail 1'] || contact['Phone 1']);
            if (!qrComplete) {
              const extracted = await extractFromServer(prepared.blob, file.name);
              contact = contact ? mergeContacts(contact, extracted) : extracted;
              via = via ? `${via}+${useAI ? 'ai' : 'ocr'}` : useAI ? 'ai' : 'ocr';
            }
            const finalContact = { ...(contact as ContactData) };
            if (prepared.qrUrl) {
              if (/linkedin\.com/i.test(prepared.qrUrl)) {
                finalContact['LinkedIn Profile'] = prepared.qrUrl;
              } else if (!finalContact['Website 1 - Value']) {
                finalContact['Website 1 - Value'] = prepared.qrUrl;
              }
            }
            if (!finalContact['LinkedIn Profile']) {
              finalContact['LinkedIn Profile'] = buildLinkedInSearchUrl(finalContact);
            }

            const blank = isBlankContact(finalContact);
            patchRow(i, {
              contact: finalContact,
              status: blank ? 'failed' : 'ok',
              via,
              extractError: blank ? 'Nothing usable was extracted' : undefined,
              push: blank ? 'blocked' : 'idle',
            });

            if (!blank && autoPushRef.current) {
              await pushContact(i, finalContact, 'create');
            }
          } catch (error) {
            patchRow(i, {
              status: 'failed',
              extractError: error instanceof Error ? error.message : 'Unknown error',
              push: 'blocked',
            });
          }
          done += 1;
          setProgress((done / batch.length) * 100);
        }
      })
    );

    setIsProcessing(false);
  };

  const pushContact = async (index: number, contact: ContactData, mode: 'create' | 'force') => {
    patchRow(index, { push: 'pushing', pushDetail: undefined });
    try {
      const res = await fetch('/api/tracker-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact, entity: entityRef.current, mode }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201) {
        patchRow(index, { push: 'pushed', trackerId: body.trackerId ?? null, matches: undefined });
      } else if (res.status === 409) {
        patchRow(index, { push: 'duplicate', matches: body.matches || [] });
      } else if (res.status === 401) {
        patchRow(index, { push: 'error', pushDetail: 'Signed out - reload and enter the access code' });
      } else {
        patchRow(index, {
          push: 'error',
          pushDetail:
            body.error === 'tracker_auth_failed' ? 'Tracker rejected our credentials'
            : body.error === 'tracker_unreachable' ? 'Tracker is unreachable'
            : 'Push failed',
        });
      }
    } catch {
      patchRow(index, { push: 'error', pushDetail: 'Network error' });
    }
  };

  const pushRow = (index: number, mode: 'create' | 'force' = 'create') => {
    const row = rowsRef.current[index];
    if (!row || row.status !== 'ok' || isBlankContact(row.contact)) return;
    void pushContact(index, row.contact, mode);
  };

  const pushAll = async () => {
    const indexes = rowsRef.current
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === 'ok' && !isBlankContact(r.contact) && (r.push === 'idle' || r.push === 'error'))
      .map(({ i }) => i);
    for (const i of indexes) {
      // Sequential to stay well inside Tracker's ~100 req/min limit.
      await pushContact(i, rowsRef.current[i].contact, 'create');
    }
  };

  const updateContactField = (index: number, field: ContactField, value: string) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const contact = { ...r.contact, [field]: value };
        // Edits can rescue a blank row; a pushed row keeps its outcome.
        const blank = isBlankContact(contact);
        const push = r.push === 'pushed' ? r.push : blank ? 'blocked' : r.push === 'blocked' ? 'idle' : r.push;
        const status = r.status === 'failed' && !blank ? 'ok' : r.status;
        return { ...r, contact, push, status };
      })
    );
  };

  const exportableRows = rows.filter((r) => r.status === 'ok' && !isBlankContact(r.contact));
  const failedRows = rows.filter((r) => r.status === 'failed');
  const pushedCount = rows.filter((r) => r.push === 'pushed').length;

  const downloadCSV = () => {
    if (exportableRows.length === 0) return;
    // escapeFormulae: card text is untrusted input headed for Excel/Sheets.
    const csv = Papa.unparse(exportableRows.map((r) => r.contact), { escapeFormulae: true });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'business_cards_contacts.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const editableCell = (row: Row, index: number, field: ContactField) => (
    <Input
      value={row.contact[field]}
      onChange={(e) => updateContactField(index, field, e.target.value)}
      disabled={row.status === 'processing'}
      className="h-8 min-w-28 border-transparent bg-transparent px-1 focus-visible:border-[#e31c79]"
    />
  );

  const pushCell = (row: Row, index: number) => {
    switch (row.push) {
      case 'pushing':
        return <span className="flex items-center gap-1 text-sm text-[#33393c]/70"><RefreshCw className="h-3 w-3 animate-spin" /> Pushing</span>;
      case 'pushed':
        return (
          <span className="flex items-center gap-1 text-sm text-green-700">
            <CheckCircle2 className="h-3 w-3" /> In Tracker{row.trackerId ? ` #${row.trackerId}` : ''}
          </span>
        );
      case 'duplicate':
        return (
          <div className="space-y-1">
            <p className="text-sm text-amber-700">
              Duplicate{row.matches?.[0] ? `: ${row.matches[0].name}` : ''}
            </p>
            <Button size="sm" variant="outline" className="h-7 border-[#e31c79] text-[#e31c79]" onClick={() => pushRow(index, 'force')}>
              Push anyway
            </Button>
          </div>
        );
      case 'error':
        return (
          <div className="space-y-1">
            <p className="text-sm text-red-600">{row.pushDetail || 'Push failed'}</p>
            <Button size="sm" variant="outline" className="h-7 border-[#e31c79] text-[#e31c79]" onClick={() => pushRow(index)}>
              Retry
            </Button>
          </div>
        );
      case 'blocked':
        return <span className="text-sm text-[#33393c]/50">-</span>;
      default:
        return (
          <Button
            size="sm"
            variant="outline"
            className="h-7 border-[#e31c79] text-[#e31c79]"
            disabled={row.status !== 'ok'}
            onClick={() => pushRow(index)}
          >
            Push
          </Button>
        );
    }
  };

  return (
    <main className="min-h-screen bg-white text-[#33393c] flex justify-center">
      <div className="w-full max-w-6xl px-4 py-10">
        {/* West End header */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image
            src="/WE-logo.png"
            alt="West End Workforce logo"
            width={80}
            height={80}
            priority
          />
          <h1 className="text-3xl font-bold tracking-tight">
            Business Card Scanner
          </h1>
          <p className="text-sm text-[#33393c]/70 max-w-xl">
            Snap a business card and the contact lands in the ATS Tracker.
            QR codes on cards are read automatically; CSV export stays available as a backup.
          </p>
        </div>

        <div className="grid gap-6">
          {configWarning && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{configWarning}</AlertDescription>
            </Alert>
          )}

          {/* Capture Section */}
          <Card>
            <CardHeader>
              <CardTitle>Scan Business Cards</CardTitle>
              <CardDescription>
                Use the camera on your phone, or select saved images.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4 bg-muted rounded-lg">
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    <Label htmlFor="extraction-mode">OCR</Label>
                    <Switch id="extraction-mode" checked={useAI} onCheckedChange={setUseAI} />
                    <Brain className="h-4 w-4" />
                    <Label htmlFor="extraction-mode">AI Vision</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="auto-push" checked={autoPush} onCheckedChange={setAutoPush} />
                    <Label htmlFor="auto-push">Auto-push to Tracker</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label>Save as</Label>
                    <div className="flex rounded-md border border-[#e31c79]/40 overflow-hidden">
                      {(['contact', 'candidate'] as const).map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => setEntity(e)}
                          className={`px-3 py-1 text-sm ${entity === e ? 'bg-[#e31c79] text-white' : 'text-[#33393c]'}`}
                        >
                          {e === 'contact' ? 'Contact' : 'Candidate'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => cameraInputRef.current?.click()}
                    className="flex items-center gap-2 bg-[#e31c79] text-white hover:bg-[#c31666]"
                  >
                    <Camera className="h-4 w-4" />
                    Scan with Camera
                  </Button>
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    variant="outline"
                    className="flex items-center gap-2 border-[#e31c79] text-[#e31c79] hover:bg-[#e31c79]/5"
                  >
                    <Upload className="h-4 w-4" />
                    Select Images
                  </Button>
                  <Button
                    onClick={processImages}
                    disabled={files.length === 0 || isProcessing}
                    className="flex items-center gap-2 bg-[#e31c79] text-white hover:bg-[#c31666]"
                  >
                    <FileImage className="h-4 w-4" />
                    {isProcessing ? 'Processing...' : `Extract${files.length > 0 ? ` (${files.length})` : ''}`}
                  </Button>
                  <Button
                    onClick={clearAll}
                    variant="outline"
                    className="flex items-center gap-2 border-[#e31c79] text-[#e31c79] hover:bg-[#e31c79]/5"
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear All
                  </Button>
                </div>

                {files.length > 0 && (
                  <div className="space-y-2">
                    <Label>Ready to extract ({files.length})</Label>
                    <div className="grid gap-2 max-h-32 overflow-y-auto">
                      {files.map((file, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-2 bg-muted rounded"
                        >
                          <span className="text-sm truncate">{file.name}</span>
                          <Button size="sm" variant="ghost" onClick={() => removeFile(index)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isProcessing && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Extracting{autoPush ? ' and pushing to Tracker' : ''}...</span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <Progress value={progress} />
                  </div>
                )}

                {failedRows.length > 0 && !isProcessing && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <div className="space-y-1">
                        <p className="font-medium">{failedRows.length} card{failedRows.length > 1 ? 's' : ''} failed:</p>
                        {failedRows.map((row, index) => (
                          <p key={index} className="text-sm">
                            {row.sourceFile}: {row.extractError || 'extraction failed'}
                          </p>
                        ))}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Results Section */}
          {rows.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle>Contacts</CardTitle>
                    <CardDescription>
                      {exportableRows.length} extracted, {pushedCount} in Tracker
                      {failedRows.length > 0 ? `, ${failedRows.length} failed` : ''}. Tap a field to fix it before pushing.
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={pushAll}
                      disabled={isProcessing || exportableRows.every((r) => r.push !== 'idle' && r.push !== 'error')}
                      className="flex items-center gap-2 bg-[#e31c79] text-white hover:bg-[#c31666]"
                    >
                      Push all to Tracker
                    </Button>
                    <Button
                      onClick={downloadCSV}
                      disabled={exportableRows.length === 0}
                      variant="outline"
                      className="flex items-center gap-2 border-[#e31c79] text-[#e31c79] hover:bg-[#e31c79]/5"
                    >
                      <Download className="h-4 w-4" />
                      CSV
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>First Name</TableHead>
                        <TableHead>Last Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Organization</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>LinkedIn</TableHead>
                        <TableHead>Tracker</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row, index) => (
                        <TableRow key={index} className={row.status === 'failed' ? 'opacity-60' : ''}>
                          {row.status === 'processing' ? (
                            <TableCell colSpan={8} className="text-sm text-[#33393c]/60">
                              <span className="flex items-center gap-2">
                                <RefreshCw className="h-3 w-3 animate-spin" /> {row.sourceFile}
                              </span>
                            </TableCell>
                          ) : (
                            <>
                              <TableCell>{editableCell(row, index, 'First Name')}</TableCell>
                              <TableCell>{editableCell(row, index, 'Last Name')}</TableCell>
                              <TableCell>{editableCell(row, index, 'E-mail 1')}</TableCell>
                              <TableCell>{editableCell(row, index, 'Phone 1')}</TableCell>
                              <TableCell>{editableCell(row, index, 'Organization Name')}</TableCell>
                              <TableCell>{editableCell(row, index, 'Organization Title')}</TableCell>
                              <TableCell className="max-w-28">
                                {row.contact['LinkedIn Profile'] && (
                                  <a
                                    href={row.contact['LinkedIn Profile']}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#e31c79] hover:underline flex items-center gap-1 text-sm"
                                  >
                                    <Linkedin className="h-3 w-3" />
                                    Search
                                  </a>
                                )}
                              </TableCell>
                              <TableCell>{pushCell(row, index)}</TableCell>
                            </>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
