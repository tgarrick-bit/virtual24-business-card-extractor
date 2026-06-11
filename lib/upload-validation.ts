import { NextResponse } from 'next/server';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Shared guard for the image-upload routes: real File, image MIME, size cap.
// Returns the file or a ready-to-return error response.
export function validateImageUpload(value: FormDataEntryValue | null): File | NextResponse {
  if (!value || typeof value === 'string') {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 });
  }
  const file = value as File;
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Upload must be an image' }, { status: 415 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Uploaded image is empty' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `Image exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit` },
      { status: 413 }
    );
  }
  return file;
}
