// The Uco & Ocu Show Bible for unattended (scheduled) scripts: per-format length and structure, the prompt and JSON
// schema Gemini writes to, the checks a script must pass (a short or flat script is retried once with stricter
// instructions), the outro CTA, and the episode's fresh prop specs. Pure code: no database, no network, no AI.
import type { ManualLine } from "./manualScriptParser";
import { cleanHandle } from "./voice/phonetic";
import { SFX_NAMES, STAT_SUBLINE_MAX, type EpisodeFormat, cleanCalloutText } from "./scheduler";

export const CTA_HANDLE = "@UCO.OCU";
/** The first, outro-only direction scheduled scripts carried (upgraded to showDirection() at render time). */
export const LEGACY_SHOW_DIRECTION = `CTA: FOLLOW ${CTA_HANDLE}`;

/**
 * Direction notes for every scheduled episode (parsed by video/src/direction.ts): the FOLLOW @UCO.OCU outro; the
 * background bed, the urgent track for Koran Kinetik (falling back to the regular bed), at 20 % between lines and
 * 12 % (≈ −18 dB) under dialogue (video/src/shared/bgm.ts), silent under inner thoughts; and natural
 * comedic timing between lines (0.30 s speaker switch, 0.24 s same speaker, 0.42 s into a visual shift).
 */
export function showDirection(style: string = "editorial-paper-cutout"): string {
  return [
    LEGACY_SHOW_DIRECTION,
    style === "editorial-paper-cutout" ? "BGM: urgent" : "BGM: on",
    "BGM volume: 20%",
    "BGM off on thought",
    "Pacing: natural",
  ].join("\n");
}
/** The default (Koran Kinetik) direction. */
export const SHOW_DIRECTION = showDirection();
/** Fewer lines than this is never accepted for a scheduled episode (after one stricter retry the slot fails). */
export const MIN_LINES = 12;

export type FormatSpec = { lines: [number, number]; seconds: string; takeovers: [number, number]; thoughts: [number, number]; explainer: number; structure: string };
export const FORMAT_SPEC: Record<EpisodeFormat, FormatSpec> = {
  comedy_debate: {
    lines: [13, 15],
    seconds: "55-68",
    takeovers: [0, 2],
    thoughts: [1, 2],
    explainer: 1,
    structure:
      "Hook: kebiasaan buruk atau hot take Uco yang relatable → banter cepat dan eskalasi → Ocu membawa konsep psikologi / sains dengan NAMA (mis. sunk cost fallacy, efek Dunning-Kruger) plus angka nyata (Rupiah atau data dunia nyata) → 1-2 baris thought: true (monolog batin / kemunafikan) sebagai twist → punchline → outro CTA penuh.",
  },
  affiliate: {
    lines: [13, 15],
    seconds: "55-68",
    takeovers: [0, 2],
    thoughts: [1, 2],
    explainer: 1,
    structure:
      "Hook: Uco tergoda produk sehari-hari → debat jujur untung-rugi dengan harga Rupiah nyata dan konsep psikologi belanja ber-NAMA (mis. anchoring, decoy effect) → 1-2 baris thought: true → punchline → outro CTA penuh yang juga menyebut keranjang kuning. Tanpa klaim palsu.",
  },
  koran_kinetik: {
    lines: [13, 15],
    seconds: "55-68",
    takeovers: [3, 4],
    thoughts: [0, 2],
    explainer: 0,
    structure:
      "Buka langsung marah / mendesak ke masalahnya (tanpa pemanasan) → bukti data dan hitungan keras → 3-4 baris layout takeover dengan statCard, kira-kira satu tiap 20 detik (tersebar, jangan berurutan) → sarkasme tajam → outro CTA penuh.",
  },
  diagram_taktis: {
    lines: [13, 15],
    seconds: "55-68",
    takeovers: [1, 2],
    thoughts: [0, 2],
    explainer: 1,
    structure:
      "Hook: Uco salah paham soal cara kerja sesuatu → Ocu membongkar langkah demi langkah dengan angka nyata dan konsep ber-NAMA → Uco bereaksi → punchline → outro CTA penuh.",
  },
};

export const POSES_ALL = ["triumphant", "defensive", "shocked", "angry", "phone", "deadpan", "explaining", "inspecting", "thought", "cta"] as const;
const S = (description: string) => ({ type: "STRING", description });

/** Gemini's JSON schema for a Show Bible script (OpenAPI subset). */
export const SHOW_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: S("Judul episode, bahasa Indonesia santai, maks 8 kata"),
    propSpecs: {
      type: "ARRAY",
      description: "2-3 prop khusus episode ini",
      items: {
        type: "OBJECT",
        properties: {
          slug: S("kebab-case, huruf kecil, maks 30 karakter, mis. serum-mahal"),
          prompt: S("Deskripsi SATU objek, dalam bahasa Inggris, untuk ilustrasi komik"),
        },
        required: ["slug", "prompt"],
      },
    },
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          beat: { type: "STRING", enum: ["hook", "counter", "escalation", "insight", "concession", "button"] },
          speaker: { type: "STRING", enum: ["uco", "ocu"] },
          text: S("Kalimat yang diucapkan, bahasa Jakarta santai (lo/gue): 8-13 kata, atau 3-7 kata untuk interjeksi kilat"),
          subtitle: S("Natural English subtitle of the line"),
          pose: { type: "STRING", enum: [...POSES_ALL] },
          shot: { type: "STRING", enum: ["solo-uco", "solo-ocu", "closeup-punch", "two-shot"] },
          callout: S("2-4 kata HURUF BESAR yang muncul di layar pada beat penekanan, selain itu kosong"),
          layout: { type: "STRING", enum: ["standard", "takeover"] },
          statCard: S("Untuk takeover: 'ANGKA/FAKTA | PENJELASAN SINGKAT' (penjelasan maksimal 42 karakter), selain itu kosong"),
          explainerCard: { type: "STRING", enum: ["none", "brain-badge", "wave-graph"] },
          sfx: { type: "ARRAY", items: { type: "STRING", enum: [...SFX_NAMES] } },
          prop: S("slug dari propSpecs, atau none"),
          kicker: S("Label di atas headline, huruf besar, maks 2 kata"),
          headline: S("Inti kalimat, huruf besar, maks 5 kata"),
          stamp: S("Stempel merah maks 3 kata, atau kosong"),
          delivery: S("Cara mengucapkan (emosi, tempo)"),
        },
        required: ["beat", "speaker", "text", "subtitle", "pose", "shot", "layout", "explainerCard", "sfx", "prop", "kicker", "headline"],
      },
    },
  },
  required: ["title", "propSpecs", "lines"],
};

/** The Show Bible prompt. `strict` carries the problems of the first attempt (the one retry). */
export function showBiblePrompt(p: { format: EpisodeFormat; label: string; brief: string; seed: string; bankProps: string; strict?: string[] }): string {
  const f = FORMAT_SPEC[p.format];
  return `Kamu head writer "Uco & Ocu", serial komedi video vertikal berbahasa Indonesia. Tulis SATU episode format ${p.label} (${f.seconds} detik).
${p.brief}
Topik: ${p.seed}

KARAKTER
- Uco: heboh, optimis, gampang ngegas, sering jadi contoh kebiasaan buruk. Pose: triumphant, defensive, shocked, angry, phone, thought.
- Ocu: kalem, datar, sinis tajam, bawa data dan sains. Pose: deadpan, explaining, inspecting, angry, thought, cta.

STRUKTUR (wajib)
- ${f.lines[0]}-${f.lines[1]} baris termasuk outro CTA (sekitar ${f.seconds} detik). Kurang dari ${f.lines[0]} atau lebih dari ${f.lines[1]} baris = gagal.
- ${f.structure}
- Baris terakhir: outro CTA penuh dari Ocu dengan pose cta, mengajak follow ${CTA_HANDLE} (mis. "Follow @uco.ocu biar nggak ketipu lagi!"). Tulis handle PERSIS "@uco.ocu" di text dan subtitle (subtitle: "Follow @uco.ocu ..."). DILARANG mengeja titiknya ("uco titik ocu", "uco dot ocu", "akun uco titik ocu"): suaranya otomatis membaca "Uco Ocu".
- Sebelum CTA: tutup dengan twist kemunafikan yang lucu atau punchline keras kepala (mis. Uco tetap beli sambil ngeles). DILARANG penutup moral ala karangan sekolah / PSA, DILARANG Uco tiba-tiba sadar dan setuju jadi baik.
- thought: pakai pose "thought" untuk monolog batin (${f.thoughts[0]}-${f.thoughts[1]} baris): pengakuan dalam hati yang DIAM, tidak terdengar tokoh lain, jadi baris berikutnya TIDAK menjawabnya. Callout-nya 2-5 kata (teks italic di gelembung).
- RITME PING-PONG: Uco dan Ocu bergantian. DILARANG 3 baris berturut-turut dari pembicara yang sama; 2 berturut-turut hanya kalau baris kedua adalah takeover stat card.
- Minimal ${MIN_INTERJECTIONS} interjeksi kilat (3-7 kata, sekitar 1-2 detik), mis. "Hah, serius lo?!", "Uap pala lo peyang!", "Bentar, bentar dulu!", diselipkan di antara baris 8-13 kata.
- layout "takeover" + statCard "ANGKA | PENJELASAN" untuk angka kunci: ${f.takeovers[0]}-${f.takeovers[1]} baris. PENJELASAN maksimal ${STAT_SUBLINE_MAX} karakter, padat (mis. "9,9 JUTA | GEN Z NEET DI INDONESIA", bukan kalimat panjang).${f.explainer ? `\n- Minimal ${f.explainer} baris sains / psikologi dengan explainerCard.` : ""}
- explainerCard: "brain-badge" HANYA kalau baris itu menyebut konsep psikologi ber-NAMA (bias konfirmasi, dopamin, sunk cost, efek Dunning-Kruger), "wave-graph" HANYA untuk data yang memang berupa grafik / tren. Poin umum tanpa konsep ber-nama: explainerCard "none".

SUARA
- Panggil Uco selalu "Uco", JANGAN PERNAH disingkat "Co" (terdengar seperti "cok").
- Baris biasa 8-13 kata, padat dan nendang; interjeksi kilat 3-7 kata. Episode tetap muat ${f.seconds} detik dengan tempo bicara natural.
- Banter Jakarta lo/gue yang tajam. DILARANG bahasa buku pelajaran / iklan layanan masyarakat ("dalam satu dekade terakhir", "zat kimiawi", "aerosol logam berat", "perlu diketahui", "oleh karena itu") kecuali sedang diejek.
- Kata serapan bahasa Inggris tulis sesuai ucapan Indonesia: "nge-hang", "eror", "nge-lag", "skrinsut", "apdet", "kepo" (bukan "hang", "error", "lag", "screenshot", "update").
- Bahasa Jakarta yang natural dan nendang: lo/gue, cepat, lucu, tajam. DILARANG bahasa baku buku pelajaran ("wajib demi investasi masa depan wajah" = salah).
- Setiap baris punya subtitle bahasa Inggris yang natural (bukan terjemahan kaku).
- Jangan pakai em dash. Jangan mengarang kutipan, studi atau testimoni. Angka harus angka nyata yang masuk akal dan umum diketahui; kalau ragu, pakai hitungan sederhana yang bisa dicek (mis. 25 ribu x 30 hari = 750 ribu).

ARAHAN VISUAL (jangan ada yang kosong)
- Setiap baris: pose, shot (solo-uco / solo-ocu untuk pembicara, closeup-punch untuk punchline, two-shot kalau keduanya bereaksi; maksimal 3 baris berurutan dengan shot sama), sfx (boleh kosong: efek suara dipasang otomatis, hanya stamp saat stat card takeover muncul dan pop saat prop baru muncul).
- callout 2-4 kata HURUF BESAR di setiap beat penekanan (hook, angka, punchline, CTA), minimal 5 baris.
- propSpecs: 2-3 objek KHUSUS episode ini (mis. untuk skincare: botol serum mahal, struk belanja). Setiap prompt: satu objek tunggal, bahasa Inggris, tanpa teks kecuali diminta. Pasang slug-nya di field prop pada baris yang membahas objek itu, termasuk baris inspecting (Ocu memeriksa objeknya). Baris thought hanya memakai prop kalau objek itu memang yang sedang dipikirkan tokoh di baris itu (mis. saldo ATM Uco, bukan kopi Ocu dari baris sebelumnya); kalau tidak, prop "none" dan gelembungnya menampilkan 2-4 kata.
- Minimal 75% baris punya sesuatu di layar selain karakter: prop, callout, explainerCard atau statCard. Jangan ada dua baris berturut-turut yang kosong.
${p.bankProps ? `- Prop lama yang boleh dipakai HANYA jika objeknya persis sama: ${p.bankProps}. Jangan pernah memakai prop yang tidak berhubungan.\n` : ""}${
    p.strict?.length
      ? `
PERCOBAAN SEBELUMNYA DITOLAK karena: ${p.strict.join("; ")}.
Perbaiki semuanya. Tulis tepat ${f.lines[0]}-${f.lines[1]} baris lengkap. Jangan memotong naskah.`
      : ""
  }`;
}

/** What a sanitized script still lacks against the Show Bible (empty = accepted). */
export function showBibleProblems(lines: ManualLine[], format: EpisodeFormat): string[] {
  const f = FORMAT_SPEC[format];
  const out: string[] = [];
  if (lines.length < f.lines[0]) out.push(`only ${lines.length} lines (needs ${f.lines[0]}-${f.lines[1]})`);
  // scheduled episodes stay 55-68 s: 13-15 tight lines, the outro included (an 82 s, 17-line draft is too long)
  if (lines.length > f.lines[1]) out.push(`${lines.length} lines (max ${f.lines[1]}, about ${f.seconds} s)`);
  const takeovers = lines.filter((l) => l.layout === "takeover").length;
  if (takeovers < f.takeovers[0]) out.push(`${takeovers} takeover stat card(s) (needs ${f.takeovers[0]}-${f.takeovers[1]})`);
  const thoughts = lines.filter((l) => l.thought_bubble).length;
  if (thoughts < f.thoughts[0]) out.push(`${thoughts} thought line(s) (needs ${f.thoughts[0]}-${f.thoughts[1]})`);
  const explainers = lines.filter((l) => l.overlay === "brain-badge" || l.overlay === "wave-graph").length;
  if (explainers < f.explainer) out.push(`no explainerCard on a science / psychology line`);
  out.push(...rhythmProblems(lines));
  const callouts = lines.filter((l) => l.kinetic_text && !l.thought_bubble).length;
  if (callouts < 5) out.push(`only ${callouts} callout(s) (needs at least 5)`);
  const last = lines.at(-1);
  if (!last || !isCtaLine(last)) out.push(`no outro CTA (FOLLOW ${CTA_HANDLE}) as the last line`);
  return out;
}

/** Rapid-fire interjections an episode needs ("Hah, serius lo?!": 3-7 words). */
export const MIN_INTERJECTIONS = 3;
/** Textbook / PSA phrasing that kills the banter. */
export const STIFF_PHRASES = /dalam (satu|sepuluh) dekade terakhir|zat kimiawi|aerosol logam berat|perlu diketahui|oleh karena itu|berdasarkan penelitian|sangat berbahaya bagi kesehatan/i;
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/**
 * The ping-pong comedy rhythm a script must have (problems; empty = fine): never 3 spoken lines in a row by one
 * speaker, and 2 in a row only when the second is a takeover stat card (a silent thought is its character's beat;
 * the outro CTA doesn't count); at least 3 rapid-fire interjections of 3-7 words; no textbook / PSA phrasing.
 */
export function rhythmProblems(lines: Pick<ManualLine, "speaker" | "text" | "layout" | "thought_bubble" | "emotion">[]): string[] {
  const out: string[] = [];
  // every beat is a turn, a silent thought included (it's that character's beat); only the outro CTA, which withCta
  // appends, doesn't count
  const turns = lines.map((l, i) => ({ l, i })).filter(({ l }) => !isCtaLine(l as ManualLine));
  for (let k = 1; k < turns.length; k++) {
    const a = turns[k - 1].l;
    const b = turns[k].l;
    if (a.speaker !== b.speaker) continue;
    const run3 = k >= 2 && turns[k - 2].l.speaker === b.speaker;
    if (run3) out.push(`3 lines in a row by ${b.speaker} (lines ${turns[k - 2].i + 1}-${turns[k].i + 1}): alternate Uco and Ocu`);
    else if (b.layout !== "takeover") out.push(`2 lines in a row by ${b.speaker} (lines ${turns[k - 1].i + 1}-${turns[k].i + 1}) without a takeover stat card`);
  }
  const quick = turns.filter(({ l }) => !l.thought_bubble && wordCount(l.text) >= 3 && wordCount(l.text) <= 7).length;
  if (quick < MIN_INTERJECTIONS) out.push(`${quick} rapid-fire interjection(s) of 3-7 words (needs at least ${MIN_INTERJECTIONS})`);
  const stiff = lines.find((l) => STIFF_PHRASES.test(l.text));
  if (stiff) out.push(`textbook phrasing: "${STIFF_PHRASES.exec(stiff.text)![0]}"`);
  return out;
}

export const isCtaLine = (l: Pick<ManualLine, "speaker" | "emotion" | "text">) => l.emotion === "cta" || /follow\s*@?uco\.?ocu/i.test(l.text);

/** Which of two attempts to keep: a passing one, else more lines, else fewer problems. */
export function betterAttempt<T extends { lines: ManualLine[]; problems: string[] }>(a: T | null, b: T): T {
  if (!a) return b;
  if (!a.problems.length !== !b.problems.length) return a.problems.length ? b : a;
  if (a.lines.length !== b.lines.length) return b.lines.length > a.lines.length ? b : a;
  return b.problems.length < a.problems.length ? b : a;
}

/** The outro CTA line, appended when Gemini's last line isn't one (the spoken half of the FOLLOW @UCO.OCU outro). */
export const CTA_LINE: ManualLine = {
  beat: "button",
  speaker: "ocu",
  text: "Follow @uco.ocu biar nggak ketipu lagi!",
  subtitle: "Follow @uco.ocu so you don't get fooled again!",
  expression: "calm",
  thought_bubble: false,
  visual: "",
  on_screen_text: null,
  kinetic_text: `FOLLOW ${CTA_HANDLE}`,
  delivery: "akrab, bersemangat",
  important_message: { kicker: "UCO & OCU", headline: `FOLLOW ${CTA_HANDLE}`, stamp: "FOLLOW +" },
  camera_shot: "solo-ocu",
  emotion: "cta",
  prop_tag: "none",
  start_s: null,
  end_s: null,
  sfx: ["ding"],
  overlay: null,
  callouts: null,
  layout: "standard",
  stat: null,
};

export function withCta(draft: ManualLine[]): ManualLine[] {
  // the handle as written ("@uco.ocu"), never spelled out ("uco titik ocu" / "uco dot ocu"), in the text the voice
  // reads (ttsText makes it "Uco Ocu") and in the English subtitle on screen
  const lines = draft.map((l) => ({ ...l, text: cleanHandle(l.text), subtitle: cleanHandle(l.subtitle) }));
  const last = lines.at(-1);
  if (last && isCtaLine(last)) return lines.map((l, i) => (i === lines.length - 1 && !l.kinetic_text ? { ...l, kinetic_text: `FOLLOW ${CTA_HANDLE}` } : l));
  return [...lines, CTA_LINE];
}

// ------------------------------------------------------------------ fresh props
export type PropSpec = { slug: string; prompt: string };
/** Added to every prop prompt: the Uco & Ocu art style on a flat white background (cut out afterwards). */
export const PROP_STYLE =
  "Single object only, bold black ink outlines, flat cel shading with one shadow tone, saturated comic colors, in the same hand-drawn comic style as the reference images, centered with generous margin, on a pure flat #FFFFFF white background, no ground shadow, no text or labels unless the description asks for them.";

const kebab = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");

/** Gemini's propSpecs → 2-3 clean specs (kebab slugs, unique, a prompt each). Anything malformed is dropped. */
export function parsePropSpecs(raw: unknown, max = 3): PropSpec[] {
  const out: PropSpec[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const o = r as { slug?: unknown; prompt?: unknown };
    const slug = kebab(String(o?.slug ?? ""));
    const prompt = String(o?.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
    if (slug.length < 3 || prompt.length < 4 || out.some((p) => p.slug === slug)) continue;
    out.push({ slug, prompt });
    if (out.length >= max) break;
  }
  return out;
}

/** The stored prop name for an episode's spec slug: unique per episode, so two episodes never overwrite each other. */
export function episodePropName(slug: string, episodeId: string): string {
  return `${kebab(slug).slice(0, 30)}-${episodeId.replace(/[^0-9a-f]/g, "").slice(0, 6)}`;
}

/** Remaps each line's prop from the spec slug to the stored name (lines naming no spec keep their tag). */
export function mapPropSlugs<L extends { prop?: string | null; prop_tag?: string | null }>(lines: L[], names: Record<string, string>): L[] {
  return lines.map((l) => {
    const tag = kebab(String(l.prop ?? l.prop_tag ?? ""));
    return names[tag] ? { ...l, prop: names[tag], prop_tag: names[tag] } : l;
  });
}

/** A line's prop becomes "none" when its generated image failed (never an unrelated stand-in). */
export function dropProp<L extends { prop_tag: string | null }>(lines: L[], name: string): L[] {
  return lines.map((l) => (l.prop_tag === name ? { ...l, prop_tag: "none" } : l));
}

export { cleanCalloutText };
