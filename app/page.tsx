'use client';

import Image from "next/image";
import { Antonio } from "next/font/google";
import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Upload, Download, Trash2, FileImage, AlertCircle, Brain, Eye, Linkedin } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import Papa from 'papaparse';

interface ContactData {
  'First Name': string;
  'Last Name': string;
  'E-mail 1': string;
  'Phone 1': string;
  'Address 1': string;
  'Country': string;
  'Address 1 - Street': string;
  'Address 1 - Extended Address': string;
  'Address 1 - City': string;
  'Address 1 - Region': string;
  'Address 1 - Postal Code': string;
  'Organization Name': string;
  'Organization Title': string;
  'Website 1 - Value': string;
  'LinkedIn Profile': string;
}

export default function BusinessCardExtractor() {
  const [files, setFiles] = useState<File[]>([]);
  const [extractedData, setExtractedData] = useState<ContactData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [useAI, setUseAI] = useState(true);
  const [needsApiKey, setNeedsApiKey] = useState(false);
  const [searchingLinkedIn, setSearchingLinkedIn] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    const imageFiles = selectedFiles.filter(file => file.type.startsWith('image/'));
    setFiles(prev => [...prev, ...imageFiles]);
    setErrors([]);
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setFiles([]);
    setExtractedData([]);
    setProgress(0);
    setCurrentFile('');
    setErrors([]);
    setNeedsApiKey(false);
  };

  const searchLinkedInProfile = async (firstName: string, lastName: string, company: string): Promise<string> => {
    try {
      const response = await fetch('/api/linkedin-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName,
          lastName,
          company
        }),
      });

      if (response.ok) {
        const result = await response.json();
        return result.linkedinUrl || '';
      }
    } catch (error) {
      console.error('LinkedIn search error:', error);
    }
    return '';
  };

  const extractDataFromImage = async (file: File): Promise<ContactData> => {
    const formData = new FormData();
    formData.append('image', file);

    const endpoint = useAI ? '/api/extract' : '/api/extract-ocr';
    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      if (useAI && (response.status === 401 || errorData.error?.includes('API key'))) {
        setNeedsApiKey(true);
        throw new Error('OpenAI API key required');
      }
      throw new Error(errorData.error || 'Failed to extract data');
    }

    const result = await response.json();
    return result.data;
  };

  const processImages = async () => {
    if (files.length === 0) return;

    setIsProcessing(true);
    setProgress(0);
    setErrors([]);
    setNeedsApiKey(false);
    const results: ContactData[] = [];
    const processingErrors: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setCurrentFile(file.name);

      try {
        const contactData = await extractDataFromImage(file);

        // Add LinkedIn Profile field
        contactData['LinkedIn Profile'] = '';

        results.push(contactData);
        setProgress(((i + 1) / files.length) * 100);
      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        processingErrors.push(`${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);

        // Add empty contact data for failed extractions
        results.push({
          'First Name': '',
          'Last Name': '',
          'E-mail 1': '',
          'Phone 1': '',
          'Address 1': '',
          'Country': '',
          'Address 1 - Street': '',
          'Address 1 - Extended Address': '',
          'Address 1 - City': '',
          'Address 1 - Region': '',
          'Address 1 - Postal Code': '',
          'Organization Name': '',
          'Organization Title': '',
          'Website 1 - Value': '',
          'LinkedIn Profile': ''
        });
        setProgress(((i + 1) / files.length) * 100);
      }
    }

    setExtractedData(results);
    setErrors(processingErrors);
    setIsProcessing(false);
    setCurrentFile('');

    // Search for LinkedIn profiles
    if (results.length > 0) {
      await searchLinkedInProfiles(results);
    }
  };

  const searchLinkedInProfiles = async (contacts: ContactData[]) => {
    setSearchingLinkedIn(true);
    setCurrentFile('Searching LinkedIn profiles...');
    setProgress(0);

    const updatedContacts = [...contacts];

    for (let i = 0; i < updatedContacts.length; i++) {
      const contact = updatedContacts[i];
      if (contact['First Name'] && contact['Last Name']) {
        try {
          const linkedinUrl = await searchLinkedInProfile(
            contact['First Name'],
            contact['Last Name'],
            contact['Organization Name']
          );
          contact['LinkedIn Profile'] = linkedinUrl;
        } catch (error) {
          console.error(`LinkedIn search failed for ${contact['First Name']} ${contact['Last Name']}:`, error);
        }
      }
      setProgress(((i + 1) / updatedContacts.length) * 100);
    }

    setExtractedData(updatedContacts);
    setSearchingLinkedIn(false);
    setCurrentFile('');
  };

  const downloadCSV = () => {
    if (extractedData.length === 0) return;

    const csv = Papa.unparse(extractedData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'business_cards_contacts.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main className="min-h-screen bg-white text-[#33393c] flex justify-center">
      <div className="w-full max-w-5xl px-4 py-10">
        {/* West End header */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Image
            src="/WE-logo.png" // make sure this matches the file in /public
            alt="West End Workforce logo"
            width={80}
            height={80}
            priority
          />
          <h1 className="text-3xl font-bold tracking-tight-[#33393c]">
            Business Card Contact Extractor
          </h1>
          <p className="text-sm text-[#33393c]/70 max-w-xl">
            Upload business card images to automatically extract contact information,
            find LinkedIn profiles, and export to CSV.
          </p>
        </div>

        <div className="grid gap-6">
          {/* API Key Warning */}
          {needsApiKey && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                AI extraction requires an OpenAI API key. Please set the OPENAI_API_KEY environment variable or switch to OCR mode.
                You can get an API key from{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  OpenAI&apos;s platform
                </a>.
              </AlertDescription>
            </Alert>
          )}

          {/* Upload Section */}
          <Card>
            <CardHeader>
              <CardTitle>Upload Business Cards</CardTitle>
              <CardDescription>
                Select multiple business card images (JPG, PNG, etc.) - Includes LinkedIn profile search
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Extraction Method Toggle */}
                <div className="flex items-center space-x-4 p-4 bg-muted rounded-lg">
                  <div className="flex items-center space-x-2">
                    <Eye className="h-4 w-4" />
                    <Label htmlFor="extraction-mode">OCR Only</Label>
                  </div>
                  <Switch
                    id="extraction-mode"
                    checked={useAI}
                    onCheckedChange={setUseAI}
                  />
                  <div className="flex items-center space-x-2">
                    <Brain className="h-4 w-4" />
                    <Label htmlFor="extraction-mode">AI Vision (Recommended)</Label>
                  </div>
                  <div className="text-sm text-muted-foreground ml-4">
                    {useAI
                      ? 'High accuracy with GPT-4 Vision + LinkedIn search'
                      : 'Enhanced OCR with pattern matching + LinkedIn search'}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <Input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  {/* West End outline button */}
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    variant="outline"
                    className="flex items-center gap-2 border-[#e31c79] text-[#e31c79] hover:bg-[#e31c79]/5"
                  >
                    <Upload className="h-4 w-4" />
                    Select Images
                  </Button>
                  {/* West End solid primary button */}
                  <Button
                    onClick={processImages}
                    disabled={files.length === 0 || isProcessing || searchingLinkedIn}
                    className="flex items-center gap-2 bg-[#e31c79] text-white hover:bg-[#c31666]"
                  >
                    <FileImage className="h-4 w-4" />
                    {isProcessing || searchingLinkedIn ? 'Processing...' : `Extract with ${useAI ? 'AI' : 'OCR'}`}
                  </Button>
                  {/* West End outline-style clear */}
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
                    <Label>Selected Files ({files.length})</Label>
                    <div className="grid gap-2 max-h-32 overflow-y-auto">
                      {files.map((file, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between p-2 bg-muted rounded"
                        >
                          <span className="text-sm truncate">{file.name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeFile(index)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(isProcessing || searchingLinkedIn) && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        {searchingLinkedIn && <Linkedin className="h-4 w-4" />}
                        {currentFile}
                      </span>
                      <span>{Math.round(progress)}%</span>
                    </div>
                    <Progress value={progress} />
                  </div>
                )}

                {errors.length > 0 && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <div className="space-y-1">
                        <p className="font-medium">Some files failed to process:</p>
                        {errors.map((error, index) => (
                          <p key={index} className="text-sm">
                            {error}
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
          {extractedData.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Extracted Contact Data</CardTitle>
                    <CardDescription>
                      {extractedData.length} contacts extracted using {useAI ? 'AI Vision' : 'OCR'} with LinkedIn profiles
                    </CardDescription>
                  </div>
                  <Button
                    onClick={downloadCSV}
                    className="flex items-center gap-2 bg-[#e31c79] text-white hover:bg-[#c31666]"
                  >
                    <Download className="h-4 w-4" />
                    Download CSV
                  </Button>
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
                        <TableHead>City</TableHead>
                        <TableHead>Website</TableHead>
                        <TableHead>LinkedIn</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {extractedData.map((contact, index) => (
                        <TableRow key={index}>
                          <TableCell>{contact['First Name']}</TableCell>
                          <TableCell>{contact['Last Name']}</TableCell>
                          <TableCell>{contact['E-mail 1']}</TableCell>
                          <TableCell>{contact['Phone 1']}</TableCell>
                          <TableCell>{contact['Organization Name']}</TableCell>
                          <TableCell>{contact['Organization Title']}</TableCell>
                          <TableCell>{contact['Address 1 - City']}</TableCell>
                          <TableCell className="max-w-32 truncate">
                            {contact['Website 1 - Value']}
                          </TableCell>
                          <TableCell className="max-w-32">
                            {contact['LinkedIn Profile'] && (
                              <a
                                href={contact['LinkedIn Profile']}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#e31c79] hover:underline flex items-center gap-1"
                              >
                                <Linkedin className="h-3 w-3" />
                                Search
                              </a>
                            )}
                          </TableCell>
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
