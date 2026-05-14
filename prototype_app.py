import base64
import html
import re
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

from tax_dispute_core import (
    DEFAULT_DB_PATH,
    DuplicateDocumentError,
    ExtractionError,
    OUTCOME_LABELS,
    OUTCOME_LABELS_EN,
    analyze_case,
    batch_label_documents_with_llm,
    build_intake_from_document,
    call_openai_text,
    export_report_docx,
    export_report_markdown,
    export_report_pdf,
    find_pdfs,
    find_similar_cases,
    get_dashboard_metrics,
    get_document_extraction,
    get_report,
    get_stats,
    label_document_with_llm,
    init_db,
    list_documents,
    list_llm_labels,
    list_reports,
    load_local_env,
    save_report,
    search_cases,
    upsert_document,
)
from tax_regulation_connector import (
    download_ppn_seed_regulations,
    fetch_and_store_ortax_regulation,
    get_regulation_stats,
    init_regulation_db,
    list_regulations,
    refresh_ortax_regulations,
    search_regulations,
)


ROOT_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = ROOT_DIR / "uploads"
LOGO_PATH = ROOT_DIR / "assets" / "rsm_logo.svg"

TAX_OPTIONS = ["PPN", "PPh Badan", "PPh 21", "PPh 23", "PPh 26", "PBB", "Lainnya"]
ISSUE_OPTIONS = ["DPP PPN", "Pajak Masukan", "Faktur Pajak", "PKPM / Konfirmasi", "Sanksi", "Formal", "PPh", "Lainnya"]
STAGE_OPTIONS = ["SPHP", "SKP", "Keberatan", "Banding", "Bantahan", "Gugatan"]
EVIDENCE_OPTIONS = [
    "Faktur Pajak",
    "SPT Masa PPN",
    "SPT Pembetulan",
    "Invoice",
    "Kontrak",
    "Purchase Order",
    "Delivery Order / Surat Jalan",
    "Bukti Pembayaran",
    "Rekening Koran",
    "Rekonsiliasi",
    "Konfirmasi Lawan Transaksi",
    "SKP/STP",
    "KEP Keberatan",
    "Surat Kuasa",
    "Bukti Pengiriman",
]
DOCUMENT_TYPE_OPTIONS = {
    "Putusan Pengadilan Pajak": "putusan_pengadilan",
    "Surat Banding": "surat_banding",
    "Surat Keberatan": "surat_keberatan",
    "Jawaban SPHP": "jawaban_sphp",
    "Uraian Banding": "uraian_banding",
    "Surat Bantahan": "bantahan",
    "Dokumen Pendukung": "dokumen_pendukung",
}

USER_PAGES = [
    "Dashboard",
    "Alur Terpandu",
    "Analisis Kasus WP",
    "Peraturan",
    "Reports",
]

ADMIN_PAGES = [
    "Search Putusan",
    "Ingest & Ekstraksi",
    "LLM Extraction",
    "Kebutuhan Prototype",
]

APP_PAGES = USER_PAGES + ADMIN_PAGES

LANGUAGE_OPTIONS = {
    "id": "Bahasa Indonesia",
    "en": "English",
}

REPORT_LANGUAGE_OPTIONS = LANGUAGE_OPTIONS.copy()

PAGE_LABELS = {
    "Dashboard": {"id": "Dashboard", "en": "Dashboard"},
    "Alur Terpandu": {"id": "Alur Terpandu", "en": "Guided Flow"},
    "Analisis Kasus WP": {"id": "Analisis Kasus WP", "en": "Taxpayer Case Analysis"},
    "Peraturan": {"id": "Peraturan", "en": "Regulations"},
    "Reports": {"id": "Reports", "en": "Reports"},
    "Search Putusan": {"id": "Search Putusan", "en": "Decision Search"},
    "Ingest & Ekstraksi": {"id": "Ingest & Ekstraksi", "en": "Ingest & Extraction"},
    "LLM Extraction": {"id": "LLM Extraction", "en": "LLM Extraction"},
    "Kebutuhan Prototype": {"id": "Kebutuhan Prototype", "en": "Prototype Requirements"},
}

UI_TEXT = {
    "app_caption": {
        "id": "Ekstraksi dokumen, pembanding putusan, aturan PPN, dan rekomendasi WP.",
        "en": "Document extraction, comparable decisions, VAT regulations, and taxpayer recommendations.",
    },
    "interface_language": {"id": "Bahasa tampilan", "en": "Interface language"},
    "admin_toggle": {"id": "Tampilkan menu admin/data", "en": "Show admin/data menu"},
    "admin_help": {
        "id": "Aktifkan untuk ingest data, labeling LLM batch, pencarian teknis, dan halaman kebutuhan prototype.",
        "en": "Enable ingestion, batch LLM labeling, technical search, and prototype requirements pages.",
    },
    "menu": {"id": "Menu", "en": "Menu"},
    "admin_active": {"id": "Mode admin/data aktif.", "en": "Admin/data mode is active."},
    "admin_hidden": {
        "id": "Menu admin disembunyikan agar alur kerja utama lebih ringkas.",
        "en": "Admin menu is hidden to keep the primary workflow focused.",
    },
    "indexed_decisions": {"id": "Putusan terindeks", "en": "Indexed decisions"},
    "extraction_details": {"id": "Detail ekstraksi", "en": "Extraction details"},
    "regulations": {"id": "Peraturan", "en": "Regulations"},
    "dashboard_subtitle": {
        "id": "Prototype lokal untuk membaca dokumen sengketa, mencari pembanding, menghubungkan aturan PPN, dan menyusun rekomendasi untuk Wajib Pajak.",
        "en": "A local prototype for reading tax dispute documents, finding comparable decisions, connecting VAT rules, and preparing taxpayer recommendations.",
    },
    "start_guided": {"id": "Mulai Alur Terpandu", "en": "Start Guided Flow"},
    "case_analysis": {"id": "Analisis Kasus", "en": "Case Analysis"},
    "ask_regulations": {"id": "Tanya Peraturan", "en": "Ask Regulations"},
    "view_reports": {"id": "Lihat Reports", "en": "View Reports"},
    "data_summary": {"id": "Ringkasan Data", "en": "Data Summary"},
    "data_visualization": {"id": "Visualisasi Data", "en": "Data Visualization"},
    "report_language": {"id": "Bahasa report", "en": "Report language"},
    "guided_title": {"id": "Alur Terpandu", "en": "Guided Flow"},
    "guided_intro": {
        "id": "Alur ini dibuat untuk demo end-to-end: upload/ekstrak dokumen, label dengan LLM, auto-isi parameter kasus, cari pembanding, lalu buat review dan rekomendasi WP.",
        "en": "This flow demonstrates the end-to-end workflow: upload/extract a document, label it with LLM, auto-fill case parameters, find comparable decisions, then prepare a review and taxpayer recommendation.",
    },
    "manual_title": {"id": "Analisis Kasus WP", "en": "Taxpayer Case Analysis"},
    "manual_intro": {
        "id": "Isi ringkasan kasus WP. Prototype akan mencari putusan pembanding, memberi indikasi peluang, review risiko, dan draft rekomendasi sederhana.",
        "en": "Enter the taxpayer case summary. The prototype will search comparable decisions, provide an indicative assessment, risk review, and recommendation draft.",
    },
    "review_tab": {"id": "Review Risiko", "en": "Risk Review"},
    "recommendation_tab": {"id": "Draft Rekomendasi", "en": "Recommendation Draft"},
    "comparable_tab": {"id": "Putusan Pembanding", "en": "Comparable Decisions"},
    "regulation_tab": {"id": "Peraturan Terkait", "en": "Related Regulations"},
    "top_related_cases": {"id": "Putusan Paling Terkait", "en": "Most Relevant Decisions"},
    "other_comparables": {"id": "Lihat daftar pembanding lain", "en": "View other comparable decisions"},
    "score": {"id": "Score", "en": "Score"},
    "confidence": {"id": "Confidence", "en": "Confidence"},
    "similar_cases": {"id": "Putusan pembanding", "en": "Comparable decisions"},
    "evidence_score": {"id": "Evidence score", "en": "Evidence score"},
    "indication": {"id": "Indikasi", "en": "Indication"},
    "llm_deepened": {
        "id": "Draft ini sudah diperdalam dengan LLM dan digabung langsung ke rekomendasi.",
        "en": "This draft has been deepened with LLM and merged directly into the recommendation.",
    },
    "reports_title": {"id": "Reports", "en": "Reports"},
    "summary": {"id": "Ringkasan", "en": "Summary"},
    "recommendation_draft": {"id": "Draft Rekomendasi", "en": "Recommendation Draft"},
}

FIELD_LABELS = {
    "document_type": "Jenis dokumen",
    "putusan_number": "Nomor putusan",
    "putusan_year": "Tahun putusan",
    "court_panel": "Majelis",
    "judge_names": "Hakim / anggota majelis",
    "procedure_type": "Jenis acara",
    "examination_level": "Tingkat pemeriksaan",
    "case_file_number": "Nomor berkas",
    "decision_date": "Tanggal putusan",
    "tax_type": "Jenis pajak",
    "tax_period": "Masa pajak",
    "skp_number": "Nomor SKP/STP/SKPLB",
    "djp_decision_number": "Nomor keputusan DJP/keberatan",
    "wp_claim_amount": "Nilai menurut WP",
    "djp_claim_amount": "Nilai menurut DJP",
    "taxpayer_name": "Nama WP",
    "taxpayer_npwp": "NPWP",
    "taxpayer_address": "Alamat WP",
    "representative_name": "Wakil/pengurus",
    "legal_counsel_name": "Kuasa hukum/konsultan",
    "legal_counsel_license": "Izin kuasa",
    "appellee_name": "Terbanding",
    "djp_unit": "Unit DJP/KPP",
    "issue_type": "Tipe isu",
    "issue_subtype": "Subtipe isu",
    "amount_disputed": "Nilai sengketa",
    "correction_object": "Objek koreksi",
    "correction_reason": "Alasan koreksi",
    "wp_rebuttal_reason": "Alasan bantahan WP",
    "issue_summary": "Ringkasan sengketa",
    "wp_position_summary": "Posisi WP",
    "djp_position_summary": "Posisi DJP",
    "legal_references_summary": "Dasar hukum dikutip",
    "evidence_summary": "Ringkasan bukti",
    "evidence_submitted": "Bukti yang diajukan",
    "court_reasoning_summary": "Pertimbangan majelis",
    "accepted_arguments": "Argumen diterima",
    "rejected_arguments": "Argumen ditolak",
    "sufficient_evidence_summary": "Bukti dinilai cukup",
    "insufficient_evidence_summary": "Bukti dinilai belum cukup",
    "verdict_text": "Amar putusan",
    "per_issue_outcome": "Hasil per isu",
    "tax_before_amount": "Pajak sebelum putusan",
    "tax_after_amount": "Pajak setelah putusan",
    "correction_reduction_amount": "Pengurangan koreksi",
    "sanctions_amount": "Sanksi",
    "outcome": "Outcome",
    "success_level": "Tingkat keberhasilan",
}

MONEY_FIELDS = {
    "amount_disputed",
    "wp_claim_amount",
    "djp_claim_amount",
    "tax_before_amount",
    "tax_after_amount",
    "correction_reduction_amount",
    "sanctions_amount",
}

RSM_BLUE = "#009CDE"
RSM_GREEN = "#43A047"
RSM_GRAY = "#54585A"
RSM_MID_GRAY = "#8A8F93"
RSM_LIGHT_BLUE = "#66C7EE"
RSM_LIGHT_GREEN = "#8BC34A"
RSM_NAVY = "#004F71"
RSM_PALETTE = [RSM_BLUE, RSM_GREEN, RSM_GRAY, RSM_MID_GRAY, RSM_LIGHT_BLUE, RSM_LIGHT_GREEN, RSM_NAVY, "#B7BDC3"]
DOCUMENT_TYPE_LABELS = {value: key for key, value in DOCUMENT_TYPE_OPTIONS.items()}
DOCUMENT_TYPE_LABELS_EN = {
    "putusan_pengadilan": "Tax Court decision",
    "surat_banding": "Appeal letter",
    "surat_keberatan": "Objection letter",
    "jawaban_sphp": "SPHP response",
    "uraian_banding": "Statement of appeal",
    "bantahan": "Rebuttal letter",
    "dokumen_pendukung": "Supporting document",
}
TAX_TYPE_LABELS_EN = {
    "PPN": "VAT",
    "PPh Badan": "Corporate income tax",
    "PPh 21": "Article 21 income tax",
    "PPh 23": "Article 23 income tax",
    "PPh 26": "Article 26 income tax",
    "PBB": "Land and building tax",
    "Lainnya": "Other",
    "UNKNOWN": "Not detected",
}
ISSUE_TYPE_LABELS_EN = {
    "DPP_PPN": "VAT tax base",
    "DPP PPN": "VAT tax base",
    "PAJAK_MASUKAN": "Input VAT",
    "Pajak Masukan": "Input VAT",
    "FAKTUR_PAJAK": "VAT invoice",
    "Faktur Pajak": "VAT invoice",
    "PKPM_KONFIRMASI": "Counterparty confirmation",
    "PKPM / Konfirmasi": "Counterparty confirmation",
    "SANKSI": "Penalty",
    "Sanksi": "Penalty",
    "FORMAL": "Formal",
    "Formal": "Formal",
    "PPh": "Income tax",
    "Pph": "Income tax",
    "Lainnya": "Other",
    "LAINNYA": "Other",
    "UNKNOWN": "Not detected",
}
REGULATION_TYPE_LABELS_EN = {
    "UU": "Law",
    "PP": "Government regulation",
    "PMK": "Minister of Finance regulation",
    "PER": "DGT regulation",
    "SE": "DGT circular",
    "KMK": "Minister of Finance decree",
    "KEP": "DGT decree",
    "UNKNOWN": "Not detected",
}
ANALYSIS_TITLE_LABELS_EN = {
    "spt masa ppn": "VAT return",
    "bukti pembayaran": "Payment evidence",
    "dokumen pendukung": "Supporting documents",
    "faktur pajak": "VAT invoice",
    "rekonsiliasi": "Reconciliation",
    "konfirmasi lawan transaksi": "Counterparty confirmation",
    "skp/stp": "Tax assessment letter",
    "kep keberatan": "Objection decision",
    "sudah dilaporkan": "Reported position",
    "memenuhi syarat formal": "Formal requirements met",
    "memenuhi syarat material": "Substantive requirements met",
    "koreksi tidak dapat dipertahankan": "Correction may not be sustainable",
    "tidak dapat menunjukkan": "Missing evidence",
    "tidak dapat meyakini": "Insufficient substantiation",
    "jawaban kpp penjual tidak ada": "Seller tax office confirmation unavailable",
    "tidak memberikan alasan": "Reasoning not sufficiently explained",
    "bukti pendukung lainnya tidak ada": "Other supporting evidence unavailable",
    "tidak memenuhi ketentuan formal": "Formal requirement risk",
    "surat bantahan tidak dimasukkan": "Rebuttal letter not submitted",
    "koreksi tetap dipertahankan": "Correction upheld",
    "putusan pembanding teratas memuat outcome yang mendukung wp": "Top comparable decisions support the taxpayer",
    "sebagian putusan pembanding teratas ditolak": "Some top comparable decisions were rejected",
    "belum ada faktor pendukung yang kuat dari input": "No strong supporting factor has been identified from the input",
    "belum ada faktor risiko spesifik yang terbaca": "No specific risk factor has been detected",
    "tidak ada gap bukti utama yang terdeteksi": "No key evidence gap detected",
}


st.set_page_config(
    page_title="Tax Dispute Simple Advisor",
    page_icon="TD",
    layout="wide",
)


st.markdown(
    """
    <style>
    :root {
        --rsm-blue: #009cde;
        --rsm-green: #43a047;
        --rsm-gray: #54585a;
        --rsm-soft-gray: #f4f6f8;
        --rsm-border: #d7dde3;
    }
    .stApp {
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 56%, #f4f7f9 100%);
    }
    .block-container { padding-top: 1.25rem; padding-bottom: 2rem; }
    h1, h2, h3 {
        color: var(--rsm-gray);
        letter-spacing: 0;
    }
    a {
        color: var(--rsm-blue);
    }
    section[data-testid="stSidebar"] {
        background: #f2f4f6;
        border-right: 1px solid var(--rsm-border);
    }
    section[data-testid="stSidebar"] [data-testid="stMetricValue"] {
        color: var(--rsm-gray);
    }
    div[data-testid="stMetric"] {
        background: #ffffff;
        border: 1px solid var(--rsm-border);
        border-radius: 8px;
        padding: 12px 14px;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.03);
    }
    div[data-testid="stMetricLabel"] p {
        color: #667085;
        font-weight: 600;
    }
    div[data-testid="stMetricValue"] {
        color: var(--rsm-gray);
    }
    div.stButton > button {
        border-radius: 7px;
        border-color: var(--rsm-border);
        color: var(--rsm-gray);
        background: #ffffff;
        font-weight: 600;
    }
    div.stButton > button:hover {
        border-color: var(--rsm-blue);
        color: var(--rsm-blue);
        background: #eef9fd;
    }
    div.stButton > button[kind="primary"] {
        background: var(--rsm-blue);
        border-color: var(--rsm-blue);
        color: #ffffff;
    }
    div.stButton > button[kind="primary"]:hover {
        background: #008ac4;
        border-color: #008ac4;
        color: #ffffff;
    }
    div[data-baseweb="tab-highlight"] {
        background-color: var(--rsm-blue);
    }
    div[data-baseweb="tab-list"] button[aria-selected="true"] p {
        color: var(--rsm-blue);
    }
    div[data-testid="stExpander"] {
        border-color: var(--rsm-border);
        border-radius: 8px;
        background: #ffffff;
    }
    div[data-testid="stExpander"] summary p {
        color: var(--rsm-gray);
        font-weight: 650;
    }
    div[data-testid="stDataFrame"] {
        border: 1px solid var(--rsm-border);
        border-radius: 8px;
        overflow: hidden;
        background: #ffffff;
    }
    div[data-baseweb="input"],
    div[data-baseweb="select"] > div,
    textarea {
        border-color: var(--rsm-border);
    }
    div[data-baseweb="input"]:focus-within,
    div[data-baseweb="select"] > div:focus-within,
    textarea:focus {
        border-color: var(--rsm-blue);
        box-shadow: 0 0 0 1px var(--rsm-blue);
    }
    div[data-testid="stAlert"] {
        border-radius: 8px;
        border-color: var(--rsm-border);
    }
    div[data-testid="stProgress"] > div > div > div {
        background-color: var(--rsm-blue);
    }
    div[data-testid="stDownloadButton"] button {
        border-color: var(--rsm-blue);
        color: var(--rsm-blue);
        background: #ffffff;
    }
    div[data-testid="stDownloadButton"] button:hover {
        background: #eef9fd;
        color: var(--rsm-blue);
    }
    .brand-header {
        display: flex;
        align-items: center;
        gap: 22px;
        padding: 18px 0 10px 0;
        border-bottom: 1px solid var(--rsm-border);
        margin-bottom: 18px;
    }
    .brand-header img {
        width: 146px;
        height: auto;
        flex: 0 0 auto;
    }
    .brand-eyebrow {
        color: var(--rsm-blue);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        margin-bottom: 4px;
    }
    .brand-title {
        color: var(--rsm-gray);
        font-size: 2rem;
        line-height: 1.15;
        font-weight: 700;
        margin: 0;
    }
    .brand-subtitle {
        color: #667085;
        margin-top: 6px;
        max-width: 900px;
    }
    .sidebar-brand {
        padding: 4px 0 12px 0;
    }
    .sidebar-brand img {
        width: 122px;
        height: auto;
        display: block;
        margin-bottom: 10px;
    }
    .sidebar-app-name {
        color: var(--rsm-gray);
        font-size: 1.04rem;
        font-weight: 700;
        line-height: 1.25;
    }
    .sidebar-app-caption {
        color: #667085;
        font-size: 0.86rem;
        line-height: 1.35;
        margin-top: 5px;
    }
    .metric-card {
        border: 1px solid var(--rsm-border);
        border-radius: 8px;
        padding: 14px 16px;
        background: #ffffff;
    }
    .case-card {
        border: 1px solid var(--rsm-border);
        border-radius: 8px;
        padding: 14px 16px;
        margin-bottom: 12px;
        background: #ffffff;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
    }
    .top-case-card {
        border: 1px solid var(--rsm-border);
        border-top: 4px solid var(--rsm-blue);
        border-radius: 8px;
        padding: 16px 18px;
        margin-bottom: 14px;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(16, 24, 40, 0.05);
    }
    .top-case-title {
        color: var(--rsm-gray);
        font-size: 1.08rem;
        font-weight: 750;
        margin-bottom: 8px;
    }
    .top-case-meta {
        color: #667085;
        font-size: 0.88rem;
        margin-bottom: 12px;
    }
    .top-case-section {
        color: var(--rsm-blue);
        font-weight: 700;
        margin-top: 10px;
        margin-bottom: 3px;
    }
    .small-muted { color: #57606a; font-size: 0.9rem; }
    .dashboard-kpi {
        border: 1px solid var(--rsm-border);
        border-top: 4px solid var(--accent);
        border-radius: 8px;
        background: #ffffff;
        padding: 13px 14px 12px 14px;
        min-height: 116px;
        box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
    }
    .dashboard-kpi-label {
        color: #667085;
        font-size: 0.82rem;
        font-weight: 600;
        line-height: 1.25;
    }
    .dashboard-kpi-value {
        color: var(--rsm-gray);
        font-size: 1.72rem;
        line-height: 1.1;
        font-weight: 750;
        margin-top: 9px;
    }
    .dashboard-kpi-caption {
        color: #7c8490;
        font-size: 0.78rem;
        margin-top: 7px;
        line-height: 1.3;
    }
    .chart-title {
        color: var(--rsm-gray);
        font-size: 1.02rem;
        font-weight: 720;
        margin: 2px 0 8px 0;
    }
    .dashboard-note {
        border-left: 4px solid var(--rsm-blue);
        background: #eef9fd;
        border-radius: 7px;
        padding: 12px 14px;
        color: #475467;
        margin-top: 6px;
    }
    .risk-box {
        border-left: 4px solid var(--rsm-gray);
        background: var(--rsm-soft-gray);
        padding: 12px 14px;
        border-radius: 6px;
    }
    .ok-box {
        border-left: 4px solid var(--rsm-green);
        background: #e8f5e9;
        padding: 12px 14px;
        border-radius: 6px;
    }
    @media (max-width: 640px) {
        .brand-header {
            align-items: flex-start;
            flex-direction: column;
            gap: 10px;
        }
        .brand-title {
            font-size: 1.55rem;
        }
    }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_data(show_spinner=False, ttl=3)
def cached_stats():
    return get_stats(DEFAULT_DB_PATH)


@st.cache_data(show_spinner=False)
def logo_data_uri():
    if not LOGO_PATH.exists():
        return ""
    encoded = base64.b64encode(LOGO_PATH.read_bytes()).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


@st.cache_data(show_spinner=False, ttl=3)
def cached_documents(limit=300):
    return list_documents(limit=limit)


@st.cache_data(show_spinner=False, ttl=300)
def cached_report_download_payload(report_id):
    report = get_report(report_id, db_path=DEFAULT_DB_PATH)
    if not report:
        raise ValueError("Report tidak ditemukan.")
    return {
        "docx": export_report_docx(report),
        "pdf": export_report_pdf(report),
        "md": export_report_markdown(report),
    }


def clear_caches():
    cached_stats.clear()
    cached_documents.clear()
    cached_report_download_payload.clear()


def navigate(page):
    st.session_state["pending_menu"] = page
    st.rerun()


def ui_lang():
    return st.session_state.get("ui_language", "id")


def t(key):
    entry = UI_TEXT.get(key, {})
    return entry.get(ui_lang()) or entry.get("id") or key


def tx(id_text, en_text):
    return en_text if ui_lang() == "en" else id_text


def label_lookup(value, label_map):
    if value in label_map:
        return label_map[value]
    normalized = str(value or "").strip()
    for key, label in label_map.items():
        if normalized.lower() == str(key).lower():
            return label
    return None


def localized_outcome_labels():
    return OUTCOME_LABELS_EN if ui_lang() == "en" else OUTCOME_LABELS


def localized_document_type_labels():
    return DOCUMENT_TYPE_LABELS_EN if ui_lang() == "en" else DOCUMENT_TYPE_LABELS


def localized_metric_label(key, group=None):
    if ui_lang() != "en":
        return None
    maps = {
        "tax_type": TAX_TYPE_LABELS_EN,
        "issue_type": ISSUE_TYPE_LABELS_EN,
        "document_type": DOCUMENT_TYPE_LABELS_EN,
        "regulation_type": REGULATION_TYPE_LABELS_EN,
    }
    if group in maps:
        return label_lookup(key, maps[group])
    return None


def display_analysis_title(title):
    if ui_lang() != "en":
        return title
    normalized = " ".join(str(title or "").replace("_", " ").lower().split())
    return ANALYSIS_TITLE_LABELS_EN.get(normalized, title)


def display_match_point(point):
    text = str(point or "")
    if ui_lang() != "en":
        return text
    lower = text.lower()
    if lower.startswith("keyword sama:"):
        return "Shared keywords:" + text.split(":", 1)[1]
    if lower.startswith("jenis pajak cocok:"):
        return "Matching tax type:" + text.split(":", 1)[1]
    if lower.startswith("isu cocok:"):
        return "Matching issue:" + text.split(":", 1)[1]
    return text


def display_report_text(text):
    rendered = str(text or "")
    if ui_lang() != "en":
        return rendered
    replacements = [
        ("putusan pembanding teratas memuat outcome yang mendukung WP", "top comparable decisions support the taxpayer"),
        ("putusan pembanding teratas memuat outcome yang mendukung wp", "top comparable decisions support the taxpayer"),
        ("sebagian putusan pembanding teratas ditolak", "some top comparable decisions were rejected"),
        ("spt masa ppn", "VAT return"),
        ("bukti pembayaran", "payment evidence"),
        ("dokumen pendukung", "supporting documents"),
        ("faktur pajak", "VAT invoice"),
        ("konfirmasi lawan transaksi", "counterparty confirmation"),
        ("rekonsiliasi", "reconciliation"),
        ("sudah dilaporkan", "reported position"),
        ("memenuhi syarat formal", "formal requirements met"),
        ("memenuhi syarat material", "substantive requirements met"),
        ("koreksi tidak dapat dipertahankan", "correction may not be sustainable"),
        ("tidak dapat menunjukkan", "missing evidence"),
        ("tidak dapat meyakini", "insufficient substantiation"),
        ("jawaban kpp penjual tidak ada", "seller tax office confirmation unavailable"),
        ("tidak memberikan alasan", "reasoning not sufficiently explained"),
        ("bukti pendukung lainnya tidak ada", "other supporting evidence unavailable"),
        ("tidak memenuhi ketentuan formal", "formal requirement risk"),
        ("surat bantahan tidak dimasukkan", "rebuttal letter not submitted"),
        ("koreksi tetap dipertahankan", "correction upheld"),
    ]
    for source, target in replacements:
        rendered = re.sub(re.escape(source), target, rendered, flags=re.IGNORECASE)
    return rendered


def page_label(page):
    entry = PAGE_LABELS.get(page, {})
    return entry.get(ui_lang()) or entry.get("id") or page


def current_report_language(seed=None):
    seed = seed or {}
    return seed.get("report_language") or ui_lang()


def language_label_to_code(label):
    reverse = {label_value: code for code, label_value in LANGUAGE_OPTIONS.items()}
    return reverse.get(label, "id")


def report_language_select(container, seed, key):
    labels = list(REPORT_LANGUAGE_OPTIONS.values())
    reverse = {label_value: code for code, label_value in REPORT_LANGUAGE_OPTIONS.items()}
    current_code = current_report_language(seed)
    current_label = REPORT_LANGUAGE_OPTIONS.get(current_code, REPORT_LANGUAGE_OPTIONS["id"])
    selected = container.selectbox(
        t("report_language"),
        options=labels,
        index=labels.index(current_label) if current_label in labels else 0,
        key=key,
    )
    return reverse.get(selected, "id")


def render_brand_header(title, subtitle):
    logo_uri = logo_data_uri()
    logo_html = f'<img src="{logo_uri}" alt="RSM logo" />' if logo_uri else '<div class="brand-title">RSM</div>'
    st.markdown(
        f"""
        <div class="brand-header">
            {logo_html}
            <div>
                <div class="brand-eyebrow">Tax Dispute Prototype</div>
                <div class="brand-title">{title}</div>
                <div class="brand-subtitle">{subtitle}</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_sidebar_brand():
    logo_uri = logo_data_uri()
    logo_html = f'<img src="{logo_uri}" alt="RSM logo" />' if logo_uri else ""
    st.sidebar.markdown(
        f"""
        <div class="sidebar-brand">
            {logo_html}
            <div class="sidebar-app-name">Tax Dispute Simple Advisor</div>
            <div class="sidebar-app-caption">{html.escape(t("app_caption"))}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def format_money(value):
    if value is None:
        return "-"
    try:
        return "Rp {:,.0f}".format(float(value)).replace(",", ".")
    except Exception:
        return str(value)


def format_compact_number(value):
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return "0"
    if number >= 1_000_000:
        return f"{number / 1_000_000:.1f}M"
    if number >= 1_000:
        return f"{number / 1_000:.1f}K"
    return f"{int(number):,}".replace(",", ".")


def dashboard_metric_value(metrics, group, key):
    for row in metrics.get(group, []):
        if row.get("metric_key") == key:
            return row.get("metric_value", 0)
    return 0


def humanize_metric_label(key, group=None, label_map=None):
    if label_map and key in label_map:
        return label_map[key]
    localized = localized_metric_label(key, group=group)
    if localized:
        return localized
    if not key or key == "UNKNOWN":
        return tx("Belum terdeteksi", "Not detected")
    return str(key).replace("_", " ").title()


def dashboard_metric_rows(metrics, group, label_map=None, limit=None):
    rows = []
    for row in metrics.get(group, []):
        value = row.get("metric_value", 0) or 0
        if value <= 0:
            continue
        key = row.get("metric_key") or ""
        rows.append(
            {
                "Kategori": humanize_metric_label(key, group=group, label_map=label_map),
                "Jumlah": int(value),
                "Kode": key,
            }
        )
    rows.sort(key=lambda item: item["Jumlah"], reverse=True)
    return rows[:limit] if limit else rows


def render_kpi_card(container, label, value, caption, accent):
    container.markdown(
        f"""
        <div class="dashboard-kpi" style="--accent: {accent};">
            <div class="dashboard-kpi-label">{html.escape(label)}</div>
            <div class="dashboard-kpi-value">{html.escape(str(value))}</div>
            <div class="dashboard-kpi-caption">{html.escape(caption)}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_donut_chart(title, rows, empty_message):
    st.markdown(f'<div class="chart-title">{html.escape(title)}</div>', unsafe_allow_html=True)
    if not rows:
        st.info(empty_message)
        return
    df = pd.DataFrame(rows)
    chart = (
        alt.Chart(df)
        .mark_arc(innerRadius=74, outerRadius=118, cornerRadius=4, padAngle=0.025)
        .encode(
            theta=alt.Theta("Jumlah:Q", stack=True),
            color=alt.Color("Kategori:N", scale=alt.Scale(range=RSM_PALETTE), legend=alt.Legend(title=None, orient="bottom", columns=2)),
            tooltip=[
                alt.Tooltip("Kategori:N", title=tx("Kategori", "Category")),
                alt.Tooltip("Jumlah:Q", title=tx("Jumlah", "Count"), format=","),
            ],
        )
        .properties(height=320)
    )
    st.altair_chart(chart, use_container_width=True)
    st.caption(f"{tx('Total data', 'Total records')}: {format_compact_number(df['Jumlah'].sum())}")


def render_horizontal_bar_chart(title, rows, empty_message, height_per_row=34):
    st.markdown(f'<div class="chart-title">{html.escape(title)}</div>', unsafe_allow_html=True)
    if not rows:
        st.info(empty_message)
        return
    df = pd.DataFrame(rows)
    chart_height = max(220, min(420, len(df) * height_per_row + 56))
    bar = (
        alt.Chart(df)
        .mark_bar(cornerRadiusEnd=5, height=18)
        .encode(
            x=alt.X("Jumlah:Q", title=None, axis=alt.Axis(grid=True, gridColor="#edf1f5", labelColor="#667085")),
            y=alt.Y("Kategori:N", sort="-x", title=None, axis=alt.Axis(labelColor=RSM_GRAY)),
            color=alt.Color("Kategori:N", scale=alt.Scale(range=RSM_PALETTE), legend=None),
            tooltip=[
                alt.Tooltip("Kategori:N", title=tx("Kategori", "Category")),
                alt.Tooltip("Jumlah:Q", title=tx("Jumlah", "Count"), format=","),
            ],
        )
    )
    text = bar.mark_text(align="left", baseline="middle", dx=5, color=RSM_GRAY).encode(text=alt.Text("Jumlah:Q", format=","))
    st.altair_chart((bar + text).properties(height=chart_height), use_container_width=True)


def render_lollipop_chart(title, rows, empty_message):
    st.markdown(f'<div class="chart-title">{html.escape(title)}</div>', unsafe_allow_html=True)
    if not rows:
        st.info(empty_message)
        return
    df = pd.DataFrame(rows)
    chart_height = max(180, min(320, len(df) * 36 + 40))
    base = alt.Chart(df).encode(
        x=alt.X("Jumlah:Q", title=None, axis=alt.Axis(grid=True, gridColor="#edf1f5", labelColor="#667085")),
        y=alt.Y("Kategori:N", sort="-x", title=None, axis=alt.Axis(labelColor=RSM_GRAY)),
        tooltip=[
            alt.Tooltip("Kategori:N", title=tx("Kategori", "Category")),
            alt.Tooltip("Jumlah:Q", title=tx("Jumlah", "Count"), format=","),
        ],
    )
    stem = base.mark_bar(height=3, color="#b7bdc3")
    point = base.mark_circle(size=160, color=RSM_GREEN)
    text = base.mark_text(align="left", dx=9, color=RSM_GRAY).encode(text=alt.Text("Jumlah:Q", format=","))
    st.altair_chart((stem + point + text).properties(height=chart_height), use_container_width=True)


def render_readiness_panel(stats, metrics, pdf_count):
    documents = stats.get("documents", 0) or 0
    extractions = stats.get("extractions", 0) or 0
    llm_labels = dashboard_metric_value(metrics, "summary", "llm_labels")
    regulations = stats.get("regulations", 0) or 0
    extraction_ratio = min(1.0, extractions / documents) if documents else 0
    llm_ratio = min(1.0, llm_labels / documents) if documents else 0
    regulation_ratio = min(1.0, regulations / 10) if regulations else 0

    st.markdown(f'<div class="chart-title">{tx("Kesiapan Data Prototype", "Prototype Data Readiness")}</div>', unsafe_allow_html=True)
    st.progress(
        extraction_ratio,
        text=tx(f"Detail ekstraksi: {extractions}/{documents} dokumen", f"Extraction details: {extractions}/{documents} documents"),
    )
    st.progress(llm_ratio, text=tx(f"Label LLM: {int(llm_labels)}/{documents} dokumen", f"LLM labels: {int(llm_labels)}/{documents} documents"))
    st.progress(regulation_ratio, text=tx(f"Peraturan lokal: {regulations} aturan", f"Local regulations: {regulations} rules"))
    st.markdown(
        f"""
        <div class="dashboard-note">
            {tx("PDF lokal terdeteksi", "Local PDFs detected")}: <b>{format_compact_number(pdf_count)}</b>. 
            {tx(
                "Dashboard ini memakai data SQLite lokal dan diperbarui saat ingest/labeling/refresh peraturan.",
                "This dashboard uses the local SQLite database and updates after ingestion, labeling, or regulation refresh.",
            )}
        </div>
        """,
        unsafe_allow_html=True,
    )


def outcome_badge(outcome):
    return localized_outcome_labels().get(outcome or "UNKNOWN", outcome or "UNKNOWN")


def field_label(field_name):
    return FIELD_LABELS.get(field_name, field_name.replace("_", " ").title())


def is_empty_extraction_value(value):
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() in {"", "UNKNOWN", "Unknown", "None", "null", "[]", "{}"}
    return False


def format_extraction_value(field_name, value):
    if is_empty_extraction_value(value):
        return ""
    if field_name in MONEY_FIELDS:
        return format_money(value)
    if field_name == "outcome":
        return outcome_badge(value)
    return str(value)


def render_duplicate_warning(error_or_duplicates):
    duplicates = getattr(error_or_duplicates, "duplicates", error_or_duplicates)
    st.error("Ekstraksi ditolak karena nomor putusan sudah pernah diekstraksi.")
    if duplicates:
        st.dataframe(
            [
                {
                    "Alasan": item.get("match_reason"),
                    "File": item.get("filename"),
                    "Nomor Putusan": item.get("putusan_number"),
                    "WP": item.get("taxpayer_name"),
                    "NPWP": item.get("taxpayer_npwp"),
                    "Jenis Pajak": item.get("tax_type"),
                    "Isu": item.get("issue_type"),
                    "Waktu Ekstraksi": item.get("extracted_at"),
                    "Path": item.get("file_path"),
                }
                for item in duplicates
            ],
            width="stretch",
            hide_index=True,
        )


def render_extraction_error(error: ExtractionError):
    st.error(str(error))
    if error.detail:
        st.caption(error.detail)


def render_extraction_summary(document_id):
    extraction_row = get_document_extraction(document_id, db_path=DEFAULT_DB_PATH)
    if not extraction_row:
        st.info("Belum ada detail ekstraksi tersimpan untuk dokumen ini.")
        return
    extraction = extraction_row.get("extraction", {})
    show_empty = st.toggle(
        "Tampilkan field kosong / UNKNOWN",
        value=False,
        key=f"show-empty-extraction-{document_id}",
        help="Default disembunyikan agar hasil ekstraksi lebih mudah dibaca.",
    )
    group_labels = {
        "metadata_putusan": "Metadata Putusan",
        "objek_sengketa": "Objek Sengketa",
        "pihak": "Pihak",
        "pokok_sengketa": "Pokok Sengketa",
        "argumen": "Argumen",
        "pertimbangan": "Pertimbangan",
        "outcome": "Outcome",
    }
    for group_key, label in group_labels.items():
        values = extraction.get(group_key, {})
        if not values:
            continue
        rows = []
        for key, value in values.items():
            if not show_empty and is_empty_extraction_value(value):
                continue
            rows.append({"Field": field_label(key), "Nilai": format_extraction_value(key, value)})
        if not rows and not show_empty:
            continue
        with st.expander(label, expanded=group_key in {"metadata_putusan", "pihak", "pokok_sengketa"}):
            st.dataframe(
                rows,
                width="stretch",
                hide_index=True,
            )


def save_uploaded_pdf(uploaded_file):
    UPLOAD_DIR.mkdir(exist_ok=True)
    safe_name = uploaded_file.name.replace("/", "_").replace("\\", "_")
    target = UPLOAD_DIR / safe_name
    if target.exists():
        stem = target.stem
        suffix = target.suffix
        counter = 2
        while target.exists():
            target = UPLOAD_DIR / f"{stem}_{counter}{suffix}"
            counter += 1
    target.write_bytes(uploaded_file.getbuffer())
    return target


def document_options(limit=300):
    docs = cached_documents(limit=limit)
    labels = [
        f"{doc.putusan_number} | {doc.taxpayer_name or doc.filename} | {doc.tax_type} | {doc.issue_type} | {outcome_badge(doc.outcome)}"
        for doc in docs
    ]
    return docs, labels


def normalize_choice(value, options, fallback):
    if value in options:
        return value
    return fallback


def run_case_analysis(intake, top_n, use_llm):
    similar_cases = find_similar_cases(intake, limit=top_n)
    result = analyze_case(intake, similar_cases, use_llm=use_llm)
    report_id = save_report(intake, similar_cases, result, db_path=DEFAULT_DB_PATH)
    return report_id, similar_cases, result


def report_file_stem(report):
    intake = report.get("input", {})
    wp = "".join(ch if ch.isalnum() else "_" for ch in (intake.get("taxpayer_name") or "WP"))[:40].strip("_") or "WP"
    created = (report.get("created_at") or "report")[:10]
    return f"tax_dispute_{created}_{wp}_{report.get('report_id', '')[:8]}"


def render_report_downloads(report, key_prefix):
    stem = report_file_stem(report)
    ready_key = f"{key_prefix}-downloads-ready"
    if not st.session_state.get(ready_key):
        if st.button("Siapkan File Unduhan", key=f"{key_prefix}-prepare-downloads"):
            st.session_state[ready_key] = True
            st.rerun()
        st.caption("Word/PDF dibuat saat tombol ini diklik agar halaman lebih ringan.")
        return

    try:
        with st.spinner("Menyiapkan Word, PDF, dan Markdown..."):
            payload = cached_report_download_payload(report["report_id"])
        docx_bytes = payload["docx"]
        pdf_bytes = payload["pdf"]
        md = payload["md"]
    except Exception as exc:
        st.error(f"Gagal membuat dokumen unduhan: {exc}")
        return

    c1, c2, c3 = st.columns(3)
    c1.download_button(
        "Download Word (.docx)",
        data=docx_bytes,
        file_name=f"{stem}.docx",
        mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        key=f"{key_prefix}-docx",
    )
    c2.download_button(
        "Download PDF",
        data=pdf_bytes,
        file_name=f"{stem}.pdf",
        mime="application/pdf",
        key=f"{key_prefix}-pdf",
    )
    c3.download_button(
        "Download Markdown",
        data=md,
        file_name=f"{stem}.md",
        mime="text/markdown",
        key=f"{key_prefix}-md",
    )


def render_case_result(item, rank=None):
    doc = item["document"]
    title_prefix = f"{rank}. " if rank else ""
    st.markdown('<div class="case-card">', unsafe_allow_html=True)
    st.markdown(f"**{title_prefix}{doc.putusan_number}**")
    c1, c2, c3, c4 = st.columns([1, 1, 1, 1])
    c1.caption(f"{tx('Jenis pajak', 'Tax type')}: {humanize_metric_label(doc.tax_type, group='tax_type')}")
    c2.caption(f"{tx('Isu', 'Issue')}: {humanize_metric_label(doc.issue_type, group='issue_type')}")
    c3.caption(f"Outcome: {outcome_badge(doc.outcome)}")
    c4.caption(f"Score: {item.get('score', 0):.1f}")
    if doc.issue_summary:
        st.write(doc.issue_summary[:700] + ("..." if len(doc.issue_summary) > 700 else ""))
    if item.get("reasons"):
        st.caption(f"{tx('Alasan relevansi', 'Relevance reasons')}: " + " | ".join(display_match_point(reason) for reason in item["reasons"][:3]))
    st.caption(f"File: {doc.filename} | {tx('Nilai indikatif', 'Indicative amount')}: {format_money(doc.amount_disputed)}")
    b1, b2 = st.columns([1, 5])
    pdf_path = Path(doc.file_path)
    if pdf_path.exists():
        try:
            b1.link_button(tx("Buka PDF", "Open PDF"), pdf_path.as_uri())
        except ValueError:
            pass
        b2.download_button(
            tx("Download PDF", "Download PDF"),
            data=pdf_path.read_bytes(),
            file_name=pdf_path.name,
            mime="application/pdf",
            key=f"download-{doc.document_id}-{rank or 'x'}",
        )
    st.markdown("</div>", unsafe_allow_html=True)


def render_regulation_result(item, rank=None):
    title_prefix = f"{rank}. " if rank else ""
    title = item.get("title") or item.get("number") or item.get("source_id", tx("Peraturan", "Regulation"))
    st.markdown('<div class="case-card">', unsafe_allow_html=True)
    st.markdown(f"**{title_prefix}{title}**")
    c1, c2, c3, c4 = st.columns([1, 1, 1, 1])
    c1.caption(f"{tx('Jenis', 'Type')}: {humanize_metric_label(item.get('regulation_type') or '-', group='regulation_type')}")
    c2.caption(f"{tx('Nomor', 'Number')}: {item.get('number') or '-'}")
    c3.caption(f"{tx('Tahun', 'Year')}: {item.get('year') or '-'}")
    c4.caption(f"Score: {item.get('score', 0)}")
    if item.get("summary"):
        st.write(item["summary"][:700] + ("..." if len(item["summary"]) > 700 else ""))
    if item.get("reasons"):
        st.caption(f"{tx('Alasan relevansi', 'Relevance reasons')}: " + " | ".join(item["reasons"][:3]))
    for chunk in item.get("matched_chunks", [])[:2]:
        label = chunk.get("section_label") or tx("Bagian relevan", "Relevant section")
        st.markdown(f"**{label}**")
        st.write(chunk.get("text", ""))
    if item.get("url"):
        st.link_button(tx("Buka di Ortax", "Open in Ortax"), item["url"])
    st.markdown("</div>", unsafe_allow_html=True)


def render_top_case_analysis(item):
    match_points = [display_match_point(point) for point in (item.get("match_points") or [])]
    points_html = "".join(f"<li>{html.escape(str(point))}</li>" for point in match_points)
    score_label = tx("Skor relevansi", "Relevance score")
    tax_label = humanize_metric_label(item.get("tax_type", "-"), group="tax_type")
    issue_label = humanize_metric_label(item.get("issue_type", "-"), group="issue_type")
    outcome_label = localized_outcome_labels().get(item.get("outcome") or "UNKNOWN", item.get("outcome_label", item.get("outcome", "-")))
    st.markdown(
        f"""
        <div class="top-case-card">
            <div class="top-case-title">{item.get('rank', '-')}. {html.escape(str(item.get('putusan_number', '-')))}</div>
            <div class="top-case-meta">
                {html.escape(str(tax_label))} | {html.escape(str(issue_label))} |
                {html.escape(str(outcome_label))} | {score_label} {html.escape(str(item.get('score', '-')))}
            </div>
            <div class="top-case-section">{tx("Mengapa paling relevan", "Why this is most relevant")}</div>
            <div>{html.escape(str(item.get('why_relevant', '-')))}</div>
            <div class="top-case-section">{tx("Titik kecocokan", "Matching points")}</div>
            <ul>{points_html}</ul>
            <div class="top-case-section">{tx("Inti pertimbangan yang perlu dibaca", "Key reasoning to read")}</div>
            <div>{html.escape(str(item.get('reasoning_summary', '-')))}</div>
            <div class="top-case-section">{tx("Implikasi untuk posisi WP", "Implication for the taxpayer position")}</div>
            <div>{html.escape(str(item.get('case_implication', '-')))}</div>
            <div class="top-case-section">{tx("Cara pakai dalam argumentasi", "How to use it in the argument")}</div>
            <div>{html.escape(str(item.get('use_strategy', '-')))}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def build_regulation_chat_answer(question, results, use_llm=False):
    if not results:
        return (
            "Saya belum menemukan aturan yang cocok di database lokal. Coba jalankan `Unduh/Refresh Berkala dari Ortax`, "
            "atau masukkan ID/URL Ortax tertentu pada tab sinkronisasi."
        )

    context_items = []
    for idx, item in enumerate(results[:5], start=1):
        chunks = item.get("matched_chunks") or []
        snippet = chunks[0].get("text", "") if chunks else item.get("summary", "")
        section = chunks[0].get("section_label", "") if chunks else ""
        context_items.append(
            {
                "rank": idx,
                "title": item.get("title"),
                "number": item.get("number"),
                "type": item.get("regulation_type"),
                "year": item.get("year"),
                "url": item.get("url"),
                "section": section,
                "summary": item.get("summary"),
                "snippet": snippet[:1400],
            }
        )

    if use_llm:
        prompt = (
            "Anda adalah chatbot aturan pajak Indonesia untuk prototype lokal. Jawab pertanyaan user hanya berdasarkan konteks aturan berikut. "
            "Selalu sebutkan lokasi aturan: nama/nomor aturan, bagian/pasal jika tersedia, dan URL Ortax. "
            "Jika konteks belum cukup, katakan belum cukup dan sarankan aturan apa yang perlu dicari. Jangan mengarang pasal.\n\n"
            f"PERTANYAAN:\n{question}\n\n"
            f"KONTEKS ATURAN:\n{context_items}\n\n"
            "Jawab ringkas tapi berguna dalam bahasa Indonesia."
        )
        llm = call_openai_text(prompt, max_output_tokens=1400)
        if llm.get("text"):
            return llm["text"]

    lines = [
        "Saya menemukan beberapa rujukan lokal yang paling dekat. Ini jawaban awal berdasarkan indeks aturan yang sudah diunduh:",
        "",
    ]
    for item in context_items:
        section = f", bagian {item['section']}" if item.get("section") else ""
        lines.append(f"{item['rank']}. **{item['title']}** ({item.get('number') or '-'}){section}")
        if item.get("snippet"):
            lines.append(f"   Relevansi: {item['snippet'][:520]}{'...' if len(item['snippet']) > 520 else ''}")
        lines.append(f"   Lokasi: {item.get('url') or '-'}")
        lines.append("")
    lines.append("Untuk memo final, cocokkan lagi pasal tersebut dengan masa pajak, jenis transaksi, dan dokumen koreksi DJP.")
    return "\n".join(lines)


def page_guided():
    st.title(t("guided_title"))
    st.write(t("guided_intro"))

    stats = cached_stats()
    st.progress(0.25 if stats["documents"] == 0 else 0.75)

    st.subheader(tx("1. Upload atau Pilih Dokumen", "1. Upload or Select Document"))
    c1, c2 = st.columns([1, 1])
    with c1:
        uploaded = st.file_uploader(tx("Upload PDF putusan / dokumen kasus", "Upload tax decision / case document PDF"), type=["pdf"])
        upload_doc_type_label = st.selectbox(tx("Jenis dokumen upload", "Uploaded document type"), list(DOCUMENT_TYPE_OPTIONS.keys()), index=0)
        auto_label_uploaded = st.checkbox(tx("Gunakan LLM untuk ekstraksi detail", "Use LLM for detailed extraction"), value=True)
        if uploaded and st.button(tx("Ekstrak Dokumen Upload", "Extract Uploaded Document"), type="primary"):
            try:
                with st.spinner("Menyimpan, membaca PDF, dan mengekstrak detail dengan LLM..."):
                    pdf_path = save_uploaded_pdf(uploaded)
                    doc = upsert_document(
                        pdf_path,
                        overwrite=False,
                        db_path=DEFAULT_DB_PATH,
                        document_type=DOCUMENT_TYPE_OPTIONS[upload_doc_type_label],
                        use_llm_extraction=auto_label_uploaded,
                    )
                    st.session_state["guided_doc_id"] = doc.document_id
                    st.session_state.pop("guided_intake", None)
                    st.session_state.pop("guided_last", None)
                    clear_caches()
                st.success(f"Ekstraksi selesai: {doc.putusan_number}")
                render_extraction_summary(doc.document_id)
            except DuplicateDocumentError as exc:
                render_duplicate_warning(exc)
            except ExtractionError as exc:
                render_extraction_error(exc)

    with c2:
        docs, labels = document_options()
        if docs:
            selected_label = st.selectbox(tx("Atau pilih dokumen terindeks", "Or select an indexed document"), labels)
            selected_doc = docs[labels.index(selected_label)]
            c21, c22 = st.columns(2)
            if c21.button(tx("Gunakan Dokumen Ini", "Use This Document")):
                st.session_state["guided_doc_id"] = selected_doc.document_id
                st.session_state.pop("guided_intake", None)
                st.session_state.pop("guided_last", None)
                st.success("Dokumen dipilih untuk auto-fill.")
            if c22.button(tx("Label Dokumen Ini dengan LLM", "Label This Document with LLM")):
                with st.spinner("Meminta LLM membaca dan melabeli dokumen..."):
                    label_result = label_document_with_llm(selected_doc.document_id, update_document=True, db_path=DEFAULT_DB_PATH)
                if label_result["ok"]:
                    st.session_state["guided_doc_id"] = selected_doc.document_id
                    st.session_state.pop("guided_intake", None)
                    st.session_state.pop("guided_last", None)
                    clear_caches()
                    detail = f" via {label_result.get('source')}" if label_result.get("source") else ""
                    st.success(f"Label LLM selesai dengan model {label_result.get('model')}{detail}")
                    if label_result.get("pages"):
                        st.caption(f"Halaman scan yang dibaca: {', '.join(str(page) for page in label_result['pages'])}")
                    render_extraction_summary(selected_doc.document_id)
                elif label_result.get("duplicates"):
                    render_duplicate_warning(label_result["duplicates"])
                else:
                    st.error(label_result["error"])
        else:
            st.info("Belum ada dokumen. Upload PDF atau buka menu Ingest & Ekstraksi.")

    doc_id = st.session_state.get("guided_doc_id")
    if not doc_id:
        st.info(tx("Pilih atau upload dokumen dulu agar parameter analisis bisa diisi otomatis.", "Select or upload a document first so analysis parameters can be auto-filled."))
        return

    if "guided_intake" not in st.session_state:
        st.session_state["guided_intake"] = build_intake_from_document(doc_id, db_path=DEFAULT_DB_PATH)
    intake_seed = st.session_state["guided_intake"]

    st.subheader(tx("2. Parameter Kasus Otomatis", "2. Auto-Filled Case Parameters"))
    st.caption(tx("Field di bawah ini sudah diisi dari hasil ekstraksi/label LLM. Silakan koreksi sebelum analisis.", "The fields below are filled from extraction/LLM labels. Please adjust them before analysis."))

    with st.form("guided_analysis_form"):
        c1, c2, c3 = st.columns(3)
        taxpayer_name = c1.text_input(tx("Nama WP", "Taxpayer name"), value=intake_seed.get("taxpayer_name", "Wajib Pajak"))
        stage = c2.selectbox(tx("Tahap sengketa", "Dispute stage"), STAGE_OPTIONS, index=STAGE_OPTIONS.index(normalize_choice(intake_seed.get("stage"), STAGE_OPTIONS, "Banding")))
        tax_type = c3.selectbox(tx("Jenis pajak", "Tax type"), TAX_OPTIONS, index=TAX_OPTIONS.index(normalize_choice(intake_seed.get("tax_type"), TAX_OPTIONS, "PPN")))

        cparty1, cparty2, cparty3 = st.columns(3)
        taxpayer_npwp = cparty1.text_input("NPWP", value=intake_seed.get("taxpayer_npwp", "") or "")
        legal_counsel_name = cparty2.text_input(tx("Kuasa / Konsultan", "Counsel / consultant"), value=intake_seed.get("legal_counsel_name", "") or "")
        djp_unit = cparty3.text_input(tx("Unit DJP / KPP", "Tax office / DGT unit"), value=intake_seed.get("djp_unit", "") or "")

        cdoc1, cdoc2 = st.columns(2)
        skp_number = cdoc1.text_input(tx("Nomor SKP/STP", "Tax assessment number"), value=intake_seed.get("skp_number", "") or "")
        djp_decision_number = cdoc2.text_input(tx("Nomor KEP/Keputusan", "Objection decision number"), value=intake_seed.get("djp_decision_number", "") or "")

        c4, c5 = st.columns(2)
        issue_type = c4.selectbox(tx("Isu utama", "Main issue"), ISSUE_OPTIONS, index=ISSUE_OPTIONS.index(normalize_choice(intake_seed.get("issue_type"), ISSUE_OPTIONS, "DPP PPN")))
        correction_amount = c5.text_input(tx("Nilai koreksi", "Correction amount"), value=intake_seed.get("correction_amount", "Rp 0"))

        djp_reason = st.text_area(tx("Posisi/Alasan DJP", "Tax authority position / reason"), value=intake_seed.get("djp_reason", ""), height=120)
        wp_reason = st.text_area(tx("Posisi/Alasan WP", "Taxpayer position / reason"), value=intake_seed.get("wp_reason", ""), height=120)
        available_evidence = st.multiselect(
            tx("Bukti tersedia", "Available evidence"),
            EVIDENCE_OPTIONS,
            default=[item for item in intake_seed.get("available_evidence", []) if item in EVIDENCE_OPTIONS],
        )
        case_notes = st.text_area(tx("Ringkasan isu / catatan kasus", "Issue summary / case notes"), value=intake_seed.get("case_notes", ""), height=90)
        c6, c7, c8 = st.columns(3)
        top_n = c6.slider(tx("Jumlah putusan pembanding", "Number of comparable decisions"), min_value=3, max_value=15, value=8)
        report_language = report_language_select(c7, intake_seed, "guided_report_language")
        use_llm = c8.checkbox(tx("Gunakan LLM untuk review tambahan", "Use LLM for additional review"), value=True)
        submitted = st.form_submit_button(tx("Cari Pembanding + Buat Analisis", "Find Comparables + Generate Analysis"), type="primary")

    if submitted:
        intake = {
            "taxpayer_name": taxpayer_name,
            "taxpayer_npwp": taxpayer_npwp,
            "legal_counsel_name": legal_counsel_name,
            "djp_unit": djp_unit,
            "skp_number": skp_number,
            "djp_decision_number": djp_decision_number,
            "stage": stage,
            "tax_type": tax_type,
            "tax_type_filter": tax_type,
            "issue_type": issue_type,
            "correction_amount": correction_amount,
            "djp_reason": djp_reason,
            "wp_reason": wp_reason,
            "available_evidence": available_evidence,
            "case_notes": case_notes,
            "report_language": report_language,
        }
        st.session_state["guided_intake"] = intake
        with st.spinner("Mencari pembanding, menghitung indikasi, dan menyusun rekomendasi..."):
            report_id, similar_cases, result = run_case_analysis(intake, top_n, use_llm)
        st.session_state["guided_last"] = {
            "report_id": report_id,
            "similar_cases": similar_cases,
            "result": result,
        }
        st.success(f"Analisis selesai. Report ID: {report_id}")

    guided_last = st.session_state.get("guided_last")
    if guided_last:
        report_id = guided_last["report_id"]
        report = get_report(report_id, db_path=DEFAULT_DB_PATH)
        st.subheader("3. Hasil Analisis")
        st.caption(f"Report aktif: {report_id}")
        if report:
            render_report_downloads(report, key_prefix=f"guided-{report_id}")
        render_analysis_result(guided_last["result"], guided_last["similar_cases"])


def sidebar():
    init_db(DEFAULT_DB_PATH)
    init_regulation_db(DEFAULT_DB_PATH)
    load_local_env()
    stats = cached_stats()
    if "ui_language" not in st.session_state:
        st.session_state["ui_language"] = "id"
    if st.session_state.get("ui_language_label") in set(LANGUAGE_OPTIONS.values()):
        st.session_state["ui_language"] = language_label_to_code(st.session_state["ui_language_label"])
    render_sidebar_brand()
    language_labels = list(LANGUAGE_OPTIONS.values())
    current_language_label = LANGUAGE_OPTIONS.get(ui_lang(), LANGUAGE_OPTIONS["id"])
    if st.session_state.get("ui_language_label") not in language_labels:
        st.session_state["ui_language_label"] = current_language_label
    selected_language_label = st.sidebar.selectbox(
        "Language / Bahasa",
        options=language_labels,
        key="ui_language_label",
    )
    st.session_state["ui_language"] = language_label_to_code(selected_language_label)
    st.sidebar.metric(t("indexed_decisions"), stats["documents"])
    st.sidebar.metric(t("extraction_details"), stats.get("extractions", 0))
    st.sidebar.metric(t("regulations"), stats.get("regulations", 0))
    st.sidebar.divider()

    pending_menu = st.session_state.pop("pending_menu", None)
    force_menu_label_sync = False
    if pending_menu in APP_PAGES:
        st.session_state["active_menu"] = pending_menu
        force_menu_label_sync = True
        if pending_menu in ADMIN_PAGES:
            st.session_state["show_admin_menu"] = True

    if "show_admin_menu" not in st.session_state:
        st.session_state["show_admin_menu"] = False
    show_admin = st.sidebar.toggle(
        t("admin_toggle"),
        key="show_admin_menu",
        help=t("admin_help"),
    )
    pages = APP_PAGES if show_admin else USER_PAGES
    active_menu = st.session_state.get("active_menu", "Dashboard")
    if active_menu not in pages:
        active_menu = "Dashboard"
        st.session_state["active_menu"] = active_menu
        force_menu_label_sync = True
    label_to_page = {page_label(page): page for page in pages}
    active_label = page_label(active_menu)
    if force_menu_label_sync or st.session_state.get("active_menu_label") not in label_to_page:
        st.session_state["active_menu_label"] = active_label
    selected_label = st.sidebar.radio(
        t("menu"),
        list(label_to_page.keys()),
        key="active_menu_label",
    )
    page = label_to_page[selected_label]
    st.session_state["active_menu"] = page
    if show_admin:
        st.sidebar.caption(t("admin_active"))
    else:
        st.sidebar.caption(t("admin_hidden"))
    return page


def page_dashboard():
    stats = cached_stats()
    metrics = get_dashboard_metrics(DEFAULT_DB_PATH)
    pdf_count = len(find_pdfs(ROOT_DIR))
    documents = stats.get("documents", 0)
    extractions = stats.get("extractions", 0)
    llm_labels = dashboard_metric_value(metrics, "summary", "llm_labels")
    ppn_docs = dashboard_metric_value(metrics, "tax_type", "PPN")
    extraction_rate = f"{(extractions / documents * 100):.0f}%" if documents else "0%"
    render_brand_header(
        "Tax Dispute Simple Advisor",
        t("dashboard_subtitle"),
    )

    a1, a2, a3, a4 = st.columns(4)
    if a1.button(t("start_guided"), type="primary", width="stretch"):
        navigate("Alur Terpandu")
    if a2.button(t("case_analysis"), width="stretch"):
        navigate("Analisis Kasus WP")
    if a3.button(t("ask_regulations"), width="stretch"):
        navigate("Peraturan")
    if a4.button(t("view_reports"), width="stretch"):
        navigate("Reports")

    st.subheader(t("data_summary"))
    kpi_cols = st.columns(5)
    render_kpi_card(
        kpi_cols[0],
        tx("Putusan terindeks", "Indexed decisions"),
        format_compact_number(documents),
        tx("basis pencarian pembanding", "comparable search base"),
        RSM_BLUE,
    )
    render_kpi_card(
        kpi_cols[1],
        tx("Coverage ekstraksi", "Extraction coverage"),
        extraction_rate,
        tx(f"{format_compact_number(extractions)} dokumen detail", f"{format_compact_number(extractions)} detailed documents"),
        RSM_GREEN,
    )
    render_kpi_card(
        kpi_cols[2],
        tx("Dokumen PPN", "VAT documents"),
        format_compact_number(ppn_docs),
        tx("fokus fase prototype", "prototype phase focus"),
        RSM_BLUE,
    )
    render_kpi_card(
        kpi_cols[3],
        tx("Peraturan lokal", "Local regulations"),
        format_compact_number(stats.get("regulations", 0)),
        tx("konteks aturan PPN", "VAT rule context"),
        RSM_GRAY,
    )
    render_kpi_card(
        kpi_cols[4],
        "LLM labels" if ui_lang() == "en" else "Label LLM",
        format_compact_number(llm_labels),
        tx("hasil ekstraksi/quality check", "extraction / quality check results"),
        RSM_MID_GRAY,
    )

    st.subheader(t("data_visualization"))
    outcome_rows = dashboard_metric_rows(metrics, "outcome", label_map=localized_outcome_labels())
    tax_rows = dashboard_metric_rows(metrics, "tax_type", limit=8)
    issue_rows = dashboard_metric_rows(metrics, "issue_type", limit=10)
    document_type_rows = dashboard_metric_rows(metrics, "document_type", label_map=localized_document_type_labels(), limit=8)
    regulation_rows = dashboard_metric_rows(metrics, "regulation_type", limit=6)

    col_a, col_b = st.columns([1, 1.15])
    with col_a:
        render_donut_chart(tx("Outcome Putusan", "Decision Outcomes"), outcome_rows, tx("Belum ada data outcome.", "No outcome data yet."))
    with col_b:
        render_horizontal_bar_chart(tx("Komposisi Jenis Pajak", "Tax Type Composition"), tax_rows, tx("Belum ada data jenis pajak.", "No tax type data yet."))

    col_c, col_d = st.columns([1.2, 1])
    with col_c:
        render_horizontal_bar_chart(tx("Top Pokok Sengketa / Isu", "Top Dispute Issues"), issue_rows, tx("Belum ada data isu sengketa.", "No dispute issue data yet."), height_per_row=32)
    with col_d:
        render_readiness_panel(stats, metrics, pdf_count)
        render_lollipop_chart(tx("Jenis Dokumen", "Document Types"), document_type_rows, tx("Belum ada data jenis dokumen.", "No document type data yet."))

    if regulation_rows:
        render_lollipop_chart(tx("Database Peraturan Pajak", "Tax Regulation Database"), regulation_rows, tx("Belum ada peraturan lokal.", "No local regulations yet."))

    st.subheader(tx("Alur Prototype", "Prototype Flow"))
    st.markdown(
        f"""
        <div class="dashboard-note">
            {tx(
                "Upload/ingest PDF -> ekstraksi teks/vision LLM -> simpan field terstruktur -> cari pembanding dan aturan -> scoring risiko -> rekomendasi WP -> export Word/PDF.",
                "Upload/ingest PDFs -> text or vision LLM extraction -> store structured fields -> find comparable decisions and rules -> risk scoring -> taxpayer recommendation -> export Word/PDF.",
            )}
        </div>
        """,
        unsafe_allow_html=True,
    )

    docs = cached_documents(limit=8)
    if docs:
        st.subheader(tx("Dokumen Terakhir", "Recent Documents"))
        st.dataframe(
            [
                {
                    tx("Putusan", "Decision"): doc.putusan_number,
                    tx("Jenis Dokumen", "Document Type"): humanize_metric_label(doc.document_type, group="document_type"),
                    tx("WP/Perusahaan", "Taxpayer/Company"): doc.taxpayer_name,
                    tx("Jenis Pajak", "Tax Type"): humanize_metric_label(doc.tax_type, group="tax_type"),
                    tx("Isu", "Issue"): humanize_metric_label(doc.issue_type, group="issue_type"),
                    "Outcome": outcome_badge(doc.outcome),
                    tx("Nilai", "Amount"): format_money(doc.amount_disputed),
                    "File": doc.filename,
                }
                for doc in docs
            ],
            width="stretch",
            hide_index=True,
        )


def page_ingest():
    st.title("Ingest & Ekstraksi")
    st.write("Masukkan PDF putusan ke folder kerja atau proses satu file. Untuk PDF scan, aktifkan ekstraksi detail LLM agar field dapat dibaca via vision.")

    pdfs = find_pdfs(ROOT_DIR)
    st.info(f"Ditemukan {len(pdfs)} PDF di {ROOT_DIR}")

    with st.expander("Daftar PDF", expanded=False):
        st.dataframe([{"file": pdf.name, "size_mb": round(pdf.stat().st_size / 1024 / 1024, 2)} for pdf in pdfs], hide_index=True)

    c1, c2, c3, c4 = st.columns([1, 1, 1, 1])
    max_files = c1.number_input("Jumlah PDF diproses", min_value=1, max_value=max(1, len(pdfs)), value=min(20, max(1, len(pdfs))), step=1)
    overwrite = c2.checkbox("Re-ekstrak dokumen yang sudah ada", value=False)
    process_one = c3.selectbox("Atau proses satu file", ["-"] + [pdf.name for pdf in pdfs])
    use_llm_extraction = c4.checkbox("Ekstraksi detail LLM", value=True)

    if st.button("Jalankan Ingestion", type="primary"):
        progress = st.progress(0)
        if process_one != "-":
            selected = ROOT_DIR / process_one
            try:
                with st.spinner(f"Memproses {selected.name}"):
                    doc = upsert_document(selected, overwrite=overwrite, db_path=DEFAULT_DB_PATH, use_llm_extraction=use_llm_extraction)
                progress.progress(1.0)
                clear_caches()
                st.success(f"Selesai: {doc.putusan_number}")
                render_extraction_summary(doc.document_id)
            except DuplicateDocumentError as exc:
                progress.progress(1.0)
                render_duplicate_warning(exc)
            except ExtractionError as exc:
                progress.progress(1.0)
                render_extraction_error(exc)
        else:
            selected_pdfs = pdfs[: int(max_files)]
            records = []
            duplicate_rows = []
            extraction_errors = []
            for idx, pdf in enumerate(selected_pdfs, start=1):
                try:
                    with st.spinner(f"Memproses {idx}/{len(selected_pdfs)}: {pdf.name}"):
                        records.append(upsert_document(pdf, overwrite=overwrite, db_path=DEFAULT_DB_PATH, use_llm_extraction=use_llm_extraction))
                except DuplicateDocumentError as exc:
                    for item in exc.duplicates:
                        duplicate_rows.append({"input_file": pdf.name, **item})
                except ExtractionError as exc:
                    extraction_errors.append({"input_file": pdf.name, "error": str(exc), "detail": exc.detail})
                progress.progress(idx / len(selected_pdfs))
            clear_caches()
            st.success(f"Selesai memproses {len(records)} putusan. Ditolak duplikat: {len(duplicate_rows)}. Gagal ekstraksi: {len(extraction_errors)}.")
            if records:
                st.dataframe(
                    [
                        {
                            "Putusan": doc.putusan_number,
                            "Jenis Pajak": doc.tax_type,
                            "Isu": doc.issue_type,
                            "Outcome": outcome_badge(doc.outcome),
                            "Status": doc.extraction_status,
                        }
                        for doc in records
                    ],
                    width="stretch",
                    hide_index=True,
                )
            if duplicate_rows:
                st.subheader("Dokumen Duplikat yang Ditolak")
                st.dataframe(duplicate_rows, width="stretch", hide_index=True)
            if extraction_errors:
                st.subheader("Dokumen Gagal Ekstraksi")
                st.dataframe(extraction_errors, width="stretch", hide_index=True)


def page_llm_labeling():
    st.title("LLM Extraction")
    st.write("Gunakan halaman ini untuk mengekstrak ulang detail putusan dengan LLM: metadata putusan, objek sengketa, pihak, pokok sengketa, argumen, pertimbangan, outcome, bukti, dan dasar hukum.")

    load_local_env()
    import os

    key_ready = bool(os.environ.get("OPENAI_API_KEY"))
    model = os.environ.get("TDP_LLM_MODEL", "gpt-5.5")
    if key_ready:
        st.success(f"OPENAI_API_KEY terbaca. Model utama: {model}")
    else:
        st.warning("OPENAI_API_KEY belum terbaca. Isi file .env dahulu.")

    docs, labels = document_options()
    if not docs:
        st.info("Belum ada dokumen yang diingest.")
        return

    st.subheader("Label Satu Dokumen")
    selected_label = st.selectbox("Pilih dokumen", labels, key="llm_single_doc")
    selected_doc = docs[labels.index(selected_label)]
    update_doc = st.checkbox("Pakai hasil LLM untuk memperbarui metadata dokumen", value=True)
    if st.button("Label Dokumen Terpilih", type="primary", disabled=not key_ready):
        with st.spinner("LLM sedang membaca potongan putusan dan membuat label..."):
            result = label_document_with_llm(selected_doc.document_id, update_document=update_doc, db_path=DEFAULT_DB_PATH)
        if result["ok"]:
            clear_caches()
            detail = f" via {result.get('source')}" if result.get("source") else ""
            st.success(f"Label selesai dengan model {result.get('model')}{detail}")
            if result.get("pages"):
                st.caption(f"Halaman scan yang dibaca: {', '.join(str(page) for page in result['pages'])}")
            with st.expander("Raw JSON LLM", expanded=False):
                st.json(result["label"])
            render_extraction_summary(selected_doc.document_id)
        elif result.get("duplicates"):
            render_duplicate_warning(result["duplicates"])
        else:
            st.error(result["error"])

    st.subheader("Batch Labeling")
    c1, c2, c3 = st.columns(3)
    limit = c1.number_input("Jumlah dokumen", min_value=1, max_value=50, value=5, step=1)
    only_unlabeled = c2.checkbox("Hanya yang belum pernah dilabeli", value=True)
    update_batch = c3.checkbox("Update metadata dokumen", value=True)
    if st.button("Jalankan Batch Labeling", disabled=not key_ready):
        progress = st.progress(0)
        results = []
        with st.spinner("Batch labeling berjalan. Ini bisa memakan waktu dan token API."):
            batch_results = batch_label_documents_with_llm(
                limit=int(limit),
                only_unlabeled=only_unlabeled,
                update_document=update_batch,
                db_path=DEFAULT_DB_PATH,
            )
            for idx, item in enumerate(batch_results, start=1):
                results.append(item)
                progress.progress(idx / max(1, len(batch_results)))
        clear_caches()
        ok_count = sum(1 for item in results if item.get("ok"))
        st.success(f"Batch selesai: {ok_count}/{len(results)} berhasil.")
        for item in results:
            if item.get("ok"):
                with st.expander(f"Label berhasil: {item.get('model')}", expanded=False):
                    st.json(item["label"])
            elif item.get("duplicates"):
                render_duplicate_warning(item["duplicates"])
            else:
                st.error(item.get("error"))

    st.subheader("Label Terakhir")
    label_rows = list_llm_labels(limit=25)
    if label_rows:
        st.dataframe(
            [
                {
                    "Waktu": row["created_at"],
                    "Putusan": row["putusan_number"],
                    "Model": row["model"],
                    "WP/Perusahaan": row.get("taxpayer_name"),
                    "Kuasa": row.get("legal_counsel_name"),
                    "Majelis/Hakim": row.get("court_panel") or row.get("judge_names"),
                    "Jenis Pajak": row["tax_type"],
                    "Isu": row["issue_type"],
                    "Outcome": outcome_badge(row["outcome"]),
                    "Confidence": row["confidence"],
                    "File": row["filename"],
                }
                for row in label_rows
            ],
            width="stretch",
            hide_index=True,
        )
    else:
        st.info("Belum ada label LLM tersimpan.")


def page_search():
    st.title("Search Putusan")
    st.write("Cari putusan pembanding dengan keyword atau isu sengketa. Search ini masih lokal berbasis token similarity sederhana.")

    stats = cached_stats()
    if stats["documents"] == 0:
        st.warning("Belum ada putusan yang diingest. Buka menu Ingest & Ekstraksi dulu.")
        return

    with st.form("search_form"):
        query = st.text_area(
            "Query",
            value="PPN pajak masukan faktur pajak SPT pembetulan bukti pembayaran",
            height=90,
        )
        c1, c2, c3, c4 = st.columns(4)
        tax_type = c1.selectbox("Jenis pajak", ["ANY", "PPN", "PPh Badan", "PPh 21", "PPh 23", "PPh 26", "PBB", "Lainnya", "UNKNOWN"])
        issue_type = c2.selectbox("Isu", ["ANY", "DPP_PPN", "PAJAK_MASUKAN", "FAKTUR_PAJAK", "PKPM_KONFIRMASI", "SANKSI", "FORMAL", "PPh", "LAINNYA", "UNKNOWN"])
        outcome = c3.selectbox("Outcome", ["ANY"] + list(OUTCOME_LABELS.keys()))
        limit = c4.slider("Jumlah hasil", min_value=3, max_value=30, value=10)
        submitted = st.form_submit_button("Cari", type="primary")

    if submitted:
        results = search_cases(query, tax_type=tax_type, issue_type=issue_type, outcome=outcome, limit=limit)
        st.subheader(f"Hasil: {len(results)}")
        for idx, item in enumerate(results, start=1):
            render_case_result(item, idx)


def page_regulations():
    st.title("Peraturan")
    st.write("Chatbot dan konektor lokal ke Datacenter Ortax. Untuk tahap ini fokus database aturan PPN.")

    init_regulation_db(DEFAULT_DB_PATH)
    load_local_env()
    stats = get_regulation_stats(DEFAULT_DB_PATH)
    c1, c2, c3 = st.columns(3)
    c1.metric("Peraturan", stats["regulations"])
    c2.metric("Chunks aturan", stats["regulation_chunks"])
    c3.metric("Topik PPN", stats.get("by_topic", {}).get("PPN", 0))

    tab_chat, tab_sync, tab_search, tab_db = st.tabs(["Chatbot Aturan", "Unduh & Sinkronisasi", "Cari Manual", "Database"])

    with tab_chat:
        st.subheader("Tanya Aturan")
        key_ready = bool(__import__("os").environ.get("OPENAI_API_KEY"))
        use_llm = st.checkbox("Gunakan LLM untuk merangkum jawaban", value=key_ready, disabled=not key_ready)
        st.caption("Jawaban memakai database lokal yang sudah diunduh dari Ortax. Setiap jawaban menampilkan lokasi aturan.")

        if "regulation_chat_messages" not in st.session_state:
            st.session_state["regulation_chat_messages"] = [
                {
                    "role": "assistant",
                    "content": "Silakan tanya aturan PPN, misalnya: pajak masukan dapat dikreditkan di aturan mana, atau aturan faktur pajak ada di mana?",
                }
            ]

        for message in st.session_state["regulation_chat_messages"]:
            with st.chat_message(message["role"]):
                st.markdown(message["content"])

        question = st.chat_input("Tanya aturan PPN...")
        if question:
            st.session_state["regulation_chat_messages"].append({"role": "user", "content": question})
            with st.chat_message("user"):
                st.markdown(question)
            with st.chat_message("assistant"):
                with st.spinner("Mencari aturan dan lokasi pasalnya..."):
                    results = search_regulations(question, topic="PPN", limit=6, db_path=DEFAULT_DB_PATH)
                    answer = build_regulation_chat_answer(question, results, use_llm=use_llm)
                st.markdown(answer)
                if results:
                    st.caption("Rujukan cepat")
                    for idx, item in enumerate(results[:4], start=1):
                        label = item.get("title") or item.get("number") or item.get("source_id")
                        st.link_button(f"{idx}. {label}", item.get("url") or "#")
            st.session_state["regulation_chat_messages"].append({"role": "assistant", "content": answer})

        c_reset, c_example = st.columns([1, 3])
        if c_reset.button("Reset Chat"):
            st.session_state.pop("regulation_chat_messages", None)
            st.rerun()
        c_example.caption("Contoh: `Apa syarat pajak masukan bisa dikreditkan?`, `SPT Masa PPN diatur di mana?`, `Restitusi PPN ada di aturan apa?`")

    with tab_sync:
        st.subheader("Unduh Berkala dari Ortax")
        st.write("Klik refresh untuk memperbarui seed PPN dan aturan yang sudah ada di database lokal dari halaman Ortax.")
        c1, c2 = st.columns([1, 1])
        with c1:
            follow_related = st.checkbox("Ikut ambil beberapa aturan terkait PPN", value=True)
            max_related = st.slider("Maksimum aturan terkait", min_value=0, max_value=20, value=8)
            if st.button("Unduh/Refresh Berkala dari Ortax", type="primary"):
                with st.spinner("Sinkronisasi aturan PPN dari Ortax..."):
                    result = refresh_ortax_regulations(
                        db_path=DEFAULT_DB_PATH,
                        topic="PPN",
                        include_seed=True,
                        follow_related=follow_related,
                        max_related=int(max_related),
                    )
                clear_caches()
                st.success(f"Tersimpan/terupdate: {result['stored_count']} aturan. Gagal/skip: {result['error_count']}.")
                if result["errors"]:
                    st.dataframe(result["errors"], width="stretch", hide_index=True)
        with c2:
            source = st.text_input("ID atau URL Ortax tambahan", value="13964")
            if st.button("Unduh ID/URL"):
                with st.spinner("Mengambil peraturan dari Ortax..."):
                    result = fetch_and_store_ortax_regulation(source, db_path=DEFAULT_DB_PATH)
                clear_caches()
                if result["ok"]:
                    rec = result["record"]
                    st.success(f"Tersimpan: {rec.get('title')} ({rec.get('number')})")
                else:
                    st.error(result["error"])

        if st.button("Unduh Seed PPN Saja"):
            with st.spinner("Mengunduh seed peraturan PPN dari Ortax..."):
                result = download_ppn_seed_regulations(
                    db_path=DEFAULT_DB_PATH,
                    follow_related=follow_related,
                    max_related=int(max_related),
                )
            clear_caches()
            st.success(f"Tersimpan/terupdate: {result['stored_count']} aturan. Gagal/skip: {result['error_count']}.")

    with tab_search:
        st.subheader("Search Manual")
        with st.form("regulation_search_form"):
            query = st.text_area(
                "Query aturan",
                value="PPN pajak masukan faktur pajak SPT Masa PPN pengkreditan",
                height=80,
            )
            c1, c2 = st.columns(2)
            topic = c1.selectbox("Topik", ["PPN", "ANY"], index=0)
            limit = c2.slider("Jumlah hasil", min_value=3, max_value=20, value=8)
            submitted = st.form_submit_button("Cari Peraturan", type="primary")
        if submitted:
            results = search_regulations(query, topic=topic, limit=int(limit), db_path=DEFAULT_DB_PATH)
            st.subheader(f"Hasil: {len(results)}")
            for idx, item in enumerate(results, start=1):
                render_regulation_result(item, idx)

    with tab_db:
        st.subheader("Database Peraturan")
        regs = list_regulations(limit=100, db_path=DEFAULT_DB_PATH)
        if regs:
            st.dataframe(
                [
                    {
                        "Judul": reg.get("title"),
                        "Jenis": reg.get("regulation_type"),
                        "Nomor": reg.get("number"),
                        "Tahun": reg.get("year"),
                        "Topik": reg.get("topic"),
                        "Chunks": reg.get("chunk_count"),
                        "URL": reg.get("url"),
                    }
                    for reg in regs
                ],
                width="stretch",
                hide_index=True,
            )
        else:
            st.info("Belum ada peraturan lokal. Klik Unduh/Refresh Berkala dari Ortax untuk memulai.")


def page_analyze():
    st.title(t("manual_title"))
    st.write(t("manual_intro"))

    stats = cached_stats()
    if stats["documents"] == 0:
        st.warning("Belum ada putusan yang diingest. Buka menu Ingest & Ekstraksi dulu.")
        return

    with st.expander(tx("Auto-fill dari dokumen yang sudah dilabeli/diingest", "Auto-fill from labeled/ingested document"), expanded=False):
        docs, labels = document_options()
        if docs:
            selected = st.selectbox(tx("Pilih sumber auto-fill", "Select auto-fill source"), labels, key="analysis_autofill_doc")
            source_doc = docs[labels.index(selected)]
            if st.button(tx("Isi parameter dari dokumen ini", "Fill parameters from this document")):
                st.session_state["analysis_seed"] = build_intake_from_document(source_doc.document_id, db_path=DEFAULT_DB_PATH)
                st.session_state.pop("analysis_last", None)
                st.success("Parameter analisis disiapkan dari dokumen. Form di bawah akan mengikuti hasil auto-fill.")

    seed = st.session_state.get(
        "analysis_seed",
        {
            "taxpayer_name": "Wajib Pajak",
            "stage": "Keberatan",
            "tax_type": "PPN",
            "issue_type": "Pajak Masukan",
            "correction_amount": "Rp 500.000.000",
            "djp_reason": "DJP melakukan koreksi karena faktur pajak atau data konfirmasi lawan transaksi dianggap tidak mendukung.",
            "wp_reason": "WP berpendapat transaksi benar terjadi, faktur pajak tersedia, dan sudah dilaporkan dalam SPT Masa PPN.",
            "available_evidence": ["Faktur Pajak", "SPT Masa PPN", "Bukti Pembayaran", "Rekonsiliasi"],
            "case_notes": "",
        },
    )

    with st.form("case_intake"):
        c1, c2, c3 = st.columns(3)
        taxpayer_name = c1.text_input(tx("Nama WP", "Taxpayer name"), value=seed.get("taxpayer_name", "Wajib Pajak"))
        stage = c2.selectbox(tx("Tahap sengketa", "Dispute stage"), STAGE_OPTIONS, index=STAGE_OPTIONS.index(normalize_choice(seed.get("stage"), STAGE_OPTIONS, "Keberatan")))
        tax_type = c3.selectbox(tx("Jenis pajak", "Tax type"), TAX_OPTIONS, index=TAX_OPTIONS.index(normalize_choice(seed.get("tax_type"), TAX_OPTIONS, "PPN")))

        cparty1, cparty2, cparty3 = st.columns(3)
        taxpayer_npwp = cparty1.text_input("NPWP", value=seed.get("taxpayer_npwp", "") or "")
        legal_counsel_name = cparty2.text_input(tx("Kuasa / Konsultan", "Counsel / consultant"), value=seed.get("legal_counsel_name", "") or "")
        djp_unit = cparty3.text_input(tx("Unit DJP / KPP", "Tax office / DGT unit"), value=seed.get("djp_unit", "") or "")

        cdoc1, cdoc2 = st.columns(2)
        skp_number = cdoc1.text_input(tx("Nomor SKP/STP", "Tax assessment number"), value=seed.get("skp_number", "") or "")
        djp_decision_number = cdoc2.text_input(tx("Nomor KEP/Keputusan", "Objection decision number"), value=seed.get("djp_decision_number", "") or "")

        c4, c5 = st.columns(2)
        issue_type = c4.selectbox(tx("Isu utama", "Main issue"), ISSUE_OPTIONS, index=ISSUE_OPTIONS.index(normalize_choice(seed.get("issue_type"), ISSUE_OPTIONS, "Pajak Masukan")))
        correction_amount = c5.text_input(tx("Nilai koreksi", "Correction amount"), value=seed.get("correction_amount", "Rp 0"))

        djp_reason = st.text_area(
            tx("Alasan DJP", "Tax authority reason"),
            value=seed.get("djp_reason", ""),
            height=110,
        )
        wp_reason = st.text_area(
            tx("Alasan WP", "Taxpayer reason"),
            value=seed.get("wp_reason", ""),
            height=110,
        )
        available_evidence = st.multiselect(
            tx("Bukti tersedia", "Available evidence"),
            EVIDENCE_OPTIONS,
            default=[item for item in seed.get("available_evidence", []) if item in EVIDENCE_OPTIONS],
        )
        case_notes = st.text_area(tx("Catatan tambahan", "Additional notes"), value=seed.get("case_notes", ""), height=80)
        c6, c7, c8 = st.columns(3)
        top_n = c6.slider(tx("Jumlah putusan pembanding", "Number of comparable decisions"), min_value=3, max_value=15, value=8)
        report_language = report_language_select(c7, seed, "analysis_report_language")
        use_llm = c8.checkbox(tx("Gunakan OpenAI LLM jika OPENAI_API_KEY tersedia", "Use OpenAI LLM if OPENAI_API_KEY is available"), value=False)
        submitted = st.form_submit_button(tx("Analisis Kasus", "Analyze Case"), type="primary")

    if submitted:
        intake = {
            "taxpayer_name": taxpayer_name,
            "taxpayer_npwp": taxpayer_npwp,
            "legal_counsel_name": legal_counsel_name,
            "djp_unit": djp_unit,
            "skp_number": skp_number,
            "djp_decision_number": djp_decision_number,
            "stage": stage,
            "tax_type": tax_type,
            "tax_type_filter": tax_type,
            "issue_type": issue_type,
            "correction_amount": correction_amount,
            "djp_reason": djp_reason,
            "wp_reason": wp_reason,
            "available_evidence": available_evidence,
            "case_notes": case_notes,
            "report_language": report_language,
        }
        with st.spinner("Mencari putusan pembanding dan menyusun review..."):
            report_id, similar_cases, result = run_case_analysis(intake, top_n, use_llm)
        st.session_state["analysis_last"] = {
            "report_id": report_id,
            "similar_cases": similar_cases,
            "result": result,
        }

        st.success(f"Analisis selesai. Report ID: {report_id}")

    last_analysis = st.session_state.get("analysis_last")
    if last_analysis:
        report_id = last_analysis["report_id"]
        report = get_report(report_id, db_path=DEFAULT_DB_PATH)
        st.caption(f"Report aktif: {report_id}")
        if report:
            render_report_downloads(report, key_prefix=f"analysis-{report_id}")
        render_analysis_result(last_analysis["result"], last_analysis["similar_cases"])


def render_analysis_result(result, similar_cases):
    c1, c2, c3, c4 = st.columns(4)
    c1.metric(t("score"), result["score"])
    c2.metric(t("confidence"), result["confidence"])
    c3.metric(t("similar_cases"), result["similar_cases_count"])
    c4.metric(t("evidence_score"), result["evidence_score"])

    if result["score"] >= 55:
        st.markdown(f'<div class="ok-box"><b>{t("indication")}:</b> {result["indication"]}</div>', unsafe_allow_html=True)
    else:
        st.markdown(f'<div class="risk-box"><b>{t("indication")}:</b> {result["indication"]}</div>', unsafe_allow_html=True)

    tab1, tab2, tab3, tab4 = st.tabs([t("review_tab"), t("recommendation_tab"), t("comparable_tab"), t("regulation_tab")])

    with tab1:
        st.markdown(display_report_text(result["review"]))
        c1, c2 = st.columns(2)
        with c1:
            st.subheader(tx("Faktor Pendukung", "Supporting Factors"))
            for item in result.get("supporting_factor_analysis", []):
                st.markdown(f"**{display_analysis_title(item['title'])}**")
                st.write(item["analysis"])
        with c2:
            st.subheader(tx("Faktor Risiko", "Risk Factors"))
            for item in result.get("risk_factor_analysis", []):
                st.markdown(f"**{display_analysis_title(item['title'])}**")
                st.write(item["analysis"])
        st.subheader(tx("Celah Bukti", "Evidence Gaps"))
        for item in result.get("evidence_gap_analysis", []):
            st.markdown(f"**{display_analysis_title(item['title'])}**")
            st.write(item["analysis"])
        st.subheader(tx("Dasar Peraturan", "Regulatory Basis"))
        for item in result.get("regulation_analysis", []):
            st.markdown(f"**{item['title']}**")
            st.write(item["analysis"])

    with tab2:
        if result.get("llm_used"):
            st.success(t("llm_deepened"))
        st.markdown(display_report_text(result["recommendation_draft"]))
        st.caption(result["disclaimer"])

    with tab3:
        top_cases = result.get("top_case_analysis") or []
        if top_cases:
            st.subheader(t("top_related_cases"))
            for item in top_cases[:2]:
                render_top_case_analysis(item)
            remaining = similar_cases[2:]
        else:
            remaining = similar_cases
        if remaining:
            with st.expander(t("other_comparables"), expanded=False):
                for idx, item in enumerate(remaining, start=3 if top_cases else 1):
                    render_case_result(item, idx)

    with tab4:
        regulations = result.get("relevant_regulations", [])
        if not regulations:
            st.info(tx(
                "Belum ada peraturan PPN yang cocok. Buka menu Peraturan untuk unduh/refresh dari Ortax.",
                "No matching VAT regulation is available yet. Open the Regulations menu to download or refresh from Ortax.",
            ))
        for idx, item in enumerate(regulations, start=1):
            render_regulation_result(item, idx)


def page_reports():
    st.title(t("reports_title"))
    reports = list_reports(limit=30)
    if not reports:
        st.info("Belum ada report analisis.")
        return

    labels = [
        f"{rep['created_at']} | {rep['input'].get('taxpayer_name', '-')} | {rep['result'].get('score', '-')}"
        for rep in reports
    ]
    selected = st.selectbox("Pilih report" if ui_lang() == "id" else "Select report", labels)
    report = reports[labels.index(selected)]
    result = report["result"]

    st.subheader(t("summary"))
    c1, c2, c3 = st.columns(3)
    c1.metric("Score", result.get("score"))
    c2.metric("Confidence", result.get("confidence"))
    c3.metric(t("similar_cases"), result.get("similar_cases_count"))
    st.markdown(display_report_text(result.get("review", "")))
    st.subheader(t("recommendation_draft"))
    st.markdown(display_report_text(result.get("recommendation_draft", "")))
    top_cases = result.get("top_case_analysis") or []
    if top_cases:
        st.subheader(t("top_related_cases"))
        for item in top_cases[:2]:
            render_top_case_analysis(item)

    render_report_downloads(report, key_prefix=f"reports-{report['report_id']}")


def page_requirements():
    st.title("Kebutuhan Prototype")
    st.write("Yang sudah bisa dipakai lokal sekarang:")
    st.markdown(
        """
        - PDF putusan diletakkan di folder kerja.
        - Ingestion memakai `pypdf`, fallback ke `pdftotext`.
        - Database lokal SQLite di `data/tax_dispute_prototype.sqlite`.
        - Detail ekstraksi tersimpan di tabel `document_extractions`.
        - Guard duplikat hanya memakai nomor putusan yang sudah pernah diekstraksi.
        - Search lokal berbasis token similarity.
        - Prediction sederhana berbasis rubric dan distribusi putusan pembanding.
        - Draft rekomendasi ke WP berbasis template + hasil pencarian.
        - Database peraturan PPN lokal dari Datacenter Ortax untuk konteks dasar hukum.
        - OpenAI LLM dipakai untuk ekstraksi detail jika `OPENAI_API_KEY` tersedia.
        """
    )

    st.write("Yang masih diperlukan untuk meningkatkan akurasi:")
    st.markdown(
        """
        - Label manual minimal 20-50 putusan: jenis pajak, issue, outcome, ringkasan pertimbangan.
        - Template resmi rekomendasi atau memo yang biasa Anda pakai.
        - Daftar taksonomi issue prioritas.
        - Data peraturan/pasal yang ingin dijadikan referensi tetap.
        - Izin/API/sumber resmi untuk pengambilan peraturan dalam skala production.
        - Keputusan apakah nama WP/NPWP perlu dimasking.
        - API key LLM untuk extraction/review yang lebih tajam.
        - OCR cloud atau OCR lokal untuk PDF scan yang text layer-nya buruk.
        """
    )

    st.write("Batasan prototype:")
    st.markdown(
        """
        - Belum memakai PostgreSQL/pgvector.
        - Belum melakukan OCR gambar secara penuh.
        - Belum melakukan citation validation ketat.
        - Prediction masih indikatif dan harus direview ahli pajak.
        - Extraction metadata masih kombinasi regex/heuristik sederhana.
        """
    )


def main():
    page = sidebar()
    if page == "Alur Terpandu":
        page_guided()
    elif page == "Dashboard":
        page_dashboard()
    elif page == "Ingest & Ekstraksi":
        page_ingest()
    elif page == "LLM Extraction":
        page_llm_labeling()
    elif page == "Search Putusan":
        page_search()
    elif page == "Peraturan":
        page_regulations()
    elif page == "Analisis Kasus WP":
        page_analyze()
    elif page == "Reports":
        page_reports()
    else:
        page_requirements()


if __name__ == "__main__":
    main()
