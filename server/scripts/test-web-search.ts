const keyword = process.argv.slice(2).join(" ") || "bubble wrap";

async function ddgInstant() {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(`site:shopee.sg ${keyword}`)}&format=json&no_redirect=1`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  return res.json();
}

async function braveSearch() {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return null;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(`site:shopee.sg ${keyword} -i.`)}&count=15`;
  const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": key } });
  return res.json();
}

console.log("DDG instant:");
try {
  const d = await ddgInstant();
  console.log(JSON.stringify(d.RelatedTopics?.slice(0, 3), null, 2));
  console.log("Results:", d.Results?.length ?? 0);
} catch (e) {
  console.log(e);
}

console.log("\nBrave:", process.env.BRAVE_SEARCH_API_KEY ? "configured" : "no key");
try {
  const b = await braveSearch();
  if (b?.web?.results) {
    b.web.results.slice(0, 8).forEach((r: { title: string; url: string }, i: number) => {
      if (r.url.includes("-i.")) console.log(`${i + 1}. ${r.title}\n   ${r.url}`);
    });
  } else {
    console.log(b ?? "skipped");
  }
} catch (e) {
  console.log(e);
}
