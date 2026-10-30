/** Today in the phone's own calendar: toISOString() is UTC, and says yesterday for two hours after a Belgian midnight. */
export function today(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
