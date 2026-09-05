import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DayLog } from "../api/types";
import { colors } from "../theme/colors";

interface DayLogCardProps {
  log: DayLog;
}

export const DayLogCard: React.FC<DayLogCardProps> = ({ log }) => {
  const dayNum = log.date.split("-")[2] || "";

  return (
    <View style={styles.card}>
      {/* Date badge */}
      <View style={styles.dateBadge}>
        <Text style={styles.dayNum}>{dayNum}</Text>
        <Text style={styles.dayName}>{log.dayOfWeek.toUpperCase()}</Text>
      </View>

      {/* Detail info */}
      <View style={styles.detailCol}>
        <Text style={styles.fullDate}>{log.formattedDate}</Text>
        <View style={styles.timeRow}>
          <Ionicons name="time-outline" size={13} color={colors.foregroundMuted} />
          <Text style={styles.timeText}>{log.timeLabel}</Text>
        </View>
      </View>

      {/* Present Badge */}
      <View style={styles.statusPill}>
        <Ionicons name="checkmark-circle" size={13} color={colors.success} />
        <Text style={styles.statusText}>PRESENT</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
    marginBottom: 8,
  },
  dateBadge: {
    width: 44,
    height: 46,
    borderRadius: 8,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  dayNum: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.foreground,
    lineHeight: 18,
  },
  dayName: {
    fontSize: 9,
    fontWeight: "700",
    color: colors.primary,
    letterSpacing: 0.5,
  },
  detailCol: {
    flex: 1,
    gap: 3,
  },
  fullDate: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  timeText: {
    fontSize: 12,
    color: colors.foregroundMuted,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.successBorder,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusText: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.successText,
    letterSpacing: 0.4,
  },
});
