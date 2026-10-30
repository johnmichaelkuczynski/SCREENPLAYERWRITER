export const wordCount = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0;

export function splitDocument(text: string, budget = 2200): string[] {
  const paragraphs = text.trim().split(/\n\s*\n/u).filter(Boolean);
  const units = paragraphs.flatMap(p => wordCount(p) > budget ? (p.match(/[^.!?]+(?:[.!?]+["')\]]*(?:\s+|$)|$)/gu) || [p]) : [p]);
  const chunks: string[] = [];
  let current = "";
  for (const raw of units) {
    const unit = raw.trim();
    if (!unit) continue;
    if (current && wordCount(`${current}\n\n${unit}`) > budget) { chunks.push(current); current = ""; }
    current = current ? `${current}\n\n${unit}` : unit;
  }
  if (current.trim()) chunks.push(current.trim());
  if (wordCount(chunks.join("\n\n")) !== wordCount(text)) return paragraphs.length > 1 ? paragraphs : [text.trim()];
  return chunks;
}

export function parseRequestedWords(text: string): number | undefined {
  const match = /(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:-\s*)?words?\b/i.exec(text);
  return match ? Math.round(Number(match[1]!.replaceAll(",", "")) * (match[2] ? 1000 : 1)) : undefined;
}
