import { Injectable, inject } from '@angular/core';
import { MtgService } from './mtg.service';
import { ScryfallService } from './scryfall.service';

const MODEL = 'gemini-2.0-flash';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const PROMPT = `Du siehst ein Foto von einem Magic-The-Gathering-Spieltisch.
Erkenne alle sichtbaren Commander-Karten (legendäre Kreaturen, meist prominent in der Kommandozone platziert).
Die Karten können in beliebiger Sprache gedruckt sein (Deutsch, Englisch, Japanisch, ...).
Gib IMMER den offiziellen ENGLISCHEN Kartennamen an – übersetze gedruckte fremdsprachige Namen in den englischen Originalnamen.
Antworte AUSSCHLIESSLICH mit einem JSON-Array der englischen Kartennamen, z.B.:
["Atraxa, Praetors' Voice", "Krenko, Mob Boss"]
Wenn keine Karten erkennbar sind, antworte mit [].`;

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private readonly mtg = inject(MtgService);
  private readonly scryfall = inject(ScryfallService);

  get hasApiKey(): boolean {
    return this.mtg.geminiApiKey().length > 0;
  }

  /**
   * Erkennt Commander-Karten auf einem Foto und verifiziert sie über Scryfall.
   * Liefert nur Kartennamen zurück, die wirklich existieren.
   */
  async recognizeCommanders(file: File): Promise<string[]> {
    const apiKey = this.mtg.geminiApiKey();
    if (!apiKey) {
      throw new Error('Kein Gemini-API-Key hinterlegt. Bitte unter „Spieler“ eintragen.');
    }

    const base64 = await this.fileToBase64(file);

    const res = await fetch(`${API_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      if (res.status === 400 || res.status === 403) {
        throw new Error('Gemini-API-Key ungültig oder nicht berechtigt.');
      }
      if (res.status === 429) {
        throw new Error(
          'Gemini-Limit erreicht (zu viele Anfragen). Bitte etwa eine Minute warten und erneut versuchen – oder den Commander über die Kartensuche eintragen.',
        );
      }
      throw new Error(`Gemini-Anfrage fehlgeschlagen (HTTP ${res.status}).`);
    }

    const data = await res.json();
    const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const names = this.parseCardNames(text);

    // Über Scryfall verifizieren – nur real existierende Karten übernehmen
    const verified: string[] = [];
    for (const name of names) {
      const card = await this.scryfall.findCard(name);
      if (card && !verified.includes(card.name)) {
        verified.push(card.name);
      }
    }
    return verified;
  }

  private parseCardNames(text: string): string[] {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
    } catch {
      return [];
    }
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.substring(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('Foto konnte nicht gelesen werden.'));
      reader.readAsDataURL(file);
    });
  }
}
