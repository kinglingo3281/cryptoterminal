'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TradeSignal } from '@/hooks/useTradeDataManager';
import { cn } from '@/lib/utils';

interface QuickTradeButtonProps {
    signal: TradeSignal;
    onClick?: (signal: TradeSignal, e: React.MouseEvent) => void;
    isOnCooldown?: boolean;
}

// Generate jagged lightning-style arc path
const generateArcPath = (angle: number, length: number, variation: number) => {
    const centerX = 12;
    const centerY = 12;
    
    // Add random variation to base angle
    const angleRad = (angle + (Math.random() - 0.5) * variation) * Math.PI / 180;
    
    // Number of zigzag segments (3-5 for lightning effect)
    const segments = 3 + Math.floor(Math.random() * 3);
    const segmentLength = length / segments;
    
    let path = `M ${centerX} ${centerY}`;
    let currentX = centerX;
    let currentY = centerY;
    
    for (let i = 0; i < segments; i++) {
        // Progress along the main angle direction
        const progress = (i + 1) / segments;
        const targetX = centerX + Math.cos(angleRad) * length * progress;
        const targetY = centerY + Math.sin(angleRad) * length * progress;
        
        // Add perpendicular offset for zigzag effect
        const perpAngle = angleRad + Math.PI / 2;
        const zigzagOffset = (Math.random() - 0.5) * 6; // Random offset amount
        
        const nextX = targetX + Math.cos(perpAngle) * zigzagOffset;
        const nextY = targetY + Math.sin(perpAngle) * zigzagOffset;
        
        path += ` L ${nextX} ${nextY}`;
        currentX = nextX;
        currentY = nextY;
    }
    
    return path;
};

// Generate 5 arcs at different angles
const generateArcs = () => [
    { id: 1, path: generateArcPath(45, 18, 20), delay: 0 },
    { id: 2, path: generateArcPath(135, 16, 20), delay: 0.05 },
    { id: 3, path: generateArcPath(225, 17, 20), delay: 0.1 },
    { id: 4, path: generateArcPath(315, 15, 20), delay: 0.15 },
    { id: 5, path: generateArcPath(90, 20, 15), delay: 0.08 }
];

export function QuickTradeButton({ signal, onClick, isOnCooldown = false }: QuickTradeButtonProps) {
    const [isHovered, setIsHovered] = useState(false);
    const [isClicked, setIsClicked] = useState(false);
    const [arcs, setArcs] = useState(generateArcs());

    const handleClick = (e: React.MouseEvent) => {
        if (isOnCooldown) return;
        e.stopPropagation();
        setIsClicked(true);
        setTimeout(() => setIsClicked(false), 400);
        onClick?.(signal, e);
    };

    const handleMouseEnter = () => {
        if (isOnCooldown) return;
        setIsHovered(true);
        // Regenerate arcs for variety on each hover
        setArcs(generateArcs());
    };

    const handleMouseLeave = () => {
        if (isOnCooldown) return;
        setIsHovered(false);
    };

    return (
        <motion.button
            onClick={handleClick}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className={cn(
                "relative flex items-center justify-center w-7 h-7 rounded transition-colors group",
                isOnCooldown 
                    ? "bg-warning/20 cursor-not-allowed" 
                    : "hover:bg-muted/50 cursor-pointer"
            )}
            aria-label={`Quick trade ${signal.asset}`}
            title={isOnCooldown ? "Cooldown (3s)" : "Quick Trade"}
            disabled={isOnCooldown}
            whileTap={isOnCooldown ? {} : { scale: 0.9 }}
            animate={{
                scale: isClicked ? [1, 1.1, 1] : 1
            }}
            transition={{
                duration: 0.15,
                ease: "easeOut"
            }}
        >
            {/* Glow effect layer */}
            <motion.div
                className="absolute inset-0 rounded-full blur-sm bg-success/60"
                animate={{
                    opacity: isHovered ? 0.4 : 0,
                    scale: isHovered ? 1.3 : 1
                }}
                transition={{ duration: 0.2 }}
                style={{
                    background: 'radial-gradient(circle, currentColor 0%, transparent 70%)'
                }}
            />

            {/* Flash effect on click */}
            <AnimatePresence>
                {isClicked && (
                    <motion.div
                        className="absolute inset-0 bg-white rounded"
                        initial={{ opacity: 0.6 }}
                        animate={{ opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                    />
                )}
            </AnimatePresence>

            {/* Arc container */}
            <AnimatePresence>
                {!isOnCooldown && (isHovered || isClicked) && (
                    <svg
                        className="absolute inset-0 w-7 h-7 pointer-events-none overflow-visible text-success"
                        viewBox="0 0 24 24"
                        style={{ filter: 'drop-shadow(0 0 2px currentColor)' }}
                    >
                        {arcs.map((arc, i) => (
                            <motion.path
                                key={`${arc.id}-${isClicked ? 'click' : 'hover'}`}
                                d={arc.path}
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                fill="none"
                                className="text-success"
                                initial={{ 
                                    pathLength: 0, 
                                    opacity: 0,
                                    pathOffset: 0
                                }}
                                animate={{ 
                                    pathLength: 1,
                                    opacity: [0, 0.8, 0],
                                    pathOffset: 1
                                }}
                                exit={{ opacity: 0 }}
                                transition={{
                                    delay: arc.delay,
                                    duration: isClicked ? 0.25 : 0.4,
                                    ease: "easeOut",
                                    opacity: {
                                        duration: isClicked ? 0.25 : 0.4,
                                        times: [0, 0.3, 1]
                                    }
                                }}
                            />
                        ))}
                    </svg>
                )}
            </AnimatePresence>

            {/* Lightning bolt icon */}
            <motion.svg
                className={cn(
                    "relative z-10 w-4 h-4",
                    isOnCooldown ? "text-warning" : "text-success"
                )}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                animate={{
                    filter: isOnCooldown
                        ? 'drop-shadow(0 0 2px hsl(var(--warning)))'
                        : isHovered 
                        ? 'drop-shadow(0 0 4px hsl(var(--success)))' 
                        : 'drop-shadow(0 0 1px hsl(var(--success)))',
                    scale: isOnCooldown ? 1 : isClicked ? [1, 1.2, 1] : [1, 1.02, 1]
                }}
                transition={{
                    scale: {
                        repeat: isClicked || isOnCooldown ? 0 : Infinity,
                        duration: isClicked ? 0.15 : 2,
                        ease: "easeInOut"
                    },
                    filter: {
                        duration: 0.2
                    }
                }}
            >
                {/* Clean angular lightning bolt path */}
                <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
            </motion.svg>

            {/* Ripple effect on click */}
            <AnimatePresence>
                {isClicked && (
                    <motion.div
                        className="absolute inset-0 rounded-full border-2 border-success"
                        initial={{ scale: 0.8, opacity: 0.8 }}
                        animate={{ scale: 2.5, opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.4, ease: "easeOut" }}
                    />
                )}
            </AnimatePresence>
        </motion.button>
    );
}
