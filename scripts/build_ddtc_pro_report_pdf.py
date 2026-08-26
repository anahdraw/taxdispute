#!/usr/bin/env python3
"""Build a polished PDF from the DDTC Pro information map Markdown report."""

from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "DDTC_PRO_INFORMATION_MAP_2026-08-20.md"
OUTPUT = ROOT / "output" / "pdf" / "DDTC_Pro_Information_Map_2026-08-20.pdf"

PAGE_W, PAGE_H = A4
NAVY = colors.HexColor("#082A55")
BLUE = colors.HexColor("#087FB8")
CYAN = colors.HexColor("#19A7CE")
GREEN = colors.HexColor("#35A62B")
INK = colors.HexColor("#24313D")
MUTED = colors.HexColor("#667684")
LINE = colors.HexColor("#D8E4EC")
PALE_BLUE = colors.HexColor("#EEF7FB")
PALE_GREEN = colors.HexColor("#EFF8F0")
PALE_GRAY = colors.HexColor("#F6F8FA")
WHITE = colors.white


def ascii_safe(text: str) -> str:
    replacements = {
        "\u2010": "-",
        "\u2011": "-",
        "\u2012": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\u2265": ">=",
        "\u2264": "<=",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u00a0": " ",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    return text


def inline_markup(text: str) -> str:
    text = ascii_safe(text.strip())
    links: list[tuple[str, str]] = []

    def stash_link(match: re.Match[str]) -> str:
        links.append((match.group(1), match.group(2)))
        return f"@@LINK{len(links) - 1}@@"

    text = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)", stash_link, text)
    text = html.escape(text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", text)
    for index, (label, url) in enumerate(links):
        token = f"@@LINK{index}@@"
        replacement = (
            f"<link href='{html.escape(url, quote=True)}' color='#087FB8'>"
            f"<u>{html.escape(ascii_safe(label))}</u></link>"
        )
        text = text.replace(token, replacement)
    return text


styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="CoverTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=27,
        leading=32,
        textColor=NAVY,
        alignment=TA_LEFT,
        spaceAfter=7 * mm,
    )
)
styles.add(
    ParagraphStyle(
        name="CoverSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=13,
        leading=19,
        textColor=MUTED,
        spaceAfter=10 * mm,
    )
)
styles.add(
    ParagraphStyle(
        name="Meta",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=9.2,
        leading=14,
        textColor=INK,
    )
)
styles.add(
    ParagraphStyle(
        name="TOCTitle",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=20,
        leading=24,
        textColor=NAVY,
        spaceAfter=8 * mm,
    )
)
styles.add(
    ParagraphStyle(
        name="H1Custom",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=19,
        leading=23,
        textColor=NAVY,
        spaceBefore=3 * mm,
        spaceAfter=4 * mm,
        keepWithNext=True,
    )
)
styles.add(
    ParagraphStyle(
        name="H2Custom",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=14.5,
        leading=18,
        textColor=NAVY,
        spaceBefore=6 * mm,
        spaceAfter=3 * mm,
        keepWithNext=True,
    )
)
styles.add(
    ParagraphStyle(
        name="H3Custom",
        parent=styles["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=11.5,
        leading=15,
        textColor=BLUE,
        spaceBefore=4 * mm,
        spaceAfter=2 * mm,
        keepWithNext=True,
    )
)
styles.add(
    ParagraphStyle(
        name="BodyCustom",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9.2,
        leading=14,
        textColor=INK,
        spaceAfter=2.4 * mm,
        splitLongWords=True,
    )
)
styles.add(
    ParagraphStyle(
        name="BulletCustom",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9.1,
        leading=13.5,
        textColor=INK,
        leftIndent=9 * mm,
        firstLineIndent=0,
        bulletIndent=2 * mm,
        spaceAfter=1.2 * mm,
    )
)
styles.add(
    ParagraphStyle(
        name="Note",
        parent=styles["BodyText"],
        fontName="Helvetica-Oblique",
        fontSize=8.8,
        leading=13.5,
        textColor=INK,
        leftIndent=4 * mm,
        rightIndent=4 * mm,
        spaceBefore=2 * mm,
        spaceAfter=3 * mm,
    )
)
styles.add(
    ParagraphStyle(
        name="TableHeader",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=7.8,
        leading=10.2,
        textColor=WHITE,
    )
)
styles.add(
    ParagraphStyle(
        name="TableCell",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=7.5,
        leading=10.3,
        textColor=INK,
    )
)
styles.add(
    ParagraphStyle(
        name="TOCLevel1",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=9.8,
        leading=13.2,
        textColor=NAVY,
        leftIndent=0,
        firstLineIndent=0,
        spaceBefore=1.2 * mm,
    )
)
styles.add(
    ParagraphStyle(
        name="TOCLevel2",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.3,
        leading=10.8,
        textColor=MUTED,
        leftIndent=7 * mm,
        firstLineIndent=0,
    )
)


class ReportDocTemplate(BaseDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            style = flowable.style.name
            if style in {"H2Custom", "H3Custom"}:
                level = 0 if style == "H2Custom" else 1
                text = flowable.getPlainText()
                key = f"section-{self.seq.nextf('section')}"
                self.canv.bookmarkPage(key)
                if level == 0:
                    self.canv.addOutlineEntry(text, key, 0, False)
                self.notify("TOCEntry", (level, text, self.page, key))


def cover_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PALE_BLUE)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - 48 * mm, PAGE_W, 48 * mm, fill=1, stroke=0)
    canvas.setFillColor(CYAN)
    canvas.rect(0, PAGE_H - 51 * mm, PAGE_W, 3 * mm, fill=1, stroke=0)
    canvas.setFillColor(GREEN)
    canvas.circle(PAGE_W - 23 * mm, PAGE_H - 24 * mm, 8 * mm, fill=1, stroke=0)
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawCentredString(PAGE_W - 23 * mm, PAGE_H - 27 * mm, "PRO")
    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 11)
    canvas.drawString(18 * mm, PAGE_H - 21 * mm, "ALPHA AI JURIST")
    canvas.setFont("Helvetica", 8.5)
    canvas.drawString(18 * mm, PAGE_H - 28 * mm, "Competitive intelligence and product mapping")
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica", 7.8)
    canvas.drawRightString(PAGE_W - 17 * mm, 12 * mm, "Confidential working report - 20 August 2026")
    canvas.restoreState()


def body_background(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(WHITE)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.restoreState()


def body_decorations(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawRightString(PAGE_W - 17 * mm, 9.5 * mm, str(doc.page))
    canvas.restoreState()


def make_table(rows: list[list[str]], available_width: float) -> Table:
    columns = len(rows[0])
    if columns == 3:
        widths = [0.20 * available_width, 0.16 * available_width, 0.64 * available_width]
    elif columns == 2:
        widths = [0.32 * available_width, 0.68 * available_width]
    elif columns == 4:
        widths = [0.27 * available_width] + [0.243 * available_width] * 3
    else:
        widths = [available_width / columns] * columns

    data = []
    for row_index, row in enumerate(rows):
        style = styles["TableHeader"] if row_index == 0 else styles["TableCell"]
        data.append([Paragraph(inline_markup(cell), style) for cell in row])

    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for row_index in range(1, len(rows)):
        commands.append(("BACKGROUND", (0, row_index), (-1, row_index), WHITE if row_index % 2 else PALE_GRAY))
    table.setStyle(TableStyle(commands))
    return table


def parse_markdown(markdown: str, available_width: float):
    lines = markdown.splitlines()
    story = []
    index = 0
    skip_header = True

    while index < len(lines):
        raw = lines[index].rstrip()
        stripped = raw.strip()

        if skip_header:
            if stripped.startswith("## 1."):
                skip_header = False
            else:
                index += 1
                continue

        if not stripped:
            story.append(Spacer(1, 1.2 * mm))
            index += 1
            continue

        if stripped.startswith("|:") or (stripped.startswith("|") and set(stripped.replace("|", "").replace(":", "").replace("-", "").strip()) == set()):
            index += 1
            continue

        if stripped.startswith("|"):
            table_lines = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                table_lines.append(lines[index].strip())
                index += 1
            rows = []
            for line_index, table_line in enumerate(table_lines):
                cells = [cell.strip() for cell in table_line.strip("|").split("|")]
                if line_index == 1 and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
                    continue
                rows.append(cells)
            if rows:
                story.extend([Spacer(1, 1.5 * mm), make_table(rows, available_width), Spacer(1, 3 * mm)])
            continue

        if stripped.startswith("## "):
            story.append(Paragraph(inline_markup(stripped[3:]), styles["H2Custom"]))
            index += 1
            continue

        if stripped.startswith("### "):
            story.append(Paragraph(inline_markup(stripped[4:]), styles["H3Custom"]))
            index += 1
            continue

        if stripped.startswith(">"):
            quote_lines = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quote_lines.append(lines[index].strip().lstrip(">").strip())
                index += 1
            note = Table(
                [[Paragraph(inline_markup(" ".join(quote_lines)), styles["Note"]) ]],
                colWidths=[available_width],
            )
            note.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), PALE_BLUE),
                        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                        ("LINEBEFORE", (0, 0), (0, -1), 3, CYAN),
                        ("LEFTPADDING", (0, 0), (-1, -1), 7),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                        ("TOPPADDING", (0, 0), (-1, -1), 6),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ]
                )
            )
            story.append(note)
            continue

        if re.match(r"^[-*] ", stripped):
            while index < len(lines) and re.match(r"^[-*] ", lines[index].strip()):
                item_text = re.sub(r"^[-*] ", "", lines[index].strip())
                story.append(
                    Paragraph(
                        inline_markup(item_text),
                        styles["BulletCustom"],
                        bulletText="-",
                    )
                )
                index += 1
            story.append(Spacer(1, 1.5 * mm))
            continue

        if re.match(r"^\d+\. ", stripped):
            while index < len(lines) and re.match(r"^\d+\. ", lines[index].strip()):
                item_number = re.match(r"^(\d+)\. ", lines[index].strip()).group(1)
                item_text = re.sub(r"^\d+\. ", "", lines[index].strip())
                story.append(
                    Paragraph(
                        inline_markup(item_text),
                        styles["BulletCustom"],
                        bulletText=f"{item_number}.",
                    )
                )
                index += 1
            story.append(Spacer(1, 1.5 * mm))
            continue

        paragraph_lines = [stripped]
        index += 1
        while index < len(lines):
            candidate = lines[index].strip()
            if not candidate or candidate.startswith(("## ", "### ", "|", ">", "- ", "* ")) or re.match(r"^\d+\. ", candidate):
                break
            paragraph_lines.append(candidate)
            index += 1
        story.append(Paragraph(inline_markup(" ".join(paragraph_lines)), styles["BodyCustom"]))

    return story


def build_pdf():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    markdown = SOURCE.read_text(encoding="utf-8")
    available_width = PAGE_W - 34 * mm

    frame = Frame(17 * mm, 17 * mm, available_width, PAGE_H - 34 * mm, id="main")
    cover_template = PageTemplate(id="cover", frames=[frame], onPage=cover_page)
    body_template = PageTemplate(
        id="body",
        frames=[frame],
        onPage=body_background,
        onPageEnd=body_decorations,
    )
    doc = ReportDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=17 * mm,
        leftMargin=17 * mm,
        topMargin=17 * mm,
        bottomMargin=17 * mm,
        title="Pemetaan DDTC Perpajakan - Paket Pro",
        author="Alpha AI Jurist",
        subject="Competitive intelligence and product mapping",
    )
    doc.addPageTemplates([cover_template, body_template])

    story = [
        Spacer(1, 53 * mm),
        Paragraph("Pemetaan DDTC Perpajakan", styles["CoverTitle"]),
        Paragraph("Paket Pro - informasi, fitur, pola kerja, dan implikasi untuk Alpha AI Jurist", styles["CoverSubtitle"]),
    ]

    meta = Table(
        [
            [Paragraph("TANGGAL OBSERVASI", styles["TableHeader"]), Paragraph("AKSES", styles["TableHeader"])],
            [Paragraph("20 Agustus 2026", styles["Meta"]), Paragraph("Sesi Microsoft Edge terautentikasi - paket Pro", styles["Meta"])],
            [Paragraph("CAKUPAN", styles["TableHeader"]), Paragraph("METODE", styles["TableHeader"])],
            [Paragraph("Sumber hukum, panduan, publikasi, data operasional, dan alur riset", styles["Meta"]), Paragraph("Observasi struktural read-only; tanpa penyalinan massal konten berbayar", styles["Meta"])],
        ],
        colWidths=[0.48 * available_width, 0.52 * available_width],
    )
    meta.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("BACKGROUND", (0, 2), (-1, 2), NAVY),
                ("BACKGROUND", (0, 1), (-1, 1), WHITE),
                ("BACKGROUND", (0, 3), (-1, 3), WHITE),
                ("GRID", (0, 0), (-1, -1), 0.6, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.extend(
        [
            meta,
            Spacer(1, 11 * mm),
            HRFlowable(width="100%", thickness=1.2, color=CYAN),
            Spacer(1, 5 * mm),
            Paragraph(
                "DDTC Pro paling tepat dipahami sebagai portal riset perpajakan terpadu: sumber hukum primer, konteks temporal dan relasional, panduan editorial, data operasional, serta alat riset pribadi dalam satu produk.",
                styles["CoverSubtitle"],
            ),
            NextPageTemplate("body"),
            PageBreak(),
            Paragraph("Daftar isi", styles["TOCTitle"]),
        ]
    )

    toc = TableOfContents()
    toc.levelStyles = [styles["TOCLevel1"], styles["TOCLevel2"]]
    story.extend([toc, PageBreak()])
    story.extend(parse_markdown(markdown, available_width))

    doc.multiBuild(story)
    return OUTPUT


if __name__ == "__main__":
    print(build_pdf())
