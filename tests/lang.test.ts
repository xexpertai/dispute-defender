import { describe, expect, it } from "vitest";
import { detectLanguage } from "@/lib/lang/detect";

describe("detectLanguage", () => {
  it.each([
    [["Hola, ¿dónde está mi pedido? No lo he recibido."], "es"],
    [["Bonjour, je n'ai pas reçu ma commande."], "fr"],
    [["Hallo, ich habe meine Bestellung nicht erhalten."], "de"],
    [["Olá, não recebi o meu pedido."], "pt"],
    [["Ciao, non ho ricevuto il mio ordine."], "it"],
    [["Hi, has my mug set shipped yet?"], "en"],
    [[], "en"],
    [["12345 !!!"], "en"],
  ])("%j → %s", (texts, code) => {
    expect(detectLanguage(texts).code).toBe(code);
  });
});
