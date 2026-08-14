export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function buildRecordingUploadCommand(values: string[]): string {
  return values.map(shellQuote).join(" ");
}
