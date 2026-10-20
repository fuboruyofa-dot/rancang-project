// Supabase Edge Function: generate-proposal
// Menulis / merapikan teks proposal (Executive Summary, Background) memakai AI,
// berdasarkan data fix project di proposals.source_snapshot.
//
// Penyedia AI (dipilih otomatis dari secret yang tersedia):
//   1. GEMINI_API_KEY     -> Google Gemini (ada free tier)
//   2. ANTHROPIC_API_KEY  -> Claude (berbayar)
// Opsional:
//   GEMINI_MODEL     default: gemini-3.8-flash
//   GEMINI_THINKING  minimal | low | medium | high (default: low, khusus Gemini 3.x)
//   ANTHROPIC_MODEL  mis. claude-sonnet-5-5
//
// Deploy ulang setelah mengganti kode ini. Menambah/mengubah secret tidak perlu deploy ulang.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `Anda adalah penulis dokumen teknis untuk tim R&D sebuah perusahaan manufaktur di Indonesia.
Tulis dalam Bahasa Indonesia yang formal, ringkas, dan jelas.
Gunakan HANYA fakta yang ada pada data yang diberikan. Jangan mengarang angka, nama, spesifikasi, atau tanggal.
Jika suatu informasi tidak ada pada data, jangan disebutkan.
Keluarkan teks polos tanpa markdown dan tanpa judul. Pisahkan paragraf dengan satu baris kosong.
Gunakan awalan "- " hanya bila daftar memang diperlukan.`;

const TASKS: Record<string, string> = {
  executive_summary:
    "Tulis Executive Summary sebanyak 3 sampai 5 paragraf singkat (sekitar 150-250 kata). Cakup: latar masalah, tujuan, ringkasan rancangan teknis, anggaran (sebutkan sistem terpilih dan alternatif bila ada), jadwal pelaksanaan, dan parameter keberhasilan.",
  background:
    "Tulis bagian Background and Analysis yang mengalir: masalah yang dihadapi, tujuan project, dan rangkuman kajian tambahan yang tersedia (feasibility study, pilot project, dan sejenisnya).",
  design_parameter:
    "Tulis paragraf pengantar singkat (2-3 kalimat) untuk bagian Design Parameters yang merangkum dasar rancangan teknis: persyaratan, batasan, fitur, serta kategori dokumen dan komponen yang tersedia. Jangan mengulang seluruh daftar.",
  timeline:
    "Tulis satu paragraf ringkas tentang jadwal: total durasi, kelompok kegiatan, dan bagaimana kemajuan dipantau melalui kurva S. Jangan membuat tabel.",
  deliverables:
    "Tulis satu sampai dua paragraf pengantar tentang keluaran project dan anggaran: jelaskan alternatif sistem, total biaya tiap sistem, dan sistem terpilih bila ada. Jangan membuat tabel.",
};

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const GEMINI_DEFAULT = "gemini-3.8-flash";
const GEMINI_FALLBACKS = ["gemini-3-flash", "gemini-2.5-flash"];

// Gemini 3.x memakai thinkingLevel; Gemini 2.5 memakai thinkingBudget.
function generationConfig(model: string, withThinking: boolean) {
  const cfg: Record<string, unknown> = { maxOutputTokens: 8192 };
  if (model.startsWith("gemini-3")) {
    // temperature dibiarkan default (disarankan Google untuk Gemini 3)
    if (withThinking) cfg.thinkingConfig = { thinkingLevel: Deno.env.get("GEMINI_THINKING") ?? "low" };
  } else {
    cfg.temperature = 0.4;
    if (withThinking) cfg.thinkingConfig = { thinkingBudget: 0 };
  }
  return cfg;
}

async function geminiRequest(key: string, model: string, user: string, withThinking: boolean) {
  return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: generationConfig(model, withThinking),
    }),
  });
}

async function callGemini(key: string, user: string): Promise<string> {
  const primary = Deno.env.get("GEMINI_MODEL") ?? GEMINI_DEFAULT;
  const models = [primary, ...[GEMINI_DEFAULT, ...GEMINI_FALLBACKS].filter((m) => m !== primary)];
  const errors: string[] = [];

  for (const model of models) {
    let r = await geminiRequest(key, model, user, true);
    let body = r.ok ? "" : await r.text();

    // Jika parameter thinking ditolak, ulangi tanpa thinkingConfig
    if (r.status === 400 && /thinking/i.test(body)) {
      r = await geminiRequest(key, model, user, false);
      body = r.ok ? "" : await r.text();
    }

    // Model tidak ada / kuota habis / server sibuk -> coba model berikutnya
    if ([404, 429, 503].includes(r.status)) {
      errors.push(`${model}: ${r.status} ${body.slice(0, 200)}`);
      continue;
    }
    if (!r.ok) throw new ApiError(502, `Gemini error ${r.status} (${model}): ${body}`);

    const out = await r.json();
    const text = (out.candidates?.[0]?.content?.parts ?? [])
      .filter((p: { thought?: boolean }) => !p.thought)
      .map((p: { text?: string }) => p.text ?? "")
      .join("").trim();
    if (!text) {
      throw new ApiError(
        502,
        `Gemini tidak mengembalikan teks (${model}): ${out.candidates?.[0]?.finishReason ?? out.promptFeedback?.blockReason ?? "alasan tidak diketahui"}`,
      );
    }
    return text;
  }
  throw new ApiError(502, `Semua model Gemini gagal. ${errors.join(" | ")}`);
}

async function callClaude(key: string, user: string): Promise<string> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5-5",
      max_tokens: 1500,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new ApiError(502, `Claude error ${r.status}: ${await r.text()}`);
  const out = await r.json();
  const text = (out.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n").trim();
  if (!text) throw new ApiError(502, "Respons kosong dari Claude");
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { proposal_id, section = "executive_summary", draft } = await req.json();
    if (!proposal_id) return json({ error: "proposal_id wajib diisi" }, 400);

    const geminiKey = Deno.env.get("GEMINI_API_KEY"), claudeKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!geminiKey && !claudeKey) return json({ error: "Belum ada API key. Isi secret GEMINI_API_KEY (gratis) atau ANTHROPIC_API_KEY." }, 500);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Tidak terautentikasi" }, 401);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: pr, error } = await sb.from("proposals").select("title, source_snapshot").eq("id", proposal_id).single();
    if (error || !pr) return json({ error: "Proposal tidak ditemukan atau Anda tidak punya akses" }, 404);

    const { images: _images, ...snap } = (pr.source_snapshot ?? {}) as Record<string, unknown>; // katalog gambar tidak relevan untuk teks
    const task = TASKS[section] ?? "Rapikan teks draft berikut menjadi paragraf formal tanpa menambah fakta baru.";
    const user = `${task}\n\nDATA PROJECT (JSON):\n${JSON.stringify(snap)}` +
      (draft ? `\n\nDRAFT SAAT INI (perbaiki gaya dan alurnya, jangan menambah fakta baru):\n${draft}` : "");

    const text = geminiKey ? await callGemini(geminiKey, user) : await callClaude(claudeKey!, user);
    return json({ text });
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    return json({ error: String(e) }, 500);
  }
});
