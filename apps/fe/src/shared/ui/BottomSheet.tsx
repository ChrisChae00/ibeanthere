'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  snapPoints?: string[]; // e.g., ['20%', '50%', '90%']
  initialSnap?: number; // Index of initial snap point
  title?: string;
}

export default function BottomSheet({
  isOpen,
  onClose,
  children,
  snapPoints = ['25%', '50%', '90%'],
  initialSnap = 1,
  title
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [currentSnapIndex, setCurrentSnapIndex] = useState(initialSnap);
  const [isDragging, setIsDragging] = useState(false);
  const [startY, setStartY] = useState(0);
  const [currentY, setCurrentY] = useState(0);
  const [mounted, setMounted] = useState(false);

  // Mount check for portal
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Reset snap index when opening
  useEffect(() => {
    if (isOpen) {
      setCurrentSnapIndex(initialSnap);
    }
  }, [isOpen, initialSnap]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Block body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
    }
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [isOpen]);

  const getSnapHeight = (index: number): number => {
    const snap = snapPoints[index];
    if (!snap) return 0;
    const percentage = parseInt(snap.replace('%', ''));
    return (window.innerHeight * percentage) / 100;
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true);
    setStartY(e.touches[0].clientY);
    setCurrentY(e.touches[0].clientY);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    setCurrentY(e.touches[0].clientY);
  }, [isDragging]);

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);

    const deltaY = currentY - startY;
    const threshold = 50; // Minimum drag distance to trigger snap change

    if (deltaY > threshold) {
      // Dragged down
      if (currentSnapIndex === 0) {
        onClose();
      } else {
        setCurrentSnapIndex(Math.max(0, currentSnapIndex - 1));
      }
    } else if (deltaY < -threshold) {
      // Dragged up
      setCurrentSnapIndex(Math.min(snapPoints.length - 1, currentSnapIndex + 1));
    }
  }, [isDragging, currentY, startY, currentSnapIndex, snapPoints.length, onClose]);

  const handleBackdropClick = () => {
    onClose();
  };

  if (!mounted || !isOpen) return null;

  const currentHeight = getSnapHeight(currentSnapIndex);
  const dragOffset = isDragging ? startY - currentY : 0;
  const adjustedHeight = currentHeight + dragOffset;

  const content = (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-100 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={handleBackdropClick}
      />
      
      {/* Sheet */}
      <div
        ref={sheetRef}
        className={`fixed bottom-0 left-0 right-0 bg-surface rounded-t-3xl z-101 transition-all px-safe ${
          isDragging ? 'transition-none' : 'duration-300 ease-out'
        }`}
        style={{
          height: `${Math.max(0, Math.min(window.innerHeight * 0.95, adjustedHeight))}px`,
          transform: isOpen ? 'translateY(0)' : 'translateY(100%)'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Drag Handle */}
        <div className="flex justify-center py-3 cursor-grab active:cursor-grabbing">
          <div className="w-10 h-1.5 bg-border rounded-full" />
        </div>
        
        {/* Title */}
        {title && (
          <div className="px-4 pb-3 border-b border-border">
            <h2 className="text-lg font-semibold text-text">{title}</h2>
          </div>
        )}
        
        {/* Content */}
        <div className="overflow-y-auto pb-[env(safe-area-inset-bottom)]" style={{ height: 'calc(100% - 3rem)' }}>
          {children}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
