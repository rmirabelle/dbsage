import { createContext } from "react";

export const PeekDepth = createContext(0);
const DEPTH_COLORS = ["#a78bfa", "#60a5fa", "#2dd4bf", "#fb7185", "#fbbf24"];
const DEPTH_TINTS = ["#2d2a3b", "#253144", "#203533", "#392a31", "#393323"];

export const peekDepthColor = (depth: number) => DEPTH_COLORS[depth % DEPTH_COLORS.length];
export const peekDepthTint = (depth: number) => DEPTH_TINTS[depth % DEPTH_TINTS.length];
