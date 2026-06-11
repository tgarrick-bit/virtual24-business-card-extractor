import { NextRequest, NextResponse } from 'next/server';
import { parseContactInfo } from '@/lib/ocr-parser';
import { validateImageUpload } from '@/lib/upload-validation';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const fileOrError = validateImageUpload(formData.get('image'));
    if (fileOrError instanceof NextResponse) return fileOrError;
    const file = fileOrError;

    // Import Tesseract dynamically to avoid SSR issues
    const Tesseract = (await import('tesseract.js')).default;

    const { data: { text } } = await Tesseract.recognize(file, 'eng', {
      logger: () => {} // Disable logging for API
    });

    const extractedData = parseContactInfo(text);

    return NextResponse.json({ data: extractedData });
  } catch (error) {
    console.error('Error extracting data:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json(
      { error: 'Failed to extract data from image' },
      { status: 500 }
    );
  }
}
