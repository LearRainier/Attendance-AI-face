import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";

interface KpiCardProps {
  daysCount: number;
  latestTime?: string;
  monthName: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({ daysCount, latestTime, monthName }) => {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.topRow}>
          <Text style={styles.label}>ATTENDANCE SUMMARY</Text>
          <Text style={styles.monthBadge}>{monthName}</Text>
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metricCol}>
            <View style={styles.iconValRow}>
              <View style={[styles.iconBox, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="calendar-outline" size={16} color={colors.primary} />
              </View>
              <Text style={styles.bigValue}>{daysCount}</Text>
            </View>
            <Text style={styles.subLabel}>Days Logged</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.metricCol}>
            <View style={styles.iconValRow}>
              <View style={[styles.iconBox, { backgroundColor: colors.successSoft }]}>
                <Ionicons name="time-outline" size={16} color={colors.success} />
              </View>
              <Text style={styles.mediumValue} numberOfLines={1}>
                {latestTime || "--:--"}
              </Text>
            </View>
            <Text style={styles.subLabel}>Latest Check-In</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  label: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.foregroundSubtle,
    letterSpacing: 0.8,
  },
  monthBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.foregroundMuted,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metricsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  metricCol: {
    flex: 1,
  },
  iconValRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  bigValue: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.foreground,
    letterSpacing: -0.5,
  },
  mediumValue: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.foreground,
  },
  subLabel: {
    fontSize: 11,
    color: colors.foregroundMuted,
    marginTop: 4,
    marginLeft: 36,
  },
  divider: {
    width: 1,
    height: 36,
    backgroundColor: colors.border,
    marginHorizontal: 12,
  },
});
