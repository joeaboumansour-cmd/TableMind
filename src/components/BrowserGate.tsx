// =============================================
// Browser gate
//
// A tiny ES5 inline script, deliberately NOT part of the app bundle. Two jobs:
//
//  1. Tag the document with `.legacy` when the browser cannot parse oklch(),
//     which globals.css uses to switch off effects that are expensive on the
//     ten-year-old hardware those browsers run on.
//
//  2. On the MODERN deployment, send such a browser to the legacy deployment.
//     This is what stops a Windows 7 shop bookmarking the wrong URL and seeing
//     a black-and-white till: they can use either address and land correctly.
//
// The hard block for browsers below the baseline is NOT here — it is in
// src/middleware.ts, server-side, because a browser that old may not parse the
// bundle at all. This script only ever adds a class or navigates; it never
// rewrites the DOM, so it cannot fight React for the page.
//
// Keep it ES5: no const/let, no arrow functions, no template literals. It has
// to run on the browsers that cannot run everything else.
// =============================================

import { BYPASS_FLAG, IS_LEGACY_BUILD, LEGACY_URL } from "@/lib/browserSupport";

export default function BrowserGate() {
  const script =
    "(function(){try{" +
    "var ok=false;" +
    "try{ok=!!(window.CSS&&CSS.supports&&CSS.supports('color','oklch(0 0 0)'));}catch(e){}" +
    "if(!ok){document.documentElement.className+=' legacy';}" +
    // Legacy build: nothing further to do — middleware already handled the floor.
    (IS_LEGACY_BUILD ? "return;" : "") +
    "if(ok)return;" +
    "var u=" + JSON.stringify(LEGACY_URL) + ";if(!u)return;" +
    "var l=window.location;" +
    "if(l.search.indexOf('" + BYPASS_FLAG + "=1')>-1)return;" +
    "var b=u.replace(/\/+$/,'');" +
    // Never redirect to where we already are; that would loop forever.
    "if(l.href.indexOf(b)===0)return;" +
    "l.replace(b+l.pathname+l.search+l.hash);" +
    "}catch(e){}})();";

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
