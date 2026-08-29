"use client";

// =============================================
// /menu/[token] — the public menu
// =============================================
// What a customer sees after scanning the QR on a table tent. Built from
// inventory, so it cannot drift from what the till actually sells.
//
// PUBLIC. No auth, no AppShell, no tab bar, no cart. Someone lands here from a
// phone camera with one hand full of food, so:
//
//   * one column, large type, generous tap targets
//   * a sticky section rail that tracks where you are as you scroll
//   * prices in LL with USD underneath, because both are used in Lebanon
//   * no images — the catalogue has none, and a menu of grey placeholders
//     looks broken rather than minimal
//
// Deliberately NOT offline-capable: it is for customers on their own phones,
// not for the shop's till, so it has no cache and no service-worker role.
// =============================================

import { use, useEffect, useMemo, useRef, useState } from "react";
import { formatLL, formatUSD, convertLlToUsdForReturn } from "@/lib/utils/format";
import type { PublicMenu } from "@/lib/menu/types";

export default function PublicMenuPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
    "loading"
  );
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/public/menu/${encodeURIComponent(token)}`);
        if (response.status === 404) {
          if (!cancelled) setState("missing");
          return;
        }
        if (!response.ok) throw new Error(`API error ${response.status}`);
        const body = (await response.json()) as PublicMenu;
        if (cancelled) return;
        setMenu(body);
        setActiveSection(body.sections[0]?.id ?? null);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Highlight the section the reader is actually in. rootMargin biases the
  // trigger line to just under the sticky rail rather than the viewport top,
  // so the rail does not light up a section still hidden behind it.
  useEffect(() => {
    if (state !== "ready" || !menu) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 }
    );
    for (const el of sectionRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [state, menu]);

  const scrollTo = (id: string) => {
    const el = sectionRefs.current.get(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({ top, behavior: "smooth" });
  };

  const itemCount = useMemo(
    () => (menu ? menu.sections.reduce((n, s) => n + s.items.length, 0) : 0),
    [menu]
  );

  if (state === "loading") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6">
        <p className="text-sm text-muted-foreground">Loading the menu…</p>
      </main>
    );
  }

  if (state === "missing") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6">
        <div className="text-center">
          <h1 className="text-xl font-bold">Menu not available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This menu has been taken down, or the code is out of date. Ask the
            counter for the current one.
          </p>
        </div>
      </main>
    );
  }

  if (state === "error" || !menu) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-6">
        <div className="text-center">
          <h1 className="text-xl font-bold">Could not load the menu</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Check your connection and try again.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-background pb-16">
      {/* ---- Masthead ---- */}
      <header className="px-5 pb-5 pt-10">
        <h1 className="text-[32px] font-bold leading-tight tracking-tight">
          {menu.store.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {itemCount} {itemCount === 1 ? "item" : "items"}
          {menu.store.address ? ` · ${menu.store.address}` : ""}
        </p>
      </header>

      {/* ---- Sticky section rail ---- */}
      {menu.sections.length > 1 && (
        <nav className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 py-3">
            {menu.sections.map((section) => {
              const selected = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => scrollTo(section.id)}
                  aria-current={selected ? "true" : undefined}
                  className={`flex h-9 flex-none items-center rounded-full px-4 text-sm font-semibold transition-colors ${
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/60 text-muted-foreground"
                  }`}
                >
                  {section.name}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* ---- Sections ---- */}
      {menu.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          ref={(el) => {
            if (el) sectionRefs.current.set(section.id, el);
            else sectionRefs.current.delete(section.id);
          }}
          className="scroll-mt-24 px-5 pt-8"
        >
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-primary">
            {section.name}
          </h2>

          <ul className="space-y-3">
            {section.items.map((item) => (
              <li
                key={item.id}
                className={`rounded-2xl border border-border bg-card p-4 ${
                  item.available ? "" : "opacity-50"
                }`}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="min-w-0 text-[17px] font-semibold leading-tight">
                    {item.name}
                    {!item.available && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        Sold out
                      </span>
                    )}
                  </h3>
                  <div className="flex-none text-right">
                    <p className="text-[17px] font-bold tabular-nums">
                      {formatLL(item.price_ll)}
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {formatUSD(convertLlToUsdForReturn(item.price_ll))}
                    </p>
                  </div>
                </div>

                {item.contains.length > 0 && (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.contains.join(" · ")}
                  </p>
                )}

                {item.extras.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {item.extras.map((extra) => (
                      <span
                        key={extra.name}
                        className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"
                      >
                        + {extra.name}
                        {extra.price_ll > 0 && (
                          <span className="ml-1 font-semibold text-foreground tabular-nums">
                            {formatLL(extra.price_ll)}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {menu.sections.length === 0 && (
        <p className="px-5 py-12 text-center text-sm text-muted-foreground">
          Nothing on the menu yet.
        </p>
      )}

      {/* ---- Footer ---- */}
      <footer className="mt-12 border-t border-border px-5 pt-6 text-sm text-muted-foreground">
        {menu.store.phone_whatsapp && (
          <a
            href={`tel:${menu.store.phone_whatsapp}`}
            className="font-semibold text-primary"
          >
            {menu.store.phone_whatsapp}
          </a>
        )}
        {menu.store.address && <p className="mt-1">{menu.store.address}</p>}
        <p className="mt-4 text-xs">
          Prices in Lebanese Pounds. USD shown for reference.
        </p>
      </footer>
    </main>
  );
}
