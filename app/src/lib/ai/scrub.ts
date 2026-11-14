/**
 * Removes obvious personal identifiers from transaction descriptions before anything is sent to the model
 * (plan section 13). This is a best-effort filter, not a promise of anonymity.
 */
export function scrubDescription(input: string): string {
  return input
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\+?1?[\s.-]?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, "[phone]")
    .replace(/\b(?:ACCT|ACCOUNT|A\/C|CARD|REF|CONF|TRACE|ID|INDN|CO ID)[:#\s]*[A-Z0-9-]{3,}/gi, "[ref]")
    .replace(/\d{4,}/g, "####")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}
