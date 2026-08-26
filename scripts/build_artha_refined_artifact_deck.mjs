import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, Presentation, PresentationFile } from "@oai/artifact-tool";

const FINAL = "/Users/sintzu/TaxDisputeC/outputs/artha-ai-jurist-analysis/Artha_AI_Jurist_Refined_Leadership_Deck_v2_safe.pptx";
const OUTDIR = path.dirname(FINAL);

const C = {
  blue: "#00A3E0",
  green: "#3FA044",
  gray: "#555A5D",
  dark: "#2B2F3A",
  muted: "#667085",
  lightBlue: "#EAF7FC",
  lightGreen: "#EAF6EC",
  line: "#D8E0E6",
  soft: "#F6F8FA",
  white: "#FFFFFF",
  red: "#C0504D",
};

const years = ["FY1", "FY2", "FY3", "FY4", "FY5"];
const revenue = [0.564, 2.16, 6.84, 15.84, 30.0];
const ebitda = [-2.086, -1.65, 0.948, 7.893, 17.518];
const grossMargin = [55.7, 63.0, 71.5, 76.0, 80.0];

function pos(left, top, width, height) {
  return { left, top, width, height };
}

function addText(slide, text, p, style = {}) {
  const shape = slide.shapes.add({
    geometry: "textbox",
    position: p,
    fill: "none",
    line: { style: "solid", fill: "none", width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    fontFace: "Aptos",
    fontSize: style.fontSize ?? 18,
    bold: style.bold ?? false,
    color: style.color ?? C.dark,
    alignment: style.alignment ?? "left",
  };
  return shape;
}

function addBox(slide, p, fill = C.white, line = C.line, radius = "rounded-xl") {
  return slide.shapes.add({
    geometry: "roundRect",
    position: p,
    fill,
    line: { style: "solid", fill: line, width: 1 },
    borderRadius: radius,
    shadow: "shadow-sm",
  });
}

function addRule(slide, left, top, width, color = C.line, height = 2) {
  slide.shapes.add({
    geometry: "rect",
    position: pos(left, top, width, height),
    fill: color,
    line: { style: "solid", fill: "none", width: 0 },
  });
}

function addRsm(slide, left = 68, top = 44, scale = 1) {
  addRule(slide, left, top, 34 * scale, "#8A9299", 8 * scale);
  addRule(slide, left + 52 * scale, top, 86 * scale, C.green, 8 * scale);
  addRule(slide, left + 160 * scale, top, 176 * scale, C.blue, 8 * scale);
  addText(slide, "RSM", pos(left, top + 26 * scale, 160 * scale, 52 * scale), {
    fontSize: Math.round(32 * scale),
    bold: true,
    color: C.gray,
  });
}

function addTitle(slide, title, subtitle = "") {
  addRsm(slide);
  addText(slide, title, pos(68, 118, 1110, 84), {
    fontSize: 38,
    bold: true,
    color: C.dark,
  });
  if (subtitle) {
    addText(slide, subtitle, pos(70, 208, 1030, 38), {
      fontSize: 18,
      color: C.muted,
    });
  }
  addRule(slide, 70, 266, 1140, C.line, 2);
}

function addFooter(slide, text = "Draft for leadership discussion") {
  addText(slide, text, pos(70, 684, 950, 22), {
    fontSize: 12,
    color: C.muted,
  });
}

function addCard(slide, x, y, w, h, accent, title, body) {
  addBox(slide, pos(x, y, w, h));
  addRule(slide, x, y, w, accent, 7);
  addText(slide, title, pos(x + 24, y + 28, w - 48, 42), {
    fontSize: 24,
    bold: true,
    color: C.dark,
  });
  addText(slide, body, pos(x + 24, y + 82, w - 48, h - 104), {
    fontSize: 18,
    color: C.muted,
  });
}

function addMetric(slide, x, y, w, label, value, note, accent = C.blue) {
  addBox(slide, pos(x, y, w, 132));
  addRule(slide, x, y, w, accent, 7);
  addText(slide, label, pos(x + 18, y + 24, w - 36, 28), {
    fontSize: 17,
    bold: true,
    color: C.muted,
  });
  addText(slide, value, pos(x + 18, y + 56, w - 36, 45), {
    fontSize: 34,
    bold: true,
    color: C.gray,
  });
  addText(slide, note, pos(x + 18, y + 104, w - 36, 24), {
    fontSize: 13,
    color: C.muted,
  });
}

function addBulletBlock(slide, items, x, y, w, fontSize = 21) {
  const text = items.map((it) => `• ${it}`).join("\n");
  addText(slide, text, pos(x, y, w, items.length * 38 + 10), {
    fontSize,
    color: C.dark,
  });
}

function addMiniTable(slide, x, y, colWidths, rowHeight, headers, rows) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  addBox(slide, pos(x, y, totalW, rowHeight * (rows.length + 1)), C.white, C.line, "rounded-lg");
  let cx = x;
  for (let c = 0; c < headers.length; c++) {
    slide.shapes.add({
      geometry: "rect",
      position: pos(cx, y, colWidths[c], rowHeight),
      fill: C.gray,
      line: { style: "solid", fill: C.gray, width: 1 },
    });
    addText(slide, headers[c], pos(cx + 12, y + 10, colWidths[c] - 24, rowHeight - 12), {
      fontSize: 16,
      bold: true,
      color: C.white,
    });
    cx += colWidths[c];
  }
  for (let r = 0; r < rows.length; r++) {
    cx = x;
    const fill = r % 2 === 0 ? C.soft : C.white;
    for (let c = 0; c < headers.length; c++) {
      slide.shapes.add({
        geometry: "rect",
        position: pos(cx, y + rowHeight * (r + 1), colWidths[c], rowHeight),
        fill,
        line: { style: "solid", fill: C.line, width: 1 },
      });
      addText(slide, rows[r][c], pos(cx + 12, y + rowHeight * (r + 1) + 10, colWidths[c] - 24, rowHeight - 12), {
        fontSize: 16,
        color: C.dark,
      });
      cx += colWidths[c];
    }
  }
}

function addWorkflow(slide) {
  const labels = [
    ["Upload", "Putusan, aturan,\natau dokumen WP"],
    ["Extract", "Pihak, isu,\nnilai, outcome"],
    ["Compare", "Cari putusan\npaling mirip"],
    ["Analyze", "Risiko, bukti,\ndan argumen"],
    ["Draft", "Word/PDF siap\nreview advisor"],
  ];
  for (let i = 0; i < labels.length; i++) {
    const x = 76 + i * 236;
    addCard(slide, x, 308, 190, 170, i % 2 ? C.green : C.blue, labels[i][0], labels[i][1]);
    if (i < labels.length - 1) {
      addText(slide, "→", pos(x + 198, 365, 32, 30), {
        fontSize: 30,
        bold: true,
        color: C.gray,
      });
    }
  }
}

function addBar(slide, label, value, max, x, y, color, prefix = "Rp", suffix = "bn") {
  const trackWidth = 320;
  addText(slide, label, pos(x, y - 4, 130, 24), { fontSize: 16, bold: true, color: C.muted });
  slide.shapes.add({
    geometry: "rect",
    position: pos(x + 148, y, trackWidth, 12),
    fill: "#E6EDF2",
    line: { style: "solid", fill: "none", width: 0 },
  });
  slide.shapes.add({
    geometry: "rect",
    position: pos(x + 148, y, Math.max(2, trackWidth * Math.abs(value) / max), 12),
    fill: color,
    line: { style: "solid", fill: "none", width: 0 },
  });
  const v = value < 0 ? `${prefix}-${Math.abs(value).toFixed(1)}${suffix}` : `${prefix}${value.toFixed(1)}${suffix}`;
  addText(slide, v, pos(x + 486, y - 8, 88, 24), { fontSize: 15, bold: true, color: C.dark });
}

async function main() {
  await fs.mkdir(OUTDIR, { recursive: true });
  const deck = Presentation.create({ slideSize: { width: 1280, height: 720 } });

  // 1
  {
    const s = deck.slides.add();
    s.background.fill = C.white;
    addRsm(s, 68, 48, 1.25);
    addText(s, "Artha AI Jurist", pos(68, 162, 560, 58), { fontSize: 48, bold: true, color: C.dark });
    addText(s, "Business case for an AI tax-dispute platform", pos(70, 226, 620, 42), { fontSize: 22, color: C.muted });
    addBox(s, pos(750, 142, 430, 170), C.white, C.line);
    addRule(s, 750, 142, 430, C.green, 8);
    addText(s, "Core message", pos(782, 184, 360, 34), { fontSize: 28, bold: true, color: C.dark });
    addText(s, "This should be sold as a workflow product, not just a tax library.", pos(782, 230, 350, 54), { fontSize: 21, color: C.muted });
    addMetric(s, 70, 430, 210, "FY5 Revenue", "Rp30.0bn", "baseline", C.blue);
    addMetric(s, 310, 430, 210, "FY5 EBITDA", "Rp17.5bn", "58.4% margin", C.green);
    addMetric(s, 550, 430, 210, "NPV @15%", "Rp6.8bn", "Rp4.0bn capital", C.blue);
    addMetric(s, 790, 430, 180, "IRR", "36.1%", "baseline", C.gray);
    addMetric(s, 1000, 430, 180, "Payback", "3.86 yrs", "during FY4", C.green);
    addFooter(s, "Based on TaxCo_Model.xlsx; scenarios recalculated where original formulas returned #REF!.");
  }

  // 2
  {
    const s = deck.slides.add();
    s.background.fill = C.white;
    addTitle(s, "The pain is not search. It is turning research into action.", "Tax teams need faster, traceable drafts for disputes, audits, and client advice.");
    addCard(s, 76, 300, 330, 210, C.blue, "Today", "Research is fragmented across rules, court decisions, and prior workpapers.");
    addCard(s, 475, 300, 330, 210, C.green, "The gap", "Existing tools help find information, but do not reliably structure the dispute argument.");
    addCard(s, 874, 300, 330, 210, C.gray, "The opportunity", "AI can prepare first drafts if every answer is linked to sources and reviewed by experts.");
    addFooter(s, "External references are summarized in the business analysis report.");
  }

  // 3
  {
    const s = deck.slides.add();
    s.background.fill = C.white;
    addTitle(s, "The best wedge is dispute workflow, not a generic library.", "The platform becomes stronger when it combines documents, precedents, rules, and drafting.");
    addWorkflow(s);
    addBox(s, pos(116, 540, 1048, 82), C.lightGreen, C.green, "rounded-lg");
    addText(s, "Management implication: approve a controlled pilot first, then scale the product after measured advisor productivity gains.", pos(148, 562, 980, 46), { fontSize: 20, bold: true, color: C.dark });
    addFooter(s);
  }

  // 4
  {
    const s = deck.slides.add();
    s.background.fill = C.white;
    addTitle(s, "The addressable market is attractive, but source validation is still needed.", "The model has a clear target universe; leadership should ask for primary-source validation before a full funding decision.");
    addMetric(s, 86, 292, 190, "Consultants", "7.5k", "model source", C.blue);
    addMetric(s, 310, 292, 190, "Corporate seats", "33.3k", "model estimate", C.green);
    addMetric(s, 534, 292, 210, "Professional users", "40.8k", "paying universe", C.gray);
    addMetric(s, 778, 292, 190, "Student funnel", "50k", "Lite segment", C.blue);
    addMetric(s, 1002, 292, 190, "Workflow target", "500", "FY5 seats", C.green);
    addBox(s, pos(100, 505, 1080, 88), C.lightBlue, C.blue, "rounded-lg");
    addText(s, "Important: keep the market story conservative until consultant counts, corporate SPT universe, and tax court case volume are verified from primary sources.", pos(132, 528, 1010, 54), { fontSize: 20, bold: true, color: C.dark });
    addFooter(s);
  }

  // 5
  {
    const s = deck.slides.add();
    s.background.fill = C.white;
    addTitle(s, "Pricing works if Lite is treated as a funnel.", "The profit engine is Premium, Workflow, and Enterprise, not low-price research seats.");
    addMiniTable(s, 95, 292, [160, 190, 520], 58, ["Tier", "Price / year", "Role"], [
      ["Lite", "Rp0.6m", "Entry product for students and light research"],
      ["Premium", "Rp4.8m", "Core paid research product"],
      ["Workflow", "Rp24m", "Drafting and dispute-preparation module"],
      ["Enterprise", "Rp120m", "Account-level deployment and governance"],
    ]);
    addBox(s, pos(180, 580, 920, 72), C.lightGreen, C.green, "rounded-lg");
    addText(s, "Recommended focus: convert users into Workflow and Enterprise once the RSM pilot proves measurable time savings.", pos(210, 600, 860, 42), { fontSize: 19, bold: true, color: C.dark });
    addFooter(s);
  }

  // 6
  {
    const s = deck.slides.add();
    s.background.fill = C.white;
    addTitle(s, "The baseline model becomes profitable in FY3.", "Cumulative payback happens in FY4, so the story should separate annual profit from cash recovery.");
    const maxRev = 30;
    const maxE = 18;
    for (let i = 0; i < years.length; i++) {
      addBar(s, `${years[i]} rev`, revenue[i], maxRev, 100, 312 + i * 48, C.blue);
      addBar(s, `${years[i]} EBITDA`, ebitda[i], maxE, 700, 312 + i * 48, ebitda[i] < 0 ? C.red : C.green);
    }
    addMetric(s, 108, 548, 220, "FY5 gross margin", "80.0%", "from workbook", C.blue);
    addMetric(s, 385, 548, 220, "FY5 EBITDA margin", "58.4%", "from workbook", C.green);
    addMetric(s, 662, 548, 250, "5Y cumulative EBITDA", "Rp22.6bn", "baseline", C.gray);
    addMetric(s, 970, 548, 210, "FY3 break-even", "Rp5.5bn", "revenue required", C.blue);
    addFooter(s, "Correction to source deck: FY5 gross margin is 80%; about 50% refers more closely to FY4 EBITDA margin.");
  }

  // 7
  {
    const s = deck.slides.add();
    s.background.fill = C.white;
    addTitle(s, "Scenario analysis shows the model is sensitive to paid conversion.", "The original scenario sheet had broken references, so this version rebuilds the cases transparently.");
    addMiniTable(s, 95, 286, [170, 150, 170, 170, 170, 140, 150], 56, ["Scenario", "Multiplier", "FY5 Revenue", "FY5 EBITDA", "NPV @15%", "IRR", "Payback"], [
      ["Worst", "0.6x", "Rp18.0bn", "Rp7.9bn", "Rp-2.5bn", "4.3%", "4.80 yrs"],
      ["Basic", "0.8x", "Rp24.0bn", "Rp12.7bn", "Rp2.1bn", "22.5%", "4.21 yrs"],
      ["Baseline", "1.0x", "Rp30.0bn", "Rp17.5bn", "Rp6.8bn", "36.1%", "3.86 yrs"],
      ["Moderate", "1.4x", "Rp42.0bn", "Rp27.1bn", "Rp16.1bn", "56.9%", "3.33 yrs"],
    ]);
    addBox(s, pos(140, 568, 1000, 76), C.lightBlue, C.blue, "rounded-lg");
    addText(s, "Decision point: approve staged funding only after the pilot validates conversion, draft quality, and advisor time savings.", pos(170, 588, 930, 42), { fontSize: 19, bold: true, color: C.dark });
    addFooter(s);
  }

  // 8
  {
    const s = deck.slides.add();
    s.background.fill = C.white;
    addTitle(s, "The moat comes from RSM expertise and verified data.", "Generic AI can answer questions; a trusted platform must show sources, logic, and reviewer control.");
    addCard(s, 90, 304, 330, 215, C.gray, "Avoid", "Competing as a generic regulation search tool. That market can become a price race.");
    addCard(s, 475, 304, 330, 215, C.blue, "Build", "A labeled dispute database, comparator logic, extraction QA, and reusable drafting workflows.");
    addCard(s, 860, 304, 330, 215, C.green, "Protect", "RSM review standards, source traceability, audit logs, and controlled access to client data.");
    addFooter(s);
  }

  // 9
  {
    const s = deck.slides.add();
    s.background.fill = C.white;
    addTitle(s, "Governance must be part of the product from day one.", "Because the output affects tax positions, user trust depends on control and traceability.");
    addMiniTable(s, 115, 288, [310, 220, 570], 62, ["Risk", "Level", "Mitigation"], [
      ["Taxpayer data privacy", "High", "Data wall, role-based access, anonymization, audit logs"],
      ["Wrong legal inference", "High", "RAG citations, confidence scoring, mandatory human review"],
      ["Extraction errors", "Medium", "Validation queue, re-extraction, completeness score"],
      ["Weak paid conversion", "Medium", "Pilot KPIs and premium feature gating"],
    ]);
    addFooter(s, "Regulatory reference: UU No. 27/2022 on Personal Data Protection should be part of the governance checklist.");
  }

  // 10
  {
    const s = deck.slides.add();
    s.background.fill = C.white;
    addTitle(s, "Recommended decision: approve a focused 90-day pilot.", "The pilot should prove value before leadership commits to a larger build-out.");
    addCard(s, 88, 296, 330, 250, C.blue, "1. Fix the model", "Repair scenario formulas, reconcile capital ask, and lock the assumption register.");
    addCard(s, 475, 296, 330, 250, C.green, "2. Pilot with RSM", "Measure time saved, draft quality, source accuracy, and reviewer satisfaction.");
    addCard(s, 862, 296, 330, 250, C.gray, "3. Decide funding", "Scale only if paid demand, governance readiness, and data quality are proven.");
    addBox(s, pos(180, 596, 920, 68), C.lightGreen, C.green, "rounded-lg");
    addText(s, "Leadership ask: approve pilot scope, pilot KPIs, and the corrected financial model as the next gate.", pos(212, 614, 860, 38), { fontSize: 19, bold: true, color: C.dark });
    addFooter(s);
  }

  const pptx = await PresentationFile.exportPptx(deck);
  await pptx.save(FINAL);

  const montage = await deck.export({ format: "webp", montage: true, scale: 1 });
  await fs.writeFile(
    "/Users/sintzu/TaxDisputeC/outputs/artha-ai-jurist-analysis/Artha_AI_Jurist_Refined_Leadership_Deck_v2_safe_montage.webp",
    new Uint8Array(await montage.arrayBuffer())
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
