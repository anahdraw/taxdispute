import { regulations, type Regulation } from "./mock-data";

export type RegulationTopic = "vat" | "transfer_pricing" | "general";

export const regulationTopicOptions: Array<{ key: RegulationTopic; id: string; en: string }> = [
  { key: "transfer_pricing", id: "Transfer Pricing", en: "Transfer Pricing" },
  { key: "vat", id: "PPN / VAT", en: "VAT / PPN" },
  { key: "general", id: "Umum", en: "General" }
];

export function normalizeRegulationTopic(value: string | undefined | null): RegulationTopic {
  const topic = String(value || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (["transfer_pricing", "tp", "transfer", "harga_transfer", "hubungan_istimewa"].includes(topic)) {
    return "transfer_pricing";
  }
  if (["vat", "ppn", "pajak_pertambahan_nilai"].includes(topic)) {
    return "vat";
  }
  return "general";
}

export function regulationTopicLabel(topic: RegulationTopic, language: "id" | "en") {
  return regulationTopicOptions.find((item) => item.key === topic)?.[language] || topic;
}

export function mergeRegulationRecords(records: Regulation[]) {
  const merged = new Map<string, Regulation>();
  for (const item of [...regulations, ...records]) {
    merged.set(item.id, {
      ...item,
      topic: item.topic || normalizeRegulationTopic(item.topic),
      source: item.source || "seed",
      relevance: item.relevance || 70
    });
  }
  return Array.from(merged.values()).sort((a, b) => {
    const topicOrder = String(a.topic || "").localeCompare(String(b.topic || ""));
    return topicOrder || (b.relevance || 0) - (a.relevance || 0);
  });
}

export function filterRegulationsByTopic(records: Regulation[], topic: RegulationTopic | "all") {
  if (topic === "all") return records;
  return records.filter((item) => (item.topic || "general") === topic);
}

export function buildOrtaxRegulationSeeds(topicValue: string): Regulation[] {
  const topic = normalizeRegulationTopic(topicValue);
  const now = new Date().toISOString();
  if (topic === "transfer_pricing") {
    return [
      {
        id: "ortax-pmk-172-transfer-pricing",
        topic,
        title: "Penerapan Prinsip Kewajaran dan Kelaziman Usaha",
        citation: "PMK No. 172 Tahun 2023",
        focus:
          "Kerangka utama transfer pricing: hubungan istimewa, penerapan prinsip kewajaran dan kelaziman usaha, analisis kesebandingan, metode transfer pricing, dokumentasi, secondary adjustment, APA, dan MAP.",
        relevance: 98,
        source: "ortax",
        sourceUrl: "https://datacenter.ortax.org/ortax/aturan/show/25467",
        content:
          "Gunakan sebagai rujukan utama untuk sengketa transfer pricing modern, terutama ketika isu berkaitan dengan hubungan istimewa, metode pembanding, kewajaran margin, dokumentasi, dan pembuktian substansi transaksi.",
        updatedAt: now
      },
      {
        id: "ortax-pmk-213-tp-doc",
        topic,
        title: "Jenis Dokumen dan/atau Informasi Tambahan yang Wajib Disimpan oleh Wajib Pajak yang Melakukan Transaksi dengan Pihak Afiliasi",
        citation: "PMK No. 213/PMK.03/2016",
        focus:
          "Kewajiban dokumentasi transfer pricing, termasuk master file, local file, dan country-by-country report untuk WP dengan transaksi afiliasi.",
        relevance: 92,
        source: "ortax",
        sourceUrl: "https://datacenter.ortax.org/",
        content:
          "Pakai untuk mengecek kesiapan dokumen TP, ambang batas, waktu penyediaan dokumen, dan risiko ketika dokumentasi tidak lengkap pada proses pemeriksaan atau sengketa.",
        updatedAt: now
      },
      {
        id: "ortax-per-22-tp-audit",
        topic,
        title: "Pedoman Pemeriksaan terhadap Wajib Pajak yang Mempunyai Hubungan Istimewa",
        citation: "PER-22/PJ/2013",
        focus:
          "Pedoman pemeriksaan TP: identifikasi transaksi afiliasi, analisis fungsi/aset/risiko, pemilihan metode, pembanding, tested party, dan dokumentasi pendukung.",
        relevance: 90,
        source: "ortax",
        sourceUrl: "https://datacenter.ortax.org/",
        content:
          "Berguna untuk memahami cara DJP membangun koreksi TP dan bukti apa yang biasanya diuji dalam sengketa, seperti FAR analysis, benchmarking, dan rekonsiliasi transaksi afiliasi.",
        updatedAt: now
      },
      {
        id: "ortax-per-32-alp",
        topic,
        title: "Penerapan Prinsip Kewajaran dan Kelaziman Usaha dalam Transaksi antara Wajib Pajak dengan Pihak yang Mempunyai Hubungan Istimewa",
        citation: "PER-32/PJ/2011",
        focus:
          "Panduan operasional penerapan arm's length principle, faktor kesebandingan, metode CUP/RPM/CPM/TNMM/Profit Split, dan dokumentasi analisis.",
        relevance: 84,
        source: "ortax",
        sourceUrl: "https://datacenter.ortax.org/ortax?id=14855&mod=aturan",
        content:
          "Tetap berguna untuk perkara tahun pajak lama atau analisis historis, sambil memeriksa apakah ketentuan terbaru sudah menggantikannya untuk masa pajak terkait.",
        updatedAt: now
      },
      {
        id: "ortax-pmk-22-apa",
        topic,
        title: "Tata Cara Pelaksanaan Kesepakatan Harga Transfer",
        citation: "PMK No. 22/PMK.03/2020",
        focus:
          "Prosedur Advance Pricing Agreement untuk mitigasi risiko transfer pricing ke depan dan referensi pendekatan penyelesaian sengketa.",
        relevance: 78,
        source: "ortax",
        sourceUrl: "https://datacenter.ortax.org/",
        content:
          "Gunakan sebagai konteks tambahan jika rekomendasi sengketa juga membutuhkan strategi pencegahan koreksi berulang melalui APA.",
        updatedAt: now
      }
    ];
  }

  if (topic === "vat") {
    return [
      {
        id: "ortax-uu-ppn",
        topic,
        title: "Undang-Undang Pajak Pertambahan Nilai",
        citation: "UU No. 8 Tahun 1983 sebagaimana diubah terakhir",
        focus:
          "Dasar objek PPN, penyerahan BKP/JKP, DPP, saat terutang, pengkreditan Pajak Masukan, dan dokumentasi formal.",
        relevance: 96,
        source: "ortax",
        sourceUrl: "https://datacenter.ortax.org/",
        content:
          "Rujukan utama untuk menilai apakah transaksi merupakan objek PPN, apakah pajak masukan dapat dikreditkan, dan apakah koreksi DJP menyasar elemen material atau formal.",
        updatedAt: now
      },
      {
        id: "ortax-pp-44-2022",
        topic,
        title: "Penerapan terhadap Pajak Pertambahan Nilai Barang dan Jasa dan Pajak Penjualan atas Barang Mewah",
        citation: "PP No. 44 Tahun 2022",
        focus:
          "Aturan pelaksanaan PPN setelah UU HPP, termasuk perlakuan transaksi, DPP, objek pajak, dan waktu terutang.",
        relevance: 88,
        source: "ortax",
        sourceUrl: "https://datacenter.ortax.org/ortax/aturan/show/26049",
        content:
          "Gunakan untuk memperkuat analisis teknis PPN ketika sengketa berkaitan dengan klasifikasi penyerahan, DPP, atau saat terutang.",
        updatedAt: now
      },
      {
        id: "ortax-per-faktur-ppn",
        topic,
        title: "Ketentuan Faktur Pajak",
        citation: "Peraturan Direktur Jenderal Pajak tentang Faktur Pajak",
        focus:
          "Validitas faktur pajak, penggantian/pembetulan faktur, administrasi faktur, dan pembuktian formal Pajak Masukan.",
        relevance: 82,
        source: "ortax",
        sourceUrl: "https://datacenter.ortax.org/",
        content:
          "Pakai untuk sengketa yang menilai apakah bukti faktur pajak cukup kuat, cacat formal bisa diperbaiki, atau perlu ditopang bukti material transaksi.",
        updatedAt: now
      }
    ];
  }

  return [
    {
      id: `ortax-general-${Date.now()}`,
      topic,
      title: "Ortax Tax Regulation Search",
      citation: "Ortax Data Center",
      focus: "General Indonesian tax regulation reference selected by topic.",
      relevance: 70,
      source: "ortax",
      sourceUrl: "https://datacenter.ortax.org/",
      content: "Use the Ortax Data Center source as a starting point, then add specific regulation cards manually when the exact regulation is identified.",
      updatedAt: now
    }
  ];
}

export function chooseRegulationContext(records: Regulation[], question: string, topic?: string) {
  const normalizedTopic = normalizeRegulationTopic(topic);
  const text = question.toLowerCase();
  const inferredTopic =
    /transfer|pricing|afiliasi|hubungan istimewa|arm.?s length|kewajaran|kelaziman|benchmark|pembanding/i.test(text)
      ? "transfer_pricing"
      : /ppn|vat|pajak masukan|faktur|dpp|bkp|jkp/i.test(text)
        ? "vat"
        : normalizedTopic;
  const topicMatches = records.filter((item) => (item.topic || "general") === inferredTopic);
  const selected = topicMatches.length ? topicMatches : records;
  return selected.slice(0, 8);
}
