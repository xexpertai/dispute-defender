/**
 * Tiny deterministic language guess for buyer messages (no network, no LLM). Good enough to
 * tell the seller "the buyer wrote in Spanish" and to tell the AI which language to reply in.
 * Returns "en" when unsure.
 */
export interface Lang {
  code: string;
  name: string;
}

const PROFILES: { code: string; name: string; words: string[]; chars?: RegExp }[] = [
  { code: "es", name: "Spanish", words: ["el", "la", "los", "las", "de", "que", "y", "mi", "no", "pedido", "dónde", "donde", "está", "he", "recibido", "por", "favor", "hola", "gracias", "lo", "es", "un", "una"], chars: /[ñ¿¡]/ },
  { code: "fr", name: "French", words: ["le", "la", "les", "de", "des", "et", "je", "mon", "ma", "pas", "commande", "où", "est", "reçu", "bonjour", "merci", "une", "un", "ne", "vous"], chars: /[çœ]/ },
  { code: "de", name: "German", words: ["der", "die", "das", "und", "ich", "nicht", "meine", "mein", "bestellung", "wo", "ist", "habe", "erhalten", "hallo", "danke", "ein", "eine"], chars: /[ß]/ },
  { code: "pt", name: "Portuguese", words: ["o", "a", "os", "as", "de", "que", "e", "meu", "minha", "não", "pedido", "onde", "está", "recebi", "olá", "obrigado", "um", "uma"], chars: /[ãõ]/ },
  { code: "it", name: "Italian", words: ["il", "lo", "la", "di", "che", "e", "mio", "mia", "non", "ordine", "dove", "è", "ricevuto", "ciao", "grazie", "un", "una"] },
  { code: "en", name: "English", words: ["the", "and", "my", "not", "order", "where", "is", "have", "received", "hi", "hello", "thanks", "it", "a", "an", "to", "of", "yet"] },
];

export const ENGLISH: Lang = { code: "en", name: "English" };

export function detectLanguage(texts: string[]): Lang {
  const text = texts.join(" ").toLowerCase();
  const tokens = text.match(/[\p{L}]+/gu) ?? [];
  if (tokens.length === 0) return ENGLISH;
  let best = { code: "en", name: "English", score: 0 };
  for (const p of PROFILES) {
    const set = new Set(p.words);
    let score = tokens.filter((t) => set.has(t)).length / tokens.length;
    if (p.chars?.test(text)) score += 0.25;
    if (score > best.score) best = { code: p.code, name: p.name, score };
  }
  return best.score >= 0.2 ? { code: best.code, name: best.name } : ENGLISH;
}
