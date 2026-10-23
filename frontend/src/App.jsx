import { useCallback, useEffect, useState } from "react";
import "./App.css";

const API_URL = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").trim().replace(/\/+$/, "");

async function readApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : { detail: await response.text() };
  if (!response.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status})`);
  }
  return data;
}

function formatINR(value) {
  return Number(value || 0).toLocaleString("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 2,
  });
}

function App() {
  const [product, setProduct] = useState("Office chairs");
  const [budget, setBudget] = useState("10000");
  const [quantity, setQuantity] = useState("5");
  const [result, setResult] = useState(null);
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [paypalLoading, setPaypalLoading] = useState(false);
  const [paypalMessage, setPaypalMessage] = useState("");
  const [paypalError, setPaypalError] = useState("");
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentResult, setAgentResult] = useState(null);
  const [agentError, setAgentError] = useState("");
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketResults, setMarketResults] = useState(null);
  const [marketError, setMarketError] = useState("");
  const [affiliateUrl, setAffiliateUrl] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [catalogue, setCatalogue] = useState(() => {
    try { return JSON.parse(localStorage.getItem("paypilot-affiliate-catalogue-v1") || "[]"); }
    catch { return []; }
  });
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [catalogueMessage, setCatalogueMessage] = useState("");

  useEffect(() => {
    try { localStorage.setItem("paypilot-affiliate-catalogue-v1", JSON.stringify(catalogue)); }
    catch { setCatalogueMessage("Could not save catalogue in this browser. Export your CSV to keep a backup."); }
  }, [catalogue]);

  function parseCsv(text) {
    const rows = []; let row = []; let cell = ""; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { row.push(cell.trim()); cell = ""; }
      else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
      } else cell += ch;
    }
    row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
    if (rows.length < 2) return [];
    const headers = rows.shift().map(h => h.toLowerCase().replace(/^\ufeff/, "").trim());
    return rows.map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])))
      .map((r, i) => ({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        product_name: r.product_name || r.product || r.name || "",
        category: r.category || "Other",
        marketplace: (r.marketplace || "Amazon India").trim(),
        affiliate_url: r.affiliate_url || r.tracked_url || r.url || "",
        notes: r.notes || ""
      }))
      .filter(r => r.product_name && /^https:\/\//i.test(r.affiliate_url));
  }

  async function importCatalogueFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = parseCsv(await file.text());
      if (!imported.length) throw new Error("No valid rows found. Required columns: product_name, category, affiliate_url.");
      setCatalogue(previous => {
        const byUrl = new Map(previous.map(item => [item.affiliate_url, item]));
        imported.forEach(item => byUrl.set(item.affiliate_url, item));
        return Array.from(byUrl.values());
      });
      setCatalogueMessage(`Imported ${imported.length} valid product link(s). Total catalogue: ${new Set([...catalogue.map(x => x.affiliate_url), ...imported.map(x => x.affiliate_url)]).size}.`);
    } catch (err) { setCatalogueMessage(err.message || "Could not import CSV."); }
    event.target.value = "";
  }

  function downloadCatalogueTemplate() {
    const csv = "product_name,category,marketplace,affiliate_url,notes\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = "paypilot-affiliate-products-template.csv"; a.click(); URL.revokeObjectURL(url);
  }

  function exportCatalogue() {
    const esc = value => `"${String(value || "").replace(/"/g, '""')}"`;
    const csv = ["product_name,category,marketplace,affiliate_url,notes", ...catalogue.map(p => [p.product_name,p.category,p.marketplace,p.affiliate_url,p.notes].map(esc).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = "paypilot-affiliate-products.csv"; a.click(); URL.revokeObjectURL(url);
  }

  const filteredCatalogue = catalogue.filter(item => `${item.product_name} ${item.category} ${item.notes}`.toLowerCase().includes(catalogueSearch.toLowerCase()));

  const loadRequests = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const data = await readApiResponse(await fetch(`${API_URL}/api/purchase/requests`));
      setRequests(data.requests || []);
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  useEffect(() => {
    const pathname = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const action = params.get("paypal");
    const isCancel = pathname === "/paypal/cancel" || action === "cancel";
    const isReturn = pathname === "/paypal/return" || action === "return";
    if (isCancel) {
      window.history.replaceState({}, "", "/");
      setPaypalMessage("PayPal checkout was cancelled. No payment was completed.");
      return;
    }
    if (!isReturn) return;
    const orderId = params.get("token") || params.get("order_id");
    window.history.replaceState({}, "", "/");
    if (!orderId) {
      setPaypalError("PayPal returned without an order ID.");
      return;
    }
    let ignore = false;
    (async () => {
      setPaypalLoading(true);
      setPaypalError("");
      setPaypalMessage("Verifying your PayPal Sandbox test payment...");
      try {
        const data = await readApiResponse(await fetch(`${API_URL}/api/paypal/capture-order`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order_id: orderId }),
        }));
        if (ignore) return;
        setPaypalMessage(data.payment_status === "completed"
          ? "Sandbox test payment verified: $1.00 USD. Your INR purchase budget has NOT been paid."
          : `PayPal response: ${data.payment_status || "Check payment status"}`);
        await loadRequests();
      } catch (err) {
        if (!ignore) { setPaypalError(err.message); setPaypalMessage(""); }
      } finally {
        if (!ignore) setPaypalLoading(false);
      }
    })();
    return () => { ignore = true; };
  }, [loadRequests]);

  async function getRecommendation(event) {
    event.preventDefault();
    setLoading(true); setError(""); setResult(null);
    setAgentResult(null); setAgentError(""); setMarketResults(null); setMarketError("");
    setPaypalError(""); setPaypalMessage("");
    try {
      const data = await readApiResponse(await fetch(`${API_URL}/api/purchase/recommend`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: product.trim(), budget: Number(budget), quantity: Number(quantity) }),
      }));
      setResult(data);
      await loadRequests();
    } catch (err) {
      setError(`${err.message} Check that FastAPI is running and MongoDB is connected.`);
    } finally { setLoading(false); }
  }

  async function searchProducts() {
    setMarketLoading(true); setMarketError(""); setMarketResults(null); setShareMessage("");
    try {
      const url = `${API_URL}/api/products/search?query=${encodeURIComponent(product.trim())}`;
      const data = await readApiResponse(await fetch(url));
      setMarketResults(data);
    } catch (err) { setMarketError(err.message); }
    finally { setMarketLoading(false); }
  }

  async function runAgentGrid() {
    if (!result?.id) { setAgentError("Generate and save a purchase request first."); return; }
    setAgentLoading(true); setAgentError(""); setAgentResult(null);
    try {
      const data = await readApiResponse(await fetch(`${API_URL}/api/agents/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchase_request_id: result.id }),
      }));
      setAgentResult(data);
    } catch (err) { setAgentError(`${err.message} Check that the FastAPI backend is running.`); }
    finally { setAgentLoading(false); }
  }

  async function startPayPalCheckout() {
    if (!result?.id) { setPaypalError("Generate a purchase request before starting the Sandbox test."); return; }
    setPaypalLoading(true); setPaypalError(""); setPaypalMessage("");
    try {
      const data = await readApiResponse(await fetch(`${API_URL}/api/paypal/create-order`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchase_request_id: result.id }),
      }));
      if (!data.approval_url) throw new Error("PayPal did not return an approval URL.");
      window.location.assign(data.approval_url);
    } catch (err) { setPaypalError(err.message); setPaypalLoading(false); }
  }

  async function copyAffiliateLink() {
    const value = affiliateUrl.trim();
    if (!/^https?:\/\//i.test(value)) {
      setShareMessage("Paste the full tracked affiliate URL first (it should start with https://).");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setShareMessage("Affiliate link copied. Share it only on channels allowed by your affiliate program, with a clear disclosure.");
    } catch {
      setShareMessage("Copy was blocked by this browser. Select and copy the affiliate URL manually.");
    }
  }

  const shareText = affiliateUrl.trim();
  const shareWhatsApp = `https://wa.me/?text=${encodeURIComponent(`Recommended product: ${shareText}`)}`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark">P</span> PayPilot <span className="brand-ai">AI</span></a>
        <span className="environment">DEMO ENVIRONMENT</span>
      </header>

      <section className="hero">
        <div className="eyebrow">AI-ASSISTED BUSINESS COMMERCE</div>
        <h1>Smarter purchasing.<br />Payments with control.</h1>
        <p>Plan a business purchase, open real marketplace search pages, review illustrative procurement analysis, and keep purchasing decisions in your hands.</p>
      </section>

      <section className="workspace">
        <form className="purchase-card" onSubmit={getRecommendation}>
          <div className="section-label">PURCHASE ASSISTANT</div>
          <h2>What does your business need?</h2>
          <label htmlFor="product">Product or service</label>
          <input id="product" value={product} onChange={e => setProduct(e.target.value)} minLength={2} maxLength={150} required />
          <div className="form-grid">
            <div><label htmlFor="budget">Total budget (₹)</label><input id="budget" type="number" min="1" max="100000000" step="0.01" value={budget} onChange={e => setBudget(e.target.value)} required /></div>
            <div><label htmlFor="quantity">Quantity</label><input id="quantity" type="number" min="1" max="100000" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} required /></div>
          </div>
          <button className="primary-button" disabled={loading}>{loading ? "Saving request..." : "Generate purchase request"} <span>→</span></button>
          <p className="privacy-note">Saving a purchase request does not initiate a payment.</p>
          <button type="button" className="secondary-button" onClick={searchProducts} disabled={marketLoading || product.trim().length < 2}>{marketLoading ? "Opening marketplace links..." : "Find real marketplace listings"} <span>↗</span></button>
          <p className="privacy-note">Opens current marketplace search pages. PayPilot does not yet retrieve verified live prices, stock, or product feeds.</p>
          <button type="button" className="primary-button" onClick={startPayPalCheckout} disabled={paypalLoading || !result?.id}>{paypalLoading ? "Processing..." : "Run $1.00 PayPal Sandbox Test"} <span>→</span></button>
          <p className="privacy-note">Sandbox test only. The $1.00 USD test is separate from your INR purchase budget and does not pay for goods.</p>
          {paypalMessage && <p className="success-message" role="status">{paypalMessage}</p>}
          {paypalError && <p className="error-message" role="alert">{paypalError}</p>}
        </form>

        <section className="result-card">
          <div className="section-label">PURCHASE OVERVIEW</div><h2>Your workspace</h2>
          {!result && !error && <div className="empty-state"><div className="empty-icon">✳</div><h3>Your next purchase starts here</h3><p>Enter a product, budget, and quantity to generate your first purchase request.</p></div>}
          {loading && <p>Saving your request to MongoDB...</p>}
          {error && <div className="error-message" role="alert">{error}</div>}
          {result && <div className="result-content">
            <span className="status-pill">Request prepared</span><h3>{result.product_requested}</h3>
            <p className="muted">{Number(result.quantity).toLocaleString("en-IN")} units requested</p>
            <div className="metric"><span>Total budget</span><strong>{formatINR(result.total_budget)}</strong></div>
            <div className="metric"><span>Budget per item</span><strong>{formatINR(result.budget_per_item)}</strong></div>
            <div className="recommendation"><strong>Next step</strong><p>{result.recommendation}</p></div>
            <p className="demo-notice">{result.saved_to_database ? "Purchase request saved to MongoDB Atlas." : "Demo result only."} No live product price lookup or AI recommendation has been performed.</p>
            <div className="approval-status"><span>Actual purchase payment</span><strong>{result.payment_status || "not_started"}</strong></div>
            <div className="approval-status"><span>Sandbox test payment</span><strong>{result.sandbox_test_payment_status || "not_started"}</strong></div>
            <p className="privacy-note">A completed $1.00 Sandbox test does not pay the ₹ purchase budget.</p>
            <p className="muted">Request ID: {result.id}</p>
          </div>}
        </section>
      </section>

      {marketError && <p className="error-message">{marketError}</p>}
      {marketResults && <section className="result-card full-section">
        <div className="section-label">REAL MARKETPLACE SEARCH</div><h2>Search for {marketResults.query}</h2>
        <div className="demo-data-banner"><strong>{marketResults.data_source_label}</strong><span>These are external search pages, not a verified price comparison.</span></div>
        <div className="marketplace-grid">
          {(marketResults.offers || []).map(item => <article className="marketplace-card" key={item.marketplace}>
            <h3>{item.marketplace}</h3><p className="muted">Search current listings for “{marketResults.query}”.</p>
            <a className="link-button" href={item.url} target="_blank" rel="noreferrer">Open search ↗</a>
          </article>)}
        </div>
        <p className="privacy-note">{marketResults.notice}</p>
        <div className="affiliate-box">
          <h3>Share your tracked affiliate link</h3>
          <p className="muted">Open a specific product and create a tracked link using Amazon SiteStripe or your approved affiliate network. Paste that full link below.</p>
          <label htmlFor="affiliateUrl">Tracked affiliate URL</label>
          <input id="affiliateUrl" type="url" placeholder="https://..." value={affiliateUrl} onChange={e => setAffiliateUrl(e.target.value)} />
          <div className="share-actions">
            <button type="button" className="secondary-button" onClick={copyAffiliateLink}>Copy affiliate link</button>
            <a className={`link-button ${!shareText ? "disabled-link" : ""}`} href={shareText ? shareWhatsApp : undefined} target="_blank" rel="noreferrer" onClick={e => { if (!shareText) { e.preventDefault(); setShareMessage("Paste a tracked affiliate URL first."); } }}>Share via WhatsApp ↗</a>
          </div>
          {shareMessage && <p className="muted" role="status">{shareMessage}</p>}
          <p className="disclosure">Disclosure example: “As an Amazon Associate I earn from qualifying purchases.” Follow the disclosure and social-channel rules of the affiliate program you use.</p>
        </div>
      </section>}

      <section className="full-section">
        <div className="history-heading"><div><div className="section-label">AFFILIATE PRODUCT CATALOGUE</div><h2>Your Amazon product links</h2><p className="muted">Import your 50 tracked links from CSV. Direct affiliate links open in a new tab. This catalogue does not invent prices or scrape retailer pages.</p></div><span className="status-pill">{catalogue.length} products</span></div>
        <div className="catalogue-tools">
          <button type="button" className="secondary-button" onClick={downloadCatalogueTemplate}>Download CSV template</button>
          <label className="file-upload-button">Import product CSV<input type="file" accept=".csv,text/csv" onChange={importCatalogueFile} /></label>
          <button type="button" className="secondary-button" onClick={exportCatalogue} disabled={!catalogue.length}>Export catalogue</button>
        </div>
        <p className="privacy-note">Required CSV columns: product_name, category, marketplace, affiliate_url, notes. Use your full tracked Amazon SiteStripe URL for Amazon India products.</p>
        {catalogueMessage && <p className="success-message" role="status">{catalogueMessage}</p>}
        <label className="catalogue-search-label" htmlFor="catalogueSearch">Filter your saved products</label>
        <input className="catalogue-search" id="catalogueSearch" value={catalogueSearch} onChange={e => setCatalogueSearch(e.target.value)} placeholder="Search by product name or category" />
        {filteredCatalogue.length === 0 ? <div className="empty-state compact-empty"><h3>{catalogue.length ? "No matching products" : "Add your 50 affiliate links"}</h3><p>{catalogue.length ? "Try a different search term." : "Download the CSV template, add your product names and tracked URLs, then import it here."}</p></div> : <div className="catalogue-grid">{filteredCatalogue.map(item => {
          const query = encodeURIComponent(item.product_name);
          const marketplaceLinks = [
            { name: "Amazon India search", url: `https://www.amazon.in/s?k=${query}` },
            { name: "Flipkart search", url: `https://www.flipkart.com/search?q=${query}` },
            { name: "Walmart US search", url: `https://www.walmart.com/search?q=${query}` }
          ];
          return <article className="catalogue-card" key={item.id || item.affiliate_url}>
            <span className="catalogue-category">{item.category || "Other"}</span><h3>{item.product_name}</h3><p className="muted">{item.marketplace || "Amazon India"}{item.notes ? ` · ${item.notes}` : ""}</p>
            <a className="link-button catalogue-buy" href={item.affiliate_url} target="_blank" rel="sponsored nofollow noreferrer">Open affiliate product ↗</a>
            <p className="affiliate-small-note">Affiliate link · retailer checkout handles the purchase</p>
            <div className="catalogue-market-links">{marketplaceLinks.map(link => <a key={link.name} href={link.url} target="_blank" rel="noreferrer">{link.name} ↗</a>)}</div>
          </article>;
        })}</div>}
        <p className="disclosure">Affiliate disclosure: As an Amazon Associate I earn from qualifying purchases. Prices and availability are set by each retailer and may change. PayPilot does not collect the product payment; the retailer processes checkout.</p>
      </section>

      <section className="full-section">
        <div className="history-heading"><div><div className="section-label">MULTI-AGENT WORKFLOW</div><h2>AI Agent Grid</h2><p className="muted">Run a coordinated procurement analysis on the saved request.</p></div><button type="button" className="secondary-button" onClick={runAgentGrid} disabled={!result?.id || agentLoading}>{agentLoading ? "Agents working..." : "Run Agent Grid"}</button></div>
        <div className="agent-grid">
          {[["Research Agent", "Procurement research checklist"], ["Budget Agent", "Per-unit budget calculations"], ["Risk Agent", "Unverified details and procurement risks"], ["Procurement Agent", "Buyer approval and next-step recommendation"]].map(([name, desc]) => <article className="agent-card" key={name}><h3>{name}</h3><p className="muted">{desc}</p><span className="status-pill">{agentResult ? "Analysis complete" : "Ready to run"}</span></article>)}
        </div>
        <p className="privacy-note">The current Agent Grid uses illustrative synthetic offers. It does not scrape marketplace listings or call an external LLM.</p>
        {agentError && <p className="error-message" role="alert">{agentError}</p>}
        {agentResult && <div className="recommendation">
          <div className="demo-data-banner"><strong>{agentResult.data_source_label || "DEMO DATA"}</strong><span>Verify real prices and availability before buying.</span></div>
          <h3>Agent workflow results</h3><p>{agentResult.summary}</p>
          <div className="agent-status-list">{(agentResult.agents || []).map(agent => <article className="agent-status-row" key={agent.id || agent.name}><div><strong>{agent.name}</strong><p>{agent.result}</p></div><span className="status-pill">{agent.status || "completed"}</span></article>)}</div>
          <div className="supplier-table-wrap"><table className="supplier-table"><thead><tr><th>Demo source</th><th>Unit price</th><th>Qty</th><th>Estimated total</th><th>Budget check</th></tr></thead><tbody>{(agentResult.offers || []).map(offer => <tr key={offer.supplier}><td><strong>{offer.supplier}</strong><span className="table-subtitle">{offer.marketplace_style}</span></td><td>{formatINR(offer.unit_price)}</td><td>{offer.quantity}</td><td><strong>{formatINR(offer.estimated_total)}</strong><span className="table-subtitle">{offer.delivery_days}</span></td><td><span className={`status-pill ${offer.within_budget ? "status-ok" : "status-warning"}`}>{offer.within_budget ? `Under by ${formatINR(offer.budget_remaining)}` : `Over by ${formatINR(Math.abs(offer.budget_remaining))}`}</span>{offer.recommended && <span className="recommended-label">Recommended demo</span>}</td></tr>)}</tbody></table></div>
          <div className="recommendation"><strong>Procurement Agent recommendation</strong><p>{agentResult.recommendation}</p></div>
          <ul>{(agentResult.checklist || []).map((item, index) => <li key={index}>{item}</li>)}</ul>
          <p className="privacy-note">Buyer approval is required. The separate $1 Sandbox test does not purchase items.</p>
        </div>}
      </section>

      <section className="full-section">
        <div className="history-heading"><div><div className="section-label">MONGODB ATLAS</div><h2>Saved purchase requests</h2></div><button type="button" className="secondary-button" onClick={loadRequests} disabled={historyLoading}>{historyLoading ? "Refreshing..." : "Refresh"}</button></div>
        {historyError && <p className="error-message" role="alert">{historyError}</p>}
        {!historyError && requests.length === 0 && !historyLoading && <p className="muted">No saved requests found.</p>}
        <div className="request-list">{requests.map(req => <article className="saved-request" key={req.id}><div><h3>{req.product}</h3><p className="muted">{req.quantity} units · {req.id}</p></div><div className="saved-request-details"><strong>{formatINR(req.budget)}</strong><span>Purchase: {req.payment_status || "not_started"}</span><span>Sandbox test: {req.sandbox_test_payment_status || "not_started"}</span></div></article>)}</div>
      </section>
      <footer><span>PayPilot AI</span><span>AI-assisted commerce · User-controlled payments</span></footer>
    </main>
  );
}

export default App;
