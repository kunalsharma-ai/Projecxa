'use client';
import { createContext, useContext } from 'react';
import type { Me } from '@/lib/types';

export const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);
export const canEdit = (me: Me | null) => !!me && ['ADMIN', 'PROJECT_MANAGER'].includes(me.user.role);
