import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StudentUser } from "../api/types";
import { studentLogin } from "../api/client";

interface AuthContextType {
  user: StudentUser | null;
  token: string | null;
  isLoading: boolean;
  login: (studentNumber: string, temporaryPassword: string) => Promise<void>;
  logout: () => Promise<void>;
}

const STORAGE_KEY_TOKEN = "@mg_attendance_token";
const STORAGE_KEY_USER = "@mg_attendance_user";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<StudentUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Restore stored session on launch
  useEffect(() => {
    async function restoreSession() {
      try {
        const storedToken = await AsyncStorage.getItem(STORAGE_KEY_TOKEN);
        const storedUserJson = await AsyncStorage.getItem(STORAGE_KEY_USER);

        if (storedToken && storedUserJson) {
          const parsedUser = JSON.parse(storedUserJson);
          setToken(storedToken);
          setUser(parsedUser);
        }
      } catch (err) {
        console.warn("Failed to restore student auth session:", err);
      } finally {
        setIsLoading(false);
      }
    }

    restoreSession();
  }, []);

  const login = async (identifier: string, temporaryPassword: string) => {
    const res = await studentLogin(identifier, temporaryPassword);

    const studentUser: StudentUser = {
      name: res.username,
      student_number: res.student_number,
      email: res.email,
      role: res.role,
    };

    await AsyncStorage.setItem(STORAGE_KEY_TOKEN, res.token);
    await AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(studentUser));

    setToken(res.token);
    setUser(studentUser);
  };

  const logout = async () => {
    try {
      await AsyncStorage.multiRemove([STORAGE_KEY_TOKEN, STORAGE_KEY_USER]);
    } catch (err) {
      console.warn("Failed to remove session keys:", err);
    } finally {
      setToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
