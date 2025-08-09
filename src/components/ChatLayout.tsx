"use client";
import React, { useState, useRef, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Message } from "./Message";
import { ChatInput } from "./ChatInput";

type ChartSpec = {
  type?: "line" | "bar" | "scatter" | "pie";
  labels: string[];
  series: { name: string; values: number[]; color?: string }[];
  unit?: string;
  stacked?: boolean;
};

type Source = {
  id?: string;
  source?: string;
  title?: string;
  company?: string;
  doc_type?: string;
  published_date?: string;
  page_start?: number;
  page_end?: number;
  chunk_index?: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  chartSpec?: ChartSpec | null;
  sources?: Source[];
  timestamp: Date;
};

export function ChatLayout() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (content: string) => {
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: content }),
      });

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const data = await response.json();
      
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.answer,
        chartSpec: data.chartSpec,
        sources: data.sources,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, I encountered an error while processing your request. Please try again.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`relative flex min-h-dvh bg-[#212121] overflow-x-hidden ${sidebarOpen ? 'overflow-hidden' : ''}`}>
      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNewChat={() => {
          setMessages([]);
          setSidebarOpen(false);
        }}
      />
      
      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:ml-[260px]">
        {/* Top bar (mobile) */}
        <header className="flex items-center justify-between p-4 border-b border-white/10 bg-[#212121] lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-md hover:bg-white/10 text-white/70 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-green-500 to-emerald-600 rounded-sm flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
            </div>
            <span className="text-white font-medium text-sm">Financial Chat</span>
          </div>
          <div className="w-9" /> {/* Spacer */}
        </header>

        {/* Messages / Empty state */}
        <div className="flex-1 overflow-y-auto pb-24">
          {messages.length === 0 ? (
            <div className="relative mx-auto flex h-full w-full max-w-4xl flex-col items-center justify-center px-6 py-12">
              {/* Title like ChatGPT hero */}
              <div className="mb-12 text-center">
                <h1 className="mb-4 text-4xl md:text-5xl lg:text-6xl font-medium text-white">
                  How can I help you today?
                </h1>
              </div>
              {/* Large centered input bar */}
              <div className="w-full">
                <ChatInput
                  onSendMessage={handleSendMessage}
                  isLoading={isLoading}
                  variant="hero"
                  placeholder="Message Financial Chat"
                />
              </div>
            </div>
          ) : (
            <div className="bg-[#212121]">
              {messages.map((message) => (
                <Message
                  key={message.id}
                  role={message.role}
                  content={message.content}
                  chartSpec={message.chartSpec}
                  sources={message.sources}
                />
              ))}
              {isLoading && (
                <div className="bg-[#2f2f2f]">
                  <div className="max-w-3xl mx-auto px-4 py-6">
                    <div className="flex gap-4">
                      <div className="flex-shrink-0">
                        <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-sm flex items-center justify-center">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                          </svg>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-white/70">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Financial Chat is typing...
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        {messages.length > 0 && (
          <ChatInput onSendMessage={handleSendMessage} isLoading={isLoading} variant="dock" />
        )}
      </div>
    </div>
  );
}
