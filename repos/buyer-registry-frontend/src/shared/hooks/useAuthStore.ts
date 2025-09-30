import create from "zustand";

type Role = "buyer" | "seller" | "admin" | "developer" | "lender";

type AuthState = {
  isAuthenticated: boolean;
  role: Role | null;
  setAuthenticated: (value: boolean) => void;
  setRole: (role: Role | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  role: null,
  setAuthenticated: (value) => set({ isAuthenticated: value }),
  setRole: (role) => set({ role })
}));
