import { jsPDF } from "jspdf";
import type { AnalyticsSummary, UserProfile } from "@/api";

// Design Palette matching UI design tokens
const COLORS = {
  primary: [37, 99, 235], // #2563eb
  primaryDark: [30, 64, 175], // #1e40af
  darkBg: [15, 23, 42], // #0f172a
  cardBg: [255, 255, 255],
  border: [226, 232, 240], // #e2e8f0
  textDark: [15, 23, 42], // #0f172a
  textMuted: [100, 116, 139], // #64748b
  success: [22, 163, 74], // #16a34a (Clean)
  successBg: [220, 252, 231], // #dcfce7
  warning: [234, 179, 8], // #eab308 (Late)
  warningBg: [254, 249, 195], // #fef9c3
  neutralBg: [248, 250, 252], // #f8fafc
  heatmapTiers: [
    [255, 255, 255], // 0%
    [220, 252, 231], // 1-25%
    [134, 239, 172], // 25-50%
    [34, 197, 94], // 50-75%
    [21, 128, 61], // 75-100%
  ],
};

function formatPhtDate(d: Date = new Date()): string {
  return d.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Export Comprehensive Analytics Report to PDF.
 * Following UI design theme: modern corporate cards, clean typography, colored badges, and rich charts.
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

  // 1. Header Banner
  doc.setFillColor(COLORS.darkBg[0], COLORS.darkBg[1], COLORS.darkBg[2]);
  doc.roundedRect(margin, 12, contentWidth, 28, 3, 3, "F");

  // Title & Subtitle
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("MG ATTENDANCE SYSTEM", margin + 6, 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184); // slate-400
  doc.text("Contactless Facial Recognition Attendance & Analytics Report", margin + 6, 28);

  // Period Badge
  doc.setFillColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
  doc.roundedRect(pageWidth - margin - 56, 18, 50, 16, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("FILTER PERIOD", pageWidth - margin - 51, 23.5);
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  doc.text(summary.filter_label, pageWidth - margin - 51, 29);

  let y = 45;

  // 2. Executive KPI Cards (Row of 4)
  const cardWidth = (contentWidth - 9) / 4;
  const kpis = [
    { label: "Registered Users", value: String(summary.registered_count), sub: "Total Database" },
    { label: "Active Attendees", value: String(summary.unique_active), sub: `${summary.total_sessions} check-ins` },
    { label: "Avg Attendance", value: `${summary.avg_daily_rate}%`, sub: "Daily Activity Rate" },
    { label: "Punctuality Rate", value: `${summary.punctuality_rate}%`, sub: `${summary.total_late} total late(s)` },
  ];

  kpis.forEach((kpi, i) => {
    const x = margin + i * (cardWidth + 3);
    doc.setFillColor(COLORS.neutralBg[0], COLORS.neutralBg[1], COLORS.neutralBg[2]);
    doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
    doc.roundedRect(x, y, cardWidth, 22, 2, 2, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
    doc.text(kpi.label, x + 3, y + 5.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
    doc.text(kpi.value, x + 3, y + 13);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
    doc.text(kpi.sub, x + 3, y + 18.5);
  });

  y += 28;

  // 3. Attendance Density Heatmap Section
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
  doc.text("Attendance Density Heatmap (White-to-Green Ratio)", margin, y);

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

  // Table header
  doc.setFillColor(COLORS.darkBg[0], COLORS.darkBg[1], COLORS.darkBg[2]);
  doc.roundedRect(margin, y, contentWidth, 6, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
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
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(235, 235, 235);
      doc.rect(currentX, currentY, cellSize, cellHeight, "FD");
    } else {
      // Determine gradient color
      const ratio = summary.registered_count > 0 ? cell.attendees_count / summary.registered_count : 0;
      let rgb = COLORS.heatmapTiers[0];
      let textColor = COLORS.textMuted;
      if (ratio > 0.75) {
        rgb = COLORS.heatmapTiers[4];
        textColor = [255, 255, 255];
      } else if (ratio > 0.5) {
        rgb = COLORS.heatmapTiers[3];
        textColor = [255, 255, 255];
      } else if (ratio > 0.25) {
        rgb = COLORS.heatmapTiers[2];
        textColor = [15, 23, 42];
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

      // Late indicator
      if (cell.late_count > 0) {
        doc.setFillColor(COLORS.warning[0], COLORS.warning[1], COLORS.warning[2]);
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

  // 4. Rankings Section: 3 Columns
  // A: Top 15 Most Logins
  // B: Top 15 Lowest Logins
  // C: Top 15 Most Lates
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
  doc.text("Attendance Rankings & Behavioral Insights", margin, y);

  y += 4;

  const rankColWidth = (contentWidth - 6) / 3;
  const maxRankRows = 15;
  const rankRowHeight = 4.8;
  const rankBoxHeight = 12 + maxRankRows * rankRowHeight;

  // Card 1: Top Most Logins
  renderRankCard(
    doc,
    margin,
    y,
    rankColWidth,
    rankBoxHeight,
    "Top 15 Most Logins",
    "Highest attendance in period",
    COLORS.primary,
    summary.top_most_logins.map((item, i) => ({
      rank: i + 1,
      name: item.name,
      badge: `${item.count} log(s)`,
      sub: `${item.clean} clean, ${item.lates} late`,
    }))
  );

  // Card 2: Top Lowest Logins
  renderRankCard(
    doc,
    margin + rankColWidth + 3,
    y,
    rankColWidth,
    rankBoxHeight,
    "Top 15 Low Logins",
    "Lowest check-ins (includes 0)",
    [225, 29, 72], // rose-600
    summary.top_lowest_logins.map((item, i) => ({
      rank: i + 1,
      name: item.name,
      badge: `${item.count} log(s)`,
      sub: item.count === 0 ? "No activity recorded" : `${item.clean} clean`,
    }))
  );

  // Card 3: Top Most Lates
  renderRankCard(
    doc,
    margin + (rankColWidth + 3) * 2,
    y,
    rankColWidth,
    rankBoxHeight,
    "Top 15 Most Lates",
    "Frequent tardiness (5:15-6:30 AM)",
    COLORS.warning,
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
  doc.text(`Generated on ${formatPhtDate()} (Philippine Time) • MG Attendance AI System`, margin, pageHeight - 8);
  doc.text("Page 1 of 1 • Official System Export", pageWidth - margin, pageHeight - 8, { align: "right" });

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
  accentColor: number[],
  items: { rank: number; name: string; badge: string; sub?: string }[]
) {
  // Card background
  doc.setFillColor(COLORS.cardBg[0], COLORS.cardBg[1], COLORS.cardBg[2]);
  doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
  doc.roundedRect(x, y, width, height, 2, 2, "FD");

  // Top header bar
  doc.setFillColor(accentColor[0], accentColor[1], accentColor[2]);
  doc.roundedRect(x, y, width, 7, 2, 2, "F");
  doc.rect(x, y + 4, width, 3, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(title, x + 3, y + 4.8);

  doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.text(subtitle, x + 3, y + 10.5);

  let itemY = y + 14.5;
  const rowH = 4.8;

  items.slice(0, 15).forEach((item, idx) => {
    // Alternating row shade
    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(x + 1, itemY - 3.2, width - 2, rowH, "F");
    }

    // Rank pill
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
    doc.text(`${item.rank}.`, x + 3, itemY);

    // Name
    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
    const cleanName = item.name.length > 17 ? item.name.substring(0, 15) + "…" : item.name;
    doc.text(cleanName, x + 8, itemY);

    // Badge count
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.setTextColor(accentColor[0], accentColor[1], accentColor[2]);
    doc.text(item.badge, x + width - 3, itemY, { align: "right" });

    itemY += rowH;
  });
}

/**
 * Export Individual DTR to PDF.
 * Features an individual monthly calendar heatmap:
 * - Green = Clean login (< 5:15 AM or Saturday)
 * - Yellow = Late login (5:15 AM - 6:30 AM)
 * - Neutral / blank = Absent (no log)
 * Includes summary cards and official sign-off certification lines.
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

  // 1. DTR Institutional Header
  doc.setFillColor(COLORS.darkBg[0], COLORS.darkBg[1], COLORS.darkBg[2]);
  doc.roundedRect(margin, 12, contentWidth, 24, 3, 3, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("DAILY TIME RECORD (DTR)", margin + 6, 21);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(148, 163, 184);
  doc.text("Official Individual Monthly Attendance & Facial Recognition Log", margin + 6, 27);

  // Month Tag
  doc.setFillColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
  doc.roundedRect(pageWidth - margin - 52, 17, 46, 14, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(monthName.toUpperCase(), pageWidth - margin - 29, 25.5, { align: "center" });

  let y = 41;

  // 2. User Particulars Box
  doc.setFillColor(COLORS.neutralBg[0], COLORS.neutralBg[1], COLORS.neutralBg[2]);
  doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
  doc.roundedRect(margin, y, contentWidth, 20, 2, 2, "FD");

  const colW = contentWidth / 4;
  const fields = [
    { label: "NAME", val: userName },
    { label: "STUDENT / EMP ID", val: userProfile?.student_number || userProfile?.employee_id || "N/A" },
    { label: "DEPARTMENT", val: userProfile?.department || "General" },
    { label: "POSITION / ROLE", val: userProfile?.position || "Member" },
  ];

  fields.forEach((f, i) => {
    const fx = margin + i * colW + 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
    doc.text(f.label, fx, y + 6);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
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

  // Statistics row
  const statCardW = (contentWidth - 9) / 4;
  const statCards = [
    { label: "Days Present", val: `${presentCount} / ${requiredDays}`, sub: `${ratePct}% attendance (excl. Sun)`, color: COLORS.primary },
    { label: "Clean / On Time", val: `${cleanCount} Day(s)`, sub: "< 5:15 AM or Saturday", color: COLORS.success },
    { label: "Late Logins", val: `${lateCount} Day(s)`, sub: "5:15 AM – 6:30 AM", color: COLORS.warning },
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
  doc.setTextColor(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
  doc.text(`Monthly Attendance Heatmap — ${monthName}`, margin, y);

  // Legend on right
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  // Green pill
  doc.setFillColor(COLORS.success[0], COLORS.success[1], COLORS.success[2]);
  doc.roundedRect(pageWidth - margin - 72, y - 3, 3, 3, 0.5, 0.5, "F");
  doc.text("Clean (On Time)", pageWidth - margin - 67, y - 0.7);

  // Yellow pill
  doc.setFillColor(COLORS.warning[0], COLORS.warning[1], COLORS.warning[2]);
  doc.roundedRect(pageWidth - margin - 42, y - 3, 3, 3, 0.5, 0.5, "F");
  doc.text("Late Login", pageWidth - margin - 37, y - 0.7);

  // Gray pill
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(pageWidth - margin - 20, y - 3, 3, 3, 0.5, 0.5, "F");
  doc.text("Absent/Off", pageWidth - margin - 15, y - 0.7);

  y += 4;

  const cols = 7;
  const colNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const cellSize = contentWidth / cols;
  const cellHeight = 18;

  // Weekday Header
  doc.setFillColor(COLORS.darkBg[0], COLORS.darkBg[1], COLORS.darkBg[2]);
  doc.roundedRect(margin, y, contentWidth, 6, 1.5, 1.5, "F");
  doc.setTextColor(255, 255, 255);
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
      doc.setFillColor(250, 250, 250);
      doc.setDrawColor(240, 240, 240);
      doc.rect(cellX, cellY, cellSize, cellHeight, "FD");
    } else {
      const rec = cell.record;
      const hasLogin = !!(rec && rec.timeInTs);
      const isLate = rec?.status === "LATE";

      // Background color: Green (clean), Yellow (late), Sunday (off), or neutral (absent)
      let bgRgb = [255, 255, 255];
      let borderRgb = COLORS.border;
      let statusLabel = cell.isSunday ? "SUNDAY (OFF)" : "Absent";
      let statusTextColor = COLORS.textMuted;

      if (hasLogin) {
        if (isLate) {
          bgRgb = COLORS.warningBg;
          borderRgb = COLORS.warning;
          statusLabel = "LATE";
          statusTextColor = [161, 98, 7]; // amber-700
        } else {
          bgRgb = COLORS.successBg;
          borderRgb = COLORS.success;
          statusLabel = cell.isSaturday ? "ON TIME (SAT)" : "CLEAN";
          statusTextColor = [21, 128, 61]; // emerald-700
        }
      } else if (cell.isSunday) {
        bgRgb = [248, 250, 252];
        borderRgb = [226, 232, 240];
        statusLabel = "SUNDAY (OFF)";
        statusTextColor = COLORS.textMuted;
      }

      doc.setFillColor(bgRgb[0], bgRgb[1], bgRgb[2]);
      doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
      doc.roundedRect(cellX + 0.4, cellY + 0.4, cellSize - 0.8, cellHeight - 0.8, 1, 1, "FD");

      // Day number
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
      doc.text(String(cell.dayNum), cellX + 2, cellY + 4);

      // Check-in time
      if (hasLogin && rec?.timeInTs) {
        const timePart = rec.timeInTs.split(" ")[1] || "";
        const [hh, mm] = timePart.split(":");
        const hourNum = parseInt(hh, 10);
        const ampm = hourNum >= 12 ? "PM" : "AM";
        const h12 = hourNum % 12 || 12;
        const timeFormatted = `${h12}:${mm} ${ampm}`;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7.5);
        doc.setTextColor(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
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

  // 5. Official Certification & Signatures Section
  doc.setFillColor(COLORS.neutralBg[0], COLORS.neutralBg[1], COLORS.neutralBg[2]);
  doc.setDrawColor(COLORS.border[0], COLORS.border[1], COLORS.border[2]);
  doc.roundedRect(margin, y, contentWidth, 36, 2, 2, "FD");

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
  doc.text(
    "I certify on my honor that the above is a true and correct report of the hours of work/attendance performed, record of which was made daily at the time of arrival and departure.",
    margin + 6,
    y + 6,
    { maxWidth: contentWidth - 12 }
  );

  const sigY = y + 26;
  const sigColW = (contentWidth - 20) / 2;

  // Employee signature line
  doc.setDrawColor(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
  doc.line(margin + 10, sigY, margin + 10 + sigColW, sigY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
  doc.text(userName.toUpperCase(), margin + 10 + sigColW / 2, sigY + 4, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(COLORS.textMuted[0], COLORS.textMuted[1], COLORS.textMuted[2]);
  doc.text("Employee / Student Signature", margin + 10 + sigColW / 2, sigY + 7.5, { align: "center" });

  // In-charge signature line
  const adminSigX = margin + 10 + sigColW + 10;
  doc.line(adminSigX, sigY, adminSigX + sigColW, sigY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(COLORS.textDark[0], COLORS.textDark[1], COLORS.textDark[2]);
  doc.text("AUTHORIZED OFFICIAL / SUPERVISOR", adminSigX + sigColW / 2, sigY + 4, { align: "center" });
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
  doc.text(`Generated on ${formatPhtDate()} (PST/PHT) • MG Attendance System`, margin, pageHeight - 8);
  doc.text("Civil Service Form No. 48 Format Compatible", pageWidth - margin, pageHeight - 8, { align: "right" });

  const safeName = userName.replace(/[^a-zA-Z0-9_-]/g, "_");
  doc.save(`DTR_${safeName}_${month}.pdf`);
}
