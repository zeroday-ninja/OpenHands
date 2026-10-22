import i18next from "i18next";
import { describe, expect, it } from "vitest";

import translations from "#/i18n/translation.json";
import { PROJECT_MAP_WARNING_LABELS } from "#/components/features/project-map/project-map-labels";

type Translations = Record<string, Record<string, string>>;

/**
 * A repair warning resolved the way the page resolves it: through i18next,
 * with a count. The page passes a count straight to `t()`, so whether "1
 * connections" ever reaches a user is decided entirely by what is in
 * `translation.json` — which makes this the only place the behaviour can be
 * checked.
 */
async function warning(key: string, lng: string, count: number) {
  const resources: Record<string, { translation: Record<string, string> }> = {};
  for (const [name, byLang] of Object.entries(translations as Translations)) {
    if (!name.startsWith(key)) continue;
    for (const [lang, value] of Object.entries(byLang)) {
      resources[lang] ??= { translation: {} };
      resources[lang].translation[name] = value;
    }
  }
  const instance = i18next.createInstance();
  await instance.init({ lng, fallbackLng: "en", resources });
  return instance.t(key, { count });
}

const WARNING_KEYS = Object.values(PROJECT_MAP_WARNING_LABELS);

describe("the project map's repair warnings", () => {
  it("counts one of anything in the singular", async () => {
    for (const key of WARNING_KEYS) {
      // Act
      const one = await warning(key, "en", 1);
      const many = await warning(key, "en", 4);

      // Assert: the two readings differ, and the singular says "1".
      expect(one).not.toBe(many);
      expect(one.startsWith("1 ")).toBe(true);
      expect(many.startsWith("4 ")).toBe(true);
    }
  });

  it("answers in the reader's own language for every count", async () => {
    for (const key of WARNING_KEYS) {
      for (const count of [1, 2, 3, 11, 100]) {
        // Act: Arabic and Ukrainian have plural categories English does not,
        // so a missing one must fall back to the same language, never to the
        // English sentence.
        const arabic = await warning(key, "ar", count);
        const ukrainian = await warning(key, "uk", count);

        // Assert
        expect(arabic).not.toBe(await warning(key, "en", count));
        expect(ukrainian).not.toBe(await warning(key, "en", count));
        expect(arabic).not.toBe(key);
        expect(ukrainian).not.toBe(key);
      }
    }
  });
});
