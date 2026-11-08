'use client';

import { createContext, useContext } from 'react';
import type { Me } from '@/lib/types';

export const MeContext = createContext<Me['user'] | null>(null);
export const useMe = () => useContext(MeContext);
