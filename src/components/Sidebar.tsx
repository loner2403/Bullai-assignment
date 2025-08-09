"use client";
import React from "react";
import { useTheme } from "./ThemeProvider";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onNewChat?: () => void;
}

export function Sidebar({ isOpen, onClose, onNewChat }: SidebarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}
      
      {/* Sidebar */}
      <div className={`
        fixed left-0 top-0 h-dvh w-[260px] bg-[#171717] z-50
        transform transition-transform duration-200 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:fixed lg:z-50
        border-r border-white/10
      `}>
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between p-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-gradient-to-br from-green-500 to-emerald-600 rounded-sm flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </div>
              <span className="text-white font-medium text-sm">Financial Chat</span>
            </div>
            <button
              onClick={onClose}
              className="lg:hidden p-1.5 rounded-md hover:bg-white/10 text-white/70 hover:text-white transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* New Chat Button */}
          <div className="px-3 pb-3">
            <button
              onClick={() => {
                onNewChat?.();
                onClose();
              }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-white/20 hover:bg-white/10 text-sm font-medium text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New chat
            </button>
          </div>

          {/* Chat History */}
          <div className="flex-1 overflow-y-auto px-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-white/50 px-3 py-2 uppercase tracking-wider">
                Recent
              </div>
              {/* Placeholder chat items */}
              <div className="group px-3 py-2.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors">
                <div className="text-sm text-white/90 truncate">
                  IndusInd Bank Analysis
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  2 hours ago
                </div>
              </div>
              <div className="group px-3 py-2.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors">
                <div className="text-sm text-white/90 truncate">
                  Financial Report Summary
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  Yesterday
                </div>
              </div>
              <div className="group px-3 py-2.5 rounded-lg hover:bg-white/10 cursor-pointer transition-colors">
                <div className="text-sm text-white/90 truncate">
                  Market Analysis Q4
                </div>
                <div className="text-xs text-white/50 mt-0.5">
                  3 days ago
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Actions */}
          <div className="p-3 border-t border-white/10">
            <div className="space-y-1">
              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10 text-sm text-white/90 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Help & FAQ
              </button>
              <button
                onClick={toggleTheme}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10 text-sm text-white/90 transition-colors"
              >
                {theme === "light" ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                )}
                {theme === "light" ? "Dark mode" : "Light mode"}
              </button>
              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white/10 text-sm text-white/90 transition-colors">
                <div className="w-6 h-6 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-xs font-medium text-white">
                  U
                </div>
                Upgrade plan
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
