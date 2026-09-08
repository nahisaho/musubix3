export interface MusubixTestReport {
  schemaVersion: 1;
  tests: Array<{
    id: string;
    status: 'passed' | 'failed' | 'skipped' | 'error';
    operations?: Record<string, number>;
  }>;
}
