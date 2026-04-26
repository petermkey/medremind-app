const DIRECT_MEDICATION_CHANGE =
  /\b(stop|stopping|pause|pausing|skip|skipping|cancel|cancelling|discontinue|discontinuing|move|reschedule|delay|reduce|increase|double|halve)\b/i;

export function assertSafeMedicationKnowledgeText(text: string): void {
  if (DIRECT_MEDICATION_CHANGE.test(text)) {
    throw new Error('Direct medication-change language is not allowed');
  }
}
