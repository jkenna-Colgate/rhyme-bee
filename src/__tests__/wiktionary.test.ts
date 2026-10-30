/**
 * The pinned Wiktionary extract (#268): which transcriptions it keeps from a
 * Kaikki entry, and how a General American IPA transcription is read as the
 * ARPAbet the engine computes Rhyme Keys from.
 */

import { describe, expect, it } from "vitest";
import { extractLines, ipaReadings, parseWiktionaryExtract, serialiseWiktionaryExtract, wiktionaryReadings } from "../wiktionary.ts";

const read = (ipa: string) => ipaReadings(ipa).map((r) => r.join(" "));

describe("reading a General American transcription as ARPAbet", () => {
  it("keeps the dictionary's stress marks, primary and secondary", () => {
    // The research's example: CMUdict lacks the secondary stress on -mass.
    expect(read("/ˈbaɪoʊˌmæs/")).toEqual(["B AY1 OW0 M AE2 S"]);
    expect(read("/əˈbaʊt/")).toEqual(["AH0 B AW1 T"]);
  });

  it("stresses the one vowel of a monosyllable written without a mark", () => {
    expect(read("/kæt/")).toEqual(["K AE1 T"]);
    expect(read("/t͡ʃɝt͡ʃ/")).toEqual(["CH ER1 CH"]);
  });

  it("stresses the first vowel of a longer word written without a mark, as Wiktionary's unmarked entries are said", () => {
    expect(read("/hækəɹ/")).toEqual(["HH AE1 K ER0"]);
    expect(read("/aʊɚ/")).toEqual(["AW1 ER0"]);
  });

  it("reads a vowel before r-colouring as the vowel and R, and a gliding vowel before it as ER", () => {
    // Wiktionary writes `sphere` as /sfɪɚ/.
    expect(read("/sfɪɚ/")).toEqual(["S F IH1 R"]);
    expect(read("/ˈfaɪɚ/")).toEqual(["F AY1 ER0"]);
    expect(read("/hɪɹ/")).toEqual(["HH IH1 R"]);
    expect(read("/kɑɹ/")).toEqual(["K AA1 R"]);
  });

  it("reads the vowel of `more` as CMUdict's AO however it is written", () => {
    expect(read("/mɔɹ/")).toEqual(["M AO1 R"]);
    expect(read("/moɹ/")).toEqual(["M AO1 R"]);
  });

  it("folds an r after the stressed er vowel into it, as CMUdict writes `hurry`", () => {
    expect(read("/ˈhɝɹi/")).toEqual(["HH ER1 IY0"]);
    expect(read("/ˈpeɪpɚ/")).toEqual(["P EY1 P ER0"]);
  });

  it("reads a tap and a glottal stop as T, and a syllabic consonant as a weak vowel and the consonant", () => {
    expect(read("/ˈbʌɾɚ/")).toEqual(["B AH1 T ER0"]);
    expect(read("/ˈbʌʔn̩/")).toEqual(["B AH1 T AH0 N"]);
    expect(read("/ˈbɑɾl̩/")).toEqual(["B AA1 T AH0 L"]);
  });

  it("reads the raised and nasalised vowels of /æ/ as CMUdict's AE", () => {
    expect(read("/beɪŋ/")).toEqual(["B AE1 NG"]);
    expect(read("/ˈsɛ̃ŋ/")).toEqual(["S AE1 NG"]);
    expect(read("[steəf]")).toEqual(["S T AE1 F"]);
    // Before r it is the vowel of `care`.
    expect(read("/wɛəɹɚ/")).toEqual(["W EH1 R ER0"]);
  });

  it("reads the raised vowel of `fight` as AY", () => {
    expect(read("/fəɪt/")).toEqual(["F AY1 T"]);
  });

  it("reads each of the alternatives a transcription gives, and a space as a syllable break", () => {
    expect(read("[ˈbæŋkɚ] ~ [ˈbæŋkɹ̩]")).toEqual(["B AE1 NG K ER0"]);
    expect(read("/ˈdɔɡ ˌpaɪl/")).toEqual(["D AO1 G P AY2 L"]);
  });

  it("reads nothing from a fragment of a word", () => {
    expect(read("/-ni.əl/")).toEqual([]);
    expect(read("[-ʔ]")).toEqual([]);
  });

  it("ignores syllable breaks, length marks and tie bars", () => {
    expect(read("/ˈneɪ.ʃən/")).toEqual(["N EY1 SH AH0 N"]);
    expect(read("[ˈmjuːzɪk]")).toEqual(["M Y UW1 Z IH0 K"]);
  });

  it("reads a sound in brackets both ways", () => {
    // ə before ɹ is CMUdict's weak ER0, as in its `interest`.
    expect(read("/ˈɪnt(ə)ɹəst/")).toEqual(["IH1 N T ER0 AH0 S T", "IH1 N T R AH0 S T"]);
  });

  it("reads nothing it cannot spell in ARPAbet, rather than a reading with a sound missing", () => {
    expect(read("/ˈkœt/")).toEqual([]);
  });
});

describe("the extract a Kaikki entry contributes", () => {
  it("keeps only the General American and US transcriptions of a lower-case word", () => {
    const entry = {
      word: "sphere",
      lang_code: "en",
      sounds: [
        { ipa: "/sfɪə/", tags: ["Received-Pronunciation"] },
        { ipa: "/sfɪɚ/", tags: ["US"] },
        { ipa: "/sfɪɹ/", tags: ["General-American"] },
        { ipa: "/sfɛː/" },
        { audio: "en-us-sphere.ogg", tags: ["US"] },
      ],
    };
    expect(extractLines(entry)).toEqual([["sphere", "/sfɪɚ/"], ["sphere", "/sfɪɹ/"]]);
  });

  it("keeps nothing from a capitalised headword, another language, or a phrase", () => {
    const sounds = [{ ipa: "/mɑɹks/", tags: ["US"] }];
    expect(extractLines({ word: "Marx", lang_code: "en", sounds })).toEqual([]);
    expect(extractLines({ word: "marx", lang_code: "de", sounds })).toEqual([]);
    expect(extractLines({ word: "ice cream", lang_code: "en", sounds })).toEqual([]);
  });

  it("round-trips through the committed format, sorted and without repeats", () => {
    const text = serialiseWiktionaryExtract([["cat", "/kæt/"], ["bat", "/bæt/"], ["cat", "/kæt/"]], "a header line");
    expect(text).toBe("# a header line\nbat\t/bæt/\ncat\t/kæt/\n");
    expect([...parseWiktionaryExtract(text)]).toEqual([["bat", ["/bæt/"]], ["cat", ["/kæt/"]]]);
  });
});

describe("a word's Wiktionary readings as the engine would hold them", () => {
  it("puts them through the build's Normalisation, so the caught vowel is the merged one", () => {
    const extract = parseWiktionaryExtract("talk\t/tɔk/\n");
    expect(wiktionaryReadings(extract, "talk").map((r) => r.join(" "))).toEqual(["T AA1 K"]);
    expect(wiktionaryReadings(extract, "absent")).toEqual([]);
  });
});
