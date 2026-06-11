import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { ContactSchema, buildExtractionPrompt } from '@/lib/contact-schema';
import { validateImageUpload } from '@/lib/upload-validation';

// GPT-4o vision calls regularly take 10s+; the serverless default is too low.
export const maxDuration = 60;

// Lazy-load OpenAI client to avoid build-time initialization
function getOpenAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 503 });
    }

    const formData = await request.formData();
    const fileOrError = validateImageUpload(formData.get('image'));
    if (fileOrError instanceof NextResponse) return fileOrError;
    const file = fileOrError;

    // Convert file to base64
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString('base64');
    const mimeType = file.type;

    const openai = getOpenAIClient();
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildExtractionPrompt() },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 500,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      // Never log the raw model output: it contains the card's PII.
      console.error('extract: model returned non-JSON despite json_object mode');
      return NextResponse.json({ error: 'Failed to parse extracted data' }, { status: 422 });
    }

    const parsed = ContactSchema.safeParse(raw);
    if (!parsed.success) {
      console.error('extract: model JSON failed schema validation');
      return NextResponse.json({ error: 'Extracted data had an unexpected shape' }, { status: 422 });
    }

    return NextResponse.json({ data: parsed.data });
  } catch (error) {
    console.error('Error extracting data:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json(
      { error: 'Failed to extract data from image' },
      { status: 500 }
    );
  }
}
