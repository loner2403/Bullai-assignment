"use client";
import { ThemeProvider } from "../components/ThemeProvider";
import { ChatLayout } from "../components/ChatLayout";

export default function Home() {
  return (
    <ThemeProvider>
      <ChatLayout />
    </ThemeProvider>
  );
}
