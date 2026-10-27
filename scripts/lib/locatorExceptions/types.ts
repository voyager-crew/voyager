export interface LocatorLiteralException {
  readonly file: string;
  readonly kind: 'proof' | 'protocol';
  readonly values: Readonly<Record<string, number>>;
  readonly reason: string;
}
