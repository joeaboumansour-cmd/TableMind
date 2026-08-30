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
//   * a category bar pinned to the very top — the primary way around the menu,
//     reachable with a thumb no matter how far down the page has scrolled
//   * compact item cards: name and price share one line and everything else is
//     secondary, so a section fits on a screen instead of one item filling it
//   * prices in LL with USD underneath, because both are used in Lebanon
//   * every item shown plainly — NOTHING on this page is tied to stock, and
//     nothing is ever marked sold out (see the note in lib/menu/types.ts)
//   * no images — the catalogue has none, and a menu of grey placeholders
//     looks broken rather than minimal
//
// The category bar JUMPS, it does not filter. A menu is read by scrolling past
// things you were not looking for, and hiding every other section behind a tap
// is how a customer never discovers the coffee.
//
// Deliberately NOT offline-capable: it is for customers on their own phones,
// not for the shop's till, so it has no cache and no service-worker role.
// =============================================

import { use, useEffect, useMemo, useRef, useState } from "react";
import { formatLL, formatUSD, convertLlToUsdForReturn } from "@/lib/utils/format";
import type { PublicMenu } from "@/lib/menu/types";

/** Height of the sticky category bar. One number, used by every offset here. */
const BAR_H = 56;

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
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

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
  // trigger line to just under the sticky bar rather than the viewport top, so
  // the bar does not light up a section still hidden behind it.
  useEffect(() => {
    if (state !== "ready" || !menu) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: `-${BAR_H + 8}px 0px -60% 0px`, threshold: 0 }
    );
    for (const el of sectionRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [state, menu]);

  // Keep the active chip in view. With more categories than fit the strip, the
  // section being read is often scrolled off the end of it — which reads as
  // "there is no button for this part of the menu".
  useEffect(() => {
    if (!activeSection) return;
    chipRefs.current
      .get(activeSection)
      ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [activeSection]);

  const scrollTo = (id: string) => {
    const el = sectionRefs.current.get(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - (BAR_H + 12);
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
      {/* ---- Category bar ----
          The FIRST thing on the page and pinned there, so categories are the
          control the menu is navigated with rather than something found by
          scrolling to it. Only earns its space when there is more than one
          section to move between. */}
      {menu.sections.length > 1 && (
        <nav
          className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur"
          style={{ height: BAR_H }}
        >
          <div className="no-scrollbar mx-auto flex h-full max-w-3xl items-center gap-1.5 overflow-x-auto px-4">
            {menu.sections.map((section) => {
              const selected = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  ref={(el) => {
                    if (el) chipRefs.current.set(section.id, el);
                    else chipRefs.current.delete(section.id);
                  }}
                  onClick={() => scrollTo(section.id)}
                  aria-current={selected ? "true" : undefined}
                  className={`flex h-9 flex-none items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
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

      {/* ---- Masthead ---- */}
      <header className="mx-auto max-w-3xl px-4 pb-4 pt-6">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight">
          {menu.store.name}
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {itemCount} {itemCount === 1 ? "item" : "items"}
          {menu.store.address ? ` · ${menu.store.address}` : ""}
        </p>
      </header>

      {/* ---- Sections ---- */}
      {menu.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          ref={(el) => {
            if (el) sectionRefs.current.set(section.id, el);
            else sectionRefs.current.delete(section.id);
          }}
          className="mx-auto max-w-3xl px-4 pt-5"
          style={{ scrollMarginTop: BAR_H + 12 }}
        >
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-primary">
            {section.name}
          </h2>

          {/* Two columns as soon as the screen has room for them. On a phone
              the cards get their compactness from padding and type size. */}
          <ul className="grid gap-2 sm:grid-cols-2">
            {section.items.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-border bg-card px-3 py-2.5"
              >
                {/* Name and price share one line — the price is what the eye
                    scans for down the right edge. */}
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="min-w-0 text-[15px] font-semibold leading-snug">
                    {item.name}
                  </h3>
                  <div className="flex-none text-right leading-none">
                    <span className="block text-[15px] font-bold tabular-nums">
                      {formatLL(item.price_ll)}
                    </span>
                    <span className="mt-1 block text-[11px] tabular-nums text-muted-foreground">
                      {formatUSD(convertLlToUsdForReturn(item.price_ll))}
                    </span>
                  </div>
                </div>

                {item.contains.length > 0 && (
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                    {item.contains.join(" · ")}
                  </p>
                )}

                {/* Extras as one quiet line rather than a row of pills. A pill
                    each turned a two-line card into a five-line one, and they
                    are the least-read thing on it. */}
                {item.extras.length > 0 && (
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/70">
                    {item.extras.map((extra, i) => (
                      <span key={extra.name}>
                        {i > 0 && <span className="mx-1 opacity-50">·</span>}+{" "}
                        {extra.name}
                        {extra.price_ll > 0 && (
                          <span className="ml-1 font-semibold tabular-nums text-foreground/80">
                            {formatLL(extra.price_ll)}
                          </span>
                        )}
                      </span>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {menu.sections.length === 0 && (
        <p className="mx-auto max-w-3xl px-4 py-12 text-center text-sm text-muted-foreground">
          Nothing on the menu yet.
        </p>
      )}

      {/* ---- Footer ---- */}
      <footer className="mx-auto mt-10 max-w-3xl border-t border-border px-4 pt-5 text-sm text-muted-foreground">
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
