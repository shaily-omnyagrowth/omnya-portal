import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export const RequireRole = ({ allowedRoles, children }) => {
  const { user, profile } = useAuth();

  if (!user || !profile) return <Navigate to="/login" replace />;
  
  // Block pending/denied users unless they are owners
  if (profile.status !== 'approved' && profile.role !== 'owner') {
    return <Navigate to="/pending" replace />;
  }

  if (!allowedRoles.includes(profile.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
};
