"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const nav = [
  { href: "/", label: "Today", icon: "☀️" },
  { href: "/week", label: "This Week", icon: "📆" },
  { href: "/calls", label: "Calls", icon: "📞" },
  { href: "/meetings", label: "Meetings", icon: "🎙️" },
  { href: "/chat", label: "Assistant", icon: "💬" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar() {
  const path = usePathname();
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.userEmail) setUserEmail(data.userEmail);
      })
      .catch(() => {});
  }, []);

  return (
    <aside className="w-52 shrink-0 border-r border-zinc-800 bg-zinc-900 flex flex-col">
      <div className="p-4 border-b border-zinc-800 flex items-center gap-2.5">
        <img src="/icon-robot-1024.png" alt="" className="w-8 h-8 object-contain" draggable={false} />
        <div>
          <h1 className="text-white font-bold text-sm leading-tight">Taskora</h1>
          <p className="text-zinc-500 text-xs">Second Brain for Work</p>
        </div>
      </div>

      <nav className="p-3 flex-1">
        {nav.map((item) => {
          const active = path === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium mb-1 transition-colors ${
                active
                  ? "bg-indigo-600/20 text-indigo-300 border border-indigo-600/30"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-zinc-800 text-xs text-zinc-600">
        {userEmail || "Taskora"}
      </div>
    </aside>
  );
}
