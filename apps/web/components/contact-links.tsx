"use client";

import { useEffect, useRef, useState } from "react";

const EMAIL = "javierreansyah@gmail.com";
const LINKS = [
  { title: EMAIL, href: `mailto:${EMAIL}`, email: true },
  {
    title: "github.com/javierreansyah",
    href: "https://github.com/javierreansyah",
  },
  {
    title: "linkedin.com/in/javierreansyah",
    href: "https://linkedin.com/in/javierreansyah",
  },
];

export default function ContactLinks() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(EMAIL);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // The mailto link still works if clipboard access is unavailable.
    }
  }

  return (
    <>
      <ul className="contact-links">
        {LINKS.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              target={item.email ? undefined : "_blank"}
              rel={item.email ? undefined : "noopener noreferrer"}
              onClick={item.email ? copyEmail : undefined}
              className="group flex items-center justify-between gap-4 py-1 text-secondary hover:text-foreground"
            >
              <span className="group-hover:underline">
                {item.email && copied
                  ? "Email copied to clipboard!"
                  : item.title}
              </span>
              <span
                aria-hidden="true"
                className="shrink-0 text-muted-foreground group-hover:text-foreground"
              >
                {item.email && copied ? "✓" : "->"}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <span className="sr-only" role="status">
        {copied ? "Email copied to clipboard" : ""}
      </span>
    </>
  );
}
