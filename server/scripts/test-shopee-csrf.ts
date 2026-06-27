const keyword = "bubble wrap";
const ctrl = new AbortController();
setTimeout(() => ctrl.abort(), 15000);

const home = await fetch("https://shopee.sg/", {
  signal: ctrl.signal,
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
});

const rawCookies = home.headers.getSetCookie?.() ?? [];
console.log("cookies:", rawCookies.length);
const cookieHeader = rawCookies.map((c) => c.split(";")[0]).join("; ");
const csrf = rawCookies.find((c) => c.startsWith("csrftoken="))?.split(";")[0]?.split("=")[1];
console.log("csrf:", csrf?.slice(0, 20));

const url = `https://shopee.sg/api/v4/search/search_items?by=relevancy&keyword=${encodeURIComponent(keyword)}&limit=10&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;
const res = await fetch(url, {
  signal: ctrl.signal,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    Referer: `https://shopee.sg/search?keyword=${encodeURIComponent(keyword)}`,
    Accept: "application/json",
    "x-api-source": "pc",
    "x-shopee-language": "en",
    "x-csrftoken": csrf ?? "",
    Cookie: cookieHeader,
  },
});

console.log("status:", res.status);
const data = await res.json();
console.log("error:", data.error, "items:", data.items?.length);
data.items?.slice(0, 5).forEach((row: { item_basic: { name: string; price: number; shopid: number; itemid: number } }, i: number) => {
  const b = row.item_basic;
  console.log(`${i + 1}. S$${(b.price / 100000).toFixed(2)} ${b.name}`);
});
