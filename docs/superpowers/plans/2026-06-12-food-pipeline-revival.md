# Food Pipeline Revival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make photo food logging reliable on real phones (compression, gallery, observability) and reduce logging friction (portion editing, repeat-meal, text input, photo storage, insights).

**Architecture:** Client compresses images before upload (Vercel hard-caps request bodies at ~4.5 MB). The analyze API gains error observability and a text-only variant reusing the same JSON-schema providers. The diary gains draft portion scaling, one-tap entry duplication, stored photos (Supabase Storage), and a 7-day insights card.

**Tech Stack:** Next.js 15 App Router, Zustand, Supabase (Postgres + Storage), OpenRouter vision models, Playwright E2E, node:test units.

---

## Multi-agent orchestration

Each agent = one feature branch (`codex/<slice>`) = one PR into `main`. **Never push to `main` directly.** Tasks within an agent are sequential; agents within a wave run in parallel (worktree isolation) because their file sets are disjoint. Merge wave N before starting wave N+1 (later waves touch `food/page.tsx`, which must be free).

| Wave | Agent | Branch | Tasks | Files (conflict domain) |
|---|---|---|---|---|
| 1 | A1 | `codex/food-upload-reliability` | 1, 2 | `imageCompression.ts` (new), `food/page.tsx`, `openRouterModels.ts` + its test, `package.json` |
| 1 | A2 | `codex/food-analyze-observability` | 3 | `analyze-photo/route.ts`, `analyze/providers.ts` |
| 2 | A3 | `codex/food-draft-editing` | 4, 5 | `scaleNutrients.ts` (new), `food/page.tsx`, `foodStore.ts`, `types/food.ts`, migration 016, `package.json` |
| 2 | A4 | `codex/food-text-analyze` | 6 | `analyze-text/route.ts` (new), `analyze/providers.ts` |
| 3 | A5 | `codex/food-text-ui-and-photos` | 7, 8 | `food/page.tsx`, `foodSync.ts`, `types/food.ts`, migration 017 |
| 3 | A6 | `codex/insights-nutrition-card` | 9 | `app/insights/page.tsx` only |

**Gate after every wave (orchestrator runs):** `npx tsc --noEmit` && `npm run test:unit` && `npm run build` && `npx playwright test tests/e2e/food.spec.ts`. Migrations (016, 017) are applied to prod by the orchestrator via Management API after PR review, never by subagents.

---

### Task 1: Client-side image compression

**Files:**
- Create: `src/lib/food/imageCompression.ts`
- Create: `tests/unit/imageCompression.test.ts`
- Modify: `src/app/app/food/page.tsx:370-402` (analyzeImage)
- Modify: `package.json` (`test:unit` script — add new test + source file to the tsc file list)

- [ ] **Step 1: Write the failing unit test for the pure sizing helper**

```ts
// tests/unit/imageCompression.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeTargetDimensions, MAX_UPLOAD_BYTES } from '../../src/lib/food/imageCompression';

test('downscales the long edge to 1280 keeping aspect ratio', () => {
  assert.deepEqual(computeTargetDimensions(4032, 3024), { width: 1280, height: 960, scaled: true });
  assert.deepEqual(computeTargetDimensions(3024, 4032), { width: 960, height: 1280, scaled: true });
});

test('keeps small images unscaled', () => {
  assert.deepEqual(computeTargetDimensions(800, 600), { width: 800, height: 600, scaled: false });
});

test('exports an upload cap below the Vercel 4.5 MB request body limit', () => {
  assert.ok(MAX_UPLOAD_BYTES <= 3.5 * 1024 * 1024);
});
```

- [ ] **Step 2: Add both files to the `test:unit` script in `package.json`** — append `tests/unit/imageCompression.test.ts` and `src/lib/food/imageCompression.ts` to the tsc file list and add `node .tmp/unit/tests/unit/imageCompression.test.js` to the run chain. Run `npm run test:unit` — expect FAIL (module not found).

- [ ] **Step 3: Implement the module**

```ts
// src/lib/food/imageCompression.ts
'use client';

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.8;
// Vercel serverless rejects request bodies over ~4.5 MB before our route runs.
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

export function computeTargetDimensions(
  width: number,
  height: number,
): { width: number; height: number; scaled: boolean } {
  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_DIMENSION) return { width, height, scaled: false };
  const scale = MAX_DIMENSION / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale), scaled: true };
}

// Returns the original file when decoding fails (e.g. HEIC in a browser
// without support) — the server will respond with a clear 415 instead.
export async function compressImageForAnalysis(file: File): Promise<File> {
  if (typeof createImageBitmap !== 'function') return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  try {
    const target = computeTargetDimensions(bitmap.width, bitmap.height);
    if (!target.scaled && file.size <= MAX_UPLOAD_BYTES && file.type === 'image/jpeg') return file;
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) return file;
    return new File([blob], 'meal.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
```

- [ ] **Step 4: Run `npm run test:unit` — expect PASS.**

- [ ] **Step 5: Wire into `analyzeImage` in `src/app/app/food/page.tsx`** — add import `import { compressImageForAnalysis } from '@/lib/food/imageCompression';` and change the body of `analyzeImage` (line ~375):

```ts
      const prepared = await compressImageForAnalysis(file);
      const body = new FormData();
      body.append('image', prepared);
```

- [ ] **Step 6: Verify:** `npx tsc --noEmit` clean; `npx playwright test tests/e2e/food.spec.ts` — the photo-analysis tests now exercise the compression path; expect PASS.

- [ ] **Step 7: Commit** — `git commit -m "fix: compress meal photos client-side before analysis upload"`

### Task 2: Gallery input + pinned production default model

**Files:**
- Modify: `src/app/app/food/page.tsx:665-680` (capture input + buttons row)
- Modify: `src/lib/food/analyze/openRouterModels.ts:1`
- Modify: `tests/unit/openRouterModels.test.ts:10,27-31` (default-model assertions)

- [ ] **Step 1: Add a second file input without `capture` and a Gallery button.** In the buttons row (line ~655-680) add a ref `const galleryInputRef = useRef<HTMLInputElement>(null);` next to `fileInputRef`, then after the existing `<input ref={fileInputRef} ... capture="environment" ... />` add:

```tsx
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={handleFileChange}
              disabled={analyzing}
            />
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              disabled={analyzing}
              className="rounded-xl bg-[#30363D] px-3 py-2 text-xs font-bold text-[#F0F6FC]"
            >
              Gallery
            </button>
```

`handleFileChange` already resets `fileInputRef.current.value` in `analyzeImage`'s finally — extend it to also reset `galleryInputRef.current` the same way.

- [ ] **Step 2: Pin the default OpenRouter model.** In `openRouterModels.ts:1` replace the flaky free-tier default:

```ts
export const DEFAULT_OPENROUTER_FOOD_VISION_MODEL = 'google/gemini-2.5-flash';
```

- [ ] **Step 3: Update the assertions in `tests/unit/openRouterModels.test.ts`** that expect `['google/gemma-4-31b-it:free']` for the no-env default case (line 10) to `['google/gemini-2.5-flash']`. Leave the explicit-env test cases unchanged.

- [ ] **Step 4: Run `npm run test:unit` — expect PASS. Run `npx playwright test tests/e2e/food.spec.ts` — expect PASS.**

- [ ] **Step 5: Commit** — `git commit -m "feat: add gallery photo input and pin production default vision model"`

### Task 3: Analyze-route observability

**Files:**
- Modify: `src/app/api/food/analyze-photo/route.ts:52-60`
- Modify: `src/lib/food/analyze/providers.ts` (every `throw new Error('Food analysis failed.')` site: lines ~208, 237, 249, 330, 357)

- [ ] **Step 1: Give provider failures distinguishable messages.** In `providers.ts` replace the five generic throws:
  - line ~208 (OpenAI non-OK): `throw new Error(\`food_provider_openai_${response.status}\`);`
  - line ~237 (OpenRouter non-OK, no fallback left): `throw new Error(\`food_provider_openrouter_${response.status}\`);`
  - line ~249 (model list exhausted): `throw new Error('food_provider_openrouter_exhausted');`
  - line ~330 (Gemini non-OK): `throw new Error(\`food_provider_gemini_${response.status}\`);`
  - line ~357 (timeout in `fetchWithTimeout`): `throw new Error('food_provider_timeout');`
  - Both `'Food analysis returned no structured output.'` sites stay as-is (already specific).

- [ ] **Step 2: Capture and log in the route.** In `route.ts` add `import * as Sentry from '@sentry/nextjs';` (same import style as `src/instrumentation.ts`) and replace the catch (lines 58-60):

```ts
  } catch (error) {
    console.error('[food-analyze]', error);
    Sentry.captureException(error);
    const reason = error instanceof Error && /^food_/.test(error.message) ? error.message : 'unknown';
    return NextResponse.json({ error: 'Food analysis failed.', reason }, { status: 502 });
  }
```

- [ ] **Step 3: Verify:** `npx tsc --noEmit` clean; `npm run build` passes; `npx playwright test tests/e2e/food.spec.ts` passes (mock provider unaffected).

- [ ] **Step 4: Commit** — `git commit -m "feat: surface food analysis failure reasons to Sentry and logs"`

### Task 4: Draft portion scaling

**Files:**
- Create: `src/lib/food/scaleNutrients.ts`
- Create: `tests/unit/scaleNutrients.test.ts`
- Modify: `src/app/app/food/page.tsx` (draft card ~lines 769-800, `handleSaveDraft` ~line 404)
- Modify: `package.json` (`test:unit` file list, same pattern as Task 1 Step 2)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/scaleNutrients.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scaleNutrients } from '../../src/lib/food/scaleNutrients';

test('scales every present nutrient and extended keys', () => {
  const scaled = scaleNutrients(
    { caloriesKcal: 220, proteinG: 6.5, extended: { caffeineMg: 80 } },
    1.5,
  );
  assert.deepEqual(scaled, { caloriesKcal: 330, proteinG: 9.75, extended: { caffeineMg: 120 } });
});

test('leaves absent keys absent and returns input on invalid factor', () => {
  const input = { caloriesKcal: 100 };
  assert.deepEqual(scaleNutrients(input, 0.5), { caloriesKcal: 50 });
  assert.equal(scaleNutrients(input, 0), input);
  assert.equal(scaleNutrients(input, Number.NaN), input);
});
```

- [ ] **Step 2: Add to `test:unit`, run — expect FAIL (module not found).**

- [ ] **Step 3: Implement**

```ts
// src/lib/food/scaleNutrients.ts
import type { FoodNutrients } from '@/types/food';

const NUTRIENT_KEYS = [
  'caloriesKcal', 'proteinG', 'totalFatG', 'saturatedFatG', 'transFatG',
  'carbsG', 'fiberG', 'sugarsG', 'addedSugarsG', 'sodiumMg', 'cholesterolMg',
] as const satisfies readonly (keyof Omit<FoodNutrients, 'extended'>)[];

export function scaleNutrients(nutrients: FoodNutrients, factor: number): FoodNutrients {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return nutrients;
  const scaled: FoodNutrients = {};
  for (const key of NUTRIENT_KEYS) {
    const value = nutrients[key];
    if (typeof value === 'number') scaled[key] = Math.round(value * factor * 100) / 100;
  }
  if (nutrients.extended) {
    const extended: Record<string, number> = {};
    for (const [key, value] of Object.entries(nutrients.extended)) {
      extended[key] = Math.round(value * factor * 100) / 100;
    }
    scaled.extended = extended;
  }
  return scaled;
}
```

- [ ] **Step 4: Run `npm run test:unit` — expect PASS.**

- [ ] **Step 5: Add portion chips to the draft card.** State near `draft` (page.tsx ~line 319): `const [portionFactor, setPortionFactor] = useState(1);` and reset it to `1` everywhere `setDraft(null)` or `setDraft(payload.draft …)` runs (lines 373, 389, 412, 418). In the draft card after `<NutrientGrid nutrients={draft.nutrients} />` (~line 776) insert — note the grid must render scaled values, so change that line to `<NutrientGrid nutrients={scaleNutrients(draft.nutrients, portionFactor)} />` and add:

```tsx
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-xs text-[#8B949E]">Portion</span>
              {[0.5, 1, 1.5, 2].map(factor => (
                <button
                  key={factor}
                  type="button"
                  onClick={() => setPortionFactor(factor)}
                  className={[
                    'rounded-lg px-2.5 py-1 text-xs font-bold',
                    portionFactor === factor ? 'bg-[#3B82F6] text-white' : 'bg-[#30363D] text-[#C9D1D9]',
                  ].join(' ')}
                >
                  ×{factor}
                </button>
              ))}
            </div>
```

- [ ] **Step 6: Apply the factor on save.** In `handleSaveDraft` (line ~404) build the scaled draft before `saveDraftAsEntry`:

```ts
    const scaledDraft: FoodAnalysisDraft = portionFactor === 1 ? draft : {
      ...draft,
      nutrients: scaleNutrients(draft.nutrients, portionFactor),
      components: draft.components.map(c => ({
        ...c,
        gramsEstimate: typeof c.gramsEstimate === 'number' ? Math.round(c.gramsEstimate * portionFactor) : c.gramsEstimate,
      })),
      uncertainties: [...draft.uncertainties, `Portion adjusted ×${portionFactor} by user.`],
    };
```

and pass `draft: scaledDraft`. Import `scaleNutrients` at the top.

- [ ] **Step 7: Verify:** `npx tsc --noEmit`; `npx playwright test tests/e2e/food.spec.ts` (existing draft-save tests still pass with default ×1).

- [ ] **Step 8: Commit** — `git commit -m "feat: portion multiplier on food draft with proportional nutrient scaling"`

### Task 5: "Ate this again" entry duplication

**Files:**
- Create: `supabase/016_food_entry_sources.sql`
- Modify: `src/types/food.ts:3`
- Modify: `src/lib/store/foodStore.ts` (new action)
- Modify: `src/app/app/food/page.tsx` (entry card action)

- [ ] **Step 1: Extend the source enum.** `src/types/food.ts:3`:

```ts
export type FoodEntrySource = 'photo_ai' | 'text_ai' | 'duplicate';
```

Migration (the DB CHECK in `005_food_intake.sql:14` only allows `photo_ai`):

```sql
-- supabase/016_food_entry_sources.sql
-- Allow text-AI and duplicated entries alongside photo_ai. Idempotent.
alter table food_entries drop constraint if exists food_entries_source_check;
alter table food_entries add constraint food_entries_source_check
  check (source in ('photo_ai', 'text_ai', 'duplicate'));
```

(Constraint name: verify with `rg -n "source" supabase/005_food_intake.sql` — if the inline check is unnamed, find the live name via `select conname from pg_constraint where conrelid = 'food_entries'::regclass and contype = 'c'` and use it; the orchestrator applies this migration.)

- [ ] **Step 2: Add the store action.** In `foodStore.ts` after `saveDraftAsEntry` add to the interface `duplicateEntry(entryId: string, consumedAt: string): FoodEntry | null;` and implement:

```ts
  duplicateEntry(entryId, consumedAt) {
    const state = get();
    const original = state.entries.find(entry => entry.id === entryId);
    if (!original || !state.currentUserId) return null;
    const now = new Date().toISOString();
    const newId = uuid();
    const entry: FoodEntry = {
      ...original,
      id: newId,
      consumedAt,
      source: 'duplicate',
      components: original.components.map(c => ({ ...c, id: uuid(), entryId: newId })),
      createdAt: now,
      updatedAt: now,
    };
    set(s => ({ entries: [entry, ...s.entries] }));
    syncFoodFireAndForget(state.currentUserId, entry, () => {
      if (readPendingDeletedFoodEntryIds().includes(entry.id)) return true;
      const s = get();
      return !s.entries.some(existing => existing.id === entry.id);
    });
    return entry;
  },
```

- [ ] **Step 3: Add the entry-card button.** In the diary entry card in `page.tsx` (the list rendered from `entriesForDate` — locate the card footer next to the delete control) add:

```tsx
              <button
                type="button"
                onClick={() => duplicateEntry(entry.id, new Date().toISOString())}
                className="rounded-lg bg-[#30363D] px-2.5 py-1 text-xs font-bold text-[#C9D1D9]"
              >
                ↺ Ate this again
              </button>
```

and destructure `duplicateEntry` from `useFoodStore`.

- [ ] **Step 4: Add an E2E test to `tests/e2e/food.spec.ts`** (inside the existing describe, reusing its auth/photo helpers):

```ts
  test('duplicates an entry and doubles the daily totals', async ({ page }, testInfo) => {
    // reuse the same flow as the analyze-and-save test to create one entry,
    // then:
    await page.getByRole('button', { name: '↺ Ate this again' }).first().click();
    await expect(page.getByText(/2 entries|×2/).or(page.locator('text=Estimated salad').nth(1))).toBeVisible();
  });
```

Adapt the final assertion to the diary card markup (two cards with the same title visible).

- [ ] **Step 5: Verify:** `npx tsc --noEmit`; `npx playwright test tests/e2e/food.spec.ts`. **Note:** the duplicate-save sync will fail against prod DB until migration 016 is applied — orchestrator applies 016 before merging this PR.

- [ ] **Step 6: Commit** — `git commit -m "feat: one-tap repeat of a previous food entry"`

### Task 6: Text-only analysis backend

**Files:**
- Create: `src/app/api/food/analyze-text/route.ts`
- Modify: `src/lib/food/analyze/providers.ts` (add `analyzeFoodText`)

- [ ] **Step 1: Add the text path to providers.** In `providers.ts` add:

```ts
const FOOD_TEXT_PROMPT =
  'Estimate the nutrients of the meal described by the user. Return only JSON matching the schema. Include approximate portions, nutrients, confidence, and uncertainties. Do not provide medical advice.';

export async function analyzeFoodText(description: string): Promise<FoodAnalysisDraft> {
  const provider = getFoodAnalysisProvider();
  if (provider === 'mock') return mockFoodAnalysis();
  if (provider !== 'openrouter') {
    // Production uses OpenRouter; other providers can be added when needed.
    throw new Error('food_text_provider_unsupported');
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for FOOD_AI_PROVIDER=openrouter.');
  const models = getOpenRouterFoodVisionModels();
  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const response = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
        'X-Title': 'MedRemind',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: FOOD_TEXT_PROMPT },
          { role: 'user', content: description },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'food_analysis', strict: true, schema: FOOD_ANALYSIS_SCHEMA },
        },
      }),
    });
    if (!response.ok) {
      if (shouldFallbackOpenRouterFoodModel(response.status, model, models[index + 1])) continue;
      throw new Error(`food_provider_openrouter_${response.status}`);
    }
    const payload = await response.json();
    const outputText = payload?.choices?.[0]?.message?.content;
    if (typeof outputText !== 'string' || outputText.trim().length === 0) {
      throw new Error('Food analysis returned no structured output.');
    }
    return validateProviderDraft(parseStructuredOutput(outputText), model);
  }
  throw new Error('food_provider_openrouter_exhausted');
}
```

- [ ] **Step 2: Add the route**

```ts
// src/app/api/food/analyze-text/route.ts
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { analyzeFoodText } from '@/lib/food/analyze/providers';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

const MAX_TEXT_LENGTH = 1000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let text: unknown;
  try {
    ({ text } = await request.json());
  } catch {
    return NextResponse.json({ error: 'Meal description is required.' }, { status: 400 });
  }
  if (typeof text !== 'string' || text.trim().length < 3 || text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: 'Meal description is required.' }, { status: 400 });
  }
  try {
    const draft = await analyzeFoodText(text.trim());
    return NextResponse.json({ draft });
  } catch (err) {
    console.error('[food-analyze-text]', err);
    Sentry.captureException(err);
    const reason = err instanceof Error && /^food_/.test(err.message) ? err.message : 'unknown';
    return NextResponse.json({ error: 'Food analysis failed.', reason }, { status: 502 });
  }
}
```

- [ ] **Step 3: Verify:** `npx tsc --noEmit`; `npm run build`; manual smoke with mock provider: `curl -s -X POST localhost:3000/api/food/analyze-text -H 'Content-Type: application/json' -d '{"text":"oatmeal with banana"}'` returns 401 (auth-gated) — confirms route wiring.

- [ ] **Step 4: Commit** — `git commit -m "feat: text-only food analysis endpoint reusing the vision schema"`

### Task 7: Text input UI

**Files:**
- Modify: `src/app/app/food/page.tsx` (command bar + new handler)
- Modify: `tests/e2e/food.spec.ts` (new test)

- [ ] **Step 1: Add state + handler in `page.tsx`** next to `analyzeImage`:

```ts
  const [mealText, setMealText] = useState('');

  async function analyzeText() {
    const text = mealText.trim();
    if (text.length < 3) return;
    setAnalyzing(true);
    setAnalysisError(null);
    setDraft(null);
    try {
      const response = await fetch('/api/food/analyze-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.draft) throw new Error('analysis_failed');
      setDraft(payload.draft as FoodAnalysisDraft);
      setMealText('');
    } catch {
      setAnalysisError('Unable to analyze this description. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  }
```

- [ ] **Step 2: Add the input row** under the Capture/Gallery buttons row:

```tsx
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={mealText}
              onChange={e => setMealText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void analyzeText(); }}
              placeholder="Describe your meal…"
              aria-label="Describe your meal"
              disabled={analyzing}
              className="flex-1 rounded-xl bg-[#161B22] px-3 py-2 text-sm text-[#F0F6FC] placeholder-[#8B949E]"
            />
            <button
              type="button"
              onClick={() => void analyzeText()}
              disabled={analyzing || mealText.trim().length < 3}
              className="rounded-xl bg-[#238636] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              Analyze
            </button>
          </div>
```

- [ ] **Step 3: E2E test in `tests/e2e/food.spec.ts`** (mock provider returns the salad draft):

```ts
  test('analyzes a typed meal description and saves it', async ({ page }) => {
    // reuse the suite's auth/targets setup helpers, then:
    await page.getByLabel('Describe your meal').fill('oatmeal with banana and coffee');
    await page.getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByText('Estimated salad')).toBeVisible();
    await page.getByRole('button', { name: /Save/ }).click();
    await expect(page.getByText('Estimated salad')).toBeVisible();
  });
```

Match the Save button name to the existing draft-save test in this file.

- [ ] **Step 4: Verify:** `npx tsc --noEmit`; `npx playwright test tests/e2e/food.spec.ts`.

- [ ] **Step 5: Commit** — `git commit -m "feat: log meals from a text description"`

### Task 8: Photo storage + thumbnails

**Files:**
- Create: `supabase/017_food_photos.sql`
- Modify: `src/app/api/food/analyze-photo/route.ts`
- Modify: `src/types/food.ts` (FoodEntry + FoodAnalysisDraft `photoPath?: string`)
- Modify: `src/lib/store/foodStore.ts` (`saveDraftAsEntry` copies `photoPath`)
- Modify: `src/lib/supabase/foodSync.ts` (map `photo_path` both directions)
- Modify: `src/app/app/food/page.tsx` (thumbnail in entry card via signed URL)

- [ ] **Step 1: Migration**

```sql
-- supabase/017_food_photos.sql
alter table food_entries add column if not exists photo_path text;

insert into storage.buckets (id, name, public)
values ('food-photos', 'food-photos', false)
on conflict (id) do nothing;

create policy "Food photos owner read" on storage.objects for select
  using (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "Food photos owner write" on storage.objects for insert
  with check (bucket_id = 'food-photos' and auth.uid()::text = (storage.foldername(name))[1]);
```

(Wrap the two `create policy` statements in `do $$ begin … exception when duplicate_object then null; end $$;` blocks for idempotency.)

- [ ] **Step 2: Upload in the analyze route** after a successful draft (route.ts, inside the try):

```ts
    let photoPath: string | null = null;
    const uploadPath = `${data.user.id}/${crypto.randomUUID()}.jpg`;
    const { error: uploadErr } = await supabase.storage
      .from('food-photos')
      .upload(uploadPath, imageBuffer, { contentType: image.type });
    if (!uploadErr) photoPath = uploadPath;
    else console.warn('[food-photo-upload]', uploadErr.message);

    return NextResponse.json({ draft: { ...draft, photoPath } });
```

- [ ] **Step 3: Thread `photoPath` through types/store/sync.** Add `photoPath?: string;` to `FoodAnalysisDraft` and `FoodEntry` in `types/food.ts`; copy it in `saveDraftAsEntry` (`photoPath: draft.photoPath`); in `foodSync.ts` add `photo_path: entry.photoPath ?? null` to the save row and `photoPath: row.photo_path ? String(row.photo_path) : undefined` to the pull mapper.

- [ ] **Step 4: Thumbnail in the entry card** (page.tsx): a small `FoodPhotoThumb` component that calls `supabase.storage.from('food-photos').createSignedUrl(photoPath, 3600)` in a `useEffect` and renders a 44×44 rounded `<img>`; render it when `entry.photoPath` is set.

- [ ] **Step 5: Verify:** `npx tsc --noEmit`; `npm run build`; `npx playwright test tests/e2e/food.spec.ts` (mock flow has no photoPath — cards render without thumbs). Orchestrator applies migration 017 before merge.

- [ ] **Step 6: Commit** — `git commit -m "feat: persist meal photos to storage and show diary thumbnails"`

### Task 9: Insights nutrition card

**Files:**
- Modify: `src/app/app/insights/page.tsx`

- [ ] **Step 1: Add a 7-day nutrition summary card.** Load the last 7 days via `useFoodStore` (`loadEntriesForRange` + `totalsForDate`) and `useNutritionTargetsStore`; render avg kcal / protein / fiber / water vs target with simple progress bars (reuse the page's existing card styles). Show the card only when a target profile exists and at least one entry was logged in the window.

- [ ] **Step 2: Verify:** `npx tsc --noEmit`; `npm run build`; open `/app/insights` via `npm run dev` and confirm the card renders.

- [ ] **Step 3: Commit** — `git commit -m "feat: 7-day nutrition vs targets card in insights"`

**Out of scope (deliberate):** evening push reminder for unlogged meals — revisit only after usage returns (YAGNI); per-component nutrient editing (model returns per-meal nutrients only); rate limiting on the analyze routes (auth-gated single-user app — add only if cost telemetry shows abuse).
