import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { formatMonthName, getCurrentIsoMonth } from "../utils/formatters";

interface MonthFilterProps {
  currentMonth: string; // "YYYY-MM"
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onResetCurrent: () => void;
}

export const MonthFilter: React.FC<MonthFilterProps> = ({
  currentMonth,
  onPrevMonth,
  onNextMonth,
  onResetCurrent,
}) => {
  const isCurrentMonth = currentMonth === getCurrentIsoMonth();
  const readableMonth = formatMonthName(currentMonth);

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <TouchableOpacity
          style={styles.navButton}
          onPress={onPrevMonth}
          activeOpacity={0.7}
          accessibilityLabel="Previous month"
        >
          <Ionicons name="chevron-back" size={18} color={colors.foregroundMuted} />
        </TouchableOpacity>

        <View style={styles.centerSection}>
          <Ionicons name="calendar-outline" size={15} color={colors.primary} />
          <Text style={styles.monthTitle}>{readableMonth}</Text>
        </View>

        <TouchableOpacity
          style={styles.navButton}
          onPress={onNextMonth}
          activeOpacity={0.7}
          accessibilityLabel="Next month"
        >
          <Ionicons name="chevron-forward" size={18} color={colors.foregroundMuted} />
        </TouchableOpacity>
      </View>

      {!isCurrentMonth && (
        <TouchableOpacity
          style={styles.resetPill}
          onPress={onResetCurrent}
          activeOpacity={0.7}
        >
          <Text style={styles.resetText}>Return to Current Month</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  centerSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  monthTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.foreground,
  },
  navButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.inputBg,
    alignItems: "center",
    justifyContent: "center",
  },
  resetPill: {
    alignSelf: "center",
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  resetText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.primary,
  },
});
