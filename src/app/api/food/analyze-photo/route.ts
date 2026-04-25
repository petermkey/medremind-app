import { NextResponse } from 'next/server';

import { analyzeFoodImage } from '@/lib/food/analyze/providers';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(request: Request) {
  const formData = await request.formData();
  const image = formData.get('image');

  if (!(image instanceof File)) {
    return NextResponse.json({ error: 'Image is required.' }, { status: 400 });
  }

  if (!SUPPORTED_IMAGE_TYPES.has(image.type)) {
    return NextResponse.json({ error: 'Unsupported image type.' }, { status: 415 });
  }

  if (image.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: 'Image is too large.' }, { status: 413 });
  }

  try {
    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const imageDataUrl = `data:${image.type};base64,${imageBuffer.toString('base64')}`;
    const draft = await analyzeFoodImage({ imageDataUrl, imageType: image.type });

    return NextResponse.json({ draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid food analysis response.';

    return NextResponse.json({ error: message }, { status: 502 });
  }
}
