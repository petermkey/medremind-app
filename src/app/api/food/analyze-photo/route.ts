import { NextResponse } from 'next/server';

import { analyzeFoodImage } from '@/lib/food/analyze/providers';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 512 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: 'Image is too large.' }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Image is required.' }, { status: 400 });
  }

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
  } catch {
    return NextResponse.json({ error: 'Food analysis failed.' }, { status: 502 });
  }
}
