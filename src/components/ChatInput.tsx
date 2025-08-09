"use client";
import React, { useState, useRef, useEffect } from "react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  variant?: "dock" | "hero";
  placeholder?: string;
}

export function ChatInput({ onSendMessage, isLoading, variant = "dock", placeholder = "Message Financial Chat" }: ChatInputProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      onSendMessage(message.trim());
      setMessage("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
    }
  }, [message]);

  // Hero variant (center large input bar like ChatGPT)
  if (variant === "hero") {
    return (
      <div className="w-full max-w-3xl mx-auto px-4">
        <form onSubmit={handleSubmit} className="relative">
          <div className="relative flex items-center rounded-3xl border border-white/20 bg-[#2f2f2f] px-4 py-4 shadow-lg focus-within:border-white/30 transition-colors">
            {/* Input */}
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={isLoading}
              className="flex-1 bg-transparent text-base outline-none text-white placeholder-white/50 resize-none max-h-32 min-h-[24px]"
              rows={1}
            />
            {/* Send button */}
            <button
              type="submit"
              disabled={!message.trim() || isLoading}
              className="ml-3 flex h-8 w-8 items-center justify-center rounded-full bg-white disabled:bg-white/20 text-black disabled:text-white/50 transition-all hover:bg-white/90 disabled:hover:bg-white/20"
              title="Send message"
            >
              {isLoading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </div>
        </form>
        <div className="mt-2 text-xs text-center text-white/50">
          Financial Chat can make mistakes. Check important info.
        </div>
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 bg-[#212121] border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <form onSubmit={handleSubmit} className="relative">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                disabled={isLoading}
                className="w-full resize-none rounded-3xl border border-white/20 bg-[#2f2f2f] px-4 py-3 pr-12 text-white placeholder-white/50 focus:border-white/30 focus:outline-none shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                rows={1}
                style={{ minHeight: "52px", maxHeight: "200px" }}
              />
              
              {/* Send button */}
              <button
                type="submit"
                disabled={!message.trim() || isLoading}
                className="absolute right-3 bottom-3 flex h-8 w-8 items-center justify-center rounded-full bg-white disabled:bg-white/20 text-black disabled:text-white/50 transition-all hover:bg-white/90 disabled:hover:bg-white/20"
              >
                {isLoading ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </form>
        
        {/* Disclaimer */}
        <div className="mt-2 text-xs text-white/50 text-center">
          Financial Chat can make mistakes. Check important info.
        </div>
      </div>
    </div>
  );
}
