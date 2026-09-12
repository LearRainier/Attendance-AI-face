import { jsPDF } from "jspdf";
import type { AnalyticsSummary, UserProfile } from "@/api";

// Strict Color Palette matching user guidelines:
// - Red (accent for header banners & logo watermark)
// - Black (for text, numbers, labels, lines, borders)
// - White (for card backgrounds, page background, text on dark/red headers)
// - Green (Clean/On-Time logs on DTR, and gradient-green on monthly analytics heatmap)
// - Yellow (Late logs on DTR)
// - NO other colors
const COLORS = {
  accentRed: [185, 28, 28], // #b91c1c (SHC Crimson Red Header Accent)
  accentRedDark: [153, 27, 27], // #991b1b
  black: [17, 24, 39], // #111827 (Primary black for text, numbers, lines)
  textMuted: [107, 114, 128], // #6b7280 (Secondary black/gray for labels)
  border: [229, 231, 235], // #e5e7eb (Light border)
  borderDark: [156, 163, 175], // #9ca3af (Medium border)
  cardBg: [255, 255, 255], // Pure White
  white: [255, 255, 255],

  // DTR Individual Logs: Green - Yellow - None rule
  green: [22, 163, 74], // #16a34a (Clean / On Time text & border)
  greenBg: [220, 252, 231], // #dcfce7 (Clean / On Time cell fill)
  yellow: [202, 138, 4], // #ca8a04 (Late login text & border)
  yellowBg: [254, 249, 195], // #fef9c3 (Late login cell fill)

  // Monthly Analytics Heatmap: None-to-GradientGreen rule
  heatmapTiers: [
    [255, 255, 255], // 0% (None / White)
    [220, 252, 231], // 1-25% (Light Green)
    [134, 239, 172], // 25-50% (Soft Green)
    [34, 197, 94], // 50-75% (Medium Green)
    [21, 128, 61], // 75-100% (Dark Green)
  ],
};

function formatPhtDate(d: Date = new Date()): string {
  return d.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

let cachedWatermarkDataUrl: string | null = null;

/**
 * Generates a big, very low opacity watermark of the SHC institutional logo.
 * Renders via an offscreen canvas with globalAlpha (0.07) baked directly
 * into the PNG pixels so that all PDF viewers render it cleanly.
 */
async function getLogoWatermarkDataUrl(opacity = 0.07): Promise<string | null> {
  if (cachedWatermarkDataUrl) return cachedWatermarkDataUrl;
  if (typeof window === "undefined" || typeof document === "undefined") return null;

  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Watermark image not found"));
      img.src = "/shc logo.png";
    });

    const canvas = document.createElement("canvas");
    const size = 600;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, size, size);
    ctx.globalAlpha = opacity;
    ctx.drawImage(img, 0, 0, size, size);

    cachedWatermarkDataUrl = canvas.toDataURL("image/png");
    return cachedWatermarkDataUrl;
  } catch (err) {
    console.warn("Could not load SHC logo for watermark:", err);
    return null;
  }
}

/**
 * Places the watermark logo directly in the center of the A4 page.
 */
async function renderLogoWatermark(doc: jsPDF, pageWidth = 210, pageHeight = 297): Promise<void> {
  const logoData = await getLogoWatermarkDataUrl(0.07);
  if (!logoData) return;

  const wmSize = 120; // 120mm x 120mm prominent watermark
  const wmX = (pageWidth - wmSize) / 2;
  const wmY = (pageHeight - wmSize) / 2;

  try {
    doc.addImage(logoData, "PNG", wmX, wmY, wmSize, wmSize);
  } catch (err) {
    console.warn("Watermark rendering skipped:", err);
  }
}

/**
 * Export Comprehensive Analytics Report to PDF.
 * Styled with:
 * - Red institutional header banner & period badge
 * - Black text, numbers, lines, and borders
 * - White card backgrounds
 * - None-to-GradientGreen density heatmap
 * - Faint center logo watermark
 */
export async function exportAnalyticsReportPdf(summary: AnalyticsSummary): Promise<void> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // 1. Header Banner (Solid Crimson Red Accent with White Text)
  doc.setFillColor(COLORS.accentRed[0], COLORS.accentRed[1], COLORS.accentRed[2]);
  doc.roundedRect(margin, 12, contentWidth, 28, 3, 3, "F");

  // Title & Subtitle
  doc.setTextColor(COLORS.white[0], COLORS.white[1], COLORS.white[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("SHC MG FACE ATTENDANCE SYSTEM", margin + 6, 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(245, 245, 245);
  doc.text("Contactless Facial Recognition Attendance & Analytics Report", margin + 6, 28);

  // Period Badge (White Box with Crimson Header and Black Label)
  doc.setFillColor(COLORS.white[0], COLORS.white[1], COLORS.white[2]);
  doc.roundedRect(pageWidth - margin - 56, 18, 50, 16, 2, 2, "F");
  doc.setTextColor(COLORS.accentRed[0], COLORS.accentRed[1], COLORS.accentRed[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("FILTER PERIOD", pageWidth - margin - 51, 23.5);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
  doc.text(summary.filter_label, pageWidth - margin - 51, 29);

  let y = 45;

  // 2. Executive KPI Cards (Row of 4, White Background with Black Text & Numbers)
  const cardWidth = (contentWidth - 9) / 4;
  const kpis = [
    { label: "Registered Users", value: String(summary.registered_count), sub: "Total Database" },
    { label: "Active Attendees", value: String(summary.unique_active), sub: `${summary.total_sessions} check-ins` },
    { label: "Avg Attendance", value: `${summary.avg_daily_rate}%`, sub: "Daily Activity Rate" },
    { label: "Punctuality Rate", value: `${summary.punctuality_rate}%`, sub: `${summary.total_late} total late(s)` },
  ];

  kpis.forEach((kpi, i) => {
    const x = margin + i * (cardWidth + 3);
    doc.setFillColor(COLORS.cardBg[0], COLORS.cardBg[1], COLORS.cardBg[2]);
    doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
    doc.roundedRect(x, y, cardWidth, 22, 2, 2, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
    doc.text(kpi.label, x + 3, y + 5.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
    doc.text(kpi.value, x + 3, y + 13);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
    doc.text(kpi.sub, x + 3, y + 18.5);
  });

  y += 28;

  // 3. Attendance Density Heatmap (None-to-GradientGreen Rule)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
  doc.text("Attendance Density Heatmap (None-to-Gradient Green)", margin, y);

  // Gradient Legend
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
  doc.text("0%", pageWidth - margin - 38, y);
  COLORS.heatmapTiers.forEach((rgb, idx) => {
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
    doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
    doc.rect(pageWidth - margin - 33 + idx * 5, y - 2.5, 4.5, 3, "FD");
  });
  doc.text("100%", pageWidth - margin - 7, y);

  y += 4;

  // Heatmap Calendar Grid
  const cols = 7;
  const colNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cellSize = contentWidth / cols;
  const cellHeight = summary.period === "week" ? 14 : 10;

  // Table header (Solid Red Accent with White Text)
  doc.setFillColor(COLORS.accentRed[0], COLORS.accentRed[1], COLORS.accentRed[2]);
  doc.roundedRect(margin, y, contentWidth, 6, 1.5, 1.5, "F");
  doc.setTextColor(COLORS.white[0], COLORS.white[1], COLORS.white[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  colNames.forEach((name, i) => {
    doc.text(name, margin + i * cellSize + cellSize / 2, y + 4.2, { align: "center" });
  });

  y += 7;

  // Pad cells
  const firstDay = summary.heatmap[0];
  let startCol = 0;
  if (firstDay && summary.period === "month") {
    const [yr, mo, dy] = firstDay.date.split("-").map(Number);
    startCol = new Date(yr, mo - 1, dy).getDay();
  }

  const allCells: (typeof summary.heatmap[0] | null)[] = [];
  for (let i = 0; i < startCol; i++) allCells.push(null);
  summary.heatmap.forEach((d) => allCells.push(d));

  let currentX = margin;
  let currentY = y;

  allCells.forEach((cell, idx) => {
    const colIdx = idx % cols;
    currentX = margin + colIdx * cellSize;

    if (!cell) {
      doc.setFillColor(COLORS.white[0], COLORS.white[1], COLORS.white[2]);
      doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
      doc.rect(currentX, currentY, cellSize, cellHeight, "FD");
    } else {
      // Determine gradient green color (0% = None/White, 1-100% = Green tiers)
      const ratio = summary.registered_count > 0 ? cell.attendees_count / summary.registered_count : 0;
      let rgb = COLORS.heatmapTiers[0];
      let textColor = COLORS.black;
      if (ratio > 0.75) {
        rgb = COLORS.heatmapTiers[4];
        textColor = COLORS.white;
      } else if (ratio > 0.5) {
        rgb = COLORS.heatmapTiers[3];
        textColor = COLORS.white;
      } else if (ratio > 0.25) {
        rgb = COLORS.heatmapTiers[2];
        textColor = COLORS.black;
      } else if (ratio > 0) {
        rgb = COLORS.heatmapTiers[1];
        textColor = [21, 128, 61];
      }

      doc.setFillColor(rgb[0], rgb[1], rgb[2]);
      doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
      doc.roundedRect(currentX + 0.4, currentY + 0.4, cellSize - 0.8, cellHeight - 0.8, 1, 1, "FD");

      // Day number
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(textColor[0], textColor[1], textColor[2]);
      doc.text(String(cell.day), currentX + 2, currentY + 3.8);

      // Attendees info
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.text(`${cell.attendees_count}/${summary.registered_count}`, currentX + cellSize / 2, currentY + cellHeight - 2, {
        align: "center",
      });

      // Late indicator (Yellow dot rule)
      if (cell.late_count > 0) {
        doc.setFillColor(COLORS.yellow[0], COLORS.yellow[1], COLORS.yellow[2]);
        doc.circle(currentX + cellSize - 2.5, currentY + 2.5, 1, "F");
      }
    }

    if (colIdx === cols - 1) {
      currentY += cellHeight;
    }
  });

  if (allCells.length % cols !== 0) {
    currentY += cellHeight;
  }

  y = currentY + 7;

  // 4. Rankings Section: 3 Columns (Black text, White cards, Red/Black/Yellow accents)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
  doc.text("Attendance Rankings & Behavioral Insights", margin, y);

  y += 4;

  const rankColWidth = (contentWidth - 6) / 3;
  const maxRankRows = 15;
  const rankRowHeight = 4.8;
  const rankBoxHeight = 12 + maxRankRows * rankRowHeight;

  // Card 1: Top 15 Most Logins
  renderRankCard(
    doc,
    margin,
    y,
    rankColWidth,
    rankBoxHeight,
    "Top 15 Most Logins",
    "Highest attendance in period",
    COLORS.accentRed,
    COLORS.accentRed,
    summary.top_most_logins.map((item, i) => ({
      rank: i + 1,
      name: item.name,
      badge: `${item.count} log(s)`,
      sub: `${item.clean} clean, ${item.lates} late`,
    }))
  );

  // Card 2: Top 15 Low Logins
  renderRankCard(
    doc,
    margin + rankColWidth + 3,
    y,
    rankColWidth,
    rankBoxHeight,
    "Top 15 Low Logins",
    "Lowest check-ins (includes 0)",
    COLORS.black,
    COLORS.black,
    summary.top_lowest_logins.map((item, i) => ({
      rank: i + 1,
      name: item.name,
      badge: `${item.count} log(s)`,
      sub: item.count === 0 ? "No activity recorded" : `${item.clean} clean`,
    }))
  );

  // Card 3: Top 15 Most Lates
  renderRankCard(
    doc,
    margin + (rankColWidth + 3) * 2,
    y,
    rankColWidth,
    rankBoxHeight,
    "Top 15 Most Lates",
    "Frequent tardiness (5:15-6:30 AM)",
    COLORS.black,
    COLORS.yellow,
    summary.top_most_lates.length > 0
      ? summary.top_most_lates.map((item, i) => ({
          rank: i + 1,
          name: item.name,
          badge: `${item.lates} late(s)`,
          sub: `${item.clean} on-time of ${item.total}`,
        }))
      : [{ rank: 1, name: "No late logins recorded", badge: "0", sub: "100% clean attendance" }]
  );

  y += rankBoxHeight + 5;

  // 5. Footer and Report Authenticity
  doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
  doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
  doc.text(`Generated on ${formatPhtDate()} (Philippine Time) • SHC MG Face Attendance System`, margin, pageHeight - 8);
  doc.text("Page 1 of 1 • Official System Export", pageWidth - margin, pageHeight - 8, { align: "right" });

  // 6. Center Watermark (Low Opacity SHC Logo)
  await renderLogoWatermark(doc, pageWidth, pageHeight);

  const filename = `Attendance_Analytics_${summary.period}_${summary.filter_label.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
  doc.save(filename);
}

function renderRankCard(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  subtitle: string,
  headerBg: number[],
  badgeColor: number[],
  items: { rank: number; name: string; badge: string; sub?: string }[]
) {
  // Card background (Pure White)
  doc.setFillColor(COLORS.cardBg[0], COLORS.cardBg[1], COLORS.cardBg[2]);
  doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");

  // Top header bar (Accent color with White Title)
  doc.setFillColor(headerBg[0], headerBg[1], headerBg[2]);
  doc.roundedRect(x, y, width, 7, 2, 2, "F");
  doc.rect(x, y + 4, width, 3, "F");

  doc.setTextColor(COLORS.white[0], COLORS.white[1], COLORS.white[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(title, x + 3, y + 4.8);

  doc.setTextColor(240, 240, 240);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.text(subtitle, x + 3, y + 10.5);

  let itemY = y + 14.5;
  const rowH = 4.8;

  items.slice(0, 15).forEach((item, idx) => {
    // Alternating row shade (clean soft neutral)
    if (idx % 2 === 1) {
      doc.setFillColor(249, 250, 251);
      doc.rect(x + 1, itemY - 3.2, width - 2, rowH, "F");
    }

    // Rank number
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
    doc.text(`${item.rank}.`, x + 3, itemY);

    // Name (Black text)
    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
    const cleanName = item.name.length > 17 ? item.name.substring(0, 15) + "…" : item.name;
    doc.text(cleanName, x + 8, itemY);

    // Badge count
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.setTextColor(badgeColor[0], badgeColor[1], badgeColor[2]);
    doc.text(item.badge, x + width - 3, itemY, { align: "right" });

    itemY += rowH;
  });
}

/**
 * Export Individual DTR to PDF.
 * Styled with:
 * - Red institutional header banner & month tag
 * - Green - Yellow - None rule on individual logs:
 *   * Clean / On Time: Green background, green border, green label
 *   * Late: Yellow background, yellow border, yellow label
 *   * Absent / Sunday: None (white/neutral), black/gray text
 * - Black text, labels, numbers, and signature lines
 * - White card backgrounds
 * - Faint center logo watermark
 */
export async function exportIndividualDtrPdf({
  userName,
  userProfile,
  month,
  days,
}: {
  userName: string;
  userProfile?: UserProfile | null;
  month: string; // "YYYY-MM"
  days: { date: string; timeInTs: string | null; status?: "ON_TIME" | "LATE" }[];
}): Promise<void> {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;

  // Month parsing
  const [yStr, mStr] = month.split("-");
  const year = parseInt(yStr, 10);
  const monthIdx = parseInt(mStr, 10) - 1;
  const monthDate = new Date(year, monthIdx, 1);
  const monthName = monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

  // 1. DTR Institutional Header (Solid Crimson Red Accent with White Text)
  doc.setFillColor(COLORS.accentRed[0], COLORS.accentRed[1], COLORS.accentRed[2]);
  doc.roundedRect(margin, 12, contentWidth, 24, 3, 3, "F");

  doc.setTextColor(COLORS.white[0], COLORS.white[1], COLORS.white[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("SHC MG — DAILY TIME RECORD (DTR)", margin + 6, 21);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(245, 245, 245);
  doc.text("Official Individual Monthly Attendance & Facial Recognition Log", margin + 6, 27);

  // Month Tag (White Box with Red Accent Text)
  doc.setFillColor(COLORS.white[0], COLORS.white[1], COLORS.white[2]);
  doc.roundedRect(pageWidth - margin - 52, 17, 46, 14, 2, 2, "F");
  doc.setTextColor(COLORS.accentRed[0], COLORS.accentRed[1], COLORS.accentRed[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(monthName.toUpperCase(), pageWidth - margin - 29, 25.5, { align: "center" });

  let y = 41;

  // 2. User Particulars Box (White Card, Black Text, Neutral Border)
  doc.setFillColor(COLORS.cardBg[0], COLORS.cardBg[1], COLORS.cardBg[2]);
  doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
  doc.roundedRect(margin, y, contentWidth, 20, 2, 2, "FD");

  const colW = contentWidth / 3;
  const fields = [
    { label: "NAME", val: userName },
    { label: "STUDENT ID", val: userProfile?.student_number || userProfile?.employee_id || "N/A" },
    { label: "COURSE", val: userProfile?.department || "N/A" },
  ];

  fields.forEach((f, i) => {
    const fx = margin + i * colW + 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
    doc.text(f.label, fx, y + 6);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
    const cleanVal = f.val.length > 22 ? f.val.substring(0, 20) + "…" : f.val;
    doc.text(cleanVal, fx, y + 13);
  });

  y += 25;

  // 3. Calculation of Attendance Statistics (Sundays excluded as no attendance is required)
  const daysMap = new Map<string, { timeInTs: string | null; status?: "ON_TIME" | "LATE" }>();
  days.forEach((d) => daysMap.set(d.date, d));

  let presentCount = 0;
  let cleanCount = 0;
  let lateCount = 0;
  let requiredDays = 0;

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const dayOfWeek = new Date(year, monthIdx, dayNum).getDay();
    if (dayOfWeek !== 0) {
      requiredDays++;
    }
    const dStr = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    const rec = daysMap.get(dStr);
    if (rec && rec.timeInTs) {
      presentCount++;
      if (rec.status === "LATE") {
        lateCount++;
      } else {
        cleanCount++;
      }
    }
  }

  const absentCount = Math.max(0, requiredDays - presentCount);
  const ratePct = requiredDays > 0 ? Math.round((presentCount / requiredDays) * 100) : 100;

  // Statistics row:
  // - Days Present: Black
  // - Clean / On Time: Green rule
  // - Late Logins: Yellow rule
  // - Days Absent: None/Gray
  const statCardW = (contentWidth - 9) / 4;
  const statCards = [
    { label: "Days Present", val: `${presentCount} / ${requiredDays}`, sub: `${ratePct}% attendance (excl. Sun)`, color: COLORS.black },
    { label: "Clean / On Time", val: `${cleanCount} Day(s)`, sub: "< 5:15 AM or Saturday", color: COLORS.green },
    { label: "Late Logins", val: `${lateCount} Day(s)`, sub: "5:15 AM – 6:30 AM", color: COLORS.yellow },
    { label: "Days Absent", val: `${absentCount} Day(s)`, sub: "Excluding Sundays", color: COLORS.textMuted },
  ];

  statCards.forEach((sc, i) => {
    const sx = margin + i * (statCardW + 3);
    doc.setFillColor(COLORS.cardBg[0], COLORS.cardBg[1], COLORS.cardBg[2]);
    doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
    doc.roundedRect(sx, y, statCardW, 18, 2, 2, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
    doc.text(sc.label, sx + 3, y + 5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(sc.color[0], sc.color[1], sc.color[2]);
    doc.text(sc.val, sx + 3, y + 11.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
    doc.text(sc.sub, sx + 3, y + 15.5);
  });

  y += 24;

  // 4. Monthly Individual Heatmap Calendar Grid
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
  doc.text(`Monthly Attendance Heatmap — ${monthName}`, margin, y);

  // Legend on right (Green - Yellow - None rule)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  // Clean pill (Green)
  doc.setFillColor(COLORS.greenBg[0], COLORS.greenBg[1], COLORS.greenBg[2]);
  doc.setDrawColor(COLORS.green[0], COLORS.green[1], COLORS.green[2]);
  doc.roundedRect(pageWidth - margin - 72, y - 3, 3, 3, 0.5, 0.5, "FD");
  doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
  doc.text("Clean (On Time)", pageWidth - margin - 67, y - 0.7);

  // Late pill (Yellow)
  doc.setFillColor(COLORS.yellowBg[0], COLORS.yellowBg[1], COLORS.yellowBg[2]);
  doc.setDrawColor(COLORS.yellow[0], COLORS.yellow[1], COLORS.yellow[2]);
  doc.roundedRect(pageWidth - margin - 42, y - 3, 3, 3, 0.5, 0.5, "FD");
  doc.text("Late Login", pageWidth - margin - 37, y - 0.7);

  // Absent pill (None / White)
  doc.setFillColor(COLORS.white[0], COLORS.white[1], COLORS.white[2]);
  doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
  doc.roundedRect(pageWidth - margin - 20, y - 3, 3, 3, 0.5, 0.5, "FD");
  doc.text("Absent/Off", pageWidth - margin - 15, y - 0.7);

  y += 4;

  const cols = 7;
  const colNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const cellSize = contentWidth / cols;
  const cellHeight = 18;

  // Weekday Header (Solid Crimson Red Accent with White Text)
  doc.setFillColor(COLORS.accentRed[0], COLORS.accentRed[1], COLORS.accentRed[2]);
  doc.roundedRect(margin, y, contentWidth, 6, 1.5, 1.5, "F");
  doc.setTextColor(COLORS.white[0], COLORS.white[1], COLORS.white[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  colNames.forEach((name, i) => {
    doc.text(name, margin + i * cellSize + cellSize / 2, y + 4.2, { align: "center" });
  });

  y += 7;

  // Calendar cells
  const firstDate = new Date(year, monthIdx, 1);
  const startDay = firstDate.getDay(); // 0 = Sun

  const calendarDays: ({
    dayNum: number;
    dateStr: string;
    isSaturday: boolean;
    isSunday: boolean;
    record?: { timeInTs: string | null; status?: "ON_TIME" | "LATE" };
  } | null)[] = [];

  for (let i = 0; i < startDay; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = new Date(year, monthIdx, d).getDay();
    calendarDays.push({
      dayNum: d,
      dateStr: dStr,
      isSaturday: dow === 6,
      isSunday: dow === 0,
      record: daysMap.get(dStr),
    });
  }

  let cellY = y;
  calendarDays.forEach((cell, idx) => {
    const colIdx = idx % cols;
    const cellX = margin + colIdx * cellSize;

    if (!cell) {
      doc.setFillColor(COLORS.white[0], COLORS.white[1], COLORS.white[2]);
      doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
      doc.rect(cellX, cellY, cellSize, cellHeight, "FD");
    } else {
      const rec = cell.record;
      const hasLogin = !!(rec && rec.timeInTs);
      const isLate = rec?.status === "LATE";

      // Green-Yellow-None rule:
      // - Clean: Soft Green fill, green border, clean label in green
      // - Late: Soft Yellow fill, yellow border, late label in yellow
      // - Sunday / Absent: None (White), light gray border, muted text
      let bgRgb = COLORS.white;
      let borderRgb = COLORS.border;
      let statusLabel = cell.isSunday ? "SUNDAY (OFF)" : "Absent";
      let statusTextColor = COLORS.textMuted;

      if (hasLogin) {
        if (isLate) {
          bgRgb = COLORS.yellowBg;
          borderRgb = COLORS.yellow;
          statusLabel = "LATE";
          statusTextColor = COLORS.yellow;
        } else {
          bgRgb = COLORS.greenBg;
          borderRgb = COLORS.green;
          statusLabel = cell.isSaturday ? "ON TIME (SAT)" : "CLEAN";
          statusTextColor = COLORS.green;
        }
      } else if (cell.isSunday) {
        bgRgb = COLORS.white;
        borderRgb = COLORS.border;
        statusLabel = "SUNDAY (OFF)";
        statusTextColor = COLORS.textMuted;
      }

      doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
      doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
      doc.roundedRect(cellX + 0.4, cellY + 0.4, cellSize - 0.8, cellHeight - 0.8, 1, 1, "FD");

      // Day number (Black text)
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
      doc.text(String(cell.dayNum), cellX + 2, cellY + 4);

      // Check-in time (Black text)
      if (hasLogin && rec?.timeInTs) {
        const timePart = rec.timeInTs.split(" ")[1] || "";
        const [hh, mm] = timePart.split(":");
        const hourNum = parseInt(hh, 10);
        const ampm = hourNum >= 12 ? "PM" : "AM";
        const h12 = hourNum % 12 || 12;
        const timeFormatted = `${h12}:${mm} ${ampm}`;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
        doc.text(timeFormatted, cellX + cellSize / 2, cellY + 10, { align: "center" });

        // Status pill
        doc.setFont("helvetica", "bold");
        doc.setFontSize(5.5);
        doc.setTextColor(statusTextColor[0], statusTextColor[1], statusTextColor[2]);
        doc.text(statusLabel, cellX + cellSize / 2, cellY + 14.5, { align: "center" });
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
        doc.text("—", cellX + cellSize / 2, cellY + 11, { align: "center" });
      }
    }

    if (colIdx === cols - 1) {
      cellY += cellHeight;
    }
  });

  if (calendarDays.length % cols !== 0) {
    cellY += cellHeight;
  }

  y = cellY + 8;

  // 5. Verification & Signatures Section (Black text and signature lines)
  doc.setFillColor(COLORS.cardBg[0], COLORS.cardBg[1], COLORS.cardBg[2]);
  doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
  doc.roundedRect(margin, y, contentWidth, 24, 2, 2, "FD");

  const sigY = y + 14;
  const sigColW = (contentWidth - 28) / 2;

  // Student signature line (Black line)
  doc.setDrawColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
  doc.line(margin + 10, sigY, margin + 10 + sigColW, sigY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
  doc.text(userName.toUpperCase(), margin + 10 + sigColW / 2, sigY + 4, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
  doc.text("Student Signature", margin + 10 + sigColW / 2, sigY + 7.5, { align: "center" });

  // In-charge signature line (Black line)
  const adminSigX = margin + 10 + sigColW + 8;
  doc.line(adminSigX, sigY, adminSigX + sigColW, sigY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(COLORS.black[0], COLORS.black[1], COLORS.black[2]);
  doc.text("AUTHORIZED OFFICIAL", adminSigX + sigColW / 2, sigY + 4, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
  doc.text("Verified & Approved", adminSigX + sigColW / 2, sigY + 7.5, { align: "center" });

  // 6. Page Footer
  doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
  doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
  doc.text(`Generated on ${formatPhtDate()} (PST/PHT) • SHC MG Face Attendance System`, margin, pageHeight - 8);

  // 7. Center Watermark (Low Opacity SHC Logo)
  await renderLogoWatermark(doc, pageWidth, pageHeight);

  const safeName = userName.replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`DTR_${safeName}_${month}.pdf`);
}
