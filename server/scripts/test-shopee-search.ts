const keyword = process.argv[2] ?? "bubble wrap";

async function tryShopeeApiWithCookies() {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 20_000);
  const home = await fetch("https://shopee.sg/", {
    signal: ctrl.signal,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  const cookie = home.headers.get("set-cookie") ?? "";
  const url = `https://shopee.sg/api/v4/search/search_items?by=relevancy&keyword=${encodeURIComponent(keyword)}&limit=20&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;
  const res = await fetch(url, {
    signal: ctrl.signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: `https://shopee.sg/search?keyword=${encodeURIComponent(keyword)}`,
      Accept: "application/json",
      Cookie: cookie.split(",").map((c) => c.split(";")[0]).join("; "),
    },
  });
  const data = (await res.json()) as {
    error?: number;
    items?: Array<{ item_basic?: { name?: string; price?: number; shopid?: number; itemid?: number } }>;
  };
  if (data.error) throw new Error(`Shopee API error ${data.error}`);
  return (data.items ?? []).map((row) => {
    const b = row.item_basic!;
    const slug = (b.name ?? "item").replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").slice(0, 80);
    return {
      title: b.name ?? "",
      url: `https://shopee.sg/${slug}-i.${b.shopid}.${b.itemid}`,
      listingPrice: (b.price ?? 0) / 100_000,
    };
  });
}

async function tryShopeeApi() {
  const url = `https://shopee.sg/api/v4/search/search_items?by=relevancy&keyword=${encodeURIComponent(keyword)}&limit=20&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 12_000);
  const res = await fetch(url, {
    signal: ctrl.signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: "https://shopee.sg/",
      Accept: "application/json",
    },
  });
  const data = (await res.json()) as {
    items?: Array<{ item_basic?: { name?: string; price?: number; shopid?: number; itemid?: number } }>;
  };
  return (data.items ?? []).map((row) => {
    const b = row.item_basic!;
    const slug = (b.name ?? "item").replace(/\s+/g, "-").slice(0, 60);
    return {
      title: b.name ?? "",
      url: `https://shopee.sg/${slug}-i.${b.shopid}.${b.itemid}`,
      listingPrice: (b.price ?? 0) / 100_000,
      shopid: b.shopid,
      itemid: b.itemid,
    };
  });
}

async function tryDuckDuckGo() {
  const q = `site:shopee.sg ${keyword} -i.`;
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 12_000);
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    signal: ctrl.signal,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const html = await res.text();
  const urls = new Set<string>();
  for (const m of html.matchAll(/uddg=([^&"]+)/g)) {
    try {
      const u = decodeURIComponent(m[1]);
      if (u.includes("shopee.sg") && u.includes("-i.")) urls.add(u.split("?")[0]);
    } catch { /* ignore */ }
  }
  return [...urls].map((url) => ({ title: url.split("/").pop()?.split("-i.")[0]?.replace(/-/g, " ") ?? "", url, listingPrice: 0 }));
}

async function tryShopeeSearchPage() {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 15_000);
  const res = await fetch(`https://shopee.sg/search?keyword=${encodeURIComponent(keyword)}`, {
    signal: ctrl.signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "text/html",
    },
  });
  const html = await res.text();
  const urls = new Set<string>();
  for (const m of html.matchAll(/https:\\\/\\\/shopee\.sg\\\/([^"\\]+)-i\.(\d+)\.(\d+)/g)) {
    urls.add(`https://shopee.sg/${m[1]}-i.${m[2]}.${m[3]}`);
  }
  for (const m of html.matchAll(/https:\/\/shopee\.sg\/[^\s"'\\]+-i\.\d+\.\d+/g)) {
    urls.add(m[0].split("?")[0]);
  }
  return [...urls].map((url) => ({
    title: titleFromListingUrl(url) ?? "",
    url,
    listingPrice: 0,
  }));
}

function titleFromListingUrl(url: string): string | null {
  const shopee = url.match(/shopee\.sg\/([^/?]+)-i\.\d+/i);
  if (shopee) return decodeURIComponent(shopee[1].replace(/-/g, " "));
  return null;
}

console.log(`Testing "${keyword}"…\n`);
try {
  const api2 = await tryShopeeApiWithCookies();
  console.log("\nShopee API (with cookies):", api2.length, "items");
  api2.slice(0, 8).forEach((x, i) => console.log(`  ${i + 1}. S$${x.listingPrice.toFixed(2)} — ${x.title}`));
} catch (e) {
  console.log("Shopee API+cookies failed:", e instanceof Error ? e.message : e);
}

try {
  const api = await tryShopeeApi();
  console.log("Shopee API:", api.length, "items");
  api.slice(0, 5).forEach((x, i) => console.log(`  ${i + 1}. S$${x.listingPrice} — ${x.title}`));
} catch (e) {
  console.log("Shopee API failed:", e instanceof Error ? e.message : e);
}

try {
  const ddg = await tryDuckDuckGo();
  console.log("\nDuckDuckGo:", ddg.length, "urls");
  ddg.slice(0, 5).forEach((x, i) => console.log(`  ${i + 1}. ${x.title} — ${x.url}`));
} catch (e) {
  console.log("DuckDuckGo failed:", e instanceof Error ? e.message : e);
}

try {
  const page = await tryShopeeSearchPage();
  console.log("\nShopee search page:", page.length, "urls");
  page.slice(0, 5).forEach((x, i) => console.log(`  ${i + 1}. ${x.title} — ${x.url}`));
} catch (e) {
  console.log("Shopee page failed:", e instanceof Error ? e.message : e);
}
