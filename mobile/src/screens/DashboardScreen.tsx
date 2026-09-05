import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { useAuth } from "../context/AuthContext";
import { fetchStudentDtr } from "../api/client";
import { AttendanceRecord, DayLog } from "../api/types";
import {
  getCurrentIsoMonth,
  getAdjacentMonth,
  formatMonthName,
  groupAttendanceIntoDailyLogs,
} from "../utils/formatters";
import { Header } from "../components/Header";
import { KpiCard } from "../components/KpiCard";
import { MonthFilter } from "../components/MonthFilter";
import { DayLogCard } from "../components/DayLogCard";

export const DashboardScreen: React.FC = () => {
  const { token, logout } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentIsoMonth);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const loadAttendance = useCallback(
    async (isRefresh = false) => {
      if (!token) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const res = await fetchStudentDtr(token, selectedMonth);
        setRecords(res.attendance || []);
      } catch (err: any) {
        if (err?.message?.includes("401") || err?.message?.includes("token")) {
          // Token expired, log out
          logout();
          return;
        }
        setError(err?.message || "Failed to load attendance records.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token, selectedMonth, logout]
  );

  useEffect(() => {
    loadAttendance();
  }, [loadAttendance]);

  // Aggregate raw records into unique daily check-in logs
  const dailyLogs: DayLog[] = useMemo(() => {
    return groupAttendanceIntoDailyLogs(records, selectedMonth);
  }, [records, selectedMonth]);

  // Filter logs by search query (e.g. date, weekday)
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return dailyLogs;
    const q = searchQuery.toLowerCase().trim();
    return dailyLogs.filter(
      (log) =>
        log.formattedDate.toLowerCase().includes(q) ||
        log.dayOfWeek.toLowerCase().includes(q) ||
        log.date.includes(q)
    );
  }, [dailyLogs, searchQuery]);

  const latestCheckIn = dailyLogs.length > 0 ? dailyLogs[0].timeLabel : undefined;
  const monthTitle = formatMonthName(selectedMonth);

  return (
    <View style={styles.container}>
      <Header />

      <FlatList
        data={filteredLogs}
        keyExtractor={(item) => item.date}
        renderItem={({ item }) => <DayLogCard log={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadAttendance(true)}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <View>
            {/* KPI Summary Card */}
            <KpiCard
              daysCount={dailyLogs.length}
              latestTime={latestCheckIn}
              monthName={monthTitle}
            />

            {/* Month Filter Selector */}
            <MonthFilter
              currentMonth={selectedMonth}
              onPrevMonth={() => setSelectedMonth((m) => getAdjacentMonth(m, -1))}
              onNextMonth={() => setSelectedMonth((m) => getAdjacentMonth(m, 1))}
              onResetCurrent={() => setSelectedMonth(getCurrentIsoMonth())}
            />

            {/* Search Filter Bar */}
            <View style={styles.filterBarContainer}>
              <View style={styles.searchBar}>
                <Ionicons name="search-outline" size={16} color={colors.foregroundMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Filter by date or day (e.g. Fri, Sep 5)..."
                  placeholderTextColor={colors.foregroundSubtle}
                  clearButtonMode="while-editing"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery("")}>
                    <Ionicons name="close-circle" size={16} color={colors.foregroundMuted} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Error Banner */}
            {error && (
              <View style={styles.errorCard}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.destructive} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Section Header */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Daily Check-In Records</Text>
              <Text style={styles.recordCount}>
                {filteredLogs.length} {filteredLogs.length === 1 ? "day" : "days"}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.emptySub}>Loading attendance logs...</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="calendar-clear-outline" size={32} color={colors.foregroundSubtle} />
              </View>
              <Text style={styles.emptyTitle}>No Records Found</Text>
              <Text style={styles.emptySub}>
                {searchQuery
                  ? "No logs match your search filter."
                  : `No attendance logged for ${monthTitle}. Check-ins at the kiosk will appear here instantly.`}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingBottom: 40,
  },
  filterBarContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.foreground,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.destructiveSoft,
    borderWidth: 1,
    borderColor: colors.destructiveBorder,
    padding: 12,
    borderRadius: 10,
  },
  errorText: {
    fontSize: 12,
    color: colors.destructive,
    flex: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.foreground,
    letterSpacing: -0.2,
  },
  recordCount: {
    fontSize: 12,
    color: colors.foregroundMuted,
    fontWeight: "500",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 50,
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.foreground,
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 12,
    color: colors.foregroundMuted,
    textAlign: "center",
    lineHeight: 18,
  },
});
