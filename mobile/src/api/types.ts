export interface StudentUser {
  name: string;
  student_number: string;
  email: string;
  role: string;
}

export interface AttendanceRecord {
  name: string;
  timestamp: string; // "YYYY-MM-DD HH:MM:SS"
  type: string;      // "IN"
}

export interface DayLog {
  date: string;          // "YYYY-MM-DD"
  timeInTs: string;      // "YYYY-MM-DD HH:MM:SS"
  timeLabel: string;     // "8:05 AM"
  dayOfWeek: string;     // "Friday"
  formattedDate: string; // "Sep 5, 2026"
  status: "PRESENT";
}

export interface LoginResponse {
  success: boolean;
  token: string;
  username: string;
  student_number: string;
  email: string;
  role: string;
}

export interface StudentMeResponse {
  success: boolean;
  name: string;
  student_number: string;
  email: string;
  role: string;
  profile?: Record<string, any>;
  attendance: AttendanceRecord[];
}
