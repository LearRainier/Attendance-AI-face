import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../theme/colors";
import { useAuth } from "../context/AuthContext";
import { checkServerHealth } from "../api/client";

export const LoginScreen: React.FC = () => {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    checkServerHealth().then((ok) => {
      if (mounted) setServerOnline(ok);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleLogin = async () => {
    if (!identifier.trim()) {
      setErrorMessage("Please enter your Student Number or Email.");
      return;
    }
    if (!password) {
      setErrorMessage("Please enter your temporary password.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      await login(identifier.trim(), password);
    } catch (err: any) {
      setErrorMessage(err?.message || "Invalid student credentials.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Brand & Logo */}
        <View style={styles.brandContainer}>
          <View style={styles.logoBadge}>
            <Ionicons name="scan-outline" size={32} color={colors.primary} />
          </View>
          <Text style={styles.appTitle}>MG Attendance</Text>
          <Text style={styles.appSubtitle}>Student Portal</Text>

          {/* Server Connection Badge */}
          <View style={styles.serverStatusRow}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    serverOnline === true
                      ? colors.success
                      : serverOnline === false
                      ? colors.destructive
                      : colors.foregroundSubtle,
                },
              ]}
            />
            <Text style={styles.serverStatusText}>
              {serverOnline === true
                ? "Server Connected"
                : serverOnline === false
                ? "Server Offline"
                : "Connecting to server..."}
            </Text>
          </View>
        </View>

        {/* Login Form Card */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Student Sign In</Text>

          {errorMessage && (
            <View style={styles.errorAlert}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.destructive} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {/* Student Number Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Student Number</Text>
            <View style={styles.inputContainer}>
              <Ionicons
                name="id-card-outline"
                size={18}
                color={colors.foregroundMuted}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={identifier}
                onChangeText={(val) => {
                  setIdentifier(val);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="e.g. 26-00123"
                placeholderTextColor={colors.foregroundSubtle}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Password Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.inputLabel}>Temporary Password</Text>
            <View style={styles.inputContainer}>
              <Ionicons
                name="lock-closed-outline"
                size={18}
                color={colors.foregroundMuted}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={(val) => {
                  setPassword(val);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="Check your registered email"
                placeholderTextColor={colors.foregroundSubtle}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              <TouchableOpacity
                onPress={() => setShowPassword((prev) => !prev)}
                style={styles.eyeButton}
              >
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color={colors.foregroundMuted}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
            onPress={handleLogin}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text style={styles.submitButtonText}>Sign In to Dashboard</Text>
            )}
          </TouchableOpacity>

          <View style={styles.hintBox}>
            <Ionicons name="information-circle-outline" size={14} color={colors.foregroundMuted} />
            <Text style={styles.hintText}>
              Your temporary password was sent to the email registered by the administrator.
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  brandContainer: {
    alignItems: "center",
    marginBottom: 24,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.foreground,
    letterSpacing: -0.3,
  },
  appSubtitle: {
    fontSize: 13,
    color: colors.foregroundMuted,
    marginTop: 2,
  },
  serverStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  serverStatusText: {
    fontSize: 11,
    color: colors.foregroundMuted,
    fontWeight: "500",
  },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 20,
  },
  formTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.foreground,
    marginBottom: 16,
  },
  errorAlert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.destructiveSoft,
    borderWidth: 1,
    borderColor: colors.destructiveBorder,
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 12,
    color: colors.destructive,
    flex: 1,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.foregroundMuted,
    marginBottom: 6,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 12,
    height: 46,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: colors.foreground,
  },
  eyeButton: {
    padding: 6,
  },
  submitButton: {
    backgroundColor: colors.primary,
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  submitButtonDisabled: {
    opacity: 0.65,
  },
  submitButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  hintBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  hintText: {
    fontSize: 11,
    color: colors.foregroundSubtle,
    flex: 1,
    lineHeight: 15,
  },
});
