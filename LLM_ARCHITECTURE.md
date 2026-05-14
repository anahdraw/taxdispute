# Diagram Arsitektur LLM Tax Dispute Prototype

Dokumen ini menggambarkan alur LLM dari input dokumen/perkara sampai analisis akhir, rekomendasi WP, dan export dokumen.

## Flow Utama

```mermaid
flowchart TD
    A["User Input"] --> A1["Upload PDF putusan / surat banding / dokumen pendukung"]
    A --> A2["Form manual kasus WP"]
    A --> A3["Refresh / unduh peraturan PPN dari Ortax"]

    A1 --> B["Document Intake"]
    B --> B1["Simpan file ke uploads/"]
    B1 --> B2["Ekstraksi text layer dengan pypdf / pdftotext"]
    B2 --> B3{"Text cukup?"}

    B3 -- "Ya" --> C1["LLM Text Extraction"]
    B3 -- "Tidak / scan PDF" --> C2["Render halaman PDF dengan pdftoppm"]
    C2 --> C3["LLM Vision Extraction"]

    C1 --> D["Structured JSON Extraction"]
    C3 --> D
    D --> D1["Normalisasi field"]
    D1 --> D2["Validasi nomor putusan duplikat"]
    D2 --> D3["Simpan ke database SQLite"]

    D3 --> E1["documents"]
    D3 --> E2["document_extractions"]
    D3 --> E3["llm_labels"]
    D3 --> E4["chunks"]

    A3 --> F["Regulation Connector"]
    F --> F1["Ambil / simpan peraturan PPN"]
    F1 --> F2["regulations + regulation_chunks"]

    A2 --> G["Analysis Intake"]
    D3 --> G
    G --> H["Retrieval Layer"]
    H --> H1["Cari putusan pembanding lokal"]
    H --> H2["Cari peraturan PPN terkait"]

    H1 --> I["Scoring & Risk Engine"]
    H2 --> I
    G --> I
    I --> I1["Similarity score"]
    I --> I2["Evidence score"]
    I --> I3["Outcome distribution"]
    I --> I4["Faktor pendukung, risiko, celah bukti"]

    I --> J{"Gunakan LLM untuk draft mendalam?"}
    J -- "Tidak" --> K1["Template recommendation draft"]
    J -- "Ya" --> K2["LLM Synthesis"]
    K2 --> K3["Draft rekomendasi WP + analisis peraturan + pembanding"]
    K1 --> L["Final Analysis Result"]
    K3 --> L

    L --> M1["UI tabs: Review Risiko"]
    L --> M2["UI tabs: Draft Rekomendasi"]
    L --> M3["UI tabs: Putusan Pembanding"]
    L --> M4["UI tabs: Peraturan Terkait"]
    L --> N["analysis_reports"]
    N --> O["Export Markdown / Word DOCX / PDF"]
```

## Sequence LLM

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant UI as Streamlit App
    participant EXT as Extraction Engine
    participant OCR as PDF Render/OCR Path
    participant LLM as OpenAI LLM
    participant DB as SQLite DB
    participant RET as Retrieval Engine
    participant AN as Analysis Engine
    participant OUT as Report Exporter

    U->>UI: Upload dokumen atau pilih dokumen terindeks
    UI->>EXT: upsert_document()
    EXT->>EXT: baca text layer PDF
    alt PDF punya text layer cukup
        EXT->>LLM: prompt ekstraksi berbasis teks
    else PDF scan / teks minim
        EXT->>OCR: render halaman awal, tengah, akhir
        OCR-->>EXT: image data URLs
        EXT->>LLM: prompt ekstraksi berbasis vision
    end
    LLM-->>EXT: JSON field ekstraksi
    EXT->>EXT: normalisasi + validasi nomor putusan duplikat
    EXT->>DB: simpan documents, document_extractions, llm_labels, chunks
    DB-->>UI: field ekstraksi siap tampil

    U->>UI: Jalankan analisis kasus WP
    UI->>RET: cari putusan pembanding dan peraturan PPN
    RET->>DB: query documents + regulations
    DB-->>RET: kandidat relevan
    RET-->>AN: konteks pembanding + peraturan
    AN->>AN: scoring, confidence, evidence score, risk review
    opt Draft rekomendasi mendalam
        AN->>LLM: konteks input + pembanding + peraturan + scoring
        LLM-->>AN: draft rekomendasi final
    end
    AN-->>UI: hasil analisis akhir
    UI->>DB: save_report()
    U->>OUT: download DOCX / PDF / Markdown
```

## Komponen LLM

| Tahap | Fungsi LLM | Input utama | Output |
|---|---|---|---|
| Ekstraksi teks | Membaca putusan yang punya text layer | Potongan header, pokok sengketa, posisi WP/DJP, pertimbangan, amar | JSON ekstraksi terstruktur |
| Ekstraksi vision | Membaca PDF scan | Gambar halaman awal, tengah, akhir | JSON ekstraksi terstruktur |
| Labeling | Klasifikasi pajak, isu, outcome, pihak, nilai sengketa | Teks/gambar dokumen | Metadata + ringkasan analitis |
| Rekomendasi | Menyusun rekomendasi untuk WP | Input kasus, putusan pembanding, peraturan PPN, scoring | Draft rekomendasi mendalam |
| Chat peraturan | Menjawab pertanyaan aturan | Query user + hasil pencarian aturan | Jawaban aturan + lokasi/sumber aturan |

## Data yang Disimpan

| Tabel | Peran |
|---|---|
| `documents` | Metadata dokumen, text layer, status ekstraksi, hasil utama |
| `document_extractions` | Field ekstraksi lengkap sesuai kelompok metadata, objek sengketa, pihak, pokok sengketa, argumen, pertimbangan, outcome |
| `llm_labels` | Raw hasil labeling LLM dan confidence |
| `chunks` | Potongan teks dokumen untuk pencarian pembanding |
| `tax_regulations` / regulation tables | Peraturan PPN dari Ortax dan chunk pencarian |
| `analysis_reports` | Hasil analisis akhir yang dapat dibuka ulang dan diekspor |

## Guardrail Saat Ini

- Dokumen duplikat ditolak berdasarkan nomor putusan yang sudah berhasil diekstrak.
- Jika PDF scan tidak punya text layer, sistem memakai jalur LLM vision.
- Jika LLM gagal membaca PDF scan, UI menampilkan error eksplisit.
- Draft rekomendasi bersifat indikatif dan perlu review ahli pajak/kuasa hukum.
- Nomor putusan, pasal, nama pihak, dan fakta baru tidak boleh dikarang oleh prompt LLM.

## Output Akhir

Hasil analisis akhir terdiri dari:

1. skor indikatif dan confidence,
2. review risiko,
3. faktor pendukung,
4. faktor risiko,
5. celah bukti,
6. putusan pembanding,
7. peraturan PPN terkait,
8. draft rekomendasi WP,
9. dokumen unduhan `DOCX`, `PDF`, dan `Markdown`.
