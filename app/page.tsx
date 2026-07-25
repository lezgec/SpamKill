"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Provider = "gmail" | "outlook" | "icloud";
type Filter = "Todos" | "Publicidad" | "Newsletters" | "Notificaciones";
type ScanRange = "all" | "30d" | "90d" | "1y" | "custom";
type Sender = {
  id: string;
  name: string;
  domain: string;
  count: number;
  category: Exclude<Filter, "Todos">;
  color: string;
  initials: string;
  last: string;
  unsub: boolean;
  primaryMessageId: string;
  latestAt: number;
};
type HistoryRecord = {
  id: string;
  senderEmail: string;
  senderName: string;
  senderDomain: string;
  status: "verifying" | "confirmed" | "manual" | "failed";
  requestedAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
  messagesTrashed: number;
};

const providers = {
  gmail: { name: "Gmail", email: "Cuenta de Google", mark: "M", tone: "gmail" },
  outlook: { name: "Outlook", email: "Próximamente", mark: "O", tone: "outlook" },
  icloud: { name: "iCloud", email: "Próximamente", mark: "●", tone: "icloud" },
} as const;
const rangeLabels: Record<ScanRange, string> = {
  all: "Todos los correos",
  "30d": "Últimos 30 días",
  "90d": "Últimos 90 días",
  "1y": "Último año",
  custom: "Fechas personalizadas",
};

const demoSenders: Sender[] = [
  { id: "temu", name: "Temu", domain: "mail.temu.com", count: 84, category: "Publicidad", color: "#f2612f", initials: "T", last: "Hoy", unsub: true, primaryMessageId: "", latestAt: 0 },
  { id: "canva", name: "Canva", domain: "canva.com", count: 31, category: "Newsletters", color: "#7b61ff", initials: "CA", last: "Ayer", unsub: true, primaryMessageId: "", latestAt: 0 },
  { id: "linkedin", name: "LinkedIn", domain: "linkedin.com", count: 27, category: "Notificaciones", color: "#1676b7", initials: "IN", last: "22 jul", unsub: true, primaryMessageId: "", latestAt: 0 },
  { id: "aliexpress", name: "AliExpress", domain: "aliexpress.com", count: 22, category: "Publicidad", color: "#e74334", initials: "A", last: "21 jul", unsub: true, primaryMessageId: "", latestAt: 0 },
  { id: "medium", name: "Medium Daily Digest", domain: "medium.com", count: 18, category: "Newsletters", color: "#111827", initials: "M", last: "19 jul", unsub: true, primaryMessageId: "", latestAt: 0 },
  { id: "amazon", name: "Amazon", domain: "amazon.com", count: 13, category: "Notificaciones", color: "#ef9d24", initials: "A", last: "18 jul", unsub: false, primaryMessageId: "", latestAt: 0 },
];

function Icon({ name }: { name: "shield" | "search" | "spark" | "history" | "settings" | "logout" | "trash" | "ban" | "chevron" }) {
  const paths = {
    shield: <><path d="M12 3 5 6v5c0 4.5 2.9 7.6 7 9 4.1-1.4 7-4.5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></>,
    search: <><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></>,
    spark: <><path d="m12 3 1.2 4.8L18 9l-4.8 1.2L12 15l-1.2-4.8L6 9l4.8-1.2L12 3Z"/><path d="m18 15 .6 2.4L21 18l-2.4.6L18 21l-.6-2.4L15 18l2.4-.6L18 15Z"/></>,
    history: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8"/><path d="M4 4v4h4M12 8v5l3 2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    logout: <><path d="M10 5H5v14h5M14 8l4 4-4 4M9 12h9"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></>,
    ban: <><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const historyStatus = {
  verifying: { label: "Verificando", detail: "Esperando 7 días sin nuevos mensajes" },
  confirmed: { label: "Confirmada", detail: "No llegaron mensajes nuevos" },
  manual: { label: "Revisión manual", detail: "El remitente no admite confirmación automática" },
  failed: { label: "Fallida", detail: "Llegó publicidad después de la solicitud" },
} as const;

function mergeSenderPages(current: Sender[], incoming: Sender[]): Sender[] {
  const grouped = new Map(current.map((sender) => [sender.id, { ...sender }]));
  for (const sender of incoming) {
    const existing = grouped.get(sender.id);
    if (!existing) {
      grouped.set(sender.id, { ...sender });
      continue;
    }
    existing.count += sender.count;
    existing.unsub = existing.unsub || sender.unsub;
    if (sender.latestAt > existing.latestAt) {
      existing.latestAt = sender.latestAt;
      existing.last = sender.last;
      existing.primaryMessageId = sender.primaryMessageId;
      existing.category = sender.category;
    }
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count);
}

function HistoryView({
  records,
  loading,
  onRefresh,
}: {
  records: HistoryRecord[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <main className="dashboard">
      <header className="dash-header history-heading">
        <div>
          <p className="breadcrumb">Gmail / Historial</p>
          <h1>Seguimiento de desuscripciones.</h1>
          <p>Comprobamos si cada remitente respeta tu solicitud después de siete días.</p>
        </div>
        <button className="refresh-button" onClick={onRefresh} disabled={loading}>
          <Icon name="history" /> {loading ? "Comprobando..." : "Comprobar ahora"}
        </button>
      </header>
      <section className="history-summary">
        <article><strong>{records.length}</strong><span>Solicitudes registradas</span></article>
        <article><strong>{records.filter((item) => item.status === "confirmed").length}</strong><span>Confirmadas</span></article>
        <article><strong>{records.filter((item) => item.status === "failed").length}</strong><span>Fallidas</span></article>
      </section>
      <section className="history-panel">
        {loading && <div className="loading-state"><span className="loader" /> Consultando el historial...</div>}
        {!loading && records.length === 0 && (
          <div className="empty-state history-empty">
            <span><Icon name="history" /></span>
            <strong>Aún no hay desuscripciones registradas</strong>
            <p>Selecciona un remitente en Limpieza inteligente y pulsa Desuscribir.</p>
          </div>
        )}
        {!loading && records.map((record) => {
          const status = historyStatus[record.status];
          return (
            <article className="history-row" key={record.id}>
              <span className="history-avatar">{record.senderName.slice(0, 2).toUpperCase()}</span>
              <div className="history-sender">
                <strong>{record.senderName}</strong>
                <small>{record.senderDomain}</small>
              </div>
              <div className="history-date">
                <small>Solicitud enviada</small>
                <strong>{new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric" }).format(new Date(record.requestedAt))}</strong>
              </div>
              <div className="history-trash">
                <small>Mensajes a papelera</small>
                <strong>{record.messagesTrashed}</strong>
              </div>
              <div className={`history-status ${record.status}`}>
                <b>{status.label}</b>
                <small>{status.detail}</small>
              </div>
            </article>
          );
        })}
      </section>
      <p className="footer-copy">La confirmación se basa en si el remitente vuelve a enviarte mensajes después de la solicitud.</p>
    </main>
  );
}

export default function Home() {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [gmailEmail, setGmailEmail] = useState("");
  const [senders, setSenders] = useState<Sender[]>(demoSenders);
  const [scanned, setScanned] = useState(195);
  const [estimate, setEstimate] = useState(195);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"cleanup" | "history">("cleanup");
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("Todos");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [scanRange, setScanRange] = useState<ScanRange>("all");
  const [customOpen, setCustomOpen] = useState(false);
  const [customAfter, setCustomAfter] = useState("");
  const [customBefore, setCustomBefore] = useState("");
  const scanAbortRef = useRef<AbortController | null>(null);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4200);
  };

  const runScan = useCallback(async (
    range: ScanRange,
    after = "",
    before = "",
  ) => {
    scanAbortRef.current?.abort();
    const controller = new AbortController();
    scanAbortRef.current = controller;
    setLoading(true);
    setError("");
    setSelected([]);
    setSenders([]);
    setScanned(0);
    setEstimate(0);
    setScanRange(range);
    setCustomOpen(range === "custom");

    let pageToken: string | null = null;
    let totalScanned = 0;
    let accumulated: Sender[] = [];
    try {
      do {
        const url = new URL("/api/google/scan", window.location.origin);
        url.searchParams.set("range", range);
        if (after) url.searchParams.set("after", after);
        if (before) url.searchParams.set("before", before);
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const response = await fetch(url, { signal: controller.signal });
        const data = await response.json() as {
          groups?: Sender[];
          email?: string;
          scanned?: number;
          nextPageToken?: string | null;
          resultSizeEstimate?: number;
          error?: string;
        };
        if (!response.ok) throw new Error(data.error ?? "No se pudo analizar Gmail.");
        accumulated = mergeSenderPages(accumulated, data.groups ?? []);
        totalScanned += data.scanned ?? 0;
        pageToken = data.nextPageToken ?? null;
        setSenders(accumulated);
        setGmailEmail(data.email ?? "");
        setScanned(totalScanned);
        setEstimate(data.resultSizeEstimate ?? totalScanned);
      } while (pageToken && !controller.signal.aborted);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "No se pudo analizar Gmail.");
    } finally {
      if (scanAbortRef.current === controller) {
        setLoading(false);
        scanAbortRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google_error")) setError(`Google: ${params.get("google_error")}`);
    if (params.get("provider") === "gmail") setProvider("gmail");
  }, []);

  useEffect(() => {
    if (provider !== "gmail") return;
    runScan("all");
    return () => scanAbortRef.current?.abort();
  }, [provider, runScan]);

  const rows = useMemo(() => senders.filter((sender) => {
    const matchesFilter = filter === "Todos" || sender.category === filter;
    const matchesQuery = `${sender.name} ${sender.domain}`.toLowerCase().includes(query.toLowerCase());
    return matchesFilter && matchesQuery;
  }), [filter, query, senders]);

  const chosen = senders.filter((sender) => selected.includes(sender.id));
  const chosenCount = chosen.reduce((total, sender) => total + sender.count, 0);
  const advertising = senders.filter((sender) => sender.category === "Publicidad").reduce((total, sender) => total + sender.count, 0);
  const available = senders.filter((sender) => sender.unsub).length;

  const chooseProvider = async (key: Provider) => {
    setError("");
    if (key !== "gmail") {
      setProvider(key);
      setSenders(demoSenders);
      setScanned(195);
      setEstimate(195);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/google/status");
      const data = await response.json() as { connected: boolean; email?: string };
      if (data.connected) {
        setGmailEmail(data.email ?? "");
        setProvider("gmail");
      } else {
        window.location.assign("/api/google/connect");
      }
    } catch {
      setError("No se pudo iniciar la conexión con Gmail.");
      setLoading(false);
    }
  };

  const disconnect = async () => {
    scanAbortRef.current?.abort();
    if (provider === "gmail") await fetch("/api/google/disconnect", { method: "POST" });
    setProvider(null);
    setSelected([]);
    setGmailEmail("");
    setSenders(demoSenders);
    setView("cleanup");
  };

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const loadHistory = async (refresh = false) => {
    if (provider !== "gmail") {
      setHistory([]);
      setView("history");
      return;
    }
    setView("history");
    setHistoryLoading(true);
    setError("");
    try {
      if (refresh) {
        await runScan("30d");
      }
      const response = await fetch("/api/google/history");
      const data = await response.json() as { history?: HistoryRecord[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo cargar el historial.");
      setHistory(data.history ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar el historial.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const act = async (action: "unsubscribe" | "unsubscribe_and_trash") => {
    if (!selected.length || busy) return;
    if (provider !== "gmail") {
      showNotice(action === "unsubscribe" ? "Vista demostrativa: desuscripciones preparadas." : `${chosenCount} mensajes se moverían a la papelera.`);
      setSelected([]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/google/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          range: scanRange,
          after: customAfter,
          before: customBefore,
          groups: chosen.map(({ id, name, domain, primaryMessageId }) => ({
            id,
            name,
            domain,
            primaryMessageId,
          })),
        }),
      });
      const data = await response.json() as { unsubscribed?: number; manual?: number; trashed?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "No se pudo completar la acción.");
      showNotice(`${data.unsubscribed ?? 0} desuscripciones completadas · ${data.trashed ?? 0} mensajes a la papelera${data.manual ? ` · ${data.manual} requieren revisión manual` : ""}`);
      if (action === "unsubscribe_and_trash") {
        setSenders((current) => current.filter((sender) => !selected.includes(sender.id)));
      }
      setSelected([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  if (!provider) {
    return (
      <main className="welcome">
        <div className="welcome-glow" />
        <nav className="brand-bar">
          <div className="brand"><span className="brand-icon"><Icon name="shield" /></span>Spam<span>Kill</span></div>
          <span className="privacy-pill"><span /> Tus correos permanecen privados</span>
        </nav>
        <section className="provider-shell">
          <div className="eyebrow"><Icon name="spark" /> Limpia tu bandeja en minutos</div>
          <h1>Recupera el control<br />de tu correo.</h1>
          <p>Elige una cuenta para analizar suscripciones, detener publicidad y limpiar mensajes. Cada cuenta funciona por separado.</p>
          {error && <div className="error-banner">{error}</div>}
          <div className="provider-grid">
            {(Object.keys(providers) as Provider[]).map((key) => {
              const item = providers[key];
              return (
                <button key={key} className={`provider-card ${item.tone}`} onClick={() => chooseProvider(key)} disabled={loading}>
                  <span className="provider-logo">{item.mark}</span>
                  <span><strong>{loading && key === "gmail" ? "Conectando..." : `Continuar con ${item.name}`}</strong><small>{key === "gmail" ? "Conectar cuenta real de forma segura" : "Vista demostrativa — integración posterior"}</small></span>
                  <Icon name="chevron" />
                </button>
              );
            })}
          </div>
          <div className="trust-row"><span>✓ Sin bandeja unificada</span><span>✓ Acciones reversibles</span><span>✓ Tú decides qué eliminar</span></div>
        </section>
      </main>
    );
  }

  const account = providers[provider];
  const accountEmail = provider === "gmail" && gmailEmail ? gmailEmail : account.email;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon"><Icon name="shield" /></span>Spam<span>Kill</span></div>
        <div className="account-card">
          <span className={`account-mark ${account.tone}`}>{account.mark}</span>
          <span><strong>{account.name}</strong><small>{accountEmail}</small></span>
          <button aria-label="Cambiar cuenta" onClick={() => { setProvider(null); setSelected([]); }}><Icon name="chevron" /></button>
        </div>
        <nav className="side-nav">
          <button className={view === "cleanup" ? "active" : ""} onClick={() => setView("cleanup")}><Icon name="spark" /> Limpieza inteligente <b>{senders.length}</b></button>
          <button className={view === "history" ? "active" : ""} onClick={() => loadHistory(false)}><Icon name="history" /> Historial</button>
          <button><Icon name="settings" /> Configuración</button>
        </nav>
        <div className="privacy-note">
          <span><Icon name="shield" /></span>
          <strong>Privacidad primero</strong>
          <p>Solo analizamos encabezados y datos necesarios para detectar suscripciones.</p>
        </div>
        <button className="disconnect" onClick={disconnect}><Icon name="logout" /> Desconectar cuenta</button>
      </aside>

      {view === "history" ? (
        <HistoryView records={history} loading={historyLoading} onRefresh={() => loadHistory(true)} />
      ) : (
      <main className="dashboard">
        <header className="dash-header">
          <div>
            <p className="breadcrumb">{account.name} / Limpieza</p>
            <h1>{loading ? "Analizando tu bandeja..." : "Tu bandeja, bajo control."}</h1>
            <p>{loading ? <>Procesados <strong>{scanned}</strong>{estimate ? ` de aproximadamente ${estimate}` : ""}. Puedes detener el análisis cuando quieras.</> : <>Encontramos <strong>{senders.reduce((total, sender) => total + sender.count, 0)} mensajes</strong> de {senders.length} remitentes para revisar.</>}</p>
          </div>
          <div className="safety"><span>●</span><div><strong>Modo seguro activo</strong><small>Los correos irán a la papelera</small></div></div>
        </header>

        {error && <div className="error-banner dashboard-error">{error}</div>}
        <section className="stats">
          <article><span className="stat-icon violet"><Icon name="spark" /></span><div><small>Mensajes analizados</small><strong>{scanned}</strong><em>{rangeLabels[scanRange]}</em></div></article>
          <article><span className="stat-icon orange">%</span><div><small>Publicidad</small><strong>{advertising}</strong><em>Detección inicial</em></div></article>
          <article><span className="stat-icon green"><Icon name="ban" /></span><div><small>Desuscripción disponible</small><strong>{available}</strong><em>De {senders.length} remitentes</em></div></article>
        </section>

        <section className="scope-panel">
          <div>
            <small>Periodo del análisis</small>
            <strong>Elige qué parte de Gmail quieres revisar</strong>
          </div>
          <div className="scope-options">
            {(["all", "30d", "90d", "1y"] as ScanRange[]).map((range) => (
              <button
                key={range}
                className={scanRange === range ? "active" : ""}
                disabled={loading}
                onClick={() => { setCustomOpen(false); runScan(range); }}
              >
                {rangeLabels[range]}
              </button>
            ))}
            <button
              className={customOpen ? "active" : ""}
              disabled={loading}
              onClick={() => setCustomOpen(true)}
            >
              Por fechas
            </button>
          </div>
          {customOpen && (
            <div className="custom-dates">
              <label>Desde<input type="date" value={customAfter} onChange={(event) => setCustomAfter(event.target.value)} /></label>
              <label>Hasta<input type="date" value={customBefore} onChange={(event) => setCustomBefore(event.target.value)} /></label>
              <button disabled={loading || !customAfter || !customBefore} onClick={() => runScan("custom", customAfter, customBefore)}>Analizar fechas</button>
            </div>
          )}
          {loading && (
            <div className="scan-progress">
              <span><i style={{ width: estimate ? `${Math.min(100, Math.round((scanned / estimate) * 100))}%` : "12%" }} /></span>
              <button onClick={() => scanAbortRef.current?.abort()}>Detener análisis</button>
            </div>
          )}
        </section>

        <section className="mail-panel">
          <div className="toolbar">
            <div className="filters">
              {(["Todos", "Publicidad", "Newsletters", "Notificaciones"] as Filter[]).map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? "active" : ""}>{item}</button>)}
            </div>
            <label className="search"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar remitente..." /></label>
          </div>

          <div className="table-head">
            <label><input type="checkbox" checked={rows.length > 0 && rows.every((row) => selected.includes(row.id))} onChange={() => setSelected(rows.every((row) => selected.includes(row.id)) ? [] : rows.map((row) => row.id))} /> Remitente</label>
            <span>Categoría</span><span>Mensajes</span><span>Último</span><span>Desuscripción</span>
          </div>

          <div className="sender-list">
            {loading && <div className="loading-state"><span className="loader" /> Analizando {rangeLabels[scanRange].toLowerCase()}...</div>}
            {!loading && rows.length === 0 && <div className="empty-state">No encontramos remitentes con estos filtros.</div>}
            {!loading && rows.map((sender) => (
              <label className={`sender-row ${selected.includes(sender.id) ? "selected" : ""}`} key={sender.id}>
                <span className="sender-main"><input type="checkbox" checked={selected.includes(sender.id)} onChange={() => toggle(sender.id)} /><i style={{ background: sender.color }}>{sender.initials}</i><span><strong>{sender.name}</strong><small>{sender.domain}</small></span></span>
                <span><b className={`tag ${sender.category.toLowerCase()}`}>{sender.category}</b></span>
                <strong className="message-count">{sender.count}</strong>
                <span className="last-date">{sender.last}</span>
                <span className={sender.unsub ? "available" : "manual"}>{sender.unsub ? "✓ Disponible" : "Manual"}</span>
              </label>
            ))}
          </div>

          {selected.length > 0 && (
            <div className="action-bar">
              <div><strong>{selected.length} remitentes seleccionados</strong><small>{chosenCount} mensajes afectados</small></div>
              <button disabled={busy} className="unsubscribe" onClick={() => act("unsubscribe")}><Icon name="ban" /> {busy ? "Procesando..." : "Desuscribir"}</button>
              <button disabled={busy} className="delete" onClick={() => act("unsubscribe_and_trash")}><Icon name="trash" /> Desuscribir y limpiar</button>
            </div>
          )}
        </section>
        <p className="footer-copy">SpamKill nunca elimina mensajes de forma permanente sin tu confirmación.</p>
      </main>
      )}
      {notice && <div className="toast">✓ {notice}</div>}
    </div>
  );
}
