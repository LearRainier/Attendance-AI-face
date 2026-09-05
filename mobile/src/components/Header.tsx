import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { useAuth } from "../context/AuthContext";

interface HeaderProps {
  onLogout?: () => void;
}

export const Header: React.FC<HeaderProps> = () => {
  const { user, logout } = useAuth();

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>
            {user?.name ? user.name.charAt(0).toUpperCase() : "S"}
          </Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.studentName} numberOfLines={1}>
            {user?.name || "Student"}
          </Text>
          {user?.student_number ? (
            <View style={styles.studentIdBadge}>
              <Ionicons name="id-card-outline" size={11} color={colors.foregroundMuted} />
              <Text style={styles.studentIdText}>{user.student_number}</Text>
            </View>
          ) : null}
        </View>
      </View>

      <TouchableOpacity
        style={styles.logoutButton}
        onPress={logout}
        activeOpacity={0.7}
        accessibilityLabel="Log out"
      >
        <Ionicons name="log-out-outline" size={20} color={colors.foregroundMuted} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: "700",
  },
  info: {
    flex: 1,
  },
  greeting: {
    fontSize: 11,
    color: colors.foregroundSubtle,
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  studentName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.foreground,
    letterSpacing: -0.2,
  },
  studentIdBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  studentIdText: {
    fontSize: 12,
    color: colors.foregroundMuted,
    fontFamily: "monospace",
  },
  logoutButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
});
