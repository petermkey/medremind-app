export type ModelHealthResult = {
  model: string;
  ok: boolean;
  status?: number;
  error?: string;
};

// Existence in OpenRouter's /models catalog is not sufficient — the
// 2026-07-10 incident showed a model can be listed there yet still 404 for
// a specific account due to data-policy/guardrail settings. A cheap
// (max_tokens: 1) completion call is the only way to catch that.
export async function checkOpenRouterModelAvailable(
  model: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelHealthResult> {
  try {
    const response = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });

    if (response.ok) {
      return { model, ok: true, status: response.status };
    }

    const payload = await response.json().catch(() => null);
    const error = typeof payload?.error?.message === 'string' ? payload.error.message : undefined;
    return { model, ok: false, status: response.status, error };
  } catch (err) {
    return { model, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
