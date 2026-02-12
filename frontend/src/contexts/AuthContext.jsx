/**
 * LogisticsTrack — Auth Context
 *
 * Gestione ruolo utente centralizzata.
 * Per ora: ruolo simulato (admin di default, no login).
 * Futuro: agganciare backend JWT per autenticazione reale.
 */
import { createContext, useContext, useState, useMemo } from 'react';

const AuthContext = createContext(null);

/**
 * Ruoli disponibili:
 * - "admin": accesso completo (camere, ROI, settings, utenti)
 * - "user": solo dashboard ed eventi
 */

export function AuthProvider({ children }) {
  // Per ora: admin simulato. In futuro: stato da JWT token.
  const [user] = useState({
    name: 'Admin',
    role: 'admin', // "admin" | "user"
  });

  const value = useMemo(
    () => ({
      user,
      role: user.role,
      isAdmin: user.role === 'admin',
      isAuthenticated: true, // Sempre true per ora (no login)
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve essere usato dentro AuthProvider');
  }
  return context;
}
